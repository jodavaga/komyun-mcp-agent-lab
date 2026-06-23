import "dotenv/config";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerGetApartmentBalance } from "./tools/getApartmentBalance";
import { registerSearchApartmentsInMora } from "./tools/searchApartmentsInMora";

const server = new McpServer({
  name: "komyun-mcp-server",
  version: "1.0.0",
});

registerGetApartmentBalance(server);
registerSearchApartmentsInMora(server);

await server.connect(new StdioServerTransport());

