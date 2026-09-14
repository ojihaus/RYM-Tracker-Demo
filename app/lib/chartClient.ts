import { sanitizeSnapshot, sanitizeSnapshotList, type Snapshot } from "./chartModel";

export class ApiError extends Error {
  constructor(public code: string, message: string) { super(message); }
}

export async function requestJson<T>(url: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, { ...init, cache: "no-store", credentials: "same-origin", signal: init.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(45000)]) : AbortSignal.timeout(45000), headers: { Accept: "application/json", ...init.headers } });
  } catch (error) {
    if (init.signal?.aborted) throw error;
    throw new ApiError("NETWORK", "The connection failed. Please try again.");
  }
  const result = await response.json().catch(() => null);
  if (!response.ok || !result) throw new ApiError(result?.code || "UNAVAILABLE", result?.error || "The request could not be completed.");
  return result as T;
}

export async function fetchSnapshotIndex(signal?: AbortSignal) {
  const result = await requestJson<{ snapshots: unknown; failedFiles?: string[] }>("/api/chart-files?mode=index", { signal });
  if (!Array.isArray(result.snapshots)) throw new ApiError("INVALID_RECORD", "The chart library response is invalid.");
  const snapshots = sanitizeSnapshotList(result.snapshots);
  if (snapshots.length !== result.snapshots.length) throw new ApiError("INVALID_RECORD", "Some chart records could not be read.");
  return { snapshots, failedFiles: result.failedFiles ?? [] };
}

export async function fetchSnapshotFile(filename: string): Promise<Snapshot> {
  const result = await requestJson<{ snapshot: unknown }>(`/api/chart-files?file=${encodeURIComponent(filename)}`);
  const snapshot = sanitizeSnapshot(result.snapshot);
  if (!snapshot || snapshot.is_metadata) throw new ApiError("INVALID_RECORD", "The chart record response is invalid.");
  return { ...snapshot, file_name: filename, is_metadata: false };
}

export function errorMessage(error: unknown, language: "en" | "ko") {
  if (language === "en") return error instanceof Error ? error.message : "Please try again.";
  const messages: Record<string, string> = {
    NETWORK: "연결이 원활하지 않습니다. 잠시 후 다시 시도해 주세요.",
    AUTH_REQUIRED: "관리자 인증이 만료되었습니다. 다시 로그인해 주세요.",
    INCORRECT_PIN: "비밀번호가 올바르지 않습니다.",
    AUTH_RATE_LIMITED: "입력 횟수를 초과했습니다. 잠시 후 다시 시도해 주세요.",
    CONFLICT: "다른 곳에서 기록이 변경되었습니다. 새로고침한 뒤 다시 시도해 주세요.",
    INVALID_RECORD: "유효한 RYM 곡·앨범 차트 JSON인지 확인해 주세요. 순위나 곡이 중복된 기록은 불러올 수 없습니다.",
    TOO_LARGE: "2MB 이하의 JSON 파일을 선택해 주세요.",
    NOT_FOUND: "이 기록은 삭제되었습니다. 라이브러리를 새로고침해 주세요.",
    NOT_CONFIGURED: "차트 저장소 설정을 확인해 주세요.",
    INVALID_JSON: "JSON 파일을 읽을 수 없습니다. 파일 내용을 확인해 주세요.",
    RATE_LIMITED: "차트 저장소 요청이 많습니다. 잠시 후 다시 시도해 주세요.",
  };
  return error instanceof ApiError ? messages[error.code] ?? "요청을 완료하지 못했습니다. 잠시 후 다시 시도해 주세요." : error instanceof Error ? error.message : "잠시 후 다시 시도해 주세요.";
}
