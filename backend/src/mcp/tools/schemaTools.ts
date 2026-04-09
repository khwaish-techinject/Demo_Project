import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { databaseSchema, getDatabaseSchemaText } from "../schema";

export function registerSchemaTools(server: McpServer) {
  server.registerResource(
    "database-schema",
    "app://database/schema",
    {
      title: "Database Schema",
      description: "Schema metadata for the Bun + Drizzle + PostgreSQL ERP and chat database.",
      mimeType: "application/json",
    },
    async () => ({
      contents: [
        {
          uri: "app://database/schema",
          mimeType: "application/json",
          text: getDatabaseSchemaText(),
        },
      ],
    })
  );

  server.registerTool(
    "get_database_schema",
    {
      description:
        "Retrieve the complete database schema including ERP tables, chat tables, columns, and relationships so the AI can understand the database structure before querying data.",
      outputSchema: {
        database: z.string(),
        orm: z.string(),
        tables: z.array(
          z.object({
            name: z.string(),
            description: z.string(),
            primaryKey: z.string(),
            columns: z.array(
              z.object({
                name: z.string(),
                type: z.string(),
                required: z.boolean(),
                generated: z.boolean().optional(),
                unique: z.boolean().optional(),
                default: z.string().optional(),
                references: z.string().optional(),
                onDelete: z.string().optional(),
              })
            ),
          })
        ),
        relationships: z.array(
          z.object({
            from: z.string(),
            to: z.string(),
            kind: z.string(),
          })
        ),
      },
    },
    async () => ({
      content: [
        {
          type: "text",
          text: getDatabaseSchemaText(),
        },
      ],
      structuredContent: databaseSchema,
    })
  );
}
