import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';

// Production request dispatch and protocol parsers; no requests leave this process.
// Real browser/CORS/remote-provider verification is separate acceptance evidence.
const sources=['crypto-feeds.js','chart-data.js'].map(name=>fs.readFileSync(new URL('../src/'+name,import.meta.url),'utf8')).join('\n');
const NOW=Date.parse('2026-11-25T18:00:00Z'),HOUR=3600;
const market={symbol:'KRAKEN:BTCUSD',pair:'XBTUSD'},stock={symbol:'NASDAQ:AMZN'};
const plain=value=>JSON.parse(JSON.stringify(value));
function router({liveClock=false}={}){
 let current=NOW;
 class Clock extends Date{constructor(...args){super(...(args.length?args:[current]));}static now(){return current;}}
 const scope=vm.createContext({URLSearchParams,AbortController,setTimeout,clearTimeout,Date:liveClock?Date:Clock,TypeError,Map,Set,Intl});
 vm.runInContext(sources+';globalThis.api=MarketData;',scope);
 return {api:scope.api,advance:milliseconds=>current+=milliseconds,now:()=>liveClock?Date.now():current};
}
function response(data,{status=200,headers={}}={}){
 const normalized=Object.fromEntries(Object.entries(headers).map(([key,value])=>[key.toLowerCase(),String(value)]));
 return {ok:status>=200&&status<300,status,headers:{get:key=>normalized[String(key).toLowerCase()]??null},json:async()=>data};
}
const candles=[NOW/1000-2*HOUR,NOW/1000-HOUR,NOW/1000].map((t,i)=>({t,o:100+i,h:104+i,l:98+i,c:102+i,v:2+i}));
function kraken(kind,{pair='XXBTZUSD',invalid=false}={}){
 const row=kind==='candles'?candles.map(b=>[b.t,String(b.o),String(b.h),String(b.l),String(b.c),'0',String(b.v),1]):
  kind==='quote'?{c:['120'],o:'100'}:kind==='book'?{bids:[['100','2',NOW/1000]],asks:[['101','3',NOW/1000]]}:[['102','0.5',NOW/1000,'b','m','']];
 const bad=kind==='candles'?[[1,null,null,null,null,'0','0',0]]:kind==='quote'?{c:['invalid'],o:'0'}:kind==='book'?{bids:[],asks:[]}:[['bad','bad','bad','bad']];
 return {error:[],result:{[pair]:invalid?bad:row,last:NOW/1000}};
}
function coinbase(url){
 const path=new URL(url).pathname;
 if(path.endsWith('/candles'))return candles.map(b=>[b.t,b.l,b.h,b.o,b.c,b.v]);
 if(path.endsWith('/ticker'))return {trade_id:1,price:'120',size:'0.5',time:new Date(NOW).toISOString(),bid:'119',ask:'121',volume:'10'};
 if(path.endsWith('/stats'))return {open:'100',high:'125',low:'90',last:'120',volume:'10'};
 if(path.endsWith('/book'))return {sequence:1,time:new Date(NOW).toISOString(),bids:[['100','2',1]],asks:[['101','3',1]]};
 if(path.endsWith('/trades'))return [{trade_id:1,price:'102',size:'0.5',time:new Date(NOW).toISOString(),side:'sell'}];
 throw Error('Unexpected Coinbase endpoint in protocol fixture: '+path);
}
function yahoo({symbol='AMZN',currency='USD'}={}){
 return {chart:{result:[{meta:{symbol,currency,regularMarketTime:NOW/1000,regularMarketPrice:104},timestamp:candles.map(b=>b.t),indicators:{quote:[{open:candles.map(b=>b.o),high:candles.map(b=>b.h),low:candles.map(b=>b.l),close:candles.map(b=>b.c),volume:candles.map(b=>b.v)}]}}],error:null}};
}
function twelve({symbol='AMZN',exchange='NASDAQ',interval='1h'}={}){
 return {status:'ok',meta:{symbol,exchange,interval,currency:'USD',exchange_timezone:'America/New_York'},values:candles.map(b=>({datetime:new Date(b.t*1000).toISOString().slice(0,19).replace('T',' '),open:String(b.o),high:String(b.h),low:String(b.l),close:String(b.c),volume:String(b.v)}))};
}
function invoke(api,kind,fetcher,options={},selected=market){return kind==='candles'?api.request(selected,'60',{fetcher,...options}):api[kind](selected,{fetcher,...options});}
let passed=0;const failures=[];
async function test(name,fn){try{await fn();passed++;console.log('PASS',name);}catch(error){failures.push({name,error});console.error('FAIL',name+'\n  '+error.message);}}

for(const kind of ['candles','quote','book','trades']){
 await test(kind+': primary network failure reaches a genuine secondary provider with unchanged instrument/currency',async()=>{
  const {api}=router();api.configure({...api.defaults,providers:['kraken','coinbase'],maxSources:2});const calls=[];
  const result=await invoke(api,kind,async url=>{calls.push(url);if(new URL(url).hostname==='api.kraken.com')throw new TypeError('Controlled primary outage');return response(coinbase(url));});
  assert.equal(result.provider,'coinbase');assert.equal(result.venue,'Coinbase Exchange');assert.equal(result.currency,'USD');assert.equal(result.requestedSymbol,market.symbol);assert.equal(result.fallbackUsed,true);assert.equal(result.attempts.length,2);
  assert.equal(new URL(calls[0]).hostname,'api.kraken.com');assert.ok(calls.slice(1).every(url=>new URL(url).hostname==='api.exchange.coinbase.com'&&new URL(url).pathname.includes('/BTC-USD/')));
  if(kind==='candles')assert.equal(result.bars.length,3);
  if(kind==='quote'){assert.equal(result.last,120);assert.equal(result.change,20);assert.equal(result.changeBasis,'rolling 24h');}
  if(kind==='book'){assert.equal(result.bids[0][0],100);assert.equal(result.asks[0][0],101);}
  if(kind==='trades'){assert.equal(result.items.length,1);assert.equal(result.items[0].side,'b');}
 });
 await test(kind+': unusable HTTP 200 primary payload cannot suppress a usable fallback',async()=>{
  const {api}=router();api.configure({...api.defaults,providers:['kraken','coinbase'],maxSources:2});
  const result=await invoke(api,kind,async url=>response(new URL(url).hostname==='api.kraken.com'?kraken(kind,{invalid:true}):coinbase(url)));
  assert.equal(result.provider,'coinbase');assert.equal(result.attempts[0].status,'failed');assert.equal(result.attempts[1].status,'ok');
 });
}
await test('Maximum source count bounds actual failed candidates without inventing more coverage',async()=>{
 const {api}=router();api.configure({...api.defaults,providers:['kraken','coinbase','bitstamp'],maxSources:1});let calls=0;
 assert.equal(api.coverage(market,'60').candles.length,3);
 await assert.rejects(invoke(api,'candles',async()=>{calls++;throw new TypeError('Controlled outage');}),error=>{assert.equal(error.attempts.length,1);return /1\/1 source attempts/.test(error.message);});
 assert.equal(calls,1);
});
await test('A disabled requested venue is never called and the first compatible enabled provider succeeds',async()=>{
 const {api}=router();api.configure({...api.defaults,providers:['coinbase'],maxSources:3});const calls=[];
 const result=await invoke(api,'book',async url=>{calls.push(url);return response(coinbase(url));});
 assert.equal(result.provider,'coinbase');assert.ok(calls.every(url=>new URL(url).hostname==='api.exchange.coinbase.com'));assert.equal(result.attempts.length,1);
});
await test('Already-aborted parent signal starts no requests and creates no health failures',async()=>{
 const {api}=router(),controller=new AbortController();controller.abort();let calls=0;
 await assert.rejects(invoke(api,'candles',async()=>{calls++;return response(kraken('candles'));},{signal:controller.signal}),error=>error.name==='AbortError');
 assert.equal(calls,0);assert.equal(api.health().length,0);
});
await test('An unsupported market leaves no parent abort listener attached after rejection',async()=>{
 const {api}=router(),controller=new AbortController();let listeners=0;const signal=controller.signal,add=signal.addEventListener.bind(signal),remove=signal.removeEventListener.bind(signal);
 signal.addEventListener=(...args)=>{listeners++;return add(...args);};signal.removeEventListener=(...args)=>{listeners--;return remove(...args);};
 await assert.rejects(api.request({symbol:'UNSUPPORTED:ASSET'},'D',{signal,fetcher:async()=>{throw Error('Must not fetch');}}),/No data adapter/);assert.equal(listeners,0);
});
await test('Parent cancellation interrupts an uncooperative fetch without fallback or health penalty',async()=>{
 const {api}=router();api.configure({...api.defaults,providers:['kraken','coinbase']});const controller=new AbortController();let begin;const started=new Promise(resolve=>begin=resolve);let calls=0;
 const pending=invoke(api,'candles',()=>{calls++;begin();return new Promise(()=>{});},{signal:controller.signal});
 await started;controller.abort();await assert.rejects(pending,error=>error.name==='AbortError');
 assert.equal(calls,1);assert.equal(api.health().length,0);
});
await test('Applying valid configuration cancels old work without late success or health resurrection',async()=>{
 const {api}=router();api.configure({...api.defaults,providers:['kraken','coinbase']});let begin,finish;const started=new Promise(resolve=>begin=resolve);let calls=0;
 const pending=invoke(api,'candles',()=>{calls++;begin();return new Promise(resolve=>finish=resolve);});
 await started;api.configure({...api.defaults,providers:['coinbase']});await assert.rejects(pending,error=>error.name==='AbortError');
 finish(response(kraken('candles')));await new Promise(resolve=>setImmediate(resolve));assert.equal(calls,1);assert.equal(api.health().length,0);assert.deepEqual(plain(api.config().providers),['coinbase']);
});
await test('Invalid configuration cannot cancel a valid in-flight request',async()=>{
 const {api}=router();api.configure({...api.defaults,providers:['kraken']});let begin,finish;const started=new Promise(resolve=>begin=resolve);
 const pending=invoke(api,'candles',()=>{begin();return new Promise(resolve=>finish=resolve);});
 await started;assert.throws(()=>api.configure({...api.defaults,maxSources:0}),/maxSources/);finish(response(kraken('candles')));
 const result=await pending;assert.equal(result.provider,'kraken');assert.equal(api.health().length,1);
});
await test('Real per-source timeout advances even when the fetch ignores its abort signal',async()=>{
 const {api}=router({liveClock:true});api.configure({...api.defaults,providers:['kraken','coinbase'],timeoutMs:500,deadlineMs:2000,maxSources:2});let originalSignal;const calls=[],start=performance.now();
 const result=await invoke(api,'candles',async(url,options)=>{calls.push(url);if(new URL(url).hostname==='api.kraken.com'){originalSignal=options.signal;return new Promise(()=>{});}return response(coinbase(url));});
 const elapsed=performance.now()-start;assert.equal(result.provider,'coinbase');assert.equal(originalSignal.aborted,true);assert.equal(calls.length,2);assert.ok(elapsed>=400&&elapsed<5000,'bounded real timeout, observed '+elapsed+'ms');
});
await test('Total deadline bounds a chain of hanging sources independently of N',async()=>{
 const {api}=router({liveClock:true});api.configure({...api.defaults,providers:['kraken','coinbase','bitstamp'],timeoutMs:1000,deadlineMs:1000,maxSources:3});let calls=0;const start=performance.now();
 await assert.rejects(invoke(api,'book',async()=>{calls++;return new Promise(()=>{});}),/Market data unavailable/);
 assert.equal(calls,1);assert.ok(performance.now()-start<5000);
});
for(const retryFormat of ['seconds','http-date'])await test('429 Retry-After '+retryFormat+' cools the provider across capabilities and permits later recovery',async()=>{
 const {api,advance,now}=router();api.configure({...api.defaults,providers:['kraken','coinbase'],maxSources:2});let healthy=false;const calls=[];
 const retry=retryFormat==='seconds'?'120':new Date(now()+120000).toUTCString();
 const fetcher=async url=>{calls.push(url);return new URL(url).hostname==='api.kraken.com'?healthy?response(kraken('quote')):response({error:['EAPI:Rate limit exceeded']},{status:429,headers:{'Retry-After':retry}}):response(coinbase(url));};
 const first=await invoke(api,'quote',fetcher);assert.equal(first.provider,'coinbase');
 assert.equal(api.health().find(item=>item.id==='kraken').cooldownUntil,now()+120000);
 const before=calls.length;await invoke(api,'book',fetcher);assert.ok(calls.slice(before).every(url=>new URL(url).hostname==='api.exchange.coinbase.com'));
 advance(120001);healthy=true;const recovered=await invoke(api,'quote',fetcher);assert.equal(recovered.provider,'kraken');assert.equal(api.health().find(item=>item.id==='kraken').lastError,'');
});
await test('Wrong crypto base/quote in a successful response is rejected before another source can succeed',async()=>{
 const {api}=router();api.configure({...api.defaults,providers:['kraken','coinbase'],maxSources:2});
 const result=await invoke(api,'candles',async url=>response(new URL(url).hostname==='api.kraken.com'?kraken('candles',{pair:'XETHZUSD'}):coinbase(url)));
 assert.equal(result.provider,'coinbase');assert.match(result.attempts[0].error,/different crypto market/);assert.equal(result.currency,'USD');
});
await test('HTTP 200 Kraken rate-limit errors cool all capabilities instead of hammering the same venue',async()=>{
 const {api}=router();api.configure({...api.defaults,providers:['kraken','coinbase']});let primaryCalls=0;
 const fetcher=async url=>{if(url.includes('api.kraken.com')){primaryCalls++;return response({error:['EAPI:Rate limit exceeded']});}return response(coinbase(url));};
 await invoke(api,'quote',fetcher);const before=primaryCalls;await invoke(api,'book',fetcher);assert.equal(primaryCalls,before);
});
await test('Configured pair/currency mismatch fails before requesting any venue',async()=>{
 const {api}=router();let calls=0;
 await assert.rejects(invoke(api,'candles',async()=>{calls++;return response(kraken('candles'));},{},{symbol:'KRAKEN:BTCUSD',pair:'BTCUSDT'}),/does not match/);
 assert.equal(calls,0);
});
await test('USD crypto coverage excludes a USDT-only Binance substitution',()=>{
 const {api}=router();api.configure({...api.defaults,providers:['binance']});
 for(const list of Object.values(api.coverage(market,'60')))assert.equal(list.length,0);
});
await test('Wrong stock metadata cannot render another instrument under the selected ticker',async()=>{
 const {api}=router();api.configure({...api.defaults,providers:['yahoo'],stockTransports:['corsdev'],maxSources:2});const calls=[];
 const result=await api.request(stock,'60',{fetcher:async url=>{calls.push(url);return response(yahoo({symbol:calls.length===1?'MSFT':'AMZN'}));}});
 assert.equal(result.sourceSymbol,'AMZN');assert.equal(result.attempts.length,2);assert.match(result.attempts[0].error,/different instrument/);
});
await test('Stock relay/mirror paths remain one provider and optional independent stock access requires a key',()=>{
 const {api}=router();api.configure({...api.defaults,providers:['yahoo','twelve']});let paths=api.coverage(stock,'60').candles;
 assert.equal(paths.length,6);assert.deepEqual([...new Set(paths.map(item=>item.provider))],['yahoo']);
 api.configure({...api.defaults,providers:['yahoo','twelve'],twelveKey:'fixture_key'});paths=api.coverage(stock,'60').candles;
 assert.ok(paths.some(item=>item.provider==='twelve'));assert.equal(new Set(paths.map(item=>item.provider)).size,2);
});
await test('Independent Twelve fallback is tried before exhausting every Yahoo relay path',async()=>{
 const {api}=router();api.configure({...api.defaults,providers:['yahoo','twelve'],maxSources:2,twelveKey:'fixture_key'});const calls=[];
 const result=await api.request(stock,'60',{fetcher:async url=>{calls.push(url);return new URL(url).hostname==='api.twelvedata.com'?response(twelve()):response({chart:{result:null,error:{description:'Controlled upstream failure'}}});}});
 assert.equal(result.provider,'twelve');assert.equal(calls.length,2);assert.equal(result.attempts.length,2);assert.equal(new URL(calls[1]).hostname,'api.twelvedata.com');
});
await test('Twelve candle fallback preserves the limit that candles alone supply no timestamped current quote',async()=>{
 const {api}=router();api.configure({...api.defaults,providers:['twelve'],twelveKey:'fixture_key'});
 const result=await api.request(stock,'60',{fetcher:async()=>response(twelve())});assert.equal(result.marketType,'stock');assert.equal(result.currency,'USD');assert.equal(result.quoteTime,null);assert.match(result.historyNote,/not a timestamped current quote/);assert.equal(result.bars.length,3);
});
await test('A Twelve quote timestamp is retained only when its instrument, exchange and currency match the candles',async()=>{
 const {api}=router();api.configure({...api.defaults,providers:['twelve'],twelveKey:'fixture-key'});
 const fetcher=async url=>response(url.includes('/quote?')?{symbol:'AMZN',exchange:'NASDAQ',currency:'USD',timestamp:NOW/1000,close:'125'}:twelve());
 const result=await api.request(stock,'60',{requireQuote:true,fetcher});assert.equal(result.quoteTime,NOW/1000);assert.equal(result.quote,125);
 await assert.rejects(api.request(stock,'60',{requireQuote:true,fetcher:async url=>response(url.includes('/quote?')?{symbol:'MSFT',exchange:'NASDAQ',currency:'USD',timestamp:NOW/1000,close:'999'}:twelve())}),/lacks the timestamped quote/);
});
await test('Twelve rejects the wrong exchange and HTTP 200 provider errors instead of treating them as market data',async()=>{
 for(const payload of [twelve({exchange:'NYSE'}),{status:'error',code:429,message:'Request quota exceeded'}]){
  const {api}=router();api.configure({...api.defaults,providers:['twelve'],twelveKey:'fixture_key'});
  await assert.rejects(api.request(stock,'60',{fetcher:async()=>response(payload)}),/different stock exchange|Request quota exceeded/);
 }
});
await test('Hourly alarm requests skip candle-only results and continue to a source with a real quote timestamp',async()=>{
 const {api}=router();api.configure({...api.defaults,providers:['yahoo','twelve'],stockTransports:['corsdev'],twelveKey:'fixture-key',maxSources:3});const calls=[];
 const result=await api.request(stock,'60',{requireQuote:true,fetcher:async url=>{calls.push(url);if(url.includes('query1'))return response({},{status:503});if(url.includes('/quote?'))return response({status:'error',code:403,message:'No quote access'},{status:403});if(url.includes('twelvedata'))return response(twelve());return response(yahoo());}});
 assert.equal(result.provider,'yahoo');assert.match(result.sourceId,/query2/);assert.equal(result.quoteTime,NOW/1000);assert.equal(calls.length,4);
});
await test('A relay-wide rate limit cools its other mirrors while a separate relay remains eligible',async()=>{
 const {api}=router();api.configure({...api.defaults,providers:['yahoo'],stockTransports:['corsdev','allorigins']});const calls=[];
 const result=await api.request(stock,'60',{fetcher:async url=>{calls.push(url);return url.includes('proxy.cors.dev')?response({},{status:429,headers:{'Retry-After':'120','X-Cors-Error':'rate_limited'}}):response(yahoo());}});
 assert.equal(calls.length,2);assert.equal(result.transport,'allorigins');
});
await test('Existing BNB-quoted custom markets retain support and unsupported USD-suffixed stablecoins fail clearly',()=>{
 const {api}=router();assert.ok(api.coverage({symbol:'BINANCE:SOLBNB'},'60').candles.some(x=>x.provider==='binance'));
 assert.throws(()=>api.coverage({symbol:'BINANCE:BTCFDUSD'},'60'),/not supported.*USD/);
});
await test('Explicit relay owner opt-out stops Yahoo mirrors and other relays for this request',async()=>{
 const {api}=router();api.configure({...api.defaults,providers:['yahoo'],maxSources:6});let calls=0;
 await assert.rejects(api.request(stock,'60',{fetcher:async()=>{calls++;return response({}, {status:403,headers:{'X-Cors-Error':'owner_opted_out'}});}}),/owner_opted_out/);
 assert.equal(calls,1);
});
await test('Explicit relay owner opt-out stays blocked across polling requests during its cooldown',async()=>{
 const {api}=router();api.configure({...api.defaults,providers:['yahoo'],maxSources:6});let calls=0;
 const fetcher=async()=>{calls++;return response({}, {status:403,headers:{'X-Cors-Error':'owner_opted_out'}});};
 await assert.rejects(api.request(stock,'60',{fetcher}),/owner_opted_out/);const before=calls;
 await assert.rejects(api.request(stock,'60',{fetcher}),/Market data unavailable/);assert.equal(calls,before,'Do not evade an upstream owner opt-out by trying another mirror/relay on the next tick.');
});
await test('Empty compatible lists report the actual coverage gap without attempting unrelated markets',async()=>{
 const {api}=router();api.configure({...api.defaults,providers:[]});let calls=0;
 for(const kind of ['candles','quote','book','trades'])await assert.rejects(invoke(api,kind,async()=>{calls++;return response({});}),/No enabled compatible source/);
 assert.equal(calls,0);assert.equal(api.health().length,0);
});
await test('A terminal HTTP error retains its status for callers while diagnostics redact optional credentials',async()=>{
 const {api}=router(),key='fixture_secret_key';api.configure({...api.defaults,providers:['twelve'],twelveKey:key,maxSources:1});let caught;
 try{await api.request(stock,'60',{fetcher:async()=>response({status:'error',code:429,message:'Quota error '+key},{status:429,headers:{'Retry-After':'90'}})});}catch(error){caught=error;}
 assert.ok(caught);assert.equal(caught.status,429);assert.ok(!caught.message.includes(key));assert.match(caught.message,/redacted/);assert.ok(!JSON.stringify(api.health()).includes(key));assert.ok(!JSON.stringify(caught.attempts).includes(key));
});

console.log(`${passed} feed-fallback checks passed; ${failures.length} failed. Mocks do not establish live CORS/provider availability.`);
if(failures.length)process.exitCode=1;
