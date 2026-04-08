import {
  createChat,
  deleteChat,
  getChatById,
  listChats,
  updateChat,
} from "../controller/chatController";
import { downloadChat, getChatHistoryResponse } from "../services/chatExports";

export async function handleChatRoutes(req: Request, url: URL, pathname: string) {
  if (req.method === "GET" && pathname === "/api/chats") {
    return listChats(req);
  }

  if (req.method === "POST" && pathname === "/api/chats") {
    return createChat(req);
  }

  if (!pathname.startsWith("/api/chats/")) {
    return null;
  }

  const chatSegments = pathname.split("/").filter(Boolean);
  const chatId = chatSegments[2] ?? "";
  const chatAction = chatSegments[3];

  if (req.method === "GET" && chatAction === "history") {
    return getChatHistoryResponse(chatId);
  }

  if (req.method === "GET" && chatAction === "download") {
    const format = url.searchParams.get("format")?.toLowerCase() ?? "json";
    return downloadChat(chatId, format);
  }

  if (req.method === "GET") {
    return getChatById(chatId);
  }

  if (req.method === "PATCH" || req.method === "PUT") {
    return updateChat(chatId, req);
  }

  if (req.method === "DELETE") {
    return deleteChat(chatId);
  }

  return null;
}
