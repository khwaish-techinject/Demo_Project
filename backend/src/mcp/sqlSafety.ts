import { databaseAdapter } from "../db/adapters";

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

const READ_ONLY_START = /^(select|with)\b/i;
const BLOCKED_PATTERNS = [
  /\binsert\b/i,
  /\bupdate\b/i,
  /\bdelete\b/i,
  /\bdrop\b/i,
  /\balter\b/i,
  /\btruncate\b/i,
  /\bcreate\b/i,
  /\bgrant\b/i,
  /\brevoke\b/i,
  /\bcomment\b/i,
  /\bcopy\b/i,
  /\bcall\b/i,
  /\bexecute\b/i,
  /\brefresh\b/i,
  /\bmerge\b/i,
  /\bupsert\b/i,
  /\block\b/i,
  /\bvacuum\b/i,
];

const COMMENT_PATTERNS = [/--/g, /\/\*/g];

export type SqlValidationResult = {
  ok: boolean;
  reason?: string;
  sanitizedQuery?: string;
};

function normalizeWhitespace(query: string) {
  return query.replace(/\s+/g, " ").trim();
}

function extractReferencedTables(query: string) {
  const matches = query.matchAll(/\b(?:from|join)\s+([a-zA-Z_][a-zA-Z0-9_\.]*)/gi);
  return Array.from(matches, (match) => match[1].split(".").at(-1)?.toLowerCase() ?? "");
}

function hasMultipleStatements(query: string) {
  const trimmed = query.trim();
  const semicolonCount = (trimmed.match(/;/g) || []).length;

  if (semicolonCount === 0) {
    return false;
  }

  return !trimmed.endsWith(";") || semicolonCount > 1;
}

function enforceLimit(query: string) {
  const hasLimit = /\blimit\s+(\d+)\b/i.exec(query);

  if (!hasLimit) {
    return `${query} LIMIT ${DEFAULT_LIMIT}`;
  }

  const requestedLimit = Number(hasLimit[1]);
  const safeLimit = Number.isFinite(requestedLimit)
    ? Math.min(requestedLimit, MAX_LIMIT)
    : DEFAULT_LIMIT;

  return query.replace(/\blimit\s+\d+\b/i, `LIMIT ${safeLimit}`);
}

export async function validateReadOnlySql(query: string): Promise<SqlValidationResult> {
  const normalizedQuery = normalizeWhitespace(query);

  if (!normalizedQuery) {
    return { ok: false, reason: "Query is empty." };
  }

  if (!READ_ONLY_START.test(normalizedQuery)) {
    return { ok: false, reason: "Only read-only SELECT queries are allowed." };
  }

  if (hasMultipleStatements(normalizedQuery)) {
    return { ok: false, reason: "Multiple SQL statements are not allowed." };
  }

  if (COMMENT_PATTERNS.some((pattern) => pattern.test(normalizedQuery))) {
    return { ok: false, reason: "SQL comments are not allowed." };
  }

  const blockedPattern = BLOCKED_PATTERNS.find((pattern) => pattern.test(normalizedQuery));

  if (blockedPattern) {
    return {
      ok: false,
      reason: "This query contains blocked SQL keywords and was rejected.",
    };
  }

  const referencedTables = extractReferencedTables(normalizedQuery);
  const allowedTables = await databaseAdapter.listAllowedTables();
  const disallowedTable = referencedTables.find(
    (tableName) => tableName && !allowedTables.has(tableName)
  );

  if (disallowedTable) {
    return {
      ok: false,
      reason: `Table "${disallowedTable}" is not in the allowed read-only list.`,
    };
  }

  return {
    ok: true,
    sanitizedQuery: enforceLimit(normalizedQuery.replace(/;$/, "")),
  };
}

export async function executeReadOnlySql(query: string) {
  const validation = await validateReadOnlySql(query);

  if (!validation.ok || !validation.sanitizedQuery) {
    throw new Error(validation.reason ?? "Query failed validation.");
  }

  return databaseAdapter.executeReadOnlyQuery(validation.sanitizedQuery);
}
