import {
  createMessage,
  deleteMessage,
  getMessageById,
  listMessages,
  updateMessage,
} from "../controller/messageController";
import { getIdFromPath } from "./utils";

export async function handleMessageRoutes(req: Request, pathname: string) {
  if (req.method === "GET" && pathname === "/api/messages") {
    return listMessages(req);
  }

  if (req.method === "POST" && pathname === "/api/messages") {
    return createMessage(req);
  }

  if (!pathname.startsWith("/api/messages/")) {
    return null;
  }

  const messageId = getIdFromPath(pathname);

  if (req.method === "GET") {
    return getMessageById(messageId);
  }

  if (req.method === "PATCH" || req.method === "PUT") {
    return updateMessage(messageId, req);
  }

  if (req.method === "DELETE") {
    return deleteMessage(messageId);
  }

  return null;
}
