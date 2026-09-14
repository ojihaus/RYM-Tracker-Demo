import { useRef, useState } from "react";
import { formatRatingCount, spotifyEmbedUrl, songKey, type Song, type ComparedSong, type Language } from "../lib/chartModel";
import RymIcon from "./RymIcon";
import SpotifyAutoPlayer from "./SpotifyPlayer";

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
        <img width={300} height={300} key={song.album_art_url} src={song.album_art_url} alt=""
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

export default function SongCard({ song, compact = false, comparedSong = null, out = false, language = "en", activePreviewKey = "", onTogglePreview }: {
  song: Song;
  compact?: boolean;
  comparedSong?: ComparedSong | null;
  out?: boolean;
  language?: Language;
  activePreviewKey?: string;
  onTogglePreview?: (key: string) => void;
}) {
  const highlight = !compact && !out && comparedSong && comparedSong.status !== "SAME"
    ? " rym-song--" + comparedSong.status.toLowerCase()
    : "";
  const releaseDate = song.release_date;
  const genreLabel = song.primary_genres?.slice(0, 2).join(" / ");
  const embedUrl = spotifyEmbedUrl(song.spotify_url);
  const previewKey = songKey(song);
  const spotifyActive = Boolean(embedUrl && activePreviewKey === previewKey);
  const [titleCopied, setTitleCopied] = useState(false);
  const copyResetTimerRef = useRef<number | null>(null);

  const copyTitle = async () => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(song.title);
      } else {
        const textarea = document.createElement("textarea");
        textarea.value = song.title;
        textarea.setAttribute("readonly", "");
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand("copy");
        textarea.remove();
      }

      setTitleCopied(true);

      if (copyResetTimerRef.current != null) {
        window.clearTimeout(copyResetTimerRef.current);
      }

      copyResetTimerRef.current = window.setTimeout(() => {
        setTitleCopied(false);
        copyResetTimerRef.current = null;
      }, 3000);
    } catch {
      setTitleCopied(false);
    }
  };

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
          <div className="rym-song-title-row">
            <h3 className="rym-song-title">{song.title}</h3>
            {!compact && (
              <span className={"rym-title-copy-wrap" + (titleCopied ? " is-copied" : "")}>
                <button
                  type="button"
                  className="rym-title-copy-button"
                  onClick={copyTitle}
                  aria-label={
                    language === "ko"
                      ? `${song.title} 제목 복사`
                      : `Copy title ${song.title}`
                  }
                  title={language === "ko" ? "제목 복사" : "Copy title"}
                >
                  <svg
                    className="rym-title-copy-icon"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                    focusable="false"
                  >
                    <rect x="8" y="8" width="10" height="10" rx="2" />
                    <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
                  </svg>
                </button>
                <span className="rym-copy-status" role="status" aria-live="polite">
                  {language === "ko" ? "복사됨" : "Copied"}
                </span>
              </span>
            )}
          </div>
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
                    onClick={() => onTogglePreview?.(previewKey)}
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
                      width={32} height={32}
                      className="rym-rym-logo-image"
                      src="/rym-mark.png"
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
                    <SpotifyAutoPlayer key={song.spotify_url}
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
