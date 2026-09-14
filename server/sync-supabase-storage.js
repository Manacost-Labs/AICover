import fs from "node:fs/promises";
import path from "node:path";

import dotenv from "dotenv";
import mysql from "mysql2/promise";

dotenv.config({ path: process.env.COVER_IMAGE_ENV || "/etc/cover-image/cover-image.env" });

const uploadRoot = process.env.UPLOAD_ROOT || "/var/lib/cover-image/uploads";
const supabaseBase = "https://bgtecghxivzfnvlwgdjx.supabase.co/storage/v1/object/public/images";
const tables = ["card_library", "reference_library", "history", "favorites"];

const db = await mysql.createConnection({
  host: process.env.DB_HOST || "127.0.0.1",
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USERNAME || process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_DATABASE || "cover_image",
});

let ok = 0;
let failed = 0;
let skipped = 0;

async function fetchWithTimeout(url, timeoutMs = 30000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

try {
  const paths = new Set();
  for (const table of tables) {
    const [rows] = await db.query(`SELECT storage_path FROM \`${table}\``);
    for (const row of rows) {
      if (row.storage_path) paths.add(row.storage_path);
    }
  }

  for (const storagePath of [...paths].sort()) {
    const destination = path.join(uploadRoot, storagePath);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    try {
      await fs.access(destination);
      skipped++;
      continue;
    } catch {}

    const url = `${supabaseBase}/${storagePath.split("/").map(encodeURIComponent).join("/")}`;
    const response = await fetchWithTimeout(url);
    if (!response.ok) {
      console.error(`Failed ${response.status} ${storagePath}`);
      failed++;
      continue;
    }
    await fs.writeFile(destination, Buffer.from(await response.arrayBuffer()));
    ok++;
    if (ok % 25 === 0) console.log(`downloaded ${ok}, skipped ${skipped}, failed ${failed}`);
  }

  console.log(JSON.stringify({ downloaded: ok, skipped, failed, total: ok + skipped + failed }, null, 2));
} finally {
  await db.end();
}

if (failed > 0) process.exitCode = 1;
