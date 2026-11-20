// The model selects operations; the server supplies labels, permission gates and
// execution policy. Never trust model-generated device actions or status fields.
export const compoundRequest = text => /;|\b(?:and then|then|and|aur|phir|fir)\b|और|फिर/iu.test(text);
const tools = ['set_dnd','set_flashlight','set_brightness','set_volume','open_app','set_timer','notify','open_settings','media_control','set_alarm'];
export const workflowInstruction = `Plan ALL parts of this immediate phone request in their original order. Use 2–8 steps. Each step has exactly two string fields: tool and value. Supported tools: set_dnd and set_flashlight (on/off), set_brightness (5–100 percent, digits only), set_volume (0–100 percent, digits only), open_app (app name), set_timer (seconds), notify (literal notification text), open_settings (wifi/bluetooth/sound/battery: open a settings screen only, never claim to toggle), media_control (play/pause/next/previous), set_alarm (absolute local time in 24h HH:MM). Never invent a missing duration, level, recipient or action. Do not substitute notify for sending a message. If any part is unsupported, ambiguous, conditional, scheduled or not requested, return an empty steps array. Return JSON only.`;
export const workflowSchema = {type:'OBJECT',required:['steps'],properties:{steps:{type:'ARRAY',items:{type:'OBJECT',required:['tool','value'],properties:{tool:{type:'STRING',enum:tools},value:{type:'STRING'}}}}}};
export function validateWorkflow(data) {
  const invalid = () => { throw Object.assign(new Error('Cannot safely plan every step. Nothing was queued. Specify each app, setting or timer separately.'),{status:400}); };
  if (!Array.isArray(data?.steps) || data.steps.length < 2 || data.steps.length > 8) invalid();
  const actions = data.steps.map(step => {
    if (!step || Object.keys(step).length !== 2 || !tools.includes(step.tool) || typeof step.value !== 'string') invalid();
    const type=step.tool, value=step.value.trim();
    if (!value || value.length>300 || /[\x00-\x1f]/.test(value)) invalid();
    const base={type, stopOnFailure:true, requiresUnlock:type==='open_app' || type==='set_timer'};
    if (type==='set_dnd' || type==='set_flashlight') {
      if (!['on','off'].includes(value)) invalid();
      return {...base,enabled:value==='on',label:`${type==='set_dnd'?'Do Not Disturb':'Flashlight'}: ${value}`};
    }
    if (type==='open_settings') {
      if (!['wifi','bluetooth','sound','battery'].includes(value)) invalid();
      return {...base,requiresUnlock:true,panel:value,label:`Open ${value} settings`};
    }
    if (type==='media_control') {
      if (!['play','pause','next','previous'].includes(value)) invalid();
      return {...base,command:value,label:`Media: ${value}`};
    }
    if (type==='set_alarm') {
      if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) invalid();
      return {...base,requiresUnlock:true,time:value,label:`Set alarm for ${value}`};
    }
    if (type==='open_app') {
      if (value.length>80) invalid();
      return {...base,app:value,label:`Open ${value}`};
    }
    if (type==='notify') return {...base,message:value,title:'Jarvis',label:`Notify: ${value}`};
    if (!/^\d{1,5}$/.test(value)) invalid();
    const n=Number(value);
    if (type==='set_timer') {
      if (n<1 || n>86400) invalid();
      return {...base,seconds:n,label:`Start ${n}s timer`};
    }
    if (n>100 || (type==='set_brightness' && n<5)) invalid();
    return {...base,level:n,label:`${type==='set_volume'?'Volume':'Brightness'}: ${n}%`};
  });
  return {kind:'command',actions,summary:actions.map((a,i)=>`${i+1}. ${a.label}`).join(' → ')};
}
