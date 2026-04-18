import { attachments, chats, customers, messages, products, sales, users } from "../db/schema";

export const ERP_TABLES = ["customers", "products", "sales"] as const;

export function toIsoString(value: Date) {
  return value.toISOString();
}

export function formatUser(row: typeof users.$inferSelect) {
  return {
    id: row.id,
    name: row.name,
    createdAt: toIsoString(row.createdAt),
  };
}

export function formatChat(row: typeof chats.$inferSelect) {
  return {
    id: row.id,
    createdBy: row.createdBy,
    title: row.title,
    createdAt: toIsoString(row.createdAt),
    updatedAt: toIsoString(row.updatedAt),
  };
}

export function formatMessage(row: typeof messages.$inferSelect) {
  return {
    id: row.id,
    chatId: row.chatId,
    userId: row.userId,
    content: row.content,
    createdAt: toIsoString(row.createdAt),
  };
}

export function formatAttachment(row: typeof attachments.$inferSelect) {
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

export function formatCustomer(row: typeof customers.$inferSelect) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    city: row.city,
  };
}

export function formatProduct(row: typeof products.$inferSelect) {
  return {
    id: row.id,
    name: row.name,
    price: row.price,
  };
}

export function formatSale(row: typeof sales.$inferSelect) {
  return {
    id: row.id,
    product: row.product,
    customerId: row.customerId,
    amount: row.amount,
    month: row.month,
  };
}

export function asToolText(value: unknown) {
  return JSON.stringify(value, null, 2);
}

export function getSafeSqlQuery(query: string) {
  const trimmed = query.trim();
  const normalized = trimmed.toLowerCase();

  if (!trimmed) {
    throw new Error("SQL query is required.");
  }

  if (!(normalized.startsWith("select") || normalized.startsWith("with"))) {
    throw new Error("Only read-only SELECT or WITH queries are allowed.");
  }

  if (trimmed.includes(";")) {
    throw new Error("Only a single SQL statement is allowed.");
  }

  if (normalized.includes("--") || normalized.includes("/*") || normalized.includes("*/")) {
    throw new Error("SQL comments are not allowed.");
  }

  const blockedKeywords = [
    "insert ",
    "update ",
    "delete ",
    "drop ",
    "alter ",
    "truncate ",
    "create ",
    "grant ",
    "revoke ",
  ];

  const foundBlockedKeyword = blockedKeywords.find((keyword) =>
    normalized.includes(keyword)
  );

  if (foundBlockedKeyword) {
    throw new Error(`Disallowed SQL keyword detected: ${foundBlockedKeyword.trim()}.`);
  }

  const referencedTables = Array.from(
    normalized.matchAll(/\b(?:from|join)\s+([a-z_][a-z0-9_]*)\b/g)
  ).map((match) => match[1]);

  if (!referencedTables.length) {
    throw new Error("Query must reference at least one ERP table.");
  }

  const invalidTable = referencedTables.find(
    (table) => !ERP_TABLES.includes(table as (typeof ERP_TABLES)[number])
  );

  if (invalidTable) {
    throw new Error(
      `Query can only access ERP tables: ${ERP_TABLES.join(", ")}. Found: ${invalidTable}.`
    );
  }

  return trimmed;
}