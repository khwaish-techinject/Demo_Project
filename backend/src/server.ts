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

type WsData = {
  connectionId: string;
  connectedAt: string;
  ip?: string;
  userAgent?: string;
};

type IncomingChatPayload = {
  type?: string;
  userId?: string;
  user_id?: string;
  userName?: string;
  user_name?: string;
  chatId?: string;
  chat_id?: string;
  title?: string;
  message?: string;
  content?: string;
  text?: string;
  prompt?: string;
  attachments?: WsAttachmentInput[];
  data?: Partial<IncomingChatPayload>;
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
      message: string;
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

function getWsMeta(ws: ServerWebSocket<unknown>) {
  const data = ws.data as Partial<WsData> | undefined;

  return {
    connectionId: data?.connectionId ?? "unknown",
    connectedAt: data?.connectedAt ?? "unknown",
    ip: data?.ip ?? "unknown",
    userAgent: data?.userAgent ?? "unknown",
  };
}

function normalizeOptionalText(value: unknown) {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim();

  if (!normalized || normalized === "undefined" || normalized === "null") {
    return undefined;
  }

  return normalized;
}

function normalizeOptionalUuid(value: unknown) {
  const normalized = normalizeOptionalText(value);

  if (!normalized) {
    return undefined;
  }

  const uuidPattern =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  return uuidPattern.test(normalized) ? normalized : undefined;
}

function firstDefinedText(...values: unknown[]) {
  for (const value of values) {
    const normalized = normalizeOptionalText(value);

    if (normalized) {
      return normalized;
    }
  }

  return undefined;
}

function normalizeAttachments(value: unknown): WsAttachmentInput[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => {
      const file = item as Partial<WsAttachmentInput>;
      const name = normalizeOptionalText(file.name);
      const url = normalizeOptionalText(file.url);
      const type = normalizeOptionalText(file.type);
      const size = Number(file.size);

      if (!name || !url || !type || !Number.isFinite(size)) {
        return undefined;
      }

      return { name, url, type, size };
    })
    .filter((file): file is WsAttachmentInput => Boolean(file));
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
  const content = firstDefinedText(
    payload.content,
    payload.message,
    payload.text,
    payload.prompt,
    payload.data?.content,
    payload.data?.message,
    payload.data?.text,
    payload.data?.prompt
  );

  if (!content) {
    sendEvent(ws, {
      type: "error",
      message: "content or message is required.",
      timestamp: now(),
    });
    return;
  }

  const userId = normalizeOptionalUuid(
    payload.userId ?? payload.user_id ?? payload.data?.userId ?? payload.data?.user_id
  );
  const userName =
    firstDefinedText(
      payload.userName,
      payload.user_name,
      payload.data?.userName,
      payload.data?.user_name
    ) || "Guest";
  const chatId = normalizeOptionalUuid(
    payload.chatId ?? payload.chat_id ?? payload.data?.chatId ?? payload.data?.chat_id
  );
  const title =
    firstDefinedText(payload.title, payload.data?.title) || content.slice(0, 60);
  const normalizedAttachments = normalizeAttachments(
    payload.attachments ?? payload.data?.attachments
  );

  const user = await findOrCreateUser({
    id: userId,
    name: userName,
  });

  const chat = await ensureChat({
    chatId,
    createdBy: user.id,
    title,
  });

  const userMessage = await createMessageRecord({
    chatId: chat.id,
    userId: user.id,
    content,
  });

  await createAttachmentsForMessage(userMessage.id, normalizedAttachments);

  await touchChat(chat.id);

  sendEvent(ws, {
    type: "chat_message",
    role: "user",
    chatId: chat.id,
    messageId: userMessage.id,
    userId: user.id,
    message: userMessage.content,
    content: userMessage.content,
    attachments: normalizedAttachments,
    timestamp: userMessage.createdAt.toISOString(),
  });

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
    message: assistantMessage.content,
    content: assistantMessage.content,
    attachments: [],
    timestamp: assistantMessage.createdAt.toISOString(),
  });
}

await ensureDatabaseSchema();

const server = Bun.serve<WsData>({
  hostname: "0.0.0.0",
  port: Number(process.env.PORT) || 3000,

  async fetch(req, server) {
    const url = new URL(req.url);
    const pathname = url.pathname;

    if (pathname === "/ws") {
      const forwardedFor = req.headers.get("x-forwarded-for");
      const ip = forwardedFor?.split(",")[0]?.trim() || undefined;
      const userAgent = req.headers.get("user-agent") || undefined;

      const success = server.upgrade(req, {
        data: {
          connectionId: crypto.randomUUID(),
          connectedAt: now(),
          ip,
          userAgent,
        } satisfies WsData,
      });

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
      const meta = getWsMeta(ws);
      console.log(
        `[WS OPEN] id=${meta.connectionId} ip=${meta.ip} connectedAt=${meta.connectedAt}`
      );

      sendEvent(ws, {
        type: "connection_status",
        status: "connected",
        message: "Connected to DataPilot AI WebSocket server.",
      });
    },

    async message(ws, message) {
      try {
        const rawMessage = message.toString().trim();
        const meta = getWsMeta(ws);
        console.log(
          `[WS MESSAGE] id=${meta.connectionId} size=${rawMessage.length} payload=${rawMessage}`
        );
        await handleWebSocketMessage(ws, rawMessage);
      } 
      catch (error) {
        const meta = getWsMeta(ws);
        console.error(
          `[WS ERROR] id=${meta.connectionId} message handling failed:`,
          error
        );
        sendEvent(ws, {
          type: "error",
          message: "Failed to process the message.",
          timestamp: now(),
        });
      }
    },

    close(ws, code, reason) {
      const meta = getWsMeta(ws);
      const normalizedReason =
        typeof reason === "string" && reason.length ? reason : "no reason provided";
      console.log(
        `[WS CLOSE] id=${meta.connectionId} code=${code} reason=${normalizedReason}`
      );
    },
  },
});

//console.log(`Server running on http://localhost:${server.port}/`);
console.log(`Server running on http://localhost:${server.port}`);
