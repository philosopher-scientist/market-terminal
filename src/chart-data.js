// Embedded verbatim in market-terminal.html; no runtime dependency on this file.
const MarketData = (()=>{
 'use strict';
 const intervals={
  '1':{y:'1m',range:'5d',seconds:60,k:1,b:'1m'},'5':{y:'5m',range:'1mo',seconds:300,k:5,b:'5m'},
  '15':{y:'15m',range:'1mo',seconds:900,k:15,b:'15m'},'30':{y:'30m',range:'1mo',seconds:1800,k:30,b:'30m'},
  '60':{y:'60m',range:'3mo',seconds:3600,k:60,b:'1h'},'240':{y:'4h',range:'3mo',seconds:14400,k:240,b:'4h'},
  D:{y:'1d',range:'2y',seconds:86400,k:1440,b:'1d'},W:{y:'1wk',range:'5y',seconds:604800,k:10080,b:'1w'}
 };
 const relay='https://proxy.cors.dev/';
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
  if(['NASDAQ','NYSE','AMEX','NYSEARCA'].includes(exchange))return {type:'yahoo',ticker:ticker.replace(/\./g,'-'),symbol};
  const suffix={LSE:'.L',TSX:'.TO',TSXV:'.V',ASX:'.AX',XETR:'.DE',FWB:'.F',EPA:'.PA',AMS:'.AS',TSE:'.T',HKEX:'.HK'}[exchange];
  if(suffix)return {type:'yahoo',ticker:(exchange==='HKEX'?ticker.padStart(4,'0'):ticker)+suffix,symbol};
  if(['FX','FX_IDC','OANDA','FOREXCOM'].includes(exchange)&&/^[A-Z]{6}$/.test(ticker))return {type:'yahoo',ticker:ticker+'=X',symbol};
  throw Error('No data adapter for '+exchange+'. Supported: US stocks, selected international exchanges, Kraken and Binance. Keep or remove this entry in Manage markets.');
 }
 function parseYahoo(payload,route,interval){
  if(payload?.chart?.error)throw Error(payload.chart.error.description||'The source could not find this symbol.');
  const result=payload?.chart?.result?.[0],meta=result?.meta,quote=result?.indicators?.quote?.[0];
  if(!meta||!quote||!Array.isArray(result.timestamp))throw Error('The stock source returned no usable price history.');
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
  let data;try{data=await response.json();}catch{const error=Error(response.ok?'Market data returned an unreadable response.':'Market data HTTP '+response.status);error.status=response.status;throw error;}
  if(!response.ok){const error=Error(data?.chart?.error?.description||data?.msg||'Market data HTTP '+response.status);error.status=response.status;throw error;}return data;
 }
 async function request(m,interval,{fetcher=fetch,signal}={}){
  const config=intervals[interval];if(!config)throw Error('Unsupported chart interval.');
  const route=routeSymbol(m.symbol);
  if(route.type==='kraken'){route.pair=m.pair||route.pair;return parseKraken(await json('https://api.kraken.com/0/public/OHLC?'+new URLSearchParams({pair:route.pair,interval:String(config.k)}),fetcher,signal),route,interval);}
  if(route.type==='binance')return parseBinance(await json('https://data-api.binance.vision/api/v3/klines?'+new URLSearchParams({symbol:route.pair,interval:config.b,limit:'1000'}),fetcher,signal),route,interval);
  let lastError;
  for(const host of ['query1.finance.yahoo.com','query2.finance.yahoo.com']){
   if(signal?.aborted)throw Error('Chart request cancelled.');
   try{return parseYahoo(await json(relay+'https://'+host+'/v8/finance/chart/'+encodeURIComponent(route.ticker)+'?'+new URLSearchParams({interval:config.y,range:config.range,includePrePost:'false',events:'splits'}),fetcher,signal),route,interval);}
   catch(error){lastError=error;if(error.status===404||signal?.aborted)break;}
  }
  throw lastError||Error('The stock data source is unavailable.');
 }
 return {request,routeSymbol,parseYahoo,parseKraken,parseBinance,cleanBars,intervals};
})();
