import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import supabase from "../supabaseClient";
import { buildToolError, buildTransientError } from "../errors";
import { apartmentCodeSchema } from "../validation";

export function registerGetApartmentBalance(server: McpServer) {
    server.registerTool("get_apartment_balance", {
        description: `Returns the exact current balance for one specific apartment, identified by its code (e.g. '2-1102'): saldo_admon, intereses, total, meses_mora, and fecha_corte.
        Use this only when the user asks about a single apartment's balance.
        Do NOT use this to list or find multiple apartments in mora — use 'search_apartments_in_mora' for that.
        Do NOT use this to draft a collection notice — use 'draft_judicial_collection_notice' for that.`,
        inputSchema: {
        apartment_code: apartmentCodeSchema
            .describe("Apartment code including Bloques (e.g. 2-1102, 1-101)"),
        _simulateTransientError: z
            .boolean()
            .optional()
            .describe("Debug only: when true, skips Supabase and returns a simulated transient error, to exercise the retry path."),
        },
        annotations: {
            readOnlyHint: true,
            destructiveHint: false,
            idempotentHint: true,
            openWorldHint: false,
        },
    }, async ({ apartment_code, _simulateTransientError }) => {
        if (_simulateTransientError) {
            return buildTransientError(new Error("Simulated transient Supabase error (debug flag)"));
        }

        const { data: apto, error: aptoErr } = await supabase
            .from("apartamentos")
            .select("id")
            .eq("codigo", apartment_code)
            .maybeSingle();

        if (aptoErr) return buildTransientError(aptoErr);

        if (!apto) {
            return buildToolError({
                errorCategory: "validation",
                isRetryable: false,
                message: `Apartamento ${apartment_code} no encontrado`,
            });
        }

        const { data: cartera, error: carteraErr } = await supabase
            .from("cartera")
            .select("saldo_admon, intereses, total, meses_mora, fecha_corte")
            .eq("apto_id", apto.id)
            .maybeSingle();

        if (carteraErr) return buildTransientError(carteraErr);

        if (!cartera) {
            return {
                content: [
                    {
                        type: "text",
                        text: JSON.stringify({ saldo_admon: 0, intereses: 0, total: 0, meses_mora: 0 }),
                    },
                ],
            };
        }

        return {
            content: [{ type: "text", text: JSON.stringify(cartera) }],
        };
    });
}