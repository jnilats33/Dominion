'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
const from=html.indexOf('    async function confirmRedemption() {');
const to=html.indexOf('    function renderRewards() {',from);
assert.ok(from>0&&to>from,'redemption source found');
const code=html.slice(from,to);
function harness({balance=100,mode='belohnungen',catalog=[{id:'a',title:'Film',rewardPoints:20}],remoteBalance=balance,remoteCatalog=catalog,actor='Daisy',remoteHook=()=>{}}={}){
  let remote={mgmt:{belohnungen:mode==='belohnungen'?structuredClone(remoteCatalog):[],strafen:mode==='strafen'?structuredClone(remoteCatalog):[]},rewardLedger:remoteBalance?[{id:'seed',amount:remoteBalance}]:[]};
  let calls=0;
  const messages=[];
  const sandbox={
    redemptionSelection:{a:2},redemptionPending:false,productionRoomLoaded:true,productionSyncConflict:false,
    lastRemoteState:{mgmt:structuredClone(remote.mgmt),rewardLedger:structuredClone(remote.rewardLedger)},
    appState:{mgmt:structuredClone(remote.mgmt),rewardLedger:structuredClone(remote.rewardLedger)},
    currentRole:actor,testAuthRole:actor,testAuthUser:{uid:'test'},
    pendingCollectionWrites:new Map(),console,Date,Math,
    rewardAmount:v=>Math.max(0,Math.floor(Number(v)||0)),
    rewardBalance:()=>balance,
    redemptionMode:()=>mode,
    redemptionCatalog:()=>catalog,
    sameRemoteValue:(a,b)=>JSON.stringify(a??null)===JSON.stringify(b??null),
    confirm:()=>true,renderRewards(){},showToast:m=>messages.push(m),
    firebaseDbRef:{transaction:async update=>{
      calls++;remoteHook(remote);
      const result=update(structuredClone(remote));
      if(result===undefined)return {committed:false};
      remote=structuredClone(result);return {committed:true};
    }}
  };
  vm.createContext(sandbox);
  vm.runInContext(code+'\nthis.redeem=confirmRedemption;',sandbox);
  return {run:()=>sandbox.redeem(),get remote(){return remote;},get calls(){return calls;},messages,sandbox};
}
test('positive balance deducts selected reward exactly once',async()=>{
  const h=harness();await h.run();
  assert.equal(h.remote.rewardLedger.at(-1).amount,-40);
  assert.equal(h.remote.rewardLedger.at(-1).redemption.items[0].count,2);
  assert.equal(h.calls,1);
});
test('negative balance adds points toward zero for Master',async()=>{
  const h=harness({balance:-80,remoteBalance:-80,mode:'strafen',actor:'Master'});
  await h.run();assert.equal(h.remote.rewardLedger.at(-1).amount,40);
});
test('concurrent spend prevents overdraft',async()=>{
  const h=harness({remoteHook:remote=>remote.rewardLedger.push({id:'other',amount:-80})});
  await h.run();assert.equal(h.remote.rewardLedger.length,2);assert.equal(h.calls,1);
  assert.match(h.messages.join(' '),/Nicht gebucht/);
});
test('catalog price change aborts instead of using stale price',async()=>{
  const h=harness({remoteHook:remote=>remote.mgmt.belohnungen[0].rewardPoints=30});
  await h.run();assert.equal(h.remote.rewardLedger.length,1);
});
test('deleted catalog entry aborts',async()=>{
  const h=harness({remoteHook:remote=>remote.mgmt.belohnungen=[]});
  await h.run();assert.equal(h.remote.rewardLedger.length,1);
});
test('dirty local ledger prevents transaction',async()=>{
  const h=harness();h.sandbox.appState.rewardLedger.push({id:'unsynced',amount:10});
  await h.run();assert.equal(h.calls,0);
});
test('dirty local catalog prevents transaction',async()=>{
  const h=harness();h.sandbox.appState.mgmt.belohnungen[0].rewardPoints=999;
  await h.run();assert.equal(h.calls,0);
});
test('role mismatch prevents transaction',async()=>{
  const h=harness();h.sandbox.testAuthRole='Master';
  await h.run();assert.equal(h.calls,0);
});
test('rapid double click does not create second booking',async()=>{
  const h=harness();await Promise.all([h.run(),h.run()]);
  assert.equal(h.calls,1);
});
test('selection count must be positive integer',async()=>{
  const h=harness();h.sandbox.redemptionSelection.a=1.5;
  await h.run();assert.equal(h.calls,0);
});
