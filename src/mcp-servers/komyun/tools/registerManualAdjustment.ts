import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import supabase from "../supabaseClient";
import { buildToolError } from "../errors";

export function registerRegisterManualAdjustment(server: McpServer) {
    server.registerTool("register_manual_adjustment", {
        description: `Applies a manual adjustment to one apartment's saldo_admon. 'monto' is a signed COP delta: positive = charge (debe), negative = credit (abono). 'motivo' is required and kept as the audit trail.
        This WRITES data — unlike 'get_apartment_balance', which only reads.
        Large adjustments may be blocked and escalated for administrator review.
        Do NOT use this for balance lookups — use 'get_apartment_balance' for that.`,
        inputSchema: {
            apartment_code: z
                .string()
                .regex(/^[1-3]-\d{3,4}$/, "Apartment code must include the bloque prefix, e.g. '2-1102' or '1-101'")
                .describe("Apartment code including Bloques (e.g. 2-1102, 1-101)"),
            monto: z
                .number()
                .describe("Signed COP delta to apply to saldo_admon: positive = charge (debe), negative = credit (abono)."),
            motivo: z
                .string()
                .min(1, "motivo is required for the audit trail")
                .describe("Reason for this adjustment — required for the audit trail."),
        },
        annotations: {
            readOnlyHint: false,
            destructiveHint: true,
            idempotentHint: false,
            openWorldHint: false,
        },
    }, async ({ apartment_code, monto, motivo }) => {
        const { data: apto, error: aptoErr } = await supabase
            .from("apartamentos")
            .select("id")
            .eq("codigo", apartment_code)
            .single();

        if (aptoErr || !apto) {
            return buildToolError({
                errorCategory: "validation",
                isRetryable: false,
                message: `Apartamento ${apartment_code} no encontrado`,
            });
        }

        const { data: existing } = await supabase
            .from("cartera")
            .select("saldo_admon")
            .eq("apto_id", apto.id)
            .maybeSingle();

        const nuevoSaldo = (existing?.saldo_admon ?? 0) + monto;

        const { data: cartera, error: upsertErr } = await supabase
            .from("cartera")
            .upsert(
                { apto_id: apto.id, saldo_admon: nuevoSaldo, fecha_corte: new Date().toISOString().slice(0, 10) },
                { onConflict: "apto_id" }
            )
            .select("saldo_admon, intereses, total, meses_mora, fecha_corte")
            .single();

        if (upsertErr) throw upsertErr;

        return {
            content: [{ type: "text", text: JSON.stringify({ apartment_code, motivo, ajuste_aplicado: monto, ...cartera }) }],
        };
    });
}
