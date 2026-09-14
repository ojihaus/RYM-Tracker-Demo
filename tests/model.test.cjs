require("./helpers/setup.cjs");
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync, readdirSync } = require("node:fs");
const m = require("../app/lib/chartModel.ts");
const { sample } = require("./helpers/fixture.cjs");

test("all existing production chart formats remain readable", () => {
  for (const file of readdirSync("public").filter((name) => name.endsWith(".json"))) {
    const raw = JSON.parse(readFileSync(`public/${file}`, "utf8"));
    const chart = m.sanitizeSnapshot(raw);
    assert.ok(chart, file); assert.equal(chart.songs.length, raw.songs.length, file);
  }
});
test("invalid dates, fractional/duplicate ranks, duplicate songs and empty imports are rejected", () => {
  for (const bad of [ { ...sample(), captured_at: "2026-02-30T12:00:00Z" }, { ...sample(), songs: [] }, { ...sample(), songs: [{...sample().songs[0],rank:1.5}] }, { ...sample(), songs: [sample().songs[0],sample().songs[0]] } ]) assert.equal(m.sanitizeSnapshot(bad), null);
});
test("metadata keeps item counts while full records sort ranks and normalize counts", () => {
  const chart = m.sanitizeSnapshot({ ...sample(), songs: [...sample().songs].reverse() });
  assert.equal(chart.songs[0].rank, 1); assert.equal(m.formatRatingCount(chart.songs[0].number_of_ratings), "8K");
  assert.equal(m.sanitizeSnapshot({ ...sample(), songs: [], is_metadata: true, visible_item_count: 100 }).visible_item_count, 100);
});
test("chart identity trusts the URL and filenames distinguish capture years", () => {
  const chart = { ...sample(), page_title: "Best albums of 1900" };
  assert.equal(m.snapshotPublicFilename(chart), "song-2020s-2026-09-09.json");
  assert.equal(m.snapshotPublicFilename(sample("2027-09-09")), "song-2020s-2027-09-09.json");
  assert.equal(m.legacyPublicFilename(chart), "2020s-0909.json");
  assert.equal(m.canonicalChartUrl("https://evil.test/charts/top/song/2020s/"), undefined);
  assert.equal(m.canonicalChartUrl("https://rateyourmusic.com/charts/top/song/2020s/?genres=rock"), undefined);
});
test("unsafe links are removed, Spotify albums and international track URLs work", () => {
  const chart = sample(); chart.songs[0].rym_url = "javascript:alert(1)";
  assert.equal(m.sanitizeSnapshot(chart).songs[0].rym_url, undefined);
  assert.match(m.spotifyEmbedUrl("https://open.spotify.com/album/21xp7NdU1ajmO1CX0w2Egd"), /embed\/album/);
  assert.match(m.spotifyEmbedUrl("https://open.spotify.com/intl-ko/track/3k2kIiJqUiIP49iUcOLpWT"), /embed\/track/);
  assert.equal(m.spotifyEmbedUrl("https://evil.test/open.spotify.com/track/3k2kIiJqUiIP49iUcOLpWT"), "");
});
test("week boundaries use UTC and cross-year dates map to the same week", () => {
  assert.equal(m.rymWeekKey("2027-01-01T00:00:00Z"), "2026-12-28");
  const records = [sample("2026-09-02"),sample("2026-09-09"),sample("2026-09-12")];
  assert.equal(m.weeklySnapshotRepresentatives(records).length, 2);
  assert.equal(m.previousWeeklySnapshot(records, records[2]).captured_at, records[0].captured_at);
});
