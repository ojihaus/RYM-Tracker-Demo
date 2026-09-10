"use client";

// RYM Tracker v12 — Spotify preview restored from the stable v10.4 implementation.

import { useEffect, useMemo, useRef, useState } from "react";

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

function songKey(song: Song) {
  if (song.rym_url) return song.rym_url;
  return `${song.title}__${song.artists?.join("|")}`;
}

function snapshotKey(snapshot: Snapshot) {
  return `${snapshot.source_url}__${snapshot.captured_at}`;
}

function formatDate(value: string, language: Language = "en") {
  return new Date(value).toLocaleString(language === "ko" ? "ko-KR" : "en-US");
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
        title:
          sorted[sorted.length - 1]?.page_title ||
          "RYM Song Chart",
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
  | "calendar" | "library" | "swap" | "left" | "right" | "close" | "search" | "globe";

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
    swap: "M3 7h17m-4-4 4 4-4 4M21 17H4m4-4-4 4 4 4",
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

function Cover({ song, compact = false }: { song: Song; compact?: boolean }) {
  const className = "rym-cover" + (compact ? " rym-cover--compact" : "");
  return (
    <div className={className}>
      {song.album_art_url ? (
        <img key={song.album_art_url} src={song.album_art_url} alt=""
          loading="lazy" decoding="async" referrerPolicy="no-referrer"
          onError={(event) => { event.currentTarget.style.visibility = "hidden"; }} />
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
  const metaItems = [
    song.release_date,
    song.primary_genres?.slice(0, 2).join(" / "),
  ].filter(Boolean);
  const embedUrl = spotifyEmbedUrl(song.spotify_url);
  const spotifyActive = Boolean(embedUrl && activeSpotifyUrl === song.spotify_url);

  return (
    <article className={"rym-song" + (compact ? " rym-song--compact" : "") + (out ? " rym-song--out" : "") + highlight}>
      <div className="rym-rank">
        <span className="rym-rank-number" aria-label={(language === "ko" ? "순위 " : "Rank ") + song.rank}>{song.rank}</span>
        {!compact && (out
          ? <span className="rym-status rym-status--out">{language === "ko" ? "이탈" : "OUT"}</span>
          : comparedSong && movement(comparedSong, language))}
      </div>
      <Cover song={song} compact={compact} />
      <div className="rym-song-body">
        <h3 className="rym-song-title">{song.title}</h3>
        <p className="rym-song-artists">{song.artists?.join(", ")}</p>
        {!compact && (
          <>
            {metaItems.length > 0 && (
              <p className="rym-song-meta">
                {metaItems.map((item, index) => (
                  <span key={String(item)}>{index > 0 && <span className="rym-meta-separator"> · </span>}{item}</span>
                ))}
              </p>
            )}
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
    snapshots[snapshots.length - 1] ??
    null;

  const selectedDate =
    selectedSnapshot
      ? new Date(selectedSnapshot.captured_at)
      : new Date();

  const [monthCursor, setMonthCursor] = useState(
    () =>
      new Date(
        selectedDate.getFullYear(),
        selectedDate.getMonth(),
        1
      )
  );

  const [activeDay, setActiveDay] = useState(
    selectedSnapshot
      ? dateId(selectedSnapshot.captured_at)
      : ""
  );

  useEffect(() => {
    if (!selectedSnapshot) return;

    const nextDate =
      new Date(selectedSnapshot.captured_at);

    setMonthCursor(
      new Date(
        nextDate.getFullYear(),
        nextDate.getMonth(),
        1
      )
    );

    setActiveDay(
      dateId(selectedSnapshot.captured_at)
    );
  }, [selectedKey]);

  const snapshotsByDay = useMemo(() => {
    const map = new Map<string, Snapshot[]>();

    for (const item of snapshots) {
      const key = dateId(item.captured_at);
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
  const firstDay =
    (new Date(year, month, 1).getDay() + 6) % 7;
  const daysInMonth =
    new Date(year, month + 1, 0).getDate();

  const cells: Array<number | null> = [
    ...Array(firstDay).fill(null),
    ...Array.from(
      { length: daysInMonth },
      (_, index) => index + 1
    ),
  ];

  while (cells.length % 7 !== 0) {
    cells.push(null);
  }

  const activeSnapshots =
    activeDay
      ? snapshotsByDay.get(activeDay) ?? []
      : [];

  const monthLabel =
    monthCursor.toLocaleDateString(language === "ko" ? "ko-KR" : "en-US", {
      month: "long",
      year: "numeric",
    });

  function moveMonth(amount: number) {
    setMonthCursor(
      new Date(year, month + amount, 1)
    );
  }

  function selectDay(day: number) {
    const key = dateId(
      new Date(year, month, day)
    );

    const items =
      snapshotsByDay.get(key) ?? [];

    if (!items.length) return;

    setActiveDay(key);

    const latest =
      items[items.length - 1];

    onSelect(snapshotKey(latest));
  }


  return (
    <div className="rym-calendar">
      <div className="rym-calendar-heading">
        <button type="button" onClick={() => moveMonth(-1)} className="rym-icon-button" aria-label={language === "ko" ? "이전 달" : "Previous month"}>
          <RymIcon name="left" />
        </button>
        <p className={compact ? "rym-calendar-month rym-calendar-month--compact" : "rym-calendar-month"}>{monthLabel}</p>
        <button type="button" onClick={() => moveMonth(1)} className="rym-icon-button" aria-label={language === "ko" ? "다음 달" : "Next month"}>
          <RymIcon name="right" />
        </button>
      </div>
      <div className="rym-calendar-week">
        {(language === "ko" ? ["월", "화", "수", "목", "금", "토", "일"] : ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]).map((day) => <span key={day}>{day}</span>)}
      </div>
      <div className="rym-calendar-days">
        {cells.map((day, index) => {
          if (day === null) return <span key={"empty-" + index} aria-hidden="true" />;
          const key = dateId(new Date(year, month, day));
          const daySnapshots = snapshotsByDay.get(key) ?? [];
          const hasSnapshot = daySnapshots.length > 0;
          const isSelected = selectedSnapshot ? dateId(selectedSnapshot.captured_at) === key : false;
          return (
            <button key={key} type="button" disabled={!hasSnapshot} onClick={() => selectDay(day)}
              className={"rym-calendar-day" + (isSelected ? " is-selected" : "")}
              aria-pressed={isSelected} aria-label={language === "ko" ? `${key}, 스냅샷 ${daySnapshots.length}개` : key + ", " + daySnapshots.length + " snapshots"}
              title={language === "ko" ? `스냅샷 ${daySnapshots.length}개` : daySnapshots.length + " snapshots"}>
              <span>{day}</span>
              {hasSnapshot && <span className="rym-calendar-dot" aria-hidden="true" />}
            </button>
          );
        })}
      </div>
      {activeSnapshots.length > 0 && (
        <div className="rym-calendar-times">
          <p className="rym-field-label">{language === "ko" ? "이 날짜의 스냅샷" : "Snapshots on this day"}</p>
          <div className="rym-time-buttons">
            {activeSnapshots.map((item) => {
              const key = snapshotKey(item);
              const active = key === selectedKey;
              return (
                <button key={key} type="button" onClick={() => onSelect(key)} aria-pressed={active}
                  className={"rym-time-button" + (active ? " is-selected" : "")}>
                  {formatTime(item.captured_at, language)}
                </button>
              );
            })}
          </div>
        </div>
      )}
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
  const displayedCount = filter === "OUT" ? visibleOutSongs.length : visibleSongs.length;

  const [calendarOpen, setCalendarOpen] = useState(false);
  const resolvedRoleLabel = roleLabel ?? (side === "LEFT" ? (language === "ko" ? "기준" : "REFERENCE") : (language === "ko" ? "대상" : "TARGET"));

  return (
    <section className={"rym-pane" + (compact ? " rym-pane--compact" : "")} aria-label={side + " chart"}>
      <div className="rym-pane-heading">
        <div className="rym-pane-caption">
          <span className={"rym-role-badge " + (side === "RIGHT" ? "rym-role-badge--target" : "rym-role-badge--reference")}>{resolvedRoleLabel}</span>
          <span className="rym-count-pill">{displayedCount}{language === "ko" ? "곡" : " songs"}</span>
        </div>
        <h2 className="rym-chart-title">{snapshot?.page_title || "RYM Song Chart"}</h2>
      </div>
      <div className="rym-chart-controls">
        <div className="rym-field">
          <label className="rym-field-label" htmlFor={"rym-chart-" + side}>{language === "ko" ? "차트" : "Chart"}</label>
          <select id={"rym-chart-" + side} value={chartUrl}
            onChange={(event) => onChartChange(event.target.value)} className="rym-select rym-select--blue">
            {charts.map((item) => (
              <option key={item.sourceUrl} value={item.sourceUrl}>{item.title} ({item.snapshots.length})</option>
            ))}
          </select>
        </div>
        {chart && (
          <div className="rym-field rym-snapshot-field">
            <div className="rym-field-heading">
              <label className="rym-field-label" htmlFor={"rym-snapshot-" + side}>{language === "ko" ? "스냅샷" : "Snapshot"}</label>
              <button type="button" className="rym-calendar-toggle" aria-expanded={calendarOpen}
                aria-controls={"rym-calendar-" + side} onClick={() => setCalendarOpen((current) => !current)}>
                <RymIcon name="calendar" />
                <span>{calendarOpen ? (language === "ko" ? "닫기" : "Close") : (language === "ko" ? "달력" : "Calendar")}</span>
              </button>
            </div>
            <select id={"rym-snapshot-" + side} value={snapshotKeyValue}
              onChange={(event) => onSnapshotChange(event.target.value)} className="rym-select">
              {chart.snapshots.map((item) => (
                <option key={snapshotKey(item)} value={snapshotKey(item)}>{formatDate(item.captured_at, language)}</option>
              ))}
            </select>
            {calendarOpen && (
              <div id={"rym-calendar-" + side} className="rym-calendar-popover">
                <SnapshotCalendar snapshots={chart.snapshots} selectedKey={snapshotKeyValue}
                  onSelect={(value) => { onSnapshotChange(value); setCalendarOpen(false); }} compact={compact} language={language} />
              </div>
            )}
          </div>
        )}
      </div>
      <div className="rym-song-list" tabIndex={0} role="region" aria-label={side + " chart songs"}>
        {visibleSongs.map((song) => (
          <SongCard key={songKey(song)} song={song} compact={compact}
            comparedSong={comparisonActive && "status" in song ? song as ComparedSong : null} language={language}
            activeSpotifyUrl={activeSpotifyUrl} onToggleSpotify={onToggleSpotify} />
        ))}
        {showOut && (
          <section className="rym-out-section" aria-label={language === "ko" ? "대상 차트에서 이탈한 곡" : "Songs out of the target chart"}>
            <div className="rym-out-heading">
              <h3>{language === "ko" ? "이탈" : "OUT"} <span>{visibleOutSongs.length}</span></h3>
              <p>{language === "ko" ? "기준 스냅샷에는 있지만 대상 스냅샷에서는 사라진 곡입니다." : "Present in the reference snapshot, missing from the target."}</p>
            </div>
            {visibleOutSongs.map((song) => <SongCard key={songKey(song)} song={song} out language={language}
              activeSpotifyUrl={activeSpotifyUrl} onToggleSpotify={onToggleSpotify} />)}
          </section>
        )}
        {!compact && visibleSongs.length === 0 && !showOut && (
          <div className="rym-filter-empty">{language === "ko" ? "이 조건에 맞는 곡이 없습니다." : "No songs match this view."}</div>
        )}
      </div>
    </section>
  );
}

export default function Home() {
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
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

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);

      if (saved) {
        const parsed = JSON.parse(saved);

        if (Array.isArray(parsed)) {
          setSnapshots(parsed);
        }
      }
    } catch {
      // Ignore broken local data.
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    const savedLanguage = localStorage.getItem(LANGUAGE_KEY);
    if (savedLanguage === "ko" || savedLanguage === "en") setLanguage(savedLanguage);
  }, []);

  useEffect(() => {
    localStorage.setItem(LANGUAGE_KEY, language);
  }, [language]);

  useEffect(() => {
    if (!loaded) return;

    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(snapshots)
    );
  }, [snapshots, loaded]);

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
    if (!charts.length) {
      setLeftChartUrl("");
      setRightChartUrl("");
      setLeftSnapshotKey("");
      setRightSnapshotKey("");
      return;
    }

    if (
      !charts.some(
        (chart) => chart.sourceUrl === leftChartUrl
      )
    ) {
      setLeftChartUrl(charts[0].sourceUrl);
    }

    if (
      !charts.some(
        (chart) => chart.sourceUrl === rightChartUrl
      )
    ) {
      setRightChartUrl(
        charts.length > 1
          ? charts[1].sourceUrl
          : charts[0].sourceUrl
      );
    }
  }, [charts, leftChartUrl, rightChartUrl]);

  useEffect(() => {
    if (!leftChart?.snapshots.length) {
      setLeftSnapshotKey("");
      return;
    }

    const valid = leftChart.snapshots.some(
      (item) =>
        snapshotKey(item) === leftSnapshotKey
    );

    if (!valid) {
      setLeftSnapshotKey(
        snapshotKey(leftChart.snapshots[0])
      );
    }
  }, [leftChart, leftSnapshotKey]);

  useEffect(() => {
    if (!rightChart?.snapshots.length) {
      setRightSnapshotKey("");
      return;
    }

    const valid = rightChart.snapshots.some(
      (item) =>
        snapshotKey(item) === rightSnapshotKey
    );

    if (!valid) {
      const latest =
        rightChart.snapshots[
          rightChart.snapshots.length - 1
        ];

      setRightSnapshotKey(snapshotKey(latest));
    }
  }, [rightChart, rightSnapshotKey]);

  const comparison = useMemo(() => {
    if (!leftSnapshot || !rightSnapshot) return null;

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

  async function importSnapshot(
    event: React.ChangeEvent<HTMLInputElement>
  ) {
    const file = event.target.files?.[0];

    if (!file) return;

    try {
      const text = await file.text();
      const data = JSON.parse(text) as Snapshot;

      if (
        !data ||
        typeof data.source_url !== "string" ||
        typeof data.captured_at !== "string" ||
        !Array.isArray(data.songs)
      ) {
        throw new Error("Invalid snapshot");
      }

      setSnapshots((current) => {
        const key = snapshotKey(data);

        const exists = current.some(
          (snapshot) =>
            snapshotKey(snapshot) === key
        );

        if (exists) return current;

        return [...current, data];
      });

      setRightChartUrl(data.source_url);
      setRightSnapshotKey(snapshotKey(data));
      setError("");
      event.target.value = "";
    } catch {
      setError(language === "ko" ? "이 JSON 스냅샷을 불러올 수 없습니다." : "Could not import this JSON snapshot.");
    }
  }

  function swapPanels() {
    const oldLeftChart = leftChartUrl;
    const oldLeftSnapshot = leftSnapshotKey;

    setLeftChartUrl(rightChartUrl);
    setLeftSnapshotKey(rightSnapshotKey);

    setRightChartUrl(oldLeftChart);
    setRightSnapshotKey(oldLeftSnapshot);
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

  function deleteSelected() {
    if (selectedForDelete.length === 0) return;

    const ok = window.confirm(
      language === "ko" ? `선택한 스냅샷 ${selectedForDelete.length}개를 삭제할까요?` : `Delete ${selectedForDelete.length} selected snapshot(s)?`
    );

    if (!ok) return;

    setSnapshots((current) =>
      current.filter(
        (snapshot) =>
          !selectedForDelete.includes(
            snapshotKey(snapshot)
          )
      )
    );

    setSelectedForDelete([]);
  }

  function deleteAll() {
    if (snapshots.length === 0) return;

    const ok = window.confirm(
      language === "ko" ? `저장된 스냅샷 ${snapshots.length}개를 모두 삭제할까요?` : `Delete all ${snapshots.length} saved snapshot(s)?`
    );

    if (!ok) return;

    setSnapshots([]);
    setSelectedForDelete([]);
    setLeftChartUrl("");
    setRightChartUrl("");
    setLeftSnapshotKey("");
    setRightSnapshotKey("");
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
      <header className="rym-topbar">
        <div className="rym-topbar-inner">
          <h1 className="rym-brand"><span>RYM</span> Tracker</h1>
          <div className="rym-header-actions">
            <button type="button" onClick={() => setLanguage((current) => current === "en" ? "ko" : "en")}
              className="rym-button rym-button--secondary rym-language-button"
              aria-label={language === "ko" ? "영어로 변경" : "한국어로 변경"}
              title={language === "ko" ? "English" : "한국어"}>
              <RymIcon name="globe" /><span>{language === "ko" ? "EN" : "한국어"}</span>
            </button>
            {charts.length > 0 && (
              <button type="button" onClick={swapPanels} className="rym-button rym-button--secondary">
                <RymIcon name="swap" /><span>{language === "ko" ? "좌우 바꾸기" : "Swap Left / Right"}</span>
              </button>
            )}
            <button type="button" onClick={() => setLibraryOpen((value) => !value)}
              className={"rym-button rym-button--secondary" + (libraryOpen ? " is-active" : "")}
              aria-expanded={libraryOpen} aria-controls="rym-library">
              <RymIcon name="library" /><span>{language === "ko" ? "라이브러리 관리" : "Manage Library"}</span>
            </button>
            <label className="rym-button rym-button--primary rym-file-button">
              <RymIcon name="upload" /><span>{language === "ko" ? "스냅샷 불러오기" : "Import Snapshot"}</span>
              <input type="file" accept=".json,application/json" onChange={importSnapshot}
                className="rym-file-input" aria-label={language === "ko" ? "스냅샷 JSON 파일 불러오기" : "Import snapshot JSON file"} />
            </label>
          </div>
        </div>
      </header>
      <div className="rym-subbar">
        <div className="rym-subbar-inner">
          <span className="rym-active-section">{language === "ko" ? "곡" : "Songs"}</span>
          <span className="rym-subbar-description">{language === "ko" ? "스냅샷 비교" : "Snapshot comparison"}</span>
          {loaded && <span className="rym-subbar-count">{charts.length}{language === "ko" ? "개 차트" : " charts"} · {snapshots.length}{language === "ko" ? "개 스냅샷" : " snapshots"}</span>}
        </div>
      </div>
      <div className="rym-workspace">
        {error && <p className="rym-error" role="alert">{error}</p>}
        {libraryOpen && (
          <section id="rym-library" className="rym-library" aria-labelledby="rym-library-title">
            <div className="rym-library-header">
              <div>
                <h2 id="rym-library-title">{language === "ko" ? "라이브러리 관리" : "Manage Library"}</h2>
                <p>{snapshots.length}{language === "ko" ? "개 저장됨" : " saved snapshots"}</p>
              </div>
              <div className="rym-library-actions">
                <button type="button" onClick={selectAllForDelete} className="rym-button rym-button--secondary">{language === "ko" ? "전체 선택" : "Select All"}</button>
                <button type="button" onClick={clearDeleteSelection} className="rym-button rym-button--secondary">{language === "ko" ? "선택 해제" : "Clear Selection"}</button>
                <button type="button" onClick={deleteSelected} disabled={selectedForDelete.length === 0}
                  className="rym-button rym-button--danger-outline">{language === "ko" ? `선택 삭제 (${selectedForDelete.length})` : `Delete Selected (${selectedForDelete.length})`}</button>
                <button type="button" onClick={deleteAll} disabled={snapshots.length === 0}
                  className="rym-button rym-button--danger">{language === "ko" ? "전체 삭제" : "Delete All"}</button>
              </div>
            </div>
            <div className="rym-library-list">
              {snapshots.length === 0 ? <p className="rym-library-empty">{language === "ko" ? "저장된 스냅샷이 없습니다." : "No saved snapshots."}</p> : (
                snapshots.slice().sort((a, b) => new Date(b.captured_at).getTime() - new Date(a.captured_at).getTime())
                  .map((snapshot) => {
                    const key = snapshotKey(snapshot);
                    const checked = selectedForDelete.includes(key);
                    return (
                      <label key={key} className={"rym-library-row" + (checked ? " is-selected" : "")}>
                        <input type="checkbox" checked={checked} onChange={() => toggleDeleteSelection(key)} />
                        <span className="rym-library-row-content">
                          <strong>{snapshot.page_title || "RYM Song Chart"}</strong>
                          <span className="rym-library-date">{formatDate(snapshot.captured_at, language)}</span>
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
            <p>{language === "ko" ? "RYM 곡 차트에서 저장한 JSON 스냅샷을 불러와 곡을 확인하고 순위 변화를 비교할 수 있습니다." : "Import a JSON snapshot saved from a RYM song chart to view your songs and compare rankings."}</p>
            <label className="rym-button rym-button--primary rym-file-button">
              <RymIcon name="upload" /><span>{language === "ko" ? "스냅샷 불러오기" : "Import Snapshot"}</span>
              <input type="file" accept=".json,application/json" onChange={importSnapshot}
                className="rym-file-input" aria-label={language === "ko" ? "첫 스냅샷 JSON 파일 불러오기" : "Import your first snapshot JSON file"} />
            </label>
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
                  <span>{sameChartComparison ? (language === "ko" ? "이전 스냅샷 → 현재 스냅샷" : "Previous snapshot → current snapshot") : (language === "ko" ? "기준 차트 → 대상 차트" : "Reference chart → target chart")}</span>
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
                    aria-pressed={movementFilter === "CHANGED"} onClick={() => setMovementFilter("CHANGED")}>
                    <span>{language === "ko" ? "변동" : "CHANGED"}</span><strong>{movementCounts.changed}</strong>
                  </button>
                  <button type="button" className={"rym-filter rym-filter--new" + (movementFilter === "NEW" ? " is-active" : "")}
                    aria-pressed={movementFilter === "NEW"} onClick={() => setMovementFilter("NEW")}>
                    <span>{language === "ko" ? "신규" : "NEW"}</span><strong>{movementCounts.new}</strong>
                  </button>
                  <button type="button" className={"rym-filter rym-filter--up" + (movementFilter === "UP" ? " is-active" : "")}
                    aria-pressed={movementFilter === "UP"} onClick={() => setMovementFilter("UP")}>
                    <RymIcon name="up" /><strong>{movementCounts.up}</strong>
                  </button>
                  <button type="button" className={"rym-filter rym-filter--down" + (movementFilter === "DOWN" ? " is-active" : "")}
                    aria-pressed={movementFilter === "DOWN"} onClick={() => setMovementFilter("DOWN")}>
                    <RymIcon name="down" /><strong>{movementCounts.down}</strong>
                  </button>
                  <button type="button" className={"rym-filter rym-filter--same" + (movementFilter === "SAME" ? " is-active" : "")}
                    aria-pressed={movementFilter === "SAME"} onClick={() => setMovementFilter("SAME")}>
                    <RymIcon name="minus" /><strong>{movementCounts.same}</strong>
                  </button>
                  <button type="button" className={"rym-filter rym-filter--out" + (movementFilter === "OUT" ? " is-active" : "")}
                    aria-pressed={movementFilter === "OUT"} onClick={() => setMovementFilter("OUT")}>
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
                onChartChange={(value) => { setRightChartUrl(value); setRightSnapshotKey(""); }}
                onSnapshotChange={setRightSnapshotKey} snapshot={rightSnapshot}
                comparedSongs={effectiveComparison?.current ?? null} outSongs={effectiveComparison?.out ?? []}
                comparisonActive={Boolean(effectiveComparison)} filter={effectiveComparison ? movementFilter : "ALL"}
                query={searchQuery} roleLabel={sameChartComparison ? (language === "ko" ? "현재" : "CURRENT") : (language === "ko" ? "대상" : "TARGET")} language={language}
                activeSpotifyUrl={activeSpotifyUrl} onToggleSpotify={toggleSpotifyPreview} />
            </div>
            <footer className="rym-footer">
              {language === "ko" ? `이 브라우저에 ${charts.length}개 차트의 스냅샷 ${snapshots.length}개가 저장되어 있습니다.` : `${snapshots.length} snapshots across ${charts.length} charts are saved in this browser.`}
            </footer>
          </>
        )}
      </div>
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

/* Header: keep RYM hierarchy, tighten the chrome. */
.rym-app .rym-topbar { background: rgba(255,255,255,.98); border-bottom: 1px solid var(--rym-border); box-shadow: 0 1px 2px #00000008; }
.rym-app .rym-topbar-inner, .rym-app .rym-subbar-inner {
  width: 100%; min-width: 0; max-width: none; margin-inline: 0; padding-inline: .75rem;
  display: flex; align-items: center; gap: 1rem;
}
.rym-app .rym-topbar-inner { min-height: 3.75rem; padding-block: .625rem; justify-content: space-between; flex-wrap: wrap; }
.rym-app .rym-brand { font-size: 1.0625rem; line-height: 1.2; color: var(--rym-link); font-weight: 500; white-space: nowrap; letter-spacing: -.01em; }
.rym-app .rym-brand > span { font-weight: 750; padding-right: .7rem; margin-right: .575rem; border-right: 1px solid var(--rym-border); }
.rym-app .rym-header-actions { display: flex; align-items: center; gap: .5rem; flex-wrap: wrap; min-width: 0; max-width: 100%; }
.rym-app .rym-button {
  display: inline-flex; align-items: center; justify-content: center; gap: .4375rem;
  position: relative; min-width: 0; max-width: 100%; min-height: 2.375rem; padding: .4375rem .75rem;
  border: 1px solid transparent; border-radius: var(--rym-radius); font-weight: 600;
  font-size: .8125rem; line-height: 1.3; text-decoration: none;
  transition: background-color .14s ease, border-color .14s ease, box-shadow .14s ease, transform .14s ease;
}
.rym-app .rym-button:active:not(:disabled) { transform: translateY(1px); }
.rym-app .rym-button--primary { background: var(--rym-blue); border-color: var(--rym-blue); color: #fff; box-shadow: 0 1px 1px #0000000d; }
.rym-app .rym-button--primary:hover { background: var(--rym-blue-strong); border-color: var(--rym-blue-strong); }
.rym-app .rym-button--secondary { background: #fff; color: #425b78; border-color: var(--rym-border-strong); }
.rym-app .rym-button--secondary:hover, .rym-app .rym-button--secondary.is-active { background: #f2f5f9; border-color: #aebdce; }
.rym-app .rym-button--danger-outline { color: #a83c38; border-color: #deb8b7; background: #fff; }
.rym-app .rym-button--danger-outline:hover:not(:disabled) { background: #faf0ef; }
.rym-app .rym-button--danger { color: #fff; background: #af4541; border-color: #af4541; }
.rym-app .rym-button--danger:hover:not(:disabled) { background: #963935; }
.rym-app .rym-file-button { cursor: pointer; overflow: hidden; }
.rym-app .rym-file-button:focus-within { outline: 2px solid #6f98ca; outline-offset: 2px; }
.rym-app .rym-file-input { position: absolute; inset: 0; width: 100%; height: 100%; opacity: 0; cursor: pointer; }
.rym-app 
.rym-language-button {
  min-width: 72px;
}
.rym-language-button .rym-icon { width: 17px; height: 17px; }
.rym-subbar { background: var(--rym-surface); border-bottom: 1px solid var(--rym-border); }
.rym-app .rym-subbar-inner { min-height: 3.375rem; padding-block: .625rem; flex-wrap: wrap; }
.rym-app .rym-active-section { display: inline-flex; align-items: center; border-radius: 999px; padding: .35rem .875rem; background: var(--rym-blue); color: #fff; font-size: .875rem; font-weight: 650; }
.rym-app .rym-subbar-description { color: var(--rym-link); font-size: .9375rem; }
.rym-app .rym-subbar-count { color: var(--rym-muted); font-size: .8125rem; margin-left: auto; font-variant-numeric: tabular-nums; }

/* Workspace / comparison toolbar. */
.rym-app .rym-workspace { width: 100%; min-width: 0; max-width: none; margin-inline: 0; padding: 1rem .75rem 1.25rem; }
.rym-app .rym-comparison-bar {
  background: rgba(255,255,255,.92); border: 1px solid var(--rym-border); border-radius: 9px;
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
  background: #fff; border: 1px solid var(--rym-border); border-radius: 8px; padding: .75rem; margin-bottom: .625rem;
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
  border-radius: 7px; padding: .5rem 2rem .5rem .65rem;
  background-color: #f8f9fb; color: #3d434c; font-size: .8125rem;
  white-space: nowrap; text-overflow: ellipsis; appearance: none; cursor: pointer;
  background-repeat: no-repeat; background-position: right .675rem center; background-size: .5625rem;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 10 6'%3E%3Cpath d='M0 0h10L5 6Z' fill='%23565c67'/%3E%3C/svg%3E");
  transition: border-color .14s ease, box-shadow .14s ease, background-color .14s ease;
}
.rym-app .rym-select:hover { border-color: #b5bbc4; background-color: #fff; }
.rym-app .rym-select:focus { border-color: #7f9fc5; box-shadow: 0 0 0 3px #dce8f7; outline: none; }
.rym-app .rym-select--blue {
  background-color: var(--rym-blue); border-color: var(--rym-blue); color: #fff; font-weight: 650;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 10 6'%3E%3Cpath d='M0 0h10L5 6Z' fill='white'/%3E%3C/svg%3E");
}
.rym-app .rym-select--blue:hover { background-color: var(--rym-blue-strong); border-color: var(--rym-blue-strong); }
.rym-app .rym-select option { background: #fff; color: #202122; }
.rym-app .rym-calendar-toggle { display: inline-flex; align-items: center; gap: .25rem; border: none; background: transparent; color: var(--rym-link); padding: 0 0 .35rem; font-size: .71875rem; min-height: 1.45rem; }
.rym-app .rym-calendar-toggle .rym-icon { width: .8125rem; height: .8125rem; }
.rym-app .rym-calendar-toggle:hover { text-decoration: underline; }
.rym-app .rym-calendar-popover { position: absolute; z-index: 40; top: calc(100% + .375rem); right: 0; width: min(20rem, calc(100vw - 2rem)); }
.rym-app .rym-pane--compact .rym-calendar-popover { left: 0; right: auto; }

/* Song rows: denser than v6, with status color carried by a left rail. */
.rym-app .rym-song-list { display: flex; flex-direction: column; gap: .375rem; }
.rym-app .rym-song-list, .rym-app .rym-library-list { min-width: 0; max-width: 100%; overscroll-behavior-x: none; touch-action: pan-y pinch-zoom; }
.rym-app .rym-song {
  --rym-cover-size: clamp(5.5rem, 10vw, 9.25rem);
  position: relative; display: grid; grid-template-columns: 2.5rem var(--rym-cover-size) minmax(0, 1fr);
  gap: .875rem; padding: .75rem .875rem .75rem .7rem;
  background: var(--rym-surface); border: 1px solid var(--rym-border); border-radius: 7px;
  box-shadow: 0 1px 1px #00000004; flex-shrink: 0; min-width: 0; overflow: hidden;
  transition: border-color .14s ease, box-shadow .14s ease, transform .14s ease;
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
.rym-app .rym-rank-number { color: #24272b; font-size: 1.2rem; font-weight: 760; line-height: 1.2; font-variant-numeric: tabular-nums; letter-spacing: -.02em; }
.rym-app .rym-cover { width: var(--rym-cover-size); height: var(--rym-cover-size); aspect-ratio: 1; background: #e5e7eb; overflow: hidden; flex: 0 0 auto; border-radius: 3px; }
.rym-app .rym-cover img { display: block; width: 100%; height: 100%; object-fit: cover; border-radius: 0; }
.rym-app .rym-cover-empty { width: 100%; height: 100%; display: grid; place-items: center; color: #a4a8b1; font-size: 1.35rem; }
.rym-app .rym-song-body { min-width: 0; display: flex; flex-direction: column; align-items: flex-start; }
.rym-app .rym-song-body > * { min-width: 0; max-width: 100%; }
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
.rym-app .rym-song-meta { color: #737983; font-size: .78rem; margin-top: .3rem; line-height: 1.35; overflow-wrap: anywhere; }
.rym-app .rym-meta-separator { color: #a0a5ad; padding-inline: .05rem; }
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
.rym-app .rym-song--compact { --rym-cover-size: 3.25rem; grid-template-columns: 1.65rem var(--rym-cover-size) minmax(0, 1fr); gap: .55rem; padding: .625rem .625rem .625rem .45rem; border-radius: 6px; }
.rym-app .rym-song--compact .rym-rank-number { font-size: .9375rem; }
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
.rym-app .rym-calendar { margin-top: 0; padding: .75rem; border: 1px solid #d6dae1; background: rgba(255,255,255,.99); border-radius: 10px; box-shadow: 0 12px 34px #0000001c, 0 2px 7px #0000000d; }
.rym-app .rym-calendar-heading { display: flex; align-items: center; justify-content: space-between; gap: .5rem; margin-bottom: .55rem; }
.rym-app .rym-calendar-month { font-size: .875rem; font-weight: 720; text-align: center; }
.rym-app .rym-calendar-month--compact { font-size: .8125rem; }
.rym-app .rym-icon-button { width: 1.875rem; height: 1.875rem; flex: 0 0 auto; padding: .35rem; display: inline-flex; align-items: center; justify-content: center; color: var(--rym-link); background: #fff; border: 1px solid #d8dade; border-radius: 6px; }
.rym-app .rym-icon-button:hover { background: #f0f3f7; }
.rym-app .rym-calendar-week, .rym-app .rym-calendar-days { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: .15rem; text-align: center; }
.rym-app .rym-calendar-week { font-size: .6875rem; color: #7b7e87; margin-bottom: .375rem; }
.rym-app .rym-calendar-day { border: none; border-radius: 5px; background: #f0f2f5; color: var(--rym-link); width: 100%; min-width: 0; min-height: 1.875rem; aspect-ratio: 1; padding: 0; position: relative; font-size: .8125rem; font-weight: 650; }
.rym-app .rym-calendar-day:disabled { background: transparent; color: #b4b8c0; opacity: 1; font-weight: 400; }
.rym-app .rym-calendar-day:hover:not(:disabled) { background: #dfe7f1; }
.rym-app .rym-calendar-day.is-selected { color: #fff; background: var(--rym-blue); }
.rym-app .rym-calendar-day.is-selected:hover { background: var(--rym-blue-strong); }
.rym-app .rym-calendar-dot { position: absolute; width: 3px; height: 3px; border-radius: 50%; background: currentColor; bottom: 3px; left: calc(50% - 1.5px); }
.rym-app .rym-calendar-times { border-top: 1px solid var(--rym-border); padding-top: .625rem; margin-top: .625rem; }
.rym-app .rym-calendar-times .rym-field-label { font-size: .6875rem; font-weight: 500; }
.rym-app .rym-time-buttons { display: flex; flex-wrap: wrap; gap: .3rem; }
.rym-app .rym-time-button { min-height: 1.875rem; padding: .25rem .45rem; color: #535a67; border: 1px solid #d6d9df; background: #f3f4f6; border-radius: 5px; font-size: .75rem; }
.rym-app .rym-time-button.is-selected { color: #fff; border-color: var(--rym-blue); background: var(--rym-blue); }

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
  .rym-app .rym-chart-grid { grid-template-columns: minmax(0, 1fr) minmax(0, 3fr); }
  .rym-app .rym-pane--compact {
    position: sticky; top: .75rem;
    max-height: calc(100vh - 1.5rem); max-height: calc(100dvh - 1.5rem);
    overflow-y: auto; overflow-x: hidden;
    overscroll-behavior-x: none; overscroll-behavior-y: contain;
    touch-action: pan-y pinch-zoom;
    scrollbar-width: thin; scrollbar-color: #c5c8cf transparent;
    padding-right: .125rem;
  }
}
@media (max-width: 1023px) {
  .rym-app .rym-pane--compact .rym-chart-controls { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); }
  .rym-app .rym-pane--compact .rym-song-list {
    max-height: 34vh; max-height: 34dvh;
    overflow-y: auto; overflow-x: hidden; overscroll-behavior-y: contain;
    scrollbar-width: thin; scrollbar-color: #c5c8cf transparent;
  }
  .rym-app .rym-song { --rym-cover-size: clamp(5.25rem, 16vw, 8.75rem); }
  .rym-app .rym-song--compact { --rym-cover-size: 3.25rem; }
}
@media (max-width: 720px) {
  .rym-app .rym-comparison-head { align-items: stretch; }
  .rym-app .rym-search { width: 100%; }
  .rym-app .rym-chart-controls, .rym-app .rym-pane--compact .rym-chart-controls { grid-template-columns: minmax(0, 1fr); }
  .rym-app .rym-calendar-popover, .rym-app .rym-pane--compact .rym-calendar-popover { left: 0; right: auto; width: min(20rem, calc(100vw - 2.5rem)); }
}
@media (max-width: 600px) {
  .rym-app .rym-topbar-inner { gap: .625rem; }
  .rym-app .rym-header-actions { width: 100%; gap: .375rem; }
  .rym-app .rym-header-actions .rym-button { flex: 1 1 auto; padding-inline: .55rem; }
  .rym-app .rym-header-actions .rym-file-button { flex-grow: 2; }
  .rym-app .rym-subbar-inner { gap: .625rem; }
  .rym-app .rym-subbar-count { margin-left: 0; width: 100%; }
  .rym-app .rym-subbar-description { font-size: .8125rem; }
  .rym-app .rym-workspace { padding-top: .75rem; }
  .rym-app .rym-comparison-bar { padding: .625rem; border-radius: 8px; }
  .rym-app .rym-filterbar { gap: .3rem; }
  .rym-app .rym-filter { padding-inline: .5rem; }
  .rym-app .rym-song { --rym-cover-size: 4.75rem; grid-template-columns: 1.7rem var(--rym-cover-size) minmax(0, 1fr); gap: .55rem; padding: .625rem .55rem; }
  .rym-app .rym-song--compact { --rym-cover-size: 3rem; }
  .rym-app .rym-rank-number { font-size: 1rem; }
  .rym-app .rym-movement { flex-wrap: wrap; font-size: .6875rem; gap: .1rem; }
  .rym-app .rym-song-title { font-size: .9375rem; }
  .rym-app .rym-song-artists { font-size: .875rem; }
  .rym-app .rym-song-meta { font-size: .7rem; }
  .rym-app .rym-song-bottom { padding-top: .5rem; }
  .rym-app .rym-rating strong { font-size: .9rem; }
  .rym-app .rym-rating-count, .rym-app .rym-rank-route { font-size: .6875rem; }
  .rym-app .rym-calendar-day { aspect-ratio: auto; min-height: 2.25rem; }
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
`;
