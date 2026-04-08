import { databaseAdapter } from "../../db/adapters";
import { executeReadOnlySql, validateReadOnlySql } from "../sqlSafety";
import type { McpToolDefinition, ToolExecutionResult } from "../types";

async function listTablesResult(): Promise<ToolExecutionResult> {
  const tableNames = await databaseAdapter.listTables();

  return {
    content:
      tableNames.length > 0
        ? `Available tables:\n${tableNames.map((name) => `- ${name}`).join("\n")}`
        : "No public tables were found in the connected database.",
    query: `${databaseAdapter.dialect}:list_tables`,
    source: "tool",
  };
}

async function schemaContext(): Promise<ToolExecutionResult> {
  const schemaRows = await databaseAdapter.getSchemaRows();

  if (!schemaRows.length) {
    return {
      content: [
        "No public tables were found in the connected database.",
        "The MCP tool layer is ready, but there is no schema to inspect yet.",
      ].join("\n"),
      query: `${databaseAdapter.dialect}:describe_schema`,
      source: "schema",
    };
  }

  const grouped = new Map<string, string[]>();

  for (const row of schemaRows) {
    const entries = grouped.get(row.tableName) ?? [];
    entries.push(
      `${row.columnName} (${row.dataType}${row.isNullable === "YES" ? ", nullable" : ""})`
    );
    grouped.set(row.tableName, entries);
  }

  const tableLines = Array.from(grouped.entries()).map(
    ([tableName, columns]) => `- ${tableName}: ${columns.join(", ")}`
  );

  return {
    content: [
      "Connected database schema:",
      ...tableLines,
      "",
      "Use MCP tools to inspect tables or run validated read-only SQL.",
    ].join("\n"),
    query: `${databaseAdapter.dialect}:describe_schema`,
    source: "schema",
  };
}

const listTablesTool: McpToolDefinition = {
  name: "list_tables",
  description: "Lists all public tables available in the connected database.",
  matches(input) {
    return /^tool:list_tables$/i.test(input.trim());
  },
  async execute() {
    return listTablesResult();
  },
};

const getTableSchemaTool: McpToolDefinition = {
  name: "get_table_schema",
  description: "Returns column details for one table. Use: tool:get_table_schema <table_name>",
  matches(input) {
    return /^tool:get_table_schema\s+[a-zA-Z_][a-zA-Z0-9_]*$/i.test(input.trim());
  },
  async execute(context) {
    const match = context.input.trim().match(
      /^tool:get_table_schema\s+([a-zA-Z_][a-zA-Z0-9_]*)$/i
    );
    const tableName = match?.[1];

    if (!tableName) {
      return {
        content: "Table name is required. Use: tool:get_table_schema <table_name>",
        query: "",
        source: "tool",
      };
    }

    const result = await databaseAdapter.getTableSchema(tableName);

    if (!result.length) {
      return {
        content: `Table "${tableName}" was not found in the public schema.`,
        query: `${databaseAdapter.dialect}:describe_table:${tableName}`,
        source: "tool",
      };
    }

    return {
      content: [
        `Schema for table "${tableName}":`,
        ...result.map(
          (row) =>
            `- ${row.columnName} (${row.dataType}${row.isNullable === "YES" ? ", nullable" : ""})`
        ),
      ].join("\n"),
      query: `${databaseAdapter.dialect}:describe_table:${tableName}`,
      source: "tool",
    };
  },
};

const safeSqlQueryTool: McpToolDefinition = {
  name: "run_sql_query",
  description:
    "Runs a validated read-only SQL query. Use: sql: SELECT ... Only SELECT/WITH queries are allowed.",
  matches(input) {
    return /^sql:/i.test(input.trim());
  },
  async execute(context) {
    const rawQuery = context.input.trim().replace(/^sql:/i, "").trim();
    const validation = await validateReadOnlySql(rawQuery);

    if (!validation.ok || !validation.sanitizedQuery) {
      return {
        content: `Query rejected for safety: ${validation.reason}`,
        query: rawQuery,
        source: "query",
      };
    }

    const result = await executeReadOnlySql(validation.sanitizedQuery);

    return {
      content: JSON.stringify(
        {
          rowCount: result.rowCount,
          rows: result.rows,
        },
        null,
        2
      ),
      query: result.query,
      source: "query",
    };
  },
};

export const databaseTools: McpToolDefinition[] = [
  listTablesTool,
  getTableSchemaTool,
  safeSqlQueryTool,
];

export async function getSchemaContextToolResult() {
  return schemaContext();
}
