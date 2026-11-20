/**
 * J.A.R.V.I.S. Persistence Store
 * - Uses Supabase PostgREST when SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (or ANON_KEY) are set
 * - Falls back cleanly to local JSON file storage (brain/data/db.json) for local dev/testing
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_DB_PATH = path.resolve(__dirname, "../data/db.json");

export function makeId(prefix = "id") {
  return `${prefix}_${crypto.randomBytes(5).toString("hex")}`;
}

export function defaultSimulatorDevice() {
  const now = new Date().toISOString();
  return {
    id: "sim-pixel-9",
    name: "Android Phone Simulator",
    model: "Pixel 9 (Virtual Bridge)",
    type: "simulator",
    online: true,
    last_seen_at: now,
    capabilities: {
      accessibility: true,
      notifications: true,
      dnd: true,
      brightness: true,
      alarms: true
    },
    telemetry: {
      battery: 78,
      brightness: 65,
      dnd: false,
      locked: false,
      wifi: "Home-5G",
      activeApp: "Launcher",
      batterySaver: false,
      alarms: [],
      screenMessages: []
    },
    created_at: now
  };
}

function defaultLocalState() {
  const now = new Date().toISOString();
  return {
    settings: {
      id: "default",
      pairing_token: "",
      confirm_sensitive_actions: true,
      timezone: "Asia/Kolkata",
      llm_config: {
        provider: "openai-compatible",
        baseUrl: "https://api.openai.com/v1/chat/completions",
        model: "gpt-4o-mini",
        apiKey: "",
        enabled: false
      },
      updated_at: now
    },
    devices: [defaultSimulatorDevice()],
    commands: [],
    scheduled_tasks: [],
    event_rules: [],
    notifications: [],
    cloud_vault: [
      {
        id: "vault_seed_1",
        destination: "Notion",
        title: "Jarvis Core Ready",
        content: "Connected to Jarvis Brain local persistence & Android simulator.",
        created_at: now
      }
    ],
    logs: [
      {
        id: "log_seed_1",
        level: "info",
        source: "brain",
        message: "Jarvis local store initialized.",
        meta: null,
        created_at: now
      }
    ]
  };
}

export class LocalJsonStore {
  constructor(filePath = DEFAULT_DB_PATH) {
    this.filePath = filePath;
    this.mode = "local";
  }

  _read() {
    if (!fs.existsSync(this.filePath)) {
      const initial = defaultLocalState();
      this._write(initial);
      return initial;
    }
    const parsed = JSON.parse(fs.readFileSync(this.filePath, "utf8"));
    if (!Array.isArray(parsed.devices)) throw new Error("Invalid local database: devices missing");
    if (!parsed.devices.length) parsed.devices = [defaultSimulatorDevice()];
    return parsed;
  }

  _write(data) {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const temp = `${this.filePath}.${crypto.randomUUID()}.tmp`;
    try {
      fs.writeFileSync(temp, JSON.stringify(data, null, 2), { mode: 0o600 });
      fs.renameSync(temp, this.filePath);
    } finally { fs.rmSync(temp, { force: true }); }
  }

  async getSettings() {
    return this._read().settings;
  }

  async updateSettings(patch) {
    const db = this._read();
    db.settings = {
      ...db.settings,
      ...patch,
      updated_at: new Date().toISOString()
    };
    this._write(db);
    return db.settings;
  }

  async listDevices() {
    return this._read().devices;
  }

  async getDevice(id) {
    return this._read().devices.find((d) => d.id === id) || null;
  }

  async upsertDevice(device) {
    const db = this._read();
    const idx = db.devices.findIndex((d) => d.id === device.id);
    const merged = {
      ...(idx >= 0 ? db.devices[idx] : { created_at: new Date().toISOString() }),
      ...device
    };
    if (idx >= 0) db.devices[idx] = merged;
    else db.devices.push(merged);
    this._write(db);
    return merged;
  }

  async listCommands(limit = 40) {
    return [...this._read().commands]
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .slice(0, limit);
  }

  async listPendingCommandsForDevice(deviceId) {
    return this._read().commands
      .filter((c) => c.device_id === deviceId && c.status === "queued")
      .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  }

  async getCommand(id) {
    return this._read().commands.find((c) => c.id === id) || null;
  }

  async createCommand(cmd) {
    const db = this._read();
    const now = new Date().toISOString();
    const row = {
      created_at: now,
      updated_at: now,
      ...cmd
    };
    db.commands.unshift(row);
    db.commands = db.commands.slice(0, 100);
    this._write(db);
    return row;
  }

  async updateCommand(id, patch, expected) {
    const db = this._read();
    const idx = db.commands.findIndex((c) => c.id === id);
    if (idx < 0 || (expected && db.commands[idx].status !== expected)) return null;
    db.commands[idx] = {
      ...db.commands[idx],
      ...patch,
      updated_at: new Date().toISOString()
    };
    this._write(db);
    return db.commands[idx];
  }

  async listTasks() {
    return [...this._read().scheduled_tasks].sort(
      (a, b) => new Date(b.created_at) - new Date(a.created_at)
    );
  }

  async getTask(id) {
    return this._read().scheduled_tasks.find((t) => t.id === id) || null;
  }

  async createTask(task) {
    const db = this._read();
    const row = {
      created_at: new Date().toISOString(),
      run_count: 0,
      enabled: true,
      ...task
    };
    db.scheduled_tasks.unshift(row);
    this._write(db);
    return row;
  }

  async updateTask(id, patch, count) {
    const db = this._read();
    const idx = db.scheduled_tasks.findIndex((t) => t.id === id);
    if (idx < 0 || (count !== undefined && (!db.scheduled_tasks[idx].enabled || db.scheduled_tasks[idx].run_count !== count))) return null;
    db.scheduled_tasks[idx] = { ...db.scheduled_tasks[idx], ...patch };
    this._write(db);
    return db.scheduled_tasks[idx];
  }

  async deleteTask(id) {
    const db = this._read();
    db.scheduled_tasks = db.scheduled_tasks.filter((t) => t.id !== id);
    this._write(db);
    return true;
  }

  async listRules() {
    return [...this._read().event_rules].sort(
      (a, b) => new Date(b.created_at) - new Date(a.created_at)
    );
  }

  async getRule(id) {
    return this._read().event_rules.find((r) => r.id === id) || null;
  }

  async createRule(rule) {
    const db = this._read();
    const row = {
      created_at: new Date().toISOString(),
      hit_count: 0,
      enabled: true,
      ...rule
    };
    db.event_rules.unshift(row);
    this._write(db);
    return row;
  }

  async updateRule(id, patch) {
    const db = this._read();
    const idx = db.event_rules.findIndex((r) => r.id === id);
    if (idx < 0) return null;
    db.event_rules[idx] = { ...db.event_rules[idx], ...patch };
    this._write(db);
    return db.event_rules[idx];
  }

  async deleteRule(id) {
    const db = this._read();
    db.event_rules = db.event_rules.filter((r) => r.id !== id);
    this._write(db);
    return true;
  }

  async listNotifications(limit = 30, unreadDevice) {
    return [...this._read().notifications]
      .filter(n => !unreadDevice || (!n.read && n.device_id === unreadDevice))
      .sort((a, b) => new Date(b.received_at) - new Date(a.received_at))
      .slice(0, limit);
  }

  async createNotification(notif) {
    const db = this._read();
    const row = {
      received_at: new Date().toISOString(),
      read: false,
      ...notif
    };
    db.notifications.unshift(row);
    db.notifications = db.notifications.slice(0, 100);
    this._write(db);
    return row;
  }

  async listVault(limit = 30) {
    return [...this._read().cloud_vault]
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .slice(0, limit);
  }

  async createVaultEntry(entry) {
    const db = this._read();
    const row = {
      created_at: new Date().toISOString(),
      ...entry
    };
    db.cloud_vault.unshift(row);
    this._write(db);
    return row;
  }

  async listLogs(limit = 60) {
    return [...this._read().logs]
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .slice(0, limit);
  }

  async addLog(level, source, message, meta = null) {
    const db = this._read();
    const row = {
      id: makeId("log"),
      level,
      source,
      message,
      meta,
      created_at: new Date().toISOString()
    };
    db.logs.unshift(row);
    db.logs = db.logs.slice(0, 150);
    this._write(db);
    return row;
  }
}

export class SupabaseRestStore {
  constructor(url, serviceKey) {
    this.baseUrl = String(url).replace(/\/+$/, "");
    this.apiKey = serviceKey;
    this.mode = "supabase";
  }

  async _rest(table, { method = "GET", query = "", body = null, prefer = "return=representation" } = {}) {
    const endpoint = `${this.baseUrl}/rest/v1/${table}${query ? `?${query}` : ""}`;
    const headers = {
      apikey: this.apiKey,
      Authorization: `Bearer ${this.apiKey}`,
      "Content-Type": "application/json",
      Prefer: prefer
    };
    const res = await fetch(endpoint, {
      method,
      headers,
      body: body !== null ? JSON.stringify(body) : undefined
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`Supabase ${method} ${table} failed (${res.status}): ${errText}`);
    }
    if (res.status === 204) return null;
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  }

  async getSettings() {
    const rows = await this._rest("jarvis_settings", {
      query: "id=eq.default&limit=1"
    });
    if (rows && rows.length > 0) return rows[0];
    const seeded = {
      id: "default",
      pairing_token: "",
      confirm_sensitive_actions: true,
      timezone: "Asia/Kolkata",
      llm_config: {
        provider: "openai-compatible",
        baseUrl: "https://api.openai.com/v1/chat/completions",
        model: "gpt-4o-mini",
        apiKey: "",
        enabled: false
      }
    };
    const created = await this._rest("jarvis_settings", {
      method: "POST",
      body: seeded,
      prefer: "resolution=merge-duplicates,return=representation"
    });
    return created?.[0] || seeded;
  }

  async updateSettings(patch) {
    const current = await this.getSettings();
    const updated = {
      ...current,
      ...patch,
      updated_at: new Date().toISOString()
    };
    const rows = await this._rest("jarvis_settings", {
      method: "PATCH",
      query: "id=eq.default",
      body: updated
    });
    return rows?.[0] || updated;
  }

  async listDevices() {
    const rows = await this._rest("jarvis_devices", {
      query: "order=created_at.asc"
    });
    if (!rows || rows.length === 0) {
      const sim = defaultSimulatorDevice();
      const inserted = await this.upsertDevice(sim);
      return [inserted];
    }
    return rows;
  }

  async getDevice(id) {
    const rows = await this._rest("jarvis_devices", {
      query: `id=eq.${encodeURIComponent(id)}&limit=1`
    });
    return rows?.[0] || null;
  }

  async upsertDevice(device) {
    const rows = await this._rest("jarvis_devices", {
      method: "POST",
      query: "on_conflict=id",
      body: device,
      prefer: "resolution=merge-duplicates,return=representation"
    });
    return rows?.[0] || device;
  }

  async listCommands(limit = 40) {
    return (
      (await this._rest("jarvis_commands", {
        query: `order=created_at.desc&limit=${limit}`
      })) || []
    );
  }

  async listPendingCommandsForDevice(deviceId) {
    return (
      (await this._rest("jarvis_commands", {
        query: `device_id=eq.${encodeURIComponent(deviceId)}&status=eq.queued&order=created_at.asc`
      })) || []
    );
  }

  async getCommand(id) {
    const rows = await this._rest("jarvis_commands", {
      query: `id=eq.${encodeURIComponent(id)}&limit=1`
    });
    return rows?.[0] || null;
  }

  async createCommand(cmd) {
    const rows = await this._rest("jarvis_commands", {
      method: "POST",
      body: cmd
    });
    return rows?.[0] || cmd;
  }

  async updateCommand(id, patch, expected) {
    const rows = await this._rest("jarvis_commands", {
      method: "PATCH",
      query: `id=eq.${encodeURIComponent(id)}${expected ? `&status=eq.${expected}` : ""}`,
      body: { ...patch, updated_at: new Date().toISOString() }
    });
    return rows?.[0] || null;
  }

  async listTasks() {
    return (
      (await this._rest("jarvis_scheduled_tasks", {
        query: "order=created_at.desc"
      })) || []
    );
  }

  async getTask(id) {
    const rows = await this._rest("jarvis_scheduled_tasks", {
      query: `id=eq.${encodeURIComponent(id)}&limit=1`
    });
    return rows?.[0] || null;
  }

  async createTask(task) {
    const rows = await this._rest("jarvis_scheduled_tasks", {
      method: "POST",
      body: task
    });
    return rows?.[0] || task;
  }

  async updateTask(id, patch, count) {
    const rows = await this._rest("jarvis_scheduled_tasks", {
      method: "PATCH",
      query: `id=eq.${encodeURIComponent(id)}${count !== undefined ? `&enabled=eq.true&run_count=eq.${count}` : ""}`,
      body: patch
    });
    return rows?.[0] || null;
  }

  async deleteTask(id) {
    await this._rest("jarvis_scheduled_tasks", {
      method: "DELETE",
      query: `id=eq.${encodeURIComponent(id)}`
    });
    return true;
  }

  async listRules() {
    return (
      (await this._rest("jarvis_event_rules", {
        query: "order=created_at.desc"
      })) || []
    );
  }

  async getRule(id) {
    const rows = await this._rest("jarvis_event_rules", {
      query: `id=eq.${encodeURIComponent(id)}&limit=1`
    });
    return rows?.[0] || null;
  }

  async createRule(rule) {
    const rows = await this._rest("jarvis_event_rules", {
      method: "POST",
      body: rule
    });
    return rows?.[0] || rule;
  }

  async updateRule(id, patch) {
    const rows = await this._rest("jarvis_event_rules", {
      method: "PATCH",
      query: `id=eq.${encodeURIComponent(id)}`,
      body: patch
    });
    return rows?.[0] || null;
  }

  async deleteRule(id) {
    await this._rest("jarvis_event_rules", {
      method: "DELETE",
      query: `id=eq.${encodeURIComponent(id)}`
    });
    return true;
  }

  async listNotifications(limit = 30, unreadDevice) {
    return (
      (await this._rest("jarvis_notifications", {
        query: `order=received_at.desc&limit=${limit}${unreadDevice ? `&read=eq.false&device_id=eq.${encodeURIComponent(unreadDevice)}` : ""}`
      })) || []
    );
  }

  async createNotification(notif) {
    const rows = await this._rest("jarvis_notifications", {
      method: "POST",
      body: notif
    });
    return rows?.[0] || notif;
  }

  async listVault(limit = 30) {
    return (
      (await this._rest("jarvis_cloud_vault", {
        query: `order=created_at.desc&limit=${limit}`
      })) || []
    );
  }

  async createVaultEntry(entry) {
    const rows = await this._rest("jarvis_cloud_vault", {
      method: "POST",
      body: entry
    });
    return rows?.[0] || entry;
  }

  async listLogs(limit = 60) {
    return (
      (await this._rest("jarvis_logs", {
        query: `order=created_at.desc&limit=${limit}`
      })) || []
    );
  }

  async addLog(level, source, message, meta = null) {
    const row = {
      id: makeId("log"),
      level,
      source,
      message,
      meta,
      created_at: new Date().toISOString()
    };
    const rows = await this._rest("jarvis_logs", {
      method: "POST",
      body: row
    });
    return rows?.[0] || row;
  }
}

export function createStoreFromEnv(env = process.env) {
  const url = env.SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_ANON_KEY;
  if (url && key) {
    return new SupabaseRestStore(url, key);
  }
  return new LocalJsonStore(env.JARVIS_DB_PATH || DEFAULT_DB_PATH);
}
