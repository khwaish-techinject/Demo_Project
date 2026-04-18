import "dotenv/config";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { ensureDatabaseSchema, pool } from "../db/db";
import { registerChatTools } from "./tools/chatTools";
import { registerErpTools } from "./tools/businessTools";
import { registerSchemaTools } from "./tools/schemaTools";

const server = new McpServer(
  {
    name: "datapilot-mcp-server",
    version: "1.0.0",
  },
  {
    instructions:
      "Use the provided resources and tools to inspect the ERP database schema and answer business questions. Prefer ERP tools like list_customers, list_products, and list_sales first. Use run_sql_query only for a single read-only query against ERP tables when necessary. Chat tools are available separately for conversation history lookups.",
  }
);

registerSchemaTools(server);
registerErpTools(server);
registerChatTools(server);

async function main() {
  await ensureDatabaseSchema();

  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error("DataPilot MCP server is running on stdio.");
}

main()
  .catch(async (error) => {
    console.error("Failed to start MCP server:", error);
    await pool.end().catch(() => undefined);
    process.exit(1);
  })
  .finally(async () => {
    const close = async () => {
      await pool.end().catch(() => undefined);
      process.exit(0);
    };

    process.once("SIGINT", () => {
      void close();
    });

    process.once("SIGTERM", () => {
      void close();
    });
  });