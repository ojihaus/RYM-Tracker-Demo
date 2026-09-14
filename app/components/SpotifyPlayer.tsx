import { useEffect, useRef, useState } from "react";
import { spotifyEmbedUrl, type Language } from "../lib/chartModel";

type Controller = { play: () => void; pause: () => void; destroy: () => void; addListener: (name: string, callback: () => void) => void };
type IFrameAPI = { createController: (element: HTMLElement, options: { url: string; width: string; height: number }, callback: (controller: Controller) => void) => void };
type SpotifyWindow = Window & { onSpotifyIframeApiReady?: (api: IFrameAPI) => void };
let apiPromise: Promise<IFrameAPI> | undefined;

function loadApi() {
  if (!apiPromise) {
    apiPromise = new Promise<IFrameAPI>((resolve, reject) => {
      const script = document.createElement("script");
      const spotifyWindow = window as SpotifyWindow;
      const previous = spotifyWindow.onSpotifyIframeApiReady;
      const timer = window.setTimeout(() => { script.remove(); reject(new Error("Spotify timed out")); }, 10000);
      spotifyWindow.onSpotifyIframeApiReady = (api) => {
        window.clearTimeout(timer);
        resolve(api);
        try { previous?.(api); } catch { /* Other embed consumers are independent. */ }
      };
      script.src = "https://open.spotify.com/embed/iframe-api/v1";
      script.async = true;
      script.onerror = () => { window.clearTimeout(timer); script.remove(); reject(new Error("Spotify unavailable")); };
      document.body.appendChild(script);
    }).catch((error) => { apiPromise = undefined; throw error; });
  }
  return apiPromise;
}

export default function SpotifyPlayer({ url, title, language }: { url: string; title: string; language: Language }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [fallback, setFallback] = useState(false);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let cancelled = false;
    let controller: Controller | undefined;
    const host = hostRef.current;
    if (!host) return;
    setFallback(false); setReady(false);
    const destroy = () => { try { controller?.destroy(); } catch { /* The iframe may already be gone. */ } };
    const timeout = window.setTimeout(() => {
      if (cancelled) return;
      // A late controller must not start playing behind the fallback iframe.
      cancelled = true; destroy(); setFallback(true);
    }, 15000);
    const mount = document.createElement("div");
    host.replaceChildren(mount);
    loadApi().then((api) => {
      if (cancelled || !mount.isConnected) return;
      api.createController(mount, { url, width: "100%", height: 152 }, (created) => {
        if (cancelled) { created.destroy(); return; }
        controller = created;
        const iframe = host.querySelector("iframe");
        if (iframe) iframe.title = `Spotify: ${title}`;
        created.addListener("ready", () => {
          if (cancelled) return;
          window.clearTimeout(timeout); setReady(true);
          try { created.play(); } catch { /* The embed retains its manual play button. */ }
        });
      });
    }).catch(() => { if (!cancelled) { window.clearTimeout(timeout); setFallback(true); } });
    return () => {
      cancelled = true; window.clearTimeout(timeout);
      destroy();
      host.replaceChildren();
    };
  }, [url, title]);
  return <div className="rym-spotify-player">
    {!ready && !fallback && <span className="rym-player-loading" role="status">{language === "ko" ? "미리듣기 불러오는 중…" : "Loading preview…"}</span>}
    <div ref={hostRef} className="rym-spotify-controller" hidden={fallback} role="group" aria-label={`Spotify: ${title}`} />
    {fallback && <iframe src={spotifyEmbedUrl(url)} width="100%" height="152" title={`Spotify: ${title}`} allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture" />}
  </div>;
}
