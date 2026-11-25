import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

// Controller acceptance tests exercise production handlers. Provider routing and
// response contracts have their own data suite and separate live browser checks.
const source=fs.readFileSync(new URL('../src/feed-controller.js',import.meta.url),'utf8');
const clone=value=>JSON.parse(JSON.stringify(value));
const defaults={maxSources:5,timeoutMs:4000,deadlineMs:18000,providers:['kraken','coinbase','bitstamp','binance','binance-us','yahoo','twelve'],stockTransports:['corsdev','allorigins','corslol'],twelveKey:''};
function harness({stored=null,readError=false,writeError=false,market={symbol:'KRAKEN:BTCUSD',crypto:true},health=[]}={}){
 const nodes=new Map(),calls=[],writes=[],aborts=[],cache=new Map([['old',{}]]),alertsCache=new Map([['old',{}]]);
 let config=clone(defaults),raw=stored;
 class Node{constructor(id){this.id=id;this.value='';this.textContent='';this.innerHTML='';this.open=false;this.checked=false;this.dataset={};}showModal(){this.open=true;}close(){this.open=false;}}
 const get=id=>{if(!nodes.has(id))nodes.set(id,new Node(id));return nodes.get(id);};
 const checkboxes=(selector)=>{
  const provider=selector.includes('provider'),container=get(provider?'feedProviders':'feedTransports');
  return [...container.innerHTML.matchAll(/<input[^>]*data-feed-(?:provider|transport)="([^"]+)"[^>]*>/g)].map(match=>{
   const id=(provider?'provider-':'transport-')+match[1],node=get(id);
   if(!node.prepared){node.dataset[provider?'feedProvider':'feedTransport']=match[1];node.checked=/\schecked(?:\s|>)/.test(match[0]);node.prepared=true;}
   return node;
  });
 };
 const validate=input=>{
  if(!input||!Number.isInteger(input.maxSources)||input.maxSources<1||input.maxSources>20)throw Error('Choose a valid maximum source count.');
  if(!Number.isFinite(input.timeoutMs)||input.timeoutMs<100||!Number.isFinite(input.deadlineMs)||input.deadlineMs<input.timeoutMs)throw Error('Choose a valid request timeout.');
  if(!Array.isArray(input.providers)||!input.providers.length||input.providers.some(id=>!defaults.providers.includes(id)))throw Error('Choose a supported provider.');
  if(!Array.isArray(input.stockTransports)||input.stockTransports.some(id=>!defaults.stockTransports.includes(id))||typeof input.twelveKey!=='string')throw Error('Invalid feed configuration.');
  return clone(input);
 };
 const scope=vm.createContext({Date,Map,Set,Promise,console,
  $:get,escapeHTML:s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),toast:message=>calls.push(['toast',message]),
  document:{querySelectorAll:checkboxes},
  localStorage:{getItem(){if(readError)throw Error('Storage blocked');return raw;},setItem(key,value){if(writeError)throw Error('Storage blocked');writes.push({key,value});raw=value;}},
  MarketData:{defaults:clone(defaults),config:()=>clone(config),validateConfig:validate,configure:input=>{config=validate(input);calls.push(['configure']);return clone(config);},
   coverage:()=>({candles:[{id:'a',label:'Yahoo via relay A',provider:'yahoo',transport:'corsdev'},{id:'b',label:'Yahoo via relay B',provider:'yahoo',transport:'allorigins'}],quote:[],book:[],trades:[]}),health:()=>health},
  state:{interval:'D',drawings:{'KRAKEN:BTCUSD':[{type:'horizontal',price:100}]},favorites:['KRAKEN:BTCUSD']},
  chartCache:cache,alertFeedCache:alertsCache,chartController:{abort:()=>aborts.push('chart')},detailController:{abort:()=>aborts.push('detail')},quoteController:{abort:()=>aborts.push('quote')},
  chartVersion:4,marketVersion:2,alertConfigVersion:7,chartBusy:true,detailBusy:true,quoteBusy:true,
  current:()=>market,loadChart:force=>calls.push(['chart',force]),refreshQuotes:()=>calls.push(['quotes']),refreshDetails:()=>calls.push(['details']),refreshAlerts:force=>calls.push(['alerts',force])
 });
 vm.runInContext(source+';globalThis.api={initFeedSettings,openFeedSettings,applyFeedSettings,readFeedSettings,renderFeedSettingsStatus,feedFormSettings};',scope);
 return {api:scope.api,get,scope,calls,writes,aborts,cache,alertsCache,config:()=>clone(config),raw:()=>raw,checkboxes,flush:()=>new Promise(resolve=>setImmediate(resolve))};
}
let passed=0;
async function test(name,fn){await fn();passed++;console.log('PASS',name);}
await test('Invalid input leaves active feeds, requests, caches, storage and application preferences untouched',()=>{
 const h=harness(),before=clone(h.scope.state);h.api.initFeedSettings();
 assert.throws(()=>h.api.applyFeedSettings({...defaults,maxSources:0}),/source count/);
 assert.deepEqual(h.config(),defaults);assert.equal(h.calls.length,0);assert.equal(h.aborts.length,0);assert.equal(h.writes.length,0);assert.equal(h.cache.size,1);assert.equal(h.alertsCache.size,1);assert.deepEqual(clone(h.scope.state),before);
});
await test('Applying settings invalidates old work and cached feeds, refreshes all active capabilities and preserves drawings',async()=>{
 const h=harness(),before=clone(h.scope.state);h.api.initFeedSettings();
 h.api.applyFeedSettings({...defaults,maxSources:3,providers:['kraken','coinbase']});await h.flush();
 assert.equal(h.config().maxSources,3);assert.deepEqual(h.aborts,['chart','detail','quote']);assert.equal(h.cache.size,0);assert.equal(h.alertsCache.size,0);
 assert.equal(h.scope.chartVersion,5);assert.equal(h.scope.marketVersion,3);assert.equal(h.scope.alertConfigVersion,8);
 assert.equal(h.scope.chartBusy,false);assert.equal(h.scope.detailBusy,false);assert.equal(h.scope.quoteBusy,false);
 for(const name of ['chart','quotes','details','alerts'])assert.ok(h.calls.some(call=>call[0]===name),name+' refreshed');
 assert.deepEqual(clone(h.scope.state),before);assert.equal(h.writes[0].key,'market-terminal-feeds-v1');
});
await test('Saved settings restore on initialization before network startup and survive a new instance',async()=>{
 const h=harness();h.api.initFeedSettings();h.api.applyFeedSettings({...defaults,maxSources:2,twelveKey:'fixture-provider-key'});await h.flush();
 const restored=harness({stored:h.raw()});restored.api.initFeedSettings();assert.equal(restored.config().maxSources,2);assert.equal(restored.config().twelveKey,'fixture-provider-key');
 assert.deepEqual(restored.calls,[['configure']]);assert.equal(restored.aborts.length,0);assert.equal(restored.writes.length,0);
});
await test('Blocked or malformed saved state falls back to defaults with a truthful visible notice',()=>{
 for(const opts of [{readError:true},{stored:'broken JSON'},{stored:JSON.stringify({...defaults,maxSources:0})}]){
  const h=harness(opts);h.api.initFeedSettings();h.api.openFeedSettings();assert.deepEqual(h.config(),defaults);assert.match(h.get('feedStatus').textContent,/could not be read/);assert.equal(h.writes.length,0);
 }
});
await test('Blocked writes keep the new settings in this tab and explain that persistence failed',async()=>{
 const h=harness({writeError:true});h.api.initFeedSettings();h.api.applyFeedSettings({...defaults,maxSources:2});await h.flush();
 assert.equal(h.config().maxSources,2);assert.equal(h.writes.length,0);assert.match(h.get('feedStatus').textContent,/this tab.*storage is unavailable/);assert.ok(h.calls.some(call=>call[0]==='toast'&&/tab only/.test(call[1])));
});
await test('Opening and cancelling a draft does not apply it or alter requests and saved data',()=>{
 const h=harness();h.api.initFeedSettings();h.api.openFeedSettings();assert.equal(h.get('feedsDialog').open,true);
 h.get('feedMaxSources').value='2';h.get('feedTwelveKey').value='unapplied-key';h.get('closeFeeds').onclick();
 assert.equal(h.get('feedsDialog').open,false);assert.deepEqual(h.config(),defaults);assert.equal(h.calls.length,0);assert.equal(h.aborts.length,0);assert.equal(h.writes.length,0);
 h.api.openFeedSettings();assert.equal(h.get('feedMaxSources').value,'5');assert.equal(h.get('feedTwelveKey').value,'');
});
await test('Submitting form units and enabled providers applies the actual input without changing unrelated preferences',async()=>{
 const h=harness();h.api.initFeedSettings();h.api.openFeedSettings();
 h.get('feedMaxSources').value='2';h.get('feedTimeout').value='2.5';h.get('feedDeadline').value='12';h.get('feedTwelveKey').value=' fixture-provider-key ';
 for(const node of h.checkboxes('input[data-feed-provider]'))node.checked=['yahoo','twelve'].includes(node.dataset.feedProvider);
 let prevented=false;h.get('feedsForm').onsubmit({preventDefault(){prevented=true;}});await h.flush();
 assert.equal(prevented,true);assert.equal(h.config().timeoutMs,2500);assert.equal(h.config().deadlineMs,12000);assert.deepEqual(h.config().providers,['yahoo','twelve']);assert.equal(h.config().twelveKey,'fixture-provider-key');assert.equal(h.get('feedError').textContent,'');
});
await test('Form validation errors stay visible without mutating the active configuration',()=>{
 const h=harness();h.api.initFeedSettings();h.api.openFeedSettings();h.get('feedMaxSources').value='0';h.get('feedsForm').onsubmit({preventDefault(){}});
 assert.match(h.get('feedError').textContent,/source count/);assert.deepEqual(h.config(),defaults);assert.equal(h.writes.length,0);assert.equal(h.aborts.length,0);
});
await test('Coverage distinguishes two relay paths from one independent provider and shows unsupported capabilities',()=>{
 const h=harness({market:{symbol:'NASDAQ:AMZN',crypto:false}});h.api.initFeedSettings();h.api.openFeedSettings();
 assert.match(h.get('feedCoverage').innerHTML,/2 compatible paths \/ 1 independent provider/);assert.match(h.get('feedCoverage').innerHTML,/0 compatible paths \/ 0 independent providers/);assert.match(h.get('feedCoverage').innerHTML,/only for starter crypto/);
});
await test('Health rendering escapes upstream errors and redacts the optional credential outside its password field',async()=>{
 const key='fixture-provider-key',h=harness({health:[{id:'one',label:'<provider>',cooldownUntil:Date.now()+90000,lastError:'Failure '+key+' <script>',lastSuccessAt:null}]});
 h.api.initFeedSettings();h.api.applyFeedSettings({...defaults,twelveKey:key});await h.flush();h.api.openFeedSettings();
 assert.match(h.get('feedHealth').innerHTML,/&lt;provider&gt;/);assert.match(h.get('feedHealth').innerHTML,/&lt;script&gt;/);assert.match(h.get('feedHealth').innerHTML,/redacted/);assert.ok(!h.get('feedHealth').innerHTML.includes(key));
 assert.ok(!JSON.stringify(h.calls).includes(key));assert.equal(h.get('feedTwelveKey').value,key);
});
await test('Reset restores feed defaults and refreshes the active chart without enabling crypto-only details for stocks',async()=>{
 const h=harness({market:{symbol:'NASDAQ:AMZN',crypto:false}});h.api.initFeedSettings();h.api.applyFeedSettings({...defaults,maxSources:2});await h.flush();h.calls.length=0;h.get('resetFeeds').onclick();await h.flush();
 assert.deepEqual(h.config(),defaults);assert.ok(h.calls.some(call=>call[0]==='chart'));assert.ok(!h.calls.some(call=>call[0]==='details'));
});
console.log(`${passed} feed-settings checks passed. Live provider routing is verified separately.`);
