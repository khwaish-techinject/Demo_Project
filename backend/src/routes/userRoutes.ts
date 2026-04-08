import {
  createUser,
  deleteUser,
  getUserById,
  listUsers,
  updateUser,
} from "../controller/userController";
import { getIdFromPath } from "./utils";

export async function handleUserRoutes(req: Request, pathname: string) {
  if (req.method === "GET" && pathname === "/api/users") {
    return listUsers();
  }

  if (req.method === "POST" && pathname === "/api/users") {
    return createUser(req);
  }

  if (!pathname.startsWith("/api/users/")) {
    return null;
  }

  const userId = getIdFromPath(pathname);

  if (req.method === "GET") {
    return getUserById(userId);
  }

  if (req.method === "PATCH" || req.method === "PUT") {
    return updateUser(userId, req);
  }

  if (req.method === "DELETE") {
    return deleteUser(userId);
  }

  return null;
}
