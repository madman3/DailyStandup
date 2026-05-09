import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import puppeteer from "puppeteer-core";
import { createServer } from "vite";

const FRONTEND_DIR = path.resolve(process.cwd(), "frontend");

function chromeExecutablePath() {
  const candidates = [
    process.env.CHROME_PATH,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
  ].filter(Boolean);
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) return p;
    } catch {
      // ignore
    }
  }
  return candidates[0] || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
}

async function waitForHttpOk(url, timeoutMs = 15000) {
  const start = Date.now();
  let last = null;
  // Node 20+ has global fetch
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const r = await fetch(url, { redirect: "manual" });
      // Treat any non-5xx response as "server is up" (Vite may 404 briefly during startup).
      if (r.status < 500) return;
      last = `HTTP ${r.status}`;
    } catch {
      last = "fetch failed";
    }
    if (Date.now() - start > timeoutMs) {
      throw new Error(`Timed out waiting for ${url}${last ? ` (${last})` : ""}`);
    }
    await delay(250);
  }
}

describe("todo row vertical alignment", () => {
  it("centers checkbox, title text, and menu button", async () => {
    const viteServer = await createServer({
      root: FRONTEND_DIR,
      logLevel: "silent",
      server: { host: "127.0.0.1", port: 0, strictPort: false },
    });
    await viteServer.listen();
    const addr = viteServer.httpServer?.address();
    const port =
      typeof addr === "object" && addr && "port" in addr ? Number(addr.port) : NaN;
    if (!Number.isFinite(port)) {
      throw new Error("Could not determine Vite server port for alignment test.");
    }
    const baseUrl = `http://127.0.0.1:${port}`;

    try {
      await waitForHttpOk(`${baseUrl}/?mock=1`);

      const chromePath = chromeExecutablePath();
      if (!fs.existsSync(chromePath)) {
        throw new Error(
          `Chrome not found at ${chromePath}. Install Google Chrome or set CHROME_PATH to your Chrome executable.`
        );
      }
      const browser = await puppeteer.launch({
        executablePath: chromePath,
        headless: true,
        dumpio: true,
        args: [
          "--headless=new",
          "--disable-gpu",
          "--no-first-run",
          "--no-default-browser-check",
          "--disable-dev-shm-usage",
          "--no-sandbox",
          "--disable-setuid-sandbox",
        ],
      });

      try {
        const page = await browser.newPage();
        await page.goto(`${baseUrl}/?mock=1`, { waitUntil: "networkidle0" });

        // Ensure row exists
        await page.waitForSelector(".todo-row", { timeout: 5000 });

        const deltas = await page.evaluate(() => {
          const row = document.querySelector(".todo-row");
          const checkbox = row?.querySelector(".todo-checkbox-hit");
          const title = row?.querySelector(".todo-title");
          const menu = row?.querySelector(".todo-row-menu-btn");
          if (!row || !checkbox || !title || !menu) {
            throw new Error("Missing expected todo row elements");
          }

          const rc = checkbox.getBoundingClientRect();
          const rt = title.getBoundingClientRect();
          const rm = menu.getBoundingClientRect();
          const cY = rc.top + rc.height / 2;
          const tY = rt.top + rt.height / 2;
          const mY = rm.top + rm.height / 2;
          return {
            checkboxTitleDelta: Math.abs(cY - tY),
            titleMenuDelta: Math.abs(tY - mY),
          };
        });

        // Allow a small tolerance for font rendering differences.
        assert.ok(
          deltas.checkboxTitleDelta <= 2,
          `checkbox/title center mismatch: ${deltas.checkboxTitleDelta}px`
        );
        assert.ok(
          deltas.titleMenuDelta <= 2,
          `title/menu center mismatch: ${deltas.titleMenuDelta}px`
        );
      } finally {
        await browser.close();
      }
    } catch (e) {
      const msg =
        e instanceof Error ? e.message : String(e);
      if (msg.includes("executablePath") || msg.includes("ENOENT")) {
        throw new Error(
          `${msg}\nChrome not found. Set CHROME_PATH env var to your Chrome executable path.`
        );
      }
      throw e;
    } finally {
      await viteServer.close();
    }
  });
});

