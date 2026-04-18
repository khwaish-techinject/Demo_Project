import "dotenv/config";

import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "./schema";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL is not set in the environment.");
}

export const pool = new Pool({
  connectionString,
  ssl: { rejectUnauthorized: false },
});

export const db = drizzle(pool, { schema });

export async function ensureDatabaseSchema() {
  await pool.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto;`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      name text NOT NULL UNIQUE,
      created_at timestamp NOT NULL DEFAULT now()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS chats (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      created_by uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title text NOT NULL DEFAULT 'New Chat',
      created_at timestamp NOT NULL DEFAULT now(),
      updated_at timestamp NOT NULL DEFAULT now()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS messages (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      chat_id uuid NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
      user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      content text NOT NULL,
      created_at timestamp NOT NULL DEFAULT now()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS attachments (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      message_id uuid NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
      name text NOT NULL,
      url text NOT NULL,
      type text NOT NULL,
      size integer NOT NULL,
      created_at timestamp NOT NULL DEFAULT now()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS customers (
      id integer PRIMARY KEY,
      name text NOT NULL,
      email text UNIQUE,
      city text
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS products (
      id integer PRIMARY KEY,
      name text NOT NULL,
      price integer NOT NULL
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS sales (
      id integer PRIMARY KEY,
      product text NOT NULL,
      customer_id integer NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
      amount integer NOT NULL,
      month text NOT NULL
    );
  `);
}