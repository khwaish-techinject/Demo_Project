import type { ServerWebSocket } from "bun";

import {
  createAttachment,
  createAttachmentsForMessage,
  deleteAttachment,
  getAttachmentById,
  listAttachments,
  updateAttachment,
} from "./controller/attachmentController";
import {
  createChat,
  deleteChat,
  ensureChat,
  getChatById,
  listChats,
  touchChat,
  updateChat,
} from "./controller/chatController";
import {
  createMessage,
  createMessageRecord,
  deleteMessage,
  getMessageById,
  listMessages,
  updateMessage,
} from "./controller/messageController";
import {
  createUser,
  deleteUser,
  findOrCreateUser,
  getUserById,
  listUsers,
  updateUser,
} from "./controller/userController";
import { ensureDatabaseSchema } from "./db/db";

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

function buildAssistantReply() {
  return "hello khwaish";
}

function jsonResponse(data: unknown, init?: ResponseInit) {
  return Response.json(data, init);
}

function getIdFromPath(pathname: string) {
  return pathname.split("/").at(-1) ?? "";
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
  });

  await createAttachmentsForMessage(userMessage.id, payload.attachments);

  await touchChat(chat.id);

  sendEvent(ws, {
    type: "chat_context",
    chatId: chat.id,
    userId: user.id,
    title: chat.title,
  });

  const assistantUser = await findOrCreateUser({
    name: ASSISTANT_USER_NAME,
  });

  const assistantMessage = await createMessageRecord({
    chatId: chat.id,
    userId: assistantUser.id,
    content: buildAssistantReply(),
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

    if (req.method === "GET" && pathname === "/") {
      return jsonResponse({
        ok: true,
        message: "WebSocket and CRUD API are running.",
        websocket: "/ws",
      });
    }

    if (req.method === "GET" && pathname === "/health") {
      return jsonResponse({
        ok: true,
        websocket: "/ws",
      });
    }

    if (req.method === "GET" && pathname === "/api/users") {
      return listUsers();
    }

    if (req.method === "POST" && pathname === "/api/users") {
      return createUser(req);
    }

    if (pathname.startsWith("/api/users/")) {
      const userId = getIdFromPath(pathname);

      if (req.method === "GET") {
        return getUserById(userId);
      }

      if (req.method === "PATCH" || req.method === "PUT") {
        return updateUser(userId, req);
      }

      if (req.method === "DELETE") {
        return deleteUser(userId);
      }
    }

    if (req.method === "GET" && pathname === "/api/chats") {
      return listChats(req);
    }

    if (req.method === "POST" && pathname === "/api/chats") {
      return createChat(req);
    }

    if (pathname.startsWith("/api/chats/")) {
      const chatId = getIdFromPath(pathname);

      if (req.method === "GET") {
        return getChatById(chatId);
      }

      if (req.method === "PATCH" || req.method === "PUT") {
        return updateChat(chatId, req);
      }

      if (req.method === "DELETE") {
        return deleteChat(chatId);
      }
    }

    if (req.method === "GET" && pathname === "/api/messages") {
      return listMessages(req);
    }

    if (req.method === "POST" && pathname === "/api/messages") {
      return createMessage(req);
    }

    if (pathname.startsWith("/api/messages/")) {
      const messageId = getIdFromPath(pathname);

      if (req.method === "GET") {
        return getMessageById(messageId);
      }

      if (req.method === "PATCH" || req.method === "PUT") {
        return updateMessage(messageId, req);
      }

      if (req.method === "DELETE") {
        return deleteMessage(messageId);
      }
    }

    if (req.method === "GET" && pathname === "/api/attachments") {
      return listAttachments(req);
    }

    if (req.method === "POST" && pathname === "/api/attachments") {
      return createAttachment(req);
    }

    if (pathname.startsWith("/api/attachments/")) {
      const attachmentId = getIdFromPath(pathname);

      if (req.method === "GET") {
        return getAttachmentById(attachmentId);
      }

      if (req.method === "PATCH" || req.method === "PUT") {
        return updateAttachment(attachmentId, req);
      }

      if (req.method === "DELETE") {
        return deleteAttachment(attachmentId);
      }
    }

    return jsonResponse({ error: "Not Found" }, { status: 404 });
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
          message: "Failed to process the message.",
          timestamp: now(),
        });
      }
    },

    close() {
      console.log("Client disconnected");
    },
  },
});

console.log(`Server running on http://localhost:${server.port}/`);
