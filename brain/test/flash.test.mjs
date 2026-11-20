import test from 'node:test';
import assert from 'node:assert/strict';
import {planCommand,planDeterministic} from '../src/planner.mjs';

test('Flash assists unknown commands only, pins endpoint and falls back on failure', async t=>{
  const original=process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY='test-only';
  t.after(()=>{if(original===undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY=original;});
  const fetcher=t.mock.method(globalThis,'fetch',async(url,options)=>{
    assert.match(url,/^https:\/\/generativelanguage\.googleapis\.com\//);
    assert.equal(options.headers['x-goog-api-key'],'test-only');
    return {ok:true,json:async()=>({candidates:[{content:{parts:[{text:'{"command":"Open Spotify"}'}]}}]})};
  });
  await planCommand('Open WhatsApp');assert.equal(fetcher.mock.callCount(),0);
  const prompt='Gaane waala hara app chala do';
  assert.equal((await planCommand(prompt,{baseUrl:'https://example.invalid'})).actions[0].type,'open_app');
  assert.equal(fetcher.mock.callCount(),1);
  fetcher.mock.mockImplementation(async()=>({ok:false,status:429}));
  assert.deepEqual(await planCommand(prompt),planDeterministic(prompt));
});

test('Compound request becomes ordered phone work, invalid plans never partially dispatch', async t=>{
  const {dispatchCommand}=await import('../src/engine.mjs');
  const old=process.env.GEMINI_API_KEY;process.env.GEMINI_API_KEY='test-only';
  t.after(()=>{if(old===undefined) delete process.env.GEMINI_API_KEY;else process.env.GEMINI_API_KEY=old;});
  let steps=[{tool:'set_dnd',value:'on'},{tool:'set_brightness',value:'30'},{tool:'open_app',value:'Spotify'}];
  t.mock.method(globalThis,'fetch',async()=>({ok:true,json:async()=>({candidates:[{content:{parts:[{text:JSON.stringify({steps})}]}}]})}));
  const sent=[];const store={getSettings:async()=>({}),listDevices:async()=>[{id:'phone',type:'android',online:true}],createCommand:async c=>(sent.push(c),c)};
  const run=()=>dispatchCommand(store,{deviceId:'phone',prompt:'DND chalu karo, phir brightness 30% karo aur Spotify kholo'});
  const {command}=await run();assert.equal(command.status,'queued');assert.deepEqual(command.actions.map(a=>a.type),steps.map(s=>s.tool));
  assert.ok(command.actions.every(a=>a.stopOnFailure));
  steps.push({tool:'set_volume',value:'150'});await assert.rejects(run(),/Nothing was queued/);assert.equal(sent.length,1);
});

test('Settings screens, media and alarms have constrained parameters', async()=>{
  const {validateWorkflow}=await import('../src/flash-workflow.mjs');
  for(const panel of ['Wi-Fi','Bluetooth','sound','battery']) {
    assert.deepEqual(planDeterministic(`${panel} settings kholo`).actions.map(a=>a.panel),[panel.toLowerCase().replace('-','')]);
  }
  const steps=[{tool:'media_control',value:'pause'},{tool:'set_alarm',value:'06:30'},{tool:'open_settings',value:'wifi'}];
  const {actions}=validateWorkflow({steps});
  assert.equal(actions[0].command,'pause');assert.equal(actions[1].time,'06:30');assert.equal(actions[2].requiresUnlock,true);
  for(const [tool,value] of [['open_settings','developer'],['set_alarm','25:61'],['media_control','unknown']]) assert.throws(()=>validateWorkflow({steps:[steps[0],{tool,value}]}));
});
