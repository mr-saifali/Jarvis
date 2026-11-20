/**
 * J.A.R.V.I.S. Local HTTP Server + Background Scheduler Loop
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createApiHandler } from "../api/index.mjs";
import { createStoreFromEnv } from "./store.mjs";
import { tickScheduler } from "./engine.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(__dirname, "../public");

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon"
};

const store = createStoreFromEnv(process.env);
const apiHandler = createApiHandler(() => store);

const server = http.createServer(async (req, res) => {
  const urlObj = new URL(req.url || "/", "http://localhost");
  const pathname = urlObj.pathname;

  if (pathname.startsWith("/api/")) {
    return apiHandler(req, res);
  }

  let targetPath = pathname === "/" ? "/index.html" : pathname;
  const resolved = path.resolve(PUBLIC_DIR, `.${targetPath}`);
  if (!resolved.startsWith(PUBLIC_DIR)) {
    res.statusCode = 403;
    res.end("Forbidden");
    return;
  }

  if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) {
    const ext = path.extname(resolved).toLowerCase();
    res.statusCode = 200;
    res.setHeader("Content-Type", MIME_TYPES[ext] || "application/octet-stream");
    fs.createReadStream(resolved).pipe(res);
    return;
  }

  // Fallback to index.html
  const indexHtml = path.join(PUBLIC_DIR, "index.html");
  res.statusCode = 200;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  fs.createReadStream(indexHtml).pipe(res);
});

const PORT = Number.parseInt(process.env.PORT || "3000", 10);
const HOST = process.env.HOST || "0.0.0.0";

server.listen(PORT, HOST, () => {
  console.log(`J.A.R.V.I.S. Brain running at http://${HOST}:${PORT} (store=${store.mode})`);
});

setInterval(() => {
  tickScheduler(store).catch((err) => {
    console.error("Scheduler tick error:", err.message);
  });
}, 2000);
