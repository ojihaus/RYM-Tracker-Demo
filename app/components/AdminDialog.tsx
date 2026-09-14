import { useRef, useState } from "react";
import { ApiError, errorMessage, requestJson } from "../lib/chartClient";
import { type Language } from "../lib/chartModel";
import { useDialogFocus } from "../hooks/useBrowserUI";
import RymIcon from "./RymIcon";

export type AdminAction = "IMPORT" | "LIBRARY" | "CHANGE";

export default function AdminDialog({ action, language, onClose, onSuccess }: {
  action: AdminAction; language: Language; onClose: () => void; onSuccess: (action: AdminAction) => void;
}) {
  const [pin, setPin] = useState("");
  const [newPin, setNewPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const inFlight = useRef(false);
  const ref = useRef<HTMLElement>(null);
  const changing = action === "CHANGE";
  const close = () => { if (!inFlight.current) onClose(); };
  useDialogFocus(true, ref, close);
  const text = (ko: string, en: string) => language === "ko" ? ko : en;
  const digits = (value: string) => value.replace(/\D/g, "").slice(0, 4);
  async function submit() {
    if (inFlight.current) return;
    if (!/^\d{4}$/.test(pin) || (changing && !/^\d{4}$/.test(newPin))) { setError(text("4자리 숫자를 입력해 주세요.", "Enter four digits.")); return; }
    if (changing && newPin !== confirmPin) { setError(text("새 비밀번호가 서로 일치하지 않습니다.", "The new PINs do not match.")); return; }
    inFlight.current = true; setBusy(true); setError("");
    try {
      await requestJson("/api/admin-auth", { method: changing ? "PUT" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(changing ? { currentPassword: pin, newPassword: newPin } : { password: pin }) });
      setPin(""); setNewPin(""); setConfirmPin("");
      onSuccess(action);
    } catch (error) {
      setError(errorMessage(error, language));
      if (error instanceof ApiError && error.code === "INCORRECT_PIN") setPin("");
    } finally { inFlight.current = false; setBusy(false); }
  }
  return <div className="rym-admin-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}>
    <section ref={ref} className={"rym-admin-modal" + (changing ? " rym-pin-change-modal" : "")} role="dialog" aria-modal="true" aria-labelledby="rym-admin-title" tabIndex={-1}>
      <button type="button" className="rym-admin-close" onClick={close} disabled={busy} aria-label={text("닫기", "Close")}><RymIcon name="close" /></button>
      <h2 id="rym-admin-title">{changing ? text("관리자 비밀번호 변경", "Change administrator PIN") : text("관리자 전용 기능입니다.", "Administrator access")}</h2>
      <p>{changing ? text("현재 비밀번호와 새 4자리 비밀번호를 입력해 주세요.", "Enter the current PIN and a new four-digit PIN.") : text("4자리 비밀번호를 입력해 주세요.", "Enter the four-digit administrator PIN.")}</p>
      <form className={changing ? "rym-pin-change-form" : undefined} onSubmit={(event) => { event.preventDefault(); void submit(); }}>
        {changing ? <>
          <label><span>{text("현재 비밀번호", "Current PIN")}</span><input type="password" inputMode="numeric" maxLength={4} autoComplete="current-password" value={pin} onChange={(event) => setPin(digits(event.target.value))} disabled={busy} /></label>
          <label><span>{text("새 비밀번호", "New PIN")}</span><input type="password" inputMode="numeric" maxLength={4} autoComplete="new-password" value={newPin} onChange={(event) => setNewPin(digits(event.target.value))} disabled={busy} /></label>
          <label><span>{text("새 비밀번호 확인", "Confirm new PIN")}</span><input type="password" inputMode="numeric" maxLength={4} autoComplete="new-password" value={confirmPin} onChange={(event) => setConfirmPin(digits(event.target.value))} disabled={busy} /></label>
        </> : <>
          <input className="rym-admin-pin" type="password" inputMode="numeric" maxLength={4} autoComplete="current-password" value={pin} onChange={(event) => { setPin(digits(event.target.value)); setError(""); }} disabled={busy} aria-label={text("4자리 관리자 비밀번호", "Four-digit administrator PIN")} aria-invalid={Boolean(error)} aria-describedby="rym-admin-error" />
          <div className="rym-admin-dots" aria-hidden="true">{[0, 1, 2, 3].map((index) => <span key={index} className={index < pin.length ? "is-filled" : ""} />)}</div>
        </>}
        <div id="rym-admin-error" className="rym-admin-error" role="alert">{error}</div>
        <button type="submit" className="rym-admin-submit" disabled={busy || pin.length !== 4 || (changing && (newPin.length !== 4 || confirmPin.length !== 4))}>{busy ? text("확인 중…", "Checking…") : changing ? text("비밀번호 변경", "Change PIN") : text("확인", "Continue")}</button>
      </form>
    </section>
  </div>;
}
