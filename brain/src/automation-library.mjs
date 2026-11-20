// Opt-in recipes, not model-generated instructions. Only the fixed actions below
// can be installed through this path. Bind each copy to one concrete device.
const action = (type,label,fields={}) => ({type,label,requiresUnlock:false,...fields});
const remind = message => action('reminder',message,{message});
const level = (type,n) => action(type,`${type==='set_volume'?'Media volume':'Brightness'} ${n}%`,{level:n});
const dnd = enabled => action('set_dnd',`DND ${enabled?'on':'off'}`,{enabled});
const cron = (id,name,description,expr,...actions) => ({id,name,description,cron_expr:expr,actions});
const event = (id,name,description,event_type,condition,cooldown_seconds,...actions) => ({id,name,description,event_type,condition,cooldown_seconds,actions});
const telemetry = (id,name,description,condition,...actions) => event(id,name,description,'telemetry',{...condition,on_entry:true},300,...actions);
const keyword = (id,name,app,text,message) => event(id,name,`${app} notification contains “${text}” → reminder: ${message}`,'notification',{app,textContains:text},1800,remind(message));
export const library = [
  cron('morning-digest','Morning digest','07:30 daily → summarize recent unread notifications into the Jarvis vault.','30 7 * * *',action('summarize_notifications','Summarize unread'),action('save_to_vault','Save morning digest',{title:'Morning digest',destination:'Jarvis'})),
  cron('office-focus','Office focus','09:00 weekdays → enable Do Not Disturb and set media volume to 20%.','0 9 * * 1-5',dnd(true),level('set_volume',20)),
  cron('lunch-break','Lunch break','13:00 weekdays → pause playback and show a lunch reminder.','0 13 * * 1-5',action('media_control','Pause media',{command:'pause'}),remind('Time for lunch.')),
  cron('eye-break','Eye break','Every 30 minutes, 10:00–17:30 weekdays → remind you to look away from the screen.','*/30 10-17 * * 1-5',remind('Look into the distance for 20 seconds.')),
  cron('work-wrap','Work wrap-up','18:00 weekdays → turn DND off and prompt for tomorrow’s top task.','0 18 * * 1-5',dnd(false),remind('Note your first task for tomorrow.')),
  cron('wind-down','Wind down','22:00 daily → dim brightness to 20% and lower media volume to 15%.','0 22 * * *',level('set_brightness',20),level('set_volume',15)),
  cron('weekly-review','Weekly review','18:00 Sundays → remind you to review outstanding follow-ups.','0 18 * * 0',remind('Open Kya baaki hai and review follow-ups.')),
  cron('backup-check','Backup check','10:00 on the first of each month → remind you to check your last backup.','0 10 1 * *',remind('Check when your phone last backed up.')),
  telemetry('low-power','Low-power dimmer','Entering ≤20% battery while unplugged → reduce brightness to 25%.',{battery_lte:20,charging:false},level('set_brightness',25)),
  telemetry('charge-ready','Charging target','Reaching ≥80% while charging → unplug reminder.',{battery_gte:80,charging:true},remind('Battery reached your charging target.')),
  telemetry('charger-check','Charger check','Entering unplugged state below 10% → reconnect reminder.',{battery_lt:10,charging:false},remind('Battery is critically low. Connect a charger.')),
  telemetry('mobile-data','Mobile-data guard','Switching to Mobile Data → remind you to pause large downloads.',{wifi_equals:'Mobile Data'},remind('On mobile data. Check large downloads.')),
  telemetry('wifi-back','Wi-Fi return','Switching to Wi-Fi → remind you to resume pending uploads.',{wifi_equals:'Wi-Fi'},remind('Wi-Fi available. Resume pending uploads.')),
  telemetry('headphone-care','Loud media warning','Entering media volume ≥85% → suggest lowering the volume.',{volume_gte:85},remind('Media volume is high. Consider lowering it.')),
  keyword('interview-prep','Interview prep','Gmail','interview','Review the invitation and prepare your CV.'),
  keyword('invoice-review','Invoice review','Gmail','invoice','Review the invoice and check its due date.'),
  keyword('boarding-pass','Boarding pass','Gmail','boarding pass','Save your boarding pass for offline use.'),
  keyword('delivery-check','Delivery check','SMS','out for delivery','Check the delivery window and address.'),
  keyword('meeting-prep','Meeting prep','WhatsApp','meeting','Check the meeting time and agenda.'),
  keyword('assignment-check','Assignment check','Telegram','assignment','Review the assignment and note its deadline.')
];
export const catalog = library.map(({id,name,description,cron_expr,event_type})=>({id,name,description,category:cron_expr?'Schedule':event_type==='telemetry'?'Phone state':'Notification'}));
export function parseLibraryCommand(prompt) {
  if (/^list automations$/i.test(prompt.trim())) return {verb:'list'};
  const m=prompt.trim().match(/^(enable|disable) automation\s+(.+)$/i);
  return m && {verb:m[1].toLowerCase(),key:m[2].trim().toLowerCase()};
}
export async function applyLibraryCommand(store, request, deviceId) {
  if(request.verb==='list') return {kind:'library',summary:catalog.map(r=>r.id).join(', ')};
  const recipe=library.find(r=>r.id===request.key || r.name.toLowerCase()===request.key);
  if (!recipe) throw Object.assign(new Error('Unknown automation. Use “list automations”.'),{status:400});
  const id=`preset:${recipe.id}:${deviceId}`;
  const scheduled=!!recipe.cron_expr, enabled=request.verb==='enable';
  const existing=scheduled?await store.getTask(id):await store.getRule(id);
  if(existing && existing.enabled!==enabled) {
    if(scheduled) await store.updateTask(id,{enabled}); else await store.updateRule(id,{enabled});
  } else if(!existing && enabled) {
    const common={id,name:recipe.name,prompt:recipe.description,actions:recipe.actions,target_device_id:deviceId,enabled};
    if(scheduled) await store.createTask({...common,schedule_type:'cron',cron_expr:recipe.cron_expr});
    else await store.createRule({...common,event_type:recipe.event_type,condition:recipe.condition,cooldown_seconds:recipe.cooldown_seconds});
  }
  return {kind:'library',summary:`${recipe.name}: ${enabled?'enabled':'disabled'} for ${deviceId}.`};
}
