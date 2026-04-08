import {
  createAttachment,
  deleteAttachment,
  getAttachmentById,
  listAttachments,
  updateAttachment,
} from "../controller/attachmentController";
import { getIdFromPath } from "./utils";

export async function handleAttachmentRoutes(req: Request, pathname: string) {
  if (req.method === "GET" && pathname === "/api/attachments") {
    return listAttachments(req);
  }

  if (req.method === "POST" && pathname === "/api/attachments") {
    return createAttachment(req);
  }

  if (!pathname.startsWith("/api/attachments/")) {
    return null;
  }

  const attachmentId = getIdFromPath(pathname);

  if (req.method === "GET") {
    return getAttachmentById(attachmentId);
  }

  if (req.method === "PATCH" || req.method === "PUT") {
    return updateAttachment(attachmentId, req);
  }

  if (req.method === "DELETE") {
    return deleteAttachment(attachmentId);
  }

  return null;
}
