import { resolve } from "node:path";
import { runChatRepl } from "./chat";
import { McpClient } from "./mcpClient";

const mcpClient = new McpClient();

await mcpClient.connect({
    id: "komyun",
    command: process.execPath,
    args: ["--import", "tsx", resolve(import.meta.dirname, "./mcp-servers/komyun/index.ts")],
});

for (const { serverId, toolNames } of mcpClient.listConnectedTools()) {
    console.log(`Connected to "${serverId}": [${toolNames.join(", ")}]`);
}

try {
    await runChatRepl(mcpClient);
} finally {
    await mcpClient.closeAll();
}
