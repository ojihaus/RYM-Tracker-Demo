import { NextResponse } from "next/server";
import { verifyAdminPin } from "../../lib/adminAuth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const revalidate = 0;

const CHART_FILE_RE =
  /^(?:(?:2020s|2026)|(?:song|album)-[a-z0-9]+(?:-[a-z0-9]+)*)-\d{4}\.json$/i;

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
  Pragma: "no-cache",
  Expires: "0",
};

function githubHeaders(token: string) {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "rym-tracker-demo",
  };
}

async function githubReadFailure(response: Response, action: string) {
  const detail = await response.text();
  console.error(`${action}:`, response.status, detail);

  if (response.status === 401) {
    return NextResponse.json(
      { error: "GitHub server authentication failed." },
      { status: 502, headers: NO_STORE_HEADERS }
    );
  }

  if (
    response.status === 403 &&
    response.headers.get("x-ratelimit-remaining") === "0"
  ) {
    return NextResponse.json(
      { error: "GitHub API rate limit exceeded. Please try again shortly." },
      { status: 503, headers: NO_STORE_HEADERS }
    );
  }

  if (response.status === 403) {
    return NextResponse.json(
      {
        error:
          "GitHub repository access was denied. Check the server token permissions.",
      },
      { status: 502, headers: NO_STORE_HEADERS }
    );
  }

  if (response.status === 404) {
    return NextResponse.json(
      { error: "The GitHub chart data path could not be found." },
      { status: 502, headers: NO_STORE_HEADERS }
    );
  }

  return NextResponse.json(
    { error: "Could not read the latest chart data from GitHub." },
    { status: 502, headers: NO_STORE_HEADERS }
  );
}

function chartFilePart(value: string) {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function inferChartIdentity(snapshot: any) {
  const sourceUrl = String(snapshot?.source_url || "");
  const title = String(snapshot?.page_title || "");

  const kindMatch = sourceUrl.match(/\/charts\/top\/(song|album)(?:\/|$)/i);
  let kind: "song" | "album" | null =
    kindMatch?.[1]?.toLowerCase() === "album"
      ? "album"
      : kindMatch?.[1]?.toLowerCase() === "song"
      ? "song"
      : null;

  if (!kind) {
    if (/\balbums?\b/i.test(title)) kind = "album";
    else if (/\bsongs?\b/i.test(title)) kind = "song";
  }

  if (!kind) return null;

  let period = "";

  if (/\ball[\s-]*time\b/i.test(title)) {
    period = "all-time";
  }

  if (!period) {
    const between = title.match(
      /\bbetween\s+((?:19|20)\d{2})\s+(?:and|to|[-–—])\s+((?:19|20)\d{2})\b/i
    );
    if (between) period = `${between[1]}-${between[2]}`;
  }

  if (!period) {
    const decade = title.match(/\b((?:19|20)\d{2}s)\b/i);
    if (decade) period = decade[1].toLowerCase();
  }

  if (!period) {
    const year = title.match(/\b((?:19|20)\d{2})\b/);
    if (year) period = year[1];
  }

  if (!period) {
    const pathPeriod = sourceUrl.match(
      /\/charts\/top\/(?:song|album)\/([^/?#]+)\/?(?:[?#].*)?$/i
    )?.[1];

    if (pathPeriod) {
      try {
        period = decodeURIComponent(pathPeriod);
      } catch {
        period = pathPeriod;
      }
    }
  }

  const normalizedPeriod = chartFilePart(period || "all-time");
  if (!normalizedPeriod) return null;

  return { kind, period: normalizedPeriod };
}

function inferPublicFilename(snapshot: any) {
  const capturedAt = new Date(String(snapshot?.captured_at || ""));
  if (Number.isNaN(capturedAt.getTime())) return null;

  const identity = inferChartIdentity(snapshot);
  if (!identity) return null;

  const prefix =
    identity.kind === "song" &&
    (identity.period === "2020s" || identity.period === "2026")
      ? identity.period
      : `${identity.kind}-${identity.period}`;

  const month = String(capturedAt.getUTCMonth() + 1).padStart(2, "0");
  const day = String(capturedAt.getUTCDate()).padStart(2, "0");
  return `${prefix}-${month}${day}.json`;
}

function decodeGithubJson(payload: any, filename: string) {
  if (typeof payload?.content !== "string") {
    throw new Error(`GitHub chart file ${filename} has no readable content.`);
  }

  const decoded = Buffer.from(
    payload.content.replace(/\n/g, ""),
    "base64"
  ).toString("utf8");

  return JSON.parse(decoded);
}

function snapshotMetadata(snapshot: any, filename: string) {
  return {
    captured_at: snapshot?.captured_at,
    source_url: snapshot?.source_url,
    page_title: snapshot?.page_title,
    visible_item_count:
      typeof snapshot?.visible_item_count === "number"
        ? snapshot.visible_item_count
        : Array.isArray(snapshot?.songs)
        ? snapshot.songs.length
        : 0,
    songs: [],
    file_name: filename,
    is_metadata: true,
  };
}

async function githubSettings() {
  const token = process.env.RYM_GITHUB_TOKEN;
  const owner = process.env.GITHUB_OWNER;
  const repo = process.env.GITHUB_REPO;
  const branch = process.env.GITHUB_BRANCH || "main";

  if (!token || !owner || !repo) return null;

  return {
    token,
    owner,
    repo,
    branch,
    headers: githubHeaders(token),
  };
}

async function listChartEntries(settings: NonNullable<Awaited<ReturnType<typeof githubSettings>>>) {
  const publicApiUrl =
    `https://api.github.com/repos/${encodeURIComponent(settings.owner)}/` +
    `${encodeURIComponent(settings.repo)}/contents/public?ref=${encodeURIComponent(settings.branch)}`;

  const directoryResponse = await fetch(publicApiUrl, {
    headers: settings.headers,
    cache: "no-store",
  });

  if (!directoryResponse.ok) {
    return { errorResponse: await githubReadFailure(directoryResponse, "Could not list GitHub chart files") };
  }

  const directoryPayload = await directoryResponse.json();

  if (!Array.isArray(directoryPayload)) {
    return {
      errorResponse: NextResponse.json(
        { error: "GitHub returned an unexpected chart directory response." },
        { status: 502, headers: NO_STORE_HEADERS }
      ),
    };
  }

  const entries = directoryPayload
    .filter(
      (entry: any) =>
        entry?.type === "file" &&
        typeof entry?.name === "string" &&
        typeof entry?.url === "string" &&
        CHART_FILE_RE.test(entry.name)
    )
    .sort((a: any, b: any) => a.name.localeCompare(b.name));

  return { entries };
}

async function readChartEntry(
  settings: NonNullable<Awaited<ReturnType<typeof githubSettings>>>,
  entry: any
) {
  const fileUrl =
    `${entry.url}${entry.url.includes("?") ? "&" : "?"}` +
    `ref=${encodeURIComponent(settings.branch)}`;

  const fileResponse = await fetch(fileUrl, {
    headers: settings.headers,
    cache: "no-store",
  });

  if (!fileResponse.ok) {
    throw new Error(
      `Could not read GitHub chart file ${entry.name} (${fileResponse.status})`
    );
  }

  const filePayload = await fileResponse.json();
  return decodeGithubJson(filePayload, entry.name);
}

export async function GET(request: Request) {
  const settings = await githubSettings();

  if (!settings) {
    return NextResponse.json(
      { error: "GitHub server settings are missing" },
      { status: 500, headers: NO_STORE_HEADERS }
    );
  }

  const requestUrl = new URL(request.url);
  const filename = requestUrl.searchParams.get("file");

  try {
    if (filename) {
      if (!CHART_FILE_RE.test(filename)) {
        return NextResponse.json(
          { error: "Invalid chart filename" },
          { status: 400, headers: NO_STORE_HEADERS }
        );
      }

      const apiUrl =
        `https://api.github.com/repos/${encodeURIComponent(settings.owner)}/` +
        `${encodeURIComponent(settings.repo)}/contents/public/${encodeURIComponent(filename)}` +
        `?ref=${encodeURIComponent(settings.branch)}`;

      const fileResponse = await fetch(apiUrl, {
        headers: settings.headers,
        cache: "no-store",
      });

      if (!fileResponse.ok) {
        return githubReadFailure(
          fileResponse,
          `Could not read GitHub chart file ${filename}`
        );
      }

      const payload = await fileResponse.json();
      const snapshot = decodeGithubJson(payload, filename);

      return NextResponse.json(
        { filename, snapshot },
        { headers: NO_STORE_HEADERS }
      );
    }

    const listed = await listChartEntries(settings);
    if ("errorResponse" in listed && listed.errorResponse) {
      return listed.errorResponse;
    }

    const entries = listed.entries ?? [];

    // Initial requests receive metadata only. The browser then requests the
    // two records it is actually comparing, and additional records on demand.
    const snapshots = await Promise.all(
      entries.map(async (entry: any) => {
        try {
          const snapshot = await readChartEntry(settings, entry);
          return snapshotMetadata(snapshot, entry.name);
        } catch (error) {
          console.error("Could not build chart metadata:", entry.name, error);
          return null;
        }
      })
    );

    return NextResponse.json(
      {
        files: entries.map((entry: any) => entry.name),
        snapshots: snapshots.filter(Boolean),
      },
      { headers: NO_STORE_HEADERS }
    );
  } catch (error) {
    console.error("Could not load live GitHub chart data:", error);
    return NextResponse.json(
      { error: "Could not load the latest chart data from GitHub." },
      { status: 502, headers: NO_STORE_HEADERS }
    );
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

    if (
      !snapshot ||
      !Array.isArray(snapshot.songs) ||
      !snapshot.source_url ||
      !snapshot.captured_at
    ) {
      return NextResponse.json(
        { error: "Invalid chart record" },
        { status: 400 }
      );
    }

    const filename = inferPublicFilename(snapshot);
    if (!filename) {
      return NextResponse.json(
        {
          error:
            "Unsupported chart. Import a Rate Your Music top song or album chart.",
        },
        { status: 400 }
      );
    }

    const settings = await githubSettings();
    if (!settings) {
      return NextResponse.json(
        { error: "GitHub server settings are missing" },
        { status: 500 }
      );
    }

    const githubPath = `public/${filename}`;
    const apiUrl =
      `https://api.github.com/repos/${encodeURIComponent(settings.owner)}/` +
      `${encodeURIComponent(settings.repo)}/contents/${githubPath}`;

    let sha: string | undefined;
    const existing = await fetch(
      `${apiUrl}?ref=${encodeURIComponent(settings.branch)}`,
      {
        headers: settings.headers,
        cache: "no-store",
      }
    );

    if (existing.ok) {
      const existingData = await existing.json();
      if (typeof existingData?.sha === "string") sha = existingData.sha;
    } else if (existing.status !== 404) {
      const detail = await existing.text();
      console.error("GitHub lookup failed:", existing.status, detail);
      return NextResponse.json(
        { error: "Could not check the GitHub file" },
        { status: 502 }
      );
    }

    const jsonText = JSON.stringify(snapshot, null, 2) + "\n";
    const content = Buffer.from(jsonText, "utf8").toString("base64");

    const commitResponse = await fetch(apiUrl, {
      method: "PUT",
      headers: {
        ...settings.headers,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message: `${sha ? "Update" : "Add"} ${filename} from RYM Tracker`,
        content,
        branch: settings.branch,
        ...(sha ? { sha } : {}),
      }),
    });

    if (!commitResponse.ok) {
      const detail = await commitResponse.text();
      console.error("GitHub commit failed:", commitResponse.status, detail);
      return NextResponse.json(
        { error: "GitHub upload failed" },
        { status: 502 }
      );
    }

    return NextResponse.json({ ok: true, filename });
  } catch (error) {
    console.error("Could not publish chart record:", error);
    return NextResponse.json({ error: "Upload failed" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const body = await request.json();
    const password = String(body?.password || "");
    const filename = String(body?.filename || "");

    if (!(await verifyAdminPin(password))) {
      return NextResponse.json({ error: "Incorrect password" }, { status: 401 });
    }

    if (!CHART_FILE_RE.test(filename)) {
      return NextResponse.json(
        { error: "Invalid chart filename" },
        { status: 400 }
      );
    }

    const settings = await githubSettings();
    if (!settings) {
      return NextResponse.json(
        { error: "GitHub server settings are missing" },
        { status: 500 }
      );
    }

    const githubPath = `public/${filename}`;
    const apiUrl =
      `https://api.github.com/repos/${encodeURIComponent(settings.owner)}/` +
      `${encodeURIComponent(settings.repo)}/contents/${githubPath}`;

    const existing = await fetch(
      `${apiUrl}?ref=${encodeURIComponent(settings.branch)}`,
      {
        headers: settings.headers,
        cache: "no-store",
      }
    );

    if (existing.status === 404) {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }

    if (!existing.ok) {
      const detail = await existing.text();
      console.error("GitHub lookup failed:", existing.status, detail);
      return NextResponse.json(
        { error: "Could not check the GitHub file" },
        { status: 502 }
      );
    }

    const existingData = await existing.json();
    const sha = String(existingData?.sha || "");

    if (!sha) {
      return NextResponse.json(
        { error: "Could not resolve file SHA" },
        { status: 502 }
      );
    }

    const deleteResponse = await fetch(apiUrl, {
      method: "DELETE",
      headers: {
        ...settings.headers,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message: `Delete ${filename} from RYM Tracker`,
        sha,
        branch: settings.branch,
      }),
    });

    if (!deleteResponse.ok) {
      const detail = await deleteResponse.text();
      console.error("GitHub delete failed:", deleteResponse.status, detail);
      return NextResponse.json(
        { error: "GitHub delete failed" },
        { status: 502 }
      );
    }

    return NextResponse.json({ ok: true, filename });
  } catch (error) {
    console.error("Could not delete chart record:", error);
    return NextResponse.json({ error: "Delete failed" }, { status: 500 });
  }
}
