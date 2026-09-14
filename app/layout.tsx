import type { Metadata } from "next";
import "./globals.css";
import "./styles/tracker.css";

export const metadata: Metadata = {
  title: "RYM Tracker · 차트 기록 비교",
  description: "Compare saved Rate Your Music song and album charts, explore ranking changes, and preview music on Spotify.",
  applicationName: "RYM Tracker",
  icons: { icon: "/rym-mark.png" },
  openGraph: {
    title: "RYM Tracker",
    description: "Explore song and album rankings across saved RYM charts.",
    type: "website",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body>{children}</body></html>;
}
