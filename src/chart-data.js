// Embedded verbatim in market-terminal.html; no runtime dependency on this file.
const MarketData = (()=>{
 'use strict';
 const intervals={
  '1':{y:'1m',range:'5d',seconds:60,k:1,b:'1m'},'5':{y:'5m',range:'1mo',seconds:300,k:5,b:'5m'},
  '15':{y:'15m',range:'1mo',seconds:900,k:15,b:'15m'},'30':{y:'30m',range:'1mo',seconds:1800,k:30,b:'30m'},
  '60':{y:'60m',range:'3mo',seconds:3600,k:60,b:'1h'},'240':{y:'4h',range:'3mo',seconds:14400,k:240,b:'4h'},
  D:{y:'1d',range:'2y',seconds:86400,k:1440,b:'1d'},W:{y:'1wk',range:'5y',seconds:604800,k:10080,b:'1w'}
 };
 const defaults={maxSources:5,timeoutMs:4000,deadlineMs:18000,providers:['kraken','coinbase','bitstamp','binance','binance-us','yahoo','twelve'],stockTransports:['corsdev','allorigins','corslol'],twelveKey:''};
 let settings=JSON.parse(JSON.stringify(defaults)),generation=0;
 const active=new Set(),healthRecords=new Map(),cooldowns=new Map();
 const providerNames={kraken:'Kraken',coinbase:'Coinbase Exchange',bitstamp:'Bitstamp',binance:'Binance','binance-us':'Binance.US',yahoo:'Yahoo Finance',twelve:'Twelve Data'};
 const transportNames={corsdev:'cors.dev',allorigins:'AllOrigins',corslol:'cors.lol'};
 function validateConfig(input){
  const next={...defaults,...input};
  for(const [key,min,max] of [['maxSources',1,20],['timeoutMs',500,10000],['deadlineMs',1000,25000]])if(!Number.isInteger(next[key])||next[key]<min||next[key]>max)throw Error(key+' must be an integer from '+min+' to '+max+'.');
  for(const [key,known] of [['providers',providerNames],['stockTransports',transportNames]]){
   if(!Array.isArray(next[key])||next[key].some(id=>typeof id!=='string'||!Object.hasOwn(known,id))||new Set(next[key]).size!==next[key].length)throw Error('Invalid or duplicate '+key+'.');
  }
  if(typeof next.twelveKey!=='string'||next.twelveKey.length>200||/[^A-Za-z0-9_-]/.test(next.twelveKey))throw Error('Invalid Twelve Data key.');
  return {maxSources:next.maxSources,timeoutMs:next.timeoutMs,deadlineMs:next.deadlineMs,providers:[...next.providers],stockTransports:[...next.stockTransports],twelveKey:next.twelveKey};
 }
 function config(){return JSON.parse(JSON.stringify(settings));}
 function aborted(){const error=Error('Market data request cancelled.');error.name='AbortError';return error;}
 function configure(input){const next=validateConfig(input);generation++;for(const controller of active)controller.abort();settings=next;healthRecords.clear();cooldowns.clear();return config();}
 const firstCompanyBar={GFUZ:Date.parse('2026-07-13T00:00:00Z')/1000};
 const number=v=>v!==null&&v!==undefined&&v!==''&&Number.isFinite(Number(v));
 function cleanBars(rows){
  const byTime=new Map();
  for(const row of rows){if(![row.t,row.o,row.h,row.l,row.c].every(number))continue;const b={t:Number(row.t),o:Number(row.o),h:Number(row.h),l:Number(row.l),c:Number(row.c),v:number(row.v)?Number(row.v):0};if(b.t<=0||b.l<=0||b.h<b.l||b.h<Math.max(b.o,b.c)||b.l>Math.min(b.o,b.c)||b.v<0)continue;byTime.set(b.t,b);}
  return [...byTime.values()].sort((a,b)=>a.t-b.t);
 }
 function routeSymbol(symbol){
  const [exchange,ticker]=symbol.toUpperCase().split(':');
  if(exchange==='KRAKEN')return {type:'kraken',pair:ticker,symbol};
  if(exchange==='BINANCE')return {type:'binance',pair:ticker,symbol};
  if(['NASDAQ','NYSE','AMEX','NYSEARCA'].includes(exchange))return {type:'yahoo',exchange,ticker:ticker.replace(/\./g,'-'),symbol};
  const suffix={LSE:'.L',TSX:'.TO',TSXV:'.V',ASX:'.AX',XETR:'.DE',FWB:'.F',EPA:'.PA',AMS:'.AS',TSE:'.T',HKEX:'.HK'}[exchange];
  if(suffix)return {type:'yahoo',exchange,ticker:(exchange==='HKEX'?ticker.padStart(4,'0'):ticker)+suffix,symbol};
  if(['FX','FX_IDC','OANDA','FOREXCOM'].includes(exchange)&&/^[A-Z]{6}$/.test(ticker))return {type:'yahoo',exchange,ticker:ticker+'=X',symbol};
  throw Error('No data adapter for '+exchange+'. Supported: US stocks, selected international exchanges, Kraken and Binance. Keep or remove this entry in Manage markets.');
 }
 function parseYahoo(payload,route,interval){
  if(payload?.chart?.error)throw Error(payload.chart.error.description||'The source could not find this symbol.');
  const result=payload?.chart?.result?.[0],meta=result?.meta,quote=result?.indicators?.quote?.[0];
  if(!meta||!quote||!Array.isArray(result.timestamp))throw Error('The stock source returned no usable price history.');
  if(typeof meta.symbol!=='string'||meta.symbol.toUpperCase()!==route.ticker.toUpperCase())throw Error('Stock source returned a different instrument symbol.');
  const returnedInterval=meta.dataGranularity==='1h'?'60m':meta.dataGranularity;
  if(typeof returnedInterval==='string'&&returnedInterval!==intervals[interval]?.y)throw Error('Stock source returned a different candle interval.');
  let bars=cleanBars(result.timestamp.map((t,i)=>({t,o:quote.open?.[i],h:quote.high?.[i],l:quote.low?.[i],c:quote.close?.[i],v:quote.volume?.[i]})));
  const step=intervals[interval]?.seconds,last=bars[bars.length-1],previous=bars[bars.length-2];
  // Yahoo appends a latest-price point outside the regular intraday bar grid.
  if(step<86400&&last&&previous&&last.v===0&&last.o===last.h&&last.h===last.l&&last.l===last.c&&last.t===meta.regularMarketTime){
   bars.pop();if(last.t>previous.t&&last.t-previous.t<step){previous.c=last.c;previous.h=Math.max(previous.h,last.c);previous.l=Math.min(previous.l,last.c);}
  }
  if(firstCompanyBar[route.ticker])bars=bars.filter(b=>b.t>=firstCompanyBar[route.ticker]);
  if(bars.length<2)throw Error('This symbol has fewer than two available bars for the selected interval.');
  const delay=number(meta.exchangeDataDelayedBy)?Number(meta.exchangeDataDelayedBy):null;
  return {bars,currency:typeof meta.currency==='string'?meta.currency:'',source:'Yahoo Finance via cors.dev relay',provider:'yahoo',delayMinutes:delay,interval,sourceSymbol:meta.symbol||route.ticker,quoteTime:number(meta.regularMarketTime)?Number(meta.regularMarketTime):null,quote:number(meta.regularMarketPrice)?Number(meta.regularMarketPrice):bars[bars.length-1].c,historyNote:route.ticker==='GFUZ'?'General Fusion bars from 13 Jul 2026; predecessor history excluded.':route.ticker==='SPCX'?'SpaceX IPO: 12 Jun 2026. Weekly bars are labeled by the start of their week.':''};
 }
 function parseKraken(payload,route,interval){
  if(!Array.isArray(payload?.error)||payload.error.length)throw Error(payload?.error?.join('; ')||'Kraken returned an invalid candle response.');
  const rows=Object.entries(payload.result||{}).find(([k,v])=>k!=='last'&&Array.isArray(v))?.[1];
  if(!rows)throw Error('No Kraken candles for this market.');
  const bars=cleanBars(rows.map(r=>({t:r[0],o:r[1],h:r[2],l:r[3],c:r[4],v:r[6]})));
  if(bars.length<2)throw Error('Kraken returned fewer than two usable candles.');
  return {bars,currency:route.pair.endsWith('USD')?'USD':'',source:'Kraken public OHLC',provider:'kraken',delayMinutes:null,interval,sourceSymbol:route.pair,historyNote:'Kraken supplies up to 720 candles; the latest candle is still forming.'};
 }
 function parseBinance(payload,route,interval){
  if(!Array.isArray(payload))throw Error(payload?.msg||'No Binance candles for this market.');
  const bars=cleanBars(payload.map(r=>({t:Number(r[0])/1000,o:r[1],h:r[2],l:r[3],c:r[4],v:r[5]})));
  if(bars.length<2)throw Error('Binance returned fewer than two usable candles.');
  const currency=['USDT','USDC','USD','BTC','ETH','EUR','BNB'].find(q=>route.pair.endsWith(q))||'';
  return {bars,currency,source:'Binance public market data',provider:'binance',delayMinutes:null,interval,sourceSymbol:route.pair,historyNote:'Up to 1,000 candles; the latest candle is still forming.'};
 }
 async function json(url,fetcher,signal){
  const response=await fetcher(url,{signal,credentials:'omit',referrerPolicy:'no-referrer'});
  const gateway=response.headers?.get('X-Cors-Error'),retry=response.headers?.get('Retry-After');
  let data;try{data=await response.json();}catch{const error=Error(response.ok?'Market data returned an unreadable response.':'Market data HTTP '+response.status);error.status=response.status;error.retryAfter=retry;error.gateway=gateway;throw error;}
  const krakenRate=Array.isArray(data?.error)&&data.error.some(message=>/rate limit|throttled/i.test(message));
  if(!response.ok||data?.status==='error'||krakenRate){
   // Do not include a URL or user API key in errors/diagnostics.
   const error=Error(gateway?'Relay '+gateway:krakenRate?'Kraken rate limit exceeded':data?.chart?.error?.description||data?.msg||data?.message||'Market data HTTP '+response.status);error.status=krakenRate?429:Number(data?.code)||response.status;error.retryAfter=retry;error.gateway=gateway;throw error;
  }return data;
 }
 function candidates(m,kind,interval){
  const route=routeSymbol(m.symbol);
  if(route.type==='kraken'||route.type==='binance'){
   const market=CryptoFeeds.market(route,m),order=[route.type,...settings.providers.filter(id=>id!==route.type)];
   return order.filter(id=>settings.providers.includes(id)&&CryptoFeeds.supports(id,market,kind,interval)).map(provider=>({id:provider,scope:provider,provider,transport:'direct',label:providerNames[provider],route,market}));
  }
  if(kind!=='candles')return [];
  const result=[];
  for(const provider of settings.providers){
   if(provider==='yahoo')for(const transport of settings.stockTransports)for(const host of ['query1.finance.yahoo.com','query2.finance.yahoo.com']){const id='yahoo-'+transport+'-'+host.split('.')[0];result.push({id,scope:id,provider,transport,label:'Yahoo Finance · '+transportNames[transport]+' · '+host.split('.')[0],host,route});}
   if(provider==='twelve'&&settings.twelveKey&&(['NASDAQ','NYSE','AMEX','NYSEARCA'].includes(route.exchange)||route.ticker.endsWith('=X')))result.push({id:'twelve',scope:'twelve',provider,transport:'direct',label:'Twelve Data',route});
  }
  // Try independent providers before spending the remaining budget on mirrors.
  const first=[],rest=[],seen=new Set();
  for(const candidate of result){if(seen.has(candidate.provider))rest.push(candidate);else{seen.add(candidate.provider);first.push(candidate);}}
  return [...first,...rest];
 }
 function coverage(m,interval='D'){const result={};for(const kind of ['candles','quote','book','trades'])result[kind]=candidates(m,kind,interval).map(({id,label,provider,transport})=>({id,label,provider,transport}));return result;}
 function localTimestamp(value,zone='UTC'){
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}( \d{2}:\d{2}:\d{2})?$/.test(value))return NaN;
  const desired=Date.parse(value.replace(' ','T')+(value.length===10?'T00:00:00Z':'Z'));let time=desired;
  for(let i=0;i<3;i++){
   const parts=new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(new Date(time));
   const p=Object.fromEntries(parts.map(x=>[x.type,x.value]));const represented=Date.UTC(+p.year,+p.month-1,+p.day,+p.hour,+p.minute,+p.second);time+=desired-represented;
  }
  return time/1000;
 }
 function twelveExchangeMatches(meta,route){
  const expected={NASDAQ:'NASDAQ',NYSE:'NYSE',AMEX:'AMEX',NYSEARCA:'NYSE ARCA'}[route.exchange];
  const mic={NASDAQ:['XNAS','XNGS','XNMS','XNCM'],NYSE:['XNYS'],AMEX:['XASE'],NYSEARCA:['ARCX']}[route.exchange]||[];
  return !expected||String(meta.exchange).toUpperCase()===expected||mic.includes(meta.mic_code);
 }
 function parseTwelve(payload,route,interval){
  const fx=route.ticker.endsWith('=X'),symbol=fx?route.ticker.slice(0,3)+'/'+route.ticker.slice(3,6):route.symbol?.split(':')[1]||route.ticker;
  const meta=payload?.meta;
  if(payload?.status!=='ok'||!meta||meta.symbol?.toUpperCase()!==symbol.toUpperCase()||!Array.isArray(payload.values))throw Error('Twelve Data returned a different or unavailable instrument.');
  if(!fx&&!twelveExchangeMatches(meta,route))throw Error('Twelve Data returned a different stock exchange.');
  const native={'1':'1min','5':'5min','15':'15min','30':'30min','60':'1h','240':'4h',D:'1day',W:'1week'}[interval];
  if(meta.interval!==native)throw Error('Twelve Data returned a different candle interval.');
  const zone=intervals[interval].seconds<86400?'UTC':meta.exchange_timezone|| (fx?'UTC':null);
  if(!zone)throw Error('Twelve Data did not identify the exchange timezone.');
  const bars=cleanBars(payload.values.map(r=>({t:localTimestamp(r.datetime,zone),o:r.open,h:r.high,l:r.low,c:r.close,v:r.volume??0}))).filter(b=>!firstCompanyBar[route.ticker]||b.t>=firstCompanyBar[route.ticker]);
  if(bars.length<2)throw Error('Twelve Data returned fewer than two usable candles.');
  return {bars,currency:fx?symbol.slice(-3):meta.currency||'',provider:'twelve',source:'Twelve Data',sourceSymbol:symbol,interval,delayMinutes:null,quote:bars[bars.length-1].c,quoteTime:null,historyNote:'Candle closes, not a timestamped current quote. Plan coverage and history limits apply. Daily/weekly labels use exchange-local midnight; intraday labels use UTC.'};
 }
 async function readCandidate(candidate,m,kind,interval,fetcher,signal,requireQuote=false){
  const io={json:url=>json(url,fetcher,signal)};
  if(candidate.market)return CryptoFeeds.request(candidate.provider,kind,candidate.market,interval,io);
  const route=candidate.route;
  if(candidate.provider==='twelve'){
   const symbol=route.ticker.endsWith('=X')?route.ticker.slice(0,3)+'/'+route.ticker.slice(3,6):route.symbol?.split(':')[1]||route.ticker;
   const query=new URLSearchParams({symbol,interval:{'1':'1min','5':'5min','15':'15min','30':'30min','60':'1h','240':'4h',D:'1day',W:'1week'}[interval],outputsize:'1000',order:'asc',timezone:'UTC',adjust:'splits',prepost:'false',apikey:settings.twelveKey});
   if(!route.ticker.endsWith('=X'))query.set('exchange',{NYSEARCA:'NYSE ARCA'}[route.exchange]||route.exchange);
   const result=parseTwelve(await io.json('https://api.twelvedata.com/time_series?'+query),route,interval);
   // Hourly alarm snapshots need a real quote timestamp, not a fabricated bar-close time.
   if(requireQuote){
    const quoteQuery=new URLSearchParams({symbol,apikey:settings.twelveKey,prepost:'false'});if(query.has('exchange'))quoteQuery.set('exchange',query.get('exchange'));
    try{
     const quote=await io.json('https://api.twelvedata.com/quote?'+quoteQuery),sameExchange=route.ticker.endsWith('=X')||twelveExchangeMatches(quote,route);
     if(quote.symbol?.toUpperCase()!==symbol.toUpperCase()||!sameExchange||quote.currency&&quote.currency!==result.currency||!number(quote.timestamp)||Number(quote.timestamp)<=0||Number(quote.timestamp)>Date.now()/1000+60||!number(quote.close)||Number(quote.close)<=0)throw Error('No matching timestamped quote.');
     result.quote=Number(quote.close);result.quoteTime=Number(quote.timestamp);result.historyNote=result.historyNote.replace('Candle closes, not a timestamped current quote.','Historical candles and a matching timestamped quote.');result.historyNote+=' The headline quote and alarm timestamp are supplied by the same provider.';
    }catch{result.historyNote+=' A matching timestamped quote was unavailable; alarms wait for one.';}
   }
   return result;
  }
  const target='https://'+candidate.host+'/v8/finance/chart/'+encodeURIComponent(route.ticker)+'?'+new URLSearchParams({interval:intervals[interval].y,range:intervals[interval].range,includePrePost:'false',events:'splits'});
  const url=candidate.transport==='corsdev'?'https://proxy.cors.dev/'+target:candidate.transport==='allorigins'?'https://api.allorigins.win/raw?url='+encodeURIComponent(target):'https://api.cors.lol/?url='+encodeURIComponent(target);
  const result=parseYahoo(await io.json(url),route,interval);result.source='Yahoo Finance via '+transportNames[candidate.transport]+' · '+candidate.host.split('.')[0];return result;
 }
 function timeoutAttempt(fn,parent,ms){
  const controller=new AbortController();let timer,onAbort;
  const interruption=new Promise((resolve,reject)=>{
   onAbort=()=>{controller.abort();reject(aborted());};parent.addEventListener('abort',onAbort,{once:true});
   timer=setTimeout(()=>{controller.abort();const error=Error('Source timed out.');error.timeout=true;reject(error);},ms);
  });
  return Promise.race([Promise.resolve().then(()=>{if(parent.aborted)throw aborted();return fn(controller.signal);}),interruption]).finally(()=>{clearTimeout(timer);parent.removeEventListener('abort',onAbort);});
 }
 async function run(m,kind,interval,{fetcher=fetch,signal,budgetMs,requireQuote=false}={}){
  if(kind==='candles'&&!intervals[interval])throw Error('Unsupported chart interval.');
  if(signal?.aborted)throw aborted();
  const list=candidates(m,kind,interval);
  const currentGeneration=generation,controller=new AbortController(),cancel=()=>controller.abort();signal?.addEventListener('abort',cancel,{once:true});active.add(controller);
  const started=Date.now(),deadline=started+Math.min(settings.deadlineMs,budgetMs||settings.deadlineMs),attempts=[],blockedProviders=new Set();
  try{
   if(!list.length)throw Error('No enabled compatible source for '+m.symbol+' '+kind+'. Check Data sources settings and coverage.');
   for(const candidate of list){
    if(controller.signal.aborted||generation!==currentGeneration)throw aborted();
    const marketKey=candidate.id+'|'+m.symbol+'|'+kind+(requireQuote?':quote':'')+'|'+interval;
    if(blockedProviders.has(candidate.provider)||Math.max(cooldowns.get('policy:'+candidate.provider)||0,cooldowns.get(candidate.scope)||0,cooldowns.get('transport:'+candidate.transport)||0,cooldowns.get(marketKey)||0)>Date.now())continue;
    if(attempts.length>=settings.maxSources||Date.now()>=deadline)break;
    try{
     const result=await timeoutAttempt(child=>readCandidate(candidate,m,kind,interval,fetcher,child,requireQuote),controller.signal,Math.max(1,Math.min(settings.timeoutMs,deadline-Date.now())));
     if(controller.signal.aborted||generation!==currentGeneration)throw aborted();
     if(requireQuote&&!candidate.market&&(!Number.isFinite(result.quoteTime)||result.quoteTime<=0||!Number.isFinite(result.quote)||result.quote<=0))throw Error('This source lacks the timestamped quote required for alarms.');
     const receivedAt=Date.now(),fallbackUsed=candidate.id!==list[0].id||attempts.length>0;
     if(candidate.market&&['quote','book'].includes(kind)&&result.observedAt!==null&&result.observedAt!==undefined&&(!Number.isFinite(result.observedAt)||result.observedAt>receivedAt+60000||receivedAt-result.observedAt>120000))throw Error('The source observation is stale or invalid.');
     healthRecords.set(candidate.id,{id:candidate.id,label:candidate.label,lastError:'',lastSuccessAt:receivedAt,cooldownUntil:0});
     return {...result,requestedSymbol:m.symbol,marketType:candidate.market?'crypto':candidate.route.ticker.endsWith('=X')?'fx':'stock',transport:candidate.transport,source:result.source||candidate.label,receivedAt,fallbackUsed,sourceId:candidate.id,attempts:[...attempts,{id:candidate.id,status:'ok'}]};
    }catch(error){
     if(controller.signal.aborted||generation!==currentGeneration)throw aborted();
     const rawMessage=String(error.message||'Source unavailable');
     const message=settings.twelveKey?rawMessage.split(settings.twelveKey).join('[redacted]'):rawMessage;
     attempts.push({id:candidate.id,status:'failed',httpStatus:error.status,error:message});
     const rawRetry=error.retryAfter,seconds=rawRetry!==null&&rawRetry!==undefined&&/^\d+(\.\d+)?$/.test(rawRetry)?Number(rawRetry):null;
     const retryUntil=seconds!==null?Date.now()+seconds*1000:rawRetry?Date.parse(rawRetry):NaN;
     const until=Number.isFinite(retryUntil)?Math.max(Date.now()+1000,retryUntil):Date.now()+(error.status===429?60000:30000);
     const relayWide=['rate_limited','quota_exceeded','service_unavailable'].includes(error.gateway)&&candidate.transport!=='direct';
     const scope=relayWide?'transport:'+candidate.transport:error.status===404||(!error.status&&!error.timeout&&error.name!=='TypeError')?marketKey:candidate.scope;
     cooldowns.set(scope,until);healthRecords.set(candidate.id,{id:candidate.id,label:candidate.label,lastError:message,lastSuccessAt:healthRecords.get(candidate.id)?.lastSuccessAt||0,cooldownUntil:until,policyBlocked:error.gateway==='owner_opted_out'});
     if(error.status===404||error.gateway==='owner_opted_out')blockedProviders.add(candidate.provider);
     if(error.gateway==='owner_opted_out')cooldowns.set('policy:'+candidate.provider,Infinity);
    }
   }
   const detail=attempts.length?attempts.map(x=>x.id+': '+x.error).join('; '):'Compatible sources are cooling down; retry after the reported delay.';
   const error=Error('Market data unavailable ('+attempts.length+'/'+Math.min(settings.maxSources,list.length)+' source attempts). '+detail);error.attempts=attempts;error.status=attempts[attempts.length-1]?.httpStatus;throw error;
  }finally{active.delete(controller);signal?.removeEventListener('abort',cancel);}
 }
 const request=(m,interval,options)=>run(m,'candles',interval,options);
 const quote=(m,options)=>run(m,'quote','D',options);
 const book=(m,options)=>run(m,'book','D',options);
 const trades=(m,options)=>run(m,'trades','D',options);
 function health(){return [...healthRecords.values()].map(row=>({...row}));}
 return {request,quote,book,trades,coverage,configure,config,validateConfig,health,defaults,routeSymbol,parseYahoo,parseKraken,parseBinance,parseTwelve,cleanBars,intervals};
})();
