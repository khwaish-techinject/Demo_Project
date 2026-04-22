import { and, desc, eq } from "drizzle-orm";
import PDFDocument from "pdfkit";
import { v2 as cloudinary } from "cloudinary";
import * as XLSX from "xlsx";

import { db } from "../../db/db";
import { attachments, messages } from "../../db/schema";

const ATTACHMENT_INTENT_PATTERN =
  /\b(pdf|excel|xlsx|download|export|report)\b/i;
const EXCEL_PATTERN = /\b(excel|xlsx)\b/i;
const FOLLOW_UP_PATTERN =
  /\b(convert|export|download)\b[\s\S]*\b(this|that|it|above|previous|last)\b/i;
const MAX_EXPORT_ROWS = 1000;
const MAX_EXPORT_COLUMNS = 30;

type AllowedFileType = "pdf" | "excel";

export type AttachmentIntent = {
  wantsAttachment: boolean;
  fileType: AllowedFileType | null;
  isFollowUp: boolean;
};

export type AssistantMessageRecord = {
  id: string;
  content: string;
  createdAt: Date;
};

type StructuredPayload = {
  text: string;
  dataRows: Record<string, unknown>[];
};

export type StoredAttachmentResult = {
  fileType: AllowedFileType;
  url: string;
  messageId: string;
  chatId: string;
  name: string;
  size: number;
  reused: boolean;
};

function normalizeText(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

function sanitizeForFilename(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function toTableRows(rows: unknown): Record<string, unknown>[] {
  if (!Array.isArray(rows)) {
    return [];
  }

  const normalized = rows.filter(
    (row): row is Record<string, unknown> =>
      typeof row === "object" && row !== null && !Array.isArray(row)
  );

  return normalized.slice(0, MAX_EXPORT_ROWS);
}

function parseStructuredPayload(content: string): StructuredPayload {
  const trimmed = content.trim();

  if (!trimmed) {
    return { text: "No content available.", dataRows: [] };
  }

  try {
    const parsed = JSON.parse(trimmed) as unknown;

    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "type" in parsed &&
      (parsed as { type?: unknown }).type === "query_result"
    ) {
      const payload = parsed as {
        text?: unknown;
        data?: unknown;
      };

      const text =
        typeof payload.text === "string"
          ? payload.text
          : JSON.stringify(payload.data ?? {}, null, 2);

      return { text, dataRows: toTableRows(payload.data) };
    }

    if (Array.isArray(parsed)) {
      return { text: "Exported data rows.", dataRows: toTableRows(parsed) };
    }
  } catch {
    // If parsing fails we keep plain text mode.
  }

  return { text: trimmed, dataRows: [] };
}

function limitRowColumns(rows: Record<string, unknown>[]) {
  if (!rows.length) {
    return rows;
  }

  const allKeys = Array.from(
    new Set(rows.flatMap((row) => Object.keys(row).slice(0, MAX_EXPORT_COLUMNS)))
  ).slice(0, MAX_EXPORT_COLUMNS);

  return rows.map((row) => {
    const limited: Record<string, unknown> = {};
    for (const key of allKeys) {
      limited[key] = row[key];
    }
    return limited;
  });
}

function createPdfBuffer(title: string, text: string, rows: Record<string, unknown>[]) {
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    const doc = new PDFDocument({ margin: 40 });

    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("error", reject);
    doc.on("end", () => resolve(Buffer.concat(chunks)));

    doc.fontSize(16).text(title);
    doc.moveDown();
    doc.fontSize(12).text(text || "No response content.");

    if (rows.length) {
      doc.moveDown();
      doc.fontSize(13).text("Data (limited for export)");
      doc.moveDown(0.5);
      const preview = JSON.stringify(limitRowColumns(rows), null, 2);
      doc.fontSize(10).text(preview);
    }

    doc.end();
  });
}

function createExcelBuffer(rows: Record<string, unknown>[], fallbackText: string) {
  const workbook = XLSX.utils.book_new();
  const normalizedRows = limitRowColumns(rows);

  if (normalizedRows.length) {
    const sheet = XLSX.utils.json_to_sheet(normalizedRows);
    XLSX.utils.book_append_sheet(workbook, sheet, "Report");
  } else {
    const sheet = XLSX.utils.aoa_to_sheet([
      ["message"],
      [fallbackText || "No structured rows were available for this export."],
    ]);
    XLSX.utils.book_append_sheet(workbook, sheet, "Report");
  }

  const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
  return buffer;
}

function getCloudinaryConfig() {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;

  if (!cloudName || !apiKey || !apiSecret) {
    throw new Error(
      "Cloudinary is not configured. Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET."
    );
  }

  cloudinary.config({
    cloud_name: cloudName,
    api_key: apiKey,
    api_secret: apiSecret,
    secure: true,
  });
}

async function uploadBufferToCloudinary(params: {
  buffer: Buffer;
  filename: string;
  mimeType: string;
}) {
  getCloudinaryConfig();

  const folder = process.env.CLOUDINARY_FOLDER || "datapilot-attachments";

  const result = await new Promise<{
    secure_url: string;
    bytes: number;
  }>((resolve, reject) => {
    const upload = cloudinary.uploader.upload_stream(
      {
        resource_type: "raw",
        folder,
        public_id: sanitizeForFilename(params.filename),
        filename_override: params.filename,
        format: params.filename.split(".").at(-1),
      },
      (error, output) => {
        if (error || !output?.secure_url) {
          reject(error ?? new Error("Cloudinary upload failed."));
          return;
        }

        resolve({
          secure_url: output.secure_url,
          bytes: output.bytes ?? params.buffer.byteLength,
        });
      }
    );

    upload.end(params.buffer);
  });

  return {
    url: result.secure_url,
    size: result.bytes,
  };
}

async function findExistingAttachmentBySource(params: {
  chatId: string;
  sourceMessageId: string;
  fileType: AllowedFileType;
}) {
  const extension = params.fileType === "excel" ? "xlsx" : "pdf";
  const basename = `chat-${params.chatId}-source-${params.sourceMessageId}.${extension}`;

  const [row] = await db
    .select({
      url: attachments.url,
      size: attachments.size,
      name: attachments.name,
      messageId: attachments.messageId,
      type: attachments.type,
    })
    .from(attachments)
    .innerJoin(messages, eq(messages.id, attachments.messageId))
    .where(and(eq(messages.chatId, params.chatId), eq(attachments.name, basename)))
    .orderBy(desc(attachments.createdAt))
    .limit(1);

  if (!row) {
    return null;
  }

  return {
    url: row.url,
    size: row.size,
    name: row.name,
  };
}

export function detectAttachmentIntent(prompt: string): AttachmentIntent {
  const normalized = normalizeText(prompt).toLowerCase();
  const wantsAttachment = ATTACHMENT_INTENT_PATTERN.test(normalized);

  if (!wantsAttachment) {
    return {
      wantsAttachment: false,
      fileType: null,
      isFollowUp: false,
    };
  }

  const fileType: AllowedFileType = EXCEL_PATTERN.test(normalized)
    ? "excel"
    : "pdf";

  return {
    wantsAttachment: true,
    fileType,
    isFollowUp: FOLLOW_UP_PATTERN.test(normalized),
  };
}

export async function getLatestAssistantMessage(params: {
  chatId: string;
  assistantUserId: string;
}) {
  const [row] = await db
    .select({
      id: messages.id,
      content: messages.content,
      createdAt: messages.createdAt,
    })
    .from(messages)
    .where(and(eq(messages.chatId, params.chatId), eq(messages.userId, params.assistantUserId)))
    .orderBy(desc(messages.createdAt))
    .limit(1);

  if (!row) {
    return null;
  }

  return row satisfies AssistantMessageRecord;
}

export async function generateAndStoreAttachment(params: {
  chatId: string;
  targetMessageId: string;
  sourceMessageId: string;
  sourceContent: string;
  fileType: AllowedFileType;
}) {
  const parsed = parseStructuredPayload(params.sourceContent);
  const extension = params.fileType === "excel" ? "xlsx" : "pdf";
  const filename = `chat-${params.chatId}-source-${params.sourceMessageId}.${extension}`;
  const existing = await findExistingAttachmentBySource({
    chatId: params.chatId,
    sourceMessageId: params.sourceMessageId,
    fileType: params.fileType,
  });

  if (existing) {
    const [saved] = await db
      .insert(attachments)
      .values({
        messageId: params.targetMessageId,
        name: existing.name,
        url: existing.url,
        type:
          params.fileType === "excel"
            ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            : "application/pdf",
        size: existing.size,
      })
      .returning();

    return {
      fileType: params.fileType,
      url: saved.url,
      messageId: saved.messageId,
      chatId: params.chatId,
      name: saved.name,
      size: saved.size,
      reused: true,
    } satisfies StoredAttachmentResult;
  }

  const mimeType =
    params.fileType === "excel"
      ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      : "application/pdf";

  const fileBuffer =
    params.fileType === "excel"
      ? createExcelBuffer(parsed.dataRows, parsed.text)
      : await createPdfBuffer("DataPilot AI Export", parsed.text, parsed.dataRows);

  const uploaded = await uploadBufferToCloudinary({
    buffer: fileBuffer,
    filename,
    mimeType,
  });

  const [saved] = await db
    .insert(attachments)
    .values({
      messageId: params.targetMessageId,
      name: filename,
      url: uploaded.url,
      type: mimeType,
      size: uploaded.size,
    })
    .returning();

  return {
    fileType: params.fileType,
    url: saved.url,
    messageId: saved.messageId,
    chatId: params.chatId,
    name: saved.name,
    size: saved.size,
    reused: false,
  } satisfies StoredAttachmentResult;
}
