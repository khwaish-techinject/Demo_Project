import { handleAttachmentRoutes } from "./attachmentRoutes";
import { handleChatRoutes } from "./chatRoutes";
import { handleMessageRoutes } from "./messageRoutes";
import { handleUserRoutes } from "./userRoutes";
import { jsonResponse } from "./utils";

export async function handleApiRoutes(req: Request) {
  const url = new URL(req.url);
  const pathname = url.pathname;

  if (req.method === "GET" && pathname === "/") {
    return jsonResponse({
      ok: true,
      message: "WebSocket and CRUD API are running.",
      websocket: "/ws",
    });
  }

  if (req.method === "GET" && pathname === "/health") {
    return jsonResponse({
      ok: true,
      websocket: "/ws",
    });
  }

  const handlers = [
    () => handleUserRoutes(req, pathname),
    () => handleChatRoutes(req, url, pathname),
    () => handleMessageRoutes(req, pathname),
    () => handleAttachmentRoutes(req, pathname),
  ];

  for (const handler of handlers) {
    const response = await handler();

    if (response) {
      return response;
    }
  }

  return jsonResponse({ error: "Not Found" }, { status: 404 });
}
