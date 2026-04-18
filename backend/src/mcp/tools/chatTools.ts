import { and, asc, desc, eq, inArray } from "drizzle-orm";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { db } from "../../db/db";
import { attachments, chats, messages, users } from "../../db/schema";
import {
  asToolText,
  formatAttachment,
  formatChat,
  formatMessage,
  formatUser,
} from "../shared";

export function registerChatTools(server: McpServer) {
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
      description:
        "Retrieve chats from the database with an optional filter by the user who created the chat.",
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
      description:
        "Retrieve messages from the database for a specific chat using chatId, or return the most recent messages across all chats.",
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
      description:
        "Create a new chat in the database for a specific user using the user's ID and an optional chat title.",
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
      description:
        "Create a new message in a chat using the chat ID and user ID, store the message content, and update the chat's last activity time.",
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
}