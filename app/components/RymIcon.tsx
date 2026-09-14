type RymIconName =
  | "up" | "down" | "minus" | "star" | "upload"
  | "calendar" | "library" | "left" | "right" | "close" | "search" | "globe";

export default function RymIcon({ name, className = "" }: { name: RymIconName; className?: string }) {
  const solid = name === "up" || name === "down" || name === "star";
  const paths: Record<RymIconName, string> = {
    up: "M12 3 23 21H1Z",
    down: "M1 3h22L12 21Z",
    minus: "M5 12h14",
    star: "m12 2.5 2.95 5.98 6.6.96-4.78 4.66 1.13 6.57L12 17.57l-5.9 3.1 1.13-6.57L2.45 9.44l6.6-.96L12 2.5Z",
    upload: "M12 16V3m-5 5 5-5 5 5M4 15v5a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-5",
    calendar: "M8 2v4m8-4v4M3 9h18M5 4h14a2 2 0 0 1 2 2v14H3V6a2 2 0 0 1 2-2ZM7 13h2m3 0h2m3 0h1M7 17h2m3 0h2",
    library: "M4 4h16v17H4V4Zm4-2v4m8-4v4M8 10h8m-8 4h8m-8 4h5",
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
