"use client";

// RYM Tracker Demo v1.0 — frozen demo baseline.

import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { createPortal } from "react-dom";

type Song = {
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

type Snapshot = {
  captured_at: string;
  source_url: string;
  page_title?: string;
  visible_item_count: number;
  songs: Song[];
  file_name?: string;
  is_metadata?: boolean;
};

type ChartGroup = {
  sourceUrl: string;
  title: string;
  snapshots: Snapshot[];
};

type ComparedSong = Song & {
  previousRank: number | null;
  change: number | null;
  status: "NEW" | "UP" | "DOWN" | "SAME";
};

type MovementFilter = "ALL" | "CHANGED" | "NEW" | "UP" | "DOWN" | "SAME" | "OUT";
type Language = "en" | "ko";

const STORAGE_KEY = "rym-tracker-snapshots-v1";
const LANGUAGE_KEY = "rym-tracker-language-v1";

function isValidDateValue(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && Number.isFinite(new Date(value).getTime());
}

function optionalString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function stringArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}

function sanitizeSong(value: unknown): Song | null {
  if (!value || typeof value !== "object") return null;

  const raw = value as Record<string, unknown>;
  const rank = typeof raw.rank === "number" ? raw.rank : Number(raw.rank);
  const title = typeof raw.title === "string" ? raw.title.trim() : "";

  if (!Number.isFinite(rank) || rank < 1 || !title) return null;

  return {
    rank: Math.trunc(rank),
    title,
    artists: stringArray(raw.artists),
    release_date: optionalString(raw.release_date),
    primary_genres: stringArray(raw.primary_genres),
    average_rating: optionalString(raw.average_rating),
    number_of_ratings: optionalString(raw.number_of_ratings),
    rym_url: optionalString(raw.rym_url),
    album_art_url: optionalString(raw.album_art_url),
    spotify_url: optionalString(raw.spotify_url),
  };
}

function sanitizeSnapshot(value: unknown): Snapshot | null {
  if (!value || typeof value !== "object") return null;

  const raw = value as Record<string, unknown>;
  const sourceUrl = typeof raw.source_url === "string" ? raw.source_url.trim() : "";

  if (!sourceUrl || !isValidDateValue(raw.captured_at) || !Array.isArray(raw.songs)) {
    return null;
  }

  const songs = raw.songs
    .map(sanitizeSong)
    .filter((song): song is Song => song !== null);

  if (raw.songs.length > 0 && songs.length === 0) return null;

  const visibleItemCount =
    typeof raw.visible_item_count === "number" && Number.isFinite(raw.visible_item_count)
      ? Math.max(0, Math.trunc(raw.visible_item_count))
      : songs.length;

  return {
    captured_at: raw.captured_at,
    source_url: sourceUrl,
    page_title: optionalString(raw.page_title),
    visible_item_count: visibleItemCount,
    songs,
    file_name: optionalString(raw.file_name),
    is_metadata: raw.is_metadata === true,
  };
}

function sanitizeSnapshotList(value: unknown): Snapshot[] {
  if (!Array.isArray(value)) return [];

  const deduped = new Map<string, Snapshot>();

  for (const item of value) {
    const snapshot = sanitizeSnapshot(item);
    if (snapshot) deduped.set(`${snapshot.source_url}__${snapshot.captured_at}`, snapshot);
  }

  return Array.from(deduped.values());
}

async function fetchSnapshotIndex(): Promise<Snapshot[]> {
  const response = await fetch(`/api/chart-files?mode=index&ts=${Date.now()}`, {
    cache: "no-store",
    headers: { Accept: "application/json" },
  });

  const result = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(
      result?.error || "Could not load the latest chart library."
    );
  }

  if (!Array.isArray(result?.snapshots)) {
    throw new Error("The chart library response is invalid.");
  }

  return sanitizeSnapshotList(result.snapshots);
}

async function fetchSnapshotFile(filename: string): Promise<Snapshot> {
  const response = await fetch(
    `/api/chart-files?file=${encodeURIComponent(filename)}&ts=${Date.now()}`,
    {
      cache: "no-store",
      headers: { Accept: "application/json" },
    }
  );

  const result = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(
      result?.error || "Could not load this chart record."
    );
  }

  const snapshot = sanitizeSnapshot(result?.snapshot);
  if (!snapshot) {
    throw new Error("The chart record response is invalid.");
  }

  return {
    ...snapshot,
    file_name: filename,
    is_metadata: false,
  };
}

function songKey(song: Song) {
  if (song.rym_url) return song.rym_url;
  return `${song.title}__${song.artists?.join("|")}`;
}

function snapshotKey(snapshot: Snapshot) {
  return `${snapshot.source_url}__${snapshot.captured_at}`;
}

function chartFilePart(value: string) {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function snapshotChartIdentity(snapshot: Pick<Snapshot, "source_url" | "page_title">) {
  const sourceUrl = String(snapshot.source_url || "");
  const title = String(snapshot.page_title || "");

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

function snapshotPublicFilename(snapshot: Snapshot) {
  const capturedAt = new Date(snapshot.captured_at);
  if (Number.isNaN(capturedAt.getTime())) return null;

  const identity = snapshotChartIdentity(snapshot);
  if (!identity) return null;

  // Keep the original filenames for the two existing demo chart families,
  // so old records continue to overwrite/delete the same GitHub files.
  let prefix =
    identity.kind === "song" &&
    (identity.period === "2020s" || identity.period === "2026")
      ? identity.period
      : `${identity.kind}-${identity.period}`;

  const month = String(capturedAt.getUTCMonth() + 1).padStart(2, "0");
  const day = String(capturedAt.getUTCDate()).padStart(2, "0");
  return `${prefix}-${month}${day}.json`;
}

function formatDate(value: string, language: Language = "en") {
  return new Date(value).toLocaleDateString(language === "ko" ? "ko-KR" : "en-US", {
    year: "numeric",
    month: "numeric",
    day: "numeric",
  });
}

function formatChartTitle(value?: string) {
  return (value || "RYM Song Chart")
    .replace(/\s*[-–—]\s*Rate\s+Your\s+Music\s*$/i, "")
    .replace(/\s*\(\d+\)\s*$/i, "")
    .trim();
}

type ChartKind = "song" | "album";

function chartKind(chart: ChartGroup): ChartKind {
  if (/\/charts\/top\/album(?:\/|$)/i.test(chart.sourceUrl) || /\balbums?\b/i.test(chart.title)) {
    return "album";
  }

  return "song";
}

function chartPeriodLabel(chart: ChartGroup) {
  const title = formatChartTitle(chart.title);

  if (/\ball[\s-]*time\b/i.test(title)) return "All time";

  const between = title.match(
    /\bbetween\s+((?:19|20)\d{2})\s+(?:and|to|[-–—])\s+((?:19|20)\d{2})\b/i
  );
  if (between) return `${between[1]}–${between[2]}`;

  const decade = title.match(/\b((?:19|20)\d{2}s)\b/i);
  if (decade) return decade[1];

  const year = title.match(/\b((?:19|20)\d{2})\b/);
  if (year) return year[1];

  const pathPeriod = chart.sourceUrl.match(
    /\/charts\/top\/(?:song|album)\/([^/?#]+)\/?(?:[?#].*)?$/i
  )?.[1];

  if (pathPeriod) {
    try {
      return decodeURIComponent(pathPeriod).replace(/_/g, " ");
    } catch {
      return pathPeriod.replace(/_/g, " ");
    }
  }

  return title;
}

function dateId(value: string | Date) {
  const date =
    typeof value === "string"
      ? new Date(value)
      : value;

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function rymWeekStart(value: string | Date) {
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

function rymWeekKey(value: string | Date) {
  const start = rymWeekStart(value);
  const year = start.getUTCFullYear();
  const month = String(start.getUTCMonth() + 1).padStart(2, "0");
  const day = String(start.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function rymWeekMeta(value: string | Date) {
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

function formatRymWeekLabel(value: string | Date, language: Language = "en") {
  const meta = rymWeekMeta(value);

  if (language === "ko") {
    return `${meta.year}년 ${meta.month + 1}월 ${meta.weekNumber}주차`;
  }

  const month = new Date(
    Date.UTC(meta.year, meta.month, 1, 12)
  ).toLocaleDateString("en-US", { month: "short" });

  return `${month} ${meta.year} · Week ${meta.weekNumber}`;
}

function formatRymWeekRange(value: string | Date, language: Language = "en") {
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

function weeklySnapshotRepresentatives(snapshots: Snapshot[]) {
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

function previousWeeklySnapshot(
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

function formatTime(value: string, language: Language = "en") {
  return new Date(value).toLocaleTimeString(language === "ko" ? "ko-KR" : "en-US", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatRatingCount(value: string) {
  const normalized = value.trim();
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

function buildCharts(snapshots: Snapshot[]) {
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

function findSnapshot(chart: ChartGroup | null, key: string) {
  if (!chart) return null;

  return (
    chart.snapshots.find(
      (snapshot) => snapshotKey(snapshot) === key
    ) ??
    chart.snapshots[chart.snapshots.length - 1] ??
    null
  );
}


type RymIconName =
  | "up" | "down" | "minus" | "star" | "upload"
  | "calendar" | "library" | "left" | "right" | "close" | "search" | "globe";

function RymIcon({ name, className = "" }: { name: RymIconName; className?: string }) {
  const solid = name === "up" || name === "down" || name === "star";
  const paths: Record<RymIconName, string> = {
    up: "M12 3 23 21H1Z",
    down: "M1 3h22L12 21Z",
    minus: "M5 12h14",
    star: "m12 2.5 2.95 5.98 6.6.96-4.78 4.66 1.13 6.57L12 17.57l-5.9 3.1 1.13-6.57L2.45 9.44l6.6-.96L12 2.5Z",
    upload: "M12 16V3m-5 5 5-5 5 5M4 15v5a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-5",
    calendar: "M8 2v4m8-4v4M3 9h18M5 4h14a2 2 0 0 1 2 2v14H3V6a2 2 0 0 1 2-2ZM7 13h2m3 0h2m3 0h1M7 17h2m3 0h2",
    library: "M4 4h16v17H4V4Zm4-2v4m8-4v4M8 10h8m-8 4h8m-8 4h5",
    left: "m14 5-7 7 7 7",
    right: "m10 5 7 7-7 7",
    close: "m6 6 12 12M6 18 18 6",
    search: "m21 21-4.35-4.35m1.35-5.65a7 7 0 1 1-14 0 7 7 0 0 1 14 0Z",
    globe: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Zm0-20c2.35 2.74 3.56 6.08 3.56 10S14.35 19.26 12 22m0-20C9.65 4.74 8.44 8.08 8.44 12S9.65 19.26 12 22M2.5 9h19M2.5 15h19",
  };
  return (
    <svg className={"rym-icon " + className} viewBox="0 0 24 24"
      width="20" height="20" fill={solid ? "currentColor" : "none"}
      stroke={solid ? "none" : "currentColor"} strokeWidth="1.8"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d={paths[name]} />
    </svg>
  );
}

function movement(song: ComparedSong, language: Language = "en") {
  if (song.status === "NEW") return <span className="rym-status rym-status--new">{language === "ko" ? "신규" : "NEW"}</span>;
  if (song.status === "SAME") {
    return (
      <span className="rym-movement rym-movement--same" role="img" aria-label={language === "ko" ? "순위 변동 없음" : "No rank change"} title={language === "ko" ? "순위 변동 없음" : "No rank change"}>
        <RymIcon name="minus" />
      </span>
    );
  }
  const up = song.status === "UP";
  const amount = Math.abs(song.change ?? 0);
  const label = language === "ko"
    ? `${up ? "상승" : "하락"} ${amount}계단`
    : (up ? "Up " : "Down ") + amount + " position" + (amount === 1 ? "" : "s");
  return (
    <span className={"rym-movement " + (up ? "rym-movement--up" : "rym-movement--down")}
      role="img" aria-label={label} title={label}>
      <RymIcon name={up ? "up" : "down"} />
      <span aria-hidden="true">{amount}</span>
    </span>
  );
}

function Cover({ song, compact = false, expanded = false }: { song: Song; compact?: boolean; expanded?: boolean }) {
  const className =
    "rym-cover" +
    (compact ? " rym-cover--compact" : "") +
    (expanded ? " rym-cover--expanded" : "");
  return (
    <div className={className}>
      {song.album_art_url ? (
        <img key={song.album_art_url} src={song.album_art_url} alt=""
          loading="lazy" decoding="async" referrerPolicy="no-referrer"
          onError={(event) => {
            event.currentTarget.style.display = "none";
            event.currentTarget.parentElement?.classList.add("is-missing");
          }} />
      ) : (
        <span className="rym-cover-empty" aria-label="No cover image">—</span>
      )}
    </div>
  );
}

function spotifyEmbedUrl(url?: string) {
  if (!url) return "";
  const match = url.match(/open\.spotify\.com\/(?:intl-[^/]+\/)?track\/([A-Za-z0-9]+)/i);
  if (!match) return "";
  return `https://open.spotify.com/embed/track/${match[1]}?utm_source=generator&theme=0`;
}

function SpotifyAutoPlayer({ url, title, language }: {
  url: string;
  title: string;
  language: Language;
}) {
  // Important: Spotify's createController() REPLACES the element passed to it.
  // React therefore owns only this outer host. The disposable mount node inside it
  // is created imperatively so Spotify can safely replace/remove it.
  const hostRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    let controller: any = null;
    const spotifyWindow = window as any;
    const host = hostRef.current;

    if (!host) return;

    // React does not own anything inside `host`.
    host.replaceChildren();
    const mountNode = document.createElement("div");
    mountNode.className = "rym-spotify-mount";
    host.appendChild(mountNode);

    const createPlayer = (IFrameAPI: any) => {
      if (cancelled || !IFrameAPI || !mountNode.isConnected) return;

      IFrameAPI.createController(
        mountNode,
        {
          url,
          width: "100%",
          height: 152,
        },
        (EmbedController: any) => {
          if (cancelled) {
            try { EmbedController.destroy?.(); } catch {}
            return;
          }

          controller = EmbedController;

          // Prefer playing as soon as the controller reports that the Embed is ready.
          // If the event has already fired, the fallback requestAnimationFrame still
          // attempts playback from the user's explicit button click.
          let played = false;
          const tryPlay = () => {
            if (cancelled || played) return;
            played = true;
            try { EmbedController.play(); } catch {}
          };

          try {
            EmbedController.addListener?.("ready", tryPlay);
          } catch {}

          requestAnimationFrame(tryPlay);
        },
      );
    };

    if (spotifyWindow.__rymSpotifyIframeApi) {
      createPlayer(spotifyWindow.__rymSpotifyIframeApi);
    } else {
      const previousReady = spotifyWindow.onSpotifyIframeApiReady;

      spotifyWindow.onSpotifyIframeApiReady = (IFrameAPI: any) => {
        spotifyWindow.__rymSpotifyIframeApi = IFrameAPI;

        if (typeof previousReady === "function") {
          try { previousReady(IFrameAPI); } catch {}
        }

        createPlayer(IFrameAPI);
      };

      if (!document.querySelector('script[data-rym-spotify-iframe-api="true"]')) {
        const script = document.createElement("script");
        script.src = "https://open.spotify.com/embed/iframe-api/v1";
        script.async = true;
        script.dataset.rymSpotifyIframeApi = "true";
        document.body.appendChild(script);
      }
    }

    return () => {
      cancelled = true;

      // Spotify owns the generated iframe, so let its controller remove it.
      // Do NOT manually remove the original mount node after createController(),
      // because Spotify may already have replaced it.
      try {
        controller?.destroy?.();
      } catch {
        try { controller?.pause?.(); } catch {}
      }

      // Only clear whatever remains inside the React-owned outer host.
      // replaceChildren() is safe here because React never renders children into it.
      try {
        host.replaceChildren();
      } catch {}
    };
  }, [url]);

  return (
    <div
      ref={hostRef}
      className="rym-spotify-controller"
      role="group"
      aria-label={(language === "ko" ? "재생바: " : "Player: ") + title}
    />
  );
}

function SongCard({ song, compact = false, comparedSong = null, out = false, language = "en", activeSpotifyUrl = "", onToggleSpotify }: {
  song: Song;
  compact?: boolean;
  comparedSong?: ComparedSong | null;
  out?: boolean;
  language?: Language;
  activeSpotifyUrl?: string;
  onToggleSpotify?: (url: string) => void;
}) {
  const highlight = !compact && !out && comparedSong && comparedSong.status !== "SAME"
    ? " rym-song--" + comparedSong.status.toLowerCase()
    : "";
  const releaseDate = song.release_date;
  const genreLabel = song.primary_genres?.slice(0, 2).join(" / ");
  const embedUrl = spotifyEmbedUrl(song.spotify_url);
  const spotifyActive = Boolean(embedUrl && activeSpotifyUrl === song.spotify_url);

  return (
    <article className={"rym-song" + (compact ? " rym-song--compact" : "") + (out ? " rym-song--out" : "") + (!compact && spotifyActive ? " rym-song--playing" : "") + highlight}>
      <div className="rym-rank">
        <span className="rym-rank-number" aria-label={(language === "ko" ? "순위 " : "Rank ") + song.rank}>{song.rank}</span>
        {!compact && (out
          ? <span className="rym-status rym-status--out">{language === "ko" ? "이탈" : "OUT"}</span>
          : comparedSong && movement(comparedSong, language))}
      </div>
      <Cover song={song} compact={compact} expanded={!compact && spotifyActive} />
      <div className="rym-song-body">
        <div className="rym-song-info-transition">
          <h3 className="rym-song-title">{song.title}</h3>
          <p className="rym-song-artists">{song.artists?.join(", ")}</p>
          {!compact && releaseDate && (
            <p className="rym-song-date">{releaseDate}</p>
          )}
          {!compact && genreLabel && (
            <p className="rym-song-genre">{genreLabel}</p>
          )}
        </div>
        {!compact && (
          <>
            {(embedUrl || song.rym_url) && (
              <div className="rym-song-actions">
                {embedUrl && (
                  <button type="button" className={"rym-preview-button" + (spotifyActive ? " is-active" : "")}
                    onClick={() => onToggleSpotify?.(song.spotify_url || "")}
                    aria-expanded={spotifyActive}
                    aria-label={spotifyActive
                      ? (language === "ko" ? "재생바 닫기" : "Close player")
                      : (language === "ko" ? "재생" : "Play")}>
                    <span className={spotifyActive ? "rym-preview-pause" : "rym-preview-play"} aria-hidden="true" />
                  </button>
                )}
                {song.rym_url && (
                  <a
                    className="rym-rym-button"
                    href={song.rym_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={language === "ko" ? `${song.title} RYM 페이지 새 탭에서 열기` : `Open ${song.title} on RYM in a new tab`}
                    title={language === "ko" ? "RYM에서 열기" : "Open on RYM"}
                  >
                    <img
                      className="rym-rym-logo-image"
                      src="data:image/png;base64,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"
                      alt=""
                      aria-hidden="true"
                    />
                  </a>
                )}
              </div>
            )}
            {embedUrl && (
              <div
                className={"rym-player-shell" + (spotifyActive ? " is-open" : "")}
                aria-hidden={!spotifyActive}
              >
                <div className="rym-player-reveal">
                  {spotifyActive && (
                    <SpotifyAutoPlayer
                      url={song.spotify_url || ""}
                      title={song.title}
                      language={language}
                    />
                  )}
                </div>
              </div>
            )}
            <div className="rym-song-bottom">
              {comparedSong?.previousRank != null && (
                <span className="rym-rank-route" title={(language === "ko" ? "이전 순위 #" : "Previous rank #") + comparedSong.previousRank}>
                  <span>#{comparedSong.previousRank}</span><span className="rym-rank-route-arrow">→</span><strong>#{song.rank}</strong>
                </span>
              )}
              {song.average_rating && (
                <span className="rym-rating">
                  <RymIcon name="star" />
                  <strong>{song.average_rating}</strong>
                  {song.number_of_ratings && (
                    <span className="rym-rating-count" title={language === "ko" ? song.number_of_ratings + "개 평점" : song.number_of_ratings + " ratings"}>
                      {formatRatingCount(song.number_of_ratings)}
                    </span>
                  )}
                </span>
              )}
            </div>
          </>
        )}
      </div>
    </article>
  );
}

type SnapshotCalendarProps = {
  snapshots: Snapshot[];
  selectedKey: string;
  onSelect: (value: string) => void;
  compact?: boolean;
  language?: Language;
};

function SnapshotCalendar({
  snapshots,
  selectedKey,
  onSelect,
  compact = false,
  language = "en",
}: SnapshotCalendarProps) {
  const selectedSnapshot =
    snapshots.find(
      (item) => snapshotKey(item) === selectedKey
    ) ??
    weeklySnapshotRepresentatives(snapshots).at(-1) ??
    null;

  const selectedMeta = selectedSnapshot
    ? rymWeekMeta(selectedSnapshot.captured_at)
    : rymWeekMeta(new Date());

  const earliestSnapshot = useMemo(() => {
    if (!snapshots.length) return null;

    return [...snapshots].sort(
      (a, b) =>
        new Date(a.captured_at).getTime() -
        new Date(b.captured_at).getTime()
    )[0];
  }, [snapshots]);

  const earliestWeekKey = earliestSnapshot
    ? rymWeekKey(earliestSnapshot.captured_at)
    : "";

  const earliestMeta = earliestSnapshot
    ? rymWeekMeta(earliestSnapshot.captured_at)
    : null;

  const [monthCursor, setMonthCursor] = useState(
    () => new Date(selectedMeta.year, selectedMeta.month, 1)
  );

  useEffect(() => {
    if (!selectedSnapshot) return;

    const nextMeta = rymWeekMeta(selectedSnapshot.captured_at);
    setMonthCursor(
      new Date(nextMeta.year, nextMeta.month, 1)
    );
  }, [selectedKey]);

  const snapshotsByWeek = useMemo(() => {
    const map = new Map<string, Snapshot[]>();

    for (const item of snapshots) {
      const key = rymWeekKey(item.captured_at);
      const list = map.get(key) ?? [];
      list.push(item);
      map.set(key, list);
    }

    for (const list of map.values()) {
      list.sort(
        (a, b) =>
          new Date(a.captured_at).getTime() -
          new Date(b.captured_at).getTime()
      );
    }

    return map;
  }, [snapshots]);

  const year = monthCursor.getFullYear();
  const month = monthCursor.getMonth();

  const monthWeeks = useMemo(() => {
    const firstOfMonth = new Date(Date.UTC(year, month, 1, 12));
    const daysUntilThursday = (4 - firstOfMonth.getUTCDay() + 7) % 7;
    const firstThursday = new Date(firstOfMonth);
    firstThursday.setUTCDate(
      firstThursday.getUTCDate() + daysUntilThursday
    );

    const weeks: Date[] = [];

    for (
      let anchor = firstThursday;
      anchor.getUTCMonth() === month &&
      anchor.getUTCFullYear() === year;
      anchor = new Date(anchor.getTime() + 7 * 24 * 60 * 60 * 1000)
    ) {
      const monday = new Date(anchor);
      monday.setUTCDate(monday.getUTCDate() - 3);
      weeks.push(monday);
    }

    if (!earliestSnapshot || !earliestMeta) return weeks;

    const earliestMonthIndex =
      earliestMeta.year * 12 + earliestMeta.month;
    const currentMonthIndex = year * 12 + month;

    if (currentMonthIndex < earliestMonthIndex) return [];

    return weeks;
  }, [year, month, earliestSnapshot, earliestMeta]);

  const monthLabel =
    monthCursor.toLocaleDateString(language === "ko" ? "ko-KR" : "en-US", {
      month: "long",
      year: "numeric",
    });

  const selectedWeekKey = selectedSnapshot
    ? rymWeekKey(selectedSnapshot.captured_at)
    : "";

  const earliestMonthIndex = earliestMeta
    ? earliestMeta.year * 12 + earliestMeta.month
    : null;
  const currentMonthIndex = year * 12 + month;
  const canMoveToPreviousMonth =
    earliestMonthIndex === null ||
    currentMonthIndex > earliestMonthIndex;

  const earliestWeekStartTime = earliestSnapshot
    ? rymWeekStart(earliestSnapshot.captured_at).getTime()
    : null;

  const isTrackingStartMonth =
    earliestMeta !== null &&
    earliestMeta.year === year &&
    earliestMeta.month === month;

  const trackingStartMessage =
    earliestMeta
      ? language === "ko"
        ? `해당 차트는 ${earliestMeta.month + 1}월 ${earliestMeta.weekNumber}주차부터 기록이 시작되었습니다.`
        : `Tracking for this chart began in ${new Date(
            Date.UTC(earliestMeta.year, earliestMeta.month, 1)
          ).toLocaleDateString("en-US", { month: "long" })} week ${earliestMeta.weekNumber}.`
      : "";

  function moveMonth(amount: number) {
    setMonthCursor(
      new Date(year, month + amount, 1)
    );
  }

  function selectWeek(weekStart: Date) {
    const key = rymWeekKey(weekStart);
    const items = snapshotsByWeek.get(key) ?? [];
    if (!items.length) return;

    // Multiple imports inside one week represent the same RYM chart cycle.
    // The latest captured file in that week is the representative snapshot.
    const latest = items[items.length - 1];
    onSelect(snapshotKey(latest));
  }

  return (
    <div className="rym-calendar rym-week-calendar">
      <div className="rym-calendar-heading">
        {canMoveToPreviousMonth ? (
          <button type="button" onClick={() => moveMonth(-1)} className="rym-icon-button" aria-label={language === "ko" ? "이전 달" : "Previous month"}>
            <RymIcon name="left" />
          </button>
        ) : (
          <span className="rym-calendar-nav-spacer" aria-hidden="true" />
        )}
        <p className={compact ? "rym-calendar-month rym-calendar-month--compact" : "rym-calendar-month"}>{monthLabel}</p>
        <button type="button" onClick={() => moveMonth(1)} className="rym-icon-button" aria-label={language === "ko" ? "다음 달" : "Next month"}>
          <RymIcon name="right" />
        </button>
      </div>

      <div className="rym-calendar-weeks" role="list" aria-label={language === "ko" ? "주차 선택" : "Choose week"}>
        {(() => {
          let insertedTrackingStartMessage = false;

          return monthWeeks.map((weekStart) => {
            const key = rymWeekKey(weekStart);
            const weekRecords = snapshotsByWeek.get(key) ?? [];
            const hasSnapshot = weekRecords.length > 0;
            const isSelected = selectedWeekKey === key;
            const meta = rymWeekMeta(weekStart);

            const isBeforeTrackingStart =
              isTrackingStartMonth &&
              earliestWeekStartTime !== null &&
              weekStart.getTime() < earliestWeekStartTime;

            if (isBeforeTrackingStart) {
              if (insertedTrackingStartMessage) return null;
              insertedTrackingStartMessage = true;

              return (
                <div
                  key={`tracking-start-${key}`}
                  className="rym-calendar-week-button rym-calendar-week-button--tracking-start"
                  role="note"
                >
                  <span className="rym-calendar-week-copy">
                    <strong>{trackingStartMessage}</strong>
                  </span>
                </div>
              );
            }

            return (
              <button
                key={key}
                type="button"
                disabled={!hasSnapshot}
                onClick={() => selectWeek(weekStart)}
                className={"rym-calendar-week-button" + (isSelected ? " is-selected" : "")}
                aria-pressed={isSelected}
                aria-label={
                  language === "ko"
                    ? `${meta.year}년 ${meta.month + 1}월 ${meta.weekNumber}주차, ${hasSnapshot ? "기록 있음" : "기록 없음"}`
                    : `${formatRymWeekLabel(weekStart, "en")}, ${hasSnapshot ? "record available" : "no record"}`
                }
              >
                <span className="rym-calendar-week-copy">
                  <strong>
                    {language === "ko"
                      ? `${meta.month + 1}월 ${meta.weekNumber}주차`
                      : `Week ${meta.weekNumber}`}
                  </strong>
                  <span>{formatRymWeekRange(weekStart, language)}</span>
                </span>
                {hasSnapshot && (
                  <span className="rym-calendar-week-indicator" aria-hidden="true" />
                )}
              </button>
            );
          });
        })()}
      </div>
    </div>
  );
}

type ChartPaneProps = {
  side: "LEFT" | "RIGHT";
  compact?: boolean;
  charts: ChartGroup[];
  chartUrl: string;
  snapshotKeyValue: string;
  onChartChange: (value: string) => void;
  onSnapshotChange: (value: string) => void;
  snapshot: Snapshot | null;
  comparedSongs?: ComparedSong[] | null;
  outSongs?: Song[];
  comparisonActive?: boolean;
  filter?: MovementFilter;
  query?: string;
  roleLabel?: string;
  language?: Language;
  activeSpotifyUrl?: string;
  onToggleSpotify?: (url: string) => void;
};

function ChartPane({
  side,
  compact = false,
  charts,
  chartUrl,
  snapshotKeyValue,
  onChartChange,
  onSnapshotChange,
  snapshot,
  comparedSongs = null,
  outSongs = [],
  comparisonActive = false,
  filter = "ALL",
  query = "",
  roleLabel,
  language = "en",
  activeSpotifyUrl = "",
  onToggleSpotify,
}: ChartPaneProps) {
  const chart =
    charts.find((item) => item.sourceUrl === chartUrl) ??
    null;

  const sourceSongs: Array<Song | ComparedSong> =
    comparisonActive && comparedSongs
      ? comparedSongs
      : snapshot?.songs ?? [];

  const normalizedQuery = query.trim().toLocaleLowerCase();
  const matchesQuery = (song: Song) => {
    if (!normalizedQuery) return true;
    const haystack = [song.title, ...(song.artists ?? []), ...(song.primary_genres ?? [])]
      .join(" ")
      .toLocaleLowerCase();
    return haystack.includes(normalizedQuery);
  };

  const visibleSongs = sourceSongs.filter((song) => {
    if (!matchesQuery(song)) return false;
    if (!comparisonActive || compact || !("status" in song)) return true;
    if (filter === "OUT") return false;
    if (filter === "CHANGED") return song.status !== "SAME";
    if (filter !== "ALL" && song.status !== filter) return false;
    return true;
  });

  const visibleOutSongs = outSongs.filter(matchesQuery);
  const showOut = comparisonActive && !compact && (filter === "ALL" || filter === "OUT") && visibleOutSongs.length > 0;
  const displayedCount =
    snapshot?.is_metadata && !comparisonActive
      ? snapshot.visible_item_count
      : filter === "OUT"
      ? visibleOutSongs.length
      : visibleSongs.length;

  const [chartPickerOpen, setChartPickerOpen] = useState(false);
  const [compactCollapsed, setCompactCollapsed] = useState(() => {
    if (!compact) return false;
    if (typeof window === "undefined") return false;
    return window.innerWidth <= 1023;
  });
  const [pickerKind, setPickerKind] = useState<ChartKind>(
    chart ? chartKind(chart) : "song"
  );
  const paneSpringRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!compact || typeof window === "undefined" || window.innerWidth < 1024) {
      return;
    }

    const pane = paneSpringRef.current;
    if (!pane) return;

    let lastScrollY = window.scrollY;
    let targetY = 0;
    let currentY = 0;
    let velocity = 0;
    let frame = 0;
    let settleTimer: number | null = null;

    const tick = () => {
      const spring = (targetY - currentY) * 0.15;
      velocity = (velocity + spring) * 0.73;
      currentY += velocity;

      if (Math.abs(currentY) < 0.01 && Math.abs(velocity) < 0.01) {
        currentY = 0;
        velocity = 0;
      }

      pane.style.setProperty("--rym-scroll-react-y", `${currentY.toFixed(2)}px`);
      frame = requestAnimationFrame(tick);
    };

    const handleScroll = () => {
      const currentScrollY = window.scrollY;
      const delta = currentScrollY - lastScrollY;
      lastScrollY = currentScrollY;

      const impulse = Math.max(-12, Math.min(12, -delta * 0.32));
      targetY = impulse;

      if (settleTimer !== null) window.clearTimeout(settleTimer);
      settleTimer = window.setTimeout(() => {
        targetY = 0;
      }, 75);
    };

    frame = requestAnimationFrame(tick);
    window.addEventListener("scroll", handleScroll, { passive: true });

    return () => {
      window.removeEventListener("scroll", handleScroll);
      cancelAnimationFrame(frame);
      if (settleTimer !== null) window.clearTimeout(settleTimer);
    };
  }, [compact]);

  const chartPickerRef = useRef<HTMLDivElement>(null);
  const chartPickerButtonRef = useRef<HTMLButtonElement>(null);
  const chartPickerPopoverRef = useRef<HTMLDivElement>(null);
  const [chartPickerFloatingStyle, setChartPickerFloatingStyle] =
    useState<CSSProperties>({});

  useEffect(() => {
    if (chart) setPickerKind(chartKind(chart));
  }, [chartUrl]);

  useEffect(() => {
    if (!chartPickerOpen) return;

    function updatePickerPosition() {
      const button = chartPickerButtonRef.current;
      if (!button) return;

      const rect = button.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const edge = 12;
      const gap = 8;
      const width = Math.min(360, viewportWidth - edge * 2);
      const maxHeight = Math.min(520, viewportHeight - edge * 2);

      let left = rect.left;
      left = Math.max(edge, Math.min(left, viewportWidth - width - edge));

      const spaceBelow = viewportHeight - rect.bottom - gap - edge;
      const spaceAbove = rect.top - gap - edge;
      const openAbove = spaceBelow < Math.min(380, maxHeight) && spaceAbove > spaceBelow;

      const top = openAbove
        ? Math.max(edge, rect.top - Math.min(maxHeight, spaceAbove) - gap)
        : Math.min(rect.bottom + gap, viewportHeight - edge);

      setChartPickerFloatingStyle({
        position: "fixed",
        top,
        left,
        width,
        maxHeight: openAbove
          ? Math.min(maxHeight, Math.max(220, spaceAbove))
          : Math.min(maxHeight, Math.max(220, spaceBelow)),
      });
    }

    function handlePointerDown(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Node)) return;

      const insideTrigger = chartPickerRef.current?.contains(target);
      const insidePopover = chartPickerPopoverRef.current?.contains(target);

      if (!insideTrigger && !insidePopover) {
        setChartPickerOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setChartPickerOpen(false);
    }

    updatePickerPosition();

    window.addEventListener("resize", updatePickerPosition);
    window.addEventListener("scroll", updatePickerPosition, true);
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("resize", updatePickerPosition);
      window.removeEventListener("scroll", updatePickerPosition, true);
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [chartPickerOpen]);

  const availableKinds: Record<ChartKind, boolean> = {
    song: charts.some((item) => chartKind(item) === "song"),
    album: charts.some((item) => chartKind(item) === "album"),
  };

  const periodOptions = Array.from(
    charts
      .filter((item) => chartKind(item) === pickerKind)
      .reduce((map, item) => {
        const label = chartPeriodLabel(item);
        if (!map.has(label) || item.sourceUrl === chartUrl) map.set(label, item);
        return map;
      }, new Map<string, ChartGroup>())
      .entries()
  )
    .map(([label, item]) => ({ label, item }))
    .sort((a, b) =>
      a.label.localeCompare(b.label, language === "ko" ? "ko-KR" : "en-US", {
        numeric: true,
      })
    );

  const selectedChartKind: ChartKind = chart ? chartKind(chart) : "song";
  const selectedChartPeriod = chart ? chartPeriodLabel(chart) : "";
  const selectedWeekMeta = snapshot
    ? rymWeekMeta(snapshot.captured_at)
    : null;
  const selectedWeekShort = selectedWeekMeta
    ? (
        language === "ko"
          ? `${selectedWeekMeta.month + 1}월 ${selectedWeekMeta.weekNumber}주차`
          : `${new Date(Date.UTC(selectedWeekMeta.year, selectedWeekMeta.month, 1, 12)).toLocaleDateString("en-US", { month: "short" })} W${selectedWeekMeta.weekNumber}`
      )
    : "";
  const selectedWeekLabel = snapshot
    ? formatRymWeekLabel(snapshot.captured_at, language)
    : "";
  const selectedChartLabel =
    selectedChartKind === "album"
      ? (language === "ko" ? "앨범 차트" : "Albums")
      : (language === "ko" ? "곡 차트" : "Songs");
  const displayedUnit =
    selectedChartKind === "album"
      ? (language === "ko" ? "앨범" : " albums")
      : (language === "ko" ? "곡" : " songs");

  const resolvedRoleLabel = roleLabel ?? (side === "LEFT" ? (language === "ko" ? "기준" : "REFERENCE") : (language === "ko" ? "대상" : "TARGET"));

  return (
    <section
      ref={paneSpringRef}
      className={
        "rym-pane" +
        (compact ? " rym-pane--compact" : "") +
        (compact && compactCollapsed ? " rym-pane--collapsed" : "")
      }
      aria-label={side + " chart"}
    >
      {compact ? (
        <button
          type="button"
          className="rym-pane-heading rym-pane-heading--toggle"
          aria-expanded={!compactCollapsed}
          onClick={() => {
            setCompactCollapsed((current) => !current);
            setChartPickerOpen(false);
          }}
        >
          <span className="rym-pane-heading-main">
            <span className="rym-pane-caption">
              <span className={"rym-role-badge " + (side === "RIGHT" ? " rym-role-badge--target" : " rym-role-badge--reference")}>
                {resolvedRoleLabel}
              </span>
              <span className="rym-count-pill">{displayedCount}{displayedUnit}</span>
            </span>

            <span className="rym-pane-title-row">
              <span className="rym-chart-title">{formatChartTitle(snapshot?.page_title)}</span>
              <span className="rym-pane-heading-week">{selectedWeekShort}</span>
            </span>
          </span>

          <span
            className={
              "rym-pane-heading-chevron" +
              (!compactCollapsed ? " is-open" : "")
            }
            aria-hidden="true"
          />
        </button>
      ) : (
        <div className="rym-pane-heading">
          <div className="rym-pane-caption">
            <span className={"rym-role-badge " + (side === "RIGHT" ? " rym-role-badge--target" : " rym-role-badge--reference")}>{resolvedRoleLabel}</span>
            <span className="rym-count-pill">{displayedCount}{displayedUnit}</span>
          </div>
          <h2 className="rym-chart-title">{formatChartTitle(snapshot?.page_title)}</h2>
        </div>
      )}

      {(!compact || !compactCollapsed) && (
        <div className={compact ? "rym-compact-expand-body" : undefined}>
          <div className="rym-chart-controls">
            <div className="rym-chart-control-row">
              <div className="rym-chart-picker-field rym-chart-picker-field--unified" ref={chartPickerRef}>
                <button
                  id={"rym-chart-picker-" + side}
                  ref={chartPickerButtonRef}
                  type="button"
                  className="rym-chart-picker-trigger rym-chart-picker-trigger--unified"
                  aria-expanded={chartPickerOpen}
                  aria-controls={"rym-chart-picker-popover-" + side}
                  onClick={() => setChartPickerOpen((current) => !current)}
                >
                  <span className="rym-chart-picker-summary-title">
                    {selectedChartKind === "album" ? "Albums" : "Songs"}
                    {selectedChartPeriod ? ` · ${selectedChartPeriod}` : ""}
                  </span>

                  <span className="rym-chart-picker-week-badge">
                    {selectedWeekShort || (language === "ko" ? "시점 선택" : "Choose week")}
                  </span>

                  <span className="rym-chart-picker-caret" aria-hidden="true" />
                </button>

                {chartPickerOpen && typeof document !== "undefined" && createPortal(
                  <div className="rym-app rym-chart-picker-portal" aria-hidden="false">
                    <div
                      id={"rym-chart-picker-popover-" + side}
                      ref={chartPickerPopoverRef}
                      className="rym-chart-picker-popover rym-chart-picker-popover--unified"
                      role="dialog"
                      aria-label={language === "ko" ? "차트와 주차 선택" : "Choose chart and week"}
                      style={chartPickerFloatingStyle}
                    >
                      <div className="rym-chart-picker-section">
                        <p className="rym-chart-picker-section-label">
                          {language === "ko" ? "차트 유형" : "Chart type"}
                        </p>
                        <div className="rym-chart-kind-switch">
                          {(["song", "album"] as ChartKind[]).map((kind) => {
                            const disabled = !availableKinds[kind];
                            const active = pickerKind === kind;

                            return (
                              <button
                                key={kind}
                                type="button"
                                disabled={disabled}
                                className={"rym-chart-kind-button" + (active ? " is-active" : "")}
                                aria-pressed={active}
                                onClick={() => setPickerKind(kind)}
                              >
                                {kind === "song" ? "Songs" : "Albums"}
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      <div className="rym-chart-picker-section">
                        <p className="rym-chart-picker-section-label">
                          {language === "ko" ? "기간" : "Period"}
                        </p>
                        <div className="rym-chart-period-list">
                          {periodOptions.map(({ label, item }) => {
                            const active = item.sourceUrl === chartUrl;

                            return (
                              <button
                                key={item.sourceUrl}
                                type="button"
                                className={"rym-chart-period-button" + (active ? " is-active" : "")}
                                aria-pressed={active}
                                onClick={() => {
                                  onChartChange(item.sourceUrl);
                                  setPickerKind(chartKind(item));
                                }}
                              >
                                {label}
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      {chart && (
                        <div className="rym-chart-picker-section rym-chart-picker-week-section">
                          <SnapshotCalendar
                            snapshots={chart.snapshots}
                            selectedKey={snapshotKeyValue}
                            onSelect={(value) => {
                              onSnapshotChange(value);
                              setChartPickerOpen(false);
                            }}
                            compact={compact}
                            language={language}
                          />
                        </div>
                      )}
                    </div>
                  </div>,
                  document.body
                )}
              </div>
            </div>
          </div>

          <div className="rym-song-list" tabIndex={0} role="region" aria-label={side + " chart items"}>
            {visibleSongs.map((song) => (
              <SongCard key={songKey(song)} song={song} compact={compact}
                comparedSong={comparisonActive && "status" in song ? song as ComparedSong : null} language={language}
                activeSpotifyUrl={activeSpotifyUrl} onToggleSpotify={onToggleSpotify} />
            ))}
            {showOut && (
              <section className="rym-out-section" aria-label={language === "ko" ? "대상 차트에서 이탈한 곡" : "Songs out of the target chart"}>
                <div className="rym-out-heading">
                  <h3>{language === "ko" ? "이탈" : "OUT"} <span>{visibleOutSongs.length}</span></h3>
                  <p>{language === "ko" ? "기준 기록에는 있지만 대상 기록에서는 사라진 곡입니다." : "Present in the reference record, missing from the target record."}</p>
                </div>
                {visibleOutSongs.map((song) => <SongCard key={songKey(song)} song={song} out language={language}
                  activeSpotifyUrl={activeSpotifyUrl} onToggleSpotify={onToggleSpotify} />)}
              </section>
            )}
            {!compact && visibleSongs.length === 0 && !showOut && (
              <div className="rym-filter-empty">{language === "ko" ? "이 조건에 맞는 곡이 없습니다." : "No songs match this view."}</div>
            )}
          </div>
        </div>
      )}
    </section>
  );}

export default function Home() {
  const [snapshots, setRecords] = useState<Snapshot[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");

  const [leftChartUrl, setLeftChartUrl] = useState("");
  const [rightChartUrl, setRightChartUrl] = useState("");
  const [leftSnapshotKey, setLeftSnapshotKey] = useState("");
  const [rightSnapshotKey, setRightSnapshotKey] = useState("");

  const [libraryOpen, setLibraryOpen] = useState(false);
  const [selectedForDelete, setSelectedForDelete] = useState<string[]>([]);
  const [movementFilter, setMovementFilter] = useState<MovementFilter>("ALL");
  const [searchQuery, setSearchQuery] = useState("");
  const [language, setLanguage] = useState<Language>("en");
  const [activeSpotifyUrl, setActiveSpotifyUrl] = useState("");
  const [urlStateReady, setUrlStateReady] = useState(false);
  const initialComparisonAppliedRef = useRef(false);
  const [adminPassword, setAdminPassword] = useState("");
  const [adminModalOpen, setAdminModalOpen] = useState(false);
  const [adminAction, setAdminAction] = useState<"IMPORT" | "LIBRARY" | null>(null);
  const [adminPin, setAdminPin] = useState("");
  const [adminPinError, setAdminPinError] = useState("");
  const [adminVerifying, setAdminVerifying] = useState(false);
  const [pinChangeOpen, setPinChangeOpen] = useState(false);
  const [currentPin, setCurrentPin] = useState("");
  const [newPin, setNewPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [pinChangeError, setPinChangeError] = useState("");
  const [pinChanging, setPinChanging] = useState(false);
  const importInputRef = useRef<HTMLInputElement>(null);
  const scrollTopButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const button = scrollTopButtonRef.current;
    if (!button) return;

    let lastScrollY = window.scrollY;
    let targetY = 0;
    let currentY = 0;
    let velocity = 0;
    let frame = 0;
    let settleTimer: number | null = null;

    const tick = () => {
      const spring = (targetY - currentY) * 0.16;
      velocity = (velocity + spring) * 0.72;
      currentY += velocity;

      if (Math.abs(currentY) < 0.01 && Math.abs(velocity) < 0.01) {
        currentY = 0;
        velocity = 0;
      }

      button.style.setProperty("--rym-react-y", `${currentY.toFixed(2)}px`);
      frame = requestAnimationFrame(tick);
    };

    const handleScrollReaction = () => {
      const currentScrollY = window.scrollY;
      const delta = currentScrollY - lastScrollY;
      lastScrollY = currentScrollY;

      // Page down -> floating button reacts upward.
      // Page up -> floating button reacts downward.
      const impulse = Math.max(-14, Math.min(14, -delta * 0.38));
      targetY = impulse;

      if (settleTimer !== null) {
        window.clearTimeout(settleTimer);
      }

      settleTimer = window.setTimeout(() => {
        targetY = 0;
      }, 70);
    };

    frame = requestAnimationFrame(tick);
    window.addEventListener("scroll", handleScrollReaction, { passive: true });

    return () => {
      window.removeEventListener("scroll", handleScrollReaction);
      cancelAnimationFrame(frame);

      if (settleTimer !== null) {
        window.clearTimeout(settleTimer);
      }
    };
  }, []);


  async function ensureSnapshotLoaded(target: Snapshot | null) {
    if (!target || !target.is_metadata || !target.file_name) return;

    try {
      const fullSnapshot = await fetchSnapshotFile(target.file_name);

      setRecords((current) =>
        current.map((item) =>
          snapshotKey(item) === snapshotKey(target)
            ? {
                ...fullSnapshot,
                file_name: target.file_name,
                is_metadata: false,
              }
            : item
        )
      );
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Could not load this chart record.";
      setError(message);
    }
  }

  useEffect(() => {
    let cancelled = false;

    async function loadInitialSnapshots() {
      // Chart records are shared server data now. Never restore stale per-device
      // snapshot copies; GitHub is the single source of truth.
      try {
        localStorage.removeItem(STORAGE_KEY);
      } catch {
        // Storage can be unavailable in restricted/private browser contexts.
      }

      try {
        const sharedSnapshots = await fetchSnapshotIndex();
        if (cancelled) return;

        setRecords(sharedSnapshots);
        setError("");
      } catch (error) {
        if (cancelled) return;

        const message =
          error instanceof Error
            ? error.message
            : "Could not load the latest chart library.";

        setError(`Could not load the latest chart library. (${message})`);
      } finally {
        if (!cancelled) setLoaded(true);
      }
    }

    loadInitialSnapshots();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    try {
      const savedLanguage = localStorage.getItem(LANGUAGE_KEY);
      if (savedLanguage === "ko" || savedLanguage === "en") setLanguage(savedLanguage);
    } catch {
      // Storage can be unavailable in restricted/private browser contexts.
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const params = new URLSearchParams(window.location.search);

    // Chart/date selections intentionally do not persist across reloads.
    // Every fresh visit starts from the newest two 2020s snapshots.
    const filter = params.get("filter");
    const query = params.get("q");
    const urlLanguage = params.get("lang");

    if (
      filter === "ALL" ||
      filter === "CHANGED" ||
      filter === "NEW" ||
      filter === "UP" ||
      filter === "DOWN" ||
      filter === "SAME" ||
      filter === "OUT"
    ) {
      setMovementFilter(filter);
    }

    if (query) setSearchQuery(query);
    if (urlLanguage === "ko" || urlLanguage === "en") {
      setLanguage(urlLanguage);
    }

    setUrlStateReady(true);
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(LANGUAGE_KEY, language);
    } catch {
      // Keep the app usable even when storage writes are blocked.
    }
  }, [language]);

  useEffect(() => {
    if (!loaded) return;

    // Chart records must not be cached per device. GitHub/public is authoritative.
    // Also clears old versions of the site that may have saved chart records locally.
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Keep the app usable even when storage access is blocked.
    }
  }, [loaded]);

  const charts = useMemo(
    () => buildCharts(snapshots),
    [snapshots]
  );

  const leftChart = useMemo(
    () =>
      charts.find(
        (chart) => chart.sourceUrl === leftChartUrl
      ) ?? null,
    [charts, leftChartUrl]
  );

  const rightChart = useMemo(
    () =>
      charts.find(
        (chart) => chart.sourceUrl === rightChartUrl
      ) ?? null,
    [charts, rightChartUrl]
  );

  const leftSnapshot = useMemo(
    () => findSnapshot(leftChart, leftSnapshotKey),
    [leftChart, leftSnapshotKey]
  );

  const rightSnapshot = useMemo(
    () => findSnapshot(rightChart, rightSnapshotKey),
    [rightChart, rightSnapshotKey]
  );


  useEffect(() => {
    if (!leftSnapshot?.is_metadata) return;
    void ensureSnapshotLoaded(leftSnapshot);
  }, [leftSnapshotKey, leftSnapshot?.file_name, leftSnapshot?.is_metadata]);

  useEffect(() => {
    if (!rightSnapshot?.is_metadata) return;
    void ensureSnapshotLoaded(rightSnapshot);
  }, [rightSnapshotKey, rightSnapshot?.file_name, rightSnapshot?.is_metadata]);

  useEffect(() => {
    if (!loaded || !urlStateReady || initialComparisonAppliedRef.current) return;

    if (!charts.length) {
      setLeftChartUrl("");
      setRightChartUrl("");
      setLeftSnapshotKey("");
      setRightSnapshotKey("");
      return;
    }

    // Every fresh visit starts on the 2020s chart.
    // RIGHT/main = newest snapshot, LEFT/sub = snapshot immediately before it.
    const defaultChart =
      charts.find((chart) => /\/charts\/top\/song\/2020s\/?$/i.test(chart.sourceUrl)) ??
      charts.find((chart) => /between\s+2000\s+and\s+2029/i.test(chart.title)) ??
      charts[0];

    const weeklySnapshots =
      weeklySnapshotRepresentatives(defaultChart.snapshots);
    const latestIndex = weeklySnapshots.length - 1;
    if (latestIndex < 0) return;

    const previousIndex = Math.max(0, latestIndex - 1);
    const latest = weeklySnapshots[latestIndex];
    const previous = weeklySnapshots[previousIndex];

    setLeftChartUrl(defaultChart.sourceUrl);
    setRightChartUrl(defaultChart.sourceUrl);
    setLeftSnapshotKey(snapshotKey(previous));
    setRightSnapshotKey(snapshotKey(latest));

    initialComparisonAppliedRef.current = true;
  }, [charts, loaded, urlStateReady]);

  useEffect(() => {
    if (!loaded || !urlStateReady || !initialComparisonAppliedRef.current) return;

    if (!leftChart?.snapshots.length) {
      setLeftSnapshotKey("");
      return;
    }

    const valid = leftChart.snapshots.some(
      (item) =>
        snapshotKey(item) === leftSnapshotKey
    );

    if (!valid) {
      const weeklySnapshots =
        weeklySnapshotRepresentatives(leftChart.snapshots);
      const previousIndex = Math.max(0, weeklySnapshots.length - 2);
      const previous = weeklySnapshots[previousIndex];

      if (previous) {
        setLeftSnapshotKey(snapshotKey(previous));
      }
    }
  }, [leftChart, leftSnapshotKey, loaded, urlStateReady]);

  useEffect(() => {
    if (!loaded || !urlStateReady || !initialComparisonAppliedRef.current) return;

    if (!rightChart?.snapshots.length) {
      setRightSnapshotKey("");
      return;
    }

    const valid = rightChart.snapshots.some(
      (item) =>
        snapshotKey(item) === rightSnapshotKey
    );

    if (!valid) {
      const weeklySnapshots =
        weeklySnapshotRepresentatives(rightChart.snapshots);
      const latest = weeklySnapshots[weeklySnapshots.length - 1];

      if (latest) {
        setRightSnapshotKey(snapshotKey(latest));
      }
    }
  }, [rightChart, rightSnapshotKey, loaded, urlStateReady]);

  useEffect(() => {
    if (!loaded || !urlStateReady || typeof window === "undefined") return;

    const params = new URLSearchParams();

    if (movementFilter !== "ALL") params.set("filter", movementFilter);
    if (searchQuery.trim()) params.set("q", searchQuery.trim());
    params.set("lang", language);

    const queryString = params.toString();
    const nextUrl =
      window.location.pathname +
      (queryString ? "?" + queryString : "") +
      window.location.hash;

    try {
      window.history.replaceState(window.history.state, "", nextUrl);
    } catch {
      // Ignore URL-sync failures (for example unusually restrictive embedded contexts).
    }
  }, [
    loaded,
    urlStateReady,
    movementFilter,
    searchQuery,
    language,
  ]);

  const comparison = useMemo(() => {
    if (
      !leftSnapshot ||
      !rightSnapshot ||
      leftSnapshot.is_metadata ||
      rightSnapshot.is_metadata
    ) return null;

    const leftMap = new Map(
      leftSnapshot.songs.map((song) => [
        songKey(song),
        song,
      ])
    );

    const rightKeys = new Set(
      rightSnapshot.songs.map(songKey)
    );

    const current: ComparedSong[] =
      rightSnapshot.songs.map((song) => {
        const previous = leftMap.get(songKey(song));

        if (!previous) {
          return {
            ...song,
            previousRank: null,
            change: null,
            status: "NEW",
          };
        }

        const change = previous.rank - song.rank;

        return {
          ...song,
          previousRank: previous.rank,
          change,
          status:
            change > 0
              ? "UP"
              : change < 0
              ? "DOWN"
              : "SAME",
        };
      });

    const out = leftSnapshot.songs.filter(
      (song) => !rightKeys.has(songKey(song))
    );

    const sameChart =
      leftSnapshot.source_url ===
      rightSnapshot.source_url;

    const sameSnapshot =
      sameChart &&
      leftSnapshot.captured_at ===
        rightSnapshot.captured_at;

    return {
      current,
      out,
      sameChart,
      sameSnapshot,
      mode: sameChart
        ? "TIME CHANGE"
        : "CROSS-CHART CHANGE",
    };
  }, [leftSnapshot, rightSnapshot]);

  async function verifyAdminPassword(password: string) {
    try {
      const response = await fetch("/api/admin-auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  function requestAdminAccess(action: "IMPORT" | "LIBRARY") {
    if (action === "LIBRARY" && libraryOpen) {
      setLibraryOpen(false);
      return;
    }

    setAdminAction(action);
    setAdminPin("");
    setAdminPinError("");
    setAdminModalOpen(true);
  }

  function closeAdminModal() {
    if (adminVerifying) return;
    setAdminModalOpen(false);
    setAdminAction(null);
    setAdminPin("");
    setAdminPinError("");
  }

  async function submitAdminPin() {
    if (!/^\d{4}$/.test(adminPin)) {
      setAdminPinError(
        language === "ko"
          ? "4자리 숫자 비밀번호를 입력해주세요."
          : "Enter the 4-digit PIN."
      );
      return;
    }

    setAdminVerifying(true);
    setAdminPinError("");

    const valid = await verifyAdminPassword(adminPin);

    if (!valid) {
      setAdminVerifying(false);
      setAdminPinError(
        language === "ko"
          ? "비밀번호가 올바르지 않습니다."
          : "Incorrect PIN."
      );
      setAdminPin("");
      return;
    }

    const action = adminAction;
    const verifiedPin = adminPin;

    setAdminPassword(verifiedPin);
    setAdminVerifying(false);
    setAdminModalOpen(false);
    setAdminAction(null);
    setAdminPin("");
    setAdminPinError("");

    if (action === "LIBRARY") {
      setLibraryOpen(true);
    } else if (action === "IMPORT") {
      window.setTimeout(() => importInputRef.current?.click(), 0);
    }
  }

  function openLibraryWithPassword() {
    requestAdminAccess("LIBRARY");
  }

  function openImportWithPassword() {
    requestAdminAccess("IMPORT");
  }

  function openPinChange() {
    setCurrentPin("");
    setNewPin("");
    setConfirmPin("");
    setPinChangeError("");
    setPinChangeOpen(true);
  }

  function closePinChange() {
    if (pinChanging) return;
    setPinChangeOpen(false);
    setCurrentPin("");
    setNewPin("");
    setConfirmPin("");
    setPinChangeError("");
  }

  async function submitPinChange() {
    if (!/^\d{4}$/.test(currentPin) || !/^\d{4}$/.test(newPin)) {
      setPinChangeError(
        language === "ko"
          ? "현재 비밀번호와 새 비밀번호를 각각 4자리 숫자로 입력해주세요."
          : "Current and new PINs must both be 4 digits."
      );
      return;
    }

    if (newPin !== confirmPin) {
      setPinChangeError(
        language === "ko"
          ? "새 비밀번호가 서로 일치하지 않습니다."
          : "The new PINs do not match."
      );
      return;
    }

    setPinChanging(true);
    setPinChangeError("");

    try {
      const response = await fetch("/api/admin-auth", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          currentPassword: currentPin,
          newPassword: newPin,
        }),
      });

      const result = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(
          result?.error ||
            (language === "ko" ? "비밀번호를 변경할 수 없습니다." : "Could not change the PIN.")
        );
      }

      setAdminPassword(newPin);
      setPinChangeOpen(false);
      setCurrentPin("");
      setNewPin("");
      setConfirmPin("");
      setPinChangeError("");

      window.alert(
        language === "ko"
          ? "관리자 비밀번호가 변경되었습니다."
          : "Administrator PIN changed."
      );
    } catch (error) {
      setPinChangeError(
        error instanceof Error
          ? error.message
          : (language === "ko" ? "비밀번호를 변경할 수 없습니다." : "Could not change the PIN.")
      );
    } finally {
      setPinChanging(false);
    }
  }

  async function importSnapshot(
    event: React.ChangeEvent<HTMLInputElement>
  ) {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const password = adminPassword;
      if (!password) {
        throw new Error("Admin authentication required");
      }

      const text = await file.text();
      const data = sanitizeSnapshot(JSON.parse(text));

      if (!data) {
        throw new Error("Invalid chart record");
      }

      const uploadResponse = await fetch("/api/chart-files", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password, snapshot: data }),
      });

      const uploadResult = await uploadResponse.json().catch(() => ({}));
      if (!uploadResponse.ok) {
        if (uploadResponse.status === 401) setAdminPassword("");
        throw new Error(uploadResult?.error || "Upload failed");
      }

      const latestSnapshots = await fetchSnapshotIndex();
      const uploadedFilename =
        typeof uploadResult?.filename === "string"
          ? uploadResult.filename
          : snapshotPublicFilename(data);

      setRecords(
        latestSnapshots.map((item) =>
          snapshotKey(item) === snapshotKey(data)
            ? {
                ...data,
                file_name: uploadedFilename || item.file_name,
                is_metadata: false,
              }
            : item
        )
      );

      setRightChartUrl(data.source_url);
      setRightSnapshotKey(snapshotKey(data));
      setError("");

      window.alert(
        language === "ko"
          ? `${uploadResult.filename || "JSON"} 파일을 GitHub에 저장했습니다. 다른 기기에서도 새로고침하면 바로 반영됩니다.`
          : `${uploadResult.filename || "JSON"} was saved to GitHub. Other devices will see it immediately after refreshing.`
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      setError(
        language === "ko"
          ? `JSON 차트 기록을 공개 업로드할 수 없습니다.${message ? ` (${message})` : ""}`
          : `Could not publish this JSON chart record.${message ? ` (${message})` : ""}`
      );
    } finally {
      event.target.value = "";
    }
  }


  function toggleDeleteSelection(key: string) {
    setSelectedForDelete((current) =>
      current.includes(key)
        ? current.filter((item) => item !== key)
        : [...current, key]
    );
  }

  function selectAllForDelete() {
    setSelectedForDelete(
      snapshots.map((snapshot) => snapshotKey(snapshot))
    );
  }

  function clearDeleteSelection() {
    setSelectedForDelete([]);
  }

  async function deleteSnapshotsFromGitHub(targets: Snapshot[]) {
    const password = adminPassword;
    if (!password) {
      throw new Error(
        language === "ko"
          ? "관리자 인증이 만료되었습니다. 라이브러리를 다시 열어주세요."
          : "Administrator authentication expired. Reopen the library."
      );
    }

    for (const snapshot of targets) {
      const filename =
        snapshot.file_name || snapshotPublicFilename(snapshot);
      if (!filename) continue;

      const response = await fetch("/api/chart-files", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password, filename }),
      });

      const result = await response.json().catch(() => ({}));

      if (!response.ok && response.status !== 404) {
        if (response.status === 401) setAdminPassword("");
        throw new Error(
          result?.error ||
            (language === "ko" ? `${filename} 삭제에 실패했습니다.` : `Could not delete ${filename}.`)
        );
      }
    }
  }

  async function deleteSelected() {
    if (selectedForDelete.length === 0) return;

    const targets = snapshots.filter((snapshot) =>
      selectedForDelete.includes(snapshotKey(snapshot))
    );

    const ok = window.confirm(
      language === "ko"
        ? `선택한 차트 기록 ${targets.length}개를 실제 파일에서도 삭제할까요?\n\nGitHub public 폴더에서도 즉시 삭제됩니다.`
        : `Delete ${targets.length} selected record(s) from the actual files too?\n\nThey will be removed from the GitHub public folder immediately.`
    );

    if (!ok) return;

    try {
      await deleteSnapshotsFromGitHub(targets);

      const latestSnapshots = await fetchSnapshotIndex();
      setRecords(latestSnapshots);
      setSelectedForDelete([]);

      window.alert(
        language === "ko"
          ? "삭제했습니다. 다른 기기에서도 새로고침하면 바로 반영됩니다."
          : "Deleted. Other devices will reflect the change immediately after refreshing."
      );
    } catch (error) {
      try {
        setRecords(await fetchSnapshotIndex());
      } catch {
        // Keep the current UI if the authoritative refresh also fails.
      }

      window.alert(
        error instanceof Error
          ? error.message
          : (language === "ko" ? "삭제에 실패했습니다." : "Delete failed.")
      );
    }
  }

  async function deleteAll() {
    if (snapshots.length === 0) return;

    const ok = window.confirm(
      language === "ko"
        ? `저장된 차트 기록 ${snapshots.length}개를 모두 실제 파일에서도 삭제할까요?\n\nGitHub public 폴더의 차트 JSON도 삭제됩니다.`
        : `Delete all ${snapshots.length} saved record(s), including the actual files?\n\nThe chart JSON files in the GitHub public folder will also be deleted.`
    );

    if (!ok) return;

    try {
      await deleteSnapshotsFromGitHub(snapshots);

      const latestSnapshots = await fetchSnapshotIndex();
      setRecords(latestSnapshots);
      setSelectedForDelete([]);
      setLeftChartUrl("");
      setRightChartUrl("");
      setLeftSnapshotKey("");
      setRightSnapshotKey("");
      setActiveSpotifyUrl("");
      setMovementFilter("ALL");
      setSearchQuery("");

      window.alert(
        language === "ko"
          ? "모든 기록과 GitHub의 실제 JSON 파일을 삭제했습니다. 다른 기기에서도 새로고침하면 바로 반영됩니다."
          : "All records and actual GitHub JSON files were deleted. Other devices will reflect the change immediately after refreshing."
      );
    } catch (error) {
      try {
        setRecords(await fetchSnapshotIndex());
      } catch {
        // Keep the current UI if the authoritative refresh also fails.
      }

      window.alert(
        error instanceof Error
          ? error.message
          : (language === "ko" ? "전체 삭제에 실패했습니다." : "Delete all failed.")
      );
    }
  }

  function toggleSpotifyPreview(url: string) {
    setActiveSpotifyUrl((current) => current === url ? "" : url);
  }

  const effectiveComparison =
    comparison && !comparison.sameSnapshot
      ? comparison
      : null;

  const movementCounts = effectiveComparison
    ? {
        all: effectiveComparison.current.length,
        changed: effectiveComparison.current.filter((song) => song.status !== "SAME").length,
        new: effectiveComparison.current.filter((song) => song.status === "NEW").length,
        up: effectiveComparison.current.filter((song) => song.status === "UP").length,
        down: effectiveComparison.current.filter((song) => song.status === "DOWN").length,
        same: effectiveComparison.current.filter((song) => song.status === "SAME").length,
        out: effectiveComparison.out.length,
      }
    : null;

  const sameChartComparison = Boolean(effectiveComparison?.sameChart);

  return (
    <main className="rym-app">
      <style>{RYM_STYLES}</style>
      <style>{`
/* Fine-tune admin PIN visibility + restore Delete All color */
.rym-app .rym-admin-dots span {
  background: #e4e7ec !important;
  box-shadow:
    inset 0 0 0 1px rgba(84, 92, 105, .08),
    inset 0 1px 2px rgba(0,0,0,.03) !important;
}

.rym-app .rym-admin-dots span.is-filled {
  background: #dfe9f7 !important;
  box-shadow:
    inset 0 0 0 1px rgba(52,120,246,.10),
    inset 0 1px 2px rgba(0,0,0,.025) !important;
}

.rym-app .rym-admin-pin {
  background: transparent !important;
}

.rym-app .rym-pin-change-form input {
  background: #e4e7ec !important;
  box-shadow:
    inset 0 0 0 1px rgba(84, 92, 105, .08),
    inset 0 1px 2px rgba(0,0,0,.03) !important;
}

.rym-app .rym-pin-change-form input:focus {
  background: #fff !important;
  box-shadow:
    0 0 0 2px rgba(52,120,246,.50),
    0 4px 12px rgba(52,120,246,.08) !important;
}

/* Restore the original darker red, but remove the raised/stroked look */
.rym-app .rym-button--danger,
.rym-app button.rym-button--danger,
.rym-app .rym-library-actions .rym-button--danger {
  border: 0 !important;
  outline: 0 !important;
  box-shadow: none !important;
  background: #b54843 !important;
  background-image: none !important;
  color: #fff !important;
}

.rym-app .rym-button--danger:hover:not(:disabled) {
  background: #a33f3b !important;
}
`}</style>
      <style>{`
/* Apple-like admin UI v2 */
.rym-app .rym-admin-backdrop {
  background: rgba(28, 32, 39, .22) !important;
  -webkit-backdrop-filter: blur(22px) saturate(145%) !important;
  backdrop-filter: blur(22px) saturate(145%) !important;
}

.rym-app .rym-admin-modal {
  width: min(88vw, 360px) !important;
  padding: 30px 26px 24px !important;
  border: 0 !important;
  border-radius: 26px !important;
  background: rgba(250, 250, 252, .92) !important;
  -webkit-backdrop-filter: blur(32px) saturate(170%) !important;
  backdrop-filter: blur(32px) saturate(170%) !important;
  box-shadow:
    0 30px 70px rgba(0,0,0,.20),
    0 8px 22px rgba(0,0,0,.10) !important;
}

.rym-app .rym-admin-modal h2 {
  margin: 4px 0 7px !important;
  font-size: 1.08rem !important;
  font-weight: 700 !important;
  letter-spacing: -.025em !important;
  color: #111318 !important;
}

.rym-app .rym-admin-modal > p {
  margin: 0 0 22px !important;
  font-size: .88rem !important;
  line-height: 1.45 !important;
  color: #7a7f87 !important;
}

.rym-app .rym-admin-close {
  top: 14px !important;
  right: 14px !important;
  width: 30px !important;
  height: 30px !important;
  border: 0 !important;
  border-radius: 999px !important;
  background: #eceef2 !important;
  color: #7c828b !important;
  box-shadow: none !important;
}

.rym-app .rym-admin-modal form {
  margin-top: 0 !important;
}

.rym-app .rym-admin-dots {
  grid-template-columns: repeat(4, 56px) !important;
  gap: 10px !important;
  margin-bottom: 18px !important;
}

.rym-app .rym-admin-dots span {
  width: 56px !important;
  height: 58px !important;
  border: 0 !important;
  border-radius: 16px !important;
  background: #eef0f4 !important;
  box-shadow: inset 0 1px 2px rgba(0,0,0,.025) !important;
}

.rym-app .rym-admin-dots span.is-filled {
  background: #e8f0fb !important;
}

.rym-app .rym-admin-dots span.is-filled::after {
  width: 10px !important;
  height: 10px !important;
  background: #3978d4 !important;
}

.rym-app .rym-admin-pin {
  width: 254px !important;
  height: 58px !important;
  border-radius: 16px !important;
}

.rym-app .rym-admin-error {
  margin-top: 0 !important;
  min-height: 18px !important;
}

.rym-app .rym-admin-submit {
  min-height: 48px !important;
  margin-top: 4px !important;
  border: 0 !important;
  border-radius: 14px !important;
  background: #3478f6 !important;
  color: #fff !important;
  font-weight: 700 !important;
  box-shadow: none !important;
}

.rym-app .rym-admin-submit:disabled {
  background: #9db6d9 !important;
  opacity: 1 !important;
}

/* PIN change sheet */
.rym-app .rym-pin-change-modal {
  width: min(90vw, 390px) !important;
}

.rym-app .rym-pin-change-form {
  gap: 13px !important;
  margin-top: 16px !important;
}

.rym-app .rym-pin-change-form label {
  gap: 6px !important;
}

.rym-app .rym-pin-change-form label > span {
  padding-left: 2px !important;
  font-size: .76rem !important;
  font-weight: 600 !important;
  color: #6f757e !important;
}

.rym-app .rym-pin-change-form input {
  min-height: 50px !important;
  padding: 0 14px !important;
  border: 0 !important;
  border-radius: 14px !important;
  outline: 0 !important;
  background: #eef0f4 !important;
  box-shadow: none !important;
}

.rym-app .rym-pin-change-form input:focus {
  background: #fff !important;
  box-shadow: 0 0 0 2px rgba(52,120,246,.45) !important;
}

/* Fully solid destructive buttons */
.rym-app .rym-button--danger,
.rym-app button.rym-button--danger,
.rym-app .rym-library-actions .rym-button--danger {
  border: 0 !important;
  outline: 0 !important;
  box-shadow: none !important;
  background: #ff3b30 !important;
  color: #fff !important;
  background-image: none !important;
}

.rym-app .rym-button--danger:hover:not(:disabled) {
  background: #e9342b !important;
}

.rym-app .rym-button--danger:disabled {
  border: 0 !important;
  box-shadow: none !important;
}
`}</style>
      <style>{`\n/* Apple-inspired admin modal refresh */
.rym-app .rym-admin-backdrop {
  background: rgba(20, 28, 38, .28);
  -webkit-backdrop-filter: blur(18px) saturate(135%);
  backdrop-filter: blur(18px) saturate(135%);
}

.rym-app .rym-admin-modal {
  width: min(92vw, 390px);
  padding: 28px 28px 24px;
  border: 0 !important;
  border-radius: 28px;
  background: rgba(255, 255, 255, .92);
  -webkit-backdrop-filter: blur(28px) saturate(160%);
  backdrop-filter: blur(28px) saturate(160%);
  box-shadow:
    0 28px 70px rgba(15, 23, 42, .22),
    0 8px 24px rgba(15, 23, 42, .12);
}

.rym-app .rym-admin-modal h2 {
  margin: 8px 0 8px;
  font-size: 1.16rem;
  line-height: 1.2;
  font-weight: 700;
  letter-spacing: -.02em;
  color: #111827;
}

.rym-app .rym-admin-modal p {
  margin: 0 0 20px;
  color: #7a828d;
  font-size: .9rem;
  line-height: 1.45;
}

.rym-app .rym-admin-close {
  top: 14px;
  right: 14px;
  width: 32px;
  height: 32px;
  border: 0 !important;
  border-radius: 999px;
  background: rgba(120, 128, 140, .10);
  color: #7f8790;
  font-size: 1.25rem;
  line-height: 1;
  box-shadow: none !important;
}

.rym-app .rym-admin-close:hover {
  background: rgba(120, 128, 140, .16);
}

.rym-app .rym-pin-digits {
  gap: 10px;
  margin: 8px 0 22px;
}

.rym-app .rym-pin-box,
.rym-app .rym-pin-digit {
  width: 58px;
  height: 58px;
  border: 0 !important;
  border-radius: 16px;
  background: #f2f4f7;
  box-shadow: inset 0 0 0 1px rgba(0,0,0,0);
}

.rym-app .rym-pin-box.is-active,
.rym-app .rym-pin-digit.is-active {
  background: #fff;
  box-shadow:
    0 0 0 2px #6ea8ff,
    0 6px 16px rgba(79, 137, 230, .14);
}

.rym-app .rym-admin-submit {
  min-height: 50px;
  border: 0 !important;
  border-radius: 15px;
  background: linear-gradient(180deg, #6ea8ff 0%, #5b95ec 100%);
  color: #fff;
  font-weight: 700;
  box-shadow: 0 8px 18px rgba(75, 131, 216, .18);
}

.rym-app .rym-admin-submit:hover:not(:disabled) {
  filter: brightness(1.02);
}

.rym-app .rym-admin-submit:disabled {
  background: #a9bdd9;
  color: rgba(255,255,255,.9);
  box-shadow: none;
}

.rym-app .rym-pin-change-modal {
  width: min(92vw, 420px);
}

.rym-app .rym-pin-change-form {
  gap: 14px;
  margin-top: 18px;
}

.rym-app .rym-pin-change-form label > span {
  font-size: .78rem;
  font-weight: 600;
  color: #6f7782;
}

.rym-app .rym-pin-change-form input {
  min-height: 50px;
  border: 0 !important;
  border-radius: 14px;
  background: #f2f4f7;
  box-shadow: none !important;
}

.rym-app .rym-pin-change-form input:focus {
  background: #fff;
  box-shadow: 0 0 0 2px #6ea8ff !important;
}

/* Solid destructive button: no stroke */
.rym-app .rym-button--danger,
.rym-app button.rym-button--danger,
.rym-app .rym-library-actions .rym-button--danger {
  border: 0 !important;
  outline: 0 !important;
  box-shadow: none !important;
  background: #ff3b30 !important;
  color: #fff !important;
}

.rym-app .rym-button--danger:hover {
  background: #e9342b !important;
}

.rym-app .rym-button--danger:active {
  transform: scale(.98);
}
\n`}</style>

      <style>{`
/* FINAL visual corrections */
.rym-app .rym-admin-dots span {
  background: #d5d9e0 !important;
  border: 0 !important;
  box-shadow:
    inset 0 1px 2px rgba(0, 0, 0, .08),
    0 1px 0 rgba(255,255,255,.65) !important;
  opacity: 1 !important;
}

.rym-app .rym-admin-dots span.is-filled {
  background: #cbd8ea !important;
}

.rym-app .rym-admin-dots span.is-filled::after {
  background: #2f6fcb !important;
}

/* Change-PIN fields: visible even before typing */
.rym-app .rym-pin-change-form input {
  background: #d5d9e0 !important;
  border: 0 !important;
  box-shadow: inset 0 1px 2px rgba(0,0,0,.08) !important;
  opacity: 1 !important;
}

/* Original muted Delete All red, flat/no stroke */
.rym-app .rym-button--danger,
.rym-app button.rym-button--danger,
.rym-app .rym-library-actions .rym-button--danger {
  background: #b84b46 !important;
  background-image: none !important;
  border: 0 !important;
  outline: 0 !important;
  box-shadow: none !important;
  color: #ffffff !important;
}

.rym-app .rym-button--danger:hover:not(:disabled) {
  background: #aa433f !important;
}
`}</style>

      <style>{`
/* Glassmorphism modal: keep page sharp, glass only on the popup */
.rym-app .rym-admin-backdrop {
  background: rgba(10, 18, 28, .10) !important;
  -webkit-backdrop-filter: none !important;
  backdrop-filter: none !important;
}

.rym-app .rym-admin-modal {
  background: rgba(255, 255, 255, .58) !important;
  -webkit-backdrop-filter: blur(26px) saturate(170%) !important;
  backdrop-filter: blur(26px) saturate(170%) !important;
  border: 1px solid rgba(255,255,255,.62) !important;
  box-shadow:
    0 28px 70px rgba(15, 23, 42, .20),
    inset 0 1px 0 rgba(255,255,255,.72) !important;
}

.rym-app .rym-pin-change-modal {
  background: rgba(255, 255, 255, .58) !important;
  -webkit-backdrop-filter: blur(26px) saturate(170%) !important;
  backdrop-filter: blur(26px) saturate(170%) !important;
  border: 1px solid rgba(255,255,255,.62) !important;
  box-shadow:
    0 28px 70px rgba(15, 23, 42, .20),
    inset 0 1px 0 rgba(255,255,255,.72) !important;
}
`}</style>

      <style>{`
/* FINAL admin modal style: no backdrop effect, white card + strong refined shadow */
.rym-app .rym-admin-backdrop {
  background: transparent !important;
  -webkit-backdrop-filter: none !important;
  backdrop-filter: none !important;
}

.rym-app .rym-admin-modal,
.rym-app .rym-pin-change-modal {
  background: #ffffff !important;
  -webkit-backdrop-filter: none !important;
  backdrop-filter: none !important;
  border: 0 !important;
  box-shadow:
    0 32px 70px rgba(15, 23, 42, .24),
    0 14px 32px rgba(15, 23, 42, .16),
    0 3px 10px rgba(15, 23, 42, .08) !important;
}

/* Keep PIN boxes clearly visible before typing */
.rym-app .rym-admin-dots span {
  background: #d9dde4 !important;
  border: 0 !important;
  box-shadow: inset 0 1px 2px rgba(0,0,0,.08) !important;
  opacity: 1 !important;
}

.rym-app .rym-admin-dots span.is-filled {
  background: #cddcf0 !important;
}

.rym-app .rym-pin-change-form input {
  background: #e1e4e9 !important;
  border: 0 !important;
  box-shadow: inset 0 1px 2px rgba(0,0,0,.07) !important;
}

.rym-app .rym-pin-change-form input:focus {
  background: #ffffff !important;
  box-shadow: 0 0 0 2px rgba(52,120,246,.48) !important;
}

/* Keep Delete All muted/dark red, flat, no stroke */
.rym-app .rym-button--danger,
.rym-app button.rym-button--danger,
.rym-app .rym-library-actions .rym-button--danger {
  background: #b84b46 !important;
  background-image: none !important;
  border: 0 !important;
  outline: 0 !important;
  box-shadow: none !important;
  color: #fff !important;
}

.rym-app .rym-button--danger:hover:not(:disabled) {
  background: #aa433f !important;
}
`}</style>

      <style>{`
/* Match admin confirmation buttons to the site's primary navy blue */
.rym-app .rym-admin-submit {
  background: #315f9d !important;
  background-image: none !important;
  border: 0 !important;
  color: #ffffff !important;
  box-shadow: none !important;
}

.rym-app .rym-admin-submit:hover:not(:disabled) {
  background: #294f84 !important;
}

.rym-app .rym-admin-submit:disabled {
  background: #9db2cf !important;
  color: rgba(255,255,255,.95) !important;
}
`}</style>

      <style>{`
/* Refined lighter modal shadow */
.rym-app .rym-admin-modal,
.rym-app .rym-pin-change-modal {
  box-shadow:
    0 22px 48px rgba(15, 23, 42, .16),
    0 8px 20px rgba(15, 23, 42, .09),
    0 2px 6px rgba(15, 23, 42, .05) !important;
}
`}</style>

      <style>{`
/* RYM-native admin modal */
.rym-app .rym-admin-backdrop {
  background: transparent !important;
  -webkit-backdrop-filter: none !important;
  backdrop-filter: none !important;
}

.rym-app .rym-admin-modal,
.rym-app .rym-pin-change-modal {
  width: min(88vw, 360px) !important;
  padding: 24px 24px 20px !important;
  border: 1px solid #d8dde5 !important;
  border-radius: 14px !important;
  background: #ffffff !important;
  -webkit-backdrop-filter: none !important;
  backdrop-filter: none !important;
  box-shadow:
    0 14px 30px rgba(32, 45, 61, .10),
    0 4px 10px rgba(32, 45, 61, .06) !important;
}

.rym-app .rym-admin-modal h2 {
  margin: 4px 0 6px !important;
  font-size: 1.02rem !important;
  font-weight: 700 !important;
  letter-spacing: -.01em !important;
  color: #1f2f43 !important;
}

.rym-app .rym-admin-modal > p {
  margin: 0 0 18px !important;
  font-size: .86rem !important;
  line-height: 1.4 !important;
  color: #6f7884 !important;
}

.rym-app .rym-admin-close {
  top: 12px !important;
  right: 12px !important;
  width: 28px !important;
  height: 28px !important;
  border: 1px solid #e1e5ea !important;
  border-radius: 999px !important;
  background: #f4f6f8 !important;
  color: #7b8490 !important;
  box-shadow: none !important;
}

.rym-app .rym-admin-dots {
  gap: 9px !important;
  margin: 4px 0 16px !important;
}

.rym-app .rym-admin-dots span {
  width: 54px !important;
  height: 54px !important;
  border: 1px solid #cfd6df !important;
  border-radius: 10px !important;
  background: #eef1f4 !important;
  box-shadow: none !important;
}

.rym-app .rym-admin-dots span.is-filled {
  background: #e1eaf5 !important;
  border-color: #b8c9df !important;
}

.rym-app .rym-admin-dots span.is-filled::after {
  background: #315f9d !important;
}

.rym-app .rym-admin-submit {
  min-height: 46px !important;
  border: 0 !important;
  border-radius: 9px !important;
  background: #315f9d !important;
  color: #ffffff !important;
  font-weight: 700 !important;
  box-shadow: none !important;
}

.rym-app .rym-admin-submit:hover:not(:disabled) {
  background: #294f84 !important;
}

.rym-app .rym-admin-submit:disabled {
  background: #9fb2cc !important;
  color: rgba(255,255,255,.95) !important;
}

.rym-app .rym-pin-change-modal {
  width: min(90vw, 390px) !important;
}

.rym-app .rym-pin-change-form {
  gap: 12px !important;
  margin-top: 14px !important;
}

.rym-app .rym-pin-change-form label > span {
  color: #5f6873 !important;
  font-size: .76rem !important;
  font-weight: 600 !important;
}

.rym-app .rym-pin-change-form input {
  min-height: 46px !important;
  border: 1px solid #cfd6df !important;
  border-radius: 9px !important;
  background: #f5f7f9 !important;
  box-shadow: none !important;
}

.rym-app .rym-pin-change-form input:focus {
  background: #ffffff !important;
  border-color: #9eb6d3 !important;
  box-shadow: 0 0 0 2px rgba(49,95,157,.10) !important;
}
`}</style>

      <style>{`
/* Mobile chart polish */
@media (max-width: 680px) {
  /* Make the main chart card denser so album art nearly fills the card height */
  .rym-app .rym-pane--current .rym-song-card,
  .rym-app .rym-pane--compact .rym-song-card {
    padding-top: 10px !important;
    padding-bottom: 10px !important;
  }

  .rym-app .rym-pane--current .rym-song-row,
  .rym-app .rym-pane--compact .rym-song-row {
    align-items: stretch !important;
  }

  .rym-app .rym-pane--current .rym-song-cover,
  .rym-app .rym-pane--compact .rym-song-cover {
    height: auto !important;
    min-height: 100% !important;
    align-self: stretch !important;
    display: flex !important;
  }

  .rym-app .rym-pane--current .rym-song-cover img,
  .rym-app .rym-pane--compact .rym-song-cover img {
    width: 100% !important;
    height: 100% !important;
    object-fit: cover !important;
    align-self: stretch !important;
  }

  /* Pull the information block together to remove dead space under album art */
  .rym-app .rym-pane--current .rym-song-body,
  .rym-app .rym-pane--compact .rym-song-body {
    min-height: 0 !important;
    padding-top: 0 !important;
    padding-bottom: 0 !important;
    display: grid !important;
    grid-template-columns: minmax(0, 1fr) auto !important;
    grid-template-areas:
      "main main"
      "actions actions"
      "change rating" !important;
    row-gap: 6px !important;
    column-gap: 10px !important;
    align-content: stretch !important;
  }

  .rym-app .rym-pane--current .rym-song-main,
  .rym-app .rym-pane--compact .rym-song-main {
    grid-area: main !important;
  }

  .rym-app .rym-pane--current .rym-song-actions,
  .rym-app .rym-pane--compact .rym-song-actions {
    grid-area: actions !important;
    margin-top: 0 !important;
  }

  /* Rank change sits directly above / beside the rating area */
  .rym-app .rym-pane--current .rym-rank-change,
  .rym-app .rym-pane--compact .rym-rank-change {
    grid-area: change !important;
    align-self: end !important;
    margin-top: 0 !important;
    white-space: nowrap !important;
  }

  .rym-app .rym-pane--current .rym-score,
  .rym-app .rym-pane--compact .rym-score,
  .rym-app .rym-pane--current .rym-rating,
  .rym-app .rym-pane--compact .rym-rating {
    grid-area: rating !important;
    align-self: end !important;
    justify-self: end !important;
    margin-top: 0 !important;
    white-space: nowrap !important;
  }

  /* Keep playback and RYM buttons identical in size */
  .rym-app .rym-preview-button,
  .rym-app .rym-rym-button {
    width: 34px !important;
    height: 34px !important;
    min-width: 34px !important;
    min-height: 34px !important;
    flex: 0 0 34px !important;
    box-sizing: border-box !important;
  }

  .rym-app .rym-rym-button {
    padding: 0 !important;
  }

  .rym-app .rym-rym-logo-image {
    width: 34px !important;
    height: 34px !important;
    display: block !important;
    object-fit: cover !important;
    border-radius: 50% !important;
  }

  /* When the Spotify preview is expanded, keep controls aligned at the edges */
  .rym-app .rym-spotify-expanded-controls,
  .rym-app .rym-song-actions {
    width: 100% !important;
    display: flex !important;
    align-items: center !important;
  }

  .rym-app .rym-song-actions .rym-rym-button {
    margin-left: auto !important;
  }

  .rym-app .rym-song-actions .rym-preview-button + .rym-rym-button {
    margin-left: auto !important;
  }
}
`}</style>

      <style>{`
/* Mobile chart layout correction */
@media (max-width: 680px) {
  /* NORMAL CARD: larger artwork, tighter vertical fit */
  .rym-app .rym-song:not(.rym-song--compact):not(.rym-song--playing) {
    --rym-cover-size: 8.4rem !important;
    grid-template-columns: 2.5rem var(--rym-cover-size) minmax(0, 1fr) !important;
    gap: .72rem !important;
    padding: .62rem .72rem .62rem .58rem !important;
    align-items: stretch !important;
  }

  .rym-app .rym-song:not(.rym-song--compact):not(.rym-song--playing) > .rym-cover {
    width: var(--rym-cover-size) !important;
    height: var(--rym-cover-size) !important;
    align-self: center !important;
  }

  .rym-app .rym-song:not(.rym-song--compact):not(.rym-song--playing) > .rym-song-body {
    display: flex !important;
    flex-direction: column !important;
    align-items: stretch !important;
    min-height: var(--rym-cover-size) !important;
    padding: 0 !important;
  }

  /* Play + RYM stay together before preview opens */
  .rym-app .rym-song:not(.rym-song--compact):not(.rym-song--playing) .rym-song-actions {
    display: flex !important;
    align-items: center !important;
    justify-content: flex-start !important;
    width: auto !important;
    gap: .45rem !important;
    margin-top: .48rem !important;
  }

  .rym-app .rym-song:not(.rym-song--compact):not(.rym-song--playing) .rym-song-actions .rym-rym-button {
    margin-left: 0 !important;
  }

  /* Rank route sits on the right, directly ABOVE the rating */
  .rym-app .rym-song:not(.rym-song--compact):not(.rym-song--playing) .rym-song-bottom {
    display: flex !important;
    flex-direction: column !important;
    flex-wrap: nowrap !important;
    align-items: flex-end !important;
    justify-content: flex-end !important;
    gap: .22rem !important;
    width: 100% !important;
    margin-top: auto !important;
    padding-top: .35rem !important;
  }

  .rym-app .rym-song:not(.rym-song--compact):not(.rym-song--playing) .rym-rank-route {
    align-self: flex-end !important;
    margin: 0 !important;
  }

  .rym-app .rym-song:not(.rym-song--compact):not(.rym-song--playing) .rym-rating {
    align-self: flex-end !important;
    margin: 0 !important;
  }

  /* Play button and RYM logo are exactly the same size */
  .rym-app .rym-song:not(.rym-song--compact) .rym-preview-button,
  .rym-app .rym-song:not(.rym-song--compact) .rym-rym-button {
    width: 2.1rem !important;
    height: 2.1rem !important;
    min-width: 2.1rem !important;
    min-height: 2.1rem !important;
    flex: 0 0 2.1rem !important;
    box-sizing: border-box !important;
  }

  .rym-app .rym-song:not(.rym-song--compact) .rym-rym-button {
    padding: 0 !important;
    border-radius: 50% !important;
    overflow: hidden !important;
  }

  .rym-app .rym-song:not(.rym-song--compact) .rym-rym-logo-image {
    display: block !important;
    width: 100% !important;
    height: 100% !important;
    object-fit: cover !important;
    border-radius: 50% !important;
  }

  /* OPEN PREVIEW: pause on left, RYM at far right */
  .rym-app .rym-song--playing:not(.rym-song--compact) .rym-song-actions {
    display: flex !important;
    align-items: center !important;
    width: 100% !important;
    gap: .45rem !important;
    margin: 0 0 var(--rym-mobile-control-gap) 0 !important;
  }

  .rym-app .rym-song--playing:not(.rym-song--compact) .rym-song-actions .rym-preview-button {
    margin: 0 !important;
  }

  .rym-app .rym-song--playing:not(.rym-song--compact) .rym-song-actions .rym-rym-button {
    margin-left: auto !important;
  }
}
`}</style>

      <style>{`
/* Final mobile spacing + control sizing */
@media (max-width: 680px) {
  /* Match top/bottom card padding to the horizontal padding */
  .rym-app .rym-song:not(.rym-song--compact):not(.rym-song--playing) {
    padding: .58rem .58rem !important;
  }

  .rym-app .rym-song:not(.rym-song--compact):not(.rym-song--playing) > .rym-song-body {
    padding-top: 0 !important;
    padding-bottom: 0 !important;
  }

  /* Slightly smaller mobile action buttons */
  .rym-app .rym-song:not(.rym-song--compact) .rym-preview-button,
  .rym-app .rym-song:not(.rym-song--compact) .rym-rym-button {
    width: 1.85rem !important;
    height: 1.85rem !important;
    min-width: 1.85rem !important;
    min-height: 1.85rem !important;
    flex: 0 0 1.85rem !important;
  }

  .rym-app .rym-song:not(.rym-song--compact) .rym-rym-logo-image {
    width: 100% !important;
    height: 100% !important;
  }

  /* Keep artwork vertically centered with tighter card breathing room */
  .rym-app .rym-song:not(.rym-song--compact):not(.rym-song--playing) > .rym-cover {
    align-self: center !important;
  }

  .rym-app .rym-song:not(.rym-song--compact):not(.rym-song--playing) .rym-song-actions {
    margin-top: .34rem !important;
    gap: .38rem !important;
  }

  .rym-app .rym-song:not(.rym-song--compact):not(.rym-song--playing) .rym-song-bottom {
    padding-top: .2rem !important;
    gap: .16rem !important;
  }
}
`}</style>

      <style>{`
/* MOBILE FINAL: force the card itself to fit the artwork */
@media (max-width: 680px) {
  .rym-app .rym-song:not(.rym-song--compact):not(.rym-song--playing) {
    --rym-cover-size: 10.4rem !important;
    grid-template-columns: 1.7rem var(--rym-cover-size) minmax(0, 1fr) !important;
    gap: .55rem !important;
    padding: .36rem .42rem !important;
    align-items: stretch !important;
  }

  .rym-app .rym-song:not(.rym-song--compact):not(.rym-song--playing) > .rym-cover {
    width: var(--rym-cover-size) !important;
    height: var(--rym-cover-size) !important;
    align-self: center !important;
  }

  .rym-app .rym-song:not(.rym-song--compact):not(.rym-song--playing) > .rym-song-body {
    min-height: var(--rym-cover-size) !important;
    padding: 0 !important;
    display: flex !important;
    flex-direction: column !important;
  }

  /* Keep controls compact */
  .rym-app .rym-song:not(.rym-song--compact) .rym-preview-button,
  .rym-app .rym-song:not(.rym-song--compact) .rym-rym-button {
    width: 1.7rem !important;
    height: 1.7rem !important;
    min-width: 1.7rem !important;
    min-height: 1.7rem !important;
    flex: 0 0 1.7rem !important;
  }

  .rym-app .rym-song:not(.rym-song--compact):not(.rym-song--playing) .rym-song-actions {
    display: flex !important;
    width: auto !important;
    justify-content: flex-start !important;
    gap: .34rem !important;
    margin-top: .28rem !important;
  }

  .rym-app .rym-song:not(.rym-song--compact):not(.rym-song--playing) .rym-song-actions .rym-rym-button {
    margin-left: 0 !important;
  }

  /* Rank change directly above rating on the right */
  .rym-app .rym-song:not(.rym-song--compact):not(.rym-song--playing) .rym-song-bottom {
    margin-top: auto !important;
    padding-top: .18rem !important;
    display: flex !important;
    flex-direction: column !important;
    align-items: flex-end !important;
    justify-content: flex-end !important;
    gap: .08rem !important;
  }

  .rym-app .rym-song:not(.rym-song--compact):not(.rym-song--playing) .rym-rank-route,
  .rym-app .rym-song:not(.rym-song--compact):not(.rym-song--playing) .rym-rating {
    margin: 0 !important;
    align-self: flex-end !important;
  }

  /* Expanded preview: pause left, RYM right */
  .rym-app .rym-song--playing:not(.rym-song--compact) .rym-song-actions {
    width: 100% !important;
    display: flex !important;
    align-items: center !important;
  }

  .rym-app .rym-song--playing:not(.rym-song--compact) .rym-song-actions .rym-rym-button {
    margin-left: auto !important;
  }
}
`}</style>

      <style>{`
/* MOBILE FINAL: add a little breathing room */
@media (max-width: 680px) {
  .rym-app .rym-song:not(.rym-song--compact):not(.rym-song--playing) {
    padding: .55rem .58rem !important;
    gap: .62rem !important;
  }
}
`}</style>

      <style>{`
/* Mobile spacing refinement */
@media (max-width: 680px) {
  /* Main/current chart: slightly more breathing room than previous version */
  .rym-app .rym-song:not(.rym-song--compact):not(.rym-song--playing) {
    padding: .68rem .68rem !important;
    gap: .66rem !important;
  }

  /* Small/previous chart: remove excessive empty space */
  .rym-app .rym-pane--compact .rym-song,
  .rym-app .rym-song--compact {
    padding: .38rem .42rem !important;
    gap: .42rem !important;
    min-height: 0 !important;
  }

  .rym-app .rym-pane--compact .rym-song-body,
  .rym-app .rym-song--compact .rym-song-body {
    min-height: 0 !important;
    padding-top: 0 !important;
    padding-bottom: 0 !important;
    justify-content: center !important;
  }

  .rym-app .rym-pane--compact .rym-cover,
  .rym-app .rym-song--compact .rym-cover {
    margin-top: 0 !important;
    margin-bottom: 0 !important;
    align-self: center !important;
  }
}
`}</style>

      <style>{`
/* Final mobile fixes: playing controls + compact calendar */
@media (max-width: 1023px) {
  /* The compact pane was clipping its calendar popover. */
  .rym-app .rym-pane--compact {
    overflow: visible !important;
  }

  .rym-app .rym-pane--compact .rym-chart-controls {
    position: relative !important;
    z-index: 100 !important;
    overflow: visible !important;
  }

  .rym-app .rym-pane--compact .rym-snapshot-field {
    position: relative !important;
    z-index: 110 !important;
    overflow: visible !important;
  }

  .rym-app .rym-pane--compact .rym-calendar-popover {
    z-index: 9999 !important;
  }
}

/* Selected time: solid RYM blue, no stroke */
.rym-app .rym-time-button.is-selected {
  border: 0 !important;
  outline: 0 !important;
  box-shadow: none !important;
  background: var(--rym-blue) !important;
  color: #fff !important;
}

@media (max-width: 680px) {
  /* When preview is open, RYM must exactly match the pause button. */
  .rym-app .rym-song.rym-song--playing:not(.rym-song--compact) .rym-preview-button,
  .rym-app .rym-song.rym-song--playing:not(.rym-song--compact) .rym-rym-button {
    width: 2.1rem !important;
    height: 2.1rem !important;
    min-width: 2.1rem !important;
    min-height: 2.1rem !important;
    flex: 0 0 2.1rem !important;
    box-sizing: border-box !important;
  }

  .rym-app .rym-song.rym-song--playing:not(.rym-song--compact) .rym-rym-button {
    padding: 0 !important;
    margin-left: auto !important;
    border-radius: 50% !important;
    overflow: hidden !important;
  }

  .rym-app .rym-song.rym-song--playing:not(.rym-song--compact) .rym-rym-logo-image {
    display: block !important;
    width: 100% !important;
    height: 100% !important;
    object-fit: cover !important;
    border-radius: 50% !important;
  }
}
`}</style>

      <style>{`
/* Compact admin modal on phones */
@media (max-width: 680px) {
  .rym-app .rym-admin-modal,
  .rym-app .rym-pin-change-modal {
    width: min(86vw, 320px) !important;
    padding: 20px 18px 17px !important;
    border-radius: 12px !important;
  }

  .rym-app .rym-admin-modal h2 {
    margin: 2px 0 5px !important;
    font-size: .96rem !important;
  }

  .rym-app .rym-admin-modal > p {
    margin-bottom: 14px !important;
    font-size: .8rem !important;
    line-height: 1.38 !important;
  }

  .rym-app .rym-admin-dots {
    gap: 7px !important;
    margin: 2px 0 12px !important;
  }

  .rym-app .rym-admin-dots span {
    width: 46px !important;
    height: 46px !important;
    border-radius: 9px !important;
  }

  .rym-app .rym-admin-pin {
    width: 205px !important;
    height: 46px !important;
  }

  .rym-app .rym-admin-submit {
    min-height: 42px !important;
    border-radius: 8px !important;
    font-size: .84rem !important;
  }

  .rym-app .rym-pin-change-form {
    gap: 10px !important;
    margin-top: 10px !important;
  }

  .rym-app .rym-pin-change-form input {
    min-height: 42px !important;
  }
}

/* Site footer */
.rym-app .rym-site-footer {
  margin-top: 2.4rem;
  padding: 1.15rem 1rem 1.35rem;
  border-top: 1px solid rgba(74, 86, 99, .12);
  text-align: center;
  color: #9aa1aa;
  font-size: .72rem;
  line-height: 1.55;
}

.rym-app .rym-site-footer a {
  color: inherit;
  text-decoration: none;
}

.rym-app .rym-site-footer a:hover {
  color: #717984;
}

.rym-app .rym-site-footer .rym-made-by {
  margin-top: .22rem;
  color: #858d97;
  font-weight: 600;
  letter-spacing: .01em;
}

@media (max-width: 680px) {
  .rym-app .rym-site-footer {
    margin-top: 1.7rem;
    padding: .95rem .8rem 1.1rem;
    font-size: .68rem;
  }
}
`}</style>

      <style>{`
/* Desktop/tablet main chart: keep artwork large enough to fill the card vertically */
@media (min-width: 681px) {
  .rym-app .rym-song:not(.rym-song--compact):not(.rym-song--playing) {
    --rym-cover-size: 10.4rem !important;
    grid-template-columns: 2.5rem var(--rym-cover-size) minmax(0, 1fr) !important;
    align-items: stretch !important;
  }

  .rym-app .rym-song:not(.rym-song--compact):not(.rym-song--playing) > .rym-cover {
    width: var(--rym-cover-size) !important;
    height: var(--rym-cover-size) !important;
    align-self: center !important;
    flex-shrink: 0 !important;
  }

  .rym-app .rym-song:not(.rym-song--compact):not(.rym-song--playing) > .rym-song-body {
    min-height: var(--rym-cover-size) !important;
  }
}
`}</style>

      {adminModalOpen && (
        <div
          className="rym-admin-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeAdminModal();
          }}
        >
          <section
            className="rym-admin-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="rym-admin-title"
          >
            <button
              type="button"
              className="rym-admin-close"
              onClick={closeAdminModal}
              aria-label={language === "ko" ? "닫기" : "Close"}
            >
              ×
            </button>

            <h2 id="rym-admin-title">
              {language === "ko" ? "관리자 전용 기능입니다." : "Administrator access"}
            </h2>
            <p>
              {language === "ko"
                ? "비밀번호를 입력해주세요."
                : "Enter the 4-digit administrator PIN."}
            </p>

            <form
              onSubmit={(event) => {
                event.preventDefault();
                void submitAdminPin();
              }}
            >
              <input
                className="rym-admin-pin"
                type="password"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={4}
                autoFocus
                autoComplete="off"
                value={adminPin}
                onChange={(event) => {
                  const digits = event.target.value.replace(/\D/g, "").slice(0, 4);
                  setAdminPin(digits);
                  setAdminPinError("");
                }}
                aria-label={language === "ko" ? "4자리 관리자 비밀번호" : "4-digit administrator PIN"}
              />

              <div className="rym-admin-dots" aria-hidden="true">
                {[0, 1, 2, 3].map((index) => (
                  <span key={index} className={index < adminPin.length ? "is-filled" : ""} />
                ))}
              </div>

              <div className="rym-admin-error" role="alert">
                {adminPinError}
              </div>

              <button
                type="submit"
                className="rym-admin-submit"
                disabled={adminVerifying || adminPin.length !== 4}
              >
                {adminVerifying
                  ? (language === "ko" ? "확인 중…" : "Checking…")
                  : (language === "ko" ? "확인" : "Continue")}
              </button>
            </form>
          </section>
        </div>
      )}
      {pinChangeOpen && (
        <div
          className="rym-admin-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closePinChange();
          }}
        >
          <section
            className="rym-admin-modal rym-pin-change-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="rym-pin-change-title"
          >
            <button
              type="button"
              className="rym-admin-close"
              onClick={closePinChange}
              aria-label={language === "ko" ? "닫기" : "Close"}
            >
              ×
            </button>

            <h2 id="rym-pin-change-title">
              {language === "ko" ? "관리자 비밀번호 변경" : "Change administrator PIN"}
            </h2>
            <p>
              {language === "ko"
                ? "현재 비밀번호를 확인한 뒤 새 4자리 비밀번호로 변경합니다."
                : "Confirm the current PIN, then choose a new 4-digit PIN."}
            </p>

            <form
              className="rym-pin-change-form"
              onSubmit={(event) => {
                event.preventDefault();
                void submitPinChange();
              }}
            >
              <label>
                <span>{language === "ko" ? "현재 비밀번호" : "Current PIN"}</span>
                <input
                  type="password"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={4}
                  autoComplete="off"
                  value={currentPin}
                  onChange={(event) => {
                    setCurrentPin(event.target.value.replace(/\D/g, "").slice(0, 4));
                    setPinChangeError("");
                  }}
                />
              </label>

              <label>
                <span>{language === "ko" ? "새 비밀번호" : "New PIN"}</span>
                <input
                  type="password"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={4}
                  autoComplete="new-password"
                  value={newPin}
                  onChange={(event) => {
                    setNewPin(event.target.value.replace(/\D/g, "").slice(0, 4));
                    setPinChangeError("");
                  }}
                />
              </label>

              <label>
                <span>{language === "ko" ? "새 비밀번호 확인" : "Confirm new PIN"}</span>
                <input
                  type="password"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={4}
                  autoComplete="new-password"
                  value={confirmPin}
                  onChange={(event) => {
                    setConfirmPin(event.target.value.replace(/\D/g, "").slice(0, 4));
                    setPinChangeError("");
                  }}
                />
              </label>

              <div className="rym-admin-error" role="alert">
                {pinChangeError}
              </div>

              <button
                type="submit"
                className="rym-admin-submit"
                disabled={
                  pinChanging ||
                  currentPin.length !== 4 ||
                  newPin.length !== 4 ||
                  confirmPin.length !== 4
                }
              >
                {pinChanging
                  ? (language === "ko" ? "변경 중…" : "Changing…")
                  : (language === "ko" ? "비밀번호 변경" : "Change PIN")}
              </button>
            </form>
          </section>
        </div>
      )}

      <header className="rym-topbar">
        <div className="rym-topbar-inner">
          <h1 className="rym-brand"><span className="rym-brand-rym">RYM</span><span className="rym-brand-tracker">Tracker</span></h1>
          <div className="rym-header-actions">
            <button type="button" onClick={() => setLanguage((current) => current === "en" ? "ko" : "en")}
              className="rym-button rym-button--secondary rym-language-button"
              aria-label={language === "ko" ? "영어로 변경" : "한국어로 변경"}
              title={language === "ko" ? "English" : "한국어"}>
              <RymIcon name="globe" /><span>{language === "ko" ? "EN" : "한국어"}</span>
            </button>
            <button type="button" onClick={openLibraryWithPassword}
              className={"rym-button rym-button--secondary" + (libraryOpen ? " is-active" : "")}
              aria-expanded={libraryOpen} aria-controls="rym-library">
              <RymIcon name="library" /><span>{language === "ko" ? "라이브러리 관리" : "Manage Library"}</span>
            </button>
            <button type="button" onClick={openImportWithPassword}
              className="rym-button rym-button--primary rym-file-button">
              <RymIcon name="upload" /><span>{language === "ko" ? "차트 기록 불러오기" : "Import Record"}</span>
            </button>
            <input ref={importInputRef} type="file" accept=".json,application/json" onChange={importSnapshot}
              className="rym-file-input" aria-label={language === "ko" ? "차트 기록 JSON 파일 불러오기" : "Import chart record JSON file"} />
          </div>
        </div>
      </header>
      <div className="rym-subbar">
        <div className="rym-subbar-inner">
          <div className="rym-context-copy">
            <span className="rym-subbar-description">{language === "ko" ? "저장된 RYM 차트의 시점별 순위 변화를 비교합니다." : "Compare ranking changes across saved RYM chart dates."}</span>
          </div>
          {loaded && <span className="rym-subbar-count">{charts.length}{language === "ko" ? "개 차트" : " charts"} · {snapshots.length}{language === "ko" ? "개 기록" : " records"}</span>}
        </div>
      </div>
      <div className="rym-workspace">
        {error && <p className="rym-error" role="alert">{error}</p>}
        {libraryOpen && (
          <section id="rym-library" className="rym-library" aria-labelledby="rym-library-title">
            <div className="rym-library-header">
              <div>
                <h2 id="rym-library-title">{language === "ko" ? "라이브러리 관리" : "Manage Library"}</h2>
                <p>{snapshots.length}{language === "ko" ? "개 저장됨" : " saved records"}</p>
              </div>
              <div className="rym-library-actions">
                <button type="button" onClick={openPinChange} className="rym-button rym-button--secondary">
                  {language === "ko" ? "비밀번호 변경" : "Change PIN"}
                </button>
                <button type="button" onClick={selectAllForDelete} className="rym-button rym-button--secondary">{language === "ko" ? "전체 선택" : "Select All"}</button>
                <button type="button" onClick={clearDeleteSelection} className="rym-button rym-button--secondary">{language === "ko" ? "선택 해제" : "Clear Selection"}</button>
                <button type="button" onClick={deleteSelected} disabled={selectedForDelete.length === 0}
                  className="rym-button rym-button--danger-outline">{language === "ko" ? `선택 삭제 (${selectedForDelete.length})` : `Delete Selected (${selectedForDelete.length})`}</button>
                <button type="button" onClick={deleteAll} disabled={snapshots.length === 0}
                  className="rym-button rym-button--danger">{language === "ko" ? "전체 삭제" : "Delete All"}</button>
              </div>
            </div>
            <div className="rym-library-list">
              {snapshots.length === 0 ? <p className="rym-library-empty">{language === "ko" ? "저장된 차트 기록이 없습니다." : "No saved records."}</p> : (
                snapshots.slice().sort((a, b) => new Date(b.captured_at).getTime() - new Date(a.captured_at).getTime())
                  .map((snapshot) => {
                    const key = snapshotKey(snapshot);
                    const checked = selectedForDelete.includes(key);
                    return (
                      <label key={key} className={"rym-library-row" + (checked ? " is-selected" : "")}>
                        <input type="checkbox" checked={checked} onChange={() => toggleDeleteSelection(key)} />
                        <span className="rym-library-row-content">
                          <strong>{formatChartTitle(snapshot.page_title || "RYM Song Chart")}</strong>
                          <span className="rym-library-date">
                            {formatRymWeekLabel(snapshot.captured_at, language)}
                            <span className="rym-library-week-range"> · {formatRymWeekRange(snapshot.captured_at, language)}</span>
                          </span>
                          <span className="rym-library-source">{snapshot.source_url}</span>
                        </span>
                        <span className="rym-library-song-count">{snapshot.songs.length}{language === "ko" ? "곡" : " songs"}</span>
                      </label>
                    );
                  })
              )}
            </div>
          </section>
        )}
        {!loaded && <div className="rym-loading" role="status">{language === "ko" ? "라이브러리 불러오는 중…" : "Loading library…"}</div>}
        {loaded && snapshots.length === 0 && (
          <section className="rym-empty">
            <h2>{language === "ko" ? "내 곡 차트" : "Your song charts"}</h2>
            <p>{language === "ko" ? "RYM 곡 차트에서 저장한 JSON 차트 기록을 불러와 곡을 확인하고 순위 변화를 비교할 수 있습니다." : "Import a JSON chart record saved from a RYM song chart to view your songs and compare rankings."}</p>
            <button type="button" onClick={openImportWithPassword}
              className="rym-button rym-button--primary rym-file-button">
              <RymIcon name="upload" /><span>{language === "ko" ? "차트 기록 불러오기" : "Import Record"}</span>
            </button>
          </section>
        )}
        {charts.length > 0 && (
          <>
            <section className="rym-comparison-bar" aria-label="Comparison toolbar">
              <div className="rym-comparison-head">
                <div className="rym-comparison-description">
                  <strong>{effectiveComparison
                    ? (effectiveComparison.sameChart ? (language === "ko" ? "시간 비교" : "Time comparison") : (language === "ko" ? "차트 비교" : "Chart comparison"))
                    : (language === "ko" ? "곡 차트" : "Song charts")}</strong>
                  <span>{sameChartComparison ? (language === "ko" ? "이전 기록 → 현재 기록" : "Previous record → current record") : (language === "ko" ? "기준 차트 → 대상 차트" : "Reference chart → target chart")}</span>
                </div>
                <div className="rym-search" role="search">
                  <RymIcon name="search" />
                  <input type="search" value={searchQuery}
                    onChange={(event) => setSearchQuery(event.target.value)}
                    placeholder={language === "ko" ? "곡 또는 아티스트 검색" : "Search songs or artists"} aria-label={language === "ko" ? "곡 또는 아티스트 검색" : "Search songs or artists"} />
                  {searchQuery && (
                    <button type="button" onClick={() => setSearchQuery("")} aria-label={language === "ko" ? "검색 지우기" : "Clear search"} title={language === "ko" ? "검색 지우기" : "Clear search"}>
                      <RymIcon name="close" />
                    </button>
                  )}
                </div>
              </div>
              {effectiveComparison && movementCounts && (
                <div className="rym-filterbar" aria-label="Filter target songs by movement">
                  <button type="button" className={"rym-filter rym-filter--all" + (movementFilter === "ALL" ? " is-active" : "")}
                    aria-pressed={movementFilter === "ALL"} onClick={() => setMovementFilter("ALL")}>
                    <span>{language === "ko" ? "전체" : "ALL"}</span><strong>{movementCounts.all}</strong>
                  </button>
                  <button type="button" className={"rym-filter rym-filter--changed" + (movementFilter === "CHANGED" ? " is-active" : "")}
                    aria-pressed={movementFilter === "CHANGED"} onClick={() => setMovementFilter((current) => current === "CHANGED" ? "ALL" : "CHANGED")}>
                    <span>{language === "ko" ? "변동" : "CHANGED"}</span><strong>{movementCounts.changed}</strong>
                  </button>
                  <button type="button" className={"rym-filter rym-filter--new" + (movementFilter === "NEW" ? " is-active" : "")}
                    aria-pressed={movementFilter === "NEW"} onClick={() => setMovementFilter((current) => current === "NEW" ? "ALL" : "NEW")}>
                    <span>{language === "ko" ? "신규" : "NEW"}</span><strong>{movementCounts.new}</strong>
                  </button>
                  <button type="button" className={"rym-filter rym-filter--up" + (movementFilter === "UP" ? " is-active" : "")}
                    aria-pressed={movementFilter === "UP"} onClick={() => setMovementFilter((current) => current === "UP" ? "ALL" : "UP")}>
                    <RymIcon name="up" /><strong>{movementCounts.up}</strong>
                  </button>
                  <button type="button" className={"rym-filter rym-filter--down" + (movementFilter === "DOWN" ? " is-active" : "")}
                    aria-pressed={movementFilter === "DOWN"} onClick={() => setMovementFilter((current) => current === "DOWN" ? "ALL" : "DOWN")}>
                    <RymIcon name="down" /><strong>{movementCounts.down}</strong>
                  </button>
                  <button type="button" className={"rym-filter rym-filter--same" + (movementFilter === "SAME" ? " is-active" : "")}
                    aria-pressed={movementFilter === "SAME"} onClick={() => setMovementFilter((current) => current === "SAME" ? "ALL" : "SAME")}>
                    <RymIcon name="minus" /><strong>{movementCounts.same}</strong>
                  </button>
                  <button type="button" className={"rym-filter rym-filter--out" + (movementFilter === "OUT" ? " is-active" : "")}
                    aria-pressed={movementFilter === "OUT"} onClick={() => setMovementFilter((current) => current === "OUT" ? "ALL" : "OUT")}>
                    <span>{language === "ko" ? "이탈" : "OUT"}</span><strong>{movementCounts.out}</strong>
                  </button>
                </div>
              )}
            </section>
            <div className="rym-chart-grid">
              <ChartPane side="LEFT" compact charts={charts} chartUrl={leftChartUrl}
                snapshotKeyValue={leftSnapshotKey}
                onChartChange={(value) => { setLeftChartUrl(value); setLeftSnapshotKey(""); }}
                onSnapshotChange={setLeftSnapshotKey} snapshot={leftSnapshot}
                roleLabel={sameChartComparison ? (language === "ko" ? "이전" : "PREVIOUS") : (language === "ko" ? "기준" : "REFERENCE")} language={language}
                activeSpotifyUrl={activeSpotifyUrl} onToggleSpotify={toggleSpotifyPreview} />
              <ChartPane side="RIGHT" charts={charts} chartUrl={rightChartUrl}
                snapshotKeyValue={rightSnapshotKey}
                onChartChange={(value) => {
                  setRightChartUrl(value);

                  const nextChart =
                    charts.find((item) => item.sourceUrl === value) ?? null;

                  if (!nextChart) {
                    setRightSnapshotKey("");
                    return;
                  }

                  const weekly =
                    weeklySnapshotRepresentatives(nextChart.snapshots);
                  const latest =
                    weekly[weekly.length - 1] ?? null;

                  if (!latest) {
                    setRightSnapshotKey("");
                    return;
                  }

                  setRightSnapshotKey(snapshotKey(latest));

                  const previous =
                    previousWeeklySnapshot(nextChart.snapshots, latest);

                  setLeftChartUrl(value);
                  setLeftSnapshotKey(
                    previous ? snapshotKey(previous) : snapshotKey(latest)
                  );
                }}
                onSnapshotChange={(value) => {
                  setRightSnapshotKey(value);

                  const currentRightChart =
                    charts.find(
                      (item) => item.sourceUrl === rightChartUrl
                    ) ?? null;

                  const selectedRight =
                    currentRightChart?.snapshots.find(
                      (snapshot) => snapshotKey(snapshot) === value
                    ) ?? null;

                  if (!currentRightChart || !selectedRight) return;

                  const previous =
                    previousWeeklySnapshot(
                      currentRightChart.snapshots,
                      selectedRight
                    );

                  setLeftChartUrl(currentRightChart.sourceUrl);
                  setLeftSnapshotKey(
                    previous
                      ? snapshotKey(previous)
                      : snapshotKey(selectedRight)
                  );
                }} snapshot={rightSnapshot}
                comparedSongs={effectiveComparison?.current ?? null} outSongs={effectiveComparison?.out ?? []}
                comparisonActive={Boolean(effectiveComparison)} filter={effectiveComparison ? movementFilter : "ALL"}
                query={searchQuery} roleLabel={sameChartComparison ? (language === "ko" ? "현재" : "CURRENT") : (language === "ko" ? "대상" : "TARGET")} language={language}
                activeSpotifyUrl={activeSpotifyUrl} onToggleSpotify={toggleSpotifyPreview} />
            </div>
          </>
        )}
      </div>

      <footer className="rym-site-footer">
        <div className="rym-site-footer-copy">
          <div>
            Chart data sourced from Rate Your Music (RYM). RYM and related trademarks belong to their respective owners.
            This site is an unofficial project and is not affiliated with or endorsed by Rate Your Music.
          </div>
          <div className="rym-made-by">Made By ojihaus</div>
        </div>
        <button
          type="button"
          ref={scrollTopButtonRef}
          className="rym-scroll-top-button"
          onClick={() => {
            const startY = window.scrollY;
            const duration = 620;
            const startedAt = performance.now();

            const animate = (now: number) => {
              const progress = Math.min(1, (now - startedAt) / duration);
              const easeOut = 1 - Math.pow(1 - progress, 5);

              let y = startY * (1 - easeOut);

              if (progress > 0.72) {
                const bounceProgress = (progress - 0.72) / 0.28;
                const bounce =
                  12 *
                  Math.sin(bounceProgress * Math.PI) *
                  (1 - bounceProgress);
                y += bounce;
              }

              window.scrollTo(0, Math.max(0, y));

              if (progress < 1) {
                requestAnimationFrame(animate);
              } else {
                window.scrollTo(0, 0);
              }
            };

            requestAnimationFrame(animate);
          }}
          aria-label={language === "ko" ? "맨 위로 이동" : "Back to top"}
          title={language === "ko" ? "맨 위로" : "Back to top"}
        >
          <span className="rym-scroll-top-arrow" aria-hidden="true">↑</span>
          <span>{language === "ko" ? "맨 위로" : "Top"}</span>
        </button>
      </footer>
    </main>
  );
}

const RYM_STYLES = `
/* RYM structure + Apple restraint + TradingView data UX. */
html:has(.rym-app), body:has(.rym-app) {
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
  max-width: 100%;
  min-height: 100%;
  margin: 0;
  padding: 0;
  background: #f2f3f5;
  overflow-x: hidden;
  overflow-x: clip;
  overscroll-behavior-x: none;
  overscroll-behavior-y: none;
  touch-action: pan-y pinch-zoom;
}
html:has(.rym-app) { min-height: 100%; }
body:has(.rym-app) { display: block; min-height: 100vh; min-height: 100dvh; }
.rym-app {
  --rym-bg: #f2f3f5;
  --rym-surface: #ffffff;
  --rym-surface-soft: #f8f9fb;
  --rym-blue: #2f5591;
  --rym-blue-strong: #23477d;
  --rym-link: #315f8d;
  --rym-border: #dfe2e7;
  --rym-border-strong: #cfd4dc;
  --rym-text: #1f2328;
  --rym-muted: #727782;
  --rym-up: #1f7a43;
  --rym-down: #b44742;
  --rym-up-bg: #edf8f0;
  --rym-up-border: #77b78a;
  --rym-down-bg: #fff0ee;
  --rym-down-border: #d48780;
  --rym-new-bg: #edf4ff;
  --rym-new-border: #7da4d9;
  --rym-chip: #e7e9ed;
  --rym-radius: 7px;
  box-sizing: border-box;
  display: block;
  width: 100%; min-width: 0; max-width: 100%;
  margin: 0; padding: 0;
  overflow-x: hidden; overflow-x: clip;
  overscroll-behavior-x: none; overscroll-behavior-y: none;
  touch-action: pan-y pinch-zoom;
  overflow-wrap: anywhere;
  min-height: 100vh; min-height: 100dvh;
  background: var(--rym-bg); color: var(--rym-text); color-scheme: light;
  font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Helvetica, Arial, sans-serif;
  font-size: 1rem; line-height: 1.4;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  -webkit-text-size-adjust: 100%;
}
.rym-app *, .rym-app *::before, .rym-app *::after { box-sizing: border-box; }
.rym-app h1, .rym-app h2, .rym-app h3, .rym-app p { margin: 0; }
.rym-app button, .rym-app select, .rym-app input { font: inherit; }
.rym-app button { cursor: pointer; }
.rym-app button, .rym-app select { -webkit-tap-highlight-color: transparent; }
.rym-app button:disabled { cursor: default; opacity: .5; }
.rym-app button:focus-visible, .rym-app select:focus-visible,
.rym-app input:focus-visible, .rym-app [tabindex]:focus-visible {
  outline: 2px solid #6f98ca; outline-offset: 2px;
}
.rym-app .rym-icon { width: 1.0625rem; height: 1.0625rem; flex: 0 0 auto; vertical-align: middle; }


/* Administrator PIN modal */
.rym-app .rym-admin-backdrop {
  position: fixed;
  inset: 0;
  z-index: 9999;
  display: grid;
  place-items: center;
  padding: 1.25rem;
  background: rgba(18, 22, 28, .44);
  -webkit-backdrop-filter: blur(8px);
  backdrop-filter: blur(8px);
}
.rym-app .rym-admin-modal {
  position: relative;
  width: min(23rem, 100%);
  padding: 2rem 1.5rem 1.5rem;
  border: 0;
  border-radius: 1rem;
  background: #fff;
  box-shadow:
    0 2rem 5rem rgba(15, 23, 42, .34),
    0 .75rem 1.75rem rgba(15, 23, 42, .22);
  text-align: center;
}
.rym-app .rym-admin-close {
  position: absolute;
  top: .65rem;
  right: .75rem;
  width: 2rem;
  height: 2rem;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: #7a808a;
  font-size: 1.5rem;
  line-height: 1;
}
.rym-app .rym-admin-close:hover { background: #f0f2f5; color: #343941; }
.rym-app .rym-admin-modal h2 {
  color: #1f2328;
  font-size: 1.08rem;
  font-weight: 750;
  letter-spacing: -.01em;
}
.rym-app .rym-admin-modal > p {
  margin-top: .4rem;
  color: #767c86;
  font-size: .9rem;
}
.rym-app .rym-admin-modal form { position: relative; margin-top: 1.25rem; }
.rym-app .rym-admin-pin {
  position: absolute;
  z-index: 2;
  top: 0;
  left: 50%;
  width: 14.45rem;
  height: 3.45rem;
  transform: translateX(-50%);
  border: 0;
  border-radius: .7rem;
  opacity: .01;
  background: transparent;
  color: transparent;
  caret-color: transparent;
  cursor: text;
}
.rym-app .rym-admin-dots {
  display: grid;
  grid-template-columns: repeat(4, 3.2rem);
  justify-content: center;
  gap: .55rem;
}
.rym-app .rym-admin-dots span {
  display: grid;
  place-items: center;
  width: 3.2rem;
  height: 3.45rem;
  border: 0;
  border-radius: .7rem;
  background: #f3f5f8;
  box-shadow: inset 0 1px 2px rgba(25, 33, 45, .04);
}
.rym-app .rym-admin-dots span::after {
  content: "";
  width: .58rem;
  height: .58rem;
  border-radius: 50%;
  background: transparent;
  transform: scale(.5);
  transition: transform .12s ease, background .12s ease;
}
.rym-app .rym-admin-dots span.is-filled {
  background: #eef4fb;
}
.rym-app .rym-admin-dots span.is-filled::after {
  background: #294f82;
  transform: scale(1);
}
.rym-app .rym-admin-error {
  min-height: 1.25rem;
  margin-top: .65rem;
  color: #b44742;
  font-size: .8rem;
}
.rym-app .rym-admin-submit {
  width: 100%;
  margin-top: .3rem;
  min-height: 2.75rem;
  border: 0;
  border-radius: .65rem;
  background: #2f5591;
  color: #fff;
  font-weight: 700;
}
.rym-app .rym-admin-submit:hover:not(:disabled) { background: #274a7f; }
.rym-app .rym-admin-submit:disabled { opacity: .45; }


.rym-app .rym-pin-change-form {
  position: static;
  display: grid;
  gap: .85rem;
  margin-top: 1.25rem;
  text-align: left;
}
.rym-app .rym-pin-change-form label {
  display: grid;
  gap: .38rem;
}
.rym-app .rym-pin-change-form label > span {
  color: #555d68;
  font-size: .78rem;
  font-weight: 650;
}
.rym-app .rym-pin-change-form input {
  width: 100%;
  min-height: 2.8rem;
  padding: 0 .9rem;
  border: 0;
  border-radius: .65rem;
  outline: none;
  background: #f2f4f7;
  color: #1f2328;
  font: inherit;
  letter-spacing: .22em;
}
.rym-app .rym-pin-change-form input:focus {
  background: #eaf1f9;
  box-shadow: 0 0 0 2px rgba(47, 85, 145, .14);
}
.rym-app .rym-song-actions {
  display: inline-flex;
  align-items: center;
  gap: .42rem;
  margin-top: .48rem;
}
.rym-app .rym-song-actions .rym-preview-button {
  margin-top: 0;
}
.rym-app .rym-rym-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.8rem;
  height: 1.8rem;
  padding: 0;
  border: 0;
  border-radius: 999px;
  background: transparent;
  text-decoration: none;
  cursor: pointer;
  overflow: hidden;
  transition: transform .14s ease, box-shadow .14s ease;
}
.rym-app .rym-rym-button:hover {
  box-shadow: 0 .18rem .55rem rgba(31, 43, 59, .16);
}
.rym-app .rym-rym-button:active {
  transform: scale(.96);
}
.rym-app .rym-rym-logo-image {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}
@media (max-width: 680px) {
  .rym-app .rym-song-actions {
    margin-top: .42rem;
  }
}

/* Header: keep RYM hierarchy, tighten the chrome. */
.rym-app .rym-topbar { background: rgba(255,255,255,.98); border-bottom: 1px solid var(--rym-border); box-shadow: 0 1px 2px #00000008; }
.rym-app .rym-topbar-inner, .rym-app .rym-subbar-inner {
  width: 100%; min-width: 0; max-width: none; margin-inline: 0;
  padding-inline: clamp(.75rem, 3vw, 3rem);
  display: flex; align-items: center; gap: 1rem;
}
.rym-app .rym-topbar-inner { min-height: 3.75rem; padding-block: .625rem; justify-content: space-between; flex-wrap: wrap; }
.rym-app .rym-brand {
  display: inline-flex; align-items: baseline; gap: .32rem;
  margin: 0; color: var(--rym-link); white-space: nowrap;
  line-height: 1; letter-spacing: -.035em;
}
.rym-app .rym-brand-rym {
  font-size: 1.22rem; font-weight: 820; letter-spacing: .025em;
}
.rym-app .rym-brand-tracker {
  font-size: 1.14rem; font-weight: 560; letter-spacing: -.035em;
}
.rym-app .rym-header-actions { display: flex; align-items: center; gap: .5rem; flex-wrap: wrap; min-width: 0; max-width: 100%; }
.rym-app .rym-button {
  display: inline-flex; align-items: center; justify-content: center; gap: .4375rem;
  position: relative; min-width: 0; max-width: 100%; min-height: 2.375rem; padding: .4375rem .75rem;
  border: 1px solid transparent; border-radius: var(--rym-radius); font-weight: 600;
  font-size: .8125rem; line-height: 1.3; text-decoration: none;
  transition: background-color .14s ease, border-color .14s ease, box-shadow .14s ease, transform .14s ease;
}
.rym-app .rym-button:active:not(:disabled) { transform: translateY(1px); }
.rym-app .rym-button--primary { background: var(--rym-blue); border-color: transparent; color: #fff; box-shadow: none; }
.rym-app .rym-button--primary:hover { background: var(--rym-blue-strong); border-color: transparent; box-shadow: none; }
.rym-app .rym-button--secondary { background: #fff; color: #425b78; border-color: var(--rym-border-strong); }
.rym-app .rym-button--secondary:hover, .rym-app .rym-button--secondary.is-active { background: #f2f5f9; border-color: #aebdce; }
.rym-app .rym-button--danger-outline { color: #a83c38; border-color: #deb8b7; background: #fff; }
.rym-app .rym-button--danger-outline:hover:not(:disabled) { background: #faf0ef; }
.rym-app .rym-button--danger { color: #fff; background: #af4541; border-color: #af4541; }
.rym-app .rym-button--danger:hover:not(:disabled) { background: #963935; }
.rym-app .rym-file-button { cursor: pointer; overflow: hidden; }
.rym-app .rym-file-button:focus-within { outline: 2px solid #6f98ca; outline-offset: 2px; }
.rym-app .rym-file-input { display: none !important; }
.rym-app 
.rym-language-button {
  min-width: 72px;
}
.rym-language-button .rym-icon { width: 17px; height: 17px; }
.rym-subbar { background: var(--rym-surface); border-bottom: 1px solid var(--rym-border); }
.rym-app .rym-subbar-inner { min-height: 3.375rem; padding-block: .625rem; flex-wrap: wrap; }
.rym-app .rym-context-copy {
  display: flex; align-items: baseline; gap: .65rem; min-width: 0;
}
.rym-app .rym-subbar-description {
  color: var(--rym-muted); font-size: .82rem; line-height: 1.35;
}
.rym-app .rym-subbar-count { color: var(--rym-muted); font-size: .8125rem; margin-left: auto; font-variant-numeric: tabular-nums; }

/* Workspace / comparison toolbar. */
.rym-app .rym-workspace {
  width: 100%; min-width: 0; max-width: none; margin-inline: 0;
  padding: 1rem clamp(.75rem, 3vw, 3rem) 1.25rem;
}
.rym-app .rym-comparison-bar {
  background: rgba(255,255,255,.92); border: 1px solid var(--rym-border); border-radius: 12px;
  padding: .75rem; margin-bottom: 1rem; box-shadow: 0 1px 2px #00000008;
}
.rym-app .rym-comparison-head { display: flex; align-items: center; justify-content: space-between; gap: .75rem 1rem; flex-wrap: wrap; }
.rym-app .rym-comparison-description { display: flex; flex-wrap: wrap; align-items: baseline; column-gap: .75rem; row-gap: .2rem; min-width: 0; }
.rym-app .rym-comparison-description strong { font-size: .9375rem; font-weight: 700; letter-spacing: -.01em; }
.rym-app .rym-comparison-description > span { font-size: .8125rem; color: var(--rym-muted); }
.rym-app .rym-search {
  position: relative; display: flex; align-items: center; width: min(20rem, 100%); min-width: 12rem;
  height: 2.25rem; border: 1px solid var(--rym-border-strong); border-radius: 7px; background: #fff;
  color: #848995; transition: border-color .14s ease, box-shadow .14s ease;
}
.rym-app .rym-search:focus-within { border-color: #7f9fc5; box-shadow: 0 0 0 3px #dce8f7; }
.rym-app .rym-search > .rym-icon { margin-left: .625rem; width: .9375rem; height: .9375rem; }
.rym-app .rym-search input { width: 100%; min-width: 0; height: 100%; border: 0; outline: 0; background: transparent; color: var(--rym-text); padding: 0 .45rem; font-size: .8125rem; }
.rym-app .rym-search input::-webkit-search-cancel-button { display: none; }
.rym-app .rym-search button { width: 2rem; height: 100%; border: 0; background: transparent; color: #8b9099; display: grid; place-items: center; padding: 0; }
.rym-app .rym-search button:hover { color: #4f5661; }
.rym-app .rym-search button .rym-icon { width: .8125rem; height: .8125rem; }
.rym-app .rym-filterbar { display: flex; flex-wrap: wrap; align-items: center; gap: .375rem; margin-top: .625rem; padding-top: .625rem; border-top: 1px solid #eceef1; }
.rym-app .rym-filter {
  min-height: 1.875rem; display: inline-flex; align-items: center; justify-content: center; gap: .35rem;
  padding: .25rem .625rem; border: 1px solid #d9dde3; border-radius: 999px; background: #f8f9fb; color: #626873;
  font-size: .71875rem; font-weight: 650; line-height: 1; font-variant-numeric: tabular-nums;
  transition: background-color .14s ease, border-color .14s ease, color .14s ease, box-shadow .14s ease;
}
.rym-app .rym-filter strong { font-size: .75rem; }
.rym-app .rym-filter .rym-icon { width: .6875rem; height: .6875rem; }
.rym-app .rym-filter:hover { background: #fff; border-color: #bdc4ce; }
.rym-app .rym-filter.is-active { background: #fff; border-color: #929ba8; color: #30343a; box-shadow: 0 1px 3px #00000012; }
.rym-app .rym-filter--new { color: #315f96; }
.rym-app .rym-filter--new.is-active { background: var(--rym-new-bg); border-color: var(--rym-new-border); }
.rym-app .rym-filter--up { color: var(--rym-up); }
.rym-app .rym-filter--up.is-active { background: var(--rym-up-bg); border-color: var(--rym-up-border); }
.rym-app .rym-filter--down { color: var(--rym-down); }
.rym-app .rym-filter--down.is-active { background: var(--rym-down-bg); border-color: var(--rym-down-border); }
.rym-app .rym-filter--same, .rym-app .rym-filter--out { color: #737985; }

/* Two-column chart layout. */
.rym-app .rym-chart-grid { display: grid; grid-template-columns: minmax(0, 1fr); gap: 1rem; align-items: start; }
.rym-app .rym-pane { min-width: 0; }
.rym-app .rym-pane-heading { margin-bottom: .75rem; }
.rym-app .rym-pane-caption { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: .5rem; color: #636674; font-size: .8125rem; margin-bottom: .4rem; }
.rym-app .rym-role-badge { display: inline-flex; align-items: center; min-height: 1.375rem; padding: .15rem .5rem; border: 1px solid #d6dae0; border-radius: 4px; background: #eef0f3; color: #666c76; font-size: .65625rem; line-height: 1; font-weight: 750; letter-spacing: .06em; }
.rym-app .rym-role-badge--target { background: #edf3fb; border-color: #c6d5e8; color: var(--rym-blue); }
.rym-app .rym-count-pill { background: var(--rym-chip); color: #50545c; padding: .175rem .625rem; border-radius: 999px; font-size: .75rem; white-space: nowrap; font-variant-numeric: tabular-nums; }
.rym-app .rym-chart-title { font-size: clamp(1.35rem, 2.2vw, 2rem); font-weight: 720; line-height: 1.18; letter-spacing: -.025em; overflow-wrap: anywhere; }
.rym-app .rym-pane--compact .rym-chart-title { font-size: 1.2rem; line-height: 1.25; letter-spacing: -.015em; }
.rym-app .rym-chart-controls {
  background: #fff; border: 1px solid var(--rym-border); border-radius: 12px; padding: .75rem; margin-bottom: .625rem;
  display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: .625rem; align-items: start;
  box-shadow: 0 1px 2px #00000006;
}
.rym-app .rym-pane--compact .rym-chart-controls { grid-template-columns: minmax(0, 1fr); }
.rym-app .rym-field { min-width: 0; }
.rym-app .rym-snapshot-field { position: relative; }
.rym-app .rym-field-label { display: block; font-size: .75rem; font-weight: 650; color: #5c626c; margin-bottom: .35rem; }
.rym-app .rym-field-heading { min-height: 1.45rem; display: flex; align-items: baseline; justify-content: space-between; flex-wrap: wrap; gap: .25rem; }
.rym-app .rym-field-heading .rym-field-label { margin-bottom: .35rem; }
.rym-app .rym-select {
  display: block; width: 100%; min-width: 0; height: 2.375rem; border: 1px solid var(--rym-border-strong);
  border-radius: 10px; padding: .5rem 2rem .5rem .65rem;
  background-color: #f8f9fb; color: #3d434c; font-size: .8125rem;
  white-space: nowrap; text-overflow: ellipsis; appearance: none; cursor: pointer;
  background-repeat: no-repeat; background-position: right .675rem center; background-size: .5625rem;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 10 6'%3E%3Cpath d='M0 0h10L5 6Z' fill='%23565c67'/%3E%3C/svg%3E");
  transition: border-color .14s ease, box-shadow .14s ease, background-color .14s ease;
}
.rym-app .rym-select:hover { border-color: #b5bbc4; background-color: #fff; }
.rym-app .rym-select:focus { border-color: #7f9fc5; box-shadow: 0 0 0 3px #dce8f7; outline: none; }
.rym-app .rym-select--blue {
  background-color: var(--rym-blue); border-color: transparent; color: #fff; font-weight: 650;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 10 6'%3E%3Cpath d='M0 0h10L5 6Z' fill='white'/%3E%3C/svg%3E");
}
.rym-app .rym-select--blue:hover { background-color: var(--rym-blue-strong); border-color: transparent; box-shadow: none; }
.rym-app .rym-select--blue:focus { border-color: transparent; box-shadow: none; outline: none; }
.rym-app .rym-select option { background: #fff; color: #202122; }
.rym-app .rym-snapshot-control {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: stretch;
  gap: .4rem;
  width: 100%;
  min-width: 0;
}
.rym-app .rym-snapshot-control .rym-select {
  min-width: 0;
}
.rym-app .rym-calendar-toggle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: .35rem;
  height: 2.375rem;
  min-width: 4.4rem;
  padding: 0 .7rem;
  border: 1px solid #b8c9dc;
  border-radius: 10px;
  background: #edf4fb;
  color: var(--rym-blue);
  font-size: .75rem;
  font-weight: 720;
  line-height: 1;
  white-space: nowrap;
  cursor: pointer;
  box-shadow: none;
  transition:
    background-color .14s ease,
    border-color .14s ease,
    color .14s ease,
    transform .12s ease;
}
.rym-app .rym-calendar-toggle .rym-icon {
  width: .9rem;
  height: .9rem;
  flex: 0 0 auto;
}
.rym-app .rym-calendar-toggle:hover {
  background: #e2edf8;
  border-color: #9eb7d2;
}
.rym-app .rym-calendar-toggle:active {
  transform: translateY(1px);
}
.rym-app .rym-calendar-toggle:focus-visible {
  outline: 2px solid #8aa9ca;
  outline-offset: 2px;
}
.rym-app .rym-calendar-toggle[aria-expanded="true"] {
  background: var(--rym-blue);
  border-color: transparent;
  color: #fff;
  box-shadow: none;
}

.rym-app .rym-calendar-popover {
  position: absolute;
  z-index: 40;
  top: calc(100% + .375rem);
  right: 0;
  width: min(20rem, calc(100vw - 2rem));
  max-width: 100%;
  box-sizing: border-box;
}
.rym-app .rym-pane--compact .rym-calendar-popover {
  left: 0;
  right: auto;
  width: 100%;
  max-width: 100%;
  min-width: 0;
}

/* Song rows: denser than v6, with status color carried by a left rail. */
.rym-app .rym-song-list { display: flex; flex-direction: column; gap: .375rem; }
.rym-app .rym-song-list, .rym-app .rym-library-list { min-width: 0; max-width: 100%; overscroll-behavior-x: none; touch-action: pan-y pinch-zoom; }
.rym-app .rym-song {
  --rym-cover-size: clamp(6.25rem, calc(10vw + 1.5rem), 10.75rem);
  --rym-cover-active-size: calc(var(--rym-cover-size) + 176px);
  position: relative; display: grid; grid-template-columns: 2.5rem var(--rym-cover-size) minmax(0, 1fr);
  gap: .875rem; padding: .75rem .875rem .75rem .7rem;
  background: var(--rym-surface); border: 1px solid var(--rym-border); border-radius: 10px;
  box-shadow: 0 1px 1px #00000004; flex-shrink: 0; min-width: 0; overflow: hidden;
  transition:
    grid-template-columns .38s cubic-bezier(.22, 1, .36, 1),
    border-color .14s ease,
    box-shadow .14s ease,
    transform .14s ease;
}
.rym-app .rym-song--playing {
  grid-template-columns: 2.5rem var(--rym-cover-active-size) minmax(0, 1fr);
}
@media (hover: hover) {
  .rym-app .rym-song:hover { border-color: #cbd0d7; box-shadow: 0 3px 10px #0000000d; transform: translateY(-1px); }
}
.rym-app .rym-song::before { content: ""; position: absolute; inset: 0 auto 0 0; width: 0; background: transparent; }
.rym-app .rym-song--up::before, .rym-app .rym-song--down::before, .rym-app .rym-song--new::before { width: 4px; }
.rym-app .rym-song--up::before { background: var(--rym-up); }
.rym-app .rym-song--down::before { background: var(--rym-down); }
.rym-app .rym-song--new::before { background: var(--rym-blue); }
.rym-app .rym-rank { text-align: center; display: flex; flex-direction: column; align-items: center; justify-content: flex-start; gap: .35rem; padding-top: .025rem; min-width: 0; }
.rym-app .rym-rank-number {
  color: #24272b;
  font-size: 1.2rem;
  font-weight: 760;
  line-height: 1.2;
  font-variant-numeric: tabular-nums;
  letter-spacing: -.02em;
  white-space: nowrap;
  word-break: keep-all;
}
.rym-app .rym-cover {
  width: var(--rym-cover-size);
  height: var(--rym-cover-size);
  aspect-ratio: 1;
  background: #e5e7eb;
  overflow: hidden;
  flex: 0 0 auto;
  border-radius: 3px;
  transition:
    width .38s cubic-bezier(.22, 1, .36, 1),
    height .38s cubic-bezier(.22, 1, .36, 1),
    transform .38s cubic-bezier(.22, 1, .36, 1);
  will-change: width, height;
}
.rym-app .rym-cover--expanded {
  width: var(--rym-cover-active-size);
  height: var(--rym-cover-active-size);
}
.rym-app .rym-cover img { display: block; width: 100%; height: 100%; object-fit: cover; border-radius: 0; }

@media (max-width: 680px) {
  .rym-app .rym-song:not(.rym-song--compact) {
    transition:
      min-height .36s cubic-bezier(.22, 1, .36, 1),
      padding .36s cubic-bezier(.22, 1, .36, 1),
      border-color .14s ease,
      box-shadow .14s ease,
      transform .14s ease;
  }

  .rym-app .rym-song:not(.rym-song--compact) .rym-song-info-transition {
    opacity: 1;
    transform: translateY(0);
    max-height: 12rem;
    overflow: hidden;
    transition:
      opacity .18s ease,
      transform .28s cubic-bezier(.22, 1, .36, 1),
      max-height .32s cubic-bezier(.22, 1, .36, 1);
  }

  .rym-app .rym-song:not(.rym-song--compact) .rym-player-shell {
    transform-origin: top center;
  }

  .rym-app .rym-song--playing:not(.rym-song--compact) {
    --rym-mobile-player-height: 152px;
    --rym-mobile-control-size: 2.1rem;
    --rym-mobile-control-gap: .65rem;
    display: block;
    box-sizing: border-box;
    height: calc(
      (0.72rem * 2) +
      var(--rym-mobile-control-size) +
      var(--rym-mobile-control-gap) +
      var(--rym-mobile-player-height)
    );
    min-height: 0 !important;
    max-height: calc(
      (0.72rem * 2) +
      var(--rym-mobile-control-size) +
      var(--rym-mobile-control-gap) +
      var(--rym-mobile-player-height)
    );
    padding: .72rem;
    overflow: hidden;
  }

  .rym-app .rym-song--playing:not(.rym-song--compact) > .rym-rank,
  .rym-app .rym-song--playing:not(.rym-song--compact) > .rym-cover,
  .rym-app .rym-song--playing:not(.rym-song--compact) .rym-song-bottom {
    opacity: 0;
    pointer-events: none;
    position: absolute;
    transform: translateY(-5px);
    transition:
      opacity .16s ease,
      transform .24s cubic-bezier(.22, 1, .36, 1);
  }

  .rym-app .rym-song--playing:not(.rym-song--compact) > .rym-song-body {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    width: 100%;
    min-width: 0;
    max-width: 100%;
    padding: 0;
    margin: 0;
  }

  .rym-app .rym-song--playing:not(.rym-song--compact) .rym-song-info-transition {
    opacity: 0;
    transform: translateY(-6px);
    max-height: 0;
    pointer-events: none;
  }

  /* 일시정지 버튼은 좌측 상단에 남음 */
  .rym-app .rym-song--playing:not(.rym-song--compact) .rym-preview-button {
    align-self: flex-start;
    margin: 0 0 var(--rym-mobile-control-gap) 0;
    width: var(--rym-mobile-control-size);
    height: var(--rym-mobile-control-size);
    flex: 0 0 var(--rym-mobile-control-size);
    z-index: 5;
    background: #fff;
    animation: rym-mobile-control-in .26s cubic-bezier(.22, 1, .36, 1) both;
  }

  /* Spotify 프리뷰는 아래에서 올라오며 전체 폭으로 등장 */
  .rym-app .rym-song--playing:not(.rym-song--compact) .rym-player-shell {
    width: 100%;
    height: var(--rym-mobile-player-height);
    min-width: 0;
    max-width: 100%;
    margin: 0;
    padding: 0;
    opacity: 1;
    overflow: hidden;
    display: block;
    animation: rym-mobile-player-in .36s .07s cubic-bezier(.22, 1, .36, 1) both;
  }

  .rym-app .rym-song--playing:not(.rym-song--compact) .rym-player-reveal {
    width: 100%;
    height: 100%;
    min-width: 0;
    max-width: 100%;
    overflow: hidden;
    opacity: 1;
    transform: none !important;
    border-radius: 10px;
  }

  .rym-app .rym-song--playing:not(.rym-song--compact) .rym-spotify-controller,
  .rym-app .rym-song--playing:not(.rym-song--compact) .rym-spotify-mount {
    width: 100% !important;
    height: 100% !important;
    min-height: 0 !important;
    max-width: 100% !important;
    min-width: 0 !important;
  }

  .rym-app .rym-song--playing:not(.rym-song--compact) .rym-spotify-controller iframe {
    display: block;
    width: 100% !important;
    height: var(--rym-mobile-player-height) !important;
    min-height: var(--rym-mobile-player-height) !important;
    max-width: 100% !important;
    border: 0 !important;
    border-radius: 10px !important;
  }

  @keyframes rym-mobile-player-in {
    from {
      opacity: 0;
      transform: translateY(12px) scale(.985);
    }
    to {
      opacity: 1;
      transform: translateY(0) scale(1);
    }
  }

  @keyframes rym-mobile-control-in {
    from {
      opacity: 0;
      transform: translateY(-4px) scale(.92);
    }
    to {
      opacity: 1;
      transform: translateY(0) scale(1);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .rym-app .rym-song:not(.rym-song--compact),
    .rym-app .rym-song:not(.rym-song--compact) .rym-song-info-transition,
    .rym-app .rym-song--playing:not(.rym-song--compact) .rym-preview-button,
    .rym-app .rym-song--playing:not(.rym-song--compact) .rym-player-shell {
      transition: none !important;
      animation: none !important;
    }
  }
}

@media (max-width: 900px) {
  .rym-app .rym-song {
    --rym-cover-active-size: min(calc(var(--rym-cover-size) + 176px), 42vw);
  }
}

@media (max-width: 680px) {
  .rym-app .rym-song--playing:not(.rym-song--compact) {
    --rym-cover-active-size: var(--rym-cover-size);
  }
}

.rym-app .rym-cover.is-missing::after {
  content: "—"; display: grid; place-items: center; width: 100%; height: 100%;
  color: #a3a8b0; font-weight: 600;
}
.rym-app .rym-cover-empty { width: 100%; height: 100%; display: grid; place-items: center; color: #a4a8b1; font-size: 1.35rem; }
.rym-app .rym-song-body { min-width: 0; display: flex; flex-direction: column; align-items: flex-start; }
.rym-app .rym-song-body > * { min-width: 0; max-width: 100%; }
.rym-app .rym-song-info-transition {
  width: 100%;
  min-width: 0;
  max-width: 100%;
}
.rym-app .rym-song-title { color: var(--rym-link); font-weight: 500; font-size: 1.08rem; line-height: 1.28; letter-spacing: -.012em; overflow-wrap: anywhere; }
.rym-app .rym-song-artists { color: var(--rym-link); font-weight: 700; font-size: .96rem; line-height: 1.3; margin-top: .08rem; overflow-wrap: anywhere; }
.rym-app .rym-preview-button {
  display: inline-flex; align-items: center; justify-content: center; margin-top: .48rem;
  width: 1.8rem; height: 1.8rem; padding: 0; border: 1px solid #d3d7dd; border-radius: 50%; background: #fff;
  color: #3b4149; line-height: 1; cursor: pointer;
  transition: background-color .14s ease, border-color .14s ease, box-shadow .14s ease, transform .14s ease;
}
.rym-app .rym-preview-button:hover { background: #f7f8f9; border-color: #bcc2ca; }
.rym-app .rym-preview-button:active { transform: scale(.96); }
.rym-app .rym-preview-button.is-active { background: #f2f3f5; border-color: #aeb5bf; }
.rym-app .rym-preview-play { width: 0; height: 0; border-top: .3rem solid transparent; border-bottom: .3rem solid transparent; border-left: .48rem solid #202326; margin-left: .08rem; }
.rym-app .rym-preview-pause { position: relative; width: .48rem; height: .58rem; border-left: .15rem solid #202326; border-right: .15rem solid #202326; }
.rym-player-shell {
  display: grid;
  grid-template-rows: 0fr;
  width: 100%;
  margin-top: 0;
  opacity: 0;
  transition:
    grid-template-rows .34s cubic-bezier(.22, 1, .36, 1),
    opacity .22s ease,
    margin-top .34s cubic-bezier(.22, 1, .36, 1);
}
.rym-player-shell.is-open {
  grid-template-rows: 1fr;
  margin-top: .5rem;
  opacity: 1;
}
.rym-player-reveal {
  min-height: 0;
  overflow: hidden;
  opacity: 0;
  transform: translateY(-7px) scale(.988);
  transform-origin: top center;
  transition:
    opacity .22s ease .04s,
    transform .34s cubic-bezier(.22, 1, .36, 1);
}
.rym-player-shell.is-open .rym-player-reveal {
  opacity: 1;
  transform: translateY(0) scale(1);
}
.rym-spotify-controller {
  width: 100%;
  min-height: 152px;
  border-radius: 10px;
  overflow: hidden;
  box-shadow: 0 1px 2px rgba(20, 24, 31, .05);
}
.rym-spotify-mount {
  width: 100%;
  min-height: 80px;
}
.rym-spotify-controller iframe {
  display: block;
  width: 100% !important;
  max-width: 100%;
  border: 0;
  border-radius: 10px;
}
.rym-app .rym-spotify-embed iframe { display: block; width: 100%; min-width: 0; border: 0; }
.rym-app .rym-song-date {
  color: #737983;
  font-size: .78rem;
  margin-top: .3rem;
  line-height: 1.35;
  overflow-wrap: anywhere;
}
.rym-app .rym-song-genre {
  color: var(--rym-link);
  font-size: .84rem;
  font-weight: 700;
  margin-top: .3rem;
  line-height: 1.3;
  overflow-wrap: anywhere;
}
.rym-app .rym-song-bottom { width: 100%; margin-top: auto; padding-top: .7rem; display: flex; flex-wrap: wrap; gap: .4rem .875rem; align-items: baseline; justify-content: space-between; }
.rym-app .rym-rank-route { display: inline-flex; align-items: center; gap: .3rem; color: #747a84; font-size: .75rem; font-variant-numeric: tabular-nums; white-space: nowrap; }
.rym-app .rym-rank-route strong { color: #34383e; font-weight: 700; }
.rym-app .rym-rank-route-arrow { color: #a1a6ae; }
.rym-app .rym-rating { display: inline-flex; align-items: center; flex-wrap: wrap; gap: .3rem; margin-left: auto; font-variant-numeric: tabular-nums; }
.rym-app .rym-rating .rym-icon { color: var(--rym-blue); width: .875rem; height: .875rem; }
.rym-app .rym-rating strong { font-size: 1rem; line-height: 1.2; font-weight: 720; }
.rym-app .rym-rating-count { color: #737984; font-size: .75rem; }
.rym-app .rym-movement { display: inline-flex; align-items: center; justify-content: center; gap: .16rem; line-height: 1.2; font-size: .75rem; font-weight: 760; font-variant-numeric: tabular-nums; }
.rym-app .rym-movement .rym-icon { width: .7rem; height: .7rem; }
.rym-app .rym-movement--up { color: var(--rym-up); }
.rym-app .rym-movement--down { color: var(--rym-down); }
.rym-app .rym-movement--same { color: #969ba5; }
.rym-app .rym-movement--same .rym-icon { width: .8rem; }
.rym-app .rym-status { display: inline-flex; align-items: center; justify-content: center; font-size: .625rem; font-weight: 780; line-height: 1.2; letter-spacing: .035em; }
.rym-app .rym-status--new { color: var(--rym-blue); background: #dce9fa; border: 1px solid #aac3e1; padding: .16rem .3rem; border-radius: 4px; }
.rym-app .rym-status--out { color: #747a84; background: #eceef1; border: 1px solid #d5d8dd; padding: .16rem .3rem; border-radius: 4px; }
.rym-app .rym-song--compact {
  --rym-cover-size: 4.15rem;
  grid-template-columns: 2.15rem var(--rym-cover-size) minmax(0, 1fr);
  gap: .7rem;
  padding: .42rem .68rem .42rem .48rem;
  border-radius: 10px;
  align-items: center;
}
.rym-app .rym-song--compact .rym-rank-number {
  width: 100%;
  min-width: 2rem;
  font-size: .9375rem;
  text-align: right;
  white-space: nowrap;
}
.rym-app .rym-song--compact .rym-song-title { font-size: .875rem; line-height: 1.25; }
.rym-app .rym-song--compact .rym-song-artists { font-size: .8125rem; line-height: 1.25; margin-top: .18rem; }
.rym-app .rym-song--up { background: var(--rym-up-bg); border-color: var(--rym-up-border); }
.rym-app .rym-song--down { background: var(--rym-down-bg); border-color: var(--rym-down-border); }
.rym-app .rym-song--new { background: var(--rym-new-bg); border-color: var(--rym-new-border); }
.rym-app .rym-song--out { background: #f8f8f9; border-color: #d9dce1; }
.rym-app .rym-song--out .rym-rank-number, .rym-app .rym-song--out .rym-song-title, .rym-app .rym-song--out .rym-song-artists { color: #777d86; }
.rym-app .rym-song--out .rym-cover img { filter: grayscale(.75); opacity: .72; }
.rym-app .rym-out-section { margin-top: .75rem; display: flex; flex-direction: column; gap: .375rem; }
.rym-app .rym-out-heading { border-top: 1px solid #d2d5dc; padding: .8rem .2rem .35rem; }
.rym-app .rym-out-heading h3 { font-size: .9375rem; font-weight: 750; }
.rym-app .rym-out-heading h3 > span { font-weight: 500; color: #757985; margin-left: .35rem; }
.rym-app .rym-out-heading p { margin-top: .18rem; color: var(--rym-muted); font-size: .75rem; }
.rym-app .rym-filter-empty { padding: 2.25rem 1rem; border: 1px dashed #ccd1d8; border-radius: 7px; background: #f8f9fb; color: #777d87; text-align: center; font-size: .8125rem; }

/* Calendar popover. */
.rym-app .rym-calendar {
  width: 100%;
  max-width: 100%;
  min-width: 0;
  box-sizing: border-box;
  margin-top: 0;
  padding: .75rem;
  border: 1px solid #d6dae1;
  background: rgba(255,255,255,.99);
  border-radius: 10px;
  box-shadow: 0 12px 34px #0000001c, 0 2px 7px #0000000d;
  overflow: hidden;
}
.rym-app .rym-calendar-heading { display: flex; align-items: center; justify-content: space-between; gap: .5rem; margin-bottom: .55rem; }
.rym-app .rym-calendar-month { font-size: .875rem; font-weight: 720; text-align: center; }
.rym-app .rym-calendar-month--compact { font-size: .8125rem; }
.rym-app .rym-icon-button { width: 1.875rem; height: 1.875rem; flex: 0 0 auto; padding: .35rem; display: inline-flex; align-items: center; justify-content: center; color: var(--rym-link); background: #fff; border: 1px solid #d8dade; border-radius: 10px; }
.rym-app .rym-icon-button:hover { background: #f0f3f7; }
.rym-app .rym-calendar-weeks {
  display: flex;
  flex-direction: column;
  gap: .35rem;
}
.rym-app .rym-calendar-week-button {
  width: 100%;
  min-width: 0;
  min-height: 2.8rem;
  padding: .5rem .65rem;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: .65rem;
  border: 1px solid #d9dde3;
  border-radius: 7px;
  background: #f5f6f8;
  color: #46505e;
  text-align: left;
  cursor: pointer;
}
.rym-app .rym-calendar-week-button:hover:not(:disabled) {
  background: #eaf0f7;
  border-color: #bfcbd9;
}
.rym-app .rym-calendar-week-button:disabled {
  background: #fafafa;
  color: #a7acb4;
  border-color: #eceef1;
  cursor: default;
  opacity: 1;
}
.rym-app .rym-calendar-week-button.is-selected {
  background: var(--rym-blue);
  border-color: var(--rym-blue);
  color: #fff;
}
.rym-app .rym-calendar-week-button.is-selected:hover {
  background: var(--rym-blue-strong);
  border-color: var(--rym-blue-strong);
}
.rym-app .rym-calendar-week-copy {
  min-width: 0;
  display: flex;
  align-items: baseline;
  gap: .5rem;
}
.rym-app .rym-calendar-week-copy strong {
  font-size: .8125rem;
  font-weight: 720;
  white-space: nowrap;
}
.rym-app .rym-calendar-week-copy > span {
  min-width: 0;
  color: #7b818b;
  font-size: .72rem;
  white-space: nowrap;
}
.rym-app .rym-calendar-week-button.is-selected .rym-calendar-week-copy > span {
  color: rgba(255,255,255,.78);
}
.rym-app .rym-calendar-week-indicator {
  width: .42rem;
  height: .42rem;
  flex: 0 0 .42rem;
  border-radius: 50%;
  background: var(--rym-blue);
}
.rym-app .rym-calendar-week-button.is-selected .rym-calendar-week-indicator {
  background: #fff;
}

/* Library and utility states. */
.rym-app .rym-library { background: #fff; border: 1px solid var(--rym-border); border-radius: 8px; padding: 1rem; margin-bottom: 1rem; box-shadow: 0 1px 2px #00000006; }
.rym-app .rym-library-header { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: .75rem; }
.rym-app .rym-library-header h2 { font-weight: 720; font-size: 1.2rem; }
.rym-app .rym-library-header p { color: var(--rym-muted); font-size: .8125rem; margin-top: .2rem; }
.rym-app .rym-library-actions { display: flex; flex-wrap: wrap; gap: .375rem; }
.rym-app .rym-library-list { margin-top: .75rem; border: 1px solid var(--rym-border); border-radius: 6px; max-height: 34vh; overflow-y: auto; overflow-x: hidden; }
.rym-app .rym-library-row { display: flex; align-items: flex-start; gap: .75rem; padding: .75rem .875rem; border-bottom: 1px solid #e5e6e9; cursor: pointer; }
.rym-app .rym-library-row:last-child { border-bottom: none; }
.rym-app .rym-library-row:hover { background: #f7f8fa; }
.rym-app .rym-library-row.is-selected { background: #eef3f9; }
.rym-app .rym-library-row input { width: 1rem; height: 1rem; margin: .2rem 0 0; accent-color: var(--rym-blue); flex-shrink: 0; }
.rym-app .rym-library-row-content { display: flex; flex-direction: column; flex: 1; min-width: 0; gap: .15rem; }
.rym-app .rym-library-row-content > strong { color: var(--rym-link); font-size: .875rem; overflow-wrap: anywhere; }
.rym-app .rym-library-date { font-size: .75rem; color: #737783; }
.rym-app .rym-library-week-range { color: #8a8f98; font-weight: 450; }
.rym-app .rym-library-source { font-size: .6875rem; color: #888c96; overflow-wrap: anywhere; }
.rym-app .rym-library-song-count { color: #747986; font-size: .75rem; white-space: nowrap; font-variant-numeric: tabular-nums; }
.rym-app .rym-library-empty { padding: 1rem; color: var(--rym-muted); font-size: .875rem; }
.rym-app .rym-error { background: #fff4f2; color: #9c3933; padding: .875rem; border: 1px solid #e7c6c2; border-radius: 7px; margin-bottom: 1rem; }
.rym-app .rym-loading { padding-block: 4rem; color: var(--rym-muted); text-align: center; }
.rym-app .rym-empty { background: #fff; border: 1px solid var(--rym-border); border-radius: 8px; padding: clamp(1.5rem, 4vw, 3rem); max-width: 52rem; }
.rym-app .rym-empty h2 { font-size: 1.75rem; font-weight: 720; letter-spacing: -.025em; }
.rym-app .rym-empty p { margin-top: .65rem; margin-bottom: 1.25rem; max-width: 38rem; color: #70747e; line-height: 1.6; }
.rym-app .rym-footer { border-top: 1px solid #d9dce1; color: #7a7e88; margin-top: 1rem; padding-top: .625rem; font-size: .75rem; }

@media (min-width: 1024px) {
  .rym-app .rym-chart-grid {
    grid-template-columns: minmax(20rem, 30fr) minmax(0, 70fr);
    align-items: start;
    gap: 1rem;
  }

  /* Left chart is its own floating panel. */
  .rym-app .rym-pane--compact {
    position: sticky;
    top: 1rem;
    height: calc(100vh - 2rem);
    height: calc(100dvh - 2rem);
    max-height: calc(100vh - 2rem);
    max-height: calc(100dvh - 2rem);
    min-height: 0;

    display: flex;
    flex-direction: column;

    padding: .85rem;
    background: rgba(255, 255, 255, .94);
    border: 1px solid #d7dce3;
    border-radius: 12px;
    box-shadow: 0 1px 2px rgba(20, 24, 31, .05);

    overflow: hidden;
    isolation: isolate;
  }

  .rym-app .rym-pane--compact .rym-pane-heading {
    flex: 0 0 auto;
    margin-bottom: .7rem;
    padding: 0 .1rem;
  }

  .rym-app .rym-pane--compact .rym-chart-controls {
    flex: 0 0 auto;
    margin-bottom: .7rem;
    box-shadow: none;
    border-color: #dce0e6;
  }

  /* Only the songs scroll; the floating panel itself never looks cut off. */
  .rym-app .rym-pane--compact .rym-song-list {
    flex: 1 1 auto;
    min-height: 0;
    max-height: none;

    overflow-y: auto;
    overflow-x: hidden;
    overscroll-behavior-y: contain;
    touch-action: pan-y pinch-zoom;

    padding: .05rem .22rem .3rem .05rem;
    margin: 0;

    border: 0;
    border-radius: 8px;
    box-shadow: none;

    scrollbar-width: thin;
    scrollbar-color: #c5c8cf transparent;
    scrollbar-gutter: stable;
  }

  .rym-app .rym-pane--compact .rym-song-list::after {
    content: none;
  }

  .rym-app .rym-pane--compact .rym-song-list::-webkit-scrollbar {
    width: 7px;
  }

  .rym-app .rym-pane--compact .rym-song-list::-webkit-scrollbar-track {
    background: transparent;
  }

  .rym-app .rym-pane--compact .rym-song-list::-webkit-scrollbar-thumb {
    background: #c9ced6;
    border-radius: 999px;
  }

  .rym-app .rym-pane--compact .rym-song {
    border-radius: 8px;
  }
}
@media (max-width: 1023px) {
  .rym-app .rym-pane--compact .rym-chart-controls { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); }
  .rym-app .rym-pane--compact {
    background: rgba(255,255,255,.94);
    border: 1px solid #d7dce3;
    border-radius: 12px;
    padding: .75rem;
    box-shadow: 0 1px 2px rgba(20,24,31,.05);
    overflow: hidden;
  }

  .rym-app .rym-pane--compact .rym-song-list {
    max-height: 34vh;
    max-height: 34dvh;
    overflow-y: auto;
    overflow-x: hidden;
    overscroll-behavior-y: contain;
    scrollbar-width: thin;
    scrollbar-color: #c5c8cf transparent;
    padding: .05rem .15rem .25rem .05rem;
    border: 0;
    border-radius: 8px;
    box-shadow: none;
  }

  .rym-app .rym-pane--compact .rym-song-list::after {
    content: none;
  }
  .rym-app .rym-song { --rym-cover-size: clamp(6rem, calc(16vw + 1.25rem), 10.25rem); }
  .rym-app .rym-song--compact { --rym-cover-size: 3.85rem; }
}
@media (max-width: 720px) {
  .rym-app .rym-comparison-head { align-items: stretch; }
  .rym-app .rym-search { width: 100%; }
  .rym-app .rym-chart-controls, .rym-app .rym-pane--compact .rym-chart-controls { grid-template-columns: minmax(0, 1fr); }
  .rym-app .rym-calendar-popover { left: 0; right: auto; width: min(20rem, calc(100vw - 2.5rem)); }
.rym-app .rym-pane--compact .rym-calendar-popover { left: 0; right: auto; width: 100%; max-width: 100%; }
}
@media (max-width: 600px) {
  .rym-app .rym-topbar-inner { gap: .625rem; }
  .rym-app .rym-header-actions { width: 100%; gap: .375rem; }
  .rym-app .rym-header-actions .rym-button { flex: 1 1 auto; padding-inline: .55rem; }
  .rym-app .rym-header-actions .rym-file-button { flex-grow: 2; }
  .rym-app .rym-subbar-inner { gap: .625rem; }
  .rym-app .rym-context-copy { align-items: flex-start; flex-direction: column; gap: .15rem; }
  .rym-app .rym-subbar-count { margin-left: 0; width: 100%; }
  .rym-app .rym-subbar-description { font-size: .8125rem; }
  .rym-app .rym-workspace { padding-top: .75rem; }
  .rym-app .rym-comparison-bar { padding: .625rem; border-radius: 8px; }
  .rym-app .rym-filterbar { gap: .3rem; }
  .rym-app .rym-filter { padding-inline: .5rem; }
  .rym-app .rym-song { --rym-cover-size: 4.75rem; grid-template-columns: 1.7rem var(--rym-cover-size) minmax(0, 1fr); gap: .55rem; padding: .625rem .55rem; }
  .rym-app .rym-song--compact { --rym-cover-size: 3.45rem; }
  .rym-app .rym-rank-number { font-size: 1rem; }
  .rym-app .rym-movement { flex-wrap: wrap; font-size: .6875rem; gap: .1rem; }
  .rym-app .rym-song-title { font-size: .9375rem; }
  .rym-app .rym-song-artists { font-size: .875rem; }
  .rym-app .rym-song-date { font-size: .7rem; }
  .rym-app .rym-song-genre { font-size: .75rem; }
  .rym-app .rym-song-bottom { padding-top: .5rem; }
  .rym-app .rym-rating strong { font-size: .9rem; }
  .rym-app .rym-rating-count, .rym-app .rym-rank-route { font-size: .6875rem; }
  .rym-app .rym-calendar-week-button { min-height: 3rem; padding: .55rem .65rem; }
  .rym-app .rym-library { padding: .875rem; }
  .rym-app .rym-library-actions .rym-button { flex: 1 1 auto; }
  .rym-app .rym-library-row { flex-wrap: wrap; padding: .75rem; gap: .55rem; }
  .rym-app .rym-library-row-content { min-width: 65%; }
}
@media (prefers-reduced-motion: reduce) {
  .rym-player-shell,
  .rym-player-reveal { transition: none !important; }

  .rym-app *, .rym-app *::before, .rym-app *::after { scroll-behavior: auto !important; transition-duration: .01ms !important; animation-duration: .01ms !important; }
}

@media (max-width: 680px) {
  .rym-app .rym-song.rym-song--playing:not(.rym-song--compact) {
    display: block !important;
    height: auto !important;
    min-height: 0 !important;
    max-height: none !important;
    grid-template-columns: none !important;
    gap: 0 !important;
    padding: .625rem .55rem !important;
    box-sizing: border-box !important;
    overflow: hidden !important;
  }

  .rym-app .rym-song.rym-song--playing:not(.rym-song--compact) > .rym-song-body {
    display: flex !important;
    flex-direction: column !important;
    align-items: stretch !important;
    width: 100% !important;
    height: auto !important;
    min-height: 0 !important;
    max-height: none !important;
    margin: 0 !important;
    padding: 0 !important;
    gap: 0 !important;
  }

  .rym-app .rym-song.rym-song--playing:not(.rym-song--compact) .rym-song-info-transition {
    display: block !important;
    height: 0 !important;
    min-height: 0 !important;
    max-height: 0 !important;
    margin: 0 !important;
    padding: 0 !important;
    opacity: 0 !important;
    overflow: hidden !important;
    pointer-events: none !important;
  }

  .rym-app .rym-song.rym-song--playing:not(.rym-song--compact) .rym-preview-button {
    width: 2.1rem !important;
    height: 2.1rem !important;
    flex: 0 0 2.1rem !important;
    align-self: flex-start !important;
    margin: 0 0 .55rem 0 !important;
  }

  .rym-app .rym-song.rym-song--playing:not(.rym-song--compact) .rym-player-shell {
    display: block !important;
    width: 100% !important;
    height: var(--rym-mobile-player-height) !important;
    min-height: 0 !important;
    max-height: var(--rym-mobile-player-height) !important;
    margin: 0 !important;
    padding: 0 !important;
    flex: 0 0 var(--rym-mobile-player-height) !important;
    overflow: hidden !important;
  }

  .rym-app .rym-song.rym-song--playing:not(.rym-song--compact) .rym-player-reveal,
  .rym-app .rym-song.rym-song--playing:not(.rym-song--compact) .rym-spotify-controller,
  .rym-app .rym-song.rym-song--playing:not(.rym-song--compact) .rym-spotify-mount,
  .rym-app .rym-song.rym-song--playing:not(.rym-song--compact) .rym-spotify-controller iframe {
    width: 100% !important;
    height: var(--rym-mobile-player-height) !important;
    min-height: var(--rym-mobile-player-height) !important;
    max-height: var(--rym-mobile-player-height) !important;
    margin: 0 !important;
    padding: 0 !important;
  }

  .rym-app .rym-song.rym-song--playing:not(.rym-song--compact) > .rym-rank,
  .rym-app .rym-song.rym-song--playing:not(.rym-song--compact) > .rym-cover,
  .rym-app .rym-song.rym-song--playing:not(.rym-song--compact) .rym-song-bottom {
    display: none !important;
  }
}


@media (max-width: 680px) {
  .rym-app .rym-song.rym-song--playing:not(.rym-song--compact) {
    --rym-mobile-player-height: 152px !important;
    height: auto !important;
    min-height: 0 !important;
    max-height: none !important;
  }

  .rym-app .rym-song.rym-song--playing:not(.rym-song--compact) > .rym-song-body {
    height: auto !important;
    min-height: 0 !important;
    max-height: none !important;
  }

  .rym-app .rym-song.rym-song--playing:not(.rym-song--compact) .rym-player-shell,
  .rym-app .rym-song.rym-song--playing:not(.rym-song--compact) .rym-player-reveal,
  .rym-app .rym-song.rym-song--playing:not(.rym-song--compact) .rym-spotify-controller,
  .rym-app .rym-song.rym-song--playing:not(.rym-song--compact) .rym-spotify-mount,
  .rym-app .rym-song.rym-song--playing:not(.rym-song--compact) .rym-spotify-controller iframe {
    height: 152px !important;
    min-height: 152px !important;
    max-height: 152px !important;
  }

  .rym-app .rym-song.rym-song--playing:not(.rym-song--compact) .rym-player-shell {
    flex: 0 0 152px !important;
    margin: 0 !important;
    padding: 0 !important;
  }
}


.rym-app .rym-pane--compact .rym-snapshot-control {
  gap: .35rem;
}
.rym-app .rym-pane--compact .rym-calendar-toggle {
  min-width: 4rem;
  padding-inline: .55rem;
}
.rym-app .rym-pane--compact .rym-calendar-weeks {
  min-width: 0;
}
.rym-app .rym-pane--compact .rym-calendar-week-copy {
  gap: .35rem;
}
.rym-app .rym-pane--compact .rym-calendar-week-copy strong {
  font-size: .75rem;
}
.rym-app .rym-pane--compact .rym-calendar-week-copy > span {
  font-size: .675rem;
}

@media (max-width: 420px) {
  .rym-app .rym-snapshot-control {
    gap: .3rem;
  }
  .rym-app .rym-calendar-toggle {
    min-width: 2.375rem;
    width: 2.375rem;
    padding: 0;
  }
  .rym-app .rym-calendar-toggle span {
    display: none;
  }
}

@media (max-width: 700px) {
  .rym-app .rym-topbar-inner,
  .rym-app .rym-subbar-inner {
    padding-inline: .75rem;
  }
  .rym-app .rym-workspace {
    padding-inline: .75rem;
  }
}


.rym-app .rym-pane--compact .rym-song--compact {
  grid-template-columns: 2.15rem var(--rym-cover-size) minmax(0, 1fr);
}
.rym-app .rym-pane--compact .rym-rank {
  min-width: 2.15rem;
}


.rym-app .rym-pane--compact .rym-song--compact .rym-rank {
  align-items: flex-end;
  text-align: right;
  padding-right: .08rem;
}


.rym-app .rym-pane--compact .rym-cover--compact {
  width: var(--rym-cover-size);
  height: var(--rym-cover-size);
  align-self: center;
  margin: 0;
}
.rym-app .rym-pane--compact .rym-song-body {
  justify-content: center;
  min-width: 0;
}
.rym-app .rym-pane--compact .rym-song-title,
.rym-app .rym-pane--compact .rym-song-artists {
  line-height: 1.22;
}


/* Custom chart selector + calendar-only date UX */
.rym-app .rym-chart-controls,
.rym-app .rym-pane--compact .rym-chart-controls {
  display: block !important;
  position: relative !important;
  overflow: visible !important;
}

.rym-app .rym-chart-control-row {
  display: flex;
  align-items: flex-end;
  gap: .625rem;
  width: 100%;
  min-width: 0;
}

.rym-app .rym-chart-picker-field {
  position: relative;
  flex: 1 1 auto;
  min-width: 0;
  z-index: 70;
}

.rym-app .rym-date-control {
  position: relative;
  flex: 0 0 auto;
  padding-top: 1.45rem;
  z-index: 75;
}

.rym-app .rym-chart-picker-trigger {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: .75rem;
  width: 100%;
  min-width: 0;
  height: 2.375rem;
  padding: 0 .8rem 0 .75rem;
  border: 0;
  border-radius: 10px;
  background: var(--rym-blue);
  color: #fff;
  font: inherit;
  font-size: .8125rem;
  font-weight: 680;
  line-height: 1;
  text-align: left;
  cursor: pointer;
  box-shadow: none;
  transition: background-color .14s ease, transform .12s ease, box-shadow .14s ease;
}

.rym-app .rym-chart-picker-trigger:hover {
  background: var(--rym-blue-strong);
}

.rym-app .rym-chart-picker-trigger:active {
  transform: translateY(1px);
}

.rym-app .rym-chart-picker-trigger:focus-visible {
  outline: 2px solid #8aa9ca;
  outline-offset: 2px;
}

.rym-app .rym-chart-picker-trigger > span:first-child {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.rym-app .rym-chart-picker-caret {
  width: 0;
  height: 0;
  flex: 0 0 auto;
  border-left: .28rem solid transparent;
  border-right: .28rem solid transparent;
  border-top: .34rem solid currentColor;
  opacity: .95;
  transition: transform .14s ease;
}

.rym-app .rym-chart-picker-trigger[aria-expanded="true"] .rym-chart-picker-caret {
  transform: rotate(180deg);
}

.rym-app .rym-chart-picker-popover {
  position: absolute;
  z-index: 10020;
  top: calc(100% + .4rem);
  left: 0;
  width: min(24rem, calc(100vw - 2rem));
  max-width: 100%;
  box-sizing: border-box;
  padding: .7rem;
  border: 1px solid #d8dde5;
  border-radius: 12px;
  background: #fff;
  box-shadow:
    0 18px 40px rgba(25, 35, 52, .16),
    0 5px 14px rgba(25, 35, 52, .08);
}

.rym-app .rym-chart-picker-section + .rym-chart-picker-section {
  margin-top: .7rem;
  padding-top: .7rem;
  border-top: 1px solid #edf0f4;
}

.rym-app .rym-chart-picker-section-label {
  margin: 0 0 .42rem;
  color: #656b75;
  font-size: .6875rem;
  font-weight: 720;
  letter-spacing: .02em;
}

.rym-app .rym-chart-kind-switch {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: .4rem;
}

.rym-app .rym-chart-kind-button {
  min-width: 0;
  height: 2.1rem;
  padding: 0 .65rem;
  border: 1px solid #d9dee5;
  border-radius: 8px;
  background: #f6f7f9;
  color: #4c535d;
  font-size: .75rem;
  font-weight: 680;
  cursor: pointer;
  box-shadow: none;
}

.rym-app .rym-chart-kind-button:hover:not(:disabled) {
  border-color: #bcc8d7;
  background: #f0f4f9;
}

.rym-app .rym-chart-kind-button.is-active {
  border-color: transparent;
  background: var(--rym-blue);
  color: #fff;
}

.rym-app .rym-chart-kind-button:disabled {
  opacity: .38;
  cursor: default;
}

.rym-app .rym-chart-period-list {
  display: flex;
  flex-wrap: wrap;
  gap: .4rem;
}

.rym-app .rym-chart-period-button {
  min-height: 2rem;
  padding: .35rem .72rem;
  border: 1px solid #d6dce4;
  border-radius: 999px;
  background: #f7f8fa;
  color: #525963;
  font-size: .75rem;
  font-weight: 680;
  line-height: 1;
  cursor: pointer;
  box-shadow: none;
}

.rym-app .rym-chart-period-button:hover {
  border-color: #adc0d5;
  background: #eef4fa;
  color: var(--rym-blue);
}

.rym-app .rym-chart-period-button.is-active {
  border-color: #9eb8d5;
  background: #e6f0fa;
  color: var(--rym-blue);
}

.rym-app .rym-date-control .rym-calendar-toggle {
  min-width: 4.4rem;
  width: auto;
  padding-inline: .7rem;
}

.rym-app .rym-date-control .rym-calendar-popover {
  top: calc(100% + .4rem) !important;
  right: 0 !important;
  left: auto !important;
  width: min(20rem, calc(100vw - 2rem)) !important;
  max-width: none !important;
  z-index: 10030 !important;
}

.rym-app .rym-pane--compact .rym-chart-picker-field,
.rym-app .rym-pane--compact .rym-date-control {
  z-index: 10020 !important;
}

.rym-app .rym-pane--compact .rym-chart-picker-popover,
.rym-app .rym-pane--compact .rym-date-control .rym-calendar-popover {
  z-index: 10040 !important;
}

@media (max-width: 720px) {
  .rym-app .rym-chart-control-row {
    gap: .45rem;
  }

  .rym-app .rym-chart-picker-popover {
    width: min(22rem, calc(100vw - 2rem));
  }
}

@media (max-width: 420px) {
  .rym-app .rym-chart-control-row {
    gap: .35rem;
  }

  .rym-app .rym-date-control .rym-calendar-toggle {
    min-width: 4rem !important;
    width: auto !important;
    padding: 0 .55rem !important;
  }

  .rym-app .rym-date-control .rym-calendar-toggle span {
    display: inline !important;
  }
}

/* FINAL UX: unified chart + weekly snapshot selector */
.rym-app .rym-chart-control-row {
  display: block !important;
}

.rym-app .rym-chart-picker-field--unified {
  width: min(100%, 30rem);
  max-width: 30rem;
  flex: 0 1 30rem;
}

.rym-app .rym-pane--compact .rym-chart-picker-field--unified {
  width: 100%;
  max-width: none;
}

.rym-app .rym-chart-picker-trigger--unified {
  width: 100%;
  height: auto;
  min-height: 3.15rem;
  padding: .56rem .72rem .56rem .78rem;
  border: 1px solid #c9d4e1;
  border-radius: 10px;
  background: #eef3f8;
  color: #244a78;
  box-shadow: none;
}

.rym-app .rym-chart-picker-trigger--unified:hover {
  border-color: #aabed3;
  background: #e7eff7;
}

.rym-app .rym-chart-picker-trigger--unified[aria-expanded="true"] {
  border-color: #95aec9;
  background: #e5eef7;
  box-shadow: 0 0 0 2px rgba(47, 85, 145, .08);
}

.rym-app .rym-chart-picker-summary {
  display: flex;
  min-width: 0;
  flex-direction: column;
  align-items: flex-start;
  gap: .19rem;
}

.rym-app .rym-chart-picker-summary-title {
  display: block;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: #244a78;
  font-size: .82rem;
  font-weight: 750;
  line-height: 1.2;
}

.rym-app .rym-chart-picker-summary-hint {
  color: #718096;
  font-size: .67rem;
  font-weight: 520;
  line-height: 1.15;
}

.rym-app .rym-chart-picker-trigger--unified .rym-chart-picker-caret {
  color: #315f8d;
}

.rym-app .rym-chart-current-week {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: .28rem .45rem;
  min-height: 1.35rem;
  padding: .34rem .12rem 0 .12rem;
  color: #6d7480;
}

.rym-app .rym-chart-current-week strong {
  color: #3c4654;
  font-size: .72rem;
  font-weight: 720;
  line-height: 1.2;
}

.rym-app .rym-chart-current-week span {
  color: #858b95;
  font-size: .68rem;
  font-weight: 500;
  line-height: 1.2;
}

.rym-app .rym-chart-picker-popover--unified {
  width: min(24rem, calc(100vw - 2rem));
  max-width: none;
  padding: .75rem;
}

.rym-app .rym-chart-picker-week-section {
  padding-top: .75rem !important;
}

.rym-app .rym-chart-picker-week-heading {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: .75rem;
  margin-bottom: .4rem;
}

.rym-app .rym-chart-picker-week-heading .rym-chart-picker-section-label {
  margin: 0;
}

.rym-app .rym-chart-picker-week-heading > span {
  min-width: 0;
  overflow: hidden;
  color: #78808b;
  font-size: .66rem;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.rym-app .rym-chart-picker-popover--unified .rym-calendar {
  padding: 0;
  border: 0;
  background: transparent;
  box-shadow: none;
}

.rym-app .rym-chart-picker-popover--unified .rym-calendar-heading {
  margin-bottom: .55rem;
}

.rym-app .rym-chart-picker-popover--unified .rym-calendar-week-button {
  min-height: 2.65rem;
}

@media (max-width: 720px) {
  .rym-app .rym-chart-picker-field--unified,
  .rym-app .rym-pane--compact .rym-chart-picker-field--unified {
    width: 100%;
    max-width: none;
  }

  .rym-app .rym-chart-picker-popover--unified {
    width: min(23rem, calc(100vw - 1.5rem));
  }
}

@media (max-width: 420px) {
  .rym-app .rym-chart-picker-trigger--unified {
    min-height: 3rem;
    padding: .52rem .65rem;
  }

  .rym-app .rym-chart-current-week {
    padding-top: .3rem;
  }

  .rym-app .rym-chart-picker-popover--unified {
    width: min(22rem, calc(100vw - 1rem));
  }
}

/* FINAL UX v2 — single-line selector + body-level floating picker */
.rym-app .rym-chart-control-row {
  display: block !important;
  width: 100% !important;
}

.rym-app .rym-chart-picker-field--unified {
  width: 100% !important;
  max-width: none !important;
  min-width: 0 !important;
  position: relative !important;
}

.rym-app .rym-chart-picker-trigger--unified {
  width: 100% !important;
  min-height: 2.8rem !important;
  height: 2.8rem !important;
  padding: 0 .7rem 0 .82rem !important;
  display: grid !important;
  grid-template-columns: minmax(0, 1fr) auto auto !important;
  align-items: center !important;
  gap: .55rem !important;
  border: 1px solid #b8c1cc !important;
  border-radius: 9px !important;
  background: #fff !important;
  color: #26384f !important;
  box-shadow: none !important;
  text-align: left !important;
}

.rym-app .rym-chart-picker-trigger--unified:hover,
.rym-app .rym-chart-picker-trigger--unified[aria-expanded="true"] {
  border-color: #7f98b5 !important;
  background: #fbfcfe !important;
  box-shadow: 0 0 0 2px rgba(47, 85, 145, .08) !important;
}

.rym-app .rym-chart-picker-summary-title {
  display: block !important;
  min-width: 0 !important;
  overflow: hidden !important;
  text-overflow: ellipsis !important;
  white-space: nowrap !important;
  color: #26384f !important;
  font-size: .82rem !important;
  font-weight: 760 !important;
  line-height: 1 !important;
}

.rym-app .rym-chart-picker-week-badge {
  display: inline-flex !important;
  align-items: center !important;
  height: 1.72rem !important;
  padding: 0 .58rem !important;
  border: 1px solid #9db8d6 !important;
  border-radius: 999px !important;
  background: #e7f0fb !important;
  color: #234f82 !important;
  font-size: .72rem !important;
  font-weight: 740 !important;
  line-height: 1 !important;
  white-space: nowrap !important;
}

.rym-app .rym-chart-picker-trigger--unified .rym-chart-picker-caret {
  color: #52657a !important;
}

.rym-chart-picker-portal {
  position: fixed !important;
  inset: 0 !important;
  z-index: 2147483000 !important;
  width: 0 !important;
  min-width: 0 !important;
  max-width: none !important;
  height: 0 !important;
  min-height: 0 !important;
  margin: 0 !important;
  padding: 0 !important;
  overflow: visible !important;
  background: transparent !important;
  pointer-events: none !important;
}

.rym-chart-picker-portal .rym-chart-picker-popover--unified {
  z-index: 2147483001 !important;
  margin: 0 !important;
  box-sizing: border-box !important;
  overflow-x: hidden !important;
  overflow-y: auto !important;
  overscroll-behavior: contain !important;
  pointer-events: auto !important;
  padding: .72rem !important;
  border: 1px solid #cbd2dc !important;
  border-radius: 12px !important;
  background: #fff !important;
  box-shadow:
    0 22px 48px rgba(20, 29, 42, .22),
    0 6px 16px rgba(20, 29, 42, .12) !important;
}

.rym-chart-picker-portal .rym-chart-picker-section + .rym-chart-picker-section {
  margin-top: .62rem !important;
  padding-top: .62rem !important;
  border-top: 1px solid #e5e8ed !important;
}

.rym-chart-picker-portal .rym-chart-picker-section-label {
  margin: 0 0 .42rem !important;
  color: #444d59 !important;
  font-size: .68rem !important;
  font-weight: 760 !important;
  letter-spacing: .01em !important;
}

.rym-chart-picker-portal .rym-chart-kind-switch {
  display: grid !important;
  grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
  gap: .38rem !important;
}

.rym-chart-picker-portal .rym-chart-kind-button {
  height: 2rem !important;
  border: 1px solid #cfd5dd !important;
  border-radius: 8px !important;
  background: #fff !important;
  color: #444d59 !important;
  font-size: .74rem !important;
  font-weight: 700 !important;
}

.rym-chart-picker-portal .rym-chart-kind-button.is-active {
  border: 0 !important;
  outline: 0 !important;
  box-shadow: none !important;
  background: var(--rym-blue) !important;
  color: #fff !important;
}

.rym-chart-picker-portal .rym-chart-period-list {
  display: flex !important;
  flex-wrap: wrap !important;
  gap: .38rem !important;
}

.rym-chart-picker-portal .rym-chart-period-button {
  min-height: 1.95rem !important;
  padding: .34rem .66rem !important;
  border: 1px solid #cfd5dd !important;
  border-radius: 999px !important;
  background: #fff !important;
  color: #4b535e !important;
  font-size: .72rem !important;
  font-weight: 690 !important;
  line-height: 1 !important;
}

.rym-chart-picker-portal .rym-chart-period-button.is-active {
  border: 1px solid #9db8d6 !important;
  outline: 0 !important;
  box-shadow: none !important;
  background: #e7f0fb !important;
  color: #234f82 !important;
}

.rym-chart-picker-portal .rym-chart-picker-week-heading {
  display: flex !important;
  align-items: baseline !important;
  justify-content: space-between !important;
  gap: .65rem !important;
  margin-bottom: .38rem !important;
}

.rym-chart-picker-portal .rym-chart-picker-week-heading .rym-chart-picker-section-label {
  margin: 0 !important;
}

.rym-chart-picker-portal .rym-chart-picker-week-heading > span {
  min-width: 0 !important;
  overflow: hidden !important;
  color: #626b77 !important;
  font-size: .65rem !important;
  font-weight: 650 !important;
  text-overflow: ellipsis !important;
  white-space: nowrap !important;
}

.rym-chart-picker-portal .rym-calendar {
  padding: 0 !important;
  border: 0 !important;
  background: transparent !important;
  box-shadow: none !important;
}

.rym-chart-picker-portal .rym-calendar-heading {
  margin-bottom: .5rem !important;
}

.rym-chart-picker-portal .rym-calendar-week-button {
  min-height: 2.52rem !important;
  border: 1px solid #d6dae0 !important;
  background: #fff !important;
}

.rym-chart-picker-portal .rym-calendar-week-button:not(:disabled):not(.is-selected):hover {
  border-color: #aebdce !important;
  background: #f4f7fb !important;
}

.rym-chart-picker-portal .rym-calendar-week-button.is-selected {
  border: 1px solid #9db8d6 !important;
  outline: 0 !important;
  box-shadow: none !important;
  background: #e7f0fb !important;
  color: #234f82 !important;
}

.rym-chart-picker-portal .rym-calendar-week-button.is-selected:hover {
  background: #ddeaf8 !important;
}

.rym-chart-picker-portal .rym-calendar-week-button:disabled {
  border-color: #eceef1 !important;
  background: #fafafa !important;
  color: #adb2ba !important;
}

.rym-chart-picker-portal .rym-calendar-week-copy > span {
  color: #757d88 !important;
}

.rym-chart-picker-portal .rym-calendar-week-button.is-selected .rym-calendar-week-copy > span {
  color: #617995 !important;
}

.rym-chart-picker-portal .rym-calendar-week-indicator {
  background: var(--rym-blue) !important;
}

.rym-chart-picker-portal .rym-calendar-week-button.is-selected .rym-calendar-week-indicator {
  background: #315f8d !important;
}

@media (max-width: 520px) {
  .rym-app .rym-chart-picker-trigger--unified {
    min-height: 2.65rem !important;
    height: 2.65rem !important;
    padding-inline: .62rem !important;
    gap: .42rem !important;
  }

  .rym-app .rym-chart-picker-summary-title {
    font-size: .78rem !important;
  }

  .rym-app .rym-chart-picker-week-badge {
    height: 1.58rem !important;
    padding-inline: .5rem !important;
    font-size: .68rem !important;
  }

  .rym-chart-picker-portal .rym-chart-picker-popover--unified {
    padding: .65rem !important;
  }
}

/* FINAL chart-type label refinement */
.rym-app .rym-chart-picker-summary-title {
  line-height: 1.25 !important;
  padding-top: .06rem !important;
  padding-bottom: .08rem !important;
  overflow: hidden !important;
}

.rym-app .rym-chart-picker-trigger--unified {
  overflow: visible !important;
}

.rym-chart-picker-portal .rym-chart-kind-button {
  line-height: 1.25 !important;
  padding-top: .1rem !important;
  padding-bottom: .14rem !important;
  overflow: visible !important;
}

/* FINAL icon color fixes */
.rym-app .rym-preview-play {
  border-left-color: var(--rym-blue) !important;
}

.rym-app .rym-filter--up.is-active {
  color: var(--rym-up) !important;
}

.rym-app .rym-filter--down.is-active {
  color: var(--rym-down) !important;
}

.rym-app .rym-filter--up.is-active .rym-icon {
  color: var(--rym-up) !important;
  fill: currentColor !important;
}

.rym-app .rym-filter--down.is-active .rym-icon {
  color: var(--rym-down) !important;
  fill: currentColor !important;
}

/* FINAL picker cleanup + NEW filter color */
.rym-app .rym-filter--new.is-active {
  color: #315f96 !important;
}

.rym-app .rym-filter--new.is-active .rym-icon {
  color: #315f96 !important;
  fill: currentColor !important;
}

/* The selector is one control: remove the redundant outer framed column/card. */
.rym-app .rym-chart-controls {
  padding: 0 !important;
  border: 0 !important;
  background: transparent !important;
  box-shadow: none !important;
}

.rym-app .rym-chart-control-row {
  padding: 0 !important;
  border: 0 !important;
  background: transparent !important;
  box-shadow: none !important;
}

.rym-app .rym-chart-picker-field--unified {
  padding: 0 !important;
  border: 0 !important;
  background: transparent !important;
  box-shadow: none !important;
}

/* Week list starts directly after the divider; no duplicate heading row. */
.rym-chart-picker-portal .rym-chart-picker-week-section {
  padding-top: .62rem !important;
}

.rym-chart-picker-portal .rym-chart-picker-week-section .rym-calendar-heading {
  margin-top: 0 !important;
}

/* FINAL filter toggle + strong primary selector */

/* Default ALL state is the primary state: dark RYM blue, no stroke. */
.rym-app .rym-filter--all.is-active {
  border: 0 !important;
  outline: 0 !important;
  box-shadow: none !important;
  background: var(--rym-blue) !important;
  color: #fff !important;
}

.rym-app .rym-filter--all.is-active strong,
.rym-app .rym-filter--all.is-active span {
  color: #fff !important;
}

/* Preserve semantic colors when each movement filter is active. */
.rym-app .rym-filter--new.is-active {
  color: #315f96 !important;
}

.rym-app .rym-filter--up.is-active {
  color: var(--rym-up) !important;
}

.rym-app .rym-filter--down.is-active {
  color: var(--rym-down) !important;
}

.rym-app .rym-filter--new.is-active .rym-icon {
  color: #315f96 !important;
  fill: currentColor !important;
}

.rym-app .rym-filter--up.is-active .rym-icon {
  color: var(--rym-up) !important;
  fill: currentColor !important;
}

.rym-app .rym-filter--down.is-active .rym-icon {
  color: var(--rym-down) !important;
  fill: currentColor !important;
}

/* Closed chart/week selector is now one strong primary button. */
.rym-app .rym-chart-picker-trigger--unified {
  border: 0 !important;
  outline: 0 !important;
  background: var(--rym-blue) !important;
  color: #fff !important;
  box-shadow: none !important;
}

.rym-app .rym-chart-picker-trigger--unified:hover {
  border: 0 !important;
  background: var(--rym-blue-strong) !important;
  box-shadow: none !important;
}

.rym-app .rym-chart-picker-trigger--unified[aria-expanded="true"] {
  border: 0 !important;
  background: var(--rym-blue-strong) !important;
  box-shadow: none !important;
}

.rym-app .rym-chart-picker-trigger--unified .rym-chart-picker-summary-title {
  color: #fff !important;
}

.rym-app .rym-chart-picker-trigger--unified .rym-chart-picker-caret {
  color: #fff !important;
}

/* Week stays readable as a subordinate chip inside the dark selector. */
.rym-app .rym-chart-picker-trigger--unified .rym-chart-picker-week-badge {
  border: 1px solid rgba(255,255,255,.55) !important;
  background: rgba(255,255,255,.14) !important;
  color: #fff !important;
}

/* FINAL compact-chart scroll boundary */
.rym-app .rym-pane--compact .rym-song-list {
  position: relative !important;
  margin-top: .72rem !important;
  padding-top: .72rem !important;
  border-top: 1px solid #d9dee5 !important;
  border-radius: 0 0 8px 8px !important;
  background: #fff !important;

  /* Make the scroll region feel intentional instead of visually clipped. */
  box-shadow:
    inset 0 8px 8px -10px rgba(32, 44, 60, .28),
    inset 0 -8px 8px -10px rgba(32, 44, 60, .18) !important;

  scroll-padding-top: .72rem !important;
  scroll-snap-type: y proximity !important;
}

.rym-app .rym-pane--compact .rym-song {
  scroll-snap-align: start !important;
  scroll-snap-stop: normal !important;
}

/* Keep a clean gap between the selector and the independently scrolling list. */
.rym-app .rym-pane--compact .rym-chart-controls {
  margin-bottom: 0 !important;
}

/* Mobile/tablet compact chart gets the same explicit viewport boundary. */
@media (max-width: 1023px) {
  .rym-app .rym-pane--compact .rym-song-list {
    margin-top: .68rem !important;
    padding-top: .68rem !important;
    border-top: 1px solid #d9dee5 !important;
  }
}

/* FINAL compact chart collapse UI */
.rym-app .rym-pane--compact.rym-pane--collapsed {
  height: auto !important;
  max-height: none !important;
  min-height: 0 !important;
  padding: .65rem !important;
  overflow: visible !important;
}

.rym-app .rym-compact-collapse-toggle {
  width: 100%;
  min-width: 0;
  min-height: 3.25rem;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: .8rem;
  padding: .55rem .7rem;
  border: 1px solid #d5dae1;
  border-radius: 9px;
  background: #fff;
  color: #273444;
  text-align: left;
  cursor: pointer;
}

.rym-app .rym-compact-collapse-toggle:hover {
  background: #f8fafc;
  border-color: #bdc7d2;
}

.rym-app .rym-compact-collapse-copy {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: .13rem;
}

.rym-app .rym-compact-collapse-role {
  color: #7b828d;
  font-size: .64rem;
  font-weight: 680;
  line-height: 1.1;
}

.rym-app .rym-compact-collapse-copy strong {
  min-width: 0;
  overflow: hidden;
  color: #26384f;
  font-size: .8rem;
  font-weight: 760;
  line-height: 1.2;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.rym-app .rym-compact-collapse-meta {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  gap: .55rem;
}

.rym-app .rym-compact-collapse-week {
  display: inline-flex;
  align-items: center;
  min-height: 1.65rem;
  padding: 0 .55rem;
  border: 1px solid #9db8d6;
  border-radius: 999px;
  background: #e7f0fb;
  color: #234f82;
  font-size: .68rem;
  font-weight: 740;
  white-space: nowrap;
}

.rym-app .rym-compact-collapse-chevron {
  width: .46rem;
  height: .46rem;
  flex: 0 0 .46rem;
  border-right: 2px solid #5f6e7e;
  border-bottom: 2px solid #5f6e7e;
  transform: rotate(45deg) translateY(-1px);
  transition: transform .16s ease;
}

.rym-app .rym-compact-collapse-chevron.is-open {
  transform: rotate(225deg) translate(-1px, -1px);
}

.rym-app .rym-compact-expand-body {
  min-height: 0;
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  margin-top: .7rem;
}

/* The expanded compact chart has a clearly separated scroll viewport. */
.rym-app .rym-pane--compact:not(.rym-pane--collapsed) .rym-song-list {
  position: relative !important;
  margin-top: .72rem !important;
  padding-top: .72rem !important;
  border-top: 1px solid #d9dee5 !important;
  border-radius: 0 0 8px 8px !important;
  background: #fff !important;
  box-shadow:
    inset 0 8px 8px -10px rgba(32, 44, 60, .28),
    inset 0 -8px 8px -10px rgba(32, 44, 60, .18) !important;
  scroll-padding-top: .72rem !important;
  scroll-snap-type: y proximity !important;
}

.rym-app .rym-pane--compact:not(.rym-pane--collapsed) .rym-song {
  scroll-snap-align: start !important;
}

@media (max-width: 1023px) {
  .rym-app .rym-pane--compact.rym-pane--collapsed {
    padding: .6rem !important;
  }

  .rym-app .rym-compact-collapse-toggle {
    min-height: 3rem;
    padding: .5rem .62rem;
  }

  .rym-app .rym-compact-expand-body {
    margin-top: .62rem;
  }
}

/* FINAL compact-pane structure: title itself is the collapse control */
.rym-app .rym-pane--compact.rym-pane--collapsed {
  height: auto !important;
  max-height: none !important;
  min-height: 0 !important;
  overflow: visible !important;
}

.rym-app .rym-pane--compact .rym-pane-heading--toggle {
  width: 100% !important;
  min-width: 0 !important;
  display: grid !important;
  grid-template-columns: minmax(0, 1fr) auto !important;
  align-items: center !important;
  gap: .7rem !important;
  margin: 0 !important;
  padding: 0 .08rem .05rem !important;
  border: 0 !important;
  background: transparent !important;
  color: inherit !important;
  text-align: left !important;
  box-shadow: none !important;
  cursor: pointer !important;
}

.rym-app .rym-pane--compact .rym-pane-heading--toggle:hover {
  background: transparent !important;
}

.rym-app .rym-pane-heading-main {
  min-width: 0 !important;
  display: block !important;
}

.rym-app .rym-pane--compact .rym-pane-heading--toggle .rym-pane-caption {
  margin-bottom: .35rem !important;
}

.rym-app .rym-pane-title-row {
  min-width: 0 !important;
  display: flex !important;
  align-items: baseline !important;
  gap: .5rem !important;
}

.rym-app .rym-pane--compact .rym-pane-title-row .rym-chart-title {
  min-width: 0 !important;
  margin: 0 !important;
  overflow: hidden !important;
  text-overflow: ellipsis !important;
  white-space: nowrap !important;
}

.rym-app .rym-pane-heading-week {
  flex: 0 0 auto !important;
  color: #78808b !important;
  font-size: .68rem !important;
  font-weight: 650 !important;
  white-space: nowrap !important;
}

.rym-app .rym-pane-heading-chevron {
  width: .5rem !important;
  height: .5rem !important;
  margin-right: .2rem !important;
  border-right: 2px solid #667484 !important;
  border-bottom: 2px solid #667484 !important;
  transform: rotate(45deg) !important;
  transition: transform .16s ease !important;
}

.rym-app .rym-pane-heading-chevron.is-open {
  transform: rotate(225deg) !important;
}

/* Remove the earlier dedicated collapse-button UI entirely. */
.rym-app .rym-compact-collapse-toggle,
.rym-app .rym-compact-collapse-copy,
.rym-app .rym-compact-collapse-meta,
.rym-app .rym-compact-collapse-role,
.rym-app .rym-compact-collapse-week,
.rym-app .rym-compact-collapse-chevron {
  display: none !important;
}

/* Expanded content sits directly under the persistent heading. */
.rym-app .rym-compact-expand-body {
  min-height: 0 !important;
  display: flex !important;
  flex: 1 1 auto !important;
  flex-direction: column !important;
  margin-top: .72rem !important;
}

/* Simple scroll boundary: only top and bottom separators. */
.rym-app .rym-pane--compact:not(.rym-pane--collapsed) .rym-song-list {
  position: relative !important;
  margin-top: .72rem !important;
  padding: .55rem .12rem .55rem .05rem !important;
  border-top: 1px solid #d9dee5 !important;
  border-right: 0 !important;
  border-bottom: 1px solid #d9dee5 !important;
  border-left: 0 !important;
  border-radius: 0 !important;
  background: transparent !important;
  box-shadow: none !important;
  scroll-padding-top: .55rem !important;
  scroll-padding-bottom: .55rem !important;
  scroll-snap-type: none !important;
}

.rym-app .rym-pane--compact:not(.rym-pane--collapsed) .rym-song {
  scroll-snap-align: none !important;
}

/* Keep the chart picker visually separate from the bordered list. */
.rym-app .rym-pane--compact .rym-chart-controls {
  margin-bottom: 0 !important;
}

@media (max-width: 1023px) {
  .rym-app .rym-pane--compact .rym-pane-heading--toggle {
    padding-inline: .05rem !important;
  }

  .rym-app .rym-pane-heading-week {
    font-size: .65rem !important;
  }

  .rym-app .rym-compact-expand-body {
    margin-top: .65rem !important;
  }

  .rym-app .rym-pane--compact:not(.rym-pane--collapsed) .rym-song-list {
    margin-top: .65rem !important;
    padding: .5rem .1rem .5rem .04rem !important;
    border-top: 1px solid #d9dee5 !important;
    border-bottom: 1px solid #d9dee5 !important;
  }
}

/* FINAL header separation */
.rym-app .rym-subbar {
  position: relative !important;
  z-index: 5 !important;
  box-shadow: 0 7px 16px rgba(24, 34, 48, .10) !important;
}

/* FINAL calendar tracking-start boundary */
.rym-app .rym-calendar-nav-spacer,
.rym-chart-picker-portal .rym-calendar-nav-spacer {
  display: inline-block !important;
  width: 2.25rem !important;
  height: 2.25rem !important;
  flex: 0 0 2.25rem !important;
}


.rym-app .rym-calendar-week-button--tracking-start,
.rym-chart-picker-portal .rym-calendar-week-button--tracking-start {
  display: flex !important;
  align-items: center !important;
  justify-content: center !important;
  min-height: 3.2rem !important;
  padding: .65rem .72rem !important;
  border: 1px dashed #cbd4de !important;
  border-radius: .48rem !important;
  background: #f7f9fb !important;
  color: #6a7480 !important;
  cursor: default !important;
  text-align: center !important;
}

.rym-app .rym-calendar-week-button--tracking-start .rym-calendar-week-copy,
.rym-chart-picker-portal .rym-calendar-week-button--tracking-start .rym-calendar-week-copy {
  align-items: center !important;
}

.rym-app .rym-calendar-week-button--tracking-start strong,
.rym-chart-picker-portal .rym-calendar-week-button--tracking-start strong {
  font-size: .75rem !important;
  font-weight: 600 !important;
  line-height: 1.45 !important;
  white-space: normal !important;
}

/* FINAL tracking-start slot size + site footer */
.rym-app .rym-calendar-week-button--tracking-start,
.rym-chart-picker-portal .rym-calendar-week-button--tracking-start {
  min-height: unset !important;
  height: auto !important;
  padding: .48rem .62rem !important;
}

.rym-app .rym-calendar-week-button--tracking-start .rym-calendar-week-copy,
.rym-chart-picker-portal .rym-calendar-week-button--tracking-start .rym-calendar-week-copy {
  min-height: 0 !important;
}

.rym-app .rym-site-footer {
  display: flex !important;
  align-items: center !important;
  justify-content: space-between !important;
  gap: 1.25rem !important;
  text-align: left !important;
}

.rym-app .rym-site-footer-copy {
  flex: 1 1 auto !important;
  min-width: 0 !important;
  text-align: left !important;
}

.rym-app .rym-site-footer-copy > div,
.rym-app .rym-made-by {
  text-align: left !important;
}

.rym-app .rym-scroll-top-button {
  flex: 0 0 auto !important;
  display: inline-flex !important;
  align-items: center !important;
  justify-content: center !important;
  gap: .38rem !important;
  min-height: 2.4rem !important;
  padding: .5rem .75rem !important;
  border: 1px solid #cfd7df !important;
  border-radius: .5rem !important;
  background: #fff !important;
  color: var(--rym-blue) !important;
  font: inherit !important;
  font-size: .76rem !important;
  font-weight: 700 !important;
  cursor: pointer !important;
}

.rym-app .rym-scroll-top-button:hover {
  background: #f5f7fa !important;
}

.rym-app .rym-scroll-top-arrow {
  font-size: 1rem !important;
  line-height: 1 !important;
}

@media (max-width: 720px) {
  .rym-app .rym-site-footer {
    align-items: flex-start !important;
  }

  .rym-app .rym-scroll-top-button span:last-child {
    display: none !important;
  }

  .rym-app .rym-scroll-top-button {
    width: 2.4rem !important;
    height: 2.4rem !important;
    min-height: 2.4rem !important;
    padding: 0 !important;
  }
}

/* FINAL exact calendar slot + centered footer + floating top control */
.rym-app .rym-calendar-week-button--tracking-start {
  min-height: 2.8rem !important;
  padding: .5rem .65rem !important;
}

.rym-chart-picker-portal .rym-calendar-week-button--tracking-start {
  min-height: 2.52rem !important;
  padding: .5rem .65rem !important;
}

.rym-app .rym-calendar-week-button--tracking-start .rym-calendar-week-copy,
.rym-chart-picker-portal .rym-calendar-week-button--tracking-start .rym-calendar-week-copy {
  width: 100% !important;
  min-height: 0 !important;
  justify-content: center !important;
}

.rym-app .rym-site-footer {
  display: block !important;
  text-align: center !important;
}

.rym-app .rym-site-footer-copy,
.rym-app .rym-site-footer-copy > div,
.rym-app .rym-made-by {
  text-align: center !important;
}

.rym-app .rym-scroll-top-button {
  --rym-react-y: 0px;
  position: fixed !important;
  right: max(1.15rem, env(safe-area-inset-right)) !important;
  bottom: max(1.15rem, env(safe-area-inset-bottom)) !important;
  z-index: 2147482000 !important;
  min-width: 2.7rem !important;
  min-height: 2.7rem !important;
  padding: .55rem .8rem !important;
  border: 1px solid rgba(34, 73, 115, .18) !important;
  border-radius: 999px !important;
  background: rgba(255, 255, 255, .94) !important;
  color: var(--rym-blue) !important;
  box-shadow:
    0 8px 24px rgba(24, 42, 65, .16),
    0 2px 6px rgba(24, 42, 65, .08) !important;
  backdrop-filter: blur(10px) !important;
  -webkit-backdrop-filter: blur(10px) !important;
  transform: translateY(var(--rym-react-y)) scale(1) !important;
  transition:
    box-shadow .22s ease,
    background .2s ease !important;
  will-change: transform !important;
}

.rym-app .rym-scroll-top-button:hover {
  background: #fff !important;
  box-shadow:
    0 12px 28px rgba(24, 42, 65, .19),
    0 4px 9px rgba(24, 42, 65, .09) !important;
}

.rym-app .rym-scroll-top-button:active {
  transform: translateY(var(--rym-react-y)) scale(.96) !important;
  transition-duration: .08s !important;
}

@media (max-width: 720px) {
  .rym-app .rym-site-footer {
    text-align: center !important;
  }

  .rym-app .rym-scroll-top-button {
    width: 2.7rem !important;
    height: 2.7rem !important;
    min-width: 2.7rem !important;
    min-height: 2.7rem !important;
    padding: 0 !important;
    right: max(.85rem, env(safe-area-inset-right)) !important;
    bottom: max(.85rem, env(safe-area-inset-bottom)) !important;
  }
}

/* Desktop sub-chart only: scroll-reaction spring */
@media (min-width: 1024px) {
  .rym-app .rym-pane--compact {
    --rym-scroll-react-y: 0px;
    transform: translateY(var(--rym-scroll-react-y)) !important;
    will-change: transform !important;
  }
}

/* CLEAN ROLLBACK — comparison toolbar is NOT sticky/floating and uses original UI */
.rym-app .rym-comparison-bar {
  position: relative !important;
  top: auto !important;
  z-index: auto !important;
  transform: none !important;
  will-change: auto !important;
  backdrop-filter: none !important;
  -webkit-backdrop-filter: none !important;
}

.rym-app .rym-comparison-head {
  display: flex !important;
}

.rym-app .rym-comparison-description {
  display: flex !important;
}

`;

