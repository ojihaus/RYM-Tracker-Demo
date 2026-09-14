import { NextResponse } from "next/server";

export const NO_STORE_HEADERS = { "Cache-Control": "no-store, max-age=0", "X-Content-Type-Options": "nosniff" };

export class HttpError extends Error {
  constructor(public status: number, public code: string, message: string, public retryAfter?: number) {
    super(message);
  }
}

export function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: NO_STORE_HEADERS });
}

export function errorResponse(error: unknown) {
  const known = error instanceof HttpError;
  if (!known) console.error("RYM request failed:", error instanceof Error ? error.name : "unknown");
  const response = json({ ok: false, code: known ? error.code : "UNAVAILABLE", error: known ? error.message : "The service is temporarily unavailable. Please try again." }, known ? error.status : 502);
  if (known && error.retryAfter) response.headers.set("Retry-After", String(error.retryAfter));
  return response;
}

export function assertSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if ((origin && origin !== new URL(request.url).origin) || request.headers.get("sec-fetch-site") === "cross-site") {
    throw new HttpError(403, "ORIGIN_DENIED", "This request must come from the tracker.");
  }
}

export async function readJsonBody(request: Request, maxBytes = 4096): Promise<Record<string, unknown>> {
  assertSameOrigin(request);
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) throw new HttpError(415, "JSON_REQUIRED", "Choose a JSON file.");
  if (Number(request.headers.get("content-length")) > maxBytes) throw new HttpError(413, "TOO_LARGE", "This file is too large.");
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(400, "INVALID_JSON", "The request is empty.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) { await reader.cancel(); throw new HttpError(413, "TOO_LARGE", "This file is too large."); }
      chunks.push(value);
    }
    const body: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("object required");
    return body as Record<string, unknown>;
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, "INVALID_JSON", "The JSON could not be read.");
  } finally { reader.releaseLock(); }
}
