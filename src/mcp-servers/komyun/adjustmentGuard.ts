import supabase from "./supabaseClient";
import type { ToolErrorPayload } from "./errors";

function resolveAdjustmentThreshold(): number {
    const raw = process.env.ADJUSTMENT_THRESHOLD_COP;
    if (!raw) return 1_000_000;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : 1_000_000;
}

const ADJUSTMENT_THRESHOLD_COP = resolveAdjustmentThreshold();
const ALLOWED_TEST_APARTMENT = process.env.ALLOWED_TEST_APARTMENT;

export type AdjustmentGuardResult = { allowed: true } | { allowed: false; payload: ToolErrorPayload };

// Single source of truth for the register_manual_adjustment business rule, called from both
// src/toolPolicy.ts's host-side hook (cheap first line) and the tool itself (the hard floor —
// the host hook can be bypassed by any MCP client that doesn't run it, e.g. the Inspector).
export async function checkAdjustmentAllowed(
    apartmentCode: string,
    monto: number,
    motivo: string
): Promise<AdjustmentGuardResult> {
    if (apartmentCode !== ALLOWED_TEST_APARTMENT) {
        return {
            allowed: false,
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
            allowed: false,
            payload: {
                errorCategory: "permission",
                isRetryable: false,
                message: numero
                    ? `Adjustment blocked — exceeds the ${ADJUSTMENT_THRESHOLD_COP} COP threshold. Escalation ticket ${numero} filed for administrator review.`
                    : `Adjustment blocked — exceeds the ${ADJUSTMENT_THRESHOLD_COP} COP threshold. Escalation ticket could not be filed automatically; notify an administrator.`,
            },
        };
    }

    return { allowed: true };
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
