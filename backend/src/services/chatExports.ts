import { asc, eq, inArray } from "drizzle-orm";

import { db } from "../db/db";
import { attachments, chats, messages, users } from "../db/schema";

type ChatAttachment = {
  id: string;
  name: string;
  url: string;
  type: string;
  size: number;
  createdAt: string;
};

type ChatMessage = {
  id: string;
  role: string;
  userId: string;
  userName: string;
  content: string;
  createdAt: string;
  attachments: ChatAttachment[];
};

export type ChatHistory = {
  chat: {
    id: string;
    title: string;
    createdBy: string;
    createdAt: string;
    updatedAt: string;
  };
  messages: ChatMessage[];
};

function toIsoString(value: Date) {
  return value.toISOString();
}

function escapeCsvCell(value: string) {
  const normalized = value.replace(/"/g, "\"\"");
  return `"${normalized}"`;
}

function buildCsv(history: ChatHistory) {
  const header = [
    "chat_id",
    "chat_title",
    "message_id",
    "role",
    "user_id",
    "user_name",
    "content",
    "created_at",
    "attachment_names",
  ];

  const rows = history.messages.map((message) =>
    [
      history.chat.id,
      history.chat.title,
      message.id,
      message.role,
      message.userId,
      message.userName,
      message.content,
      message.createdAt,
      message.attachments.map((attachment) => attachment.name).join(" | "),
    ]
      .map((cell) => escapeCsvCell(String(cell)))
      .join(",")
  );

  return [header.join(","), ...rows].join("\n");
}

function buildTextTranscript(history: ChatHistory) {
  const lines = [
    `Chat: ${history.chat.title}`,
    `Chat ID: ${history.chat.id}`,
    `Created At: ${history.chat.createdAt}`,
    `Updated At: ${history.chat.updatedAt}`,
    "",
  ];

  for (const message of history.messages) {
    lines.push(`[${message.createdAt}] ${message.userName} (${message.role})`);
    lines.push(message.content);

    if (message.attachments.length) {
      lines.push(
        `Attachments: ${message.attachments
          .map((attachment) => `${attachment.name} (${attachment.type})`)
          .join(", ")}`
      );
    }

    lines.push("");
  }

  return lines.join("\n");
}

function buildExcelXml(history: ChatHistory) {
  const rows = [
    ["Chat Title", history.chat.title],
    ["Chat ID", history.chat.id],
    ["Created At", history.chat.createdAt],
    ["Updated At", history.chat.updatedAt],
    [],
    ["Message ID", "Role", "User", "Content", "Created At", "Attachments"],
    ...history.messages.map((message) => [
      message.id,
      message.role,
      message.userName,
      message.content,
      message.createdAt,
      message.attachments.map((attachment) => attachment.name).join(", "),
    ]),
  ];

  const xmlRows = rows
    .map((row) => {
      const cells = row
        .map((cell) => {
          const value = String(cell ?? "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;");
          return `<Cell><Data ss:Type="String">${value}</Data></Cell>`;
        })
        .join("");

      return `<Row>${cells}</Row>`;
    })
    .join("");

  return `<?xml version="1.0"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
 <Worksheet ss:Name="Chat Export">
  <Table>
   ${xmlRows}
  </Table>
 </Worksheet>
</Workbook>`;
}

export async function getChatHistory(chatId: string): Promise<ChatHistory | null> {
  const [chat] = await db.select().from(chats).where(eq(chats.id, chatId));

  if (!chat) {
    return null;
  }

  const messageRows = await db
    .select({
      id: messages.id,
      role: messages.role,
      userId: messages.userId,
      userName: users.name,
      content: messages.content,
      createdAt: messages.createdAt,
    })
    .from(messages)
    .innerJoin(users, eq(messages.userId, users.id))
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

  const attachmentsByMessageId = new Map<string, ChatAttachment[]>();

  for (const attachment of attachmentRows) {
    const list = attachmentsByMessageId.get(attachment.messageId) ?? [];
    list.push({
      id: attachment.id,
      name: attachment.name,
      url: attachment.url,
      type: attachment.type,
      size: attachment.size,
      createdAt: toIsoString(attachment.createdAt),
    });
    attachmentsByMessageId.set(attachment.messageId, list);
  }

  return {
    chat: {
      id: chat.id,
      title: chat.title,
      createdBy: chat.createdBy,
      createdAt: toIsoString(chat.createdAt),
      updatedAt: toIsoString(chat.updatedAt),
    },
    messages: messageRows.map((message) => ({
      id: message.id,
      role: message.role,
      userId: message.userId,
      userName: message.userName,
      content: message.content,
      createdAt: toIsoString(message.createdAt),
      attachments: attachmentsByMessageId.get(message.id) ?? [],
    })),
  };
}

export async function getChatHistoryResponse(chatId: string) {
  const history = await getChatHistory(chatId);

  if (!history) {
    return Response.json({ error: "Chat not found." }, { status: 404 });
  }

  return Response.json(history);
}

export async function downloadChat(chatId: string, format: string) {
  const history = await getChatHistory(chatId);

  if (!history) {
    return Response.json({ error: "Chat not found." }, { status: 404 });
  }

  const safeTitle = history.chat.title.replace(/[^a-zA-Z0-9-_]+/g, "_") || "chat";

  if (format === "json") {
    return new Response(JSON.stringify(history, null, 2), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="${safeTitle}.json"`,
      },
    });
  }

  if (format === "txt") {
    return new Response(buildTextTranscript(history), {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Content-Disposition": `attachment; filename="${safeTitle}.txt"`,
      },
    });
  }

  if (format === "csv") {
    return new Response(buildCsv(history), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${safeTitle}.csv"`,
      },
    });
  }

  if (format === "excel") {
    return new Response(buildExcelXml(history), {
      headers: {
        "Content-Type": "application/vnd.ms-excel; charset=utf-8",
        "Content-Disposition": `attachment; filename="${safeTitle}.xml"`,
      },
    });
  }

  if (format === "pdf") {
    return Response.json(
      {
        error:
          "PDF export is not implemented yet. Add a PDF generation library or service before enabling this format.",
      },
      { status: 501 }
    );
  }

  return Response.json(
    {
      error: "Unsupported format. Use json, txt, csv, excel, or pdf.",
    },
    { status: 400 }
  );
}
