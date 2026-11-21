import {compoundRequest} from './flash-workflow.mjs';
import { getZonedParts, matchesCronParts } from './scheduler.mjs';
import { planDeterministic } from './planner.mjs';

const fold = text => text.trim().toLowerCase().replace(/\s+/g, ' ');
const aliases = new Map(Object.entries({
  'कल':'kal', 'आज':'aaj', 'सुबह':'subah', 'शाम':'shaam', 'रात':'raat', 'बजे':'baje',
  'याद':'yaad', 'दिलाना':'dilana', 'चालू':'chalu', 'करो':'karo', 'बंद':'band', 'खोलो':'kholo',
  'ब्राइटनेस':'brightness', 'फ्लैशलाइट':'flashlight', 'डीएनडी':'dnd', 'ब्रीफिंग':'briefing', 'की':'ki'
}));
function normalize(text) {
  return text.replace(/[०-९]/g, c => String(c.charCodeAt(0)-2406)).split(/\s+/).map(w => aliases.get(w) || w).join(' ');
}
function translated(text) {
  return normalize(text).replace(/^(.+?)\s+kholo$/i,'Open $1')
    .replace(/^(dnd|flashlight)\s+(chalu|band)(?: karo)?$/i, (_, what, how) => `Turn ${how.toLowerCase()==='band'?'off':'on'} ${what}`)
    .replace(/^brightness\s+(\d{1,3})%?\s+karo$/i,'Set brightness to $1%');
}
const problem = message => Object.assign(new Error(message), {status:400});

// Resolve wall time against the configured zone rather than the server's zone.
function wallInstant(day, hour, minute, now, zone) {
  const p = getZonedParts(now, zone);
  const wall = Date.UTC(p.year,p.month-1,p.day+(day==='kal'?1:0),hour,minute);
  let guess = wall;
  for (let i=0;i<4;i++) {
    const q = getZonedParts(new Date(guess),zone);
    const diff = wall-Date.UTC(q.year,q.month-1,q.day,q.hour,q.minute);
    if (!diff && guess > now.getTime()) return new Date(guess).toISOString();
    if (!diff) break;
    guess += diff;
  }
  throw problem('Choose a future time that exists in your configured timezone.');
}
export function reminderPlan(prompt, now, zone) {
  // Normalize only the timing prefix; leave the reminder message as dictated.
  const parts = prompt.trim().match(/^(.*?)\s+(?:yaad dilana|याद दिलाना)(?:\s*[:,-]?\s*(.*))?$/iu);
  if (!parts) return null;
  const m = normalize(parts[1]).match(/^(kal|aaj)\s+(?:(subah|shaam|raat)\s+)?(\d{1,2})(?::(\d{2}))?\s+baje$/i);
  if (!m) throw problem('Try: Kal subah 8 baje yaad dilana: dawa leni hai');
  let hour = Number(m[3]); const minute = Number(m[4] || 0);
  if (minute>59 || hour>23 || (m[2] && (hour<1 || hour>12))) throw problem('Invalid reminder time');
  if (m[2]) hour = hour%12 + (fold(m[2])==='subah'?0:12);
  const run_at = wallInstant(fold(m[1]),hour,minute,now,zone);
  const message = parts[2]?.trim() || 'Aapka reminder';
  if (message.length>500) throw problem('Keep the reminder under 501 characters');
  return {kind:'schedule', summary:`Reminder: ${message} · ${new Date(run_at).toLocaleString('en-IN',{timeZone:zone})} (${zone})`,
    schedule:{name:message, schedule_type:'once',run_at},actions:[{type:'reminder',label:message,message,requiresUnlock:false}]};
}

export async function assistantPlan(store, settings, prompt, source, now = new Date()) {
  const zone = settings.timezone || 'Asia/Kolkata';
  const reminder = reminderPlan(prompt,now,zone);
  if (reminder) return reminder;
  if (/^(daily briefing|aaj ki briefing)$/i.test(normalize(prompt.trim()))) return {kind:'briefing'};
  const routines = settings.routines || [];
  const definition = prompt.match(/^(?:save routine|routine banao)\s+([^:=]+)\s*[:=]\s*(.+)$/i);
  if (definition) {
    if (source==='device') throw problem('Create routines from the operator dashboard');
    const name = fold(definition[1]);
    const steps = definition[2].split(';').map(s=>s.trim());
    if (!name || name.length>50 || steps.length<2 || steps.length>10 || steps.some(s=>!s || s.length>250)) throw problem('Use a short name and 2–10 steps separated by semicolons');
    const actions = steps.flatMap(s=>{
      const p=planDeterministic(translated(s),now);
      if (p.kind!=='command' || p.actions.some(a=>a.label.startsWith('Execute intent:'))) throw problem(`Unsupported routine step: ${s}`);
      return p.actions;
    });
    const rest=routines.filter(r=>r.name!==name);
    if (rest.length>=50) throw problem('Routine limit reached');
    await store.updateSettings({routines:[...rest,{name,actions}]});
    return {kind:'routine',summary:`Saved “${name}”. Say “Run ${name}” to start.`};
  }
  const run = prompt.match(/^(?:run|chalao)\s+(.+)$/i);
  const routine = routines.find(r=>r.name===fold(run?.[1] || prompt));
  if (routine) return {kind:'command',summary:`Routine: ${routine.name}`, actions:routine.actions};
  if (run && !process.env.GEMINI_API_KEY) throw problem(`Unknown routine: ${run[1]}`);
  if (process.env.GEMINI_API_KEY && compoundRequest(prompt)) return null;
  const mapped=translated(prompt);
  if (mapped === prompt) return null;
  const local = planDeterministic(mapped,now);
  return local.actions.some(a=>a.label?.startsWith("Execute intent:")) ? null : local;
}

export async function dailyBriefing(store, device, zone, now = new Date()) {
  const [notes,tasks] = await Promise.all([store.listNotifications(20,device.id),store.listTasks()]);
  const p=getZonedParts(now,zone);
  const today=t => {
    if (!t.enabled || ![device.id,'auto'].includes(t.target_device_id)) return false;
    if (t.schedule_type==='once') return getZonedParts(new Date(t.run_at),zone).minuteKey.slice(0,10)===p.minuteKey.slice(0,10);
    if (t.schedule_type==='cron') {
      for (let hour=0;hour<24;hour++) for (let minute=0;minute<60;minute++) if(matchesCronParts(t.cron_expr,{...p,hour,minute})) return true;
    }
    if (t.schedule_type==='interval') {
      const next=Math.max(+now,Date.parse(t.last_run_at || t.created_at)+Math.max(5,t.interval_seconds)*1000);
      return Number.isFinite(next) && getZonedParts(new Date(next),zone).minuteKey.slice(0,10)===p.minuteKey.slice(0,10);
    }
    return false;
  };
  const due=tasks.filter(today);
  const battery=device.telemetry?.battery;
  return `Battery: ${Number.isFinite(battery)?battery+'%':'unknown'}. Recent unread: ${notes.length}${notes.length===20?'+':''}${notes.length?' — '+notes.slice(0,3).map(n=>`${n.app}: ${String(n.text||'').slice(0,80)}`).join('; '):''}. Today’s tasks: ${due.length}${due.length?' — '+due.slice(0,5).map(t=>t.name).join('; '):''}.`;
}
