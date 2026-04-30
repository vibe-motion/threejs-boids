import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const appDir = path.resolve(__dirname, "..");

const HOST = "127.0.0.1";
const PORT = Number(process.env.SCENE_EXPORT_PORT || 4173);
const VIEWPORT_WIDTH = Number(process.env.SCENE_EXPORT_VIEWPORT_WIDTH || 2048);
const VIEWPORT_HEIGHT = Number(process.env.SCENE_EXPORT_VIEWPORT_HEIGHT || 1152);
const DEVICE_SCALE_FACTOR = Number(process.env.SCENE_EXPORT_DEVICE_SCALE_FACTOR || 2);
const OUTPUT_DIR = path.resolve(
  appDir,
  process.env.SCENE_EXPORT_OUTPUT_DIR || "renders/boids-frames",
);
const PAGE_URL = process.env.SCENE_EXPORT_PAGE_URL || "";
const BROWSER_EXECUTABLE =
  process.env.SCENE_EXPORT_BROWSER || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

function wait(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function waitForServer(url, timeoutMs = 30000) {
  const start = Date.now();

  return new Promise((resolve, reject) => {
    const tryRequest = () => {
      const request = http.get(url, (response) => {
        response.resume();
        if (response.statusCode && response.statusCode >= 200 && response.statusCode < 500) {
          resolve();
          return;
        }

        if (Date.now() - start > timeoutMs) {
          reject(new Error(`Timed out waiting for ${url}`));
          return;
        }

        setTimeout(tryRequest, 250);
      });

      request.on("error", () => {
        if (Date.now() - start > timeoutMs) {
          reject(new Error(`Timed out waiting for ${url}`));
          return;
        }

        setTimeout(tryRequest, 250);
      });
    };

    tryRequest();
  });
}

function createDevServer() {
  const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
  return spawn(
    npmCommand,
    ["exec", "vite", "--", "--host", HOST, "--port", String(PORT), "--strictPort"],
    {
      cwd: appDir,
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    },
  );
}

async function captureCanvasPngBuffer(page) {
  const dataUrl = await page.evaluate(() => {
    const canvas = document.querySelector(".scene-canvas");
    if (!canvas) {
      throw new Error("Scene canvas is missing");
    }

    return canvas.toDataURL("image/png");
  });
  return Buffer.from(dataUrl.replace(/^data:image\/png;base64,/, ""), "base64");
}

async function main() {
  const renderScale = Math.min(Math.max(DEVICE_SCALE_FACTOR, 1), 16);
  const pageUrl =
    PAGE_URL ||
    `http://${HOST}:${PORT}/?exportMode=composite-transparent&renderScale=${renderScale}`;
  const server = PAGE_URL ? null : createDevServer();
  let browser;

  server?.stdout.on("data", (chunk) => {
    process.stdout.write(chunk);
  });
  server?.stderr.on("data", (chunk) => {
    process.stderr.write(chunk);
  });

  try {
    await fs.mkdir(OUTPUT_DIR, { recursive: true });
    if (!PAGE_URL) {
      await waitForServer(`http://${HOST}:${PORT}`);
    }

    browser = await puppeteer.launch({
      executablePath: BROWSER_EXECUTABLE,
      headless: true,
      defaultViewport: {
        width: Math.round(VIEWPORT_WIDTH * renderScale),
        height: Math.round(VIEWPORT_HEIGHT * renderScale),
        deviceScaleFactor: 1,
      },
      args: ["--hide-scrollbars"],
    });

    const page = await browser.newPage();
    await page.goto(pageUrl, { waitUntil: "networkidle0" });
    await page.waitForFunction(() => Boolean(window.__SCENE_3D_EXPORT__));

    const totalFrames = await page.evaluate(() => window.__SCENE_3D_EXPORT__.getTotalFrames());
    const startFrame = Math.max(0, Number(process.env.SCENE_EXPORT_START_FRAME || 0));
    const endFrame = Math.min(
      totalFrames - 1,
      Number(process.env.SCENE_EXPORT_END_FRAME || totalFrames - 1),
    );

    for (let frame = startFrame; frame <= endFrame; frame += 1) {
      await page.evaluate(async (nextFrame) => {
        await window.__SCENE_3D_EXPORT__.setFrame(nextFrame);
      }, frame);
      await wait(20);

      const outputPath = path.join(OUTPUT_DIR, `frame-${String(frame).padStart(4, "0")}.png`);
      await fs.writeFile(outputPath, await captureCanvasPngBuffer(page));
      process.stdout.write(`exported ${frame + 1}/${endFrame + 1}: ${outputPath}${os.EOL}`);
    }
  } finally {
    if (browser) {
      await browser.close();
    }
    server?.kill("SIGINT");
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}${os.EOL}`);
  process.exitCode = 1;
});
