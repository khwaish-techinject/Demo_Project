import { and, desc, eq } from "drizzle-orm";

import { db } from "../db/db";
import { chats } from "../db/schema";

function badRequest(message: string) {
  return Response.json({ error: message }, { status: 400 });
}

function normalizeOptionalText(value?: string | null) {
  const normalized = value?.trim();

  if (!normalized || normalized === "undefined" || normalized === "null") {
    return;
  }

  return normalized;
}

function normalizeOptionalUuid(value?: string | null) {
  const normalized = normalizeOptionalText(value);

  if (!normalized) {
    return;
  }

  const uuidPattern =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  if (uuidPattern.test(normalized)) {
    return normalized;
  }

  return;
}

export async function listChats(req: Request) {
  const url = new URL(req.url);
  const createdBy = url.searchParams.get("createdBy");

  const rows = createdBy
    ? await db
        .select()
        .from(chats)
        .where(eq(chats.createdBy, createdBy))
        .orderBy(desc(chats.updatedAt))
    : await db.select().from(chats).orderBy(desc(chats.updatedAt));

  return Response.json(rows);
}

export async function getChatById(chatId: string) {
  const [chat] = await db.select().from(chats).where(eq(chats.id, chatId));

  if (!chat) {
    return Response.json({ error: "Chat not found." }, { status: 404 });
  }

  return Response.json(chat);
}

export async function createChat(req: Request) {
  const body = await req.json();
  const createdBy = body.createdBy ?? body.created_by;
  const title = body.title ?? "New Chat";

  if (!createdBy) {
    return badRequest("createdBy is required.");
  }

  const [chat] = await db
    .insert(chats)
    .values({
      createdBy,
      title,
    })
    .returning();

  return Response.json(chat, { status: 201 });
}

export async function updateChat(chatId: string, req: Request) {
  const body = await req.json();
  const nextTitle = body.title;

  if (!nextTitle) {
    return badRequest("title is required.");
  }

  const [chat] = await db
    .update(chats)
    .set({
      title: nextTitle,
      updatedAt: new Date(),
    })
    .where(eq(chats.id, chatId))
    .returning();

  if (!chat) {
    return Response.json({ error: "Chat not found." }, { status: 404 });
  }

  return Response.json(chat);
}

async function resolveCreatedByForDelete(req: Request) {
  const url = new URL(req.url);
  const createdByFromQuery = normalizeOptionalUuid(url.searchParams.get("createdBy"));

  if (createdByFromQuery) {
    return createdByFromQuery;
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return;
  }

  if (!body || typeof body !== "object") {
    return;
  }

  const payload = body as { createdBy?: string; created_by?: string };
  return normalizeOptionalUuid(payload.createdBy ?? payload.created_by);
}

export async function deleteChat(chatId: string, req: Request) {
  const createdBy = await resolveCreatedByForDelete(req);
  const whereClause = createdBy
    ? and(eq(chats.id, chatId), eq(chats.createdBy, createdBy))
    : eq(chats.id, chatId);

  const [chat] = await db.delete(chats).where(whereClause).returning();

  if (!chat) {
    return Response.json(
      {
        status: "error",
        success: false,
        message: "Chat not found or already deleted.",
      },
      { status: 404 }
    );
  }

  return Response.json({
    status: "success",
    success: true,
    message: "Chat deleted successfully.",
    chat,
  });
}

export async function ensureChat(params: {
  chatId?: string | null;
  createdBy: string;
  title?: string;
}) {
  const normalizedChatId = normalizeOptionalUuid(params.chatId);

  if (normalizedChatId) {
    const [existingChat] = await db
      .select()
      .from(chats)
      .where(and(eq(chats.id, normalizedChatId), eq(chats.createdBy, params.createdBy)));

    if (existingChat) {
      return existingChat;
    }
  }

  const [chat] = await db
    .insert(chats)
    .values({
      createdBy: params.createdBy,
      title: params.title?.trim() || "New Chat",
    })
    .returning();

  return chat;
}

export async function touchChat(chatId: string) {
  await db
    .update(chats)
    .set({
      updatedAt: new Date(),
    })
    .where(eq(chats.id, chatId));
}
