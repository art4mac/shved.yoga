/**
 * Собирает соц-карточки: site/public/og.jpg и site/public/social/{hatha,prasu}.jpg.
 *
 * Карточки рисуются в headless Chrome по tools/og/card.html — там живые шрифты
 * и CSS сайта, а не приблизительная отрисовка через SVG. Съёмка идёт на DPR 2 и
 * уменьшается до 1200×630: текст выходит чище, чем при съёмке 1:1.
 *
 * Запуск:  node tools/og/build.mjs
 * Нужно:   папка photos/ с оригиналами nadiv-5775.jpg и nadiv-5822.jpg
 *          (она не в гите — лежит локально у нас), плюс site/node_modules.
 *
 * Пересобирать после смены расписания, цен или фотографий: текст карточек
 * лежит прямо в card.html и должен совпадать с site/src/content/site.ts.
 */
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../..");
const sharp = (await import(join(ROOT, "site/node_modules/sharp/lib/index.js"))).default;

const PHOTOS = join(ROOT, "photos");
const PUBLIC = join(ROOT, "site/public");
const PORT = 8123;
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

// Панель под фото в карточке — 540×630. Окна кропов подобраны по сетке.
const AR = 540 / 630;
const shots = [
  { out: "hatha", src: "nadiv-5775.jpg", x0: 0.38, x1: 0.88, yBias: 0.42 },
  { out: "prasu", src: "nadiv-5822.jpg", x0: 0.48, x1: 0.98, yBias: 0.46 },
];

// Какая карточка куда ложится.
const cards = [
  { id: "main", out: "og.jpg" },
  { id: "hatha", out: "social/hatha.jpg" },
  { id: "prasu", out: "social/prasu.jpg" },
];

const tmp = mkdtempSync(join(tmpdir(), "og-"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

try {
  // 1. Кропы фигуры из оригиналов.
  for (const s of shots) {
    const m = await sharp(join(PHOTOS, s.src)).metadata();
    const left = Math.round(m.width * s.x0);
    const w = Math.round(m.width * (s.x1 - s.x0));
    const h = Math.min(m.height, Math.round(w / AR));
    const top = Math.max(0, Math.min(m.height - h, Math.round(m.height * s.yBias - h / 2)));
    await sharp(join(PHOTOS, s.src))
      .extract({ left, top, width: w, height: h })
      .resize(1080, 1260, { kernel: "lanczos3" })
      .jpeg({ quality: 92, chromaSubsampling: "4:4:4", mozjpeg: true })
      .toFile(join(tmp, `${s.out}.jpg`));
    console.log(`кроп ${s.out}: окно ${w}×${h} из ${m.width}×${m.height}`);
  }

  // 2. Свой статический сервер: шрифты из public, кропы из временной папки.
  const routes = {
    "/card.html": { file: join(HERE, "card.html"), type: "text/html; charset=utf-8" },
  };
  const server = createServer((req, res) => {
    const url = req.url.split("?")[0];
    let file, type;
    if (routes[url]) ({ file, type } = routes[url]);
    else if (url.startsWith("/fonts/")) { file = join(PUBLIC, url); type = "font/woff2"; }
    else if (url.startsWith("/_og/")) { file = join(tmp, url.slice(5)); type = "image/jpeg"; }
    if (!file) { res.writeHead(404).end(); return; }
    try {
      const body = readFileSync(file);
      res.writeHead(200, { "content-type": type, "content-length": body.length }).end(body);
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise((r) => server.listen(PORT, "127.0.0.1", r));

  // 3. Chrome по CDP.
  const chrome = spawn(CHROME, [
    "--headless=new", "--disable-gpu", "--hide-scrollbars",
    `--remote-debugging-port=${PORT + 1}`, `--user-data-dir=${join(tmp, "profile")}`, "about:blank",
  ], { stdio: "ignore" });

  let wsUrl;
  for (let i = 0; i < 80 && !wsUrl; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT + 1}/json/list`)).json();
      wsUrl = list.find((t) => t.type === "page")?.webSocketDebuggerUrl;
    } catch { /* Chrome ещё поднимается */ }
    if (!wsUrl) await sleep(200);
  }
  if (!wsUrl) throw new Error("Chrome не поднялся");

  const ws = new WebSocket(wsUrl);
  let id = 0;
  const pending = new Map();
  ws.addEventListener("message", (e) => {
    const m = JSON.parse(e.data);
    if (!m.id || !pending.has(m.id)) return;
    const { res, rej } = pending.get(m.id);
    pending.delete(m.id);
    m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
  });
  const send = (method, params = {}) =>
    new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
  await new Promise((r) => ws.addEventListener("open", r));

  await send("Page.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 1200, height: 700, deviceScaleFactor: 2, mobile: false });
  await send("Page.navigate", { url: `http://127.0.0.1:${PORT}/card.html` });
  await sleep(1500);

  // Ждём шрифты и фото, иначе снимок уйдёт с подстановочным шрифтом.
  await send("Runtime.evaluate", {
    returnByValue: true, awaitPromise: true, expression: `
      (async () => {
        await document.fonts.ready;
        await Promise.all([...document.images].map(i => i.complete ? 1 : new Promise(r => { i.onload = i.onerror = r; })));
      })()`,
  });

  // 4. Снимаем каждую карточку по её рамке.
  mkdirSync(join(PUBLIC, "social"), { recursive: true });
  for (const card of cards) {
    const { result } = await send("Runtime.evaluate", {
      returnByValue: true, expression: `
        (() => { const r = document.getElementById("${card.id}").getBoundingClientRect();
          return JSON.stringify({x: Math.round(r.x), y: Math.round(r.y + scrollY), width: Math.round(r.width), height: Math.round(r.height)}); })()`,
    });
    const clip = { ...JSON.parse(result.value), scale: 1 };
    const { data } = await send("Page.captureScreenshot", { format: "png", clip, captureBeyondViewport: true });
    await sharp(Buffer.from(data, "base64"))
      .resize(1200, 630, { kernel: "lanczos3" })
      .jpeg({ quality: 88, chromaSubsampling: "4:4:4", mozjpeg: true })
      .toFile(join(PUBLIC, card.out));
    console.log(`готово: site/public/${card.out}`);
  }

  ws.close();
  chrome.kill();
  server.close();
  // Chrome ещё дописывает профиль после kill — иначе rmSync падает на ENOTEMPTY.
  await sleep(500);
} finally {
  rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
