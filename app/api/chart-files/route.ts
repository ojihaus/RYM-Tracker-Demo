import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { verifyAdminPin } from "../../lib/adminAuth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function inferPublicFilename(snapshot: any) {
  const sourceUrl = String(snapshot?.source_url || "");
  const capturedAt = new Date(String(snapshot?.captured_at || ""));

  if (Number.isNaN(capturedAt.getTime())) return null;

  let prefix = "";
  if (/\/charts\/top\/song\/2020s\/?$/i.test(sourceUrl)) prefix = "2020s";
  else if (/\/charts\/top\/song\/2026\/?$/i.test(sourceUrl)) prefix = "2026";
  else return null;

  const month = String(capturedAt.getUTCMonth() + 1).padStart(2, "0");
  const day = String(capturedAt.getUTCDate()).padStart(2, "0");
  return `${prefix}-${month}${day}.json`;
}

export async function GET() {
  try {
    const publicDir = path.join(process.cwd(), "public");
    const entries = await fs.readdir(publicDir, { withFileTypes: true });

    const files = entries
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name)
      .filter((name) => /^(?:2020s|2026)-\d{4}\.json$/i.test(name))
      .sort();

    return NextResponse.json(
      { files },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    console.error("Could not scan public chart files:", error);
    return NextResponse.json({ files: [] }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const password = String(body?.password || "");
    const snapshot = body?.snapshot;

    if (!(await verifyAdminPin(password))) {
      return NextResponse.json({ error: "Incorrect password" }, { status: 401 });
    }

    if (!snapshot || !Array.isArray(snapshot.songs) || !snapshot.source_url || !snapshot.captured_at) {
      return NextResponse.json({ error: "Invalid chart record" }, { status: 400 });
    }

    const filename = inferPublicFilename(snapshot);
    if (!filename) {
      return NextResponse.json(
        { error: "Only the 2020s and 2026 song charts are supported by this demo." },
        { status: 400 }
      );
    }

    const token = process.env.RYM_GITHUB_TOKEN;
    const owner = process.env.GITHUB_OWNER;
    const repo = process.env.GITHUB_REPO;
    const branch = process.env.GITHUB_BRANCH || "main";

    if (!token || !owner || !repo) {
      return NextResponse.json(
        { error: "GitHub server settings are missing" },
        { status: 500 }
      );
    }

    const githubPath = `public/${filename}`;
    const apiUrl = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${githubPath}`;
    const headers = {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "rym-tracker-demo",
    };

    let sha: string | undefined;
    const existing = await fetch(`${apiUrl}?ref=${encodeURIComponent(branch)}`, {
      headers,
      cache: "no-store",
    });

    if (existing.ok) {
      const existingData = await existing.json();
      if (typeof existingData?.sha === "string") sha = existingData.sha;
    } else if (existing.status !== 404) {
      const detail = await existing.text();
      console.error("GitHub lookup failed:", existing.status, detail);
      return NextResponse.json({ error: "Could not check the GitHub file" }, { status: 502 });
    }

    const jsonText = JSON.stringify(snapshot, null, 2) + "\n";
    const content = Buffer.from(jsonText, "utf8").toString("base64");

    const commitResponse = await fetch(apiUrl, {
      method: "PUT",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({
        message: `${sha ? "Update" : "Add"} ${filename} from RYM Tracker`,
        content,
        branch,
        ...(sha ? { sha } : {}),
      }),
    });

    if (!commitResponse.ok) {
      const detail = await commitResponse.text();
      console.error("GitHub commit failed:", commitResponse.status, detail);
      return NextResponse.json({ error: "GitHub upload failed" }, { status: 502 });
    }

    return NextResponse.json({ ok: true, filename });
  } catch (error) {
    console.error("Could not publish chart record:", error);
    return NextResponse.json({ error: "Upload failed" }, { status: 500 });
  }
}
