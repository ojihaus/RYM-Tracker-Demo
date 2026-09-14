import { createHmac, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { checkGitHub, githubFetch, githubSettings, readGithubFile } from "./github";
import { HttpError } from "./http";

const derive = promisify(scrypt);
const PIN_PATH = "admin/pin.json";
export const ADMIN_COOKIE = "rym-admin-session";
export const SESSION_SECONDS = 30 * 60;

type StoredPin = { version: number; salt: string; hash: string; sha: string };

async function readStoredPin(): Promise<StoredPin | null> {
  const file = await readGithubFile(githubSettings(), PIN_PATH);
  if (!file) return null;
  let value: Record<string, unknown>;
  try { value = JSON.parse(file.text); } catch { throw new HttpError(503, "AUTH_UNAVAILABLE", "Administrator access is temporarily unavailable."); }
  if (![2, 3].includes(Number(value.version)) || typeof value.salt !== "string" || !/^[a-f0-9]{32}$/i.test(value.salt) || typeof value.hash !== "string" || !/^[a-f0-9]{64}$/i.test(value.hash)) throw new HttpError(503, "AUTH_UNAVAILABLE", "Administrator access is temporarily unavailable.");
  return { version: Number(value.version), salt: value.salt, hash: value.hash, sha: file.sha };
}

function secret() { return process.env.ADMIN_SESSION_SECRET || githubSettings().token; }
function pinSecret() { return process.env.ADMIN_PIN_PEPPER || githubSettings().token; }
function equal(a: string, b: string) {
  const left = Buffer.from(a); const right = Buffer.from(b);
  return left.length === right.length && left.length > 0 && timingSafeEqual(left, right);
}
async function hashPin(pin: string, salt: string, version: number) {
  const input = version >= 3 ? createHmac("sha256", pinSecret()).update(`rym-pin:${pin}`).digest("hex") : pin;
  return ((await derive(input, salt, 32)) as Buffer).toString("hex");
}

// This is an instance-local guard. Multi-instance deployments also need a
// platform firewall/shared rate limit; see docs/review.md.
const attempts = new Map<string, { count: number; until: number }>();
export function checkAuthRateLimit(request: Request) {
  const now = Date.now();
  for (const [key, value] of attempts) if (value.until <= now) attempts.delete(key);
  const address = process.env.VERCEL ? request.headers.get("x-vercel-forwarded-for") : request.headers.get("x-forwarded-for");
  const key = (address?.split(",")[0]?.trim() || "unknown").slice(0, 100);
  let value = attempts.get(key);
  if (!value && attempts.size >= 1000) throw new HttpError(429, "AUTH_RATE_LIMITED", "Too many attempts. Please try again later.", 600);
  value ??= { count: 0, until: now + 10 * 60 * 1000 };
  if (value.count >= 8) throw new HttpError(429, "AUTH_RATE_LIMITED", "Too many attempts. Please try again later.", Math.ceil((value.until - now) / 1000));
  value.count++;
  attempts.set(key, value);
}

export async function verifyAdminPin(pin: string) {
  if (!/^\d{4}$/.test(pin)) return false;
  const stored = await readStoredPin();
  if (stored) return equal(stored.hash, await hashPin(pin, stored.salt, stored.version));
  // A missing file must never enable a hard-coded default PIN.
  return Boolean(process.env.ADMIN_PASSWORD && equal(pin, process.env.ADMIN_PASSWORD));
}

async function pinVersion() {
  const pin = await readStoredPin();
  return pin?.sha ?? createHmac("sha256", secret()).update(process.env.ADMIN_PASSWORD || "disabled").digest("hex");
}

export async function createAdminSession(version: string) {
  const payload = Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + SESSION_SECONDS, version })).toString("base64url");
  return `${payload}.${createHmac("sha256", secret()).update(payload).digest("base64url")}`;
}

export async function requireAdminSession(request: Request) {
  const token = request.headers.get("cookie")?.split(";").map((item) => item.trim()).find((item) => item.startsWith(`${ADMIN_COOKIE}=`))?.slice(ADMIN_COOKIE.length + 1) || "";
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra || payload.length > 1024 || !equal(signature, createHmac("sha256", secret()).update(payload).digest("base64url"))) throw new HttpError(401, "AUTH_REQUIRED", "Administrator access expired. Please sign in again.");
  let data: { exp?: number; version?: string };
  try { data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")); } catch { throw new HttpError(401, "AUTH_REQUIRED", "Please sign in again."); }
  const now = Math.floor(Date.now() / 1000);
  if (typeof data.exp !== "number" || data.exp <= now || data.exp > now + SESSION_SECONDS || data.version !== await pinVersion()) throw new HttpError(401, "AUTH_REQUIRED", "Administrator access expired. Please sign in again.");
}

export async function authenticateAdmin(pin: string) {
  if (!/^\d{4}$/.test(pin)) throw new HttpError(401, "INCORRECT_PIN", "The PIN is incorrect.");
  const stored = await readStoredPin();
  const valid = stored ? equal(stored.hash, await hashPin(pin, stored.salt, stored.version)) : Boolean(process.env.ADMIN_PASSWORD && equal(pin, process.env.ADMIN_PASSWORD));
  if (!valid) throw new HttpError(401, "INCORRECT_PIN", "The PIN is incorrect.");
  const version = stored?.sha ?? createHmac("sha256", secret()).update(process.env.ADMIN_PASSWORD || "disabled").digest("hex");
  return createAdminSession(version);
}

export async function changeAdminPin(currentPin: string, newPin: string) {
  if (!/^\d{4}$/.test(newPin)) throw new HttpError(400, "INVALID_PIN", "The new PIN must contain four digits.");
  const settings = githubSettings();
  const existing = await readStoredPin();
  const valid = /^\d{4}$/.test(currentPin) && (existing ? equal(existing.hash, await hashPin(currentPin, existing.salt, existing.version)) : Boolean(process.env.ADMIN_PASSWORD && equal(currentPin, process.env.ADMIN_PASSWORD)));
  if (!valid) throw new HttpError(401, "INCORRECT_PIN", "The current PIN is incorrect.");
  const salt = randomBytes(16).toString("hex");
  const hash = await hashPin(newPin, salt, 3);
  const response = await githubFetch(settings, `/contents/${PIN_PATH}`, {
    method: "PUT", body: JSON.stringify({ message: "Update RYM Tracker admin PIN", branch: settings.branch,
      content: Buffer.from(JSON.stringify({ version: 3, salt, hash }, null, 2) + "\n").toString("base64"), ...(existing ? { sha: existing.sha } : {}) }),
  });
  checkGitHub(response);
  const saved = await response.json();
  if (typeof saved.content?.sha !== "string") throw new HttpError(502, "STORAGE_ERROR", "Please sign in with the new PIN.");
  return createAdminSession(saved.content.sha);
}
