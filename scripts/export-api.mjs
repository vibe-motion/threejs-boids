import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const execFileAsync = promisify(execFile);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const appDir = path.resolve(__dirname, "..");

const API_PORT = Number(process.env.SCENE_EXPORT_API_PORT || 4174);
const HOST = process.env.SCENE_EXPORT_API_HOST || "127.0.0.1";
const RENDER_HOST = "127.0.0.1";
const RENDER_PORT = Number(process.env.SCENE_EXPORT_RENDER_PORT || 4173);
const VIEWPORT_WIDTH = Number(process.env.SCENE_EXPORT_VIEWPORT_WIDTH || 2048);
const VIEWPORT_HEIGHT = Number(process.env.SCENE_EXPORT_VIEWPORT_HEIGHT || 1152);
const DEVICE_SCALE_FACTOR = Number(process.env.SCENE_EXPORT_DEVICE_SCALE_FACTOR || 2);
const MIN_RENDER_SCALE = 1;
const MAX_RENDER_SCALE = 2;
const BROWSER_EXECUTABLE =
  process.env.SCENE_EXPORT_BROWSER || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const FRAME_FILE_PADDING = 4;

function wait(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function jsonResponse(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store, no-cache, must-revalidate",
  });
  response.end(JSON.stringify(payload));
}

function textResponse(response, statusCode, message) {
  response.writeHead(statusCode, {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-store, no-cache, must-revalidate",
  });
  response.end(message);
}

function binaryResponse(response, statusCode, contentType, filename, buffer) {
  response.writeHead(statusCode, {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Content-Type": contentType,
    "Content-Length": buffer.length,
    "Content-Disposition": `attachment; filename="${filename}"`,
    "Cache-Control": "no-store, no-cache, must-revalidate",
  });
  response.end(buffer);
}

function parseRequestBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];

    request.on("data", (chunk) => {
      chunks.push(chunk);
    });
    request.on("end", () => {
      try {
        const text = Buffer.concat(chunks).toString("utf8");
        resolve(text ? JSON.parse(text) : {});
      } catch {
        reject(new Error("Invalid JSON body"));
      }
    });
    request.on("error", reject);
  });
}

function formatFrameFileName(frame) {
  return `frame-${String(frame).padStart(FRAME_FILE_PADDING, "0")}.png`;
}

function normalizeRenderScale(value) {
  const scale = Number(value);
  if (Number.isFinite(scale)) {
    return Math.min(Math.max(scale, MIN_RENDER_SCALE), MAX_RENDER_SCALE);
  }

  return Math.min(Math.max(DEVICE_SCALE_FACTOR, MIN_RENDER_SCALE), MAX_RENDER_SCALE);
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

function createRenderServer() {
  const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
  return spawn(
    npmCommand,
    ["exec", "vite", "--", "--host", RENDER_HOST, "--port", String(RENDER_PORT), "--strictPort"],
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

async function withScenePage({ renderScale }, task) {
  const renderServer = createRenderServer();
  let browser;

  try {
    renderServer.stdout.on("data", (chunk) => {
      process.stdout.write(chunk);
    });
    renderServer.stderr.on("data", (chunk) => {
      process.stderr.write(chunk);
    });

    await waitForServer(`http://${RENDER_HOST}:${RENDER_PORT}`);

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
    await page.goto(
      `http://${RENDER_HOST}:${RENDER_PORT}/?exportMode=composite-transparent&renderScale=${renderScale}`,
      { waitUntil: "networkidle0" },
    );
    await page.waitForFunction(() => Boolean(window.__SCENE_3D_EXPORT__));

    const metadata = await page.evaluate(() => ({
      totalFrames: window.__SCENE_3D_EXPORT__.getTotalFrames(),
    }));

    return await task({ page, metadata });
  } finally {
    if (browser) {
      await browser.close();
    }
    renderServer.kill("SIGINT");
  }
}

async function captureFrameBuffer({ frame, renderScale }) {
  return withScenePage({ renderScale }, async ({ page, metadata }) => {
    const clampedFrame = Math.max(0, Math.min(frame, metadata.totalFrames - 1));

    await page.evaluate(async (nextFrame) => {
      await window.__SCENE_3D_EXPORT__.setFrame(nextFrame);
    }, clampedFrame);
    await wait(20);

    return {
      buffer: await captureCanvasPngBuffer(page),
      frame: clampedFrame,
    };
  });
}

async function captureSequenceZip({ startFrame, endFrame, renderScale }) {
  return withScenePage({ renderScale }, async ({ page, metadata }) => {
    const clampedStartFrame = Math.max(0, Math.min(startFrame, metadata.totalFrames - 1));
    const clampedEndFrame = Math.max(
      clampedStartFrame,
      Math.min(endFrame, metadata.totalFrames - 1),
    );
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "threejs-boids-"));
    const zipPath = path.join(tempDir, "threejs-boids-frames.zip");

    try {
      const fileNames = [];
      for (let frame = clampedStartFrame; frame <= clampedEndFrame; frame += 1) {
        await page.evaluate(async (nextFrame) => {
          await window.__SCENE_3D_EXPORT__.setFrame(nextFrame);
        }, frame);
        await wait(20);

        const fileName = formatFrameFileName(frame);
        await fs.writeFile(path.join(tempDir, fileName), await captureCanvasPngBuffer(page));
        fileNames.push(fileName);
      }

      await execFileAsync("/usr/bin/zip", ["-q", "-j", zipPath, ...fileNames], { cwd: tempDir });
      return {
        buffer: await fs.readFile(zipPath),
        startFrame: clampedStartFrame,
        endFrame: clampedEndFrame,
      };
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });
}

let exportQueue = Promise.resolve();

function queueExport(task) {
  const nextTask = exportQueue.then(task, task);
  exportQueue = nextTask.catch(() => undefined);
  return nextTask;
}

const server = http.createServer(async (request, response) => {
  if (!request.url) {
    textResponse(response, 400, "Missing request URL");
    return;
  }

  const requestUrl = new URL(request.url, `http://${HOST}:${API_PORT}`);
  const pathname = requestUrl.pathname;

  if (request.method === "OPTIONS") {
    response.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    });
    response.end();
    return;
  }

  if (request.method === "GET" && pathname === "/health") {
    jsonResponse(response, 200, { ok: true });
    return;
  }

  if (request.method !== "POST") {
    textResponse(response, 405, "Only POST is supported");
    return;
  }

  try {
    const body = await parseRequestBody(request);

    if (pathname === "/export/frame") {
      const frame = Number(body.frame);
      const renderScale = normalizeRenderScale(body.renderScale);
      const result = await queueExport(() =>
        captureFrameBuffer({
          frame: Number.isFinite(frame) ? Math.round(frame) : 0,
          renderScale,
        }),
      );

      binaryResponse(response, 200, "image/png", formatFrameFileName(result.frame), result.buffer);
      return;
    }

    if (pathname === "/export/sequence") {
      const startFrame = Number(body.startFrame);
      const endFrame = Number(body.endFrame);
      const renderScale = normalizeRenderScale(body.renderScale);
      const result = await queueExport(() =>
        captureSequenceZip({
          startFrame: Number.isFinite(startFrame) ? Math.round(startFrame) : 0,
          endFrame: Number.isFinite(endFrame) ? Math.round(endFrame) : 0,
          renderScale,
        }),
      );

      binaryResponse(
        response,
        200,
        "application/zip",
        `threejs-boids-${String(result.startFrame).padStart(4, "0")}-${String(result.endFrame).padStart(4, "0")}.zip`,
        result.buffer,
      );
      return;
    }

    textResponse(response, 404, "Unknown export endpoint");
  } catch (error) {
    textResponse(response, 500, error.stack || error.message);
  }
});

server.listen(API_PORT, HOST, () => {
  process.stdout.write(`scene export api listening on http://${HOST}:${API_PORT}${os.EOL}`);
});
