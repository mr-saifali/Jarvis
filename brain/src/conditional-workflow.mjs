const bad = message => Object.assign(new Error(`${message} Nothing was queued.`), {status:400});

// Parse the guard outside the LLM so a model cannot remove it. An optional
// alternative is evaluated only when the guard is known to be false.
export function parseWorkflow(prompt) {
  const explicit = /^workflow\s*:\s*/i;
  if (!explicit.test(prompt)) return null;
  const body = prompt.replace(explicit,'').trim();
  if (!body || body.length > 1500) throw bad('Use a workflow of 1–1500 characters.');
  if (!/^(if|agar)\s/i.test(body)) return {yes:body};
  const match = body.match(/^(?:if|agar)\s+(.+?)\s+(?:then|toh)\s+(.+)$/i);
  if (!match) throw bad('Use: if battery < 30 then … else …');
  const branches = match[2].split(/\s+(?:else|warna)\s+/i);
  if (branches.length > 2 || branches.some(b=>/\b(if|agar|else|warna)\b/i.test(b))) throw bad('Use one condition per workflow.');
  const guard = match[1].trim().toLowerCase();
  if (['charging','locked','unlocked'].includes(guard)) return {guard,yes:branches[0],no:branches[1]};
  const m = guard.match(/^battery\s*(<=|>=|<|>)\s*(\d{1,3})%?$/);
  if (!m || +m[2]>100) throw bad('Supported conditions: charging, locked, unlocked, or battery < / <= / > / >= a percentage.');
  return {guard:'battery',op:m[1],threshold:+m[2],yes:branches[0],no:branches[1]};
}

export function selectBranch(flow,device,now=Date.now()) {
  if (!flow.guard) return flow.yes;
  const age=now-Date.parse(device.last_seen_at);
  if(device.type!=='simulator' && (!Number.isFinite(age)||age<0||age>60000)) throw bad('Phone status is stale. Connect the bridge and retry.');
  const tel=device.telemetry || {};
  let passed;
  if(flow.guard==='battery') {
    const n=tel.battery;
    if(!Number.isFinite(n)||n<0||n>100) throw bad('No valid battery reading.');
    const t=flow.threshold;passed=({'<':n<t,'<=':n<=t,'>':n>t,'>=':n>=t})[flow.op];
  } else {
    const value=tel[flow.guard==='charging'?'charging':'locked'];
    if(typeof value!=='boolean') throw bad('Phone did not report the requested status.');
    passed=flow.guard==='unlocked'?!value:value;
  }
  return passed ? flow.yes : flow.no;
}
