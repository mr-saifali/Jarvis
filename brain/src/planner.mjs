/**
 * J.A.R.V.I.S. Natural Language Planner & Optional LLM Reasoning
 */

const SENSITIVE_TYPES = new Set([
  "send_message",
  "send_sms",
  "make_call"
]);

export function isSensitiveAction(action) {
  return Boolean(action && SENSITIVE_TYPES.has(action.type));
}

export function planHasSensitiveActions(actions = []) {
  return actions.some(isSensitiveAction);
}

function parseTime12or24(hourStr, minStr = "0", ampm = "") {
  let hour = Number.parseInt(hourStr, 10);
  const minute = Number.parseInt(minStr || "0", 10);
  const suffix = (ampm || "").toLowerCase();
  if (suffix === "pm" && hour < 12) hour += 12;
  if (suffix === "am" && hour === 12) hour = 0;
  return {
    hour: Math.max(0, Math.min(23, hour)),
    minute: Math.max(0, Math.min(59, minute))
  };
}

function formatHHMM(hour, minute) {
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function extractActionsDeterministic(text) {
  const actions = [];
  const lower = text.toLowerCase();

  // Open app
  const openMatch = text.match(/\bopen\s+([A-Za-z0-9_+.-]+)/i);
  let openedApp = null;
  if (openMatch) {
    openedApp = openMatch[1].replace(/[.,!?;:]+$/, "");
    actions.push({
      type: "open_app",
      app: openedApp,
      label: `Open ${openedApp}`,
      requiresUnlock: true
    });
  }

  // WhatsApp / app message: "message Mom that I will be home in 15 minutes"
  const msgMatch =
    text.match(
      /\b(?:message|msg|dm)\s+([A-Za-z0-9_ ]+?)\s+(?:that|saying|:)\s+(.+?)(?:$|\s+and\s+(?:turn|set|notify|save))/i
    ) ||
    text.match(
      /\bwhatsapp\s+([A-Za-z0-9_ ]+?)\s+(?:that|saying|:)\s+(.+?)(?:$|\s+and\s+(?:turn|set|notify|save))/i
    );
  if (msgMatch) {
    const recipient = msgMatch[1].trim();
    const message = msgMatch[2].trim().replace(/^["']|["']$/g, "");
    const targetApp = openedApp || (lower.includes("whatsapp") ? "WhatsApp" : "Messages");
    if (!openedApp && lower.includes("whatsapp")) {
      actions.push({
        type: "open_app",
        app: "WhatsApp",
        label: "Open WhatsApp",
        requiresUnlock: true
      });
    }
    actions.push({
      type: "send_message",
      app: targetApp,
      recipient,
      message,
      label: `Send ${targetApp} message to ${recipient}: "${message}"`,
      requiresUnlock: true
    });
  }

  // SMS: "send sms to Mom saying ..." or "text Mom ..."
  const smsMatch = text.match(
    /\b(?:send\s+sms\s+to|sms|text)\s+([A-Za-z0-9_+ ]+?)\s+(?:that|saying|:)\s+(.+)/i
  );
  if (smsMatch && !msgMatch) {
    const recipient = smsMatch[1].trim();
    const message = smsMatch[2].trim().replace(/^["']|["']$/g, "");
    actions.push({
      type: "send_sms",
      recipient,
      message,
      label: `Send SMS to ${recipient}: "${message}"`,
      requiresUnlock: false
    });
  }

  // Call: "call Mom"
  const callMatch = text.match(/\b(?:call|phone|dial)\s+([A-Za-z0-9_+ ]+?)(?:$|\s+and\s+)/i);
  if (callMatch && !lower.includes("will call") && !lower.includes("auto-reply")) {
    const recipient = callMatch[1].trim();
    actions.push({
      type: "make_call",
      recipient,
      label: `Call ${recipient}`,
      requiresUnlock: false
    });
  }

  // Do Not Disturb
  if (/\b(?:turn\s+on|enable|activate)\s+(?:do\s+not\s+disturb|dnd)\b/i.test(text)) {
    actions.push({
      type: "set_dnd",
      enabled: true,
      label: "Enable Do Not Disturb",
      requiresUnlock: false
    });
  } else if (/\b(?:turn\s+off|disable|deactivate)\s+(?:do\s+not\s+disturb|dnd)\b/i.test(text)) {
    actions.push({
      type: "set_dnd",
      enabled: false,
      label: "Disable Do Not Disturb",
      requiresUnlock: false
    });
  }

  // Brightness
  const brightMatch = text.match(/\bbrightness\s+(?:to\s+)?(\d{1,3})\s*%?/i);
  if (brightMatch) {
    const level = Math.max(5, Math.min(100, Number.parseInt(brightMatch[1], 10)));
    actions.push({
      type: "set_brightness",
      level,
      label: `Set screen brightness to ${level}%`,
      requiresUnlock: false
    });
  }

  // Alarm
  const alarmMatch = text.match(/\balarm\s+(?:for|at)\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
  if (alarmMatch) {
    const { hour, minute } = parseTime12or24(alarmMatch[1], alarmMatch[2], alarmMatch[3]);
    const hhmm = formatHHMM(hour, minute);
    actions.push({
      type: "set_alarm",
      time: hhmm,
      alarmLabel: "Jarvis Alarm",
      label: `Set alarm for ${hhmm}`,
      requiresUnlock: false
    });
  }

  // Summarize notifications & save to Notion / Google Drive
  if (/\bsummarize\b.*\bnotifications?\b/i.test(text)) {
    actions.push({
      type: "summarize_notifications",
      label: "Summarize unread notifications",
      requiresUnlock: false
    });
  }

  if (/\b(?:save|sync|backup|send)\b.*\b(?:to\s+)?(notion|google\s*drive|drive)\b/i.test(text)) {
    const destMatch = text.match(/\b(notion|google\s*drive|drive)\b/i);
    const destination =
      destMatch && /drive/i.test(destMatch[1]) ? "Google Drive" : "Notion";
    actions.push({
      type: "save_to_vault",
      destination,
      title: /\bsummarize\b/i.test(text)
        ? "Unread Notifications Summary"
        : "Jarvis Cloud Note",
      label: `Save summary to ${destination} vault`,
      requiresUnlock: false
    });
  }

  // Battery saver
  if (/\bbattery\s+saver\b/i.test(text)) {
    actions.push({
      type: "set_battery_saver",
      enabled: !/\b(?:off|disable)\b/i.test(text),
      label: "Enable Battery Saver mode",
      requiresUnlock: false
    });
  }

  // Notify me
  const notifyMatch = text.match(/\bnotify\s+me\s+(?:that\s+|with\s+|:)?(.+?)$/i);
  if (notifyMatch) {
    const message = notifyMatch[1].trim().replace(/^["']|["']$/g, "");
    actions.push({
      type: "notify",
      title: "J.A.R.V.I.S.",
      message,
      label: `Send notification: "${message}"`,
      requiresUnlock: false
    });
  }

  // Lock / Home / Back
  if (/\block\s+(?:the\s+)?(?:phone|screen|device)\b/i.test(text)) {
    actions.push({ type: "lock_screen", label: "Lock device screen", requiresUnlock: false });
  }
  if (/\bgo\s+home\b/i.test(text)) {
    actions.push({ type: "navigate_home", label: "Press Android Home", requiresUnlock: true });
  }
  if (/\bgo\s+back\b/i.test(text)) {
    actions.push({ type: "navigate_back", label: "Press Android Back", requiresUnlock: true });
  }

  // Fallback generic notification/agent step if nothing matched
  if (actions.length === 0) {
    actions.push({
      type: "notify",
      title: "J.A.R.V.I.S.",
      message: text.trim(),
      label: `Execute intent: "${text.trim()}"`,
      requiresUnlock: false
    });
  }

  return actions;
}

export function planDeterministic(prompt, now = new Date()) {
  const clean = String(prompt || "").trim();
  if (!clean) {
    return {
      kind: "command",
      summary: "Empty command",
      actions: []
    };
  }

  // 1. Check Event Rule: "When ..."
  const whenMatch = clean.match(/^when\s+(.+?)(?:,\s*|\s+then\s+|\s+auto-reply\s+)(.+)$/i);
  if (whenMatch || /^when\s+/i.test(clean)) {
    const lower = clean.toLowerCase();

    // WhatsApp / notification rule
    const notifMatch = clean.match(
      /^when\s+(?:i\s+(?:get|receive)\s+a\s+)?(whatsapp|sms|gmail|slack|telegram|notification)(?:\s+message)?(?:\s+from\s+([A-Za-z0-9_ ]+?))?(?:,\s*|\s+then\s+)(.+)$/i
    );
    if (notifMatch) {
      const rawApp = notifMatch[1];
      const app =
        rawApp.toLowerCase() === "whatsapp"
          ? "WhatsApp"
          : rawApp.toLowerCase() === "gmail"
            ? "Gmail"
            : rawApp.toLowerCase() === "notification"
              ? "*"
              : rawApp;
      const sender = notifMatch[2] ? notifMatch[2].trim() : "";
      const actionText = notifMatch[3].trim();

      let actions;
      const autoReplyMatch = actionText.match(/^(?:auto-?reply|reply)\s+(.+)$/i);
      if (autoReplyMatch) {
        const replyText = autoReplyMatch[1].trim().replace(/^["']|["']$/g, "");
        actions = [
          {
            type: "reply_notification",
            app,
            sender: sender || "Sender",
            message: replyText,
            label: `Auto-reply on ${app}${sender ? ` to ${sender}` : ""}: "${replyText}"`,
            requiresUnlock: false
          }
        ];
      } else {
        actions = extractActionsDeterministic(actionText);
      }

      return {
        kind: "rule",
        summary: `Event rule created for ${app}${sender ? ` from ${sender}` : ""}`,
        actions,
        rule: {
          name: `${app} ${sender ? `from ${sender}` : "notification"} rule`,
          event_type: "notification",
          condition: {
            app,
            ...(sender ? { sender } : {})
          },
          cooldown_seconds: 30,
          actions
        }
      };
    }

    // Battery threshold rule
    const batRuleMatch = clean.match(
      /battery\s*(?:<|is\s+below|drops\s+below|under)\s*(\d{1,3})\s*%?(?:,|\s+then|\s+)(.+)$/i
    );
    if (batRuleMatch) {
      const threshold = Number.parseInt(batRuleMatch[1], 10);
      const actionText = batRuleMatch[2].trim();
      const actions = extractActionsDeterministic(actionText);
      return {
        kind: "rule",
        summary: `Telemetry rule created for battery < ${threshold}%`,
        actions,
        rule: {
          name: `Battery < ${threshold}%`,
          event_type: "telemetry",
          condition: { battery_lt: threshold },
          cooldown_seconds: 60,
          actions
        }
      };
    }

    // Wi-Fi rule
    const wifiRuleMatch = clean.match(
      /wi-?fi\s+(?:connects\s+to|is|equals)\s+([A-Za-z0-9_.-]+)(?:,|\s+then|\s+)(.+)$/i
    );
    if (wifiRuleMatch) {
      const ssid = wifiRuleMatch[1].trim();
      const actionText = wifiRuleMatch[2].trim();
      const actions = extractActionsDeterministic(actionText);
      return {
        kind: "rule",
        summary: `Telemetry rule created for Wi-Fi "${ssid}"`,
        actions,
        rule: {
          name: `Wi-Fi == ${ssid}`,
          event_type: "telemetry",
          condition: { wifi_equals: ssid },
          cooldown_seconds: 60,
          actions
        }
      };
    }

    // Generic fallback when-rule
    if (lower.startsWith("when ")) {
      const body = whenMatch ? whenMatch[2].trim() : clean.replace(/^when\s+/i, "");
      const actions = extractActionsDeterministic(body);
      return {
        kind: "rule",
        summary: "Event rule created",
        actions,
        rule: {
          name: clean.slice(0, 60),
          event_type: "notification",
          condition: { app: "*" },
          cooldown_seconds: 60,
          actions
        }
      };
    }
  }

  // 2. Check One-shot delay: "In 20 seconds ..." / "In 5 minutes ..."
  const delayMatch = clean.match(
    /^in\s+(\d+)\s+(seconds?|secs?|minutes?|mins?|hours?|hrs?)\s+(.+)$/i
  );
  if (delayMatch) {
    const qty = Number.parseInt(delayMatch[1], 10);
    const unit = delayMatch[2].toLowerCase();
    const rest = delayMatch[3].trim();
    const multiplier = unit.startsWith("h") ? 3600_000 : unit.startsWith("m") ? 60_000 : 1000;
    const runAt = new Date(now.getTime() + qty * multiplier).toISOString();
    const actions = extractActionsDeterministic(rest);
    return {
      kind: "schedule",
      summary: `Scheduled one-shot task in ${qty} ${unit}`,
      actions,
      schedule: {
        name: `In ${qty} ${unit}: ${rest.slice(0, 48)}`,
        schedule_type: "once",
        run_at: runAt,
        cron_expr: null,
        interval_seconds: null,
        actions
      }
    };
  }

  // 3. Check Cron / Recurring Schedule: "Every weekday at 8:30 AM ...", "Every day at ...", "Every 15 minutes ..."
  const weekdayMatch = clean.match(
    /^every\s+weekday\s+at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s+(.+)$/i
  );
  if (weekdayMatch) {
    const { hour, minute } = parseTime12or24(weekdayMatch[1], weekdayMatch[2], weekdayMatch[3]);
    const rest = weekdayMatch[4].trim();
    const actions = extractActionsDeterministic(rest);
    const cronExpr = `${minute} ${hour} * * 1-5`;
    return {
      kind: "schedule",
      summary: `Scheduled weekday cron (${cronExpr})`,
      actions,
      schedule: {
        name: `Weekdays ${formatHHMM(hour, minute)}: ${rest.slice(0, 48)}`,
        schedule_type: "cron",
        cron_expr: cronExpr,
        interval_seconds: null,
        run_at: null,
        actions
      }
    };
  }

  const dailyMatch = clean.match(
    /^every\s+day\s+at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s+(.+)$/i
  );
  if (dailyMatch) {
    const { hour, minute } = parseTime12or24(dailyMatch[1], dailyMatch[2], dailyMatch[3]);
    const rest = dailyMatch[4].trim();
    const actions = extractActionsDeterministic(rest);
    const cronExpr = `${minute} ${hour} * * *`;
    return {
      kind: "schedule",
      summary: `Scheduled daily cron (${cronExpr})`,
      actions,
      schedule: {
        name: `Daily ${formatHHMM(hour, minute)}: ${rest.slice(0, 48)}`,
        schedule_type: "cron",
        cron_expr: cronExpr,
        interval_seconds: null,
        run_at: null,
        actions
      }
    };
  }

  const intervalMatch = clean.match(
    /^every\s+(\d+)\s+(seconds?|secs?|minutes?|mins?|hours?|hrs?)\s+(.+)$/i
  );
  if (intervalMatch) {
    const qty = Number.parseInt(intervalMatch[1], 10);
    const unit = intervalMatch[2].toLowerCase();
    const rest = intervalMatch[3].trim();
    const secs = unit.startsWith("h") ? qty * 3600 : unit.startsWith("m") ? qty * 60 : qty;
    const actions = extractActionsDeterministic(rest);
    return {
      kind: "schedule",
      summary: `Scheduled interval every ${secs}s`,
      actions,
      schedule: {
        name: `Every ${qty} ${unit}: ${rest.slice(0, 48)}`,
        schedule_type: "interval",
        cron_expr: null,
        interval_seconds: Math.max(5, secs),
        run_at: null,
        actions
      }
    };
  }

  // 4. Immediate command
  const actions = extractActionsDeterministic(clean);
  return {
    kind: "command",
    summary: actions.map((a) => a.label).join(" -> "),
    actions
  };
}

export async function planCommand(prompt, llmConfig = null, now = new Date()) {
  const deterministic = planDeterministic(prompt, now);

  // If LLM is disabled or not configured, return deterministic plan immediately
  if (!llmConfig?.enabled || !llmConfig?.apiKey || !llmConfig?.baseUrl) {
    return deterministic;
  }

  try {
    const res = await fetch(llmConfig.baseUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${llmConfig.apiKey}`
      },
      body: JSON.stringify({
        model: llmConfig.model || "gpt-4o-mini",
        temperature: 0.1,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "You are J.A.R.V.I.S. Android Agent Planner. Convert the user's natural language request into a JSON object with keys: kind ('command'|'schedule'|'rule'), summary (string), and actions (array of action objects with 'type', 'label', 'requiresUnlock', and parameters like app, recipient, message, level, enabled, time, destination, title). Available action types: open_app, send_message, send_sms, make_call, set_dnd, set_brightness, set_alarm, set_battery_saver, summarize_notifications, save_to_vault, notify, lock_screen, navigate_home, navigate_back, reply_notification."
          },
          { role: "user", content: prompt }
        ]
      })
    });

    if (!res.ok) return deterministic;
    const data = await res.json();
    const raw = data?.choices?.[0]?.message?.content;
    if (!raw) return deterministic;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed.actions) || parsed.actions.length === 0) {
      return deterministic;
    }
    return {
      ...deterministic,
      summary: parsed.summary || deterministic.summary,
      actions: parsed.actions
    };
  } catch {
    return deterministic;
  }
}
