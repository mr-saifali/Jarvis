/**
 * J.A.R.V.I.S. Execution Engine (Simulator + Cloud Vault + Scheduler + Event Rules)
 */
import { makeId } from "./store.mjs";
import { planCommand, planHasSensitiveActions } from "./planner.mjs";
import { getZonedParts, isTaskDue, matchesRuleCondition } from "./scheduler.mjs";

const CLOUD_ONLY_TYPES = new Set(["summarize_notifications", "save_to_vault"]);

export async function resolveTargetDevice(store, requestedDeviceId) {
  const devices = await store.listDevices();
  if (requestedDeviceId && requestedDeviceId !== "auto") {
    const exact = devices.find((d) => d.id === requestedDeviceId);
    if (!exact) throw new Error("Unknown target device");
    return exact;
  }
  const onlineAndroid = devices.find((d) => d.type !== "simulator" && d.online);
  if (onlineAndroid) return onlineAndroid;
  return devices.find((d) => d.type === "simulator") || devices[0];
}

export async function executeActionsForDevice(store, device, actions) {
  const telemetry = { ...(device?.telemetry || {}) };
  const screenMessages = Array.isArray(telemetry.screenMessages)
    ? [...telemetry.screenMessages]
    : [];
  const alarms = Array.isArray(telemetry.alarms) ? [...telemetry.alarms] : [];
  const stepResults = [];
  let summaryBuffer = "";
  let blockedCount = 0;

  for (const action of actions) {
    if (action.type === "summarize_notifications") {
      const notifs = await store.listNotifications(20);
      const unread = notifs.filter((n) => !n.read && n.device_id === device?.id);
      summaryBuffer =
        unread.length > 0
          ? unread
              .map((n) => `• [${n.app}] ${n.sender || "System"}: ${n.text || ""}`)
              .join("\n")
          : "No unread notifications right now. All quiet across WhatsApp, Gmail, and system channels.";
      stepResults.push({ ...action, status: "done", detail: `Summarized ${unread.length} unread notification(s)` });
      await store.addLog("info", "cloud", `Summarized ${unread.length} unread notifications.`);
      continue;
    }

    if (action.type === "save_to_vault") {
      const destination = action.destination || "Notion";
      const title = action.title || "Jarvis Cloud Note";
      const content =
        summaryBuffer ||
        action.content ||
        `Saved by Jarvis at ${new Date().toISOString()}`;
      await store.createVaultEntry({
        id: makeId("vault"),
        destination,
        title,
        content
      });
      stepResults.push({ ...action, status: "done", detail: `Saved to ${destination}` });
      await store.addLog("info", "vault", `Saved "${title}" to ${destination} vault.`);
      continue;
    }

    // Simulator execution
    if (!device || device.type === "simulator") {
      if (telemetry.locked && action.requiresUnlock) {
        blockedCount += 1;
        stepResults.push({
          ...action,
          status: "blocked",
          detail: "Blocked by lock screen — unlock phone to run UI steps"
        });
        await store.addLog(
          "warn",
          "simulator",
          `Skipped UI step "${action.label}" because simulator screen is locked.`
        );
        continue;
      }

      switch (action.type) {
        case "open_app":
          telemetry.activeApp = action.app || "Launcher";
          break;
        case "send_message":
          telemetry.activeApp = action.app || "WhatsApp";
          screenMessages.push({
            id: makeId("msg"),
            app: action.app || "WhatsApp",
            from: "You (Jarvis)",
            to: action.recipient || "Contact",
            text: action.message || "",
            at: new Date().toISOString()
          });
          break;
        case "reply_notification":
          screenMessages.push({
            id: makeId("msg"),
            app: action.app || "WhatsApp",
            from: "You (Auto-Reply)",
            to: action.sender || "Sender",
            text: action.message || "",
            at: new Date().toISOString()
          });
          break;
        case "set_dnd":
          telemetry.dnd = Boolean(action.enabled);
          break;
        case "set_brightness":
          telemetry.brightness = Math.max(5, Math.min(100, Number(action.level || 65)));
          break;
        case "set_flashlight":
          telemetry.flashlight = Boolean(action.enabled);
          break;
        case "set_volume":
          if (action.mode === "mute") telemetry.volume = 0;
          else if (typeof action.level === "number") telemetry.volume = Math.max(0, Math.min(100, action.level));
          break;
        case "set_battery_saver":
          telemetry.batterySaver = action.enabled !== false;
          break;
        case "set_alarm":
          alarms.push({ time: action.time || "06:30", label: action.alarmLabel || "Alarm" });
          telemetry.activeApp = "Clock";
          break;
        case "lock_screen":
          telemetry.locked = true;
          break;
        case "navigate_home":
          telemetry.activeApp = "Launcher";
          break;
        case "navigate_back":
          telemetry.activeApp = "Launcher";
          break;
        case "notify":
        case "send_sms":
        case "make_call":
        case "media_control":
        case "speak_tts":
        case "ring_phone":
        case "take_screenshot":
        case "set_timer":
        case "open_url":
        case "navigate_maps":
        case "play_youtube":
        case "copy_clipboard":
        case "ui_tap":
        case "ui_scroll":
        case "open_quick_settings":
        case "open_notifications":
          break;
        default:
          break;
      }

      stepResults.push({ ...action, status: "done" });
      await store.addLog("info", "simulator", `Executed: ${action.label}`);
    } else {
      // Real Android device action stays queued for the device
      stepResults.push({ ...action, status: "queued" });
    }
  }

  if (device && device.type === "simulator") {
    telemetry.screenMessages = screenMessages.slice(-20);
    telemetry.alarms = alarms.slice(-10);
    await store.upsertDevice({
      ...device,
      last_seen_at: new Date().toISOString(),
      telemetry
    });
  }

  const allCloudOnly = actions.length > 0 && actions.every((a) => CLOUD_ONLY_TYPES.has(a.type));
  const isRealDeviceWithDeviceSteps = device && device.type !== "simulator" && !allCloudOnly;

  return {
    actions: stepResults,
    status: isRealDeviceWithDeviceSteps
      ? "queued"
      : blockedCount > 0 && blockedCount === actions.length
        ? "failed"
        : "completed",
    result_message: isRealDeviceWithDeviceSteps
      ? `Queued ${actions.length} step(s) for ${device.name}`
      : blockedCount > 0
        ? `Completed with ${blockedCount} UI step(s) blocked by lock screen`
        : `Completed ${actions.length} step(s)`
  };
}

export async function dispatchCommand(store, { prompt, deviceId = "auto", source = "user", skipApproval = false }) {
  const settings = await store.getSettings();
  const plan = await planCommand(prompt, settings.llm_config);

  if (source === "device" && (plan.kind !== "command" || !(await store.getDevice(deviceId)))) throw new Error("Device must be registered and issue immediate commands only");

  if (plan.kind === "schedule" && plan.schedule) {
    const task = await store.createTask({
      id: makeId("task"),
      name: plan.schedule.name,
      prompt,
      schedule_type: plan.schedule.schedule_type,
      cron_expr: plan.schedule.cron_expr,
      interval_seconds: plan.schedule.interval_seconds,
      run_at: plan.schedule.run_at,
      enabled: true,
      target_device_id: deviceId || "auto",
      actions: plan.actions
    });
    await store.addLog("info", "scheduler", `Created ${task.schedule_type} schedule: ${task.name}`);
    return { kind: "schedule", task, summary: plan.summary };
  }

  if (plan.kind === "rule" && plan.rule) {
    const rule = await store.createRule({
      id: makeId("rule"),
      name: plan.rule.name,
      prompt,
      event_type: plan.rule.event_type,
      condition: plan.rule.condition,
      actions: plan.actions,
      enabled: true,
      cooldown_seconds: plan.rule.cooldown_seconds ?? 60,
      target_device_id: deviceId || "auto"
    });
    await store.addLog("info", "rules", `Created ${rule.event_type} rule: ${rule.name}`);
    return { kind: "rule", rule, summary: plan.summary };
  }

  const device = await resolveTargetDevice(store, deviceId);
  const needsApproval =
    !skipApproval &&
    settings.confirm_sensitive_actions &&
    planHasSensitiveActions(plan.actions);

  if (needsApproval) {
    const cmd = await store.createCommand({
      id: makeId("cmd"),
      prompt,
      summary: plan.summary,
      source,
      device_id: device?.id || "sim-pixel-9",
      device_name: device?.name || "Android Phone Simulator",
      actions: plan.actions.map((a) => ({ ...a, status: "awaiting_approval" })),
      status: "awaiting_approval",
      result_message: "Waiting for user confirmation (sensitive action)"
    });
    await store.addLog("warn", "safety", `Awaiting approval for: "${prompt}"`);
    return { kind: "command", command: cmd, summary: plan.summary };
  }

  const exec = await executeActionsForDevice(store, device, plan.actions);
  const cmd = await store.createCommand({
    id: makeId("cmd"),
    prompt,
    summary: plan.summary,
    source,
    device_id: device?.id || "sim-pixel-9",
    device_name: device?.name || "Android Phone Simulator",
    actions: exec.actions,
    status: exec.status,
    result_message: exec.result_message
  });

  return { kind: "command", command: cmd, summary: plan.summary };
}

export async function approveCommand(store, commandId) {
  const cmd = await store.getCommand(commandId);
  if (!cmd) return null;
  if (cmd.status !== "awaiting_approval") return cmd;

  if (!(await store.updateCommand(commandId, {status:"approving"}, "awaiting_approval"))) return store.getCommand(commandId);
  const device = await resolveTargetDevice(store, cmd.device_id);
  const exec = await executeActionsForDevice(store, device, cmd.actions || []);
  const updated = await store.updateCommand(commandId, {
    actions: exec.actions,
    status: exec.status,
    result_message: exec.result_message
  });
  await store.addLog("info", "safety", `Approved & executed command ${commandId}`);
  return updated;
}

export async function cancelCommand(store, commandId) {
  const cmd = await store.getCommand(commandId);
  if (!cmd) return null;
  if (!["awaiting_approval", "queued"].includes(cmd.status)) return cmd;
  const updated = await store.updateCommand(commandId, {
    status: "cancelled",
    result_message: "Cancelled by user"
  }, cmd.status);
  await store.addLog("info", "brain", `Cancelled command ${commandId}`);
  return updated;
}

async function automationResult(store, device, actions, settings) {
  if (settings.confirm_sensitive_actions && planHasSensitiveActions(actions)) {
    return {actions, status: "awaiting_approval", result_message: "Review this automation run before execution"};
  }
  return executeActionsForDevice(store, device, actions);
}

export async function tickScheduler(store, now = new Date()) {
  const settings = await store.getSettings();
  const timeZone = settings.timezone || "Asia/Kolkata";
  const tasks = await store.listTasks();
  const fired = [];

  for (const task of tasks) {
    if (!isTaskDue(task, now, timeZone)) continue;

    const parts = getZonedParts(now, timeZone);
    const claimed = await store.updateTask(task.id, {
      last_run_at: now.toISOString(),
      last_run_minute_key: parts.minuteKey,
      run_count: Number(task.run_count || 0) + 1,
      enabled: task.schedule_type === "once" ? false : task.enabled
    }, task.run_count);
    if (!claimed) continue;
    const device = await resolveTargetDevice(store, task.target_device_id);
    const exec = await automationResult(store, device, task.actions || [], settings);

    const cmd = await store.createCommand({
      id: makeId("cmd"),
      prompt: `[Schedule: ${task.name}] ${task.prompt}`,
      summary: task.name,
      source: "schedule",
      device_id: device?.id || "sim-pixel-9",
      device_name: device?.name || "Android Phone Simulator",
      actions: exec.actions,
      status: exec.status,
      result_message: exec.result_message
    });

    await store.addLog("info", "scheduler", `Triggered scheduled task "${task.name}"`);
    fired.push({ taskId: task.id, commandId: cmd.id });
  }

  return fired;
}

export async function evaluateRules(store, eventType, payload, deviceId, now = new Date()) {
  const rules = await store.listRules();
  const triggered = [];

  for (const rule of rules) {
    if (!matchesRuleCondition(rule, eventType, payload, now)) continue;

    const targetId =
      rule.target_device_id && rule.target_device_id !== "auto"
        ? rule.target_device_id
        : deviceId;
    if (targetId !== deviceId) continue;
    const device = await resolveTargetDevice(store, targetId);
    const exec = await automationResult(store, device, rule.actions || [], await store.getSettings());

    const cmd = await store.createCommand({
      id: makeId("cmd"),
      prompt: `[Rule: ${rule.name}] ${rule.prompt}`,
      summary: rule.name,
      source: "rule",
      device_id: device?.id || "sim-pixel-9",
      device_name: device?.name || "Android Phone Simulator",
      actions: exec.actions,
      status: exec.status,
      result_message: exec.result_message
    });

    await store.updateRule(rule.id, {
      last_triggered_at: now.toISOString(),
      hit_count: Number(rule.hit_count || 0) + 1
    });

    await store.addLog("info", "rules", `Rule "${rule.name}" fired on ${eventType} event.`);
    triggered.push({ ruleId: rule.id, commandId: cmd.id });
  }

  return triggered;
}
