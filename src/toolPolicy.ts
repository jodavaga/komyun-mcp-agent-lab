import "dotenv/config";
import { buildToolError, type ToolErrorPayload } from "./mcp-servers/komyun/errors";
import { checkAdjustmentAllowed } from "./mcp-servers/komyun/adjustmentGuard";
import type { McpClient } from "./mcpClient";

type PreToolUseDecision = { block: false } | { block: true; payload: ToolErrorPayload };

// Cheap, host-side first line: lets the agent loop reject a bad register_manual_adjustment call
// before it even reaches the MCP server. checkAdjustmentAllowed (shared with the tool itself in
// registerManualAdjustment.ts) is the actual hard floor — this hook can be bypassed by any MCP
// client that doesn't go through this loop, e.g. the Inspector or Claude Desktop.
export async function preToolUseHook(
    name: string,
    input: Record<string, unknown>
): Promise<PreToolUseDecision> {
    if (name !== "register_manual_adjustment") return { block: false };

    const apartmentCode = input.apartment_code as string;
    const monto = Number(input.monto);
    const motivo = String(input.motivo ?? "");

    const guard = await checkAdjustmentAllowed(apartmentCode, monto, motivo);
    if (!guard.allowed) return { block: true, payload: guard.payload };
    return { block: false };
}

type ToolCallResult = Awaited<ReturnType<McpClient["callTool"]>>;

export async function callToolWithRetry(
    mcpClient: McpClient,
    name: string,
    input: unknown,
    maxRetries = 2
): Promise<ToolCallResult> {
    let attempt = 0;
    while (true) {
        const result = await mcpClient.callTool(name, input);
        if (!result.isError) return result;

        const payload = tryParseErrorPayload(result.content);
        if (payload?.errorCategory === "transient" && payload.isRetryable && attempt < maxRetries) {
            attempt++;
            await new Promise((resolve) => setTimeout(resolve, 300 * attempt));
            continue;
        }
        return result; // validation/permission, or transient retries exhausted — surface to Claude as-is
    }
}

function tryParseErrorPayload(content: ToolCallResult["content"]): ToolErrorPayload | null {
    if (!Array.isArray(content)) return null;
    const textBlock = content.find((block): block is { type: "text"; text: string } => block.type === "text");
    if (!textBlock) return null;
    try {
        return JSON.parse(textBlock.text) as ToolErrorPayload;
    } catch {
        return null;
    }
}

export function blockedToolResult(payload: ToolErrorPayload): ToolCallResult {
    const { content, isError } = buildToolError(payload);
    return { content: content as ToolCallResult["content"], isError: Boolean(isError) };
}
