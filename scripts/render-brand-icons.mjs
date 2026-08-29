// Renders the brand SVGs to the PNG sizes the manifest and OG tags need.
// Chromium does the rasterising so the PNGs match exactly what browsers draw.
import { chromium } from "playwright";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { readFileSync } from "node:fs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const svgPath = resolve(root, "public/brand/ingleezy-icon.svg");
const svg = readFileSync(svgPath, "utf8");

// [file, size, background] — transparent for the plain icons; Indigo Deep
// full-bleed for the maskable one, which must survive a circular crop.
const OUT = [
  ["public/favicon.png", 256, null],
  ["public/brand/icon-192.png", 192, null],
  ["public/brand/icon-512.png", 512, null],
  ["public/brand/icon-maskable-512.png", 512, "#2C3B74"],
];

const browser = await chromium.launch();
const page = await browser.newPage();

// The icon reaches browsers through `<img src>`, which parses it as XML — far
// stricter than the HTML parser that rasterises it below. An ill-formed file
// therefore yields perfect PNGs here while rendering as nothing in the app,
// which is exactly the failure this check exists to make loud. The classic
// cause is a doubled hyphen inside a comment, which XML forbids.
const parseError = await page.evaluate((source) => {
  const doc = new DOMParser().parseFromString(source, "image/svg+xml");
  return doc.querySelector("parsererror")?.textContent ?? null;
}, svg);
if (parseError) {
  console.error(`${svgPath} is not well-formed XML, so it will not render in an <img>:`);
  console.error(parseError);
  await browser.close();
  process.exit(1);
}

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
