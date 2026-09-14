import { ADMIN_COOKIE, SESSION_SECONDS, changeAdminPin, checkAuthRateLimit, authenticateAdmin, requireAdminSession } from "../../lib/adminAuth";
import { assertSameOrigin, errorResponse, HttpError, json, readJsonBody } from "../../lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function authenticatedResponse(session: string) {
  const response = json({ ok: true });
  response.cookies.set(ADMIN_COOKIE, session, {
    httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict", path: "/api", maxAge: SESSION_SECONDS,
  });
  return response;
}

export async function POST(request: Request) {
  try {
    const body = await readJsonBody(request);
    checkAuthRateLimit(request);
    if (typeof body.password !== "string") throw new HttpError(401, "INCORRECT_PIN", "The PIN is incorrect.");
    return authenticatedResponse(await authenticateAdmin(body.password));
  } catch (error) { return errorResponse(error); }
}

export async function PUT(request: Request) {
  try {
    const body = await readJsonBody(request);
    await requireAdminSession(request);
    checkAuthRateLimit(request);
    return authenticatedResponse(await changeAdminPin(String(body.currentPassword || ""), String(body.newPassword || "")));
  } catch (error) { return errorResponse(error); }
}

export async function DELETE(request: Request) {
  try {
    assertSameOrigin(request);
    const response = json({ ok: true });
    response.cookies.set(ADMIN_COOKIE, "", { httpOnly: true, sameSite: "strict", secure: process.env.NODE_ENV === "production", path: "/api", maxAge: 0 });
    return response;
  } catch (error) { return errorResponse(error); }
}
