import type { ServerWebSocket } from "bun";

import { createAttachmentsForMessage } from "./controller/attachmentController";
import { ensureChat, touchChat } from "./controller/chatController";
import { createMessageRecord } from "./controller/messageController";
import { findOrCreateUser } from "./controller/userController";
import { ensureDatabaseSchema } from "./db/db";
import { handleApiRoutes } from "./routes";
import { generateAssistantReply } from "./services/databaseAssistant";

type WsAttachmentInput = {
  name: string;
  url: string;
  type: string;
  size: number;
};

type IncomingChatPayload = {
  type?: string;
  userId?: string;
  userName?: string;
  chatId?: string;
  title?: string;
  message?: string;
  content?: string;
  attachments?: WsAttachmentInput[];
};

type ChatEvent =
  | {
      type: "connection_status";
      status: "connected";
      message: string;
    }
  | {
      type: "chat_context";
      chatId: string;
      userId: string;
      title: string;
    }
  | {
      type: "chat_message";
      role: "assistant" | "user";
      chatId: string;
      messageId: string;
      userId: string;
      content: string;
      attachments: WsAttachmentInput[];
      timestamp: string;
    }
  | {
      type: "error";
      message: string;
      timestamp: string;
    };

const ASSISTANT_USER_NAME = "DataPilot AI";

function sendEvent(ws: ServerWebSocket<unknown>, event: ChatEvent) {
  ws.send(JSON.stringify(event));
}

function now() {
  return new Date().toISOString();
}

function parseIncomingMessage(rawMessage: string): IncomingChatPayload {
  try {
    const parsed = JSON.parse(rawMessage) as IncomingChatPayload;
    return parsed;
  } catch {
    return {
      type: "chat_message",
      userName: "Guest",
      content: rawMessage,
      attachments: [],
    };
  }
}

async function handleWebSocketMessage(
  ws: ServerWebSocket<unknown>,
  rawMessage: string
) {
  const payload = parseIncomingMessage(rawMessage);
  const content = payload.content?.trim() || payload.message?.trim();

  if (!content) {
    sendEvent(ws, {
      type: "error",
      message: "content or message is required.",
      timestamp: now(),
    });
    return;
  }

  const user = await findOrCreateUser({
    id: payload.userId,
    name: payload.userName || "Guest",
  });

  const chat = await ensureChat({
    chatId: payload.chatId,
    createdBy: user.id,
    title: payload.title || content.slice(0, 60),
  });

  const userMessage = await createMessageRecord({
    chatId: chat.id,
    userId: user.id,
    content,
    role: "user",
  });

  const savedAttachments = await createAttachmentsForMessage(
    userMessage.id,
    payload.attachments
  );

  await touchChat(chat.id);

  sendEvent(ws, {
    type: "chat_context",
    chatId: chat.id,
    userId: user.id,
    title: chat.title,
  });

  sendEvent(ws, {
    type: "chat_message",
    role: "user",
    chatId: chat.id,
    messageId: userMessage.id,
    userId: user.id,
    content: userMessage.content,
    attachments: savedAttachments.map((file) => ({
      name: file.name,
      url: file.url,
      type: file.type,
      size: file.size,
    })),
    timestamp: userMessage.createdAt.toISOString(),
  });

  const assistantUser = await findOrCreateUser({
    name: ASSISTANT_USER_NAME,
  });

  const assistantReply = await generateAssistantReply(content);

  const assistantMessage = await createMessageRecord({
    chatId: chat.id,
    userId: assistantUser.id,
    role: "assistant",
    content: assistantReply.content,
  });

  await touchChat(chat.id);

  sendEvent(ws, {
    type: "chat_message",
    role: "assistant",
    chatId: chat.id,
    messageId: assistantMessage.id,
    userId: assistantUser.id,
    content: assistantMessage.content,
    attachments: [],
    timestamp: assistantMessage.createdAt.toISOString(),
  });
}

await ensureDatabaseSchema();

const server = Bun.serve({
  hostname: "0.0.0.0",
  port: 3000,

  async fetch(req, server) {
    const url = new URL(req.url);
    const pathname = url.pathname;

    if (pathname === "/ws") {
      const success = server.upgrade(req);

      if (success) {
        return;
      }

      return new Response("WebSocket upgrade failed", { status: 400 });
    }

    return handleApiRoutes(req);
  },

  websocket: {
    open(ws) {
      console.log("Client connected");

      sendEvent(ws, {
        type: "connection_status",
        status: "connected",
        message: "Connected to DataPilot AI WebSocket server.",
      });
    },

    async message(ws, message) {
      try {
        const rawMessage = message.toString().trim();
        console.log("User:", rawMessage);
        await handleWebSocketMessage(ws, rawMessage);
      } catch (error) {
        console.error("WebSocket message error:", error);
        sendEvent(ws, {
          type: "error",
          message:
            error instanceof Error
              ? error.message
              : "Failed to process the message.",
          timestamp: now(),
        });
      }
    },

    close() {
      console.log("Client disconnected");
    },
  },
});

console.log(`Server running on http://localhost:${server.port}`);
