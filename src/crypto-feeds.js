// Embedded into the portable application; no required runtime library or server.
const CryptoFeeds = (()=>{
 'use strict';
 const quotes=['USDT','USDC','USD','EUR','GBP','AUD','CAD','JPY','BTC','ETH','BNB','DAI'];
 const names={kraken:'Kraken',coinbase:'Coinbase Exchange',bitstamp:'Bitstamp',binance:'Binance','binance-us':'Binance.US'};
 const steps={'1':60,'5':300,'15':900,'30':1800,'60':3600,'240':14400,D:86400,W:604800};
 const binanceSteps={'1':'1m','5':'5m','15':'15m','30':'30m','60':'1h','240':'4h',D:'1d',W:'1w'};
 const legacyBases={XXBT:'BTC',XETH:'ETH',XXDG:'DOGE',XXRP:'XRP',XLTC:'LTC',XXLM:'XLM',XXMR:'XMR',XZEC:'ZEC',XETC:'ETC',XREP:'REP'};
 const legacyQuotes={ZUSD:'USD',ZEUR:'EUR',ZGBP:'GBP',ZAUD:'AUD',ZCAD:'CAD',ZJPY:'JPY',XXBT:'BTC',XETH:'ETH'};
 const alias=base=>base==='XBT'?'BTC':base==='XDG'?'DOGE':base;
 const numeric=value=>(typeof value==='number'||typeof value==='string'&&value.trim()!=='')&&Number.isFinite(Number(value));
 const n=value=>numeric(value)?Number(value):NaN;
 function identity(raw){
  const pair=String(raw||'').toUpperCase().replace(/[-/_]/g,'');
  if(['FDUSD','RLUSD','PYUSD'].some(quote=>pair.endsWith(quote)&&pair.length>quote.length))throw Error('This quote currency is not supported; it must not be treated as USD.');
  for(const [prefix,base]of Object.entries(legacyBases)){
   if(pair.startsWith(prefix)&&legacyQuotes[pair.slice(prefix.length)])return {base,quote:legacyQuotes[pair.slice(prefix.length)]};
  }
  for(const quote of quotes){if(pair.endsWith(quote)&&pair.length>quote.length){const base=alias(pair.slice(0,-quote.length));if(/^[A-Z0-9]{1,25}$/.test(base))return {base,quote};}}
  throw Error('Crypto pair needs a supported, explicit quote currency.');
 }
 function market(route,m={}){
  const routePair=route.pair||String(route.symbol||m.symbol||'').split(':')[1],raw=m.pair||routePair;
  const {base,quote}=identity(raw),krakenBase=base==='BTC'?'XBT':base==='DOGE'?'XDG':base,krakenQuote=quote==='BTC'?'XBT':quote;
  if(routePair){const expected=identity(routePair);if(expected.base!==base||expected.quote!==quote)throw Error('Configured crypto pair does not match the requested market.');}
  return {base,quote,krakenPair:route.type==='kraken'?String(raw).toUpperCase().replace(/[-/_]/g,''):krakenBase+krakenQuote,requestedVenue:route.type};
 }
 function supports(provider,m,kind,interval){
  if(!names[provider]||!m||!/^[A-Z0-9]{1,25}$/.test(m.base)||!quotes.includes(m.quote)||!['candles','quote','book','trades'].includes(kind)||kind==='candles'&&!steps[interval])return false;
  if(provider==='binance'&&m.quote==='USD')return false;
  if(['coinbase','bitstamp','binance-us'].includes(provider)&&['AUD','CAD','JPY'].includes(m.quote))return false;
  return true; // Candidate contract compatibility; the remote venue still determines pair listing/availability.
 }
 function provenance(provider,m){
  const sourceSymbol=provider==='kraken'?m.krakenPair:provider==='coinbase'?m.base+'-'+m.quote:provider==='bitstamp'?(m.base+m.quote).toLowerCase():m.base+m.quote;
  return {provider,venue:names[provider],currency:m.quote,sourceSymbol,delayMinutes:null};
 }
 function assertIdentity(raw,m){const found=identity(raw);if(found.base!==m.base||found.quote!==m.quote)throw Error('The source returned a different crypto market / quote currency.');}
 function clean(rows){
  const byTime=new Map();
  for(const row of rows){
   const b={t:n(row.t),o:n(row.o),h:n(row.h),l:n(row.l),c:n(row.c),v:n(row.v)};
   if(Object.values(b).every(Number.isFinite)&&b.t>0&&b.o>0&&b.l>0&&b.c>0&&b.h>=Math.max(b.o,b.c,b.l)&&b.l<=Math.min(b.o,b.c)&&b.v>=0)byTime.set(b.t,b);
  }
  return [...byTime.values()].sort((a,b)=>a.t-b.t);
 }
 function aggregate(bars,rawStep,targetStep,now){
  if(rawStep===targetStep)return bars;
  const offset=targetStep===604800?345600:0,bin=t=>Math.floor((t-offset)/targetStep)*targetStep+offset;
  const grouped=new Map();
  for(const b of bars){const t=bin(b.t);if(!grouped.has(t))grouped.set(t,[]);grouped.get(t).push(b);}
  const nowSeconds=(typeof now==='function'?now():now)/1000,current=bin(nowSeconds),out=[];
  for(const [t,group]of grouped){
   // Do not turn a missing source interval or truncated leading bucket into a complete candle.
   const last=t===current?Math.floor(nowSeconds/rawStep)*rawStep:t+targetStep-rawStep;
   if(group[0].t!==t||group[group.length-1].t!==last||group.length!==Math.floor((last-t)/rawStep)+1||group.some((b,i)=>i&&b.t!==group[i-1].t+rawStep))continue;
   out.push({t,o:group[0].o,h:Math.max(...group.map(b=>b.h)),l:Math.min(...group.map(b=>b.l)),c:group[group.length-1].c,v:group.reduce((sum,b)=>sum+b.v,0)});
  }
  return out;
 }
 function timeMs(value){const parsed=typeof value==='string'&&value.includes('T')?Date.parse(value):n(value);return Number.isFinite(parsed)&&parsed>0?parsed:null;}
 function krakenRow(payload,m){
  if(!Array.isArray(payload?.error)||payload.error.length)throw Error(payload?.error?.join('; ')||'Kraken returned an invalid response.');
  const found=Object.entries(payload.result||{}).find(([key])=>key!=='last');
  if(!found)throw Error('Kraken returned no data for this market.');assertIdentity(found[0],m);return found[1];
 }
 function normalizeQuote(last,open,changeBasis,observedAt,explicitChange){
  last=n(last);open=n(open);
  const change=Number.isFinite(open)&&open>0?(last-open)/open*100:n(explicitChange);
  if(!Number.isFinite(last)||last<=0||!Number.isFinite(change))throw Error('The source returned no usable crypto quote / change baseline.');
  return {last,change,changeBasis,observedAt};
 }
 function normalizeBook(payload,observedAt){
  const levels=rows=>(Array.isArray(rows)?rows:[]).map(row=>[n(row[0]),n(row[1])]).filter(row=>row.every(Number.isFinite)&&row[0]>0&&row[1]>0);
  const bids=levels(payload?.bids).sort((a,b)=>b[0]-a[0]).slice(0,25),asks=levels(payload?.asks).sort((a,b)=>a[0]-b[0]).slice(0,25);
  if(!bids.length||!asks.length||asks[0][0]<bids[0][0])throw Error('The source returned an empty, invalid or crossed order book.');
  if(payload.auction_mode===true)throw Error('The source order book is indicative during an auction.');
  return {bids,asks,observedAt};
 }
 function normalizeTrades(rows){
  if(!Array.isArray(rows))throw Error('The source returned an invalid trade list.');
  const items=rows.map(row=>({price:n(row.price),size:n(row.size),time:n(row.time),side:row.side})).filter(row=>row.price>0&&row.size>0&&row.time>0&&[row.price,row.size,row.time].every(Number.isFinite)&&['b','s'].includes(row.side)).sort((a,b)=>b.time-a.time).slice(0,50);
  if(rows.length&&!items.length)throw Error('The source returned no usable trade records.');
  return {items,observedAt:items.length?items[0].time*1000:null};
 }
 async function request(provider,kind,m,interval,{json,now=Date.now}={}){
  if(!supports(provider,m,kind,interval))throw Error('This provider does not support the crypto request / quote currency.');
  if(typeof json!=='function')throw Error('A bounded JSON request function is required.');
  const meta=provenance(provider,m),targetStep=steps[interval],symbol=meta.sourceSymbol;
  const url=(base,params)=>base+(params?'?'+new URLSearchParams(params):'');
  if(provider==='kraken'){
   const endpoint={candles:'OHLC',quote:'Ticker',book:'Depth',trades:'Trades'}[kind];
   const params={pair:symbol};if(kind==='candles')params.interval=String(targetStep/60);if(kind==='book')params.count='25';if(kind==='trades')params.count='50';
   const row=krakenRow(await json(url('https://api.kraken.com/0/public/'+endpoint,params)),m);
   if(kind==='quote')return {...meta,...normalizeQuote(row.c?.[0],row.o,'since 00:00 UTC',null)};
   if(kind==='book')return {...meta,...normalizeBook(row,null)};
   if(kind==='trades')return {...meta,...normalizeTrades(Array.isArray(row)?row.map(r=>({price:r[0],size:r[1],time:r[2],side:r[3]})):null)};
   if(!Array.isArray(row))throw Error('Kraken returned no candle history.');
   const bars=clean(row.map(r=>({t:r[0],o:r[1],h:r[2],l:r[3],c:r[4],v:r[6]})));
   if(bars.length<2)throw Error('Kraken returned fewer than two usable candles.');
   return {...meta,bars,interval,historyNote:'Kraken supplies about 720 recent candles; the latest candle may still be forming.'};
  }
  if(provider==='coinbase'){
   const base='https://api.exchange.coinbase.com/products/'+encodeURIComponent(symbol);
   if(kind==='quote'){
    const [ticker,stats]=await Promise.all([json(base+'/ticker'),json(base+'/stats')]);
    return {...meta,...normalizeQuote(ticker.price,stats.open,'rolling 24h',timeMs(ticker.time))};
   }
   if(kind==='book'){const data=await json(base+'/book?level=2');return {...meta,...normalizeBook(data,timeMs(data.time))};}
   if(kind==='trades'){
    const rows=await json(base+'/trades?limit=50');
    return {...meta,...normalizeTrades(Array.isArray(rows)?rows.map(r=>({price:r.price,size:r.size,time:(timeMs(r.time)||NaN)/1000,side:r.side==='sell'?'b':r.side==='buy'?'s':''})):null)};
   }
   const rawStep=interval==='30'?900:interval==='240'?3600:interval==='W'?86400:targetStep;
   const rows=await json(base+'/candles?granularity='+rawStep);if(!Array.isArray(rows))throw Error('Coinbase returned no candle history.');
   const native=clean(rows.map(r=>({t:r[0],o:r[3],h:r[2],l:r[1],c:r[4],v:r[5]}))).slice(-300),bars=aggregate(native,rawStep,targetStep,now);
   if(bars.length<2)throw Error('Coinbase returned fewer than two usable candles for this interval.');
   return {...meta,bars,interval,historyNote:'Up to 300 Coinbase source candles'+(rawStep!==targetStep?'; aggregated from '+(rawStep/60)+'-minute bars in UTC'+(interval==='W'?' Monday weeks':'')+'; gaps and truncated leading buckets are omitted; aggregated history is shorter':'')+'. The latest source candle may still be forming.'};
  }
  if(provider==='bitstamp'){
   const base='https://www.bitstamp.net/api/v2/';
   if(kind==='quote'){
    const data=await json(base+'ticker/'+symbol+'/');
    const has24=numeric(data.open_24)&&n(data.open_24)>0||numeric(data.percent_change_24);
    return {...meta,...normalizeQuote(data.last,has24?data.open_24:data.open,has24?'rolling 24h':'since 00:00 UTC',numeric(data.timestamp)?timeMs(n(data.timestamp)*1000):null,has24?data.percent_change_24:undefined)};
   }
   if(kind==='book'){const data=await json(base+'order_book/'+symbol+'/');return {...meta,...normalizeBook(data,numeric(data.microtimestamp)?timeMs(n(data.microtimestamp)/1000):numeric(data.timestamp)?timeMs(n(data.timestamp)*1000):null)};}
   if(kind==='trades'){
    const rows=await json(base+'transactions/'+symbol+'/?time=hour');
    return {...meta,...normalizeTrades(Array.isArray(rows)?rows.map(r=>({price:r.price,size:r.amount,time:r.date,side:String(r.type)==='0'?'b':String(r.type)==='1'?'s':''})):null)};
   }
   const rawStep=interval==='W'?86400:targetStep;
   const data=await json(base+'ohlc/'+symbol+'/?'+new URLSearchParams({step:String(rawStep),limit:'1000'}));
   if(data?.data?.pair)assertIdentity(data.data.pair,m);if(data?.data?.market)assertIdentity(data.data.market,m);
   const rows=data?.data?.ohlc;if(!Array.isArray(rows))throw Error('Bitstamp returned no candle history.');
   const native=clean(rows.map(r=>({t:r.timestamp,o:r.open,h:r.high,l:r.low,c:r.close,v:r.volume}))).slice(-1000),bars=aggregate(native,rawStep,targetStep,now);
   if(bars.length<2)throw Error('Bitstamp returned fewer than two usable candles for this interval.');
   return {...meta,bars,interval,historyNote:'Up to 1,000 Bitstamp source candles'+(interval==='W'?'; aggregated from daily bars into Monday UTC weeks; gaps/truncated leading buckets are omitted and history is shorter':'')+'. The latest source candle may still be forming.'};
  }
  const base=provider==='binance'?'https://data-api.binance.vision/api/v3/':'https://api.binance.us/api/v3/';
  const endpoint={candles:'klines',quote:'ticker/24hr',book:'depth',trades:'trades'}[kind];
  const params={symbol};if(kind==='candles'){params.interval=binanceSteps[interval];params.limit='1000';}if(kind==='book')params.limit='20';if(kind==='trades')params.limit='50';
  const data=await json(url(base+endpoint,params));if(data?.symbol)assertIdentity(data.symbol,m);
  if(kind==='quote')return {...meta,...normalizeQuote(data.lastPrice,null,'rolling 24h',numeric(data.closeTime)?timeMs(n(data.closeTime)):null,data.priceChangePercent)};
  if(kind==='book')return {...meta,...normalizeBook(data,null)};
  if(kind==='trades')return {...meta,...normalizeTrades(Array.isArray(data)?data.map(r=>({price:r.price,size:r.qty,time:n(r.time)/1000,side:r.isBuyerMaker===true?'s':r.isBuyerMaker===false?'b':''})):null)};
  if(!Array.isArray(data))throw Error(data?.msg||'The source returned no candle history.');
  const bars=clean(data.map(r=>({t:n(r[0])/1000,o:r[1],h:r[2],l:r[3],c:r[4],v:r[5]})));
  if(bars.length<2)throw Error('The source returned fewer than two usable candles.');
  return {...meta,bars,interval,historyNote:'Up to 1,000 '+names[provider]+' candles; the latest candle may still be forming.'};
 }
 return {request,market,supports,aggregate};
})();
