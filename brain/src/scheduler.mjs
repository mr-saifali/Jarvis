/**
 * J.A.R.V.I.S. Cron, Interval, One-Shot & Event Rule Evaluator
 */

const WEEKDAY_MAP = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6
};

export function getZonedParts(date = new Date(), timeZone = "Asia/Kolkata") {
  try {
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "numeric",
      day: "numeric",
      weekday: "short",
      hour: "numeric",
      minute: "numeric",
      hour12: false
    });
    const parts = Object.fromEntries(
      formatter.formatToParts(date).map((p) => [p.type, p.value])
    );
    const year = Number.parseInt(parts.year, 10);
    const month = Number.parseInt(parts.month, 10);
    const day = Number.parseInt(parts.day, 10);
    const hour = Number.parseInt(parts.hour, 10) % 24;
    const minute = Number.parseInt(parts.minute, 10);
    const weekday = WEEKDAY_MAP[parts.weekday] ?? date.getUTCDay();
    const minuteKey = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
    return { year, month, day, hour, minute, weekday, minuteKey };
  } catch {
    const year = date.getUTCFullYear();
    const month = date.getUTCMonth() + 1;
    const day = date.getUTCDate();
    const hour = date.getUTCHours();
    const minute = date.getUTCMinutes();
    const weekday = date.getUTCDay();
    const minuteKey = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
    return { year, month, day, hour, minute, weekday, minuteKey };
  }
}

function matchCronField(expr, value) {
  if (!expr || expr === "*") return true;
  const segments = expr.split(",");
  for (const seg of segments) {
    const trimmed = seg.trim();
    if (trimmed === "*") return true;
    if (trimmed.startsWith("*/")) {
      const step = Number.parseInt(trimmed.slice(2), 10);
      if (step > 0 && value % step === 0) return true;
      continue;
    }
    if (trimmed.includes("-")) {
      const [startStr, endStr] = trimmed.split("-");
      const start = Number.parseInt(startStr, 10);
      const end = Number.parseInt(endStr, 10);
      if (!Number.isNaN(start) && !Number.isNaN(end) && value >= start && value <= end) {
        return true;
      }
      continue;
    }
    const exact = Number.parseInt(trimmed, 10);
    if (!Number.isNaN(exact) && exact === value) return true;
  }
  return false;
}

export function matchesCron(cronExpr, date = new Date(), timeZone = "Asia/Kolkata") {
  return matchesCronParts(cronExpr, getZonedParts(date,timeZone));
}

export function matchesCronParts(cronExpr,parts) {
  if (!cronExpr) return false;
  const fields = String(cronExpr).trim().split(/\s+/);
  if (fields.length !== 5) return false;
  const [minF, hourF, domF, monthF, dowF] = fields;
  return (
    matchCronField(minF, parts.minute) &&
    matchCronField(hourF, parts.hour) &&
    matchCronField(domF, parts.day) &&
    matchCronField(monthF, parts.month) &&
    matchCronField(dowF, parts.weekday)
  );
}

export function isTaskDue(task, now = new Date(), timeZone = "Asia/Kolkata") {
  if (!task || !task.enabled) return false;

  if (task.schedule_type === "once") {
    if (!task.run_at) return false;
    const runAtMs = new Date(task.run_at).getTime();
    return !Number.isNaN(runAtMs) && now.getTime() >= runAtMs && !task.last_run_at;
  }

  if (task.schedule_type === "interval") {
    const intervalMs = Math.max(5, Number(task.interval_seconds || 60)) * 1000;
    const lastMs = task.last_run_at
      ? new Date(task.last_run_at).getTime()
      : new Date(task.created_at || 0).getTime();
    return now.getTime() - lastMs >= intervalMs;
  }

  if (task.schedule_type === "cron") {
    const parts = getZonedParts(now, timeZone);
    if (task.last_run_minute_key === parts.minuteKey) return false;
    return matchesCron(task.cron_expr, now, timeZone);
  }

  return false;
}

export function matchesRuleCondition(rule, eventType, payload = {}, now = new Date(), previous = null) {
  if (!rule || !rule.enabled || rule.event_type !== eventType) return false;

  const cooldownMs = Math.max(0, Number(rule.cooldown_seconds ?? 60)) * 1000;
  if (rule.last_triggered_at) {
    const lastMs = new Date(rule.last_triggered_at).getTime();
    if (!Number.isNaN(lastMs) && now.getTime() - lastMs < cooldownMs) {
      return false;
    }
  }

  const cond = rule.condition || {};

  if (eventType === "notification") {
    if (cond.app && cond.app !== "*") {
      if (String(payload.app || "").toLowerCase() !== String(cond.app).toLowerCase()) {
        return false;
      }
    }
    if (cond.sender) {
      const senderStr = String(payload.sender || "").toLowerCase();
      if (!senderStr.includes(String(cond.sender).toLowerCase())) {
        return false;
      }
    }
    if (cond.textContains) {
      const textStr = String(payload.text || "").toLowerCase();
      if (!textStr.includes(String(cond.textContains).toLowerCase())) {
        return false;
      }
    }
    return true;
  }

  if (eventType === "telemetry") {
    if (cond.on_entry) {
      // No fabricated transition on initial registration or incomplete samples.
      const fields = Object.keys(cond).filter(k=>k!=='on_entry').map(k=>k.split('_')[0]);
      if (!previous || fields.some(k=>previous[k]==null || payload[k]==null)) return false;
      if (matchesRuleCondition({...rule,last_triggered_at:null,condition:{...cond,on_entry:false}},eventType,previous,now)) return false;
    }
    if (typeof cond.charging === 'boolean' && payload.charging !== cond.charging) return false;
    if (typeof cond.battery_gte === 'number' && !(Number.isFinite(payload.battery) && payload.battery >= cond.battery_gte)) return false;
    if (typeof cond.volume_gte === 'number' && !(Number.isFinite(payload.volume) && payload.volume >= cond.volume_gte)) return false;
    if (typeof cond.battery_lt === "number") {
      if (typeof payload.battery !== "number" || !(payload.battery < cond.battery_lt)) {
        return false;
      }
    }
    if (typeof cond.battery_lte === "number") {
      if (typeof payload.battery !== "number" || !(payload.battery <= cond.battery_lte)) {
        return false;
      }
    }
    if (cond.wifi_equals) {
      if (String(payload.wifi || "").toLowerCase() !== String(cond.wifi_equals).toLowerCase()) {
        return false;
      }
    }
    if (typeof cond.locked === "boolean") {
      if (payload.locked !== cond.locked) return false;
    }
    return true;
  }

  return false;
}
