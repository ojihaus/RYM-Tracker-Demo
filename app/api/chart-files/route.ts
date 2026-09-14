import { CHART_FILE_RE, MAX_CHART_BYTES, legacyPublicFilename, sanitizeSnapshot, snapshotPublicFilename } from "../../lib/chartModel";
import { listChartEntries, readChartBlob, readChartIndex } from "../../lib/chartStore";
import { checkGitHub, githubFetch, githubSettings, readGithubFile } from "../../lib/github";
import { requireAdminSession } from "../../lib/adminAuth";
import { errorResponse, HttpError, json, readJsonBody } from "../../lib/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const settings = githubSettings();
    const filename = new URL(request.url).searchParams.get("file");
    if (filename !== null && (!CHART_FILE_RE.test(filename) || filename.length > 160)) throw new HttpError(400, "INVALID_FILENAME", "Invalid chart filename.");
    const entries = await listChartEntries(settings);
    if (filename !== null) {
      const entry = entries.find((entry) => entry.name === filename);
      if (!entry) throw new HttpError(404, "NOT_FOUND", "This record was removed. Refresh the library.");
      return json({ filename, snapshot: await readChartBlob(settings, entry) });
    }
    return json(await readChartIndex(settings, entries));
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: Request) {
  try {
    const body = await readJsonBody(request, MAX_CHART_BYTES + 1024);
    await requireAdminSession(request);
    const snapshot = sanitizeSnapshot(body.snapshot);
    if (!snapshot || snapshot.is_metadata) throw new HttpError(400, "INVALID_RECORD", "Import a complete RYM song or album chart with valid, unique ranks.");
    const settings = githubSettings();
    let filename = snapshotPublicFilename(snapshot)!;
    let existing = await readGithubFile(settings, `public/${filename}`);
    const legacyName = legacyPublicFilename(snapshot);
    // Preserve the identity of old files on same-day replacements, but never
    // overwrite last year's chart just because the month/day match.
    if (!existing && legacyName) {
      const legacy = await readGithubFile(settings, `public/${legacyName}`);
      if (legacy) {
        const old = sanitizeSnapshot(JSON.parse(legacy.text));
        if (old?.captured_at.slice(0, 10) === snapshot.captured_at.slice(0, 10) && old.source_url === snapshot.source_url) { filename = legacyName; existing = legacy; }
      }
    }
    // Browser bookkeeping is not part of the persisted chart format.
    const content = { captured_at: snapshot.captured_at, source_url: snapshot.source_url, page_title: snapshot.page_title, visible_item_count: snapshot.songs.length, songs: snapshot.songs };
    const response = await githubFetch(settings, `/contents/public/${encodeURIComponent(filename)}`, {
      method: "PUT",
      body: JSON.stringify({ message: `${existing ? "Update" : "Add"} ${filename} from RYM Tracker`, branch: settings.branch,
        content: Buffer.from(JSON.stringify(content, null, 2) + "\n").toString("base64"), ...(existing ? { sha: existing.sha } : {}) }),
    });
    checkGitHub(response);
    const saved = await response.json();
    return json({ ok: true, filename, snapshot: { ...content, file_name: filename, file_sha: saved.content?.sha, is_metadata: false } });
  } catch (error) { return errorResponse(error); }
}

export async function DELETE(request: Request) {
  try {
    const body = await readJsonBody(request);
    await requireAdminSession(request);
    const filename = body.filename;
    if (typeof filename !== "string" || filename.length > 160 || !CHART_FILE_RE.test(filename)) throw new HttpError(400, "INVALID_FILENAME", "Invalid chart filename.");
    const settings = githubSettings();
    const path = `/contents/public/${encodeURIComponent(filename)}`;
    const existing = await readGithubFile(settings, `public/${encodeURIComponent(filename)}`);
    // A repeated delete is successful and must not resurrect a removed record.
    if (!existing) return json({ ok: true, filename, alreadyDeleted: true });
    if (typeof body.sha === "string" && body.sha !== existing.sha) throw new HttpError(409, "CONFLICT", "This record was updated. Refresh before deleting it.");
    const response = await githubFetch(settings, path, {
      method: "DELETE", body: JSON.stringify({ message: `Delete ${filename} from RYM Tracker`, sha: existing.sha, branch: settings.branch }),
    });
    checkGitHub(response);
    return json({ ok: true, filename });
  } catch (error) { return errorResponse(error); }
}
