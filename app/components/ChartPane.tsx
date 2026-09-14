import { useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { chartKind, chartPeriodLabel, formatChartTitle, rymWeekMeta, songKey, type ChartGroup, type ChartKind, type Snapshot, type Song, type ComparedSong, type MovementFilter, type Language } from "../lib/chartModel";
import { useDialogFocus, useSmallViewport } from "../hooks/useBrowserUI";
import { errorMessage } from "../lib/chartClient";
import SongCard from "./SongCard";
import SnapshotCalendar from "./SnapshotCalendar";

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
  activePreviewKey?: string;
  onTogglePreview?: (key: string) => void;
  loadError?: unknown;
  onRetry?: () => void;
};

export default function ChartPane({
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
  activePreviewKey = "",
  onTogglePreview,
  loadError,
  onRetry,
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
  const [compactListScrolled, setCompactListScrolled] = useState(false);
  const smallViewport = useSmallViewport();
  const [collapsedChoice, setCollapsedChoice] = useState<boolean | null>(null);
  const compactCollapsed = compact && (collapsedChoice ?? smallViewport);
  const [pickerKind, setPickerKind] = useState<ChartKind>(
    chart ? chartKind(chart) : "song"
  );
  const chartPickerRef = useRef<HTMLDivElement>(null);
  const chartPickerButtonRef = useRef<HTMLButtonElement>(null);
  const chartPickerPopoverRef = useRef<HTMLDivElement>(null);
  const [chartPickerFloatingStyle, setChartPickerFloatingStyle] =
    useState<CSSProperties>({});

  useEffect(() => {
    if (chart) setPickerKind(chartKind(chart));
  }, [chart]);

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

      const visualViewport = window.visualViewport;
      const topEdge = (visualViewport?.offsetTop ?? 0) + edge;
      const bottomEdge = (visualViewport?.offsetTop ?? 0) + (visualViewport?.height ?? viewportHeight) - edge;
      const spaceBelow = bottomEdge - rect.bottom - gap;
      const spaceAbove = rect.top - gap - topEdge;
      const openAbove = spaceBelow < 240 && spaceAbove > spaceBelow;
      const height = Math.min(maxHeight, Math.max(0, openAbove ? spaceAbove : spaceBelow));
      setChartPickerFloatingStyle({ position: "fixed", left, width,
        top: Math.max(topEdge, Math.min(openAbove ? rect.top - gap - height : rect.bottom + gap, bottomEdge - height)), maxHeight: height });
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
    window.visualViewport?.addEventListener("resize", updatePickerPosition);
    window.visualViewport?.addEventListener("scroll", updatePickerPosition);
    window.addEventListener("scroll", updatePickerPosition, true);
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("resize", updatePickerPosition);
      window.visualViewport?.removeEventListener("resize", updatePickerPosition);
      window.visualViewport?.removeEventListener("scroll", updatePickerPosition);
      window.removeEventListener("scroll", updatePickerPosition, true);
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [chartPickerOpen]);

  useDialogFocus(chartPickerOpen, chartPickerPopoverRef, () => setChartPickerOpen(false), false);

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
  const displayedUnit =
    selectedChartKind === "album"
      ? (language === "ko" ? "앨범" : " albums")
      : (language === "ko" ? "곡" : " songs");

  const resolvedRoleLabel = roleLabel ?? (side === "LEFT" ? (language === "ko" ? "기준" : "REFERENCE") : (language === "ko" ? "대상" : "TARGET"));

  return (
    <section
      className={
        "rym-pane" +
        (compact ? " rym-pane--compact" : "") +
        (compact && compactCollapsed ? " rym-pane--collapsed" : "")
      }
      id={side === "RIGHT" ? "rym-main-chart" : "rym-reference-chart"}
      aria-label={language === "ko" ? (compact ? "기준 차트" : "대상 차트") : side + " chart"}
    >
      {compact ? (
        <button
          type="button"
          className="rym-pane-heading rym-pane-heading--toggle"
          aria-expanded={!compactCollapsed}
          onClick={() => {
            setCollapsedChoice(!compactCollapsed);
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
                  aria-haspopup="dialog"
                  aria-expanded={chartPickerOpen}
                  aria-controls={"rym-chart-picker-popover-" + side}
                  onClick={() => setChartPickerOpen((current) => !current)}
                >
                  <span className="rym-chart-picker-summary-title">
                    {selectedChartKind === "album" ? (language === "ko" ? "앨범" : "Albums") : (language === "ko" ? "곡" : "Songs")}
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
                      tabIndex={-1}
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
                                {kind === "song" ? (language === "ko" ? "곡" : "Songs") : (language === "ko" ? "앨범" : "Albums")}
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

          {compact && (
            <div
              className={
                "rym-compact-list-divider" +
                (compactListScrolled ? " is-scrolled" : "")
              }
              aria-hidden="true"
            />
          )}

          <div
            className="rym-song-list"
            tabIndex={0}
            role="region"
            aria-label={language === "ko" ? "차트 목록" : side + " chart items"}
            onScroll={(event) => {
              if (!compact) return;
              setCompactListScrolled(event.currentTarget.scrollTop > 2);
            }}
          >
            {snapshot?.is_metadata && (loadError ? <div className="rym-record-state" role="alert"><p>{errorMessage(loadError, language)}</p><button type="button" className="rym-button rym-button--secondary" onClick={onRetry}>{language === "ko" ? "다시 불러오기" : "Retry"}</button></div> : <div className="rym-record-state" role="status"><div className="rym-skeleton" /><div className="rym-skeleton" /><p>{language === "ko" ? "차트 불러오는 중…" : "Loading chart…"}</p></div>)}
            {visibleSongs.map((song) => (
              <SongCard key={songKey(song)} song={song} compact={compact}
                comparedSong={comparisonActive && "status" in song ? song as ComparedSong : null} language={language}
                activePreviewKey={activePreviewKey} onTogglePreview={onTogglePreview} />
            ))}
            {showOut && (
              <section className="rym-out-section" aria-label={language === "ko" ? "대상 차트에서 이탈한 항목" : "Items out of the target chart"}>
                <div className="rym-out-heading">
                  <h3>{language === "ko" ? "이탈" : "OUT"} <span>{visibleOutSongs.length}</span></h3>
                  <p>{language === "ko" ? "기준 기록에는 있지만 대상 기록에서는 사라진 항목입니다." : "Present in the reference record, missing from the target record."}</p>
                </div>
                {visibleOutSongs.map((song) => <SongCard key={songKey(song)} song={song} out language={language}
                  activePreviewKey={activePreviewKey} onTogglePreview={onTogglePreview} />)}
              </section>
            )}
            {!snapshot?.is_metadata && visibleSongs.length === 0 && !showOut && (
              <div className="rym-filter-empty">{language === "ko" ? "이 조건에 맞는 항목이 없습니다." : "No items match this view."}</div>
            )}
          </div>
        </div>
      )}
    </section>
  );}
