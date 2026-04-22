import { and, asc, eq } from "drizzle-orm";

import { db } from "../db/db";
import { attachments, chats, messages } from "../db/schema";

type AttachmentInput = {
  name: string;
  url: string;
  type: string;
  size: number;
};

function badRequest(message: string) {
  return Response.json({ error: message }, { status: 400 });
}

export async function listAttachments(req: Request) {
  const url = new URL(req.url);
  const messageId = url.searchParams.get("messageId");
  const createdBy = url.searchParams.get("createdBy");

  if (!createdBy) {
    return badRequest("createdBy is required.");
  }

  const rows = await db
    .select({
      id: attachments.id,
      messageId: attachments.messageId,
      name: attachments.name,
      url: attachments.url,
      type: attachments.type,
      size: attachments.size,
      createdAt: attachments.createdAt,
    })
    .from(attachments)
    .innerJoin(messages, eq(messages.id, attachments.messageId))
    .innerJoin(chats, eq(chats.id, messages.chatId))
    .where(
      messageId
        ? and(eq(chats.createdBy, createdBy), eq(attachments.messageId, messageId))
        : eq(chats.createdBy, createdBy)
    )
    .orderBy(asc(attachments.createdAt));

  return Response.json(rows);
}

export async function getAttachmentById(attachmentId: string, req: Request) {
  const url = new URL(req.url);
  const createdBy = url.searchParams.get("createdBy");

  if (!createdBy) {
    return badRequest("createdBy is required.");
  }

  const [attachment] = await db
    .select({
      id: attachments.id,
      messageId: attachments.messageId,
      name: attachments.name,
      url: attachments.url,
      type: attachments.type,
      size: attachments.size,
      createdAt: attachments.createdAt,
    })
    .from(attachments)
    .innerJoin(messages, eq(messages.id, attachments.messageId))
    .innerJoin(chats, eq(chats.id, messages.chatId))
    .where(and(eq(attachments.id, attachmentId), eq(chats.createdBy, createdBy)));

  if (!attachment) {
    return Response.json({ error: "Attachment not found." }, { status: 404 });
  }

  return Response.json(attachment);
}

export async function createAttachment(req: Request) {
  const body = await req.json();
  const messageId = body.messageId ?? body.message;
  const name = body.name;
  const url = body.url;
  const type = body.type;
  const size = Number(body.size);

  if (!messageId || !name || !url || !type || Number.isNaN(size)) {
    return badRequest("messageId, name, url, type and size are required.");
  }

  const [attachment] = await db
    .insert(attachments)
    .values({
      messageId,
      name,
      url,
      type,
      size,
    })
    .returning();

  return Response.json(attachment, { status: 201 });
}

export async function updateAttachment(attachmentId: string, req: Request) {
  const body = await req.json();
  const nextValues = {
    name: body.name,
    url: body.url,
    type: body.type,
    size: body.size !== undefined ? Number(body.size) : undefined,
  };

  const [attachment] = await db
    .update(attachments)
    .set(nextValues)
    .where(eq(attachments.id, attachmentId))
    .returning();

  if (!attachment) {
    return Response.json({ error: "Attachment not found." }, { status: 404 });
  }

  return Response.json(attachment);
}

export async function deleteAttachment(attachmentId: string) {
  const [attachment] = await db
    .delete(attachments)
    .where(eq(attachments.id, attachmentId))
    .returning();

  if (!attachment) {
    return Response.json({ error: "Attachment not found." }, { status: 404 });
  }

  return Response.json({ success: true, attachment });
}

export async function createAttachmentsForMessage(
  messageId: string,
  files: AttachmentInput[] | undefined
) {
  if (!files?.length) {
    return [];
  }

  const validFiles = files.filter(
    (file) =>
      Boolean(file?.name) &&
      Boolean(file?.url) &&
      Boolean(file?.type) &&
      Number.isFinite(Number(file?.size))
  );

  if (!validFiles.length) {
    return [];
  }

  const rows = await db
    .insert(attachments)
    .values(
      validFiles.map((file) => ({
        messageId,
        name: file.name,
        url: file.url,
        type: file.type,
        size: Number(file.size),
      }))
    )
    .returning();

  return rows;
}
