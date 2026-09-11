import { randomBytes, scryptSync, timingSafeEqual } from "crypto";

const PIN_FILE_PATH = "admin/pin.json";

type GitHubSettings = {
  token: string;
  owner: string;
  repo: string;
  branch: string;
};

type StoredPin =
  | { status: "found"; salt: string; hash: string }
  | { status: "missing" }
  | { status: "error" };

function githubSettings(): GitHubSettings | null {
  const token = process.env.RYM_GITHUB_TOKEN;
  const owner = process.env.GITHUB_OWNER;
  const repo = process.env.GITHUB_REPO;
  const branch = process.env.GITHUB_BRANCH || "main";

  if (!token || !owner || !repo) return null;
  return { token, owner, repo, branch };
}

function githubHeaders(token: string) {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "rym-tracker-demo",
  };
}

function hashPin(pin: string, salt: string) {
  return scryptSync(pin, salt, 32).toString("hex");
}

function safeEqualHex(a: string, b: string) {
  try {
    const left = Buffer.from(a, "hex");
    const right = Buffer.from(b, "hex");
    if (left.length !== right.length || left.length === 0) return false;
    return timingSafeEqual(left, right);
  } catch {
    return false;
  }
}

async function readStoredPin(): Promise<StoredPin> {
  const settings = githubSettings();
  if (!settings) return { status: "error" };

  const apiUrl =
    `https://api.github.com/repos/${encodeURIComponent(settings.owner)}` +
    `/${encodeURIComponent(settings.repo)}/contents/${PIN_FILE_PATH}` +
    `?ref=${encodeURIComponent(settings.branch)}`;

  try {
    const response = await fetch(apiUrl, {
      headers: githubHeaders(settings.token),
      cache: "no-store",
    });

    if (response.status === 404) return { status: "missing" };

    if (!response.ok) {
      console.error("Could not read stored admin PIN:", response.status, await response.text());
      return { status: "error" };
    }

    const payload = await response.json();
    if (typeof payload?.content !== "string") return { status: "error" };

    const decoded = Buffer.from(
      payload.content.replace(/\n/g, ""),
      "base64"
    ).toString("utf8");

    const parsed = JSON.parse(decoded);

    if (
      typeof parsed?.salt === "string" &&
      typeof parsed?.hash === "string"
    ) {
      return { status: "found", salt: parsed.salt, hash: parsed.hash };
    }

    // Old HMAC-format files are intentionally treated as invalid.
    return { status: "error" };
  } catch (error) {
    console.error("Could not read stored admin PIN:", error);
    return { status: "error" };
  }
}

export async function verifyAdminPin(pin: string) {
  if (!/^\d{4}$/.test(pin)) return false;

  const stored = await readStoredPin();

  if (stored.status === "found") {
    const candidate = hashPin(pin, stored.salt);
    return safeEqualHex(stored.hash, candidate);
  }

  if (stored.status === "missing") {
    return pin === (process.env.ADMIN_PASSWORD || "1234");
  }

  return false;
}

export async function changeAdminPin(currentPin: string, newPin: string) {
  if (!(await verifyAdminPin(currentPin))) {
    return {
      ok: false as const,
      status: 401,
      error: "현재 비밀번호가 올바르지 않습니다.",
    };
  }

  if (!/^\d{4}$/.test(newPin)) {
    return {
      ok: false as const,
      status: 400,
      error: "새 비밀번호는 4자리 숫자여야 합니다.",
    };
  }

  const settings = githubSettings();
  if (!settings) {
    return {
      ok: false as const,
      status: 500,
      error: "비밀번호 저장을 위한 서버 설정이 없습니다.",
    };
  }

  const apiUrl =
    `https://api.github.com/repos/${encodeURIComponent(settings.owner)}` +
    `/${encodeURIComponent(settings.repo)}/contents/${PIN_FILE_PATH}`;

  const headers = githubHeaders(settings.token);
  let sha: string | undefined;

  const existing = await fetch(
    `${apiUrl}?ref=${encodeURIComponent(settings.branch)}`,
    { headers, cache: "no-store" }
  );

  if (existing.ok) {
    const existingData = await existing.json();
    if (typeof existingData?.sha === "string") sha = existingData.sha;
  } else if (existing.status !== 404) {
    return {
      ok: false as const,
      status: 502,
      error: "비밀번호 저장 상태를 확인할 수 없습니다.",
    };
  }

  const salt = randomBytes(16).toString("hex");
  const hash = hashPin(newPin, salt);

  const content = Buffer.from(
    JSON.stringify({ version: 2, salt, hash }, null, 2) + "\n",
    "utf8"
  ).toString("base64");

  const commit = await fetch(apiUrl, {
    method: "PUT",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({
      message: sha
        ? "Update RYM Tracker admin PIN"
        : "Add RYM Tracker admin PIN",
      content,
      branch: settings.branch,
      ...(sha ? { sha } : {}),
    }),
  });

  if (!commit.ok) {
    console.error("Could not save admin PIN:", commit.status, await commit.text());
    return {
      ok: false as const,
      status: 502,
      error: "새 비밀번호를 저장할 수 없습니다.",
    };
  }

  return { ok: true as const };
}
