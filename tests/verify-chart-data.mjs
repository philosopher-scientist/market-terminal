import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const context=vm.createContext({URLSearchParams,Date,Map,Set});
vm.runInContext(fs.readFileSync(new URL('../src/chart-data.js',import.meta.url),'utf8')+';globalThis.api=MarketData;',context);
const api=context.api;let passed=0;
async function test(name,fn){await fn();passed++;console.log('PASS',name);}
const payload=(overrides={})=>({chart:{result:[{meta:{currency:'USD',symbol:'INTC',regularMarketTime:1200},timestamp:[100,200,300],indicators:{quote:[{open:[10,11,12],high:[12,13,14],low:[9,10,11],close:[11,12,13],volume:[10,20,30]}]},...overrides}],error:null}});
await test('Stock symbols map explicitly and unknown exchanges fail rather than silently changing source',()=>{
 assert.equal(api.routeSymbol('NYSE:BRK.B').ticker,'BRK-B');assert.equal(api.routeSymbol('LSE:VOD').ticker,'VOD.L');
 assert.equal(api.routeSymbol('BINANCE:SOLUSDT').pair,'SOLUSDT');assert.throws(()=>api.routeSymbol('UNKNOWN:ABC'),/No data adapter/);
});
await test('Missing source delay remains unknown while an explicit delay is preserved',()=>{
 assert.equal(api.parseYahoo(payload(),{ticker:'INTC'},'D').delayMinutes,null);
 assert.equal(api.parseYahoo(payload({meta:{symbol:'INTC',exchangeDataDelayedBy:15}}),{ticker:'INTC'},'D').delayMinutes,15);
});
await test('Null prices and impossible candles are excluded; history must contain real usable bars',()=>{
 assert.equal(api.cleanBars([{t:1,o:null,h:2,l:1,c:1},{t:2,o:3,h:2,l:1,c:1},{t:3,o:2,h:3,l:1,c:2,v:5}]).length,1);
 assert.throws(()=>api.parseYahoo(payload({timestamp:[]}),{ticker:'INTC'},'D'),/fewer than two/);
});
await test('An off-grid intraday price snapshot updates the current bar without adding a fake candle',()=>{
 const raw=payload({meta:{symbol:'INTC',regularMarketTime:230},timestamp:[100,200,230],indicators:{quote:[{open:[10,11,14],high:[12,13,14],low:[9,10,14],close:[11,12,14],volume:[10,20,0]}]}});
 const result=api.parseYahoo(raw,{ticker:'INTC'},'1');assert.equal(result.bars.length,2);assert.equal(result.bars[1].t,200);assert.equal(result.bars[1].c,14);assert.equal(result.bars[1].h,14);assert.equal(result.bars[1].v,20);
});
await test('General Fusion predecessor bars are excluded rather than presented as company history',()=>{
 const start=Date.parse('2026-07-13T00:00:00Z')/1000;
 const result=api.parseYahoo(payload({timestamp:[start-86400,start,start+86400]}),{ticker:'GFUZ'},'D');assert.equal(result.bars.length,2);assert.equal(result.bars[0].t,start);
});
await test('SpaceX retains the real IPO week even though its weekly bar is dated before IPO day',()=>{
 const first=Date.parse('2026-06-08T04:00:00Z')/1000;
 const result=api.parseYahoo(payload({timestamp:[first,first+604800,first+1209600]}),{ticker:'SPCX'},'W');assert.equal(result.bars.length,3);assert.equal(result.bars[0].t,first);
});
await test('Kraken parses the pair data rather than the pagination cursor',()=>{
 const result=api.parseKraken({error:[],result:{last:100,XXBTZUSD:[[1,'10','12','9','11','10','3',2],[2,'11','13','10','12','11','5',4]]}},{pair:'XBTUSD'},'D');assert.equal(result.bars[1].v,5);assert.equal(result.currency,'USD');
});
await test('Binance preserves its actual quote currency and timestamp units',()=>{
 const result=api.parseBinance([[1000,'10','12','9','11','3'],[2000,'11','13','10','12','5']],{pair:'SOLUSDT'},'60');assert.equal(result.bars[1].t,2);assert.equal(result.currency,'USDT');
});
await test('Rate limited Yahoo requests try the second mirror with the requested interval intact',async()=>{
 const calls=[];const result=await api.request({symbol:'NASDAQ:INTC'},'240',{fetcher:async url=>{calls.push(url);return calls.length===1?{ok:false,status:429,json:async()=>({})}:{ok:true,json:async()=>payload()};}});
 assert.equal(calls.length,2);assert.match(calls[1],/query2/);assert.match(calls[1],/interval=4h/);assert.equal(result.bars.length,3);
});
await test('A missing stock symbol fails clearly without trying another instrument',async()=>{
 const calls=[];await assert.rejects(api.request({symbol:'NASDAQ:NOTREAL'},'D',{fetcher:async url=>{calls.push(url);return {ok:false,status:404,json:async()=>({chart:{error:{description:'No data found'}}})};}}),/No data found/);assert.equal(calls.length,1);
});
await test('Plain-text rate limits report HTTP status instead of a JSON parser failure',async()=>{
 await assert.rejects(api.request({symbol:'NASDAQ:AMZN'},'60',{fetcher:async()=>({ok:false,status:429,json:async()=>{throw SyntaxError('Unexpected token T');}})}),error=>error.message==='Market data HTTP 429'&&error.status===429);
});
console.log(passed+' chart-data checks passed. Live browser integration is verified separately.');
