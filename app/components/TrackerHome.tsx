"use client";

import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { buildCharts, findSnapshot, formatChartTitle, formatRymWeekLabel, formatRymWeekRange, previousWeeklySnapshot, sanitizeSnapshot, MAX_CHART_BYTES, snapshotKey, snapshotPublicFilename, songKey, weeklySnapshotRepresentatives, type Snapshot, type ComparedSong, type MovementFilter, type Language } from "../lib/chartModel";
import { ApiError, errorMessage, requestJson } from "../lib/chartClient";
import { useChartLibrary } from "../hooks/useChartLibrary";
import AdminDialog, { type AdminAction } from "./AdminDialog";
import RymIcon from "./RymIcon";
import ChartPane from "./ChartPane";

const STORAGE_KEY = "rym-tracker-snapshots-v1";
const LANGUAGE_KEY = "rym-tracker-language-v1";

export default function Home() {
  const { snapshots, setRecords, loaded, loadError, recordErrors, failedFiles, refreshing, refresh, invalidate, ensureLoaded } = useChartLibrary();
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
  const [activePreviewKey, setActivePreviewKey] = useState("");
  const [urlStateReady, setUrlStateReady] = useState(false);
  const initialComparisonAppliedRef = useRef(false);
  const [adminDialog, setAdminDialog] = useState<AdminAction | null>(null);
  const [importReady, setImportReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const mutationRef = useRef(false);
  const [notice, setNotice] = useState("");
  const importInputRef = useRef<HTMLInputElement>(null);
  const deferredQuery = useDeferredValue(searchQuery);

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

  useEffect(() => { document.documentElement.lang = language; }, [language]);

  useEffect(() => {
    try { localStorage.removeItem(STORAGE_KEY); } catch { /* Optional legacy cleanup. */ }
  }, []);

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
    void ensureLoaded(leftSnapshot);
  }, [leftSnapshot, ensureLoaded]);

  useEffect(() => {
    if (!rightSnapshot?.is_metadata) return;
    void ensureLoaded(rightSnapshot);
  }, [rightSnapshot, ensureLoaded]);

  useEffect(() => {
    if (!loaded || !urlStateReady) return;
    if (initialComparisonAppliedRef.current && leftChart && rightChart) return;

    if (!charts.length) {
      setLeftChartUrl("");
      setRightChartUrl("");
      setLeftSnapshotKey("");
      setRightSnapshotKey("");
      initialComparisonAppliedRef.current = false;
      return;
    }

    // Every fresh visit starts on the 2020s chart.
    // RIGHT/main = newest snapshot, LEFT/sub = snapshot immediately before it.
    const defaultChart =
      charts.find((chart) => /\/charts\/top\/song\/2020s\/?$/i.test(chart.sourceUrl)) ??
      charts.find((chart) => /between\s+2020\s+and\s+2029/i.test(chart.title)) ??
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
  }, [charts, loaded, urlStateReady, leftChart, rightChart]);

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

  function openLibraryWithPassword() {
    if (busy) return;
    if (libraryOpen) { setLibraryOpen(false); setSelectedForDelete([]); void requestJson("/api/admin-auth", { method: "DELETE" }).catch(() => {}); }
    else setAdminDialog("LIBRARY");
  }

  function openImportWithPassword() {
    if (busy) return;
    if (importReady) importInputRef.current?.click();
    else setAdminDialog("IMPORT");
  }

  function openPinChange() { setAdminDialog("CHANGE"); }

  function adminSuccess(action: AdminAction) {
    setAdminDialog(null);
    if (action === "LIBRARY") { setLibraryOpen(true); void refresh(); }
    if (action === "IMPORT") setImportReady(true);
    if (action === "CHANGE") setNotice(language === "ko" ? "관리자 비밀번호를 변경했습니다." : "Administrator PIN changed.");
  }

  async function importSnapshot(event: React.ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    input.value = "";
    if (!file || mutationRef.current) return;
    mutationRef.current = true; setBusy(true); invalidate(); setError(""); setNotice("");
    try {
      if (file.size > MAX_CHART_BYTES) throw new ApiError("TOO_LARGE", "Choose a JSON file smaller than 2MB.");
      let raw: unknown;
      try { raw = JSON.parse((await file.text()).replace(/^\uFEFF/, "")); } catch { throw new ApiError("INVALID_JSON", "This file is not valid JSON."); }
      const data = sanitizeSnapshot(raw);
      if (!data || data.is_metadata) throw new ApiError("INVALID_RECORD", "Choose a complete RYM song or album chart JSON.");
      const saved = await requestJson<{ filename: string; snapshot: Snapshot }>("/api/chart-files", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ snapshot: data }) });
      // Commit success is definitive. A failed subsequent read must not report
      // the upload as failed and encourage the user to publish it twice.
      setRecords((current) => [...current.filter((item) => item.file_name !== saved.filename && snapshotKey(item) !== snapshotKey(saved.snapshot)), saved.snapshot]);
      setRightChartUrl(saved.snapshot.source_url); setRightSnapshotKey(snapshotKey(saved.snapshot));
      const sameChart = snapshots.filter((item) => item.source_url === saved.snapshot.source_url && item.file_name !== saved.filename);
      const previous = previousWeeklySnapshot([...sameChart, saved.snapshot], saved.snapshot);
      setLeftChartUrl(saved.snapshot.source_url); setLeftSnapshotKey(snapshotKey(previous ?? saved.snapshot));
      setNotice(language === "ko" ? "차트 기록을 저장했습니다." : "Chart record saved.");
      setImportReady(false);
      await refresh();
    } catch (error) {
      if (error instanceof ApiError && error.code === "AUTH_REQUIRED") setImportReady(false);
      setError(errorMessage(error, language));
    } finally { mutationRef.current = false; setBusy(false); }
  }

  function toggleDeleteSelection(key: string) {
    if (busy) return;
    setSelectedForDelete((current) => current.includes(key) ? current.filter((item) => item !== key) : [...current, key]);
  }
  function selectAllForDelete() { setSelectedForDelete(snapshots.map(snapshotKey)); }
  function clearDeleteSelection() { setSelectedForDelete([]); }

  async function deleteRecords(targets: Snapshot[]) {
    if (mutationRef.current || !targets.length) return;
    mutationRef.current = true; setBusy(true); invalidate(); setError(""); setNotice("");
    let removed = 0;
    try {
      for (const snapshot of targets) {
        const filename = snapshot.file_name || snapshotPublicFilename(snapshot);
        if (!filename) throw new ApiError("INVALID_RECORD", "The record has no filename.");
        await requestJson("/api/chart-files", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ filename, sha: snapshot.file_sha }) });
        removed++;
        setRecords((current) => current.filter((item) => item.file_name !== filename));
        setSelectedForDelete((current) => current.filter((key) => key !== snapshotKey(snapshot)));
      }
      setNotice(language === "ko" ? `${removed}개 기록을 삭제했습니다.` : `${removed} record(s) deleted.`);
    } catch (error) {
      setError((removed ? (language === "ko" ? `${removed}개는 삭제했습니다. ` : `${removed} record(s) were deleted. `) : "") + errorMessage(error, language));
    } finally {
      await refresh();
      mutationRef.current = false; setBusy(false);
    }
  }
  function deleteSelected() { void deleteRecords(snapshots.filter((record) => selectedForDelete.includes(snapshotKey(record)))); }
  function deleteAll() { void deleteRecords(snapshots); }

  function togglePreview(key: string) {
    setActivePreviewKey((current) => current === key ? "" : key);
  }

  useEffect(() => { setActivePreviewKey(""); }, [rightSnapshotKey, rightChartUrl, movementFilter, deferredQuery]);

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

      {adminDialog && <AdminDialog key={adminDialog} action={adminDialog} language={language} onClose={() => setAdminDialog(null)} onSuccess={adminSuccess} />}
      <a href="#rym-main-chart" className="rym-skip-link">{language === "ko" ? "차트로 바로가기" : "Skip to chart"}</a>
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
            <button type="button" onClick={openLibraryWithPassword} disabled={busy}
              className={"rym-button rym-button--secondary" + (libraryOpen ? " is-active" : "")}
              aria-expanded={libraryOpen} aria-controls="rym-library">
              <RymIcon name="library" /><span>{language === "ko" ? "라이브러리 관리" : "Manage Library"}</span>
            </button>
            <button type="button" onClick={openImportWithPassword} disabled={busy}
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
      <div className="rym-workspace" aria-busy={busy}>
        {(notice || busy) && <div className="rym-notice" role="status">{busy ? (language === "ko" ? "기록을 처리하고 있습니다…" : "Updating records…") : notice}</div>}
        {importReady && <div className="rym-notice" role="status">
          <span>{language === "ko" ? "불러올 차트 JSON을 선택해 주세요." : "Choose a chart JSON to import."}</span>
          <button type="button" className="rym-button rym-button--primary" disabled={busy} onClick={() => importInputRef.current?.click()}>{language === "ko" ? "JSON 파일 선택" : "Choose JSON file"}</button>
          <button type="button" className="rym-button rym-button--secondary" disabled={busy} onClick={() => setImportReady(false)}>{language === "ko" ? "취소" : "Cancel"}</button>
        </div>}
        {Boolean(loadError) && <div className="rym-error" role="alert"><span>{errorMessage(loadError, language)}</span><button type="button" className="rym-button rym-button--secondary" onClick={() => void refresh()} disabled={refreshing || busy}>{language === "ko" ? "다시 불러오기" : "Retry"}</button></div>}
        {failedFiles.length > 0 && <div className="rym-error" role="alert">{language === "ko" ? `${failedFiles.length}개 기록을 불러오지 못했습니다. 나머지 기록을 표시합니다.` : `${failedFiles.length} record(s) could not be loaded. Showing the available records.`}<button type="button" className="rym-button rym-button--secondary" onClick={() => void refresh()} disabled={refreshing || busy}>{language === "ko" ? "다시 시도" : "Retry"}</button></div>}
        {error && <p className="rym-error" role="alert">{error}</p>}
        {libraryOpen && (
          <section id="rym-library" className="rym-library" aria-labelledby="rym-library-title">
            <div className="rym-library-header">
              <div>
                <h2 id="rym-library-title">{language === "ko" ? "라이브러리 관리" : "Manage Library"}</h2>
                <p>{snapshots.length}{language === "ko" ? "개 저장됨" : " saved records"}</p>
              </div>
              <div className="rym-library-actions">
                <button type="button" onClick={openPinChange} disabled={busy} className="rym-button rym-button--secondary">
                  {language === "ko" ? "비밀번호 변경" : "Change PIN"}
                </button>
                <button type="button" onClick={selectAllForDelete} disabled={busy} className="rym-button rym-button--secondary">{language === "ko" ? "전체 선택" : "Select All"}</button>
                <button type="button" onClick={clearDeleteSelection} disabled={busy} className="rym-button rym-button--secondary">{language === "ko" ? "선택 해제" : "Clear Selection"}</button>
                <button type="button" onClick={deleteSelected} disabled={busy || selectedForDelete.length === 0}
                  className="rym-button rym-button--danger-outline">{language === "ko" ? `선택 삭제 (${selectedForDelete.length})` : `Delete Selected (${selectedForDelete.length})`}</button>
                <button type="button" onClick={deleteAll} disabled={busy || snapshots.length === 0}
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
                        <input type="checkbox" disabled={busy} checked={checked} onChange={() => toggleDeleteSelection(key)} />
                        <span className="rym-library-row-content">
                          <strong>{formatChartTitle(snapshot.page_title || "RYM Song Chart")}</strong>
                          <span className="rym-library-date">
                            {formatRymWeekLabel(snapshot.captured_at, language)}
                            <span className="rym-library-week-range"> · {formatRymWeekRange(snapshot.captured_at, language)}</span>
                          </span>
                          <span className="rym-library-source">{snapshot.source_url}</span>
                        </span>
                        <span className="rym-library-song-count">{snapshot.visible_item_count}{snapshot.source_url.includes("/album/") ? (language === "ko" ? "앨범" : " albums") : (language === "ko" ? "곡" : " songs")}</span>
                      </label>
                    );
                  })
              )}
            </div>
          </section>
        )}
        {!loaded && <div className="rym-loading" role="status">{language === "ko" ? "라이브러리 불러오는 중…" : "Loading library…"}</div>}
        {loaded && !loadError && snapshots.length === 0 && (
          <section className="rym-empty">
            <h2>{language === "ko" ? "차트 기록이 없습니다" : "No chart records yet"}</h2>
            <p>{language === "ko" ? "RYM 곡·앨범 차트에서 저장한 JSON 차트 기록을 불러와 곡을 확인하고 순위 변화를 비교할 수 있습니다." : "Import a JSON chart record saved from a RYM song or album chart to view your songs and compare rankings."}</p>
            <button type="button" onClick={openImportWithPassword} disabled={busy}
              className="rym-button rym-button--primary rym-file-button">
              <RymIcon name="upload" /><span>{language === "ko" ? "차트 기록 불러오기" : "Import Record"}</span>
            </button>
          </section>
        )}
        {charts.length > 0 && (
          <>
            <section className="rym-comparison-bar" aria-label={language === "ko" ? "차트 비교 도구" : "Comparison toolbar"}>
              <div className="rym-comparison-head">
                <div className="rym-comparison-description">
                  <strong>{effectiveComparison
                    ? (effectiveComparison.sameChart ? (language === "ko" ? "시간 비교" : "Time comparison") : (language === "ko" ? "차트 비교" : "Chart comparison"))
                    : (language === "ko" ? "차트 기록" : "Chart records")}</strong>
                  <span>{sameChartComparison ? (language === "ko" ? "이전 기록 → 현재 기록" : "Previous record → current record") : (language === "ko" ? "기준 차트 → 대상 차트" : "Reference chart → target chart")}</span>
                </div>
                <div className="rym-search" role="search">
                  <RymIcon name="search" />
                  <input type="search" value={searchQuery}
                    onChange={(event) => setSearchQuery(event.target.value)}
                    placeholder={language === "ko" ? "제목·아티스트·장르 검색" : "Search titles, artists or genres"} aria-label={language === "ko" ? "제목·아티스트·장르 검색" : "Search titles, artists or genres"} />
                  {searchQuery && (
                    <button type="button" onClick={() => setSearchQuery("")} aria-label={language === "ko" ? "검색 지우기" : "Clear search"} title={language === "ko" ? "검색 지우기" : "Clear search"}>
                      <RymIcon name="close" />
                    </button>
                  )}
                </div>
              </div>
              {effectiveComparison && movementCounts && (
                <div className="rym-filterbar" aria-label={language === "ko" ? "순위 변동별 필터" : "Filter by rank movement"}>
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
                  <button type="button" aria-label={language === "ko" ? "상승" : "Up"} className={"rym-filter rym-filter--up" + (movementFilter === "UP" ? " is-active" : "")}
                    aria-pressed={movementFilter === "UP"} onClick={() => setMovementFilter((current) => current === "UP" ? "ALL" : "UP")}>
                    <RymIcon name="up" /><strong>{movementCounts.up}</strong>
                  </button>
                  <button type="button" aria-label={language === "ko" ? "하락" : "Down"} className={"rym-filter rym-filter--down" + (movementFilter === "DOWN" ? " is-active" : "")}
                    aria-pressed={movementFilter === "DOWN"} onClick={() => setMovementFilter((current) => current === "DOWN" ? "ALL" : "DOWN")}>
                    <RymIcon name="down" /><strong>{movementCounts.down}</strong>
                  </button>
                  <button type="button" aria-label={language === "ko" ? "유지" : "Unchanged"} className={"rym-filter rym-filter--same" + (movementFilter === "SAME" ? " is-active" : "")}
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
                loadError={recordErrors[`${leftSnapshot?.file_name}:${leftSnapshot?.file_sha ?? ""}`]} onRetry={() => { void refresh(); }}
                roleLabel={sameChartComparison ? (language === "ko" ? "이전" : "PREVIOUS") : (language === "ko" ? "기준" : "REFERENCE")} language={language}
                activePreviewKey={activePreviewKey} onTogglePreview={togglePreview} />
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
                loadError={recordErrors[`${rightSnapshot?.file_name}:${rightSnapshot?.file_sha ?? ""}`]} onRetry={() => { void refresh(); }}
                comparedSongs={effectiveComparison?.current ?? null} outSongs={effectiveComparison?.out ?? []}
                comparisonActive={Boolean(effectiveComparison)} filter={effectiveComparison ? movementFilter : "ALL"}
                query={deferredQuery} roleLabel={sameChartComparison ? (language === "ko" ? "현재" : "CURRENT") : (language === "ko" ? "대상" : "TARGET")} language={language}
                activePreviewKey={activePreviewKey} onTogglePreview={togglePreview} />
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
          className="rym-scroll-top-button"
          onClick={() => window.scrollTo({ top: 0, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" })}
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
