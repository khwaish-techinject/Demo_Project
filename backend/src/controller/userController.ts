import { asc, eq } from "drizzle-orm";

import { db } from "../db/db";
import { users } from "../db/schema";

function badRequest(message: string) {
  return Response.json({ error: message }, { status: 400 });
}

function normalizeOptionalText(value: string | null | undefined) {
  const normalized = value?.trim();

  if (!normalized || normalized === "undefined" || normalized === "null") {
    return undefined;
  }

  return normalized;
}

function normalizeOptionalUuid(value: string | null | undefined) {
  const normalized = normalizeOptionalText(value);

  if (!normalized) {
    return undefined;
  }

  const uuidPattern =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  return uuidPattern.test(normalized) ? normalized : undefined;
}

export async function listUsers() {
  const rows = await db.select().from(users).orderBy(asc(users.createdAt));
  return Response.json(rows);
}

export async function getUserById(userId: string) {
  const [user] = await db.select().from(users).where(eq(users.id, userId));

  if (!user) {
    return Response.json({ error: "User not found." }, { status: 404 });
  }

  return Response.json(user);
}

export async function createUser(req: Request) {
  const body = await req.json();
  const name = body.name?.trim();

  if (!name) {
    return badRequest("name is required.");
  }

  const user = await findOrCreateUser({ name });
  return Response.json(user, { status: 201 });
}

export async function updateUser(userId: string, req: Request) {
  const body = await req.json();
  const name = body.name?.trim();

  if (!name) {
    return badRequest("name is required.");
  }

  const [user] = await db
    .update(users)
    .set({ name })
    .where(eq(users.id, userId))
    .returning();

  if (!user) {
    return Response.json({ error: "User not found." }, { status: 404 });
  }

  return Response.json(user);
}

export async function deleteUser(userId: string) {
  const [user] = await db
    .delete(users)
    .where(eq(users.id, userId))
    .returning();

  if (!user) {
    return Response.json({ error: "User not found." }, { status: 404 });
  }

  return Response.json({ success: true, user });
}

export async function findOrCreateUser(params: {
  id?: string | null;
  name?: string | null;
}) {
  const normalizedName = normalizeOptionalText(params.name);
  const normalizedId = normalizeOptionalUuid(params.id);

  if (normalizedId) {
    const [existingById] = await db
      .select()
      .from(users)
      .where(eq(users.id, normalizedId));

    if (existingById) {
      return existingById;
    }
  }

  if (normalizedName) {
    const [existingByName] = await db
      .select()
      .from(users)
      .where(eq(users.name, normalizedName));

    if (existingByName) {
      return existingByName;
    }
  }

  const nameToCreate = normalizedName || "Guest";

  const [user] = await db
    .insert(users)
    .values({
      name: nameToCreate,
    })
    .returning();

  return user;
}
