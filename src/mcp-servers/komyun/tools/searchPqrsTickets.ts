import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import supabase from "../supabaseClient";
import { buildTransientError } from "../errors";

export function registerSearchPqrsTickets(server: McpServer) {
    server.registerTool("search_pqrs_tickets", {
        description: `Lists PQRS tickets for discovery — e.g. "what open PQRS do we have" or "what PQRS has apartment 2-1102 filed". Returns 'numero', the ticket number 'update_pqrs_ticket' needs to act on a ticket.
        Omit 'estado' to get open tickets only (anything not 'cerrada'). Pass estado='cerrada' to see closed tickets instead.
        Returns summary fields only — titulo, descripcion, estado, categoria, prioridad — not respuesta/nota_interna or attachments.
        Do NOT use this to respond to or close a ticket — use 'update_pqrs_ticket' with the returned numero for that.`,
        inputSchema: {
            apartment_code: z
                .string()
                .regex(/^[1-3]-\d{3,4}$/, "Apartment code must include the bloque prefix, e.g. '2-1102' or '1-101'")
                .optional()
                .describe("Filter to PQRS tickets filed by this apartment. Omit to search all apartments."),
            estado: z
                .string()
                .min(1)
                .optional()
                .describe("Filter by exact status (e.g. 'en_proceso', 'asignada', 'cerrada'). Omit to default to open tickets only (anything not 'cerrada')."),
            limit: z
                .number()
                .int()
                .min(1)
                .max(50)
                .default(10)
                .describe("Max number of tickets to return (1-50, default 10)."),
        },
        annotations: {
            readOnlyHint: true,
            destructiveHint: false,
            idempotentHint: true,
            openWorldHint: false,
        },
    }, async ({ apartment_code, estado, limit }) => {
        let query = supabase
            .from("pqrs")
            .select("numero, tipo, categoria, prioridad, titulo, descripcion, estado, responsable, created_at, apartamentos!inner(codigo)")
            .order("created_at", { ascending: false })
            .limit(limit);

        if (estado) {
            query = query.eq("estado", estado);
        } else {
            query = query.neq("estado", "cerrada");
        }

        if (apartment_code) query = query.eq("apartamentos.codigo", apartment_code);

        const { data, error } = await query;

        if (error) return buildTransientError(error);

        const results = (data ?? []).map((row: any) => ({
            numero: row.numero,
            apartment_code: row.apartamentos.codigo,
            tipo: row.tipo,
            categoria: row.categoria,
            prioridad: row.prioridad,
            titulo: row.titulo,
            descripcion: row.descripcion,
            estado: row.estado,
            responsable: row.responsable,
            created_at: row.created_at,
        }));

        return {
            content: [{ type: "text", text: JSON.stringify(results) }],
        };
    });
}
