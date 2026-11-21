// Offline regression tests for the exact functions extracted from index.html.
// Run from repository root: node --test tests/sync-safety.test.cjs
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const html = fs.readFileSync(require('node:path').join(__dirname,'..','index.html'),'utf8');
const start = html.indexOf('    function sameRemoteValue(');
const end = html.indexOf('    // Production chat v2:',start);
assert.ok(start >= 0 && end > start, 'Sync functions found');
const source = html.slice(start,end);
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
    productionRoomLoaded:true, isApplyingRemoteUpdate:false,
    saveStateLocalOnly(){}, sanitizeForFirebase:x=>JSON.parse(JSON.stringify(x)),
    updateSyncIndicator(){}, showToast:(message)=>notifications.push(message),
    console
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
