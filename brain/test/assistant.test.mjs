import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {dailyBriefing, reminderPlan} from '../src/assistant.mjs';
import {dispatchCommand,tickScheduler} from '../src/engine.mjs';
import {LocalJsonStore} from '../src/store.mjs';

function fixture(t) {
  const dir=mkdtempSync(path.join(tmpdir(),'jarvis-skills-'));
  t.after(()=>rmSync(dir,{recursive:true,force:true}));
  return new LocalJsonStore(path.join(dir,'state.json'));
}
test('Reminder dates use local calendar days and preserve dictated Hindi',()=>{
  const now=new Date('2026-12-31T19:00:00Z'); // Jan 1 in Patna
  const p=reminderPlan('कल सुबह ८ बजे याद दिलाना: दवा लेनी है',now,'Asia/Kolkata');
  assert.equal(p.schedule.run_at,'2027-01-02T02:30:00.000Z');
  assert.equal(p.actions[0].message,'दवा लेनी है');
  assert.throws(()=>reminderPlan('Kal shaam 13 baje yaad dilana',now,'Asia/Kolkata'));
});
test('Own-device reminder becomes a queued actionable notification',async t=>{
  const store=fixture(t);await store.upsertDevice({id:'phone',type:'android',online:true});
  const result=await dispatchCommand(store,{deviceId:'phone',source:'device',prompt:'Kal subah 8 baje yaad dilana'});
  await tickScheduler(store,new Date(result.task.run_at));
  const [cmd]=await store.listPendingCommandsForDevice('phone');
  assert.equal(cmd.actions[0].type,'reminder');
});
test('Named routines persist, reject unsupported steps and preserve approvals',async t=>{
  const store=fixture(t);const run=prompt=>dispatchCommand(store,{prompt});
  await run('Routine banao Study mode: DND chalu karo; brightness 30% karo');
  assert.deepEqual((await run('study mode')).command.actions.map(a=>a.type),['set_dnd','set_brightness']);
  await run('Save routine call home: WhatsApp kholo; call Mom');
  assert.equal((await run('Run Call home')).command.status,'awaiting_approval');
  await assert.rejects(run('Save routine oops: nonsense; DND chalu karo'));
});
test('Briefing is scoped to device and local date, including matching recurring tasks',async t=>{
  const store=fixture(t),device={id:'phone',telemetry:{battery:0}};
  for(const id of ['phone','other']) await store.createNotification({device_id:id,app:'Chat',text:id+'-only'});
  for(const [name,cron_expr] of [['Morning','0 8 * * *'],['December','0 8 * 12 *']]) await store.createTask({name,id:name,cron_expr,schedule_type:'cron',target_device_id:'phone'});
  const text=await dailyBriefing(store,device,'Asia/Kolkata',new Date('2026-11-20T00:00:00Z'));
  assert.match(text,/Battery: 0%/);assert.match(text,/phone-only/);assert.match(text,/Morning/);assert.doesNotMatch(text,/other-only|December/);
});
