import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import dotenv from "dotenv";
import express from "express";
import mysql from "mysql2/promise";
import {
  OPENROUTER_IMAGE_MODELS,
  acknowledgeOpenRouterJob,
  buildOpenRouterImageRequest,
  createOpenRouterBodyAdmission,
  isOpenRouterEnabled,
  requestOpenRouterImage,
} from "./openrouter-image.js";
import { createOpenRouterModelAvailability } from './openrouter-models.js';
import { createChatGptRouter } from "./chatgpt-router.js";
import { createEncryptedChatGptSessionStore } from "./chatgpt-session-store.js";
import { staticAssetCacheOptions } from "./staticAssetCache.js";

dotenv.config({ path: process.env.COVER_IMAGE_ENV || "/etc/cover-image/cover-image.env" });

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const distDir = path.join(rootDir, "dist");
const uploadRoot = process.env.UPLOAD_ROOT || "/var/lib/cover-image/uploads";
const publicUploadPrefix = "/uploads";
const port = Number(process.env.PORT || 3127);
const chatGptEnabled = process.env.COVER_CHATGPT_ENABLED === 'true';
const chatGptSessionStore = chatGptEnabled
  ? await createEncryptedChatGptSessionStore({
      filePath: process.env.COVER_CHATGPT_SESSION_FILE || '/var/lib/cover-image/chatgpt/sessions.enc',
      key: process.env.COVER_CHATGPT_SESSION_KEY,
    })
  : undefined;
const imageProxyAllowedHosts = new Set([
  "art.hearthstonejson.com",
  "d15f34w2p8l1cc.cloudfront.net",
  "db.kolodahs.ru",
  "hearthstone.wiki.gg",
  "image.kolodahs.ru",
]);
const openRouterRateBuckets = new Map();
const openRouterRateWindowMs = 10 * 60 * 1000;
const openRouterRateLimit = 12;
const openRouterJobs = new Map();
const openRouterJobTtlMs = 15 * 60 * 1000;
// Terminal results remain available until acknowledgement or TTL. Four jobs
// bound decoded/base64 result memory while keeping the editor usable.
const openRouterJobLimit = 4;
const openRouterBodyAdmission = createOpenRouterBodyAdmission(2);
const openRouterModelAvailability = createOpenRouterModelAvailability({
  modelIds: Object.keys(OPENROUTER_IMAGE_MODELS),
});
const geminiRateBuckets = new Map();
const geminiRateWindowMs = 10 * 60 * 1000;
const geminiRateLimit = Number(process.env.GEMINI_RATE_LIMIT || 30);
const geminiApiOrigin = "https://generativelanguage.googleapis.com";
const uploadMimeExtensions = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
  ["image/gif", "gif"],
  ["image/avif", "avif"],
  ["video/mp4", "mp4"],
  ["video/webm", "webm"],
  ["video/quicktime", "mov"],
]);

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", "loopback");
app.use('/api/chatgpt', createChatGptRouter({
  enabled: chatGptEnabled,
  origin: process.env.COVER_CHATGPT_ORIGIN,
  sessionStore: chatGptSessionStore,
  bindingCookie: 'cover_admin_session',
}));
// Parse this billable endpoint with its own hard ceiling before the larger
// legacy upload parser. 24 MiB decoded references need roughly 32 MiB as base64.
app.use(
  '/api/thumbnail/openrouter-generate',
  limitOpenRouterRequests,
  openRouterBodyAdmission,
  express.json({ limit: '34mb' }),
);
app.use(express.json({ limit: process.env.JSON_LIMIT || "150mb" }));

const pool = mysql.createPool({
  host: process.env.DB_HOST || "127.0.0.1",
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USERNAME || process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_DATABASE || "cover_image",
  charset: "utf8mb4",
  waitForConnections: true,
  connectionLimit: Number(process.env.DB_POOL_SIZE || 10),
});

function id() {
  return Math.random().toString(36).slice(2, 12);
}

function extFromMime(mimeType, fallback) {
  const raw = (mimeType || "").split("/")[1]?.split("+")[0] || fallback;
  if (raw === "jpeg") return "jpg";
  return raw.replace(/[^a-z0-9]/gi, "").toLowerCase() || fallback;
}

function publicUrl(storagePath) {
  return `${publicUploadPrefix}/${storagePath.split("/").map(encodeURIComponent).join("/")}`;
}

function storageFullPath(storagePath) {
  const fullPath = path.normalize(path.join(uploadRoot, String(storagePath || "")));
  if (!fullPath.startsWith(path.normalize(uploadRoot + path.sep))) return null;
  return fullPath;
}

async function storagePathExists(storagePath) {
  const fullPath = storageFullPath(storagePath);
  if (!fullPath) return false;
  try {
    await fs.access(fullPath);
    return true;
  } catch {
    return false;
  }
}

async function rowsWithStorageStatus(rows) {
  const checked = await Promise.all(rows.map(async (row) => ({
    ...row,
    storage_available: await storagePathExists(row.storage_path),
  })));
  return checked;
}

async function rowsWithExistingStorage(rows) {
  const checked = await Promise.all(rows.map(async (row) => ({
    row,
    exists: await storagePathExists(row.storage_path),
  })));
  return checked.filter((item) => item.exists).map((item) => item.row);
}

function decodeDataUrl(dataUrl, defaultMimeType) {
  const match = String(dataUrl || "").match(/^data:([^;,]+);base64,(.*)$/s);
  if (!match) {
    throw Object.assign(new Error("Expected base64 data URL"), { status: 400 });
  }
  const mimeType = (match[1] || defaultMimeType).toLowerCase();
  if (!uploadMimeExtensions.has(mimeType)) {
    throw Object.assign(new Error("Unsupported upload MIME type"), { status: 415 });
  }
  return {
    mimeType,
    buffer: Buffer.from(match[2], "base64"),
  };
}

async function saveDataUrl(dataUrl, folder, defaultMimeType) {
  const decoded = decodeDataUrl(dataUrl, defaultMimeType);
  const rowId = id();
  const storagePath = `${folder}/${rowId}.${uploadMimeExtensions.get(decoded.mimeType)}`;
  const fullPath = path.join(uploadRoot, storagePath);
  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  await fs.writeFile(fullPath, decoded.buffer);
  return { id: rowId, storagePath, storageUrl: publicUrl(storagePath), mimeType: decoded.mimeType };
}

async function removeStoragePath(storagePath) {
  if (!storagePath) return;
  const fullPath = storageFullPath(storagePath);
  if (!fullPath) return;
  await fs.rm(fullPath, { force: true }).catch(() => {});
}

function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

function validateImageProxyUrl(rawUrl) {
  let parsed;
  try {
    parsed = new URL(String(rawUrl || ""));
  } catch {
    throw Object.assign(new Error("Invalid image URL"), { status: 400 });
  }
  if (parsed.protocol !== "https:") {
    throw Object.assign(new Error("Only https image URLs are allowed"), { status: 400 });
  }
  if (!imageProxyAllowedHosts.has(parsed.hostname)) {
    throw Object.assign(new Error("Image host is not allowed"), { status: 400 });
  }
  return parsed.toString();
}

function limitOpenRouterRequests(req, _res, next) {
  const now = Date.now();
  const key = req.ip || req.socket.remoteAddress || "unknown";
  const recent = (openRouterRateBuckets.get(key) || []).filter((timestamp) => now - timestamp < openRouterRateWindowMs);
  if (recent.length >= openRouterRateLimit) {
    next(Object.assign(new Error("Слишком много генераций. Попробуйте через несколько минут."), { status: 429 }));
    return;
  }
  recent.push(now);
  openRouterRateBuckets.set(key, recent);
  if (openRouterRateBuckets.size > 1000) {
    for (const [bucketKey, timestamps] of openRouterRateBuckets) {
      if (!timestamps.some((timestamp) => now - timestamp < openRouterRateWindowMs)) openRouterRateBuckets.delete(bucketKey);
    }
  }
  next();
}

function openRouterClientKey(req) {
  return req.ip || req.socket.remoteAddress || "unknown";
}

function limitGeminiGenerationRequests(req, _res, next) {
  // Video status polling and media delivery are GET requests; rate limiting
  // them with generation starts would break a normal long-running Veo job.
  if (req.method !== "POST") {
    next();
    return;
  }
  const now = Date.now();
  const key = req.ip || req.socket.remoteAddress || "unknown";
  const recent = (geminiRateBuckets.get(key) || []).filter((timestamp) => now - timestamp < geminiRateWindowMs);
  if (recent.length >= geminiRateLimit) {
    next(Object.assign(new Error("Слишком много запросов к генератору. Попробуйте через несколько минут."), { status: 429 }));
    return;
  }
  recent.push(now);
  geminiRateBuckets.set(key, recent);
  if (geminiRateBuckets.size > 1000) {
    for (const [bucketKey, timestamps] of geminiRateBuckets) {
      if (!timestamps.some((timestamp) => now - timestamp < geminiRateWindowMs)) geminiRateBuckets.delete(bucketKey);
    }
  }
  next();
}

function geminiApiUrl(req) {
  const incoming = new URL(req.originalUrl, "http://cover.local");
  const upstreamPath = incoming.pathname.replace(/^\/api\/gemini/, "");
  if (!/^\/v1(?:alpha|beta)\/(?:models|operations)\//.test(upstreamPath)) {
    throw Object.assign(new Error("Gemini API path is not allowed"), { status: 404 });
  }
  const target = new URL(upstreamPath, geminiApiOrigin);
  for (const [key, value] of incoming.searchParams) {
    if (key !== "key") target.searchParams.append(key, value);
  }
  target.searchParams.set("key", process.env.GEMINI_API_KEY);
  return target;
}

function geminiMediaUrl(rawUrl) {
  let target;
  try {
    target = new URL(String(rawUrl || ""));
  } catch {
    throw Object.assign(new Error("Invalid Gemini media URL"), { status: 400 });
  }
  if (target.protocol !== "https:" || target.hostname !== "generativelanguage.googleapis.com" || !target.pathname.startsWith("/download/")) {
    throw Object.assign(new Error("Gemini media URL is not allowed"), { status: 400 });
  }
  target.searchParams.delete("key");
  target.searchParams.set("key", process.env.GEMINI_API_KEY);
  return target;
}

async function proxyGeminiRequest(req, res) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw Object.assign(new Error("Генератор пока не настроен"), { status: 503 });
  if (req.method !== "GET" && req.method !== "POST") {
    throw Object.assign(new Error("Gemini API method is not allowed"), { status: 405 });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 300000);
  try {
    const upstream = await fetch(geminiApiUrl(req), {
      method: req.method,
      signal: controller.signal,
      headers: {
        "Accept": req.get("accept") || "application/json",
        ...(req.method === "POST" ? { "Content-Type": "application/json" } : {}),
      },
      ...(req.method === "POST" ? { body: JSON.stringify(req.body ?? {}) } : {}),
    });
    const contentType = upstream.headers.get("content-type") || "application/json";
    res.status(upstream.status);
    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.send(Buffer.from(await upstream.arrayBuffer()));
  } catch (error) {
    if (error?.name === "AbortError") {
      throw Object.assign(new Error("Генерация превысила лимит времени"), { status: 504 });
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function cleanupOpenRouterJobs(now = Date.now()) {
  for (const [jobId, job] of openRouterJobs) {
    if (now - job.updatedAt > openRouterJobTtlMs) openRouterJobs.delete(jobId);
  }
}

function startOpenRouterJob(jobId, requestBody, apiKey) {
  void requestOpenRouterImage(requestBody, apiKey, {
    onRetry: ({ attempt, nextAttempt, status, delayMs }) => {
      console.warn(`[openrouter-job ${jobId}] model=${requestBody.model} retry_attempt=${nextAttempt} previous_attempt=${attempt} upstream_status=${status} delay_ms=${delayMs}`);
    },
  })
    .then((imageUrl) => {
      const job = openRouterJobs.get(jobId);
      if (!job) return;
      Object.assign(job, { status: "complete", imageUrl, updatedAt: Date.now() });
    })
    .catch((error) => {
      const job = openRouterJobs.get(jobId);
      if (!job) return;
      Object.assign(job, {
        status: "failed",
        error: error?.message || "Выбранная модель OpenRouter не смогла создать изображение",
        errorStatus: Number(error?.status) || 502,
        errorCode: typeof error?.code === 'string' ? error.code : 'PROVIDER_REJECTED',
        errorAttempts: Number.isInteger(error?.attempts) ? error.attempts : 1,
        updatedAt: Date.now(),
      });
      console.error(`[openrouter-job ${jobId}] model=${requestBody.model} code=${job.errorCode} status=${job.errorStatus} attempts=${job.errorAttempts}`);
    });
}

app.get("/api/health", asyncHandler(async (_req, res) => {
  const [rows] = await pool.query("SELECT 1 AS ok");
  res.json({ ok: rows[0]?.ok === 1 });
}));

app.get("/api/runtime-capabilities", (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json({
    gemini: Boolean(process.env.GEMINI_API_KEY),
    openrouter: isOpenRouterEnabled(),
  });
});

app.get('/api/thumbnail/openrouter-models', asyncHandler(async (_req, res) => {
  res.setHeader('Cache-Control', 'private, max-age=60');
  res.json({ models: await openRouterModelAvailability.list() });
}));

app.all("/api/gemini/*", limitGeminiGenerationRequests, asyncHandler(proxyGeminiRequest));

app.get("/api/gemini-media", asyncHandler(async (req, res) => {
  if (!process.env.GEMINI_API_KEY) {
    throw Object.assign(new Error("Генератор пока не настроен"), { status: 503 });
  }
  const upstream = await fetch(geminiMediaUrl(req.query.url));
  if (!upstream.ok) {
    throw Object.assign(new Error(`Gemini video fetch failed: ${upstream.status}`), { status: 502 });
  }
  const contentType = upstream.headers.get("content-type") || "application/octet-stream";
  if (!contentType.toLowerCase().startsWith("video/")) {
    throw Object.assign(new Error("Gemini media response is not a video"), { status: 415 });
  }
  res.setHeader("Content-Type", contentType);
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.send(Buffer.from(await upstream.arrayBuffer()));
}));

app.get("/api/image-proxy", asyncHandler(async (req, res) => {
  const url = validateImageProxyUrl(req.query.url);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const upstream = await fetch(url, {
      signal: controller.signal,
      headers: {
        "Accept": "image/avif,image/webp,image/png,image/jpeg,image/*,*/*;q=0.8",
        "User-Agent": "KolodahsCoverImage/1.0",
      },
    });
    if (!upstream.ok) {
      throw Object.assign(new Error(`Image fetch failed: ${upstream.status}`), { status: 502 });
    }
    const contentType = upstream.headers.get("content-type") || "application/octet-stream";
    if (!contentType.toLowerCase().startsWith("image/")) {
      throw Object.assign(new Error("Upstream response is not an image"), { status: 415 });
    }
    const contentLength = Number(upstream.headers.get("content-length") || 0);
    if (contentLength > 25 * 1024 * 1024) {
      throw Object.assign(new Error("Image is too large"), { status: 413 });
    }
    const buffer = Buffer.from(await upstream.arrayBuffer());
    if (buffer.length > 25 * 1024 * 1024) {
      throw Object.assign(new Error("Image is too large"), { status: 413 });
    }
    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "public, max-age=86400, stale-while-revalidate=604800");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.send(buffer);
  } finally {
    clearTimeout(timeout);
  }
}));

app.post("/api/thumbnail/openrouter-generate", asyncHandler(async (req, res) => {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!isOpenRouterEnabled()) {
    throw Object.assign(new Error("OpenRouter пока не включён"), { status: 503 });
  }
  const requestBody = buildOpenRouterImageRequest(req.body);
  cleanupOpenRouterJobs();
  if (openRouterJobs.size >= openRouterJobLimit) {
    throw Object.assign(new Error("Очередь генерации заполнена. Попробуйте немного позже."), { status: 503 });
  }
  const jobId = crypto.randomUUID();
  const now = Date.now();
  openRouterJobs.set(jobId, {
    status: "pending",
    ownerKey: openRouterClientKey(req),
    createdAt: now,
    updatedAt: now,
  });
  startOpenRouterJob(jobId, requestBody, apiKey);
  res.setHeader("Cache-Control", "no-store");
  res.status(202).json({ jobId, status: "pending" });
}));

app.get("/api/thumbnail/openrouter-jobs/:jobId", asyncHandler(async (req, res) => {
  cleanupOpenRouterJobs();
  const job = openRouterJobs.get(req.params.jobId);
  if (!job || job.ownerKey !== openRouterClientKey(req)) {
    throw Object.assign(new Error("Задача генерации не найдена"), { status: 404 });
  }
  res.setHeader("Cache-Control", "no-store");
  if (job.status === "failed") {
    res.once("finish", () => openRouterJobs.delete(req.params.jobId));
    res.status(job.errorStatus || 502).json({
      status: "failed",
      error: job.error,
      code: job.errorCode || 'PROVIDER_REJECTED',
      attempts: job.errorAttempts || 1,
    });
    return;
  }
  if (job.status === "complete") {
    res.json({ status: "complete", imageUrl: job.imageUrl });
    return;
  }
  res.json({ status: "pending" });
}));

app.delete("/api/thumbnail/openrouter-jobs/:jobId", (req, res) => {
  cleanupOpenRouterJobs();
  acknowledgeOpenRouterJob(openRouterJobs, req.params.jobId, openRouterClientKey(req));
  res.setHeader("Cache-Control", "no-store");
  res.status(204).end();
});

app.get("/api/card-library", asyncHandler(async (_req, res) => {
  const [rows] = await pool.query(
    "SELECT id, name, card_id, storage_path, mime_type, added_at FROM card_library ORDER BY added_at DESC",
  );
  const rowsWithStatus = await rowsWithStorageStatus(rows);
  res.json(rowsWithStatus.map((row) => ({
    id: row.id,
    name: row.name,
    cardId: row.card_id,
    storagePath: row.storage_path,
    storageUrl: publicUrl(row.storage_path),
    mimeType: row.mime_type,
    addedAt: Number(row.added_at),
    storageAvailable: Boolean(row.storage_available),
  })));
}));

app.post("/api/card-library", asyncHandler(async (req, res) => {
  const { name, cardId, imageData, mimeType = "image/png" } = req.body || {};
  const saved = await saveDataUrl(imageData, "cards", mimeType);
  const addedAt = Date.now();
  await pool.query(
    "INSERT INTO card_library (id, name, card_id, storage_path, mime_type, added_at) VALUES (?, ?, ?, ?, ?, ?)",
    [saved.id, name || "", cardId || "", saved.storagePath, saved.mimeType, addedAt],
  );
  res.json({ ...saved, name: name || "", cardId: cardId || "", addedAt });
}));

app.delete("/api/card-library/:id", asyncHandler(async (req, res) => {
  const [rows] = await pool.query("SELECT storage_path FROM card_library WHERE id = ?", [req.params.id]);
  await pool.query("DELETE FROM card_library WHERE id = ?", [req.params.id]);
  await removeStoragePath(rows[0]?.storage_path);
  res.json({ ok: true });
}));

app.get("/api/reference-library", asyncHandler(async (_req, res) => {
  const [rows] = await pool.query(
    "SELECT id, name, storage_path, mime_type, added_at, vision_analysis FROM reference_library ORDER BY added_at DESC",
  );
  const rowsWithStatus = await rowsWithStorageStatus(rows);
  res.json(rowsWithStatus.map((row) => ({
    id: row.id,
    name: row.name,
    storagePath: row.storage_path,
    storageUrl: publicUrl(row.storage_path),
    mimeType: row.mime_type,
    addedAt: Number(row.added_at),
    visionAnalysis: row.vision_analysis ?? null,
    storageAvailable: Boolean(row.storage_available),
  })));
}));

app.post("/api/reference-library", asyncHandler(async (req, res) => {
  const { name, imageData, mimeType = "image/png" } = req.body || {};
  const saved = await saveDataUrl(imageData, "references", mimeType);
  const addedAt = Date.now();
  await pool.query(
    "INSERT INTO reference_library (id, name, storage_path, mime_type, added_at, vision_analysis) VALUES (?, ?, ?, ?, ?, NULL)",
    [saved.id, name || "", saved.storagePath, saved.mimeType, addedAt],
  );
  res.json({ ...saved, name: name || "", addedAt, visionAnalysis: null });
}));

app.patch("/api/reference-library/:id/vision-analysis", asyncHandler(async (req, res) => {
  await pool.query("UPDATE reference_library SET vision_analysis = ? WHERE id = ?", [
    req.body?.visionAnalysis ?? null,
    req.params.id,
  ]);
  res.json({ ok: true });
}));

app.delete("/api/reference-library/:id", asyncHandler(async (req, res) => {
  const [rows] = await pool.query("SELECT storage_path FROM reference_library WHERE id = ?", [req.params.id]);
  await pool.query("DELETE FROM reference_library WHERE id = ?", [req.params.id]);
  await removeStoragePath(rows[0]?.storage_path);
  res.json({ ok: true });
}));

function historyRoutes(kind, table, folder, defaultMimeType) {
  app.get(`/api/${kind}`, asyncHandler(async (_req, res) => {
    const [rows] = await pool.query(`SELECT storage_path FROM \`${table}\` ORDER BY created_at DESC LIMIT 200`);
    const existingRows = await rowsWithExistingStorage(rows);
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    res.json(existingRows.slice(0, 50).map((row) => publicUrl(row.storage_path)));
  }));

  app.post(`/api/${kind}`, asyncHandler(async (req, res) => {
    const saved = await saveDataUrl(req.body?.dataUrl, folder, req.body?.mimeType || defaultMimeType);
    await pool.query(`INSERT INTO \`${table}\` (id, storage_path, created_at) VALUES (?, ?, ?)`, [
      saved.id,
      saved.storagePath,
      Date.now(),
    ]);
    res.json({ id: saved.id, storageUrl: saved.storageUrl, storagePath: saved.storagePath });
  }));

  app.delete(`/api/${kind}`, asyncHandler(async (_req, res) => {
    const [rows] = await pool.query(`SELECT storage_path FROM \`${table}\``);
    await pool.query(`DELETE FROM \`${table}\``);
    await Promise.all(rows.map((row) => removeStoragePath(row.storage_path)));
    res.json({ ok: true });
  }));
}

function favoriteRoutes(kind, table, folder, defaultMimeType) {
  app.get(`/api/${kind}`, asyncHandler(async (_req, res) => {
    const [rows] = await pool.query(`SELECT storage_path FROM \`${table}\` ORDER BY created_at DESC`);
    const existingRows = await rowsWithExistingStorage(rows);
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    res.json(existingRows.map((row) => publicUrl(row.storage_path)));
  }));

  app.post(`/api/${kind}`, asyncHandler(async (req, res) => {
    const saved = await saveDataUrl(req.body?.dataUrl, folder, req.body?.mimeType || defaultMimeType);
    await pool.query(`INSERT INTO \`${table}\` (id, storage_path, created_at) VALUES (?, ?, ?)`, [
      saved.id,
      saved.storagePath,
      Date.now(),
    ]);
    res.json({ id: saved.id, storageUrl: saved.storageUrl, storagePath: saved.storagePath });
  }));

  app.patch(`/api/${kind}/:id/choice-analysis`, asyncHandler(async (req, res) => {
    await pool.query(`UPDATE \`${table}\` SET choice_analysis = ? WHERE id = ?`, [
      req.body?.choiceAnalysis ?? null,
      req.params.id,
    ]);
    res.json({ ok: true });
  }));

  app.get(`/api/${kind}/choice-notes`, asyncHandler(async (_req, res) => {
    const [rows] = await pool.query(
      `SELECT storage_path, choice_analysis FROM \`${table}\` WHERE choice_analysis IS NOT NULL`,
    );
    const existingRows = await rowsWithExistingStorage(rows);
    const out = {};
    for (const row of existingRows) out[publicUrl(row.storage_path)] = row.choice_analysis;
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    res.json(out);
  }));

  app.delete(`/api/${kind}`, asyncHandler(async (req, res) => {
    const id = typeof req.query.id === "string" ? req.query.id : "";
    const storagePath = typeof req.query.path === "string" ? req.query.path : "";
    if (id) {
      const [rows] = await pool.query(`SELECT storage_path FROM \`${table}\` WHERE id = ?`, [id]);
      await pool.query(`DELETE FROM \`${table}\` WHERE id = ?`, [id]);
      await removeStoragePath(rows[0]?.storage_path);
    } else if (storagePath) {
      const [rows] = await pool.query(`SELECT storage_path FROM \`${table}\` WHERE storage_path = ?`, [storagePath]);
      if (rows.length) {
        await pool.query(`DELETE FROM \`${table}\` WHERE storage_path = ?`, [storagePath]);
        await removeStoragePath(rows[0].storage_path);
      }
    }
    res.json({ ok: true });
  }));
}

historyRoutes("history", "history", "history", "image/png");
favoriteRoutes("favorites", "favorites", "favorites", "image/png");
historyRoutes("video-history", "video_history", "video-history", "video/mp4");
favoriteRoutes("video-favorites", "video_favorites", "video-favorites", "video/mp4");

app.use(publicUploadPrefix, express.static(uploadRoot, {
  immutable: true,
  maxAge: "365d",
  setHeaders(res) {
    res.setHeader("X-Content-Type-Options", "nosniff");
  },
}));
app.use(publicUploadPrefix, (_req, res) => {
  res.status(404).type("text/plain").send("Upload not found");
});

app.use("/assets", express.static(path.join(distDir, "assets"), staticAssetCacheOptions));
app.use("/api", (_req, res) => {
  res.status(404).json({ error: "Not found" });
});
app.get('/chatgpt/callback', (_req, res) => {
  res.set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
  res.sendFile(path.join(distDir, 'index.html'));
});
app.use(express.static(distDir, {
  maxAge: "5m",
  setHeaders(res, filePath) {
    if (filePath.endsWith(".html")) {
      res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    }
  },
}));
app.get("*", (_req, res) => {
  res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
  res.sendFile(path.join(distDir, "index.html"));
});

app.use((err, _req, res, _next) => {
  const status = err.status || 500;
  const requestId = crypto.randomUUID();
  console.error(`[${requestId}]`, err);
  res.status(status).json({
    error: status === 500 ? "Internal server error" : err.message,
    ...(typeof err.code === 'string' ? { code: err.code } : {}),
    requestId,
  });
});

await fs.mkdir(uploadRoot, { recursive: true });
app.listen(port, "127.0.0.1", () => {
  console.log(`cover-image listening on 127.0.0.1:${port}`);
});
