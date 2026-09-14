import { CHART_FILE_RE, MAX_CHART_BYTES, sanitizeSnapshot, type Snapshot } from "./chartModel";
import { checkGitHub, githubFetch, type GitHubSettings } from "./github";
import { HttpError } from "./http";

type Entry = { name: string; sha: string; size: number };
// Only metadata is cached. Its key is an immutable Git blob SHA, so overwrites
// are visible as soon as the uncached directory listing changes.
const metadataCache = new Map<string, Snapshot>();
const pending = new Map<string, Promise<Snapshot>>();

export async function listChartEntries(settings: GitHubSettings): Promise<Entry[]> {
  const response = await githubFetch(settings, `/contents/public?ref=${encodeURIComponent(settings.branch)}`);
  checkGitHub(response);
  const data: unknown = await response.json();
  if (!Array.isArray(data)) throw new HttpError(502, "INVALID_STORAGE", "Could not read the chart index.");
  return data.filter((entry): entry is Entry => entry?.type === "file" && typeof entry.name === "string" && CHART_FILE_RE.test(entry.name) && typeof entry.sha === "string" && typeof entry.size === "number").sort((a, b) => a.name.localeCompare(b.name));
}

export async function readChartBlob(settings: GitHubSettings, entry: Entry): Promise<Snapshot> {
  if (entry.size > MAX_CHART_BYTES) throw new HttpError(413, "TOO_LARGE", "This chart file is too large.");
  const response = await githubFetch(settings, `/git/blobs/${entry.sha}`);
  checkGitHub(response);
  const payload = await response.json();
  if (typeof payload.content !== "string" || payload.encoding !== "base64") throw new HttpError(502, "INVALID_RECORD", "This chart record is unreadable.");
  const raw = Buffer.from(payload.content.replace(/\n/g, ""), "base64");
  if (raw.length > MAX_CHART_BYTES) throw new HttpError(413, "TOO_LARGE", "This chart file is too large.");
  let snapshot: Snapshot | null = null;
  try { snapshot = sanitizeSnapshot(JSON.parse(raw.toString("utf8"))); } catch { /* Report the record, never a partial chart. */ }
  if (!snapshot || snapshot.is_metadata) throw new HttpError(502, "INVALID_RECORD", "This chart record has invalid or duplicate entries.");
  return { ...snapshot, file_name: entry.name, file_sha: entry.sha, is_metadata: false };
}

async function metadata(settings: GitHubSettings, entry: Entry) {
  const key = `${settings.owner}/${settings.repo}:${entry.name}:${entry.sha}`;
  const cached = metadataCache.get(key);
  if (cached) return cached;
  const inFlight = pending.get(key);
  if (inFlight) return inFlight;
  const task = readChartBlob(settings, entry).then((snapshot) => {
    const value = { ...snapshot, songs: [], is_metadata: true };
    if (metadataCache.size >= 1000) metadataCache.delete(metadataCache.keys().next().value!);
    metadataCache.set(key, value);
    return value;
  }).finally(() => pending.delete(key));
  pending.set(key, task);
  return task;
}

export async function readChartIndex(settings: GitHubSettings, entries: Entry[]) {
  const snapshots: Snapshot[] = [];
  const failedFiles: string[] = [];
  let cursor = 0;
  // Limit fan-out on cold starts; a warm index needs just the directory request.
  await Promise.all(Array.from({ length: Math.min(4, entries.length) }, async () => {
    while (cursor < entries.length) {
      const entry = entries[cursor++];
      try { snapshots.push(await metadata(settings, entry)); }
      catch { failedFiles.push(entry.name); }
    }
  }));
  if (entries.length && !snapshots.length) throw new HttpError(502, "INDEX_UNAVAILABLE", "The chart library could not be loaded. Please try again.");
  return { files: entries.map((entry) => entry.name), snapshots, failedFiles };
}
