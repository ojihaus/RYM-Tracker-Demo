const assert = require("node:assert/strict");
const { chromium } = require("playwright");
const http = require("node:http");
const { readFileSync, readdirSync, mkdirSync } = require("node:fs");
const { createHash } = require("node:crypto");
let base = process.env.TEST_BASE_URL;
const output = process.env.TEST_ARTIFACTS || "/tmp/rym-review-browser";
mkdirSync(output, { recursive: true });
const initial = readdirSync("public").filter((name) => name.endsWith(".json")).map((name) => {
  const data = JSON.parse(readFileSync(`public/${name}`, "utf8"));
  return { ...data, file_name: name, file_sha: createHash("sha1").update(JSON.stringify(data)).digest("hex"), is_metadata: false };
});

(async () => {
  let stopServer = async () => {};
  if (!base) {
    const app = require("next")({ dev: false });
    await app.prepare();
    const server = http.createServer(app.getRequestHandler());
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${server.address().port}`;
    stopServer = async () => { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); await app.close(); };
  }
  const reports = [];
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 834, height: 1112 }, { width: 390, height: 844 }, { width: 320, height: 800 }]) {
    const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE_PATH,
      args: process.env.CHROMIUM_EXECUTABLE_PATH ? ["--no-sandbox", "--no-zygote", "--disable-dev-shm-usage", "--single-process", "--disable-gpu", "--in-process-gpu"] : [] });
    const context = await browser.newContext({ viewport, reducedMotion: "reduce" });
    const page = await context.newPage();
    const errors = []; let records = structuredClone(initial); let failRecord = viewport.width === 1440 ? "2020s-0909.json" : "";
    let indexFailure = viewport.width === 1440; let uploads = 0; let deletes = 0;
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/api/chart-files**", async (route) => {
      const request = route.request(); const url = new URL(request.url()); const file = url.searchParams.get("file");
      if (request.method() === "POST") {
        uploads++; const data = request.postDataJSON().snapshot;
        const saved = { ...data, file_name: "song-2020s-2026-09-16.json", file_sha: "uploaded-version", is_metadata: false };
        records = [...records.filter((item) => item.file_name !== saved.file_name), saved];
        return route.fulfill({ json: { ok: true, filename: saved.file_name, snapshot: saved } });
      }
      if (request.method() === "DELETE") {
        deletes++; const filename = request.postDataJSON().filename;
        records = records.filter((item) => item.file_name !== filename);
        return route.fulfill({ json: { ok: true, filename } });
      }
      if (indexFailure && !file) return route.fulfill({ status: 503, json: { code: "UNAVAILABLE", error: "The library is temporarily unavailable." } });
      if (file) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        if (file === failRecord) return route.fulfill({ status: 502, json: { code: "STORAGE_ERROR", error: "This record is temporarily unavailable." } });
        const snapshot = records.find((item) => item.file_name === file);
        return route.fulfill(snapshot ? { json: { snapshot } } : { status: 404, json: { code: "NOT_FOUND" } });
      }
      return route.fulfill({ json: { snapshots: records.map((item) => ({ ...item, songs: [], is_metadata: true })), failedFiles: [] } });
    });
    await page.route("**/api/admin-auth", (route) => route.fulfill({ json: { ok: true } }));
    // The API contract is tested separately; stub Spotify to verify its DOM
    // ownership, ready event, album URLs and one-player-at-a-time lifecycle.
    await page.route("https://open.spotify.com/embed/iframe-api/v1", (route) => route.fulfill({ contentType: "text/javascript", body: `window.onSpotifyIframeApiReady({createController(node, options, callback) { const iframe = document.createElement('iframe'); iframe.src = options.url.replace('open.spotify.com/','open.spotify.com/embed/'); iframe.height=152; iframe.width='100%'; node.replaceWith(iframe); callback({play(){},pause(){},destroy(){iframe.remove()},addListener(name,fn){if(name==='ready')setTimeout(fn,0)}}); }});` }));
    await page.route(/https:\/\/open\.spotify\.com\/embed\/(track|album)\//, (route) => route.fulfill({ contentType: "text/html", body: '<html><body style="background:#1d2634;color:white;font:14px sans-serif">Spotify preview fixture</body></html>' }));
    await page.goto(base + "?lang=ko", { waitUntil: "domcontentloaded" });
    if (indexFailure) {
      await page.locator(".rym-error[role=alert]").waitFor();
      indexFailure = false;
      await page.getByRole("button", { name: "다시 불러오기" }).click();
      await page.locator("#rym-main-chart .rym-record-state button").waitFor();
      failRecord = "";
      await page.locator("#rym-main-chart .rym-record-state button").click();
    }
    await page.locator("#rym-main-chart .rym-song").first().waitFor();
    assert.equal(await page.locator("#rym-main-chart .rym-song:not(.rym-song--out)").count(), 100);
    assert.equal(await page.locator("html").getAttribute("lang"), "ko");
    const reference = page.locator("#rym-reference-chart .rym-pane-heading--toggle");
    assert.equal(await reference.getAttribute("aria-expanded"), viewport.width > 1023 ? "true" : "false");
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "No horizontal overflow");
    await page.screenshot({ path: `${output}/${viewport.width}-initial.png`, fullPage: false });
    const search = page.getByRole("searchbox");
    await search.fill("Radiohead");
    await page.waitForFunction(() => [...document.querySelectorAll('#rym-main-chart .rym-song')].every((item) => item.textContent.toLowerCase().includes('radiohead')));
    await search.fill("impossible-no-match-string");
    await page.getByText("이 조건에 맞는 항목이 없습니다.").waitFor();
    await search.fill("");
    await page.locator("#rym-main-chart .rym-song").first().waitFor();
    await page.locator("#rym-main-chart .rym-preview-button").first().click();
    await page.locator("#rym-main-chart iframe").waitFor();
    assert.equal(await page.locator("#rym-main-chart iframe").count(), 1);
    await page.screenshot({ path: `${output}/${viewport.width}-player.png`, fullPage: false });
    await search.fill("Radiohead");
    await page.waitForFunction(() => document.querySelectorAll('#rym-main-chart iframe').length === 0);
    await search.fill("");
    const pickerButton = page.locator("#rym-chart-picker-RIGHT");
    await pickerButton.click();
    const picker = page.getByRole("dialog", { name: "차트와 주차 선택" }); await picker.waitFor();
    const rect = await picker.boundingBox();
    assert.ok(rect.x >= 0 && rect.y >= 0 && rect.x + rect.width <= viewport.width + 1 && rect.y + rect.height <= viewport.height + 1, "Picker fits viewport");
    await picker.getByRole("button", { name: "1980s", exact: true }).click();
    await page.keyboard.press("Escape");
    await search.fill("There Is a Light That Never Goes Out");
    await page.waitForFunction(() => document.querySelectorAll('#rym-main-chart .rym-song').length === 2);
    // These two real source records share a Spotify URL. Only the clicked
    // chart entry may own a player, even when another entry has that URL.
    await page.locator("#rym-main-chart .rym-preview-button").first().click();
    await page.locator("#rym-main-chart iframe").waitFor();
    assert.equal(await page.locator("#rym-main-chart .rym-song--playing").count(), 1);
    await page.locator("#rym-main-chart .rym-preview-button").last().click();
    await page.locator("#rym-main-chart iframe").waitFor();
    assert.equal(await page.locator("#rym-main-chart iframe").count(), 1);
    await search.fill("");
    await pickerButton.click();
    await picker.getByRole("button", { name: "앨범", exact: true }).click();
    await picker.getByRole("button", { name: "2026", exact: true }).click();
    await page.keyboard.press("Escape");
    await page.locator('#rym-main-chart .rym-song-title').filter({ hasText: 'Who Loves the Sun' }).waitFor();
    await page.locator("#rym-main-chart .rym-preview-button").first().click();
    await page.locator('#rym-main-chart iframe[src*="/album/"]').waitFor();
    await page.getByRole("button", { name: "라이브러리 관리", exact: true }).click();
    const admin = page.getByRole("dialog", { name: "관리자 전용 기능입니다." }); await admin.waitFor();
    await admin.locator('input').fill("1234");
    await admin.getByRole("button", { name: "확인", exact: true }).click();
    await page.locator("#rym-library").waitFor();
    assert.ok((await page.locator('.rym-library-song-count').allTextContents()).every((text) => text.startsWith('100')), "Metadata counts must not show zero");
    // Delete the currently viewed chart and verify selection repairs itself.
    const albumRow = page.locator('.rym-library-row').filter({ hasText: 'Best albums of 2026' });
    await albumRow.locator('input').check();
    await page.getByRole("button", { name: "선택 삭제 (1)" }).click();
    await page.waitForFunction(() => !document.querySelector('#rym-main-chart')?.textContent.includes('Best albums of 2026'));
    assert.equal(deletes, 1);
    await page.getByRole("button", { name: "차트 기록 불러오기", exact: true }).first().click();
    await page.getByRole("dialog").locator('input').fill("1234");
    await page.getByRole("dialog").getByRole("button", { name: "확인", exact: true }).click();
    const upload = { ...initial[0], source_url: "https://rateyourmusic.com/charts/top/song/2020s/", page_title: "Best songs of the 2020s", captured_at: "2026-09-16T12:00:00.000Z" };
    await page.locator('input[type="file"]').setInputFiles({ name: "chart.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(upload)) });
    await page.getByText("차트 기록을 저장했습니다.", { exact: true }).waitFor();
    assert.equal(uploads, 1);
    assert.ok(errors.length === 0, errors.join("\n"));
    reports.push({ viewport, checks: "load, search, preview lifecycle, shared Spotify URLs, album preview, picker bounds, admin, metadata counts, delete recovery, upload", retryChecks: viewport.width === 1440, errors });
    await context.close();
    await browser.close();
  }
  await stopServer();
  console.log(JSON.stringify(reports, null, 2));
})().catch((error) => { console.error(error); process.exit(1); });
