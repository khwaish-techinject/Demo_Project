import { and, asc, desc, eq, ilike } from "drizzle-orm";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { db, pool } from "../../db/db";
import { customers, products, sales } from "../../db/schema";
import {
  asToolText,
  formatCustomer,
  formatProduct,
  formatSale,
  getSafeSqlQuery,
} from "../shared";

export function registerErpTools(server: McpServer) {
  server.registerTool(
    "run_sql_query",
    {
      description:
        "Execute a single read-only SQL query on PostgreSQL for ERP reporting and analytics. Only SELECT or WITH queries against customers, products, and sales are allowed.",
      inputSchema: {
        query: z.string().min(1).describe("Read-only SQL query to execute."),
      },
      outputSchema: {
        rowCount: z.number(),
        rows: z.array(z.record(z.string(), z.unknown())),
        fields: z.array(
          z.object({
            name: z.string(),
            dataTypeId: z.number(),
          })
        ),
      },
    },
    async ({ query }) => {
      const safeQuery = getSafeSqlQuery(query);

      const result = await pool.query(safeQuery);
      const payload = {
        rowCount: result.rowCount ?? 0,
        rows: result.rows,
        fields: result.fields.map((field) => ({
          name: field.name,
          dataTypeId: field.dataTypeID,
        })),
      };

      return {
        content: [{ type: "text", text: asToolText(payload) }],
        structuredContent: payload,
      };
    }
  );

  server.registerTool(
    "list_customers",
    {
      description:
        "Retrieve customers from the database with optional filters like name or city for answering user questions and generating reports.",
      inputSchema: {
        name: z.string().trim().optional().describe("Optional partial customer name filter."),
        city: z.string().trim().optional().describe("Optional city filter."),
        limit: z.number().int().min(1).max(100).default(20),
      },
      outputSchema: {
        customers: z.array(
          z.object({
            id: z.number(),
            name: z.string(),
            email: z.string().nullable(),
            city: z.string().nullable(),
          })
        ),
      },
    },
    async ({ name, city, limit }) => {
      const filters = [];

      if (name) {
        filters.push(ilike(customers.name, `%${name}%`));
      }

      if (city) {
        filters.push(ilike(customers.city, `%${city}%`));
      }

      const rows =
        filters.length > 0
          ? await db
              .select()
              .from(customers)
              .where(filters.length === 1 ? filters[0] : and(...filters))
              .orderBy(asc(customers.name))
              .limit(limit)
          : await db.select().from(customers).orderBy(asc(customers.name)).limit(limit);

      const result = { customers: rows.map(formatCustomer) };

      return {
        content: [{ type: "text", text: asToolText(result) }],
        structuredContent: result,
      };
    }
  );

  server.registerTool(
    "list_products",
    {
      description:
        "Retrieve products from the database with optional name filtering for product lookups and pricing questions.",
      inputSchema: {
        name: z.string().trim().optional().describe("Optional partial product name filter."),
        limit: z.number().int().min(1).max(100).default(20),
      },
      outputSchema: {
        products: z.array(
          z.object({
            id: z.number(),
            name: z.string(),
            price: z.number(),
          })
        ),
      },
    },
    async ({ name, limit }) => {
      const rows = name
        ? await db
            .select()
            .from(products)
            .where(ilike(products.name, `%${name}%`))
            .orderBy(asc(products.name))
            .limit(limit)
        : await db.select().from(products).orderBy(asc(products.name)).limit(limit);

      const result = {
        products: rows.map((row) => ({
          ...formatProduct(row),
          price: Number(row.price),
        })),
      };

      return {
        content: [{ type: "text", text: asToolText(result) }],
        structuredContent: result,
      };
    }
  );

  server.registerTool(
    "list_sales",
    {
      description:
        "Retrieve sales records from the database with optional filters such as month, customer, or product for reporting, analysis, and summaries.",
      inputSchema: {
        month: z.string().trim().optional().describe("Optional month filter such as March."),
        customerId: z.number().int().optional().describe("Optional customer id filter."),
        product: z.string().trim().optional().describe("Optional product name filter."),
        limit: z.number().int().min(1).max(100).default(50),
      },
      outputSchema: {
        sales: z.array(
          z.object({
            id: z.number(),
            product: z.string(),
            customerId: z.number(),
            amount: z.number(),
            month: z.string(),
          })
        ),
      },
    },
    async ({ month, customerId, product, limit }) => {
      const filters = [];

      if (month) {
        filters.push(ilike(sales.month, `%${month}%`));
      }

      if (customerId !== undefined) {
        filters.push(eq(sales.customerId, customerId));
      }

      if (product) {
        filters.push(ilike(sales.product, `%${product}%`));
      }

      const rows =
        filters.length > 0
          ? await db
              .select()
              .from(sales)
              .where(filters.length === 1 ? filters[0] : and(...filters))
              .orderBy(desc(sales.id))
              .limit(limit)
          : await db.select().from(sales).orderBy(desc(sales.id)).limit(limit);

      const result = { sales: rows.map(formatSale) };

      return {
        content: [{ type: "text", text: asToolText(result) }],
        structuredContent: result,
      };
    }
  );
}