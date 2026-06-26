import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { Tool as McpTool } from "@modelcontextprotocol/sdk/types.js";
import type { Tool as AnthropicTool, ToolResultBlockParam } from "@anthropic-ai/sdk/resources/messages";

export type McpServerConfig = {
    id: string;
    command: string;
    args: string[];
    env?: Record<string, string>;
};

type Connection = {
    client: Client;
    tools: Awaited<ReturnType<Client["listTools"]>>["tools"];
};

function mcpToolToAnthropicTool(tool: McpTool): AnthropicTool {
    return {
        name: tool.name,
        description: tool.description,
        input_schema: tool.inputSchema,
    };
}

export class McpClient {
    private connections = new Map<string, Connection>();
    private toolIndex = new Map<string, string>();

    async connect(config: McpServerConfig): Promise<void> {
        const transport = new StdioClientTransport({
            command: config.command,
            args: config.args,
            env: config.env,
        });

        const client = new Client({ name: "komyun-mcp-agent-lab-host", version: "1.0.0" });
        await client.connect(transport);

        const { tools } = await client.listTools();

        for (const tool of tools) {
            if (this.toolIndex.has(tool.name)) {
                throw new Error(
                    `Duplicate tool name "${tool.name}": already registered by server "${this.toolIndex.get(tool.name)}", now also offered by "${config.id}"`
                );
            }
            this.toolIndex.set(tool.name, config.id);
        }

        this.connections.set(config.id, { client, tools });
    }

    getAnthropicTools(): AnthropicTool[] {
        return [...this.connections.values()].flatMap((connection) => connection.tools.map(mcpToolToAnthropicTool));
    }

    async callTool(name: string, input: unknown): Promise<{ content: ToolResultBlockParam["content"]; isError: boolean }> {
        const serverId = this.toolIndex.get(name);
        if (!serverId) {
            throw new Error(`No connected MCP server provides a tool named "${name}"`);
        }

        const connection = this.connections.get(serverId)!;
        const result = (await connection.client.callTool({ name, arguments: input as Record<string, unknown> })) as {
            content: Array<{ type: string; text?: string }>;
            isError?: boolean;
        };

        const textBlocks = result.content
            .filter((block): block is { type: "text"; text: string } => block.type === "text")
            .map((block) => ({ type: "text" as const, text: block.text }));

        const content = textBlocks.length > 0 ? textBlocks : [{ type: "text" as const, text: "(tool returned no text content)" }];
        return { content, isError: result.isError ?? false };
    }

    listConnectedTools(): Array<{ serverId: string; toolNames: string[] }> {
        return [...this.connections.entries()].map(([serverId, connection]) => ({
            serverId,
            toolNames: connection.tools.map((tool) => tool.name),
        }));
    }

    async closeAll(): Promise<void> {
        await Promise.all([...this.connections.values()].map((connection) => connection.client.close()));
        this.connections.clear();
        this.toolIndex.clear();
    }
}
