"use client";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return <main className="rym-app"><div className="rym-workspace"><section className="rym-empty" role="alert">
    <h1>차트를 표시하지 못했습니다</h1>
    <p>다시 시도해 주세요. / The chart could not be displayed. Please try again.</p>
    <button type="button" className="rym-button rym-button--primary" onClick={reset}>다시 시도 / Retry</button>
  </section></div></main>;
}
