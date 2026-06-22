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