"use client";
import { useEffect, useRef, useSyncExternalStore, type RefObject } from "react";

function subscribeViewport(callback: () => void) {
  const query = window.matchMedia("(max-width: 1023px)");
  query.addEventListener("change", callback);
  return () => query.removeEventListener("change", callback);
}
export function useSmallViewport() {
  return useSyncExternalStore(subscribeViewport, () => window.matchMedia("(max-width: 1023px)").matches, () => true);
}

// Animate only while settling after a scroll, with no permanent animation loop.
export function useScrollSpring(ref: RefObject<HTMLElement | null>, property: string, desktopOnly = false) {
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    let frame = 0; let y = 0; let velocity = 0; let last = window.scrollY;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    const tick = () => {
      velocity = (velocity - y * 0.15) * 0.73;
      y += velocity;
      element.style.setProperty(property, `${y.toFixed(2)}px`);
      if (Math.abs(y) > 0.05 || Math.abs(velocity) > 0.05) frame = requestAnimationFrame(tick);
      else { frame = 0; y = 0; element.style.setProperty(property, "0px"); }
    };
    const scroll = () => {
      const delta = window.scrollY - last; last = window.scrollY;
      if (reduced.matches || (desktopOnly && window.innerWidth < 1024)) return;
      y = Math.max(-12, Math.min(12, y - delta * 0.25));
      if (!frame) frame = requestAnimationFrame(tick);
    };
    window.addEventListener("scroll", scroll, { passive: true });
    return () => { window.removeEventListener("scroll", scroll); cancelAnimationFrame(frame); element.style.removeProperty(property); };
  }, [ref, property, desktopOnly]);
}

export function useDialogFocus(open: boolean, ref: RefObject<HTMLElement | null>, onClose: () => void, modal = true) {
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; }, [onClose]);
  useEffect(() => {
    if (!open || !ref.current) return;
    const root = ref.current;
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    if (modal) document.body.style.overflow = "hidden";
    const focusables = () => [...root.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), a[href], [tabindex="0"]')].filter((item) => item.getClientRects().length);
    const frame = requestAnimationFrame(() => (root.querySelector<HTMLElement>("input") ?? focusables()[0] ?? root).focus());
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); closeRef.current(); }
      if (event.key !== "Tab") return;
      const items = focusables(); const first = items[0]; const last = items.at(-1);
      if (!first) { event.preventDefault(); root.focus(); return; }
      if (event.shiftKey && (document.activeElement === first || !root.contains(document.activeElement))) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !root.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", keydown);
    return () => { cancelAnimationFrame(frame); document.removeEventListener("keydown", keydown); if (modal) document.body.style.overflow = overflow; if (previous?.isConnected) previous.focus(); };
  }, [open, ref, modal]);
}
