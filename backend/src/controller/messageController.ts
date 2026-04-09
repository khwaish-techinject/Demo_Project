import { asc, desc, eq } from "drizzle-orm";

import { db } from "../db/db";
import { messages } from "../db/schema";

function badRequest(message: string) {
  return Response.json({ error: message }, { status: 400 });
}

function normalizeOptionalQueryValue(value: string | null) {
  const normalized = value?.trim();

  if (!normalized || normalized === "undefined" || normalized === "null") {
    return undefined;
  }

  return normalized;
}

export async function listMessages(req: Request) {
  const url = new URL(req.url);
  const chatId = normalizeOptionalQueryValue(url.searchParams.get("chatId"));

  const rows = chatId
    ? await db
        .select()
        .from(messages)
        .where(eq(messages.chatId, chatId))
        .orderBy(asc(messages.createdAt))
    : await db.select().from(messages).orderBy(desc(messages.createdAt));

  return Response.json(rows);
}

export async function getMessageById(messageId: string) {
  const [message] = await db
    .select()
    .from(messages)
    .where(eq(messages.id, messageId));

  if (!message) {
    return Response.json({ error: "Message not found." }, { status: 404 });
  }

  return Response.json(message);
}

export async function createMessage(req: Request) {
  const body = await req.json();
  const chatId = body.chatId ?? body.chat_id ?? body.chat;
  const userId = body.userId ?? body.user_id ?? body.user;
  const content = body.content;

  if (!chatId || !userId || !content) {
    return badRequest("chatId, userId and content are required.");
  }

  const [message] = await db
    .insert(messages)
    .values({
      chatId,
      userId,
      content,
    })
    .returning();

  return Response.json(message, { status: 201 });
}

export async function updateMessage(messageId: string, req: Request) {
  const body = await req.json();
  const content = body.content;

  if (!content) {
    return badRequest("content is required.");
  }

  const [message] = await db
    .update(messages)
    .set({ content })
    .where(eq(messages.id, messageId))
    .returning();

  if (!message) {
    return Response.json({ error: "Message not found." }, { status: 404 });
  }

  return Response.json(message);
}

export async function deleteMessage(messageId: string) {
  const [message] = await db
    .delete(messages)
    .where(eq(messages.id, messageId))
    .returning();

  if (!message) {
    return Response.json({ error: "Message not found." }, { status: 404 });
  }

  return Response.json({ success: true, message });
}

export async function createMessageRecord(params: {
  chatId: string;
  userId: string;
  content: string;
}) {
  const [message] = await db
    .insert(messages)
    .values({
      chatId: params.chatId,
      userId: params.userId,
      content: params.content,
    })
    .returning();

  return message;
}
