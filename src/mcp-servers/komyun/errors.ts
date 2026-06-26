import type { CallToolResult } from "@modelcontextprotocol/sdk/types";



export interface ToolErrorPayload {
  errorCategory: 'transient' | 'validation' | 'permission';
  isRetryable: boolean;
  message: string;
}


export function buildToolError(payload: ToolErrorPayload): CallToolResult {

    return {
        content: [
            {
                type: "text",
                text: JSON.stringify(payload)
            }
        ],
        isError: true
    }
}

export function buildTransientError(error: unknown): CallToolResult {
    const message = error instanceof Error ? error.message : String(error);
    return buildToolError({
        errorCategory: "transient",
        isRetryable: true,
        message: `Error de Supabase: ${message}`,
    });
}