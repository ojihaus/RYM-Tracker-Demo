require("./helpers/setup.cjs");
const { test, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const { fixture, sample, reply, sha } = require("./helpers/fixture.cjs");
const route = require("../app/api/chart-files/route.ts");
const auth = require("../app/api/admin-auth/route.ts");
let f; let cookie; let requestId = 0;
const originalFetch = global.fetch;
beforeEach(() => { f = fixture(); f.install(); global.fetch = f.fetch; cookie = ""; });
afterEach(() => { global.fetch = originalFetch; });
const request = (method, body, headers = {}) => new Request("http://localhost/api/chart-files", { method, headers: { "Content-Type": "application/json", "x-forwarded-for": `test-${++requestId}`, ...(cookie ? { Cookie: cookie } : {}), ...headers }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
async function login(pin = "1234") { const response = await auth.POST(request("POST", { password: pin })); assert.equal(response.status, 200); cookie = response.headers.get("set-cookie").split(";")[0]; return response; }
const getIndex = () => route.GET(new Request("http://localhost/api/chart-files"));

test("warm index reuses immutable metadata, observes overwrites, and never caches directory listings", async () => {
  const first = await getIndex(); assert.equal(first.status, 200); assert.match(first.headers.get("cache-control"), /no-store/);
  assert.equal((await first.json()).snapshots.length, 2);
  f.calls.length = 0;
  assert.equal((await getIndex()).status, 200); assert.equal(f.calls.length, 1);
  f.put("public/2020s-0909.json", { ...sample(), captured_at: "2026-09-09T23:00:00Z" });
  const updated = await (await getIndex()).json();
  assert.ok(updated.snapshots.some((item) => item.captured_at === "2026-09-09T23:00:00.000Z"));
  assert.ok(f.calls.every((call) => call.cache === "no-store"));
  assert.doesNotMatch(JSON.stringify(updated), /fixture-token|Authorization|admin\/pin/);
});
test("corrupt files are explicitly reported without hiding healthy records", async () => {
  f.put("public/2020s-0909.json", "{");
  const data = await (await getIndex()).json();
  assert.equal(data.snapshots.length, 1); assert.deepEqual(data.failedFiles, ["2020s-0909.json"]);
});
test("GitHub failures are errors rather than an empty library", async () => {
  f.failure = () => reply({ secret: "do-not-expose" }, 403, { "x-ratelimit-remaining": "0" });
  const response = await getIndex(); assert.equal(response.status, 503);
  assert.doesNotMatch(JSON.stringify(await response.json()), /do-not-expose|snapshots/);
});
test("login produces an HttpOnly session; raw PINs cannot bypass session checks", async () => {
  const response = await login(); assert.match(response.headers.get("set-cookie"), /HttpOnly/); assert.match(response.headers.get("set-cookie"), /SameSite=strict/);
  cookie = "";
  assert.equal((await route.POST(request("POST", { password: "1234", snapshot: sample("2026-09-16") }))).status, 401);
  assert.ok(!f.files.has("public/song-2020s-2026-09-16.json"));
});
test("upload returns the committed record and preserves legacy same-day filenames", async () => {
  await login();
  const next = await route.POST(request("POST", { snapshot: sample("2026-09-16") })); assert.equal(next.status, 200);
  const data = await next.json(); assert.equal(data.filename, "song-2020s-2026-09-16.json"); assert.ok(data.snapshot.file_sha);
  const updated = await route.POST(request("POST", { snapshot: { ...sample(), captured_at: "2026-09-09T23:59:00Z" } }));
  assert.equal((await updated.json()).filename, "2020s-0909.json");
  assert.ok(!f.files.has("public/song-2020s-2026-09-09.json"));
});
test("next-year imports cannot overwrite this year's legacy record", async () => {
  await login(); const original = f.files.get("public/2020s-0909.json");
  const response = await route.POST(request("POST", { snapshot: sample("2027-09-09") })); assert.equal(response.status, 200);
  assert.equal(f.files.get("public/2020s-0909.json"), original); assert.ok(f.files.has("public/song-2020s-2027-09-09.json"));
});
test("delete rejects changed revisions, is idempotent, and propagates an empty library", async () => {
  await login();
  assert.equal((await route.DELETE(request("DELETE", { filename: "2020s-0909.json", sha: "outdated" }))).status, 409);
  for (const name of ["2020s-0909.json", "2020s-0902.json"]) {
    assert.equal((await route.DELETE(request("DELETE", { filename: name, sha: sha(f.files.get("public/" + name)) }))).status, 200);
    assert.equal((await route.DELETE(request("DELETE", { filename: name }))).status, 200);
  }
  assert.deepEqual((await (await getIndex()).json()).snapshots, []);
});
test("cross-origin, oversized, malformed and path traversal requests never write", async () => {
  await login(); f.calls.length = 0;
  assert.equal((await route.POST(request("POST", { snapshot: sample() }, { Origin: "https://evil.test" }))).status, 403);
  assert.equal((await route.POST(request("POST", { snapshot: sample() }, { "Content-Length": "99999999" }))).status, 413);
  assert.equal((await route.DELETE(request("DELETE", { filename: "../admin/pin.json" }))).status, 400);
  const bad = new Request("http://localhost/api/chart-files", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{" });
  assert.equal((await route.POST(bad)).status, 400);
  assert.ok(f.calls.every((call) => call.method === "GET"));
});
test("conflicting uploads never return a false success", async () => {
  await login(); f.failure = (path, method) => method === "PUT" ? reply({}, 409) : null;
  assert.equal((await route.POST(request("POST", { snapshot: sample("2026-09-16") }))).status, 409);
});
test("PIN changes persist a peppered hash and revoke previously issued sessions", async () => {
  await login(); const oldCookie = cookie;
  const response = await auth.PUT(request("PUT", { currentPassword: "1234", newPassword: "5678" })); assert.equal(response.status, 200);
  assert.equal(JSON.parse(f.files.get("admin/pin.json")).version, 3);
  cookie = oldCookie;
  assert.equal((await route.DELETE(request("DELETE", { filename: "2020s-0909.json" }))).status, 401);
  await login("5678"); assert.equal((await route.POST(request("POST", { snapshot: sample("2026-09-16") }))).status, 200);
});
test("missing PIN storage never enables the old hard-coded default", async () => {
  f.files.delete("admin/pin.json");
  assert.equal((await auth.POST(request("POST", { password: "1234" }))).status, 401);
});
test("repeated PIN attempts are limited and report retry time", async () => {
  for (let i = 0; i < 8; i++) assert.equal((await auth.POST(request("POST", { password: "0000" }, { "x-forwarded-for": "rate-test" }))).status, 401);
  const response = await auth.POST(request("POST", { password: "1234" }, { "x-forwarded-for": "rate-test" }));
  assert.equal(response.status, 429); assert.ok(Number(response.headers.get("retry-after")) > 0);
});
test("failed PIN storage is not described as an incorrect password", async () => {
  f.failure = (path) => path.endsWith("admin/pin.json") ? reply({}, 500) : null;
  const response = await auth.POST(request("POST", { password: "1234" }));
  assert.equal(response.status, 502); assert.equal((await response.json()).code, "STORAGE_ERROR");
});
