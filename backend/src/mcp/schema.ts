export const databaseSchema = {
  database: "postgresql",
  orm: "drizzle",
  tables: [
    {
      name: "users",
      description: "Application users, including the assistant identity.",
      primaryKey: "id",
      columns: [
        { name: "id", type: "uuid", required: true, generated: true },
        { name: "name", type: "text", required: true, unique: true },
        { name: "created_at", type: "timestamp", required: true, default: "now()" },
      ],
    },
    {
      name: "chats",
      description: "Conversation containers created by a user.",
      primaryKey: "id",
      columns: [
        { name: "id", type: "uuid", required: true, generated: true },
        {
          name: "created_by",
          type: "uuid",
          required: true,
          references: "users.id",
          onDelete: "cascade",
        },
        { name: "title", type: "text", required: true, default: "New Chat" },
        { name: "created_at", type: "timestamp", required: true, default: "now()" },
        { name: "updated_at", type: "timestamp", required: true, default: "now()" },
      ],
    },
    {
      name: "messages",
      description: "Messages that belong to a chat and are authored by a user.",
      primaryKey: "id",
      columns: [
        { name: "id", type: "uuid", required: true, generated: true },
        {
          name: "chat_id",
          type: "uuid",
          required: true,
          references: "chats.id",
          onDelete: "cascade",
        },
        {
          name: "user_id",
          type: "uuid",
          required: true,
          references: "users.id",
          onDelete: "cascade",
        },
        { name: "content", type: "text", required: true },
        { name: "created_at", type: "timestamp", required: true, default: "now()" },
      ],
    },
    {
      name: "attachments",
      description: "Files attached to a message.",
      primaryKey: "id",
      columns: [
        { name: "id", type: "uuid", required: true, generated: true },
        {
          name: "message_id",
          type: "uuid",
          required: true,
          references: "messages.id",
          onDelete: "cascade",
        },
        { name: "name", type: "text", required: true },
        { name: "url", type: "text", required: true },
        { name: "type", type: "text", required: true },
        { name: "size", type: "integer", required: true },
        { name: "created_at", type: "timestamp", required: true, default: "now()" },
      ],
    },
    {
      name: "customers",
      description: "Customers used by the ERP sales workflow.",
      primaryKey: "id",
      columns: [
        { name: "id", type: "integer", required: true },
        { name: "name", type: "text", required: true },
        { name: "email", type: "text", required: false, unique: true },
        { name: "city", type: "text", required: false },
      ],
    },
    {
      name: "products",
      description: "Products available for sale in the ERP system.",
      primaryKey: "id",
      columns: [
        { name: "id", type: "integer", required: true },
        { name: "name", type: "text", required: true },
        { name: "price", type: "integer", required: true },
      ],
    },
    {
      name: "sales",
      description: "Sales transactions used for reporting and analytics.",
      primaryKey: "id",
      columns: [
        { name: "id", type: "integer", required: true },
        { name: "product", type: "text", required: true },
        {
          name: "customer_id",
          type: "integer",
          required: true,
          references: "customers.id",
          onDelete: "cascade",
        },
        { name: "amount", type: "integer", required: true },
        { name: "month", type: "text", required: true },
      ],
    },
  ],
  relationships: [
    { from: "chats.created_by", to: "users.id", kind: "many-to-one" },
    { from: "messages.chat_id", to: "chats.id", kind: "many-to-one" },
    { from: "messages.user_id", to: "users.id", kind: "many-to-one" },
    { from: "attachments.message_id", to: "messages.id", kind: "many-to-one" },
    { from: "sales.customer_id", to: "customers.id", kind: "many-to-one" },
  ],
} as const;

export function getDatabaseSchemaText() {
  return JSON.stringify(databaseSchema, null, 2);
}
