/* J.A.R.V.I.S. Control Center & Android Phone Simulator Frontend */

const state = {
  data: null,
  selectedDeviceId: "sim-pixel-9",
  activeTab: "timeline",
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
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
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

function showPhoneToast(msg) {
  const toast = $("#sim-action-toast");
  if (!toast) return;
  toast.textContent = msg;
  toast.classList.remove("hidden");
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => toast.classList.add("hidden"), 3200);
}

function getSelectedDevice() {
  const devices = state.data?.devices || [];
  return devices.find((d) => d.id === state.selectedDeviceId) || devices[0] || null;
}

function renderTopbar() {
  const settings = state.data?.settings;
  if (!settings) return;
  $("#safety-toggle").checked = Boolean(settings.confirm_sensitive_actions);
  $("#connection-label").textContent = "Brain Online";
  $("#connection-pill .dot").classList.add("online");

  // Populate Connect modal info
  const origin = window.location.origin;
  const token = settings.pairing_token || "jarvis-d4d0cd67";
  $("#connect-origin").textContent = origin;
  $("#connect-token").textContent = token;
  $("#connect-curl").textContent =
`curl -X POST ${origin}/api/devices/register \\
  -H "Content-Type: application/json" \\
  -H "X-Jarvis-Token: ${token}" \\
  -d '{"deviceId":"my-phone","name":"My Android","model":"Android","telemetry":{"battery":88,"wifi":"Home-5G"}}'`;
}

function renderDeviceSelector() {
  const devices = state.data?.devices || [];
  const select = $("#device-selector");
  if (!devices.some((d) => d.id === state.selectedDeviceId) && devices[0]) {
    state.selectedDeviceId = devices[0].id;
  }
  select.innerHTML = devices
    .map(
      (d) =>
        `<option value="${esc(d.id)}" ${d.id === state.selectedDeviceId ? "selected" : ""}>${esc(
          d.name
        )} (${d.online ? "Online" : "Offline"})</option>`
    )
    .join("");

  const active = getSelectedDevice();
  $("#target-device-label").textContent = `Target: ${active ? active.name : "Android Phone Simulator"}`;
}

function renderPhoneSimulator() {
  const device = getSelectedDevice();
  const tel = device?.telemetry || {};

  const nowStr = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  $("#sim-clock").textContent = nowStr;
  $("#sim-lock-time").textContent = nowStr;

  const battery = typeof tel.battery === "number" ? tel.battery : 78;
  const brightness = typeof tel.brightness === "number" ? tel.brightness : 65;
  const wifi = tel.wifi || "Home-5G";
  const dnd = Boolean(tel.dnd);
  const locked = Boolean(tel.locked);
  const activeApp = tel.activeApp || "Launcher";

  $("#sim-bat-label").textContent = `${battery}%`;
  $("#sim-wifi-label").textContent = wifi;
  $("#sim-dnd-badge").classList.toggle("hidden", !dnd);
  $("#sim-lockscreen").classList.toggle("hidden", !locked);

  $("#ctrl-battery").value = battery;
  $("#ctrl-bat-val").textContent = `${battery}%`;
  $("#ctrl-brightness").value = brightness;
  $("#ctrl-bright-val").textContent = `${brightness}%`;

  const veilOpacity = Math.max(0, Math.min(0.75, (100 - brightness) / 115));
  $("#sim-brightness-veil").style.opacity = veilOpacity.toFixed(2);

  $("#sim-app-name").textContent = activeApp;
  $("#sim-agent-status").textContent =
    device?.type === "simulator" ? "Accessibility Ready" : device?.online ? "Live Bridge" : "Offline";

  const body = $("#sim-screen-body");
  const msgs = (tel.screenMessages || []).filter(
    (m) => !activeApp || activeApp === "Launcher" || m.app === activeApp
  );

  if (activeApp === "Launcher") {
    body.innerHTML = `
      <div class="app-grid">
        <div class="app-tile" data-open="WhatsApp">WhatsApp</div>
        <div class="app-tile" data-open="Spotify">Spotify</div>
        <div class="app-tile" data-open="Settings">Settings</div>
        <div class="app-tile" data-open="Gmail">Gmail</div>
        <div class="app-tile" data-open="Clock">Clock</div>
        <div class="app-tile" data-open="Notion">Notion</div>
      </div>
    `;
  } else if (activeApp === "WhatsApp") {
    const recent = msgs.slice(-5);
    body.innerHTML =
      recent.length > 0
        ? recent
            .map(
              (m) =>
                `<div class="sim-chat-bubble"><strong>${esc(m.from)} → ${esc(
                  m.to
                )}:</strong><br/>${esc(m.text)}</div>`
            )
            .join("")
        : `<div class="sim-chat-bubble">WhatsApp open. Ready for Accessibility UI automation.</div>`;
  } else if (activeApp === "Clock") {
    const alarms = tel.alarms || [];
    body.innerHTML =
      alarms.length > 0
        ? alarms
            .map(
              (a) =>
                `<div class="sim-chat-bubble">⏰ <strong>${esc(a.time)}</strong> — ${esc(
                  a.label || "Alarm"
                )}</div>`
            )
            .join("")
        : `<div class="sim-chat-bubble">No alarms configured yet.</div>`;
  } else if (activeApp === "Settings") {
    body.innerHTML = `
      <div class="sim-chat-bubble"><strong>Do Not Disturb:</strong> ${dnd ? "ON" : "OFF"}</div>
      <div class="sim-chat-bubble"><strong>Brightness:</strong> ${brightness}%</div>
      <div class="sim-chat-bubble"><strong>Wi-Fi:</strong> ${esc(wifi)}</div>
      <div class="sim-chat-bubble"><strong>Battery Saver:</strong> ${tel.batterySaver ? "ON" : "OFF"}</div>
    `;
  } else {
    body.innerHTML = `<div class="sim-chat-bubble"><strong>${esc(
      activeApp
    )}</strong> is active in foreground.</div>`;
  }
}

function renderCommands() {
  const commands = state.data?.commands || [];
  $("#count-cmds").textContent = commands.length;
  const list = $("#commands-list");
  if (commands.length === 0) {
    list.innerHTML = `<div class="item-card"><div class="item-sub">No commands executed yet. Type a command above or click a preset chip!</div></div>`;
    return;
  }

  list.innerHTML = commands
    .map((cmd) => {
      const steps = (cmd.actions || [])
        .map(
          (a) =>
            `<li class="step-row"><span>${esc(a.label || a.type)}</span><span>${esc(
              a.status || cmd.status
            )}</span></li>`
        )
        .join("");

      const approvalBtns =
        cmd.status === "awaiting_approval"
          ? `<div class="action-row">
              <button class="btn btn-sm btn-success" data-approve="${esc(cmd.id)}">Approve & Execute</button>
              <button class="btn btn-sm btn-danger" data-cancel="${esc(cmd.id)}">Cancel</button>
             </div>`
          : "";

      return `
        <div class="item-card">
          <div class="item-top">
            <div>
              <div class="item-title">${esc(cmd.prompt)}</div>
              <div class="item-sub">${esc(cmd.device_name || cmd.device_id)} &bull; ${esc(
                cmd.source
              )} &bull; ${fmtTime(cmd.created_at)} &bull; ${esc(cmd.result_message || "")}</div>
            </div>
            <span class="status-tag tag-${esc(cmd.status)}">${esc(cmd.status)}</span>
          </div>
          ${steps ? `<ul class="step-list">${steps}</ul>` : ""}
          ${approvalBtns}
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
    list.innerHTML = `<div class="item-card"><div class="item-sub">No background schedules yet. Try "In 20 seconds turn off Do Not Disturb" or "Every weekday at 8:30 AM...".</div></div>`;
    return;
  }

  list.innerHTML = tasks
    .map((t) => {
      const schedInfo =
        t.schedule_type === "cron"
          ? `Cron: ${t.cron_expr}`
          : t.schedule_type === "interval"
            ? `Every ${t.interval_seconds}s`
            : `Once at ${fmtTime(t.run_at)}`;
      return `
        <div class="item-card">
          <div class="item-top">
            <div>
              <div class="item-title">${esc(t.name)}</div>
              <div class="item-sub">${esc(schedInfo)} &bull; Runs: ${t.run_count || 0}</div>
            </div>
            <span class="status-tag ${t.enabled ? "tag-completed" : "tag-cancelled"}">${
        t.enabled ? "active" : "paused"
      }</span>
          </div>
          <div class="action-row">
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
    list.innerHTML = `<div class="item-card"><div class="item-sub">No event rules yet. Try "When I get a WhatsApp message from Mom, auto-reply In a meeting".</div></div>`;
    return;
  }

  list.innerHTML = rules
    .map((r) => {
      return `
        <div class="item-card">
          <div class="item-top">
            <div>
              <div class="item-title">${esc(r.name)}</div>
              <div class="item-sub">Trigger: ${esc(r.event_type)} &bull; Condition: ${esc(
        JSON.stringify(r.condition)
      )} &bull; Hits: ${r.hit_count || 0}</div>
            </div>
            <span class="status-tag ${r.enabled ? "tag-completed" : "tag-cancelled"}">${
        r.enabled ? "active" : "paused"
      }</span>
          </div>
          <div class="action-row">
            <button class="btn btn-sm btn-outline" data-toggle-rule="${esc(r.id)}">${
        r.enabled ? "Pause" : "Resume"
      }</button>
            <button class="btn btn-sm btn-danger" data-delete-rule="${esc(r.id)}">Delete</button>
          </div>
        </div>
      `;
    })
    .join("");
}

function renderVault() {
  const vault = state.data?.vault || [];
  $("#count-vault").textContent = vault.length;
  const list = $("#vault-list");
  if (vault.length === 0) {
    list.innerHTML = `<div class="item-card"><div class="item-sub">Cloud Vault is empty.</div></div>`;
    return;
  }

  list.innerHTML = vault
    .map(
      (v) => `
      <div class="item-card">
        <div class="item-top">
          <div>
            <div class="item-title">${esc(v.title)}</div>
            <div class="item-sub">${esc(v.destination)} &bull; ${fmtTime(v.created_at)}</div>
          </div>
          <span class="status-tag tag-completed">${esc(v.destination)}</span>
        </div>
        <div class="item-sub" style="margin-top:8px;white-space:pre-wrap;">${esc(v.content)}</div>
      </div>
    `
    )
    .join("");
}

function renderLogs() {
  const logs = state.data?.logs || [];
  const list = $("#logs-list");
  list.innerHTML = logs
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
  renderTopbar();
  renderDeviceSelector();
  renderPhoneSimulator();
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
    $("#connection-pill .dot").classList.remove("online");
    console.error("Failed to fetch state:", err);
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
    showPhoneToast(res.summary || "Command processed");
    $("#command-input").value = "";
    await refreshState();
  } catch (err) {
    showPhoneToast(`Error: ${err.message}`);
  }
}

async function updateSimTelemetry(patch, toastMsg) {
  try {
    await api(`/api/devices/${encodeURIComponent(state.selectedDeviceId)}/telemetry`, {
      method: "POST",
      body: JSON.stringify(patch)
    });
    if (toastMsg) showPhoneToast(toastMsg);
    await refreshState();
  } catch (err) {
    showPhoneToast(`Telemetry error: ${err.message}`);
  }
}

function setupListeners() {
  // Command submit
  $("#command-form").addEventListener("submit", (e) => {
    e.preventDefault();
    sendCommand($("#command-input").value);
  });

  // Preset chips
  $$(".chip[data-cmd]").forEach((chip) => {
    chip.addEventListener("click", () => {
      const cmd = chip.getAttribute("data-cmd");
      $("#command-input").value = cmd;
      sendCommand(cmd);
    });
  });

  // Tabs
  $$(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const tab = btn.getAttribute("data-tab");
      state.activeTab = tab;
      $$(".tab-btn").forEach((b) => b.classList.toggle("active", b === btn));
      $$(".tab-content").forEach((c) => c.classList.toggle("active", c.id === `tab-${tab}`));
    });
  });

  // Safety toggle
  $("#safety-toggle").addEventListener("change", async (e) => {
    await api("/api/settings", {
      method: "POST",
      body: JSON.stringify({ confirm_sensitive_actions: e.target.checked })
    });
    await refreshState();
  });

  // Device selector
  $("#device-selector").addEventListener("change", (e) => {
    state.selectedDeviceId = e.target.value;
    renderAll();
  });

  // Delegated actions for lists & simulator app tiles
  document.addEventListener("click", async (e) => {
    const approveId = e.target.getAttribute("data-approve");
    if (approveId) {
      await api(`/api/commands/${encodeURIComponent(approveId)}/approve`, { method: "POST" });
      showPhoneToast("Approved & executed");
      return refreshState();
    }

    const cancelId = e.target.getAttribute("data-cancel");
    if (cancelId) {
      await api(`/api/commands/${encodeURIComponent(cancelId)}/cancel`, { method: "POST" });
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

    const openApp = e.target.getAttribute("data-open");
    if (openApp) {
      return updateSimTelemetry({ activeApp: openApp }, `Opened ${openApp}`);
    }

    const closeModal = e.target.getAttribute("data-close");
    if (closeModal) {
      $(`#${closeModal}`)?.classList.add("hidden");
    }
  });

  // Simulator controls
  $("#ctrl-battery").addEventListener("change", (e) => {
    updateSimTelemetry({ battery: Number(e.target.value) }, `Battery: ${e.target.value}%`);
  });

  $("#ctrl-brightness").addEventListener("change", (e) => {
    updateSimTelemetry({ brightness: Number(e.target.value) }, `Brightness: ${e.target.value}%`);
  });

  $("#btn-sim-low-bat").addEventListener("click", () => {
    updateSimTelemetry({ battery: 15 }, "Simulated battery drop to 15%");
  });

  $("#btn-sim-wifi").addEventListener("click", () => {
    updateSimTelemetry({ wifi: "Office-5G" }, "Switched Wi-Fi to Office-5G");
  });

  $("#btn-sim-toggle-lock").addEventListener("click", () => {
    const dev = getSelectedDevice();
    const next = !dev?.telemetry?.locked;
    updateSimTelemetry({ locked: next }, next ? "Screen Locked" : "Screen Unlocked");
  });

  $("#btn-sim-unlock").addEventListener("click", () => {
    updateSimTelemetry({ locked: false }, "Phone Unlocked");
  });

  $("#sim-btn-home").addEventListener("click", () => {
    updateSimTelemetry({ activeApp: "Launcher" }, "Home");
  });

  $("#sim-btn-back").addEventListener("click", () => {
    updateSimTelemetry({ activeApp: "Launcher" }, "Back");
  });

  $("#sim-btn-lock").addEventListener("click", () => {
    updateSimTelemetry({ locked: true }, "Screen Locked");
  });

  $("#btn-sim-whatsapp").addEventListener("click", async () => {
    await api("/api/notifications", {
      method: "POST",
      body: JSON.stringify({
        deviceId: state.selectedDeviceId,
        fromSimulator: true,
        app: "WhatsApp",
        sender: "Mom",
        text: "Beta, have you reached yet?"
      })
    });
    showPhoneToast("Incoming WhatsApp from Mom");
    await refreshState();
  });

  // Modals
  $("#btn-open-connect").addEventListener("click", () => {
    $("#modal-connect").classList.remove("hidden");
  });

  $("#btn-open-settings").addEventListener("click", () => {
    const s = state.data?.settings;
    if (s) {
      $("#set-timezone").value = s.timezone || "Asia/Kolkata";
      $("#set-llm-enabled").checked = Boolean(s.llm_config?.enabled);
      $("#set-llm-url").value = s.llm_config?.baseUrl || "https://api.openai.com/v1/chat/completions";
      $("#set-llm-model").value = s.llm_config?.model || "gpt-4o-mini";
      $("#set-llm-key").value = s.llm_config?.apiKey || "";
    }
    $("#modal-settings").classList.remove("hidden");
  });

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
    $("#modal-settings").classList.add("hidden");
    showPhoneToast("Settings saved");
    await refreshState();
  });

  // Web Speech API Microphone
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

setupListeners();
refreshState();
setInterval(refreshState, 3000);
