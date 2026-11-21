// Offline regression tests for the exact functions extracted from index.html.
// Run from repository root: node --test tests/sync-safety.test.cjs
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const html = fs.readFileSync(require('node:path').join(__dirname,'..','index.html'),'utf8');
const start = html.indexOf('    function saveSyncConflictDraft(');
const end = html.indexOf('    // Production chat v2:',start);
assert.ok(start >= 0 && end > start, 'Sync functions found');
const source = html.slice(start,end);
const draftStorage = new Map();
const localStorageMock = {getItem:key=>draftStorage.get(key)??null,setItem:(key,value)=>draftStorage.set(key,value)};
function harness(remote, local) {
  let state = structuredClone(remote);
  const notifications = [];
  const calls = [];
  const sandbox = {
    appState: structuredClone(local), lastRemoteState: structuredClone(remote),
    firebaseDbRef: {child(key) {return {transaction(update, done) {
      calls.push(key);
      const result = update(structuredClone(state[key] ?? null));
      if (result === undefined) done(null,false);
      else {state[key] = structuredClone(result);done(null,true);}
    }};}},
    productionRoomLoaded:true, productionSyncConflict:false, isApplyingRemoteUpdate:false,
    saveStateLocalOnly(){}, sanitizeForFirebase:x=>JSON.parse(JSON.stringify(x)),
    updateSyncIndicator(){}, showToast:(message)=>notifications.push(message),
    console,localStorage:localStorageMock,SYNC_CONFLICT_DRAFT_KEY:'dominion_sync_conflict_draft_v1'
  };
  vm.createContext(sandbox);
  vm.runInContext(source+'\nthis.runPersist = persistState; this.same = sameRemoteValue;',sandbox);
  return {sandbox,calls,notifications,get state(){return state;},mutateRemote(key,value){state[key]=value;}};
}
test('no changes: no transactions',()=>{
  const h=harness({kalender:[{id:'a'}]}, {kalender:[{id:'a'}]});
  h.sandbox.runPersist();
  assert.deepEqual(h.calls,[]);
});
test('unrelated remote collection survives',()=>{
  const h=harness({kalender:[{id:'a'}],einkauf:[{id:'x'}]}, {kalender:[{id:'a'},{id:'b'}],einkauf:[{id:'x'}]});
  h.sandbox.runPersist();
  assert.deepEqual(h.calls,['kalender']);
  assert.deepEqual(h.state.einkauf,[{id:'x'}]);
});
test('stale snapshot aborts rather than overwriting concurrent remote edit',()=>{
  const h=harness({kalender:[{id:'a'}]}, {kalender:[{id:'a'},{id:'local'}]});
  h.mutateRemote('kalender',[{id:'a'},{id:'remote'}]);
  h.sandbox.runPersist();
  assert.deepEqual(h.state.kalender,[{id:'a'},{id:'remote'}]);
  assert.equal(h.notifications.length,1);
});
test('missing RTDB empty array and local empty array compare equal',()=>{
  const h=harness({kalender:null},{kalender:[]});
  h.sandbox.runPersist();
  assert.deepEqual(h.calls,[]);
});
test('chat and token excluded from general sync',()=>{
  const h=harness({kalender:[]},{kalender:[],chat:[{id:'c'}],chatV2:{c:{}},fcmToken:'secret'});
  h.sandbox.runPersist();
  assert.deepEqual(h.calls,[]);
});
test('disabled sync cannot write',()=>{
  const h=harness({kalender:[]},{kalender:[{id:'new'}]});
  h.sandbox.productionRoomLoaded=false;
  h.sandbox.runPersist();
  assert.deepEqual(h.calls,[]);
});

test('two rapid writes from same baseline must not silently lose the second',()=>{
  const h=harness({kalender:[{id:'a'}]},{kalender:[{id:'a'},{id:'first'}]});
  h.sandbox.runPersist();
  h.sandbox.appState.kalender.push({id:'second'});
  h.sandbox.runPersist();
  assert.deepEqual(h.state.kalender,[{id:'a'},{id:'first'},{id:'second'}]);
});

function delayedHarness(remote,local) {
  let state=structuredClone(remote);
  const pending=[], notifications=[];
  const sandbox={
    appState:structuredClone(local),lastRemoteState:structuredClone(remote),
    firebaseDbRef:{child(key){return {transaction(update,done){pending.push({key,update,done});}}}},
    productionRoomLoaded:true,productionSyncConflict:false,isApplyingRemoteUpdate:false,
    saveStateLocalOnly(){},sanitizeForFirebase:x=>JSON.parse(JSON.stringify(x)),
    updateSyncIndicator(){},showToast:m=>notifications.push(m),console,localStorage:localStorageMock,SYNC_CONFLICT_DRAFT_KEY:'dominion_sync_conflict_draft_v1'
  };
  vm.createContext(sandbox);
  vm.runInContext(source+'\nthis.runPersist=persistState;',sandbox);
  function flush(){
    const job=pending.shift();
    assert.ok(job,'pending transaction');
    const result=job.update(structuredClone(state[job.key]??null));
    if(result===undefined)job.done(null,false);
    else {state[job.key]=structuredClone(result);job.done(null,true);}
  }
  return {sandbox,pending,notifications,flush,get state(){return state;},mutateRemote(k,v){state[k]=v;}};
}
test('delayed transaction queues second local edit',()=>{
  const h=delayedHarness({kalender:[{id:'a'}]},{kalender:[{id:'a'},{id:'first'}]});
  h.sandbox.runPersist();
  h.sandbox.appState.kalender.push({id:'second'});
  h.sandbox.runPersist();
  assert.equal(h.pending.length,1);
  h.flush();
  assert.equal(h.pending.length,1);
  h.flush();
  assert.deepEqual(h.state.kalender,[{id:'a'},{id:'first'},{id:'second'}]);
});
test('delayed external conflict does not retry and overwrite remote changes',()=>{
  const h=delayedHarness({kalender:[{id:'a'}]},{kalender:[{id:'a'},{id:'local'}]});
  h.sandbox.runPersist();
  h.mutateRemote('kalender',[{id:'a'},{id:'remote'}]);
  h.flush();
  assert.deepEqual(h.state.kalender,[{id:'a'},{id:'remote'}]);
  assert.equal(h.pending.length,0);
  assert.equal(h.sandbox.productionRoomLoaded,false);
});

test('room listener must preserve unsaved local edits during pending transaction (source guard)',()=>{
  const listenerStart=html.indexOf("firebaseDbRef.on('value'");
  const listenerEnd=html.indexOf('    function updateSyncIndicator(',listenerStart);
  assert.ok(listenerStart>=0 && listenerEnd>listenerStart);
  const listener=html.slice(listenerStart,listenerEnd);
  // An unconditional full-state replacement is unsafe while writes are pending.
  // This guard deliberately fails until the listener reconciles pending edits.
  assert.match(listener,/pendingCollectionWrites/, 'listener must account for pending writes');
});

function listenerHarness(remote,local) {
  const pending=[];
  const sandbox={
    appState:structuredClone(local),lastRemoteState:structuredClone(remote),
    productionRoomLoaded:true,productionSyncConflict:false,isApplyingRemoteUpdate:false,
    firebaseDbRef:{child(key){return {transaction(update,done){pending.push({key,update,done});}}}},
    saveStateLocalOnly(){},sanitizeForFirebase:x=>JSON.parse(JSON.stringify(x)),
    updateSyncIndicator(){},showToast(){},refreshAllUI(){},localStorage:localStorageMock,SYNC_CONFLICT_DRAFT_KEY:'dominion_sync_conflict_draft_v1',
    mergeWithDefaults:x=>structuredClone(x),console
  };
  const start=html.indexOf("firebaseDbRef.on('value', (snapshot) => {");
  const end=html.indexOf("}, (error) => {",start);
  assert.ok(start>=0&&end>start);
  const listenerBody=html.slice(start+"firebaseDbRef.on('value', (snapshot) => {".length,end);
  vm.createContext(sandbox);
  vm.runInContext(source+'\nthis.runPersist=persistState;this.deliver=function(snapshot){'+listenerBody+'};',sandbox);
  const valid=data=>({mgmt:{aufgaben:[]},basics:{},permissions:{},...structuredClone(data)});
  return {sandbox,pending,deliver:data=>sandbox.deliver({val:()=>valid(data)})};
}
test('incoming unrelated snapshot retains uncommitted local calendar edit',()=>{
  const remote={kalender:[{id:'a'}],einkauf:[]};
  const h=listenerHarness(remote,{...remote,kalender:[{id:'a'},{id:'local'}]});
  h.sandbox.runPersist();
  assert.equal(h.pending.length,1);
  h.deliver({...remote,einkauf:[{id:'other-device'}]});
  assert.deepEqual(h.sandbox.appState.kalender,[{id:'a'},{id:'local'}]);
  assert.deepEqual(h.sandbox.appState.einkauf,[{id:'other-device'}]);
});

test('same-collection remote edit during pending write must abort without overwrite',()=>{
  const remote={kalender:[{id:'a'}]};
  const h=listenerHarness(remote,{...remote,kalender:[{id:'a'},{id:'local'}]});
  h.sandbox.runPersist();
  assert.equal(h.pending.length,1);
  h.deliver({kalender:[{id:'a'},{id:'daisy'}]});
  const job=h.pending.shift();
  const result=job.update([{id:'a'},{id:'daisy'}]);
  assert.equal(result,undefined);
  job.done(null,false);
  assert.equal(h.sandbox.productionRoomLoaded,false);
  assert.deepEqual(h.sandbox.appState.kalender,[{id:'a'},{id:'local'}]);
});
test('failed transaction disables subsequent writes until reconciliation',()=>{
  const h=delayedHarness({kalender:[{id:'a'}]},{kalender:[{id:'a'},{id:'local'}]});
  h.sandbox.runPersist();
  h.mutateRemote('kalender',[{id:'a'},{id:'remote'}]);
  h.flush();
  h.sandbox.appState.kalender.push({id:'another'});
  h.sandbox.runPersist();
  assert.equal(h.pending.length,0);
  assert.equal(h.sandbox.productionRoomLoaded,false);
});

test('incoming snapshot cannot unlock writes after a transaction conflict',()=>{
  const remote={kalender:[{id:'a'}]};
  const h=listenerHarness(remote,{...remote,kalender:[{id:'a'},{id:'local'}]});
  h.sandbox.runPersist();
  const job=h.pending.shift();
  assert.ok(job);
  assert.equal(job.update([{id:'a'},{id:'daisy'}]),undefined);
  job.done(null,false);
  assert.equal(h.sandbox.productionSyncConflict,true);
  h.deliver({kalender:[{id:'a'},{id:'daisy'}]});
  assert.equal(h.sandbox.productionRoomLoaded,false);
  h.sandbox.appState.kalender.push({id:'another'});
  h.sandbox.runPersist();
  assert.equal(h.pending.length,0);
});

test('conflict draft persists and prevents writes after reload',()=>{
  draftStorage.clear();
  const h=delayedHarness({kalender:[{id:'a'}]},{kalender:[{id:'a'},{id:'unsaved'}]});
  h.sandbox.runPersist();
  h.mutateRemote('kalender',[{id:'a'},{id:'remote'}]);
  h.flush();
  const draft=JSON.parse(draftStorage.get('dominion_sync_conflict_draft_v1'));
  assert.deepEqual(draft.drafts.kalender,[{id:'a'},{id:'unsaved'}]);
  const fresh=delayedHarness({kalender:[{id:'a'},{id:'remote'}]},{kalender:[{id:'a'},{id:'remote'}]});
  vm.runInContext('restoreSyncConflictLock()',fresh.sandbox);
  assert.equal(fresh.sandbox.productionSyncConflict,true);
  assert.equal(fresh.sandbox.productionRoomLoaded,false);
  assert.deepEqual(fresh.sandbox.appState.kalender,[{id:'a'},{id:'unsaved'}]);
  fresh.sandbox.runPersist();
  assert.equal(fresh.pending.length,0);
  draftStorage.clear();
});
