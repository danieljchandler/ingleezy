// Renders scripts/og-image.html to public/og-image.jpg (1200x630), the card
// link previews show. Serves public/ itself so the self-hosted fonts and the
// art load exactly as they do in the app. Rerun after changing the card.
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, extname, join, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TYPES = { ".html": "text/html", ".css": "text/css", ".woff2": "font/woff2", ".webp": "image/webp" };

const server = createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
  const file =
    path === "/" ? join(root, "scripts/og-image.html")
    : path === "/fonts.css" ? join(root, "src/fonts.css")
    : join(root, "public", path);
  let body;
  try {
    body = await readFile(file);
  } catch {
    res.writeHead(404).end();
    return;
  }
  res.writeHead(200, { "Content-Type": TYPES[extname(file)] ?? "application/octet-stream" });
  res.end(body);
}).listen(0);
const { port } = server.address();

const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
);
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
await page.goto(`http://127.0.0.1:${port}/`);
await page.evaluate(() => document.fonts.ready);
await page.waitForLoadState("networkidle");
// JPEG: a link preview is a photo-like gradient, and the PNG was 500 KB.
await page.screenshot({ path: join(root, "public/og-image.jpg"), type: "jpeg", quality: 88 });
console.log("wrote public/og-image.jpg");
await browser.close();
server.close();
