import "dotenv/config";
import supabase from "./mcp-servers/komyun/supabaseClient";
import { buildToolError, type ToolErrorPayload } from "./mcp-servers/komyun/errors";
import type { McpClient } from "./mcpClient";

function resolveAdjustmentThreshold(): number {
    const raw = process.env.ADJUSTMENT_THRESHOLD_COP;
    if (!raw) return 1_000_000;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : 1_000_000;
}

const ADJUSTMENT_THRESHOLD_COP = resolveAdjustmentThreshold();
const ALLOWED_TEST_APARTMENT = process.env.ALLOWED_TEST_APARTMENT;

type PreToolUseDecision = { block: false } | { block: true; payload: ToolErrorPayload };

export async function preToolUseHook(
    name: string,
    input: Record<string, unknown>
): Promise<PreToolUseDecision> {
    if (name !== "register_manual_adjustment") return { block: false };

    const apartmentCode = input.apartment_code as string;
    const monto = Number(input.monto);
    const motivo = String(input.motivo ?? "");

    if (apartmentCode !== ALLOWED_TEST_APARTMENT) {
        return {
            block: true,
            payload: {
                errorCategory: "permission",
                isRetryable: false,
                message: `This practice server only allows manual adjustments on the test apartment (${ALLOWED_TEST_APARTMENT}).`,
            },
        };
    }

    if (Math.abs(monto) > ADJUSTMENT_THRESHOLD_COP) {
        const numero = await fileEscalationTicket(apartmentCode, monto, motivo);
        return {
            block: true,
            payload: {
                errorCategory: "permission",
                isRetryable: false,
                message: numero
                    ? `Adjustment blocked — exceeds the ${ADJUSTMENT_THRESHOLD_COP} COP threshold. Escalation ticket ${numero} filed for administrator review.`
                    : `Adjustment blocked — exceeds the ${ADJUSTMENT_THRESHOLD_COP} COP threshold. Escalation ticket could not be filed automatically; notify an administrator.`,
            },
        };
    }

    return { block: false };
}

// Files a PQRS ticket for an administrator to review a blocked over-threshold adjustment.
// Returns the ticket's display number, or null if the lookup/insert failed — a filing failure
// here must never throw, since the adjustment is already blocked either way.
async function fileEscalationTicket(apartmentCode: string, monto: number, motivo: string): Promise<string | null> {
    // pqrs.apto_id is a foreign key to apartamentos.id, not the human-readable codigo — resolve it first.
    const { data: apto, error: aptoErr } = await supabase
        .from("apartamentos")
        .select("id")
        .eq("codigo", apartmentCode)
        .maybeSingle();

    if (aptoErr || !apto) return null;

    const { data: escalation, error: insertErr } = await supabase
        .from("pqrs")
        .insert({
            apto_id: apto.id,
            tipo: "reclamo",
            categoria: "administracion",
            prioridad: "alta",
            estado: "abierta",
            adjuntos: [], // no DB default on this column in the original backend's insert path — set explicitly
            titulo: "[ESCALATION] Ajuste manual bloqueado",
            descripcion: `Monto ${monto} excede el umbral de ${ADJUSTMENT_THRESHOLD_COP} COP. Motivo original: ${motivo}`,
        })
        .select("numero") // the human-facing ticket number (e.g. 'PQR-2026-007'), not the internal id
        .single();

    if (insertErr || !escalation) return null;
    return escalation.numero;
}

type ToolCallResult = Awaited<ReturnType<McpClient["callTool"]>>;

export async function callToolWithRetry(
    mcpClient: McpClient,
    name: string,
    input: unknown,
    maxRetries = 2
): Promise<ToolCallResult> {
    let attempt = 0;
    while (true) {
        const result = await mcpClient.callTool(name, input);
        if (!result.isError) return result;

        const payload = tryParseErrorPayload(result.content);
        if (payload?.errorCategory === "transient" && payload.isRetryable && attempt < maxRetries) {
            attempt++;
            await new Promise((resolve) => setTimeout(resolve, 300 * attempt));
            continue;
        }
        return result; // validation/permission, or transient retries exhausted — surface to Claude as-is
    }
}

function tryParseErrorPayload(content: ToolCallResult["content"]): ToolErrorPayload | null {
    if (!Array.isArray(content)) return null;
    const textBlock = content.find((block): block is { type: "text"; text: string } => block.type === "text");
    if (!textBlock) return null;
    try {
        return JSON.parse(textBlock.text) as ToolErrorPayload;
    } catch {
        return null;
    }
}

export function blockedToolResult(payload: ToolErrorPayload): ToolCallResult {
    const { content, isError } = buildToolError(payload);
    return { content: content as ToolCallResult["content"], isError: Boolean(isError) };
}
