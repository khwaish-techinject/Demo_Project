import "dotenv/config";

import { and, asc, desc, eq, ilike, inArray } from "drizzle-orm";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { db, ensureDatabaseSchema, pool } from "../db/db";
import {
  attachments,
  chats,
  customers,
  messages,
  products,
  sales,
  users,
} from "../db/schema";
import { databaseSchema, getDatabaseSchemaText } from "./schema";

const server = new McpServer(
  {
    name: "datapilot-mcp-server",
    version: "1.0.0",
  },
  {
   instructions:
  "Use the provided resources and tools to inspect the database schema and answer questions about the data. Prefer schema-aware tools first, and use run_sql_query only for read-only SQL queries when necessary.",
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

function formatCustomer(row: typeof customers.$inferSelect) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    city: row.city,
  };
}

function formatProduct(row: typeof products.$inferSelect) {
  return {
    id: row.id,
    name: row.name,
    price: row.price,
  };
}

function formatSale(row: typeof sales.$inferSelect) {
  return {
    id: row.id,
    product: row.product,
    customerId: row.customerId,
    amount: row.amount,
    month: row.month,
  };
}

function asToolText(value: unknown) {
  return JSON.stringify(value, null, 2);
}

function isReadOnlyQuery(query: string) {
  const normalized = query.trim().toLowerCase();
  return normalized.startsWith("select") || normalized.startsWith("with");
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
  "run_sql_query",
  {
    description:
      "Execute a read-only SQL query on the PostgreSQL database to retrieve application data for reporting, analytics, and answering business questions. Only SELECT and WITH queries are allowed.",
    inputSchema: {
      query: z.string().min(1).describe("Read-only SQL query to execute."),
    },
    outputSchema: {
      rowCount: z.number(),
      rows: z.array(z.record(z.string(), z.unknown())),
      fields: z.array(
        z.object({
          name: z.string(),
          dataTypeId: z.number(),
        })
      ),
    },
  },
  async ({ query }) => {
    if (!isReadOnlyQuery(query)) {
      throw new Error("Only read-only SELECT or WITH queries are allowed.");
    }

    const result = await pool.query(query);
    const payload = {
      rowCount: result.rowCount ?? 0,
      rows: result.rows,
      fields: result.fields.map((field) => ({
        name: field.name,
        dataTypeId: field.dataTypeID,
      })),
    };

    return {
      content: [{ type: "text", text: asToolText(payload) }],
      structuredContent: payload,
    };
  }
);

server.registerTool(
  "list_customers",
  {
    description: "Retrieve customers from the database with optional filters like name or city for answering user questions and generating reports.",
    inputSchema: {
      name: z.string().trim().optional().describe("Optional partial customer name filter."),
      city: z.string().trim().optional().describe("Optional city filter."),
      limit: z.number().int().min(1).max(100).default(20),
    },
    outputSchema: {
      customers: z.array(
        z.object({
          id: z.number(),
          name: z.string(),
          email: z.string().nullable(),
          city: z.string().nullable(),
        })
      ),
    },
  },
  async ({ name, city, limit }) => {
    const filters = [];

    if (name) {
      filters.push(ilike(customers.name, `%${name}%`));
    }

    if (city) {
      filters.push(ilike(customers.city, `%${city}%`));
    }

    const rows =
      filters.length > 0
        ? await db
            .select()
            .from(customers)
            .where(filters.length === 1 ? filters[0] : and(...filters))
            .orderBy(asc(customers.name))
            .limit(limit)
        : await db.select().from(customers).orderBy(asc(customers.name)).limit(limit);

    const result = { customers: rows.map(formatCustomer) };

    return {
      content: [{ type: "text", text: asToolText(result) }],
      structuredContent: result,
    };
  }
);

server.registerTool(
  "list_products",
  {
    description: "Retrieve products from the database with optional name filtering for product lookups and pricing questions.",
    inputSchema: {
      name: z.string().trim().optional().describe("Optional partial product name filter."),
      limit: z.number().int().min(1).max(100).default(20),
    },
    outputSchema: {
      products: z.array(
        z.object({
          id: z.number(),
          name: z.string(),
          price: z.number(),
        })
      ),
    },
  },
  async ({ name, limit }) => {
    const rows = name
      ? await db
          .select()
          .from(products)
          .where(ilike(products.name, `%${name}%`))
          .orderBy(asc(products.name))
          .limit(limit)
      : await db.select().from(products).orderBy(asc(products.name)).limit(limit);

    const result = {
      products: rows.map((row) => ({
        ...formatProduct(row),
        price: Number(row.price),
      })),
    };

    return {
      content: [{ type: "text", text: asToolText(result) }],
      structuredContent: result,
    };
  }
);

server.registerTool(
  "list_sales",
  {
    description: "Retrieve sales records from the database with optional filters such as month, customer, or product for reporting, analysis, and summaries.",
    inputSchema: {
      month: z.string().trim().optional().describe("Optional month filter such as March."),
      customerId: z.number().int().optional().describe("Optional customer id filter."),
      product: z.string().trim().optional().describe("Optional product name filter."),
      limit: z.number().int().min(1).max(100).default(50),
    },
    outputSchema: {
      sales: z.array(
        z.object({
          id: z.number(),
          product: z.string(),
          customerId: z.number(),
          amount: z.number(),
          month: z.string(),
        })
      ),
    },
  },
  async ({ month, customerId, product, limit }) => {
    const filters = [];

    if (month) {
      filters.push(ilike(sales.month, `%${month}%`));
    }

    if (customerId !== undefined) {
      filters.push(eq(sales.customerId, customerId));
    }

    if (product) {
      filters.push(ilike(sales.product, `%${product}%`));
    }

    const rows =
      filters.length > 0
        ? await db
            .select()
            .from(sales)
            .where(filters.length === 1 ? filters[0] : and(...filters))
            .orderBy(desc(sales.id))
            .limit(limit)
        : await db.select().from(sales).orderBy(desc(sales.id)).limit(limit);

    const result = { sales: rows.map(formatSale) };

    return {
      content: [{ type: "text", text: asToolText(result) }],
      structuredContent: result,
    };
  }
);

server.registerTool(
  "get_database_schema",
  {
    description:
    "Retrieve the complete database schema including tables, columns, and relationships so the AI can understand the database structure before querying data.",
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
    description: "Retrieve user records from the database with optional name filtering.",
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
    description: "Retrieve chats from the database with an optional filter by the user who created the chat.",
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
    description: "Retrieve messages from the database for a specific chat using chatId, or return the most recent messages across all chats.",
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
  "Retrieve the complete data for a chat including the chat details, its messages, and any attachments linked to those messages.",
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
    description: "Create a new user in the database using a unique user name.",
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
    description: "Create a new chat in the database for a specific user using the user's ID and an optional chat title.",
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
    description: "Create a new message in a chat using the chat ID and user ID, store the message content, and update the chat's last activity time.",
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
