import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { planDeterministic } from "../src/planner.mjs";
import { matchesCron, isTaskDue, matchesRuleCondition } from "../src/scheduler.mjs";
import { LocalJsonStore, SupabaseRestStore } from "../src/store.mjs";
import { createApiHandler } from "../api/index.mjs";

function invokeHandler(handler, { method = "GET", url = "/api/health", headers = {}, body = null }) {
  return new Promise((resolve, reject) => {
    const payload = body !== null ? JSON.stringify(body) : "";
    const req = {
      method,
      url,
      headers: {
        "content-type": "application/json",
        ...headers
      },
      body: body ?? undefined,
      async *[Symbol.asyncIterator]() {
        if (payload) yield Buffer.from(payload);
      }
    };

    const resHeaders = {};
    const chunks = [];
    const res = {
      statusCode: 200,
      setHeader(k, v) {
        resHeaders[k.toLowerCase()] = v;
      },
      end(chunk) {
        if (chunk) chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
        const text = Buffer.concat(chunks).toString("utf8");
        try {
          resolve({ status: this.statusCode, headers: resHeaders, data: text ? JSON.parse(text) : null });
        } catch (err) {
          reject(err);
        }
      }
    };

    Promise.resolve(handler(req, res)).catch(reject);
  });
}

test("Planner parses WhatsApp message, cron, delay, and event rule", () => {
  const msgPlan = planDeterministic("Open WhatsApp and message Mom that I will be home in 15 minutes");
  assert.equal(msgPlan.kind, "command");
  assert.equal(msgPlan.actions[0].type, "open_app");
  assert.equal(msgPlan.actions[1].type, "send_message");
  assert.equal(msgPlan.actions[1].recipient, "Mom");

  const delayPlan = planDeterministic("In 20 seconds turn off Do Not Disturb and notify me Ready for focus");
  assert.equal(delayPlan.kind, "schedule");
  assert.equal(delayPlan.schedule.schedule_type, "once");
  assert.equal(delayPlan.actions.length, 2);

  const cronPlan = planDeterministic("Every weekday at 8:30 AM summarize unread notifications and save to Notion");
  assert.equal(cronPlan.kind, "schedule");
  assert.equal(cronPlan.schedule.cron_expr, "30 8 * * 1-5");

  const rulePlan = planDeterministic("When I get a WhatsApp message from Mom, auto-reply In a meeting, will call soon");
  assert.equal(rulePlan.kind, "rule");
  assert.equal(rulePlan.rule.event_type, "notification");
  assert.equal(rulePlan.rule.condition.app, "WhatsApp");
  assert.equal(rulePlan.rule.condition.sender, "Mom");

  assert.equal(planDeterministic("Turn on flashlight").actions[0].type, "set_flashlight");
  assert.equal(planDeterministic("Set volume to 75%").actions[0].type, "set_volume");
  assert.equal(planDeterministic("Next song").actions[0].type, "media_control");
  assert.equal(planDeterministic("Say Good morning sir").actions[0].type, "speak_tts");
  assert.equal(planDeterministic("Ring my phone").actions[0].type, "ring_phone");
  assert.equal(planDeterministic("Take a screenshot").actions[0].type, "take_screenshot");
  assert.equal(planDeterministic("Set a timer for 5 minutes").actions[0].type, "set_timer");
  assert.equal(planDeterministic("Navigate to Patna Junction").actions[0].type, "navigate_maps");
  assert.equal(planDeterministic("Play Believer on YouTube").actions[0].type, "play_youtube");
  assert.equal(planDeterministic("Copy hello123 to clipboard").actions[0].type, "copy_clipboard");
});

test("Scheduler evaluates cron expressions and event rules accurately", () => {
  // 2026-11-20 is Friday; 03:00 UTC == 08:30 Asia/Kolkata
  const fridayMorningIST = new Date("2026-11-20T03:00:00.000Z");
  assert.equal(matchesCron("30 8 * * 1-5", fridayMorningIST, "Asia/Kolkata"), true);
  assert.equal(matchesCron("31 8 * * 1-5", fridayMorningIST, "Asia/Kolkata"), false);

  const dueOnce = isTaskDue(
    {
      enabled: true,
      schedule_type: "once",
      run_at: "2026-11-20T02:59:00.000Z",
      last_run_at: null
    },
    fridayMorningIST
  );
  assert.equal(dueOnce, true);

  assert.equal(
    matchesRuleCondition(
      { enabled: true, event_type: "telemetry", condition: { battery_lt: 20 }, cooldown_seconds: 60 },
      "telemetry",
      { battery: 15 }
    ),
    true
  );
});

test("API works end-to-end with LocalJsonStore including approval and simulator lock", async () => {
  const tmpFile = path.join(os.tmpdir(), `jarvis-test-${Date.now()}.json`);
  const store = new LocalJsonStore(tmpFile);
  const handler = createApiHandler(() => store);

  try {
    const health = await invokeHandler(handler, { method: "GET", url: "/api/health" });
    assert.equal(health.status, 200);
    assert.equal(health.data.ok, true);

    // Sensitive command awaits approval
    const cmdRes = await invokeHandler(handler, {
      method: "POST",
      url: "/api/command",
      body: { prompt: "Open WhatsApp and message Mom that I am arriving", deviceId: "sim-pixel-9" }
    });
    assert.equal(cmdRes.status, 200);
    assert.equal(cmdRes.data.command.status, "awaiting_approval");

    // Approve it
    const approveRes = await invokeHandler(handler, {
      method: "POST",
      url: `/api/commands/${cmdRes.data.command.id}/approve`
    });
    assert.equal(approveRes.status, 200);
    assert.equal(approveRes.data.command.status, "completed");

    // Lock simulator and try UI command -> blocked UI steps
    await invokeHandler(handler, {
      method: "POST",
      url: "/api/devices/sim-pixel-9/telemetry",
      body: { locked: true }
    });
    const lockedCmd = await invokeHandler(handler, {
      method: "POST",
      url: "/api/command",
      body: { prompt: "Open Spotify", deviceId: "sim-pixel-9" }
    });
    assert.equal(lockedCmd.status, 200);
    assert.equal(lockedCmd.data.command.actions[0].status, "blocked");
  } finally {
    if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
  }
});

test("API authenticates real Android devices via pairing token", async () => {
  const tmpFile = path.join(os.tmpdir(), `jarvis-auth-${Date.now()}.json`);
  const store = new LocalJsonStore(tmpFile);
  const handler = createApiHandler(() => store);

  try {
    const bad = await invokeHandler(handler, {
      method: "POST",
      url: "/api/devices/register",
      headers: { "x-jarvis-token": "wrong-token" },
      body: { deviceId: "pixel-real", name: "Pixel" }
    });
    assert.equal(bad.status, 401);

    const good = await invokeHandler(handler, {
      method: "POST",
      url: "/api/devices/register",
      headers: { "x-jarvis-token": "jarvis-d4d0cd67" },
      body: { deviceId: "pixel-real", name: "Pixel Real", telemetry: { battery: 91 } }
    });
    assert.equal(good.status, 200);
    assert.equal(good.data.device.id, "pixel-real");
  } finally {
    if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
  }
});

test("API works against mocked Supabase PostgREST backend", async () => {
  const tables = {
    jarvis_settings: [
      {
        id: "default",
        pairing_token: "jarvis-d4d0cd67",
        confirm_sensitive_actions: true,
        timezone: "Asia/Kolkata",
        llm_config: { enabled: false, model: "gpt-4o-mini", baseUrl: "", apiKey: "" }
      }
    ],
    jarvis_devices: [],
    jarvis_commands: [],
    jarvis_scheduled_tasks: [],
    jarvis_event_rules: [],
    jarvis_notifications: [],
    jarvis_cloud_vault: [],
    jarvis_logs: []
  };

  const mockServer = http.createServer(async (req, res) => {
    const u = new URL(req.url, "http://127.0.0.1");
    const table = u.pathname.replace(/^\/rest\/v1\//, "");
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : null;

    res.setHeader("Content-Type", "application/json");
    if (!tables[table]) {
      res.statusCode = 404;
      return res.end(JSON.stringify({ message: "Table not found" }));
    }

    if (req.method === "GET") {
      return res.end(JSON.stringify(tables[table]));
    }
    if (req.method === "POST") {
      const row = { created_at: new Date().toISOString(), ...body };
      const idx = tables[table].findIndex((r) => r.id && r.id === row.id);
      if (idx >= 0) tables[table][idx] = { ...tables[table][idx], ...row };
      else tables[table].push(row);
      return res.end(JSON.stringify([row]));
    }
    if (req.method === "PATCH") {
      const idFilter = u.searchParams.get("id")?.replace(/^eq\./, "");
      const idx = tables[table].findIndex((r) => r.id === idFilter);
      if (idx >= 0) tables[table][idx] = { ...tables[table][idx], ...body };
      return res.end(JSON.stringify(idx >= 0 ? [tables[table][idx]] : []));
    }
    res.end(JSON.stringify([]));
  });

  await new Promise((r) => mockServer.listen(0, "127.0.0.1", r));
  const port = mockServer.address().port;

  try {
    const supaStore = new SupabaseRestStore(`http://127.0.0.1:${port}`, "mock-service-key");
    const handler = createApiHandler(() => supaStore);

    const h = await invokeHandler(handler, { method: "GET", url: "/api/health" });
    assert.equal(h.status, 200);

    const s = await invokeHandler(handler, { method: "GET", url: "/api/state" });
    assert.equal(s.status, 200);
    assert.equal(s.data.devices[0].id, "sim-pixel-9");

    const c = await invokeHandler(handler, {
      method: "POST",
      url: "/api/command",
      body: { prompt: "Turn on Do Not Disturb and set brightness to 30%", deviceId: "sim-pixel-9" }
    });
    assert.equal(c.status, 200);
    assert.equal(c.data.command.status, "completed");
  } finally {
    mockServer.close();
  }
});
