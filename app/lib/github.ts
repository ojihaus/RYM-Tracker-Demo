import { HttpError } from "./http";

export function githubSettings() {
  const token = process.env.RYM_GITHUB_TOKEN;
  const owner = process.env.GITHUB_OWNER;
  const repo = process.env.GITHUB_REPO;
  const branch = process.env.GITHUB_BRANCH || "main";
  if (!token || !owner || !repo) throw new HttpError(503, "NOT_CONFIGURED", "Chart storage is not configured.");
  const base = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  return { token, owner, repo, branch, base };
}

export type GitHubSettings = ReturnType<typeof githubSettings>;

export async function githubFetch(settings: GitHubSettings, path: string, init: RequestInit = {}) {
  try {
    return await fetch(settings.base + path, {
      ...init,
      headers: {
        Accept: "application/vnd.github+json", Authorization: `Bearer ${settings.token}`,
        "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "rym-tracker", "Content-Type": "application/json",
        ...init.headers,
      },
      cache: "no-store",
      signal: AbortSignal.timeout(12000),
    });
  } catch {
    throw new HttpError(504, "UPSTREAM_TIMEOUT", "Chart storage did not respond in time. Please try again.");
  }
}

export function checkGitHub(response: Response) {
  if (response.ok) return;
  if (response.status === 409 || response.status === 422) throw new HttpError(409, "CONFLICT", "This record changed. Refresh and try again.");
  if (response.status === 429 || (response.status === 403 && (response.headers.get("x-ratelimit-remaining") === "0" || response.headers.has("retry-after")))) {
    throw new HttpError(503, "RATE_LIMITED", "Chart storage is busy. Please try again shortly.", Math.max(1, Number(response.headers.get("retry-after")) || 60));
  }
  throw new HttpError(502, "STORAGE_ERROR", "Could not access chart storage. Please try again.");
}

export async function readGithubFile(settings: GitHubSettings, path: string) {
  const response = await githubFetch(settings, `/contents/${path}?ref=${encodeURIComponent(settings.branch)}`);
  if (response.status === 404) return null;
  checkGitHub(response);
  const payload = await response.json();
  if (typeof payload.sha !== "string" || typeof payload.content !== "string" || payload.encoding !== "base64") {
    throw new HttpError(502, "INVALID_STORAGE", "Chart storage returned an unreadable file.");
  }
  return { sha: payload.sha as string, text: Buffer.from(payload.content.replace(/\n/g, ""), "base64").toString("utf8") };
}
