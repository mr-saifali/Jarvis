/* J.A.R.V.I.S. Notion-Style Phone Control Workspace */

const DEFAULT_APK_URL =
  "https://github.com/mr-saifali/Jarvis/releases/download/latest/jarvis-agent.apk";

const state = {
  data: null,
  selectedDeviceId: "auto",
  activePage: "control",
  toastTimer: null
};

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

function esc(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmtTime(iso) {
  if (!iso) return "--:--";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "--:--";
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function showToast(msg) {
  const el = $("#toast");
  if (!el) return;
  el.textContent = msg;
  el.classList.remove("hidden");
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => el.classList.add("hidden"), 3000);
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.ok === false) {
    throw new Error(json.error || `Request failed (${res.status})`);
  }
  return json;
}

function getRealDevices() {
  return (state.data?.devices || []).filter((d) => d.type !== "simulator");
}

function getSelectedDevice() {
  const devices = state.data?.devices || [];
  if (state.selectedDeviceId && state.selectedDeviceId !== "auto") {
    const exact = devices.find((d) => d.id === state.selectedDeviceId);
    if (exact) return exact;
  }
  const onlineReal = devices.find((d) => d.type !== "simulator" && d.online);
  return onlineReal || devices.find((d) => d.type !== "simulator") || devices[0] || null;
}

function syncApkLinks() {
  const apkUrl = state.data?.apkUrl || DEFAULT_APK_URL;
  $$(".apk-download-link").forEach((a) => {
    a.setAttribute("href", apkUrl);
  });
}

function renderDeviceUI() {
  const devices = state.data?.devices || [];
  const realDevices = getRealDevices();
  const active = getSelectedDevice();

  // Auto-prefer real device if user still has default "auto" or simulator when real device connects
  const select = $("#device-selector");
  if (select) {
    const options = [
      `<option value="auto" ${state.selectedDeviceId === "auto" ? "selected" : ""}>Auto (${
        realDevices.length > 0 ? "Prefer Real Phone" : "Virtual Test Phone"
      })</option>`,
      ...devices.map(
        (d) =>
          `<option value="${esc(d.id)}" ${d.id === state.selectedDeviceId ? "selected" : ""}>${esc(
            d.name
          )} (${d.type === "simulator" ? "Test" : d.online ? "Online" : "Offline"})</option>`
      )
    ];
    select.innerHTML = options.join("");
  }

  // Setup callout visibility: show prominently until a real phone is paired
  const hasReal = realDevices.length > 0;
  $("#setup-callout").classList.toggle("hidden", hasReal);
  $("#real-phone-strip").classList.toggle("hidden", !active);

  const onlinePill = $("#device-online-pill");
  if (active) {
    const isReal = active.type !== "simulator";
    $("#active-device-summary").textContent = isReal
      ? `Connected to ${active.name} (${active.model || "Android"})`
      : "No real phone paired yet — running on Virtual Test Phone until you install the APK.";
    onlinePill.textContent = active.online
      ? isReal
        ? "Phone Online"
        : "Test Mode"
      : "Phone Offline";
    onlinePill.classList.toggle("online", Boolean(active.online && isReal));

    const tel = active.telemetry || {};
    $("#strip-name").textContent = active.name || "Android";
    $("#strip-battery").textContent =
      typeof tel.battery === "number"
        ? `${tel.battery}%${tel.charging ? " ⚡" : ""}`
        : "--%";
    $("#strip-volume").textContent = typeof tel.volume === "number" ? `${tel.volume}%` : "--%";
    $("#strip-brightness").textContent =
      typeof tel.brightness === "number" ? `${tel.brightness}%` : "--%";
    $("#strip-dnd").textContent = tel.dnd ? "On" : "Off";
    $("#strip-lock").textContent = tel.locked ? "Locked" : "Unlocked";

    if (typeof tel.brightness === "number") {
      $("#quick-brightness").value = tel.brightness;
      $("#quick-bright-val").textContent = `${tel.brightness}%`;
    }
    if (typeof tel.volume === "number") {
      $("#quick-volume").value = tel.volume;
      $("#quick-vol-val").textContent = `${tel.volume}%`;
    }
  }
}

function renderHeaderAndConnectInfo() {
  const settings = state.data?.settings;
  if (!settings) return;

  $("#safety-toggle").checked = Boolean(settings.confirm_sensitive_actions);
  $("#connection-label").textContent = "Brain Online";
  $("#status-dot").classList.add("online");
  $("#status-dot").classList.remove("offline");

  const origin = window.location.origin;
  const token = settings.pairing_token || "jarvis-d4d0cd67";
  $("#inline-origin").textContent = origin;
  $("#inline-token").textContent = token;
  $("#connect-origin").textContent = origin;
  $("#connect-token").textContent = token;
  $("#connect-curl").textContent =
`curl -X POST ${origin}/api/devices/register \\
  -H "Content-Type: application/json" \\
  -H "X-Jarvis-Token: ${token}" \\
  -d '{"deviceId":"my-phone","name":"My Android","model":"Android","telemetry":{"battery":88,"wifi":"Home-5G"}}'`;
}

function renderCommands() {
  const commands = state.data?.commands || [];
  $("#count-cmds").textContent = commands.length;
  const list = $("#commands-list");
  if (commands.length === 0) {
    list.innerHTML = `<div class="doc-row"><div class="doc-sub">No commands yet. Use the bar above or tap any quick control!</div></div>`;
    return;
  }

  list.innerHTML = commands
    .map((cmd) => {
      const steps = (cmd.actions || [])
        .map((a) => `<span class="step-pill">${esc(a.label || a.type)} (${esc(a.status || cmd.status)})</span>`)
        .join("");

      const approvals =
        cmd.status === "awaiting_approval"
          ? `<div class="row-actions">
              <button class="btn btn-sm btn-success" data-approve="${esc(cmd.id)}">Approve &amp; Run</button>
              <button class="btn btn-sm btn-danger" data-cancel="${esc(cmd.id)}">Cancel</button>
             </div>`
          : "";

      return `
        <div class="doc-row">
          <div class="doc-row-top">
            <div>
              <div class="doc-title">${esc(cmd.prompt)}</div>
              <div class="doc-sub">${esc(cmd.device_name || cmd.device_id)} &bull; ${fmtTime(
        cmd.created_at
      )} &bull; ${esc(cmd.result_message || "")}</div>
            </div>
            <span class="badge badge-${esc(cmd.status)}">${esc(cmd.status.replace("_", " "))}</span>
          </div>
          ${steps ? `<div class="step-pills">${steps}</div>` : ""}
          ${approvals}
        </div>
      `;
    })
    .join("");
}

function renderTasks() {
  const tasks = state.data?.tasks || [];
  $("#count-tasks").textContent = tasks.length;
  const list = $("#tasks-list");
  if (tasks.length === 0) {
    list.innerHTML = `<div class="doc-row"><div class="doc-sub">No scheduled tasks yet. Create one above!</div></div>`;
    return;
  }

  list.innerHTML = tasks
    .map((t) => {
      const sched =
        t.schedule_type === "cron"
          ? `Cron: ${t.cron_expr}`
          : t.schedule_type === "interval"
            ? `Every ${t.interval_seconds}s`
            : `Once at ${fmtTime(t.run_at)}`;
      return `
        <div class="doc-row">
          <div class="doc-row-top">
            <div>
              <div class="doc-title">${esc(t.name)}</div>
              <div class="doc-sub">${esc(sched)} &bull; Runs: ${t.run_count || 0}</div>
            </div>
            <span class="badge ${t.enabled ? "badge-completed" : "badge-cancelled"}">${
        t.enabled ? "active" : "paused"
      }</span>
          </div>
          <div class="row-actions">
            <button class="btn btn-sm btn-outline" data-toggle-task="${esc(t.id)}">${
        t.enabled ? "Pause" : "Resume"
      }</button>
            <button class="btn btn-sm btn-danger" data-delete-task="${esc(t.id)}">Delete</button>
          </div>
        </div>
      `;
    })
    .join("");
}

function renderRules() {
  const rules = state.data?.rules || [];
  $("#count-rules").textContent = rules.length;
  const list = $("#rules-list");
  if (rules.length === 0) {
    list.innerHTML = `<div class="doc-row"><div class="doc-sub">No automation rules yet. Create one above!</div></div>`;
    return;
  }

  list.innerHTML = rules
    .map(
      (r) => `
      <div class="doc-row">
        <div class="doc-row-top">
          <div>
            <div class="doc-title">${esc(r.name)}</div>
            <div class="doc-sub">Trigger: ${esc(r.event_type)} &bull; ${esc(
        JSON.stringify(r.condition)
      )} &bull; Hits: ${r.hit_count || 0}</div>
          </div>
          <span class="badge ${r.enabled ? "badge-completed" : "badge-cancelled"}">${
        r.enabled ? "active" : "paused"
      }</span>
        </div>
        <div class="row-actions">
          <button class="btn btn-sm btn-outline" data-toggle-rule="${esc(r.id)}">${
        r.enabled ? "Pause" : "Resume"
      }</button>
          <button class="btn btn-sm btn-danger" data-delete-rule="${esc(r.id)}">Delete</button>
        </div>
      </div>
    `
    )
    .join("");
}

function renderVault() {
  const vault = state.data?.vault || [];
  $("#count-vault").textContent = vault.length;
  const list = $("#vault-list");
  if (vault.length === 0) {
    list.innerHTML = `<div class="doc-row"><div class="doc-sub">No saved notes yet.</div></div>`;
    return;
  }

  list.innerHTML = vault
    .map(
      (v) => `
      <div class="doc-row">
        <div class="doc-row-top">
          <div>
            <div class="doc-title">${esc(v.title)}</div>
            <div class="doc-sub">${esc(v.destination)} &bull; ${fmtTime(v.created_at)}</div>
          </div>
          <span class="badge badge-completed">${esc(v.destination)}</span>
        </div>
        <div class="doc-sub" style="margin-top:8px;white-space:pre-wrap;color:var(--text);">${esc(
          v.content
        )}</div>
      </div>
    `
    )
    .join("");
}

function renderLogs() {
  const logs = state.data?.logs || [];
  $("#logs-list").innerHTML =
    logs.length === 0
      ? `<div class="doc-sub">No activity logs yet.</div>`
      : logs
          .map(
            (l) => `
          <div class="log-line">
            <span class="log-time">${fmtTime(l.created_at)}</span>
            <span class="log-src">[${esc(l.source)}]</span>
            <span class="log-${esc(l.level)}">${esc(l.message)}</span>
          </div>
        `
          )
          .join("");
}

function renderAll() {
  if (!state.data) return;
  syncApkLinks();
  renderHeaderAndConnectInfo();
  renderDeviceUI();
  renderCommands();
  renderTasks();
  renderRules();
  renderVault();
  renderLogs();
}

async function refreshState() {
  try {
    state.data = await api("/api/state");
    renderAll();
  } catch (err) {
    $("#connection-label").textContent = "Brain Offline";
    $("#status-dot").classList.remove("online");
    $("#status-dot").classList.add("offline");
    console.error("Failed to load state:", err);
  }
}

async function sendCommand(prompt) {
  const trimmed = prompt.trim();
  if (!trimmed) return;
  try {
    const res = await api("/api/command", {
      method: "POST",
      body: JSON.stringify({ prompt: trimmed, deviceId: state.selectedDeviceId })
    });
    showToast(res.summary || "Sent to Jarvis");
    $("#command-input").value = "";
    await refreshState();
  } catch (err) {
    showToast(`Error: ${err.message}`);
  }
}

function switchPage(page) {
  state.activePage = page;
  $$(".nav-item").forEach((b) => b.classList.toggle("active", b.getAttribute("data-page") === page));
  $$(".page").forEach((p) => p.classList.toggle("active", p.id === `page-${page}`));
  $("#sidebar").classList.remove("open");
  $("#sidebar-backdrop").classList.add("hidden");
}

function copyText(text, label) {
  if (!navigator.clipboard) {
    showToast(text);
    return;
  }
  navigator.clipboard.writeText(text).then(
    () => showToast(`${label} copied`),
    () => showToast(text)
  );
}

function applySavedTheme() {
  const saved = localStorage.getItem("jarvis_theme");
  const isDark = saved === "dark";
  document.body.classList.toggle("dark", isDark);
  $("#btn-theme-toggle").textContent = isDark ? "Light" : "Dark";
}

function setupListeners() {
  // Navigation
  $$(".nav-item[data-page]").forEach((btn) => {
    btn.addEventListener("click", () => switchPage(btn.getAttribute("data-page")));
  });

  // Mobile menu
  $("#btn-mobile-menu").addEventListener("click", () => {
    $("#sidebar").classList.add("open");
    $("#sidebar-backdrop").classList.remove("hidden");
  });
  $("#btn-close-menu").addEventListener("click", () => {
    $("#sidebar").classList.remove("open");
    $("#sidebar-backdrop").classList.add("hidden");
  });
  $("#sidebar-backdrop").addEventListener("click", () => {
    $("#sidebar").classList.remove("open");
    $("#sidebar-backdrop").classList.add("hidden");
  });

  // Theme toggle
  $("#btn-theme-toggle").addEventListener("click", () => {
    const nextDark = !document.body.classList.contains("dark");
    document.body.classList.toggle("dark", nextDark);
    localStorage.setItem("jarvis_theme", nextDark ? "dark" : "light");
    $("#btn-theme-toggle").textContent = nextDark ? "Light" : "Dark";
  });

  // Main command form
  $("#command-form").addEventListener("submit", (e) => {
    e.preventDefault();
    sendCommand($("#command-input").value);
  });

  // Quick command pills
  $$(".pill-btn[data-cmd]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const cmd = btn.getAttribute("data-cmd");
      $("#command-input").value = cmd;
      sendCommand(cmd);
    });
  });

  $$("[data-quick-cmd]").forEach((btn) => {
    btn.addEventListener("click", () => {
      sendCommand(btn.getAttribute("data-quick-cmd"));
    });
  });

  // Quick open custom app
  $("#quick-open-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const app = $("#quick-app-name").value.trim();
    if (!app) return;
    $("#quick-app-name").value = "";
    sendCommand(`Open ${app}`);
  });

  // Quick brightness slider
  $("#quick-brightness").addEventListener("input", (e) => {
    $("#quick-bright-val").textContent = `${e.target.value}%`;
  });
  $("#quick-brightness").addEventListener("change", (e) => {
    sendCommand(`Set brightness to ${e.target.value}%`);
  });

  // Quick volume slider
  $("#quick-volume").addEventListener("input", (e) => {
    $("#quick-vol-val").textContent = `${e.target.value}%`;
  });
  $("#quick-volume").addEventListener("change", (e) => {
    sendCommand(`Set volume to ${e.target.value}%`);
  });

  // Quick message / SMS / call / speak / notification
  $("#quick-msg-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const kind = $("#quick-msg-type").value;
    const to = $("#quick-msg-to").value.trim();
    const msg = $("#quick-msg-text").value.trim();
    let prompt = "";
    if (kind === "call") {
      if (!to) return showToast("Enter phone number or contact name");
      prompt = `Call ${to}`;
    } else if (kind === "speak") {
      if (!msg) return showToast("Enter text for Jarvis to speak");
      prompt = `Say ${msg}`;
    } else if (kind === "notify") {
      if (!msg) return showToast("Enter notification message");
      prompt = `Notify me ${msg}`;
    } else if (kind === "sms") {
      if (!to || !msg) return showToast("Enter recipient and message");
      prompt = `Send SMS to ${to} saying ${msg}`;
    } else {
      if (!to || !msg) return showToast("Enter recipient and message");
      prompt = `Open WhatsApp and message ${to} that ${msg}`;
    }
    $("#quick-msg-text").value = "";
    sendCommand(prompt);
  });

  // Quick alarm
  $("#quick-alarm-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const val = $("#quick-alarm-time").value || "06:30";
    sendCommand(`Set an alarm for ${val}`);
  });

  // Quick Maps / YouTube launch
  $("#quick-nav-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const q = $("#quick-nav-query").value.trim();
    if (!q) return showToast("Enter a place to navigate to");
    $("#quick-nav-query").value = "";
    sendCommand(`Navigate to ${q}`);
  });
  $("#btn-quick-yt").addEventListener("click", () => {
    const q = $("#quick-nav-query").value.trim();
    if (!q) return showToast("Enter a YouTube search query");
    $("#quick-nav-query").value = "";
    sendCommand(`Play ${q} on YouTube`);
  });

  // Schedule builder form
  $("#sched-type").addEventListener("change", (e) => {
    const isDelay = e.target.value === "delay";
    $("#sched-time").classList.toggle("hidden", isDelay);
    $("#sched-minutes").classList.toggle("hidden", !isDelay);
  });

  $("#schedule-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const type = $("#sched-type").value;
    const action = $("#sched-prompt").value.trim();
    if (!action) return showToast("Enter an action for the schedule");
    let prompt = "";
    if (type === "delay") {
      const mins = Math.max(1, Number($("#sched-minutes").value || 5));
      prompt = `In ${mins} minutes ${action}`;
    } else if (type === "weekday") {
      const t = $("#sched-time").value || "08:30";
      prompt = `Every weekday at ${t} ${action}`;
    } else {
      const t = $("#sched-time").value || "08:30";
      prompt = `Every day at ${t} ${action}`;
    }
    $("#sched-prompt").value = "";
    sendCommand(prompt);
  });

  // Rule builder form
  $("#rule-trigger").addEventListener("change", (e) => {
    const val = e.target.value;
    const input = $("#rule-cond-val");
    if (val === "battery") input.placeholder = "Battery threshold (e.g. 20)";
    else if (val === "wifi") input.placeholder = "Wi-Fi network name (e.g. Office-5G)";
    else input.placeholder = "Sender name (e.g. Mom)";
  });

  $("#rule-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const trigger = $("#rule-trigger").value;
    const cond = $("#rule-cond-val").value.trim();
    const action = $("#rule-action").value.trim();
    if (!action) return showToast("Enter what Jarvis should do");
    let prompt = "";
    if (trigger === "battery") {
      prompt = `When battery drops below ${cond || "20"}%, ${action}`;
    } else if (trigger === "wifi") {
      prompt = `When Wi-Fi connects to ${cond || "Office-5G"}, ${action}`;
    } else {
      prompt = cond
        ? `When I get a WhatsApp message from ${cond}, ${action}`
        : `When I get a WhatsApp message, ${action}`;
    }
    $("#rule-action").value = "";
    sendCommand(prompt);
  });

  // Copy buttons
  $("#btn-copy-inline-token").addEventListener("click", () => {
    copyText($("#inline-token").textContent, "Pairing Token");
  });
  $("#btn-copy-origin").addEventListener("click", () => {
    copyText($("#connect-origin").textContent, "Brain URL");
  });
  $("#btn-copy-token").addEventListener("click", () => {
    copyText($("#connect-token").textContent, "Pairing Token");
  });

  // Safety toggle & device selector
  $("#safety-toggle").addEventListener("change", async (e) => {
    await api("/api/settings", {
      method: "POST",
      body: JSON.stringify({ confirm_sensitive_actions: e.target.checked })
    });
    showToast("Safety setting saved");
    await refreshState();
  });

  $("#device-selector").addEventListener("change", (e) => {
    state.selectedDeviceId = e.target.value;
    renderDeviceUI();
  });

  // Settings form
  $("#settings-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    await api("/api/settings", {
      method: "POST",
      body: JSON.stringify({
        timezone: $("#set-timezone").value.trim() || "Asia/Kolkata",
        llm_config: {
          enabled: $("#set-llm-enabled").checked,
          baseUrl: $("#set-llm-url").value.trim(),
          model: $("#set-llm-model").value.trim(),
          apiKey: $("#set-llm-key").value.trim()
        }
      })
    });
    showToast("Settings saved");
    await refreshState();
  });

  // Populate settings inputs once loaded
  const populateSettingsOnce = setInterval(() => {
    const s = state.data?.settings;
    if (!s) return;
    $("#set-timezone").value = s.timezone || "Asia/Kolkata";
    $("#set-llm-enabled").checked = Boolean(s.llm_config?.enabled);
    $("#set-llm-url").value = s.llm_config?.baseUrl || "https://api.openai.com/v1/chat/completions";
    $("#set-llm-model").value = s.llm_config?.model || "gpt-4o-mini";
    $("#set-llm-key").value = s.llm_config?.apiKey || "";
    clearInterval(populateSettingsOnce);
  }, 300);

  // Delegated actions
  document.addEventListener("click", async (e) => {
    const gotoPage = e.target.getAttribute("data-goto");
    if (gotoPage) return switchPage(gotoPage);

    const approveId = e.target.getAttribute("data-approve");
    if (approveId) {
      await api(`/api/commands/${encodeURIComponent(approveId)}/approve`, { method: "POST" });
      showToast("Approved & queued for phone");
      return refreshState();
    }

    const cancelId = e.target.getAttribute("data-cancel");
    if (cancelId) {
      await api(`/api/commands/${encodeURIComponent(cancelId)}/cancel`, { method: "POST" });
      showToast("Command cancelled");
      return refreshState();
    }

    const toggleTask = e.target.getAttribute("data-toggle-task");
    if (toggleTask) {
      await api(`/api/tasks/${encodeURIComponent(toggleTask)}/toggle`, { method: "POST" });
      return refreshState();
    }

    const delTask = e.target.getAttribute("data-delete-task");
    if (delTask) {
      await api(`/api/tasks/${encodeURIComponent(delTask)}`, { method: "DELETE" });
      return refreshState();
    }

    const toggleRule = e.target.getAttribute("data-toggle-rule");
    if (toggleRule) {
      await api(`/api/rules/${encodeURIComponent(toggleRule)}/toggle`, { method: "POST" });
      return refreshState();
    }

    const delRule = e.target.getAttribute("data-delete-rule");
    if (delRule) {
      await api(`/api/rules/${encodeURIComponent(delRule)}`, { method: "DELETE" });
      return refreshState();
    }
  });

  // Optional simulator test buttons
  $("#btn-sim-whatsapp").addEventListener("click", async () => {
    await api("/api/notifications", {
      method: "POST",
      body: JSON.stringify({
        deviceId: "sim-pixel-9",
        fromSimulator: true,
        app: "WhatsApp",
        sender: "Mom",
        text: "Beta, have you reached yet?"
      })
    });
    showToast("Simulated incoming WhatsApp from Mom");
    await refreshState();
  });

  $("#btn-sim-low-bat").addEventListener("click", async () => {
    await api("/api/devices/sim-pixel-9/telemetry", {
      method: "POST",
      body: JSON.stringify({ battery: 15 })
    });
    showToast("Simulated battery 15%");
    await refreshState();
  });

  $("#btn-sim-wifi").addEventListener("click", async () => {
    await api("/api/devices/sim-pixel-9/telemetry", {
      method: "POST",
      body: JSON.stringify({ wifi: "Office-5G" })
    });
    showToast("Simulated Wi-Fi Office-5G");
    await refreshState();
  });

  $("#btn-sim-toggle-lock").addEventListener("click", async () => {
    const sim = (state.data?.devices || []).find((d) => d.id === "sim-pixel-9");
    const next = !sim?.telemetry?.locked;
    await api("/api/devices/sim-pixel-9/telemetry", {
      method: "POST",
      body: JSON.stringify({ locked: next })
    });
    showToast(next ? "Test device locked" : "Test device unlocked");
    await refreshState();
  });

  // Browser Voice Input
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const micBtn = $("#btn-mic");
  if (SpeechRecognition) {
    const rec = new SpeechRecognition();
    rec.lang = "en-US";
    rec.interimResults = false;
    micBtn.addEventListener("click", () => {
      micBtn.classList.add("listening");
      rec.start();
    });
    rec.onresult = (ev) => {
      const transcript = ev.results?.[0]?.[0]?.transcript || "";
      $("#command-input").value = transcript;
      micBtn.classList.remove("listening");
      if (transcript) sendCommand(transcript);
    };
    rec.onerror = () => micBtn.classList.remove("listening");
    rec.onend = () => micBtn.classList.remove("listening");
  } else {
    micBtn.title = "Speech API unavailable in this browser";
  }
}

applySavedTheme();
setupListeners();
refreshState();
setInterval(refreshState, 3000);
