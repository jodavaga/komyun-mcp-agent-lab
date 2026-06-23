import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import supabase from "../supabaseClient";
import { buildToolError } from "../errors";

const JUDICIAL_MORA_THRESHOLD_MONTHS = Number(process.env.JUDICIAL_MORA_THRESHOLD_MONTHS ?? 3);

interface CarteraRow {
    saldo_admon: number;
    intereses: number;
    total: number;
    meses_mora: number;
    fecha_corte: string;
}

interface Propietario {
    nombre: string;
    email: string;
}

function firstPropietario(raw: unknown): Propietario {
    const row = Array.isArray(raw) ? raw[0] : raw;
    return { nombre: row?.nombre ?? "residente", email: row?.email ?? "" };
}

function buildNotice(apartment_code: string, propietario: Propietario, cartera: CarteraRow) {
    const fmt = (n: number) => n.toLocaleString("es-CO");

    const subject = `Aviso de cobro pre-jurídico — Apto ${apartment_code}`;

    const body = `Estimado(a) ${propietario.nombre},

Le informamos que el apartamento ${apartment_code} presenta una mora de ${cartera.meses_mora} meses, superando el plazo establecido para el inicio del proceso de cobro pre-jurídico.

Saldo total adeudado: $${fmt(cartera.total)}

Le solicitamos ponerse al día con su obligación a la mayor brevedad posible, para evitar que el caso sea remitido a cobro jurídico. Adjuntamos el estado de cuenta detallado.

Atentamente,
Administración`;

    const attachmentContent = `ESTADO DE CUENTA — Apto ${apartment_code}
Saldo administración: $${fmt(cartera.saldo_admon)}
Intereses: $${fmt(cartera.intereses)}
Total adeudado: $${fmt(cartera.total)}
Meses en mora: ${cartera.meses_mora}
Fecha de corte: ${cartera.fecha_corte}`;

    return {
        apartment_code,
        propietario,
        total_deuda: cartera.total,
        meses_mora: cartera.meses_mora,
        subject,
        body,
        attachment: {
            filename: `estado-cuenta-${apartment_code}.txt`,
            content: attachmentContent,
        },
    };
}

export function registerDraftJudicialCollectionNotice(server: McpServer) {
    server.registerTool("draft_judicial_collection_notice", {
        description: `Drafts formal pre-judicial collection notices for apartments already past the judicial mora threshold (${JUDICIAL_MORA_THRESHOLD_MONTHS} months); returns content for human review and never sends email.
        Pass 'apartment_code' to draft for one apartment, or omit it to batch-draft for every currently qualifying apartment (up to 'limit').
        Do NOT use this for a simple balance check — use 'get_apartment_balance' for that.
        Do NOT use this for listing/discovery of apartments in mora — use 'search_apartments_in_mora' for that.`,
        inputSchema: {
            apartment_code: z
                .string()
                .regex(/^[1-3]-\d{3,4}$/, "Apartment code must include the bloque prefix, e.g. '2-1102' or '1-101'")
                .optional()
                .describe("Single apartment to draft a notice for. Omit for batch mode over all qualifying apartments."),
            limit: z
                .number()
                .int()
                .min(1)
                .max(50)
                .default(20)
                .describe("Batch mode only: max number of notices to draft (1-50, default 20)."),
        },
        annotations: {
            readOnlyHint: true,
            destructiveHint: false,
            idempotentHint: true,
            openWorldHint: false,
        },
    }, async ({ apartment_code, limit }) => {
        if (apartment_code) {
            const { data: apto, error: aptoErr } = await supabase
                .from("apartamentos")
                .select("id, propietarios(nombre, email)")
                .eq("codigo", apartment_code)
                .single();

            if (aptoErr || !apto) {
                return buildToolError({
                    errorCategory: "validation",
                    isRetryable: false,
                    message: `Apartamento ${apartment_code} no encontrado`,
                });
            }

            const { data: cartera } = await supabase
                .from("cartera")
                .select("saldo_admon, intereses, total, meses_mora, fecha_corte")
                .eq("apto_id", apto.id)
                .maybeSingle();

            if (!cartera || cartera.meses_mora <= JUDICIAL_MORA_THRESHOLD_MONTHS) {
                return buildToolError({
                    errorCategory: "validation",
                    isRetryable: false,
                    message: `Apto ${apartment_code} tiene ${cartera?.meses_mora ?? 0} meses de mora, por debajo del umbral pre-jurídico de ${JUDICIAL_MORA_THRESHOLD_MONTHS}`,
                });
            }

            const notice = buildNotice(apartment_code, firstPropietario(apto.propietarios), cartera);
            return { content: [{ type: "text", text: JSON.stringify(notice) }] };
        }

        const { data, error } = await supabase
            .from("cartera")
            .select("saldo_admon, intereses, total, meses_mora, fecha_corte, apartamentos!inner(codigo, propietarios(nombre, email))")
            .gt("meses_mora", JUDICIAL_MORA_THRESHOLD_MONTHS)
            .order("meses_mora", { ascending: false })
            .limit(limit);

        if (error) throw error;

        const notices = (data ?? []).map((row: any) =>
            buildNotice(row.apartamentos.codigo, firstPropietario(row.apartamentos.propietarios), row)
        );

        return { content: [{ type: "text", text: JSON.stringify(notices) }] };
    });
}
