import { pool } from "../db";
import { createPostgresAdapter } from "./postgresAdapter";

export const databaseAdapter = createPostgresAdapter(pool);

export type { DatabaseAdapter, DatabaseTableColumn, ReadOnlyQueryResult } from "./types";
