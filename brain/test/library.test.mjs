import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {library} from '../src/automation-library.mjs';
import {dispatchCommand,evaluateRules,tickScheduler} from '../src/engine.mjs';
import {LocalJsonStore} from '../src/store.mjs';

function setup(t){const dir=mkdtempSync(path.join(tmpdir(),'jarvis-recipes-'));t.after(()=>rmSync(dir,{force:true,recursive:true}));return new LocalJsonStore(path.join(dir,'db'));}
test('20 opt-in recipes install only on the selected device, can be disabled and re-enabled without duplicates',async t=>{
  const store=setup(t), deviceId='sim-pixel-9';
  for(const {id} of library){
    const run=verb=>dispatchCommand(store,{deviceId,prompt:`${verb} automation ${id}`});
    await run('enable'); await run('disable'); await run('enable');
  }
  const tasks=await store.listTasks(),rules=await store.listRules();
  assert.equal(tasks.length,8);assert.equal(rules.length,12);
  assert.ok([...tasks,...rules].every(r=>r.enabled && r.target_device_id===deviceId));
  assert.equal(new Set(library.map(r=>r.id)).size,20);
  await assert.rejects(dispatchCommand(store,{deviceId,prompt:'enable automation anything-else'}));
});
test('Scheduled, transition and notification recipes run through the execution engine',async t=>{
  const store=setup(t), deviceId='sim-pixel-9';
  for(const id of ['charge-ready','meeting-prep','office-focus']) await dispatchCommand(store,{deviceId,prompt:`enable automation ${id}`});
  const now=new Date('2026-11-20T03:30:00Z'); // 09:00 Friday IST
  assert.equal((await tickScheduler(store,now)).length,1);
  const state={battery:81,charging:true};
  const evaluate=(before,time=now)=>evaluateRules(store,'telemetry',state,deviceId,time,before);
  assert.equal((await evaluate(null)).length,0);
  assert.equal((await evaluate({...state,battery:79})).length,1);
  assert.equal((await evaluate(state,new Date(+now+3600000))).length,0);
  const event={app:'WhatsApp',text:'Team meeting tomorrow'};
  assert.equal((await evaluateRules(store,'notification',event,'other',now)).length,0);
  assert.equal((await evaluateRules(store,'notification',event,deviceId,now)).length,1);
  assert.equal((await evaluateRules(store,'notification',event,deviceId,now)).length,0);
});
