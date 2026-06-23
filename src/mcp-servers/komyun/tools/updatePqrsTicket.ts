import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import supabase from "../supabaseClient";
import { buildToolError } from "../errors";

export function registerUpdatePqrsTicket(server: McpServer) {
    server.registerTool("update_pqrs_ticket", {
        description: `Responds to or updates an existing OPEN PQRS ticket, identified by its numeric 'pqrs_id'. Provide at least one of 'estado', 'responsable', 'nota_interna', or 'respuesta'.
        This tool never creates tickets — there is no apartment_code input and no insert path.
        Do NOT use this on a ticket that is already 'cerrada' — it will be rejected.`,
        inputSchema: {
            pqrs_id: z
                .number()
                .int()
                .positive()
                .describe("Numeric id of the existing PQRS ticket to update."),
            estado: z
                .enum(["en_proceso", "asignada", "cerrada"])
                .optional()
                .describe("New status for the ticket. Omit to leave unchanged."),
            responsable: z
                .string()
                .min(1)
                .optional()
                .describe("Person or department now responsible for this ticket."),
            nota_interna: z
                .string()
                .min(1)
                .optional()
                .describe("Internal note, not visible to the resident."),
            respuesta: z
                .string()
                .min(1)
                .optional()
                .describe("Response visible to the resident."),
        },
        annotations: {
            readOnlyHint: false,
            destructiveHint: false,
            idempotentHint: false,
            openWorldHint: false,
        },
    }, async ({ pqrs_id, estado, responsable, nota_interna, respuesta }) => {
        if (!estado && !responsable && !nota_interna && !respuesta) {
            return buildToolError({
                errorCategory: "validation",
                isRetryable: false,
                message: "Debe proporcionar al menos uno de: estado, responsable, nota_interna, respuesta",
            });
        }

        const { data: current, error: fetchErr } = await supabase
            .from("pqrs")
            .select("id, estado, apartamentos(codigo)")
            .eq("id", pqrs_id)
            .single();

        if (fetchErr || !current) {
            return buildToolError({
                errorCategory: "validation",
                isRetryable: false,
                message: `PQRS #${pqrs_id} no encontrada`,
            });
        }

        if (current.estado === "cerrada") {
            return buildToolError({
                errorCategory: "validation",
                isRetryable: false,
                message: `PQRS #${pqrs_id} ya está cerrada, no se pueden agregar actualizaciones`,
            });
        }

        const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
        if (estado) updates.estado = estado;
        if (responsable) updates.responsable = responsable;
        if (nota_interna) updates.nota_interna = nota_interna;
        if (respuesta) updates.respuesta = respuesta;
        if (estado === "cerrada") updates.fecha_cierre = new Date().toISOString().slice(0, 10);

        const { data: updated, error: updateErr } = await supabase
            .from("pqrs")
            .update(updates)
            .eq("id", pqrs_id)
            .select("id, numero, estado, responsable, nota_interna, respuesta, fecha_cierre, apartamentos(codigo)")
            .single();

        if (updateErr) throw updateErr;

        return {
            content: [{ type: "text", text: JSON.stringify(updated) }],
        };
    });
}
