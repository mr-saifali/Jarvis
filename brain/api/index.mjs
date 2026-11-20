/**
 * J.A.R.V.I.S. Brain Serverless & HTTP API Handler
 * Runs both as Vercel Serverless Function (/api/index.mjs) and inside src/server.mjs
 */
import { createStoreFromEnv, defaultSimulatorDevice, makeId } from "../src/store.mjs";
import {
  approveCommand,
  cancelCommand,
  dispatchCommand,
  evaluateRules,
  tickScheduler
} from "../src/engine.mjs";

const APK_DIRECT_URL =
  process.env.JARVIS_APK_URL ||
  "https://github.com/mr-saifali/Jarvis/releases/download/latest/jarvis-agent.apk";
const APK_FALLBACK_URL = "https://github.com/mr-saifali/Jarvis/releases";

function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization,X-Jarvis-Token");
  res.end(JSON.stringify(payload));
}

async function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") {
    try {
      return JSON.parse(req.body);
    } catch {
      return {};
    }
  }
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function extractToken(req, urlObj, body = {}) {
  const headerToken = req.headers["x-jarvis-token"];
  if (headerToken) return String(headerToken).trim();
  const auth = req.headers["authorization"];
  if (auth && auth.startsWith("Bearer ")) return auth.slice(7).trim();
  const queryToken = urlObj.searchParams.get("token");
  if (queryToken) return queryToken.trim();
  if (body?.token) return String(body.token).trim();
  return "";
}

async function verifyDeviceToken(store, req, urlObj, body) {
  const settings = await store.getSettings();
  const provided = extractToken(req, urlObj, body);
  if (!provided || provided !== settings.pairing_token) {
    return false;
  }
  return true;
}

export function createApiHandler(storeFactory = () => createStoreFromEnv(process.env)) {
  return async function handler(req, res) {
    if (req.method === "OPTIONS") {
      res.statusCode = 204;
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization,X-Jarvis-Token");
      res.end();
      return;
    }

    const store = storeFactory();
    const urlObj = new URL(req.url || "/", "http://localhost");
    const pathname = urlObj.pathname.replace(/\/+$/, "") || "/";
    const method = (req.method || "GET").toUpperCase();

    try {
      // Direct Android APK download redirect
      if ((method === "GET" || method === "HEAD") && pathname === "/api/download-apk") {
        let targetUrl = APK_DIRECT_URL;
        try {
          const ctrl = new AbortController();
          const timer = setTimeout(() => ctrl.abort(), 3000);
          const ghRes = await fetch(
            "https://api.github.com/repos/mr-saifali/Jarvis/releases/tags/latest",
            {
              headers: { Accept: "application/vnd.github+json", "User-Agent": "jarvis-brain" },
              signal: ctrl.signal
            }
          );
          clearTimeout(timer);
          if (ghRes.ok) {
            const rel = await ghRes.json();
            const apkAsset = (rel.assets || []).find((a) => a.name?.endsWith(".apk"));
            if (apkAsset?.browser_download_url) {
              targetUrl = apkAsset.browser_download_url;
            }
          } else {
            targetUrl = APK_FALLBACK_URL;
          }
        } catch {
          targetUrl = APK_DIRECT_URL;
        }
        res.statusCode = 302;
        res.setHeader("Location", targetUrl);
        res.setHeader("Cache-Control", "no-store");
        res.end();
        return;
      }

      // Health check
      if ((method === "GET" || method === "HEAD") && pathname === "/api/health") {
        const hasSupabase = Boolean(
          process.env.SUPABASE_URL &&
            (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY)
        );
        return sendJson(res, 200, {
          ok: true,
          service: "jarvis-brain",
          runtime: process.env.VERCEL ? "vercel" : "node",
          supabase: hasSupabase,
          storage: store.mode,
          apkUrl: APK_DIRECT_URL,
          timestamp: new Date().toISOString()
        });
      }

      // Full dashboard state
      if (method === "GET" && pathname === "/api/state") {
        // Trigger any due scheduled tasks lazily (essential for serverless Vercel)
        await tickScheduler(store).catch(() => {});

        const [settings, devices, commands, tasks, rules, notifications, vault, logs] =
          await Promise.all([
            store.getSettings(),
            store.listDevices(),
            store.listCommands(40),
            store.listTasks(),
            store.listRules(),
            store.listNotifications(30),
            store.listVault(30),
            store.listLogs(60)
          ]);

        const safeSettings = {
          ...settings,
          llm_config: {
            ...(settings.llm_config || {}),
            apiKey: settings.llm_config?.apiKey ? "••••••••" : ""
          }
        };

        return sendJson(res, 200, {
          ok: true,
          apkUrl: APK_DIRECT_URL,
          settings: safeSettings,
          devices,
          commands,
          tasks,
          rules,
          notifications,
          vault,
          logs
        });
      }

      // Manual/Cron scheduler tick
      if ((method === "GET" || method === "POST") && pathname === "/api/cron/tick") {
        const fired = await tickScheduler(store);
        return sendJson(res, 200, { ok: true, fired });
      }

      // Submit natural language command
      if (method === "POST" && pathname === "/api/command") {
        const body = await readBody(req);
        const prompt = String(body.prompt || "").trim();
        if (!prompt) {
          return sendJson(res, 400, { ok: false, error: "Command prompt is required" });
        }
        const result = await dispatchCommand(store, {
          prompt,
          deviceId: body.deviceId || "auto",
          source: body.source || "user"
        });
        return sendJson(res, 200, { ok: true, ...result });
      }

      // Approve sensitive command
      const approveMatch = pathname.match(/^\/api\/commands\/([^/]+)\/approve$/);
      if (method === "POST" && approveMatch) {
        const updated = await approveCommand(store, decodeURIComponent(approveMatch[1]));
        if (!updated) return sendJson(res, 404, { ok: false, error: "Command not found" });
        return sendJson(res, 200, { ok: true, command: updated });
      }

      // Cancel command
      const cancelMatch = pathname.match(/^\/api\/commands\/([^/]+)\/cancel$/);
      if (method === "POST" && cancelMatch) {
        const updated = await cancelCommand(store, decodeURIComponent(cancelMatch[1]));
        if (!updated) return sendJson(res, 404, { ok: false, error: "Command not found" });
        return sendJson(res, 200, { ok: true, command: updated });
      }

      // Toggle or delete scheduled task
      const taskToggleMatch = pathname.match(/^\/api\/tasks\/([^/]+)\/toggle$/);
      if (method === "POST" && taskToggleMatch) {
        const id = decodeURIComponent(taskToggleMatch[1]);
        const task = await store.getTask(id);
        if (!task) return sendJson(res, 404, { ok: false, error: "Task not found" });
        const updated = await store.updateTask(id, { enabled: !task.enabled });
        return sendJson(res, 200, { ok: true, task: updated });
      }

      const taskDeleteMatch = pathname.match(/^\/api\/tasks\/([^/]+)$/);
      if (method === "DELETE" && taskDeleteMatch) {
        await store.deleteTask(decodeURIComponent(taskDeleteMatch[1]));
        return sendJson(res, 200, { ok: true });
      }

      // Toggle or delete event rule
      const ruleToggleMatch = pathname.match(/^\/api\/rules\/([^/]+)\/toggle$/);
      if (method === "POST" && ruleToggleMatch) {
        const id = decodeURIComponent(ruleToggleMatch[1]);
        const rule = await store.getRule(id);
        if (!rule) return sendJson(res, 404, { ok: false, error: "Rule not found" });
        const updated = await store.updateRule(id, { enabled: !rule.enabled });
        return sendJson(res, 200, { ok: true, rule: updated });
      }

      const ruleDeleteMatch = pathname.match(/^\/api\/rules\/([^/]+)$/);
      if (method === "DELETE" && ruleDeleteMatch) {
        await store.deleteRule(decodeURIComponent(ruleDeleteMatch[1]));
        return sendJson(res, 200, { ok: true });
      }

      // Update Brain settings
      if (method === "POST" && pathname === "/api/settings") {
        const body = await readBody(req);
        const current = await store.getSettings();
        const patch = {};
        if (typeof body.confirm_sensitive_actions === "boolean") {
          patch.confirm_sensitive_actions = body.confirm_sensitive_actions;
        }
        if (typeof body.timezone === "string" && body.timezone.trim()) {
          patch.timezone = body.timezone.trim();
        }
        if (body.llm_config && typeof body.llm_config === "object") {
          const nextKey =
            body.llm_config.apiKey && body.llm_config.apiKey !== "••••••••"
              ? body.llm_config.apiKey
              : current.llm_config?.apiKey || "";
          patch.llm_config = {
            ...(current.llm_config || {}),
            ...body.llm_config,
            apiKey: nextKey
          };
        }
        const settings = await store.updateSettings(patch);
        await store.addLog("info", "settings", "Updated Brain settings.");
        return sendJson(res, 200, {
          ok: true,
          settings: {
            ...settings,
            llm_config: {
              ...(settings.llm_config || {}),
              apiKey: settings.llm_config?.apiKey ? "••••••••" : ""
            }
          }
        });
      }

      // Device telemetry update (for Simulator UI)
      const simTelMatch = pathname.match(/^\/api\/devices\/([^/]+)\/telemetry$/);
      if (method === "POST" && simTelMatch) {
        const deviceId = decodeURIComponent(simTelMatch[1]);
        const body = await readBody(req);
        let device = await store.getDevice(deviceId);
        if (!device && deviceId === "sim-pixel-9") {
          device = defaultSimulatorDevice();
        }
        if (!device) return sendJson(res, 404, { ok: false, error: "Device not found" });

        const nextTelemetry = {
          ...(device.telemetry || {}),
          ...body
        };
        const updated = await store.upsertDevice({
          ...device,
          online: true,
          last_seen_at: new Date().toISOString(),
          telemetry: nextTelemetry
        });
        const triggered = await evaluateRules(store, "telemetry", nextTelemetry, device.id);
        return sendJson(res, 200, { ok: true, device: updated, triggered });
      }

      // Real Android device registration (pairing token required)
      if (method === "POST" && pathname === "/api/devices/register") {
        const body = await readBody(req);
        if (!(await verifyDeviceToken(store, req, urlObj, body))) {
          return sendJson(res, 401, { ok: false, error: "Invalid pairing token" });
        }
        const id = String(body.deviceId || body.id || makeId("android"));
        const device = await store.upsertDevice({
          id,
          name: String(body.name || body.model || "Android Phone"),
          model: String(body.model || "Android"),
          type: "android",
          online: true,
          last_seen_at: new Date().toISOString(),
          capabilities: body.capabilities || {
            accessibility: true,
            notifications: true
          },
          telemetry: body.telemetry || {}
        });
        await store.addLog("info", "bridge", `Device registered: ${device.name} (${device.id})`);
        return sendJson(res, 200, { ok: true, device });
      }

      // Real Android device heartbeat + poll pending commands (pairing token required)
      if (method === "POST" && pathname === "/api/devices/heartbeat") {
        const body = await readBody(req);
        if (!(await verifyDeviceToken(store, req, urlObj, body))) {
          return sendJson(res, 401, { ok: false, error: "Invalid pairing token" });
        }
        await tickScheduler(store).catch(() => {});

        const id = String(body.deviceId || body.id || "");
        if (!id) return sendJson(res, 400, { ok: false, error: "deviceId is required" });

        const existing = await store.getDevice(id);
        const telemetry = {
          ...(existing?.telemetry || {}),
          ...(body.telemetry || {})
        };
        const device = await store.upsertDevice({
          id,
          name: String(body.name || existing?.name || body.model || "Android Phone"),
          model: String(body.model || existing?.model || "Android"),
          type: "android",
          online: true,
          last_seen_at: new Date().toISOString(),
          capabilities: body.capabilities || existing?.capabilities || {},
          telemetry
        });

        await evaluateRules(store, "telemetry", telemetry, device.id);
        const pending = await store.listPendingCommandsForDevice(device.id);
        return sendJson(res, 200, { ok: true, device, commands: pending });
      }

      // Poll pending commands for Android device (pairing token required)
      if (method === "GET" && pathname === "/api/commands/poll") {
        if (!(await verifyDeviceToken(store, req, urlObj))) {
          return sendJson(res, 401, { ok: false, error: "Invalid pairing token" });
        }
        await tickScheduler(store).catch(() => {});
        const deviceId = urlObj.searchParams.get("deviceId") || "";
        if (!deviceId) {
          return sendJson(res, 400, { ok: false, error: "deviceId query param required" });
        }
        const pending = await store.listPendingCommandsForDevice(deviceId);
        return sendJson(res, 200, { ok: true, commands: pending });
      }

      // Acknowledge executed command from Android device (pairing token required)
      if (method === "POST" && pathname === "/api/commands/ack") {
        const body = await readBody(req);
        if (!(await verifyDeviceToken(store, req, urlObj, body))) {
          return sendJson(res, 401, { ok: false, error: "Invalid pairing token" });
        }
        const commandId = String(body.commandId || "");
        if (!commandId) {
          return sendJson(res, 400, { ok: false, error: "commandId is required" });
        }
        const updated = await store.updateCommand(commandId, {
          status: body.status || "completed",
          result_message: body.resultMessage || "Executed on Android device",
          ...(Array.isArray(body.actions) ? { actions: body.actions } : {})
        });
        if (!updated) return sendJson(res, 404, { ok: false, error: "Command not found" });
        await store.addLog(
          updated.status === "failed" ? "error" : "info",
          "android",
          `Command ${commandId} -> ${updated.status}: ${updated.result_message}`
        );
        return sendJson(res, 200, { ok: true, command: updated });
      }

      // Notification ingestion (from Simulator OR Android NotificationListenerService)
      if (method === "POST" && pathname === "/api/notifications") {
        const body = await readBody(req);
        const deviceId = String(body.deviceId || "sim-pixel-9");
        // Require token if sent from a non-simulator device
        if (deviceId !== "sim-pixel-9" && !body.fromSimulator) {
          if (!(await verifyDeviceToken(store, req, urlObj, body))) {
            return sendJson(res, 401, { ok: false, error: "Invalid pairing token" });
          }
        }
        const notif = await store.createNotification({
          id: makeId("notif"),
          device_id: deviceId,
          app: String(body.app || "System"),
          sender: String(body.sender || "Notification"),
          text: String(body.text || ""),
          read: false
        });
        await store.addLog(
          "info",
          "notification",
          `[${notif.app}] ${notif.sender}: ${notif.text}`
        );
        const triggered = await evaluateRules(store, "notification", notif, deviceId);
        return sendJson(res, 200, { ok: true, notification: notif, triggered });
      }

      return sendJson(res, 404, { ok: false, error: `Not found: ${method} ${pathname}` });
    } catch (err) {
      return sendJson(res, 500, {
        ok: false,
        error: err?.message || "Internal server error"
      });
    }
  };
}

const defaultHandler = createApiHandler();
export default defaultHandler;
