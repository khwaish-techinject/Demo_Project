import type { Pool } from "pg";

import type {
  DatabaseAdapter,
  DatabaseTableColumn,
  ReadOnlyQueryResult,
} from "./types";

export function createPostgresAdapter(pool: Pool): DatabaseAdapter {
  async function getSchemaRows() {
    const result = await pool.query<DatabaseTableColumn>(
      `
        SELECT
          table_name AS "tableName",
          column_name AS "columnName",
          data_type AS "dataType",
          is_nullable AS "isNullable"
        FROM information_schema.columns
        WHERE table_schema = 'public'
        ORDER BY table_name, ordinal_position
      `
    );

    return result.rows;
  }

  async function getTableSchema(tableName: string) {
    const result = await pool.query<DatabaseTableColumn>(
      `
        SELECT
          table_name AS "tableName",
          column_name AS "columnName",
          data_type AS "dataType",
          is_nullable AS "isNullable"
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = $1
        ORDER BY ordinal_position
      `,
      [tableName]
    );

    return result.rows;
  }

  async function listTables() {
    const schemaRows = await getSchemaRows();
    return [...new Set(schemaRows.map((row) => row.tableName))];
  }

  async function listAllowedTables() {
    const result = await pool.query<{ tableName: string }>(
      `
        SELECT table_name AS "tableName"
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_type IN ('BASE TABLE', 'VIEW')
        ORDER BY table_name
      `
    );

    return new Set(result.rows.map((row) => row.tableName.toLowerCase()));
  }

  async function executeReadOnlyQuery(query: string): Promise<ReadOnlyQueryResult> {
    const client = await pool.connect();

    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL statement_timeout = 5000");
      await client.query("SET LOCAL default_transaction_read_only = on");
      const result = await client.query(query);
      await client.query("COMMIT");

      return {
        rows: result.rows as Record<string, unknown>[],
        rowCount: result.rowCount ?? result.rows.length,
        query,
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  return {
    dialect: "postgres",
    listTables,
    getSchemaRows,
    getTableSchema,
    listAllowedTables,
    executeReadOnlyQuery,
  };
}
