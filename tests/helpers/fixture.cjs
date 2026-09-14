const { createHash, scryptSync } = require("node:crypto");
const sha = (text) => createHash("sha1").update(text).digest("hex");
const reply = (data, status = 200, headers = {}) => Response.json(data, { status, headers });
const song = (title, rank) => ({ rank, title, artists: ["Fixture Artist"], average_rating: "4.30", number_of_ratings: "/\n 8k", primary_genres: ["Art Pop"], rym_url: `https://rateyourmusic.com/song/fixture/${title.toLowerCase()}/`, spotify_url: "https://open.spotify.com/track/3k2kIiJqUiIP49iUcOLpWT" });
const sample = (date = "2026-09-09", period = "2020s") => ({ captured_at: `${date}T12:00:00.000Z`, source_url: `https://rateyourmusic.com/charts/top/song/${period}/`, page_title: `Best songs of the ${period}`, visible_item_count: 4, songs: ["Alpha", "Beta", "New", "Same"].map((title, i) => song(title, i + 1)) });
let fixtureCount = 0;
function fixture() {
  const repo = `test-${++fixtureCount}`;
  const files = new Map(); const blobs = new Map(); const calls = [];
  const put = (path, data) => { const text = typeof data === "string" ? data : JSON.stringify(data); files.set(path, text); blobs.set(sha(text), text); };
  const salt = "a".repeat(32);
  put("admin/pin.json", { version: 2, salt, hash: scryptSync("1234", salt, 32).toString("hex") });
  put("public/2020s-0909.json", sample());
  put("public/2020s-0902.json", { ...sample("2026-09-02"), songs: ["Beta", "Alpha", "Gone", "Same"].map((title, i) => song(title, i + 1)) });
  const f = { files, blobs, calls, put, failure: null,
    install() { Object.assign(process.env, { RYM_GITHUB_TOKEN: "fixture-token-not-real", GITHUB_OWNER: "fixture-owner", GITHUB_REPO: repo, GITHUB_BRANCH: "main" }); delete process.env.ADMIN_PASSWORD; delete process.env.ADMIN_PIN_PEPPER; delete process.env.ADMIN_SESSION_SECRET; },
    async fetch(input, options = {}) {
      const url = new URL(String(input)); const method = options.method || "GET";
      const prefix = `/repos/fixture-owner/${repo}`;
      if (url.origin !== "https://api.github.com" || !url.pathname.startsWith(prefix)) throw new Error("Unexpected test network request");
      const path = decodeURIComponent(url.pathname.slice(prefix.length));
      const body = options.body ? JSON.parse(options.body) : null;
      calls.push({ path, method, cache: options.cache });
      const failure = f.failure?.(path, method); if (failure) return failure;
      if (path.startsWith("/git/blobs/")) {
        const text = blobs.get(path.slice(11));
        return text === undefined ? reply({}, 404) : reply({ content: Buffer.from(text).toString("base64"), encoding: "base64" });
      }
      if (!path.startsWith("/contents/")) return reply({}, 404);
      const name = path.slice(10);
      if (name === "public" && method === "GET") return reply([...files].filter(([key]) => key.startsWith("public/")).map(([key, text]) => ({ name: key.slice(7), type: "file", sha: sha(text), size: Buffer.byteLength(text) })));
      const current = files.get(name);
      if (method === "GET") return current === undefined ? reply({}, 404) : reply({ sha: sha(current), encoding: "base64", content: Buffer.from(current).toString("base64") });
      if (body.branch !== "main" || (current !== undefined ? body.sha !== sha(current) : Boolean(body.sha))) return reply({}, 409);
      if (method === "PUT") { put(name, Buffer.from(body.content, "base64").toString("utf8")); return reply({ content: { sha: sha(files.get(name)) } }, 201); }
      if (method === "DELETE") { files.delete(name); return reply({}); }
      throw new Error("Unhandled test request");
    },
  };
  return f;
}
module.exports = { fixture, sample, song, reply, sha };
