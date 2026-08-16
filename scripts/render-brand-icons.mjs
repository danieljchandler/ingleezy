// Renders the brand SVGs to the PNG sizes the manifest and OG tags need.
// Chromium does the rasterising so the PNGs match exactly what browsers draw.
import { chromium } from "playwright";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { readFileSync } from "node:fs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const svg = readFileSync(resolve(root, "public/brand/ingleezy-icon.svg"), "utf8");

// [file, size, background] — transparent for the plain icons; Indigo Deep
// full-bleed for the maskable one, which must survive a circular crop.
const OUT = [
  ["public/favicon.png", 256, null],
  ["public/brand/icon-192.png", 192, null],
  ["public/brand/icon-512.png", 512, null],
  ["public/brand/icon-maskable-512.png", 512, "#2C3B74"],
  ["/tmp/claude-0/-home-user-arabic-buddy/f78712a1-e756-5c1d-88c1-2ddd013fa4de/scratchpad/icon-preview.png", 512, "#FFFFFF"],
];

const browser = await chromium.launch();
const page = await browser.newPage();
for (const [file, size, bg] of OUT) {
  // The maskable icon shrinks the mark into the safe zone (80%) on a solid bg.
  const scale = bg && file.includes("maskable") ? 0.72 : 1;
  const html = `<!doctype html><body style="margin:0;width:${size}px;height:${size}px;display:grid;place-items:center;background:${bg ?? "transparent"}">` +
    `<div style="width:${Math.round(size * scale)}px;height:${Math.round(size * scale)}px">${svg.replace("<svg ", `<svg width="100%" height="100%" `)}</div></body>`;
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(html);
  await page.screenshot({ path: resolve(root, file), omitBackground: !bg });
  console.log("wrote", file);
}
await browser.close();
