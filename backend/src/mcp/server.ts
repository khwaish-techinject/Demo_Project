import "dotenv/config";

import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { db, ensureDatabaseSchema, pool } from "../db/db";
import { attachments, chats, messages, users } from "../db/schema";
import { databaseSchema, getDatabaseSchemaText } from "./schema";

const server = new McpServer(
  {
    name: "chat-db-mcp-server",
    version: "1.0.0",
  },
  {
    instructions:
      "Use the provided resources and tools to inspect the chat database schema and read or write chat data without connecting to PostgreSQL directly.",
  }
);

function toIsoString(value: Date) {
  return value.toISOString();
}

function formatUser(row: typeof users.$inferSelect) {
  return {
    id: row.id,
    name: row.name,
    createdAt: toIsoString(row.createdAt),
  };
}

function formatChat(row: typeof chats.$inferSelect) {
  return {
    id: row.id,
    createdBy: row.createdBy,
    title: row.title,
    createdAt: toIsoString(row.createdAt),
    updatedAt: toIsoString(row.updatedAt),
  };
}

function formatMessage(row: typeof messages.$inferSelect) {
  return {
    id: row.id,
    chatId: row.chatId,
    userId: row.userId,
    content: row.content,
    createdAt: toIsoString(row.createdAt),
  };
}

function formatAttachment(row: typeof attachments.$inferSelect) {
  return {
    id: row.id,
    messageId: row.messageId,
    name: row.name,
    url: row.url,
    type: row.type,
    size: row.size,
    createdAt: toIsoString(row.createdAt),
  };
}

function asToolText(value: unknown) {
  return JSON.stringify(value, null, 2);
}

server.registerResource(
  "database-schema",
  "app://database/schema",
  {
    title: "Database Schema",
    description: "Schema metadata for the Bun + Drizzle + PostgreSQL chat database.",
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
      "Return the full application database schema so the AI layer can understand the available tables, columns, and relationships.",
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

server.registerTool(
  "list_users",
  {
    description: "List users from the application database.",
    inputSchema: {
      name: z.string().trim().optional().describe("Optional exact user name filter."),
      limit: z.number().int().min(1).max(100).default(20),
    },
    outputSchema: {
      users: z.array(
        z.object({
          id: z.string(),
          name: z.string(),
          createdAt: z.string(),
        })
      ),
    },
  },
  async ({ name, limit }) => {
    const rows = name
      ? await db
          .select()
          .from(users)
          .where(eq(users.name, name))
          .orderBy(asc(users.createdAt))
          .limit(limit)
      : await db.select().from(users).orderBy(asc(users.createdAt)).limit(limit);

    const result = { users: rows.map(formatUser) };

    return {
      content: [{ type: "text", text: asToolText(result) }],
      structuredContent: result,
    };
  }
);

server.registerTool(
  "list_chats",
  {
    description: "List chats, optionally filtered by creator.",
    inputSchema: {
      createdBy: z.string().uuid().optional().describe("Optional user id filter."),
      limit: z.number().int().min(1).max(100).default(20),
    },
    outputSchema: {
      chats: z.array(
        z.object({
          id: z.string(),
          createdBy: z.string(),
          title: z.string(),
          createdAt: z.string(),
          updatedAt: z.string(),
        })
      ),
    },
  },
  async ({ createdBy, limit }) => {
    const rows = createdBy
      ? await db
          .select()
          .from(chats)
          .where(eq(chats.createdBy, createdBy))
          .orderBy(desc(chats.updatedAt))
          .limit(limit)
      : await db.select().from(chats).orderBy(desc(chats.updatedAt)).limit(limit);

    const result = { chats: rows.map(formatChat) };

    return {
      content: [{ type: "text", text: asToolText(result) }],
      structuredContent: result,
    };
  }
);

server.registerTool(
  "list_messages",
  {
    description: "List messages for a chat or the latest messages globally.",
    inputSchema: {
      chatId: z.string().uuid().optional().describe("Optional chat id filter."),
      limit: z.number().int().min(1).max(100).default(50),
    },
    outputSchema: {
      messages: z.array(
        z.object({
          id: z.string(),
          chatId: z.string(),
          userId: z.string(),
          content: z.string(),
          createdAt: z.string(),
        })
      ),
    },
  },
  async ({ chatId, limit }) => {
    const rows = chatId
      ? await db
          .select()
          .from(messages)
          .where(eq(messages.chatId, chatId))
          .orderBy(asc(messages.createdAt))
          .limit(limit)
      : await db
          .select()
          .from(messages)
          .orderBy(desc(messages.createdAt))
          .limit(limit);

    const result = { messages: rows.map(formatMessage) };

    return {
      content: [{ type: "text", text: asToolText(result) }],
      structuredContent: result,
    };
  }
);

server.registerTool(
  "get_chat_bundle",
  {
    description:
      "Fetch a full chat bundle including the chat, its messages, and any attachments linked to those messages.",
    inputSchema: {
      chatId: z.string().uuid().describe("The chat id to fetch."),
    },
    outputSchema: {
      chat: z
        .object({
          id: z.string(),
          createdBy: z.string(),
          title: z.string(),
          createdAt: z.string(),
          updatedAt: z.string(),
        })
        .nullable(),
      messages: z.array(
        z.object({
          id: z.string(),
          chatId: z.string(),
          userId: z.string(),
          content: z.string(),
          createdAt: z.string(),
        })
      ),
      attachments: z.array(
        z.object({
          id: z.string(),
          messageId: z.string(),
          name: z.string(),
          url: z.string(),
          type: z.string(),
          size: z.number(),
          createdAt: z.string(),
        })
      ),
    },
  },
  async ({ chatId }) => {
    const [chat] = await db.select().from(chats).where(eq(chats.id, chatId));

    const messageRows = await db
      .select()
      .from(messages)
      .where(eq(messages.chatId, chatId))
      .orderBy(asc(messages.createdAt));

    const messageIds = messageRows.map((message) => message.id);

    const attachmentRows = messageIds.length
      ? await db
          .select()
          .from(attachments)
          .where(inArray(attachments.messageId, messageIds))
          .orderBy(asc(attachments.createdAt))
      : [];

    const result = {
      chat: chat ? formatChat(chat) : null,
      messages: messageRows.map(formatMessage),
      attachments: attachmentRows.map(formatAttachment),
    };

    return {
      content: [{ type: "text", text: asToolText(result) }],
      structuredContent: result,
    };
  }
);

server.registerTool(
  "create_user",
  {
    description: "Create a new user record.",
    inputSchema: {
      name: z.string().trim().min(1).describe("Unique user name."),
    },
    outputSchema: {
      user: z.object({
        id: z.string(),
        name: z.string(),
        createdAt: z.string(),
      }),
    },
  },
  async ({ name }) => {
    const existing = await db.select().from(users).where(eq(users.name, name)).limit(1);

    if (existing[0]) {
      throw new Error(`User with name "${name}" already exists.`);
    }

    const [user] = await db.insert(users).values({ name }).returning();
    const result = { user: formatUser(user) };

    return {
      content: [{ type: "text", text: asToolText(result) }],
      structuredContent: result,
    };
  }
);

server.registerTool(
  "create_chat",
  {
    description: "Create a new chat for a user.",
    inputSchema: {
      createdBy: z.string().uuid().describe("The user id that owns the chat."),
      title: z.string().trim().min(1).max(255).default("New Chat"),
    },
    outputSchema: {
      chat: z.object({
        id: z.string(),
        createdBy: z.string(),
        title: z.string(),
        createdAt: z.string(),
        updatedAt: z.string(),
      }),
    },
  },
  async ({ createdBy, title }) => {
    const [owner] = await db.select().from(users).where(eq(users.id, createdBy)).limit(1);

    if (!owner) {
      throw new Error("createdBy user was not found.");
    }

    const [chat] = await db
      .insert(chats)
      .values({
        createdBy,
        title,
      })
      .returning();

    const result = { chat: formatChat(chat) };

    return {
      content: [{ type: "text", text: asToolText(result) }],
      structuredContent: result,
    };
  }
);

server.registerTool(
  "create_message",
  {
    description: "Create a message inside a chat and update the chat timestamp.",
    inputSchema: {
      chatId: z.string().uuid().describe("Target chat id."),
      userId: z.string().uuid().describe("Author user id."),
      content: z.string().trim().min(1).describe("Message body."),
    },
    outputSchema: {
      message: z.object({
        id: z.string(),
        chatId: z.string(),
        userId: z.string(),
        content: z.string(),
        createdAt: z.string(),
      }),
    },
  },
  async ({ chatId, userId, content }) => {
    const [chat] = await db.select().from(chats).where(eq(chats.id, chatId)).limit(1);
    if (!chat) {
      throw new Error("chatId was not found.");
    }

    const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!user) {
      throw new Error("userId was not found.");
    }

    const [message] = await db
      .insert(messages)
      .values({
        chatId,
        userId,
        content,
      })
      .returning();

    await db
      .update(chats)
      .set({
        updatedAt: new Date(),
      })
      .where(and(eq(chats.id, chatId), eq(chats.createdBy, chat.createdBy)));

    const result = { message: formatMessage(message) };

    return {
      content: [{ type: "text", text: asToolText(result) }],
      structuredContent: result,
    };
  }
);

async function main() {
  await ensureDatabaseSchema();

  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error("Chat DB MCP server is running on stdio.");
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
