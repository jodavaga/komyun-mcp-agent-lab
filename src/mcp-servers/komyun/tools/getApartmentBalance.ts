import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import supabase from "../supabaseClient";
import { buildToolError } from "../errors";

export function registerGetApartmentBalance(server: McpServer) {
    server.registerTool("get_apartment_balance", { 
        description: `Returns the exact current balance for one specific apartment, identified by its code (e.g. '2-1102'): saldo_admon, intereses, total, meses_mora, and fecha_corte. 
        Use this only when the user asks about a single apartment's balance. 
        Do NOT use this to list or find multiple apartments in mora — use 'search_apartments_in_mora' for that. 
        Do NOT use this to draft a collection notice — use 'draft_judicial_collection_notice' for that.`,
        inputSchema: {
        apartment_code: z
            .string()
            .regex(/^[1-3]-\d{3,4}$/, "Apartment code must include the bloque prefix, e.g. '2-1102' or '1-101'")
            .describe("Apartment code including Bloques (e.g. 2-1102, 1-101)"),
        },
        annotations: {
            readOnlyHint: true,
            destructiveHint: false,
            idempotentHint: true,
            openWorldHint: false,
        },
    }, async ({ apartment_code }) => {
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

        const { data: cartera, error: carteraErr } = await supabase
            .from("cartera")
            .select("saldo_admon, intereses, total, meses_mora, fecha_corte")
            .eq("apto_id", apto.id)
            .single();

        if (carteraErr) {
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