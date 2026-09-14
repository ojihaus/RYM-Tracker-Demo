export type Song = {
  rank: number;
  title: string;
  artists: string[];
  release_date?: string;
  primary_genres?: string[];
  average_rating?: string;
  number_of_ratings?: string;
  rym_url?: string;
  album_art_url?: string;
  spotify_url?: string;
};

export type Snapshot = {
  captured_at: string;
  source_url: string;
  page_title?: string;
  visible_item_count: number;
  songs: Song[];
  file_name?: string;
  is_metadata?: boolean;
  file_sha?: string;
};

export type ChartGroup = {
  sourceUrl: string;
  title: string;
  snapshots: Snapshot[];
};

export type ComparedSong = Song & {
  previousRank: number | null;
  change: number | null;
  status: "NEW" | "UP" | "DOWN" | "SAME";
};

export type MovementFilter = "ALL" | "CHANGED" | "NEW" | "UP" | "DOWN" | "SAME" | "OUT";
export type Language = "en" | "ko";


export function isValidDateValue(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && Number.isFinite(new Date(value).getTime());
}

export function optionalString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function stringArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}

export const MAX_CHART_BYTES = 2 * 1024 * 1024;
export const MAX_CHART_ITEMS = 5000;
export const CHART_FILE_RE = /^(?:(?:2020s|2026)|(?:song|album)-[a-z0-9]+(?:-[a-z0-9]+)*)-(?:\d{4}|\d{4}-\d{2}-\d{2})\.json$/i;

export function safeUrl(value: unknown, hosts: string[]): string | undefined {
  if (typeof value !== "string" || value.length > 2048) return undefined;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" || url.username || url.password || url.port) return undefined;
    if (!hosts.some((host) => url.hostname === host)) return undefined;
    url.hash = "";
    return url.href;
  } catch { return undefined; }
}

export function canonicalChartUrl(value: unknown): string | undefined {
  const safe = safeUrl(value, ["rateyourmusic.com", "www.rateyourmusic.com"]);
  if (!safe) return undefined;
  const url = new URL(safe);
  if (!/^\/charts\/top\/(song|album)\/(all-time|\d{4}s?|\d{4}-\d{4})\/?$/i.test(url.pathname)) return undefined;
  // Tracking parameters do not define a separate chart; filtered charts are not
  // supported by this import format and must never overwrite an unfiltered chart.
  for (const key of [...url.searchParams.keys()]) {
    if (key.startsWith("utm_")) url.searchParams.delete(key);
  }
  if (url.search) return undefined;
  return `https://rateyourmusic.com${url.pathname.toLowerCase().replace(/\/?$/, "/")}`;
}

export function sanitizeSong(value: unknown): Song | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const rank = typeof raw.rank === "number" ? raw.rank : Number(raw.rank);
  const title = optionalString(raw.title);
  if (!Number.isSafeInteger(rank) || rank < 1 || rank > MAX_CHART_ITEMS || !title || title.length > 1000) return null;
  return {
    rank, title, artists: stringArray(raw.artists).slice(0, 50),
    release_date: optionalString(raw.release_date),
    primary_genres: stringArray(raw.primary_genres).slice(0, 50),
    average_rating: optionalString(raw.average_rating),
    number_of_ratings: optionalString(raw.number_of_ratings)?.replace(/^[\s/]+/, ""),
    rym_url: safeUrl(raw.rym_url, ["rateyourmusic.com", "www.rateyourmusic.com"]),
    album_art_url: safeUrl(raw.album_art_url, ["e.snmc.io", "f4.bcbits.com", "i.scdn.co"]),
    spotify_url: safeUrl(raw.spotify_url, ["open.spotify.com"]),
  };
}

export function sanitizeSnapshot(value: unknown): Snapshot | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const sourceUrl = canonicalChartUrl(raw.source_url);
  if (!sourceUrl || !isValidDateValue(raw.captured_at) || !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(raw.captured_at) || !Array.isArray(raw.songs) || raw.songs.length > MAX_CHART_ITEMS) return null;
  // Reject impossible calendar dates instead of allowing Date to roll them over.
  const datePart = raw.captured_at.slice(0, 10);
  if (new Date(`${datePart}T12:00:00Z`).toISOString().slice(0, 10) !== datePart) return null;
  const songs = raw.songs.map(sanitizeSong);
  if (songs.some((song) => !song)) return null;
  const validSongs = (songs as Song[]).sort((a, b) => a.rank - b.rank);
  if (new Set(validSongs.map(songKey)).size !== validSongs.length || new Set(validSongs.map((song) => song.rank)).size !== validSongs.length) return null;
  if (!raw.is_metadata && !validSongs.length) return null;
  const fileName = optionalString(raw.file_name);
  return {
    captured_at: new Date(raw.captured_at).toISOString(), source_url: sourceUrl,
    page_title: optionalString(raw.page_title),
    visible_item_count: raw.is_metadata && typeof raw.visible_item_count === "number" && Number.isSafeInteger(raw.visible_item_count) && raw.visible_item_count >= 0 ? raw.visible_item_count : validSongs.length,
    songs: validSongs,
    file_name: fileName && CHART_FILE_RE.test(fileName) ? fileName : undefined,
    file_sha: optionalString(raw.file_sha),
    is_metadata: raw.is_metadata === true,
  };
}

export function sanitizeSnapshotList(value: unknown): Snapshot[] {
  if (!Array.isArray(value)) return [];

  const deduped = new Map<string, Snapshot>();

  for (const item of value) {
    const snapshot = sanitizeSnapshot(item);
    if (snapshot) deduped.set(`${snapshot.source_url}__${snapshot.captured_at}`, snapshot);
  }

  return Array.from(deduped.values());
}

export function songKey(song: Song) {
  if (song.rym_url) {
    const url = new URL(song.rym_url);
    return url.pathname.replace(/\/+$/, "").toLowerCase();
  }
  return `${song.title.trim().toLowerCase()}__${song.artists.join("|").toLowerCase()}`;
}

export function snapshotKey(snapshot: Snapshot) {
  return `${snapshot.source_url}__${snapshot.captured_at}`;
}

export function snapshotChartIdentity(snapshot: Pick<Snapshot, "source_url" | "page_title">) {
  const sourceUrl = canonicalChartUrl(snapshot.source_url);
  const match = sourceUrl?.match(/\/charts\/top\/(song|album)\/([^/]+)\/$/);
  return match ? { kind: match[1] as ChartKind, period: match[2] } : null;
}

export function snapshotPublicFilename(snapshot: Snapshot) {
  const identity = snapshotChartIdentity(snapshot);
  if (!identity || !isValidDateValue(snapshot.captured_at)) return null;
  return `${identity.kind}-${identity.period}-${new Date(snapshot.captured_at).toISOString().slice(0, 10)}.json`;
}

export function legacyPublicFilename(snapshot: Snapshot) {
  const identity = snapshotChartIdentity(snapshot);
  if (!identity) return null;
  const prefix = identity.kind === "song" && ["2020s", "2026"].includes(identity.period) ? identity.period : `${identity.kind}-${identity.period}`;
  return `${prefix}-${new Date(snapshot.captured_at).toISOString().slice(5, 10).replace("-", "")}.json`;
}

export function spotifyEmbedUrl(value?: string) {
  const safe = safeUrl(value, ["open.spotify.com"]);
  if (!safe) return "";
  const match = new URL(safe).pathname.match(/^\/(?:intl-[^/]+\/)?(track|album)\/([A-Za-z0-9]{22})\/?$/);
  return match ? `https://open.spotify.com/embed/${match[1]}/${match[2]}?utm_source=generator&theme=0` : "";
}

export function formatDate(value: string, language: Language = "en") {
  return new Date(value).toLocaleDateString(language === "ko" ? "ko-KR" : "en-US", {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    timeZone: "UTC",
  });
}

export function formatChartTitle(value?: string) {
  return (value || "RYM Song Chart")
    .replace(/\s*[-–—]\s*Rate\s+Your\s+Music\s*$/i, "")
    .replace(/\s*\(\d+\)\s*$/i, "")
    .trim();
}

export type ChartKind = "song" | "album";

export function chartKind(chart: ChartGroup): ChartKind {
  return snapshotChartIdentity({ source_url: chart.sourceUrl })?.kind ?? "song";
}

export function chartPeriodLabel(chart: ChartGroup) {
  const period = snapshotChartIdentity({ source_url: chart.sourceUrl })?.period;
  return period === "all-time" ? "All time" : period?.replace(/(\d)-(\d)/g, "$1–$2") ?? formatChartTitle(chart.title);
}

export function dateId(value: string | Date) {
  const date =
    typeof value === "string"
      ? new Date(value)
      : value;

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

export function rymWeekStart(value: string | Date) {
  const input = typeof value === "string" ? new Date(value) : value;
  const date = new Date(
    Date.UTC(
      input.getUTCFullYear(),
      input.getUTCMonth(),
      input.getUTCDate(),
      12
    )
  );

  // Weekly UI uses a conventional Monday-Sunday week.
  const daysSinceMonday = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - daysSinceMonday);
  return date;
}

export function rymWeekKey(value: string | Date) {
  const start = rymWeekStart(value);
  const year = start.getUTCFullYear();
  const month = String(start.getUTCMonth() + 1).padStart(2, "0");
  const day = String(start.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function rymWeekMeta(value: string | Date) {
  const start = rymWeekStart(value);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 6);

  // Assign a cross-month week to the month containing Thursday.
  // This keeps one physical week under one label instead of splitting it.
  const anchor = new Date(start);
  anchor.setUTCDate(anchor.getUTCDate() + 3);

  return {
    start,
    end,
    year: anchor.getUTCFullYear(),
    month: anchor.getUTCMonth(),
    weekNumber: Math.ceil(anchor.getUTCDate() / 7),
  };
}

export function formatRymWeekLabel(value: string | Date, language: Language = "en") {
  const meta = rymWeekMeta(value);

  if (language === "ko") {
    return `${meta.year}년 ${meta.month + 1}월 ${meta.weekNumber}주차`;
  }

  const month = new Date(
    Date.UTC(meta.year, meta.month, 1, 12)
  ).toLocaleDateString("en-US", { month: "short" });

  return `${month} ${meta.year} · Week ${meta.weekNumber}`;
}

export function formatRymWeekRange(value: string | Date, language: Language = "en") {
  const { start, end } = rymWeekMeta(value);
  const sameYear = start.getUTCFullYear() === end.getUTCFullYear();
  const sameMonth =
    sameYear && start.getUTCMonth() === end.getUTCMonth();

  if (language === "ko") {
    if (sameMonth) {
      return `${start.getUTCMonth() + 1}. ${start.getUTCDate()}. – ${end.getUTCMonth() + 1}. ${end.getUTCDate()}.`;
    }

    return `${start.getUTCFullYear()}. ${start.getUTCMonth() + 1}. ${start.getUTCDate()}. – ${end.getUTCFullYear()}. ${end.getUTCMonth() + 1}. ${end.getUTCDate()}.`;
  }

  const startMonth = start.toLocaleDateString("en-US", {
    month: "short",
    timeZone: "UTC",
  });
  const endMonth = end.toLocaleDateString("en-US", {
    month: "short",
    timeZone: "UTC",
  });

  if (sameMonth) {
    return `${startMonth} ${start.getUTCDate()}–${end.getUTCDate()}`;
  }

  return `${startMonth} ${start.getUTCDate()} – ${endMonth} ${end.getUTCDate()}`;
}

export function weeklySnapshotRepresentatives(snapshots: Snapshot[]) {
  const byWeek = new Map<string, Snapshot>();

  for (const snapshot of snapshots) {
    const key = rymWeekKey(snapshot.captured_at);
    const current = byWeek.get(key);

    if (
      !current ||
      new Date(snapshot.captured_at).getTime() >
        new Date(current.captured_at).getTime()
    ) {
      byWeek.set(key, snapshot);
    }
  }

  return Array.from(byWeek.values()).sort(
    (a, b) =>
      rymWeekStart(a.captured_at).getTime() -
      rymWeekStart(b.captured_at).getTime()
  );
}

export function previousWeeklySnapshot(
  snapshots: Snapshot[],
  currentSnapshot: Snapshot | null
) {
  const weekly = weeklySnapshotRepresentatives(snapshots);
  if (!weekly.length) return null;

  if (!currentSnapshot) {
    return weekly[Math.max(0, weekly.length - 2)] ?? weekly[0];
  }

  const currentWeekStart = rymWeekStart(
    currentSnapshot.captured_at
  ).getTime();

  let previous: Snapshot | null = null;

  for (const snapshot of weekly) {
    const weekStart = rymWeekStart(snapshot.captured_at).getTime();

    if (weekStart < currentWeekStart) {
      previous = snapshot;
      continue;
    }

    break;
  }

  return previous ?? weekly[0];
}

export function formatTime(value: string, language: Language = "en") {
  return new Date(value).toLocaleTimeString(language === "ko" ? "ko-KR" : "en-US", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatRatingCount(value: string) {
  const normalized = value.replace(/^[\s/]+/, "").trim();
  const compactMatch = normalized.match(/^([\d,.]+)\s*([kKmMbB])$/);

  // RYM may already return compact counts such as "9k" or "6.3k".
  // Preserve the suffix instead of stripping it during numeric parsing.
  if (compactMatch) {
    const amount = Number(compactMatch[1].replace(/,/g, ""));
    if (!Number.isFinite(amount)) return value;
    return `${amount.toLocaleString("en-US", { maximumFractionDigits: 1 })}${compactMatch[2].toUpperCase()}`;
  }

  const number = Number(normalized.replace(/,/g, ""));
  if (!Number.isFinite(number)) return value;

  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(number);
}

export function buildCharts(snapshots: Snapshot[]) {
  const map = new Map<string, Snapshot[]>();

  for (const snapshot of snapshots) {
    const list = map.get(snapshot.source_url) ?? [];
    list.push(snapshot);
    map.set(snapshot.source_url, list);
  }

  return Array.from(map.entries())
    .map(([sourceUrl, items]) => {
      const sorted = [...items].sort(
        (a, b) =>
          new Date(a.captured_at).getTime() -
          new Date(b.captured_at).getTime()
      );

      return {
        sourceUrl,
        title: formatChartTitle(
          sorted[sorted.length - 1]?.page_title
        ),
        snapshots: sorted,
      };
    })
    .sort((a, b) => a.title.localeCompare(b.title));
}

export function findSnapshot(chart: ChartGroup | null, key: string) {
  if (!chart) return null;

  return (
    chart.snapshots.find(
      (snapshot) => snapshotKey(snapshot) === key
    ) ??
    chart.snapshots[chart.snapshots.length - 1] ??
    null
  );
}
