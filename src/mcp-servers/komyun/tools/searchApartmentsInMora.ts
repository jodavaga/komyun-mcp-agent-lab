import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import supabase from "../supabaseClient";

export function registerSearchApartmentsInMora(server: McpServer) {
    server.registerTool("search_apartments_in_mora", {
        description: `Lists multiple apartments currently in mora (past-due balance), for aggregate/discovery queries like "which apartments owe money" or "top debtors in block 2".
        Returns raw balance numbers only — codigo, bloque, total, meses_mora — no propietario/email or correspondence content.
        Do NOT use this to get one apartment's exact balance — use 'get_apartment_balance' for that.
        Do NOT use this to draft a collection notice — use 'draft_judicial_collection_notice' for that.`,
        inputSchema: {
            bloque: z
                .union([z.literal(1), z.literal(2), z.literal(3)])
                .optional()
                .describe("Filter by block number (1, 2, or 3). Omit to search all blocks."),
            min_total: z
                .number()
                .min(0)
                .default(0)
                .describe("Minimum total balance owed, in COP, to include in results. Defaults to 0."),
            limit: z
                .number()
                .int()
                .min(1)
                .max(50)
                .default(10)
                .describe("Max number of apartments to return (1-50, default 10)."),
        },
        annotations: {
            readOnlyHint: true,
            destructiveHint: false,
            idempotentHint: true,
            openWorldHint: false,
        },
    }, async ({ bloque, min_total, limit }) => {
        let query = supabase
            .from("cartera")
            .select("total, meses_mora, apartamentos!inner(codigo, bloque)")
            .gte("total", min_total)
            .order("total", { ascending: false })
            .limit(limit);

        if (bloque) query = query.eq("apartamentos.bloque", bloque);

        const { data, error } = await query;

        if (error) throw error;

        const results = (data ?? []).map((row: any) => ({
            codigo: row.apartamentos.codigo,
            bloque: row.apartamentos.bloque,
            total: row.total,
            meses_mora: row.meses_mora,
        }));

        return {
            content: [{ type: "text", text: JSON.stringify(results) }],
        };
    });
}
