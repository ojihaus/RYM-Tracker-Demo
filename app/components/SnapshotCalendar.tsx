import { useEffect, useMemo, useState } from "react";
import { snapshotKey, weeklySnapshotRepresentatives, rymWeekMeta, rymWeekKey, rymWeekStart, formatRymWeekLabel, formatRymWeekRange, type Snapshot, type Language } from "../lib/chartModel";
import RymIcon from "./RymIcon";

type SnapshotCalendarProps = {
  snapshots: Snapshot[];
  selectedKey: string;
  onSelect: (value: string) => void;
  compact?: boolean;
  language?: Language;
};

export default function SnapshotCalendar({
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

  const earliestMeta = useMemo(() => earliestSnapshot ? rymWeekMeta(earliestSnapshot.captured_at) : null, [earliestSnapshot]);

  const [monthCursor, setMonthCursor] = useState(
    () => new Date(selectedMeta.year, selectedMeta.month, 1)
  );

  const selectedCapturedAt = selectedSnapshot?.captured_at;
  useEffect(() => {
    if (!selectedCapturedAt) return;

    const nextMeta = rymWeekMeta(selectedCapturedAt);
    setMonthCursor(
      new Date(nextMeta.year, nextMeta.month, 1)
    );
  }, [selectedCapturedAt]);

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

  const latestMeta = rymWeekMeta(weeklySnapshotRepresentatives(snapshots).at(-1)?.captured_at ?? new Date());
  const canMoveToNextMonth = year * 12 + month < latestMeta.year * 12 + latestMeta.month;

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
        <button type="button" disabled={!canMoveToNextMonth} onClick={() => moveMonth(1)} className="rym-icon-button" aria-label={language === "ko" ? "다음 달" : "Next month"}>
          <RymIcon name="right" />
        </button>
      </div>

      <div className="rym-calendar-weeks" role="group" aria-label={language === "ko" ? "주차 선택" : "Choose week"}>
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
