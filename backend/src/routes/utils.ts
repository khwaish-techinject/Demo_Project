export function jsonResponse(data: unknown, init?: ResponseInit) {
  return Response.json(data, init);
}

export function getIdFromPath(pathname: string) {
  return pathname.split("/").at(-1) ?? "";
}
