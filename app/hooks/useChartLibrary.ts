"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, fetchSnapshotFile, fetchSnapshotIndex } from "../lib/chartClient";
import { snapshotKey, type Snapshot } from "../lib/chartModel";

export function useChartLibrary() {
  const [snapshots, setRecords] = useState<Snapshot[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [recordErrors, setRecordErrors] = useState<Record<string, unknown>>({});
  const [failedFiles, setFailedFiles] = useState<string[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const generation = useRef(0);
  const indexController = useRef<AbortController | null>(null);
  const pending = useRef(new Map<string, Promise<void>>());

  const invalidate = useCallback(() => {
    generation.current++;
    indexController.current?.abort();
    setRefreshing(false);
  }, []);

  const refresh = useCallback(async () => {
    indexController.current?.abort();
    const controller = new AbortController();
    indexController.current = controller;
    const version = ++generation.current;
    setRefreshing(true);
    try {
      const result = await fetchSnapshotIndex(controller.signal);
      if (version !== generation.current) return;
      setRecords((current) => result.snapshots.map((record) => {
        const previous = current.find((item) => item.file_name === record.file_name && item.file_sha === record.file_sha && snapshotKey(item) === snapshotKey(record));
        return previous && !previous.is_metadata ? previous : record;
      }));
      setFailedFiles(result.failedFiles);
      setRecordErrors({});
      setLoadError(null);
    } catch (error) {
      if (version === generation.current && !controller.signal.aborted) setLoadError(error);
    } finally {
      if (version === generation.current) { setLoaded(true); setRefreshing(false); }
    }
  }, []);

  const ensureLoaded = useCallback((target: Snapshot | null) => {
    if (!target?.is_metadata || !target.file_name) return Promise.resolve();
    const key = `${target.file_name}:${target.file_sha ?? ""}`;
    if (pending.current.has(key)) return pending.current.get(key)!;
    const task = fetchSnapshotFile(target.file_name).then((full) => {
      if (full.file_sha !== target.file_sha || snapshotKey(full) !== snapshotKey(target)) throw new ApiError("CONFLICT", "This record was updated. Refresh the library.");
      setRecords((current) => current.map((item) => item.file_name === target.file_name && item.file_sha === target.file_sha ? full : item));
      setRecordErrors((current) => { const next = { ...current }; delete next[key]; return next; });
    }).catch((error: unknown) => {
      setRecordErrors((current) => ({ ...current, [key]: error }));
    }).finally(() => pending.current.delete(key));
    pending.current.set(key, task);
    return task;
  }, []);

  useEffect(() => {
    const generationRef = generation;
    const controllerRef = indexController;
    void refresh();
    return () => { generationRef.current++; controllerRef.current?.abort(); };
  }, [refresh]);

  return { snapshots, setRecords, loaded, loadError, recordErrors, failedFiles, refreshing, refresh, invalidate, ensureLoaded };
}
