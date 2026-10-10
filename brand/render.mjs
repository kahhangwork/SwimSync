// Rasterise brand/*.svg into every committed PNG/ICO (the table in brand/README.md).
// Stroke 9 at ≤32px, 10 at ≤16px (DESIGN.md → Logo). Run from anywhere:
//   node brand/render.mjs
// Uses the UI drivers' playwright-core and the installed Chrome — no new package.
import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const require = createRequire(ROOT + "/.claude/skills/run-ui-playwright/drivers/package.json");
const { chromium } = require("playwright-core");

const svg = (f, size) => {
  let s = readFileSync(`${ROOT}/brand/${f}`, "utf8");
  const w = size <= 16 ? 10 : size <= 32 ? 9 : null;
  if (w) s = s.replace(/stroke-width="8\.5"/g, `stroke-width="${w}"`);
  return s.replace(/width="64" height="64"/, `width="${size}" height="${size}"`);
};
const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage({ deviceScaleFactor: 1 });
async function shot(f, size, alpha) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><head><style>html,body{margin:0;overflow:hidden}svg{display:block}</style></head><body style="background:${alpha ? "transparent" : "#2563eb"}">${svg(f, size)}</body></html>`);
  return page.screenshot({ omitBackground: alpha, clip: { x: 0, y: 0, width: size, height: size } });
}
const out = [
  ["SwimSyncApp/assets/icon.png", "icon-tile.svg", 1024, false],
  ["SwimSyncApp/assets/adaptive-icon.png", "adaptive-foreground.svg", 1024, true],
  ["SwimSyncApp/assets/splash.png", "mark-white.svg", 512, true],
  ["SwimSyncApp/assets/favicon.png", "icon-tile.svg", 48, false],
  ["SwimSyncApp/assets/logo-mark.png", "mark-white.svg", 64, true],
  ["SwimSyncApp/assets/logo-mark@2x.png", "mark-white.svg", 128, true],
  ["SwimSyncApp/assets/logo-mark@3x.png", "mark-white.svg", 192, true],
  ["SwimSyncAdmin/public/icon.png", "icon-tile.svg", 32, false],
  ["SwimSyncAdmin/public/apple-touch-icon.png", "icon-tile.svg", 180, false],
];
for (const [dst, src, size, alpha] of out) { writeFileSync(`${ROOT}/${dst}`, await shot(src, size, alpha)); console.log("wrote", dst, size); }
// favicon.ico: 16 + 32 + 48, PNG-encoded entries (valid ICO since Vista).
const pngs = [];
for (const s of [16, 32, 48]) pngs.push([s, await shot("icon-tile.svg", s, false)]);
const head = Buffer.alloc(6 + 16 * pngs.length);
head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(pngs.length, 4);
let off = head.length;
pngs.forEach(([s, b], i) => {
  const e = 6 + 16 * i;
  head.writeUInt8(s, e); head.writeUInt8(s, e + 1); head.writeUInt8(0, e + 2); head.writeUInt8(0, e + 3);
  head.writeUInt16LE(1, e + 4); head.writeUInt16LE(32, e + 6);
  head.writeUInt32LE(b.length, e + 8); head.writeUInt32LE(off, e + 12); off += b.length;
});
writeFileSync(`${ROOT}/SwimSyncAdmin/public/favicon.ico`, Buffer.concat([head, ...pngs.map(([, b]) => b)]));
console.log("wrote favicon.ico");
await browser.close();
