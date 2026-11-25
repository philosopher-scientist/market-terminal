import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const context=vm.createContext({URLSearchParams,Date,Map,Set});
vm.runInContext(fs.readFileSync(new URL('../src/crypto-feeds.js',import.meta.url),'utf8')+';globalThis.api=CryptoFeeds;',context);
const api=context.api;
const plain=value=>JSON.parse(JSON.stringify(value));
let passed=0;
async function test(name,fn){await fn();passed++;console.log('PASS',name);}
const day=Date.parse('2024-01-01T00:00:00Z')/1000;
const btc={base:'BTC',quote:'USD',krakenPair:'XBTUSD',requestedVenue:'kraken'};
const cb=(time,open=10,close=11)=>[time,open-1,close+1,open,close,2];

await test('Coinbase candle request uses the same asset/currency and parses its actual OHLC order',async()=>{
 const urls=[];
 const result=await api.request('coinbase','candles',btc,'D',{json:async url=>{urls.push(url);return [cb(day+86400,12,13),cb(day)];}});
 assert.match(urls[0],/products\/BTC-USD\/candles\?granularity=86400$/);
 assert.deepEqual(plain(result.bars),[{t:day,o:10,h:12,l:9,c:11,v:2},{t:day+86400,o:12,h:14,l:11,c:13,v:2}]);
 assert.equal(result.provider,'coinbase');assert.equal(result.venue,'Coinbase Exchange');assert.equal(result.currency,'USD');
});
await test('Crypto identities normalize Kraken aliases and preserve exact USD/USDT/USDC quotes',()=>{
 for(const [pair,base,quote]of[['XBTUSD','BTC','USD'],['XETHZUSD','ETH','USD'],['BNBUSD','BNB','USD'],['SOLUSDT','SOL','USDT'],['BTCUSDC','BTC','USDC']]){
  const m=api.market({type:'kraken',pair});assert.equal(m.base,base);assert.equal(m.quote,quote);
 }
 assert.equal(api.market({type:'binance',pair:'BTCUSDT'}).requestedVenue,'binance');
 assert.equal(api.supports('binance',btc,'candles','D'),false);
 assert.equal(api.supports('coinbase',{...btc,quote:'USDT'},'candles','240'),true);
 assert.equal(api.supports('not-a-provider',btc,'book'),false);
 assert.throws(()=>api.market({type:'kraken',pair:'BTCUNKNOWN'}),/quote|pair/i);
 assert.throws(()=>api.market({type:'kraken',pair:'XBTUSD'},{pair:'ETHUSD'}),/match.*market/i);
});
await test('All starter USD markets work through each independent compatible candle adapter',async()=>{
 for(const base of['BTC','ETH','BNB']){
  const m=api.market({type:'kraken',pair:(base==='BTC'?'XBT':base)+'USD'});
  for(const provider of['kraken','coinbase','bitstamp','binance-us']){
   const json=async url=>{
    assert.ok(url.includes(base==='BTC'&&provider==='kraken'?'XBTUSD':provider==='coinbase'?base+'-USD':provider==='bitstamp'?base.toLowerCase()+'usd':base+'USD'));
    if(provider==='kraken')return {error:[],result:{[m.krakenPair]:[[day,'10','12','9','11','10','2',1],[day+86400,'12','14','11','13','12','2',1]],last:day}};
    if(provider==='coinbase')return [cb(day),cb(day+86400,12,13)];
    if(provider==='bitstamp')return {data:{pair:base+'/USD',ohlc:[{timestamp:day,open:'10',high:'12',low:'9',close:'11',volume:'2'},{timestamp:day+86400,open:'12',high:'14',low:'11',close:'13',volume:'2'}]}};
    return [[day*1000,'10','12','9','11','2'],[(day+86400)*1000,'12','14','11','13','2']];
   };
   const result=await api.request(provider,'candles',m,'D',{json});assert.equal(result.bars.length,2);assert.equal(result.currency,'USD');
  }
 }
});
await test('Coinbase 30-minute/4-hour bars aggregate real sub-bars without filling missing bins',async()=>{
 for(const [interval,step,count]of[['30',900,2],['240',3600,4]]){
  const rows=Array.from({length:count*2},(_,i)=>cb(day+i*step,10+i,11+i));
  const result=await api.request('coinbase','candles',btc,interval,{json:async()=>rows,now:()=>Date.parse('2024-01-04T00:00:00Z')});
  assert.equal(result.bars.length,2);assert.equal(result.bars[0].o,10);assert.equal(result.bars[0].c,10+count);assert.equal(result.bars[0].v,2*count);
  assert.match(result.historyNote,/aggregat/i);
 }
 const rows=[...Array.from({length:4},(_,i)=>cb(day+i*900)),...Array.from({length:4},(_,i)=>cb(day+7200+i*900))];
 const result=await api.request('coinbase','candles',btc,'30',{json:async()=>rows});
 assert.deepEqual(plain(result.bars.map(b=>b.t)),[day,day+1800,day+7200,day+9000]);
});
await test('Weekly fallbacks use Monday UTC bins and expose shorter history',async()=>{
 const rows=Array.from({length:14},(_,i)=>cb(day+i*86400,10+i,11+i));
 const cbResult=await api.request('coinbase','candles',btc,'W',{json:async()=>rows});
 assert.deepEqual(plain(cbResult.bars.map(b=>b.t)),[day,day+604800]);assert.equal(cbResult.bars[0].v,14);assert.match(cbResult.historyNote,/300/);
 let requested='';const bsResult=await api.request('bitstamp','candles',btc,'W',{json:async url=>{requested=url;return {data:{pair:'BTC/USD',ohlc:rows.map(r=>({timestamp:r[0],open:r[3],high:r[2],low:r[1],close:r[4],volume:r[5]}))}};}});
 assert.match(requested,/step=86400/);assert.deepEqual(plain(bsResult.bars.map(b=>b.t)),[day,day+604800]);
});
await test('Aggregation preserves the still-forming current bucket and rejects a missing internal source interval',async()=>{
 const rows=[cb(day),cb(day+900),cb(day+1800)];
 const current=await api.request('coinbase','candles',btc,'30',{json:async()=>rows,now:()=>1000*(day+2400)});
 assert.equal(current.bars.length,2);assert.equal(current.bars[1].t,day+1800);assert.equal(current.bars[1].v,2);
 const full=Array.from({length:12},(_,i)=>cb(day+i*900));
 const missing=full.filter(row=>row[0]!==day+1800);
 const result=await api.request('coinbase','candles',btc,'30',{json:async()=>missing});
 assert.deepEqual(plain(result.bars.map(b=>b.t)),[day,day+3600,day+5400,day+7200,day+9000]);
});
await test('Invalid, impossible, duplicate and mismatched candle payloads cannot become usable history',async()=>{
 await assert.rejects(api.request('coinbase','candles',btc,'D',{json:async()=>[cb(day)]}),/two|history|candles/i);
 await assert.rejects(api.request('bitstamp','candles',btc,'D',{json:async()=>({data:{pair:'ETH/USD',ohlc:[]}})}),/pair|market|symbol/i);
 await assert.rejects(api.request('binance-us','quote',btc,'D',{json:async()=>({symbol:'BTCUSDT',lastPrice:'10',priceChangePercent:'1',closeTime:day*1000})}),/pair|market|symbol/i);
 const result=await api.request('coinbase','candles',btc,'D',{json:async()=>[cb(day),cb(day),[day+1,null,12,10,11,2],cb(day+86400),[day+2,20,1,10,11,2]]});
 assert.equal(result.bars.length,2);
});
await test('Quotes expose source time and comparable change basis rather than inventing freshness',async()=>{
 const k=await api.request('kraken','quote',btc,'D',{json:async()=>({error:[],result:{XXBTZUSD:{c:['110','1'],o:'100'}}})});
 assert.equal(k.change,10);assert.match(k.changeBasis,/UTC/);assert.equal(k.observedAt,null);
 const c=await api.request('coinbase','quote',btc,'D',{json:async url=>url.endsWith('/stats')?{open:'100',last:'111'}:{price:'110',time:'2024-01-01T01:00:00Z'}});
 assert.equal(c.last,110);assert.equal(c.change,10);assert.match(c.changeBasis,/24h/);assert.equal(c.observedAt,(day+3600)*1000);
 const b=await api.request('bitstamp','quote',btc,'D',{json:async()=>({last:'110',open_24:'100',timestamp:String(day)})});
 assert.equal(b.change,10);assert.match(b.changeBasis,/24h/);assert.equal(b.observedAt,day*1000);
});
await test('Books sort numeric prices, reject crossed/empty snapshots, and keep source timestamps',async()=>{
 const b=await api.request('coinbase','book',btc,'D',{json:async()=>({bids:[['9','2',3],['10','1',1]],asks:[['12','3',2],['11','2',1]],time:'2024-01-01T00:00:00Z'})});
 assert.deepEqual(plain(b.bids),[[10,1],[9,2]]);assert.deepEqual(plain(b.asks),[[11,2],[12,3]]);assert.equal(b.observedAt,day*1000);
 await assert.rejects(api.request('bitstamp','book',btc,'D',{json:async()=>({bids:[['12','2']],asks:[['11','2']]})}),/cross|book/i);
 await assert.rejects(api.request('kraken','book',btc,'D',{json:async()=>({error:[],result:{XXBTZUSD:{bids:[],asks:[]}}})}),/book|depth/i);
});
await test('Coinbase maker sides are inverted, Binance buyer-maker flags preserved as aggressor direction',async()=>{
 const c=await api.request('coinbase','trades',btc,'D',{json:async()=>[{price:'11',size:'2',time:'2024-01-01T00:00:00Z',side:'sell'},{price:'12',size:'1',time:'2024-01-01T00:00:01Z',side:'buy'}]});
 assert.deepEqual(plain(c.items.map(t=>t.side)),['s','b']);assert.equal(c.items[0].time,day+1);
 const b=await api.request('binance-us','trades',btc,'D',{json:async()=>[{price:'11',qty:'2',time:day*1000,isBuyerMaker:true}]});
 assert.equal(b.items[0].side,'s');
 const empty=await api.request('bitstamp','trades',btc,'D',{json:async()=>[]});assert.deepEqual(plain(empty.items),[]);assert.equal(empty.observedAt,null);
});
await test('Request failures propagate to the outer fallback chain without returning another currency or fabricated data',async()=>{
 await assert.rejects(api.request('coinbase','book',btc,'D',{json:async()=>{throw Error('HTTP 429');}}),/429/);
 let calls=0;await assert.rejects(api.request('binance','candles',btc,'D',{json:async()=>{calls++;return [];}}),/support|currency|quote/i);assert.equal(calls,0);
 await assert.rejects(api.request('kraken','candles',btc,'D',{json:async()=>({error:['EQuery:Unknown asset pair'],result:{}})}),/Unknown asset pair/);
});
console.log(passed+' crypto-adapter checks passed. Live HTTP/CORS probes and browser acceptance are separate evidence.');
