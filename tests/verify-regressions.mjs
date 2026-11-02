// Focused regression tests execute the production inline script with a small DOM
// harness. They do not assert a live integration; browser/network evidence is separate.
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const source = fs.readFileSync(new URL('../market-terminal.html', import.meta.url), 'utf8');
const inline = source.match(/<script>([\s\S]*?)<\/script>/)[1];
new vm.Script(inline);

function harness({storage = null, alertsStorage = null, fetcher, storageWriteError = false, notification} = {}) {
  let stored=storage,storedAlerts=alertsStorage,undoCalls=0;const writes=[];
  let now = Date.parse('2026-11-02T17:00:00Z');
  class Clock extends Date { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return now; } }
  class Node {
    constructor() { this.textContent = ''; this.innerHTML = ''; this.hidden = false; this.value = ''; this.dataset = {}; this.children = []; this.attrs = {};const classes=new Set();this.classList={add:(...items)=>items.forEach(x=>classes.add(x)),remove:(...items)=>items.forEach(x=>classes.delete(x)),contains:x=>classes.has(x),toggle:(x,force)=>{const add=force??!classes.has(x);if(add)classes.add(x);else classes.delete(x);return add;}}; }
    append(...children) { this.children.push(...children); }
    replaceChildren(...children) { this.children = children; this.innerHTML = ''; }
    addEventListener(type,fn) { this.events ||= new Map();this.events.set(type,fn); }
    setAttribute(k,v) { this.attrs[k] = String(v); }
    querySelector(selector) { return this.nodes?.[selector] || null; }
    removeAttribute(k) { delete this.attrs[k]; }
    focus() {}
    click() {}
    remove() {}
    reset() {}
    showModal() { this.open=true; }
    close() { this.open=false; }
  }
  const nodes = new Map();
  const get = id => { if (!nodes.has(id)) nodes.set(id,new Node()); return nodes.get(id); };
  const rows = ['BTC','ETH','BNB'].map(ticker => {
    const row = new Node(),select = new Node(),quote = new Node();select.dataset.select = ticker;row.nodes = {'[data-select]':select,'.market-quote':quote};return row;
  });
  const strips = ['BTC','ETH','BNB'].map(ticker => { const n = new Node();n.dataset.select=ticker;n.nodes={span:new Node(),small:new Node()};return n; });
  const timers = new Map(),listeners=new Map(),downloads=[],observers=[],nativeCalls=[],requests=[];let timerId=0;
  const blobURLs={createObjectURL:blob=>{downloads.push(blob);return 'blob:test-export';},revokeObjectURL(){}};
  const context = vm.createContext({console,Date:Clock,AbortController,URLSearchParams,Blob,URL:blobURLs,Map,Set,Notification:notification,
    localStorage:{getItem(k){const value=k==='market-terminal-alerts-v1'?storedAlerts:stored;if(value instanceof Error)throw value;return value;},setItem(k,v){if(storageWriteError)throw Error('Storage write denied');if(k==='market-terminal-alerts-v1')storedAlerts=v;else stored=v;writes.push(v);}},
    document:{documentElement:{outerHTML:source.replace(/^<!doctype html>\s*/i,'')},getElementById:get,createElement:()=>new Node(),addEventListener:(type,listener)=>listeners.set(type,listener),hidden:false,activeElement:{tagName:'BODY'},querySelectorAll:s=>s==='.market-row'?rows:s==='.strip-item'?strips:[],body:new Node()},
    window:{addEventListener(){}},MutationObserver:class{constructor(fn){this.fn=fn;observers.push(this);}observe(){} disconnect(){}},
    setTimeout:fn=>{timers.set(++timerId,fn);return timerId;},clearTimeout:id=>timers.delete(id),setInterval(){},
    recordNative:(bars,options)=>nativeCalls.push({bars,options}),
    nativeUndo:()=>{undoCalls++;return true;},
    fetch:async(...args)=>{requests.push(args[0]);return (fetcher|| (async()=>{throw Error('Controlled network failure');}))(...args);},matchMedia:()=>({matches:false,addEventListener(){}})
  });
  // Replace only startup, keeping all production functions/event handlers intact.
  const startup='renderAlerts();refreshAlerts();syncDrawer();renderStrip();renderSelection();loadChart();clock();refreshQuotes();if(current().crypto)refreshDetails();setInterval(tick,1000);';
  assert.ok(inline.includes(startup),'Test harness startup anchor still matches');
  // The renderer has its own calculation/lifecycle suite and real browser QA.
  // This harness exercises the actual controller, data adapter, catalog and handlers.
  const controllerInline=inline.replace('/* NATIVE_ENGINE_END */',`/* NATIVE_ENGINE_END */
  NativeMarketChart.create=host=>{let workspace={drawings:[],undoHistory:[]};const canvas=document.createElement('canvas');canvas.tagName='CANVAS';host.append(canvas);return {
   setData:(bars,options)=>recordNative(bars,options),resize(){},resetView(){},setMode(){},
   clearDrawings(){workspace.undoHistory.push(workspace.drawings);workspace.drawings=[];},setScale(){},setFutureSpace(){},
   getWorkspace:()=>JSON.parse(JSON.stringify(workspace)),
   setWorkspace(value){workspace={drawings:NativeMarketChart.validateDrawings(value.drawings),undoHistory:value.undoHistory||[]};},
   getSnapshot:()=>({pending:false,canUndo:true,drawings:workspace.drawings.length,drawingItems:workspace.drawings}),
   undo(){nativeUndo();if(workspace.undoHistory.length)workspace.drawings=workspace.undoHistory.pop();return true;},toDataURL:()=>'',destroy:()=>canvas.remove()};};`);
  vm.runInContext(controllerInline.replace(startup,`globalThis.api={qty,refreshQuotes,refreshDetails,updateFreshness,setTicker,current,loadChart,save,
    getState:()=>state,getQuotes:()=>quotes,setQuotes:v=>quotes=v,setBook:v=>book=v,setTapeAt:v=>tapeAt=v,getBook:()=>book,
    setState:v=>Object.assign(state,v),addMarket:(...a)=>addMarket(...a),removeMarket:(...a)=>removeMarket(...a),
    addCategory:(...a)=>addCategory(...a),removeCategory:(...a)=>removeCategory(...a),moveMarket:(...a)=>moveMarket(...a),
    importCatalog:(...a)=>importCatalog(...a),exportCatalog:()=>exportCatalog(),getMarkets:()=>MARKETS,getCategories:()=>SECTORS,
    getChartData:()=>chartData,getChartVersion:()=>chartVersion,indicatorInputs,
    setLines:items=>{chartEngine.setWorkspace({drawings:items,undoHistory:[[]]});},getWorkspace:()=>chartEngine.getWorkspace(),
    getAlerts:()=>alertState,checkAlerts:()=>refreshAlerts(true),alertSnapshot:(...a)=>alertSnapshot(...a),alertAction:(...a)=>alertAction(...a),tick:()=>tick(),setHidden:v=>document.hidden=v};`),context);
  const click=dataset=>listeners.get('click')({target:{closest:()=>({dataset,hasAttribute:()=>false})}});
  const loadFrame=()=>{const frame=new Node();get('chartHost').nodes={iframe:frame};observers.at(-1).fn();frame.events.get('load')();};
  const key=(value,extra={})=>{context.document.activeElement={tagName:extra.tagName||'BODY'};listeners.get('keydown')({key:value,preventDefault(){},ctrlKey:false,metaKey:false,shiftKey:false,...extra});};
  return {api:context.api,get,rows,strips,timers,downloads,click,key,writes,loadFrame,nativeCalls,requests,pointerUp:()=>listeners.get('pointerup')({target:{closest:()=>true}}),undoCalls:()=>undoCalls,stored:()=>stored,alertsStored:()=>storedAlerts,advance:ms=>now+=ms,now:()=>now};
}

let passed = 0;
const test = async(name,fn) => { await fn();passed++;console.log('PASS',name); };

await test('A real tiny BTC trade remains nonzero',()=>{
  const h=harness();assert.equal(h.api.qty(0.00002713),'0.00002713');assert.notEqual(h.api.qty(0.00000001),'0');
});

await test('Quote staleness reaches main, watchlist, quick strip, and feed status',()=>{
  const h=harness();h.api.setQuotes({BTC:{last:100,change:1,at:h.now()}});h.api.updateFreshness();
  assert.match(h.strips[0].nodes.small.textContent,/\+1.00%/);
  h.advance(66000);h.api.updateFreshness();
  assert.match(h.get('assetChange').textContent,/Stale/);
  assert.match(h.rows[0].nodes['.market-quote'].innerHTML,/STALE/);
  assert.equal(h.strips[0].nodes.small.textContent,'stale');
  assert.match(h.get('connection').innerHTML,/UNAVAILABLE/);
});

await test('Trade tape expires independently when the book is unavailable',()=>{
  const h=harness();h.api.setBook(null);h.api.setTapeAt(h.now());h.advance(31000);h.api.updateFreshness();
  assert.match(h.get('tapeStatus').textContent,/Snapshot stale/);
});

await test('Network failure preserves last quote timestamp and marks it stale',async()=>{
  const h=harness();const at=h.now();h.api.setQuotes({BTC:{last:100,change:1,at}});h.advance(70000);await h.api.refreshQuotes();
  assert.equal(h.api.getQuotes().BTC.at,at);assert.match(h.get('assetChange').textContent,/Stale/);
});

await test('Live response aliases map BTC, ETH, and BNB without assuming request names',async()=>{
  const h=harness({fetcher:async()=>({ok:true,json:async()=>({error:[],result:{XXBTZUSD:{c:['100'],o:'80'},XETHZUSD:{c:['20'],o:'25'},BNBUSD:{c:['10'],o:'10'}}})})});
  await h.api.refreshQuotes();assert.equal(h.api.getQuotes().BTC.change,25);assert.equal(h.api.getQuotes().ETH.change,-20);assert.equal(h.api.getQuotes().BNB.last,10);
});

await test('Stock selection cannot display a crypto quote or crypto book',()=>{
  const h=harness();h.api.setQuotes({BTC:{last:100,change:1,at:h.now()}});h.api.setTicker('AMZN');
  assert.equal(h.get('assetPrice').textContent,'AMZN');assert.equal(h.get('cryptoDetails').hidden,true);assert.equal(h.get('tradeSection').hidden,true);assert.equal(h.get('stockDetails').hidden,false);
});

await test('Slow BTC detail response cannot overwrite a newly selected stock',async()=>{
  const pending=[];const h=harness({fetcher:url=>new Promise(resolve=>pending.push({url,resolve}))});
  const oldRequest=h.api.refreshDetails();assert.equal(pending.length,2);h.api.setTicker('AMZN');
  for(const p of pending)p.resolve({ok:true,json:async()=>({error:[],result:p.url.includes('Depth')?{XXBTZUSD:{bids:[['100','1']],asks:[['101','1']]}}:{XXBTZUSD:[['100','1','1793640000','b']]}})});
  await oldRequest;assert.equal(h.api.getBook(),null);assert.equal(h.get('assetPrice').textContent,'AMZN');assert.equal(h.get('cryptoDetails').hidden,true);
});

await test('Unavailable storage and malformed preferences do not stop initialization',()=>{
  assert.equal(harness({storage:new Error('Storage denied')}).api.current().ticker,'BTC');
  assert.equal(harness({storage:'{bad json'}).api.current().ticker,'BTC');
  const h=harness({storage:JSON.stringify({ticker:'NONEXISTENT',interval:'bad',style:'bad',studies:['bad']})});assert.equal(h.api.current().ticker,'BTC');assert.equal(h.api.getState().interval,'D');assert.equal(h.api.getState().style,'1');
});

await test('All study controls and volume reach the native renderer',()=>{
  const h=harness();h.api.setState({studies:['sma','ema','bb','rsi','macd'],volume:true});h.api.loadChart();
  const config=h.nativeCalls.at(-1).options;
  assert.equal(config.studies.length,5);assert.equal(config.volume,true);assert.equal(config.symbol,'KRAKEN:BTCUSD');
});

await test('A failed native candle request produces an actionable chart error',async()=>{
  const h=harness();await h.api.loadChart();
  assert.equal(h.get('chartStatus').textContent,'Data unavailable');assert.equal(h.get('chartMessage').hidden,false);
  assert.ok(h.get('chartMessage').children.some(n=>n.textContent==='Retry chart'));
});

await test('The selected outer interval explicitly reapplies to the native controller',()=>{
  const h=harness();h.api.loadChart();const previous=h.api.getChartVersion();
  h.click({interval:'60'});
  assert.ok(h.api.getChartVersion()>previous);assert.equal(h.api.getState().interval,'60');
  assert.match(h.requests.at(-1),/interval=60/);
});

await test('The selected chart type explicitly reaches the native renderer',()=>{
  const h=harness();h.api.loadChart();const previous=h.api.getChartVersion();
  h.click({style:'1'});
  assert.ok(h.api.getChartVersion()>previous);assert.equal(h.nativeCalls.at(-1).options.style,'1');
});

await test('A failed first quote request reports unavailable instead of waiting forever',async()=>{
  const h=harness();await h.api.refreshQuotes();
  assert.match(h.get('assetChange').textContent,/unavailable/i);
  assert.equal(h.get('assetPrice').textContent,'—');
});

await test('HTML export contains the complete current application without runtime markup',async()=>{
  const h=harness();h.get('assetPrice').textContent='$123,456.78';h.get('downloadBtn').onclick();
  assert.equal(h.downloads.length,1);
  const exported=await h.downloads[0].text();
  assert.match(exported,/^<!doctype html>\s*<html\b/i);
  assert.equal(exported.match(/<script>([\s\S]*?)<\/script>/)[1],inline);
  assert.equal(exported.includes('$123,456.78'),false);
  assert.equal(exported.includes('<iframe'),false);
  new vm.Script(exported.match(/<script>([\s\S]*?)<\/script>/)[1]);
  const exportFlag=process.argv.indexOf('--export-copy');
  if(exportFlag!==-1){assert.ok(process.argv[exportFlag+1],'--export-copy requires an output path');fs.writeFileSync(process.argv[exportFlag+1],exported);}
});

await test('Energy Innovation selects fusion and advanced fission companies with working chart configuration',()=>{
  const h=harness();
  for(const [ticker,symbol] of [['GFUZ','NASDAQ:GFUZ'],['OKLO','NYSE:OKLO'],['SMR','NYSE:SMR']]){
    h.api.setTicker(ticker);
    assert.equal(h.api.current().ticker,ticker);
    assert.equal(h.api.current().sector,'energy');
    assert.equal(h.api.current().symbol,symbol);
    assert.match(h.get('assetSubtitle').textContent,/ENERGY INNOVATION/);
    const config=h.nativeCalls.at(-1).options;
    assert.equal(config.symbol,symbol);
    assert.equal(h.get('chartFeedBadge').textContent,'DELAY UNSPECIFIED');
  }
});

await test('SpaceX selects its verified public listing under Space',()=>{
  const h=harness();h.api.setTicker('SPCX');
  assert.equal(h.api.current().ticker,'SPCX');
  assert.equal(h.api.current().sector,'space');
  assert.equal(h.api.current().symbol,'NASDAQ:SPCX');
  const config=h.nativeCalls.at(-1).options;
  assert.equal(config.symbol,'NASDAQ:SPCX');
  assert.equal(h.get('marketCount').textContent,'35 instruments');
  assert.equal(h.get('universeTag').textContent,'MVP / 35');
});

await test('Robotics has three selectable exchange-qualified representatives',()=>{
  const h=harness();
  for(const [ticker,symbol] of [['ROK','NYSE:ROK'],['TER','NASDAQ:TER'],['SYM','NASDAQ:SYM']]){
    h.api.setTicker(ticker);
    assert.equal(h.api.current().ticker,ticker);
    assert.equal(h.api.current().sector,'robotics');
    assert.equal(h.api.current().symbol,symbol);
    assert.match(h.get('assetSubtitle').textContent,/ROBOTICS/);
  }
});

await test('Stock source delay stays unspecified unless the actual metadata supplies a duration',()=>{
  const h=harness();h.api.setTicker('AMZN');
  assert.equal(h.get('chartFeedBadge').textContent,'DELAY UNSPECIFIED');
  assert.equal(h.get('chartFeedBadge').dataset.timing,'unknown');
  assert.match(h.get('chartFeedDetail').textContent,/Yahoo Finance/);
  assert.doesNotMatch(h.get('chartFeedDetail').textContent,/\d+\s*(?:minutes?|min|m\b)/i);
});

await test('Crypto timing explicitly identifies candle and panel polling cadences',()=>{
  const h=harness();h.api.setTicker('AMZN');h.api.setTicker('BTC');
  assert.equal(h.get('chartFeedBadge').textContent,'EXCHANGE SNAPSHOTS');
  assert.equal(h.get('chartFeedBadge').dataset.timing,'snapshot');
  assert.match(h.get('chartFeedDetail').textContent,/chart 20s/);
  assert.match(h.get('chartFeedDetail').textContent,/quotes 20s/);
  assert.match(h.get('chartFeedDetail').textContent,/book\/trades 10s/);
});

await test('A market added through the form survives reload with its custom category',()=>{
  const h=harness();h.get('categoryName').value='Semiconductors';h.get('categoryForm').onsubmit({preventDefault(){}});
  const category=h.api.getCategories().find(c=>c.name==='Semiconductors');assert.ok(category);
  h.get('marketSymbol').value=' nasdaq:intc ';h.get('marketName').value='Intel';h.get('marketCategory').value=category.id;
  h.get('marketForm').onsubmit({preventDefault(){}});
  h.api.setTicker('NASDAQ:INTC');assert.equal(h.api.current().symbol,'NASDAQ:INTC');assert.equal(h.api.current().sectorName,'Semiconductors');
  const restored=harness({storage:h.stored()});assert.equal(restored.api.current().symbol,'NASDAQ:INTC');
  assert.ok(restored.api.getCategories().some(c=>c.id===category.id));
});

await test('Exchange-qualified identity keeps identical tickers independent',()=>{
  const h=harness();h.api.addMarket({symbol:'NASDAQ:TEST',name:'First',category:'ai'});h.api.addMarket({symbol:'NYSE:TEST',name:'Second',category:'space'});
  h.api.setTicker('NASDAQ:TEST');h.click({star:'NASDAQ:TEST'});h.click({star:'NYSE:TEST'});
  h.api.removeMarket('NYSE:TEST');assert.equal(h.api.current().symbol,'NASDAQ:TEST');
  assert.ok(h.api.getState().favorites.includes('NASDAQ:TEST'));assert.ok(!h.api.getState().favorites.includes('NYSE:TEST'));
  assert.throws(()=>h.api.addMarket({symbol:' nasdaq:test ',name:'Duplicate',category:'ai'}),/already|duplicate/i);
});

await test('Deleting a category explicitly moves its markets without changing their symbols',()=>{
  const h=harness();h.api.setTicker('AMZN');h.api.removeCategory('mag7','ai');
  assert.equal(h.api.current().symbol,'NASDAQ:AMZN');assert.equal(h.api.current().sector,'ai');
  assert.equal(h.api.getMarkets().length,35);assert.ok(!h.api.getCategories().some(c=>c.id==='mag7'));
  assert.throws(()=>h.api.removeCategory('ai','ai'),/different|destination/i);
});

await test('A selected market can be removed while an old Kraken detail request is pending',async()=>{
  const pending=[];const h=harness({fetcher:url=>new Promise(resolve=>pending.push({url,resolve}))});
  const old=h.api.refreshDetails(),oldRequests=pending.slice();h.api.removeMarket('KRAKEN:BTCUSD');assert.notEqual(h.api.current().symbol,'KRAKEN:BTCUSD');
  // Resolve only the removed BTC requests; the replacement market's requests stay pending.
  for(const p of oldRequests)p.resolve({ok:true,json:async()=>({error:[],result:p.url.includes('Depth')?{XXBTZUSD:{bids:[['100','1']],asks:[['101','1']]}}:{XXBTZUSD:[['100','1','1793640000','b']]}})});
  await old;assert.equal(h.api.getBook(),null);assert.notEqual(h.api.current().symbol,'KRAKEN:BTCUSD');
});

await test('Custom crypto is chart-only and category placement never enables Kraken panels',()=>{
  const calls=[];const h=harness({fetcher:async url=>{calls.push(url);throw Error('controlled');}});
  h.api.addMarket({symbol:'BINANCE:SOLUSDT',name:'Solana',category:'crypto'});h.api.setTicker('BINANCE:SOLUSDT');
  assert.equal(h.api.current().crypto,false);assert.equal(h.get('cryptoDetails').hidden,true);assert.equal(h.get('tradeSection').hidden,true);
  assert.equal(h.get('chartFeedBadge').textContent,'EXCHANGE SNAPSHOTS');assert.ok(!calls.some(url=>/kraken.*(?:Depth|Trades|Ticker)/.test(url)));
  h.api.moveMarket('NASDAQ:AMZN','crypto');h.api.setTicker('NASDAQ:AMZN');assert.equal(h.api.current().crypto,false);
  assert.equal(h.get('chartFeedBadge').textContent,'DELAY UNSPECIFIED');
});

await test('International/custom chart timing and quote currency are not invented',()=>{
  const h=harness();h.api.addMarket({symbol:'LSE:VOD',name:'Vodafone',category:'ai'});h.api.setTicker('LSE:VOD');
  assert.equal(h.get('chartFeedBadge').textContent,'DELAY UNSPECIFIED');assert.match(h.get('stockDetails').innerHTML,/See chart/);
  assert.doesNotMatch(h.get('chartFeedDetail').textContent,/Cboe|REAL-TIME/);
});

await test('Catalog JSON round-trip preserves selection, favorites, removals and categories',()=>{
  const h=harness();const id=h.api.addCategory('Custom');h.api.addMarket({symbol:'NASDAQ:INTC',name:'Intel',category:id});
  h.api.setTicker('NASDAQ:INTC');h.click({star:'NASDAQ:INTC'});h.api.removeMarket('NASDAQ:SPCX');
  const backup=h.api.exportCatalog(),restored=harness();restored.api.importCatalog(backup);
  assert.equal(restored.api.exportCatalog(),backup);assert.equal(restored.api.current().symbol,'NASDAQ:INTC');
  assert.ok(!restored.api.getMarkets().some(m=>m.symbol==='NASDAQ:SPCX'));
});

await test('Invalid imports are atomic, including duplicate symbols and dangling categories',()=>{
  const h=harness();const before=h.api.exportCatalog();const original=JSON.parse(before);
  const invalids=[{...original,version:999},{...original,markets:[...original.markets,{symbol:'NASDAQ:BAD',name:'Bad',category:'missing'}]},
    {...original,markets:[...original.markets,{...original.markets[0],symbol:' kraken:btcusd '}]},
    {...original,categories:[...original.categories,{...original.categories[0]}]},
    {...original,markets:[...original.markets,{symbol:'<script>:BAD',name:'Bad',category:'ai'}]}];
  for(const input of invalids){const writes=h.writes.length;assert.throws(()=>h.api.importCatalog(JSON.stringify(input)));assert.equal(h.api.exportCatalog(),before);assert.equal(h.writes.length,writes);}
});

await test('User names and category labels render as literal text rather than injected markup',()=>{
  const h=harness();const name='<img src=x onerror="oops"> & \'quoted\'';const category=h.api.addCategory(name);
  h.api.addMarket({symbol:'NASDAQ:SAFE',name,category});h.api.setTicker('NASDAQ:SAFE');
  assert.equal(h.get('assetTitle').textContent,name);assert.ok(!h.get('watchItems').innerHTML.includes('<img'));
  assert.ok(!h.get('stockDetails').innerHTML.includes('<img'));assert.match(h.get('watchItems').innerHTML,/&lt;img/);
});

await test('The final market and final category cannot be removed',()=>{
  const h=harness();h.api.importCatalog(JSON.stringify({version:1,categories:[{id:'one',name:'One'}],markets:[{symbol:'NASDAQ:INTC',name:'Intel',category:'one'}]}));
  assert.throws(()=>h.api.removeMarket('NASDAQ:INTC'),/last|one market/i);assert.throws(()=>h.api.removeCategory('one','one'),/last|one category/i);
  assert.equal(h.api.current().symbol,'NASDAQ:INTC');
});

await test('Existing ticker-based preferences migrate and failed storage writes remain usable',()=>{
  const h=harness({storage:JSON.stringify({ticker:'AMZN',favorites:['BTC','AMZN'],interval:'W'})});
  assert.equal(h.api.current().symbol,'NASDAQ:AMZN');assert.ok(h.api.getState().favorites.includes('KRAKEN:BTCUSD'));assert.equal(h.api.getState().interval,'D');
  const denied=harness({storageWriteError:true});denied.api.addMarket({symbol:'NASDAQ:INTC',name:'Intel',category:'ai'});denied.api.setTicker('NASDAQ:INTC');
  assert.equal(denied.api.current().symbol,'NASDAQ:INTC');assert.match(denied.get('storageNotice').textContent,/unavailable|tab|export/i);
});

await test('Native chart failure never mislabels a non-stock market as delayed stock data',async()=>{
  const h=harness();h.api.addMarket({symbol:'BINANCE:SOLUSDT',name:'Solana',category:'crypto'});await h.api.loadChart();
  assert.equal(h.get('chartStatus').textContent,'Data unavailable');assert.doesNotMatch(h.get('chartFeedDetail').textContent,/Stocks|delays/);
});

await test('The chart host never mounts a branded remote embed',()=>{
  const h=harness();h.api.loadChart();
  assert.equal(h.get('chartHost').children.some(n=>n.src||n.tagName==='IFRAME'),false,'The chart must render locally, without a branded provider script or iframe');
});

const candlePayload=(symbol='AMZN')=>({chart:{result:[{meta:{currency:'USD',symbol},timestamp:[100,200,300],indicators:{quote:[{open:[10,11,12],high:[12,13,14],low:[9,10,11],close:[11,12,13],volume:[1,2,3]}]}}],error:null}});

await test('Fresh native candles are reused when style and indicators change',async()=>{
  const h=harness({fetcher:async()=>({ok:true,json:async()=>candlePayload()})});h.api.setState({ticker:'NASDAQ:AMZN'});await h.api.loadChart();
  const count=h.requests.length;h.api.setState({style:'2',studies:['ema'],volume:false});await h.api.loadChart();
  assert.equal(h.requests.length,count);assert.equal(h.nativeCalls.at(-1).options.style,'2');assert.equal(h.nativeCalls.at(-1).options.volume,false);
});

await test('A failed candle refresh preserves its real snapshot and marks it stale',async()=>{
  let fail=false;const h=harness({fetcher:async()=>{if(fail)throw Error('Source offline');return {ok:true,json:async()=>candlePayload()};}});
  h.api.setState({ticker:'NASDAQ:AMZN'});await h.api.loadChart();const data=h.api.getChartData();fail=true;h.advance(70000);await h.api.loadChart(true);
  assert.equal(h.api.getChartData(),data);assert.equal(h.get('chartMessage').hidden,true);assert.match(h.get('chartStatus').textContent,/STALE.*refresh failed/);assert.match(h.get('assetChange').textContent,/STALE/);
});

await test('Late candles from the previous symbol cannot replace the selected native chart',async()=>{
  const pending=[];const h=harness({fetcher:url=>new Promise(resolve=>pending.push({url,resolve}))});
  h.api.setState({ticker:'NASDAQ:AMZN'});const old=h.api.loadChart();h.api.setState({ticker:'NASDAQ:AAPL'});const latest=h.api.loadChart();
  pending[1].resolve({ok:true,json:async()=>candlePayload('AAPL')});await latest;
  pending[0].resolve({ok:true,json:async()=>candlePayload('AMZN')});await old;
  assert.equal(h.api.getChartData().sourceSymbol,'AAPL');assert.equal(h.nativeCalls.at(-1).options.symbol,'NASDAQ:AAPL');
});

await test('Edited indicator inputs persist through the real settings form and reload',()=>{
  const h=harness();for(const [id,value] of Object.entries({inputSma:'10',inputAtr:'20',inputEmas:'7, 14, 32',inputBb:'20',inputBbMult:'2',inputRsi:'14',inputMacdFast:'12',inputMacdSlow:'26',inputMacdSignal:'9'}))h.get(id).value=value;
  h.get('indicatorForm').onsubmit({preventDefault(){}});assert.deepEqual(Array.from(h.api.getState().indicatorSettings.emas),[7,14,32]);
  const restored=harness({storage:h.stored()});assert.equal(restored.api.getState().indicatorSettings.sma,10);assert.deepEqual(Array.from(restored.api.getState().indicatorSettings.emas),[7,14,32]);
  assert.throws(()=>h.api.indicatorInputs({macdFast:30,macdSlow:12}),/slow greater than fast/);
});

await test('Escape closes a dialog before it can undo a chart drawing',()=>{
  const h=harness();h.api.loadChart();h.get('marketsDialog').open=true;h.key('Escape');
  assert.equal(h.get('marketsDialog').open,false);assert.equal(h.undoCalls(),0);h.key('Escape');assert.equal(h.undoCalls(),1);
});

await test('Control/Command Z reaches drawing undo while text editing keeps native undo',()=>{
  const h=harness();h.api.loadChart();h.key('z',{ctrlKey:true});h.key('z',{metaKey:true});assert.equal(h.undoCalls(),2);
  h.key('z',{metaKey:true,tagName:'TEXTAREA'});h.key('Escape',{tagName:'INPUT'});assert.equal(h.undoCalls(),2);
});

await test('Four-EMA daily trend defaults and future space apply without replacing explicit saved choices',()=>{
  const h=harness();assert.equal(h.api.getState().interval,'D');assert.deepEqual(Array.from(h.api.getState().indicatorSettings.emas),[20,50,100,200]);assert.equal(h.api.getState().indicatorSettings.sma,200);assert.deepEqual(Array.from(h.api.getState().studies),['ema','rsi','macd']);assert.equal(h.api.getState().futureSpace,.2);
  const custom=harness({storage:JSON.stringify({interval:'D',studies:['bb'],indicatorSettings:{emas:[8,21]}})});assert.equal(custom.api.getState().interval,'D');assert.deepEqual(Array.from(custom.api.getState().indicatorSettings.emas),[8,21]);
  custom.get('resetTrendDefaults').onclick();assert.equal(custom.api.getState().interval,'D');assert.deepEqual(Array.from(custom.api.getState().indicatorSettings.emas),[20,50,100,200]);assert.deepEqual(Array.from(custom.api.getState().studies),['ema','rsi','macd']);
  custom.get('futureSpace').value='0.5';custom.get('futureSpace').onchange();assert.equal(harness({storage:custom.stored()}).api.getState().futureSpace,.5);
});

await test('EMA one is permitted as a configurable closing-price trace',()=>{
  const h=harness();assert.equal(h.api.indicatorInputs({emas:[1,7,14,32]}).emas[0],1);
});

await test('Portable chart expansion does not depend on an unresolved native fullscreen promise',()=>{
  const h=harness();h.api.loadChart();h.get('mainChart').requestFullscreen=()=>new Promise(()=>{});h.get('fullscreenBtn').onclick();
  assert.equal(h.get('mainChart').classList.contains('focus-mode'),true);h.key('Escape');assert.equal(h.get('mainChart').classList.contains('focus-mode'),false);assert.equal(h.undoCalls(),0);
});

const lineFixture=[{type:'trend',a:{t:1720000000,value:180},b:{t:1800000000,value:270}},{type:'horizontal',value:230}];
const plain=value=>JSON.parse(JSON.stringify(value));
await test('Per-symbol lines and Undo survive weekly, hourly, daily and reverse transitions',async()=>{
 const h=harness({fetcher:async()=>({ok:true,json:async()=>candlePayload()})});h.api.setState({ticker:'NASDAQ:AMZN',interval:'W'});await h.api.loadChart();h.api.setLines(lineFixture);h.pointerUp();
 const workspace=plain(h.api.getWorkspace());
 for(const interval of ['60','D','W']){h.click({interval});await h.api.loadChart();assert.deepEqual(plain(h.api.getWorkspace()),workspace);}
 h.api.setTicker('AAPL');await h.api.loadChart();assert.equal(h.api.getWorkspace().drawings.length,0);
 h.api.setTicker('AMZN');await h.api.loadChart();assert.deepEqual(plain(h.api.getWorkspace()),workspace);
 h.key('Escape');assert.equal(h.api.getWorkspace().drawings.length,0);assert.deepEqual(JSON.parse(h.stored()).drawings['NASDAQ:AMZN'],[]);
});
await test('Committed lines survive reload, category moves, removal and re-adding the symbol',async()=>{
 const fetcher=async()=>({ok:true,json:async()=>candlePayload()});const h=harness({fetcher});h.api.setState({ticker:'NASDAQ:AMZN'});await h.api.loadChart();h.api.setLines(lineFixture);h.pointerUp();
 const restored=harness({storage:h.stored(),fetcher});await restored.api.loadChart();assert.deepEqual(plain(restored.api.getWorkspace().drawings),lineFixture);
 restored.api.moveMarket('NASDAQ:AMZN','ai');await restored.api.loadChart();assert.deepEqual(plain(restored.api.getWorkspace().drawings),lineFixture);
 restored.api.removeMarket('NASDAQ:AMZN');await restored.api.loadChart();restored.api.addMarket({symbol:'NASDAQ:AMZN',name:'Amazon',category:'ai'});await restored.api.loadChart();assert.deepEqual(plain(restored.api.getWorkspace().drawings),lineFixture);
});
await test('JSON backups round-trip lines; invalid drawing imports are atomic and old backups preserve lines',async()=>{
 const h=harness({fetcher:async()=>({ok:true,json:async()=>candlePayload()})});h.api.setState({ticker:'NASDAQ:AMZN'});await h.api.loadChart();h.api.setLines(lineFixture);h.pointerUp();
 const backup=h.api.exportCatalog();assert.deepEqual(JSON.parse(backup).drawings['NASDAQ:AMZN'],lineFixture);
 const target=harness();target.api.importCatalog(backup);assert.equal(target.api.exportCatalog(),backup);
 const bad=JSON.parse(backup);bad.drawings['NASDAQ:AMZN'][0].a.t='bad';const writes=h.writes.length;
 assert.throws(()=>h.api.importCatalog(JSON.stringify(bad)));assert.equal(h.api.exportCatalog(),backup);assert.equal(h.writes.length,writes);
 const old=JSON.parse(backup);delete old.drawings;h.api.importCatalog(JSON.stringify(old));await h.api.loadChart();assert.deepEqual(plain(h.api.getWorkspace().drawings),lineFixture);
 const clear=JSON.parse(backup);clear.drawings['NASDAQ:AMZN']=[];h.api.importCatalog(JSON.stringify(clear));await h.api.loadChart();assert.equal(h.api.getWorkspace().drawings.length,0);
});
await test('An unavailable interval never overwrites saved lines with an empty loading workspace',async()=>{
 let fail=false;const h=harness({fetcher:async()=>{if(fail)throw Error('Source unavailable');return {ok:true,json:async()=>candlePayload()};}});
 h.api.setState({ticker:'NASDAQ:AMZN',interval:'W'});await h.api.loadChart();h.api.setLines(lineFixture);h.pointerUp();fail=true;
 h.api.setState({interval:'60'});await h.api.loadChart();assert.equal(h.get('chartStatus').textContent,'Data unavailable');assert.deepEqual(JSON.parse(h.stored()).drawings['NASDAQ:AMZN'],lineFixture);
 h.api.setState({interval:'W'});await h.api.loadChart();assert.deepEqual(plain(h.api.getWorkspace().drawings),lineFixture);
});
await test('Malformed saved drawing records cannot prevent chart initialization',()=>{
 const h=harness({storage:JSON.stringify({drawings:{'NASDAQ:AMZN':[{type:'trend',a:{t:'bad',value:10},b:{t:100,value:20}}]}})});
 assert.equal(h.api.current().ticker,'BTC');assert.deepEqual(plain(h.api.getState().drawings),{});
});
await test('Alerts form creates a persisted price alarm for an unselected market and live adapter triggers it once',async()=>{
 const now=Date.parse('2026-11-02T17:00:00Z');const payload=candlePayload();payload.chart.result[0].meta.regularMarketPrice=13;payload.chart.result[0].meta.regularMarketTime=now/1000;
 const h=harness({fetcher:async()=>({ok:true,json:async()=>payload})});
 for(const [id,value] of Object.entries({alertSymbol:'NASDAQ:AMZN',alertType:'above',alertThreshold:'10',alertWindow:'24',alertDirection:'either',alertRepeat:'once',alertLabel:'Amazon alarm'}))h.get(id).value=value;
 h.get('alertForm').onsubmit({preventDefault(){}});await h.api.checkAlerts();
 assert.equal(h.api.current().ticker,'BTC');assert.equal(h.api.getAlerts().rules.length,1);assert.equal(h.api.getAlerts().rules[0].enabled,false);assert.equal(h.api.getAlerts().history.length,1);assert.match(h.get('alertBannerText').textContent,/AMZN/);
 const restored=harness({storage:h.stored(),alertsStorage:h.alertsStored(),fetcher:async()=>({ok:true,json:async()=>payload})});await restored.api.checkAlerts();assert.equal(restored.api.getAlerts().history.length,1);
});
const addTestAlert=(h,changes={})=>{for(const [id,value] of Object.entries({alertSymbol:'NASDAQ:AMZN',alertType:'above',alertThreshold:'10',alertWindow:'24',alertDirection:'either',alertRepeat:'once',alertLabel:'Test level',...changes}))h.get(id).value=value;h.get('alertForm').onsubmit({preventDefault(){}});};
await test('Alert snapshot preserves stock quote time and uses completed hourly close times',()=>{
 const h=harness(),now=h.now();const data={provider:'yahoo',quoteTime:(now-600000)/1000,quote:100,bars:[{t:(now-7200000)/1000,c:90},{t:(now-3600000)/1000,c:95},{t:now/1000,c:100}]};
 const snapshot=h.api.alertSnapshot(data,now);assert.equal(snapshot.at,now-600000);assert.deepEqual(plain(snapshot.bars),[{t:(now-3600000)/1000,c:90}]);
 assert.throws(()=>h.api.alertSnapshot({...data,quoteTime:null},now),/timestamp/);
 assert.throws(()=>h.api.alertSnapshot({provider:'kraken',bars:[{t:(now-7200000)/1000,c:100}]},now),/current/);
});
await test('Invalid alert input and malformed alert imports are atomic; old backups preserve alerts',async()=>{
 const h=harness();addTestAlert(h,{alertThreshold:'-1'});assert.equal(h.api.getAlerts().rules.length,0);assert.match(h.get('alertsMessage').textContent,/positive/);
 addTestAlert(h);await h.api.checkAlerts();const backup=h.api.exportCatalog(),bad=JSON.parse(backup);bad.alerts.rules[0].threshold=-1;const writes=h.writes.length;
 assert.throws(()=>h.api.importCatalog(JSON.stringify(bad)));assert.equal(h.api.exportCatalog(),backup);assert.equal(h.writes.length,writes);
 const older=JSON.parse(backup);delete older.alerts;h.api.importCatalog(JSON.stringify(older));assert.equal(h.api.getAlerts().rules.length,1);
});
await test('Pausing an alarm during an in-flight request prevents a late trigger',async()=>{
 const pending=[];const h=harness({fetcher:()=>new Promise(resolve=>pending.push(resolve))});addTestAlert(h);const rule=h.api.getAlerts().rules[0];h.api.alertAction('toggle',rule.id);
 const payload=candlePayload();Object.assign(payload.chart.result[0].meta,{regularMarketTime:h.now()/1000,regularMarketPrice:13});pending[0]({ok:true,json:async()=>payload});await h.api.checkAlerts();
 assert.equal(h.api.getAlerts().history.length,0);assert.equal(h.api.getAlerts().rules[0].enabled,false);
});
await test('Alert backups round-trip rules and history, and Esc closes alerts before chart undo',async()=>{
 const h=harness();addTestAlert(h);await h.api.checkAlerts();h.get('testAlarm').onclick();const backup=h.api.exportCatalog();
 const target=harness();target.api.importCatalog(backup);assert.equal(target.api.exportCatalog(),backup);
 assert.equal(target.api.getAlerts().history[0].test,true);h.get('alertsDialog').open=true;h.key('Escape');assert.equal(h.get('alertsDialog').open,false);assert.equal(h.undoCalls(),0);
});
await test('Alert feed failures leave saved rules armed and display the source failure',async()=>{
 const h=harness();addTestAlert(h);await h.api.checkAlerts();assert.equal(h.api.getAlerts().rules[0].enabled,true);assert.equal(h.api.getAlerts().history.length,0);assert.match(h.get('alertsRules').innerHTML,/Check unavailable/);
 h.get('enableAlertNotifications').onclick();assert.equal(h.api.getAlerts().history.length,0);
});
await test('Test alarm preserves desktop delivery errors while keeping in-page history',()=>{
 class UnsupportedNotification{static permission='granted';constructor(){throw Error('Unsupported mobile notification');}}
 const h=harness({notification:UnsupportedNotification});h.get('alertDesktop').checked=true;h.get('alertDesktop').onchange();h.get('testAlarm').onclick();
 assert.equal(h.api.getAlerts().history.length,1);assert.match(h.get('alertsMessage').textContent,/Desktop delivery unavailable/);assert.match(h.get('alertsMessage').className,/error/);
});
await test('Multiple alarm actions reuse a fresh per-symbol snapshot instead of repeating source calls',async()=>{
 const h=harness({fetcher:async()=>{const payload=candlePayload();Object.assign(payload.chart.result[0].meta,{regularMarketTime:h.now()/1000,regularMarketPrice:13});return {ok:true,json:async()=>payload};}});
 addTestAlert(h,{alertThreshold:'100'});await h.api.checkAlerts();addTestAlert(h,{alertThreshold:'200'});await h.api.checkAlerts();await h.api.checkAlerts();assert.equal(h.requests.length,1);
});
await test('The actual timer checks configured alarms before skipping hidden-tab chart work',async()=>{
 let value=13;const h=harness({fetcher:async()=>{const payload=candlePayload();Object.assign(payload.chart.result[0].meta,{regularMarketTime:h.now()/1000,regularMarketPrice:value});return {ok:true,json:async()=>payload};}});
 addTestAlert(h,{alertThreshold:'100'});await h.api.checkAlerts();assert.equal(h.api.getAlerts().history.length,0);
 h.api.setHidden(true);h.advance(61000);value=101;h.api.tick();await h.api.checkAlerts();assert.equal(h.api.getAlerts().history.length,1);assert.equal(h.requests.length,2);
});
await test('Untouched legacy profiles migrate to four EMAs while saved custom profiles remain intact',()=>{
 const old={sma:9,emas:[7,14,32],bb:20,bbMult:2,rsi:14,macdFast:12,macdSlow:26,macdSignal:9};
 for(const emas of [[9],[7,14,32]]){
  const h=harness({storage:JSON.stringify({ticker:'AMZN',interval:'W',analysisDefaultsVersion:1,indicatorSettings:{...old,emas}})});
  assert.deepEqual(plain(h.api.getState().indicatorSettings.emas),[20,50,100,200]);assert.equal(h.api.getState().interval,'D');assert.equal(h.api.current().ticker,'AMZN');
  h.api.save();const saved=JSON.parse(h.stored());assert.equal(saved.analysisDefaultsVersion,2);assert.equal(harness({storage:h.stored()}).api.getState().indicatorSettings.emas.length,4);
 }
 const custom=harness({storage:JSON.stringify({interval:'W',analysisDefaultsVersion:1,indicatorSettings:{...old,rsi:21}})});assert.equal(custom.api.getState().interval,'W');assert.equal(custom.api.getState().indicatorSettings.rsi,21);assert.deepEqual(plain(custom.api.getState().indicatorSettings.emas),old.emas);
 const chosen=harness({storage:JSON.stringify({interval:'W',analysisDefaultsVersion:2,indicatorSettings:old})});assert.equal(chosen.api.getState().interval,'W');assert.deepEqual(plain(chosen.api.getState().indicatorSettings.emas),old.emas);
});
await test('Selecting Turtle is a draft until Apply, then saves daily channels and ATR20',()=>{
 const h=harness();h.get('indicatorSettingsBtn').onclick();h.get('strategyPreset').value='turtle';h.get('strategyPreset').onchange();assert.equal(h.api.getState().strategyPreset,'trend');
 assert.equal(h.get('inputAtr').value,'20');h.get('indicatorForm').onsubmit({preventDefault(){}});
 assert.equal(h.api.getState().strategyPreset,'turtle');assert.equal(h.api.getState().interval,'D');assert.deepEqual(plain(h.api.getState().studies),['turtle','atr']);assert.equal(h.api.getState().indicatorSettings.atr,20);
 const restored=harness({storage:h.stored()});assert.equal(restored.api.getState().strategyPreset,'turtle');assert.deepEqual(plain(restored.api.getState().studies),['turtle','atr']);restored.api.loadChart();assert.equal(restored.nativeCalls.at(-1).options.settings.atr,20);
});
await test('Custom chart settings cannot retain a misleading named strategy preset',()=>{
 const h=harness();h.get('indicatorSettingsBtn').onclick();h.get('strategyPreset').value='turtle';h.get('strategyPreset').onchange();h.get('indicatorForm').onsubmit({preventDefault(){}});
 h.click({interval:'W'});assert.equal(h.api.getState().strategyPreset,'custom');assert.match(h.get('strategyStatus').textContent,/bars/);
 h.get('indicatorSettingsBtn').onclick();h.get('strategyPreset').value='turtle';h.get('strategyPreset').onchange();h.get('indicatorForm').onsubmit({preventDefault(){}});
 h.click({style:'2'});assert.equal(h.api.getState().strategyPreset,'turtle');h.click({study:'atr'});assert.equal(h.api.getState().strategyPreset,'custom');
});
await test('Momentum and volatility presets configure their intended studies; ATR input rejects invalid values atomically',()=>{
 const h=harness();for(const [preset,studies] of [['momentum',['ema','rsi','macd']],['volatility',['bb','atr']]]){
  h.get('indicatorSettingsBtn').onclick();h.get('strategyPreset').value=preset;h.get('strategyPreset').onchange();h.get('indicatorForm').onsubmit({preventDefault(){}});assert.equal(h.api.getState().strategyPreset,preset);assert.deepEqual(plain(h.api.getState().studies),studies);
 }
 const before=JSON.stringify(h.api.getState());h.get('indicatorSettingsBtn').onclick();h.get('inputAtr').value='1';h.get('indicatorForm').onsubmit({preventDefault(){}});assert.equal(JSON.stringify(h.api.getState()),before);assert.match(h.get('indicatorError').textContent,/2–300/);
});
await test('Editing a drafted preset keeps its intended study mix and labels the result Custom',()=>{
 const h=harness();h.get('indicatorSettingsBtn').onclick();h.get('strategyPreset').value='turtle';h.get('strategyPreset').onchange();h.get('inputAtr').value='21';h.get('indicatorForm').events.get('input')({target:{tagName:'INPUT'}});
 assert.equal(h.get('strategyPreset').value,'custom');h.get('indicatorForm').onsubmit({preventDefault(){}});assert.equal(h.api.getState().strategyPreset,'custom');assert.deepEqual(plain(h.api.getState().studies),['turtle','atr']);assert.equal(h.api.getState().indicatorSettings.atr,21);
});
await test('Applying a daily preset preserves drawings anchored on a weekly chart',async()=>{
 const h=harness({fetcher:async()=>({ok:true,json:async()=>candlePayload()})});h.api.setState({ticker:'NASDAQ:AMZN',interval:'W'});await h.api.loadChart();h.api.setLines(lineFixture);h.pointerUp();
 h.get('indicatorSettingsBtn').onclick();h.get('strategyPreset').value='turtle';h.get('strategyPreset').onchange();h.get('indicatorForm').onsubmit({preventDefault(){}});await h.api.loadChart();assert.deepEqual(plain(h.api.getWorkspace().drawings),lineFixture);assert.equal(h.api.getState().strategyPreset,'turtle');
});
await test('A mismatched saved preset is restored as Custom; a matching saved Turtle preset stays named',()=>{
 const saved={analysisDefaultsVersion:2,strategyPreset:'turtle',interval:'W',studies:['turtle','atr'],indicatorSettings:{sma:200,emas:[20,50,100,200],bb:20,bbMult:2,rsi:14,macdFast:12,macdSlow:26,macdSignal:9,atr:20}};
 assert.equal(harness({storage:JSON.stringify(saved)}).api.getState().strategyPreset,'custom');assert.equal(harness({storage:JSON.stringify({...saved,interval:'D'})}).api.getState().strategyPreset,'turtle');
});
await test('AMZN research preset is selectable and persists without changing the general Trend profile',async()=>{
 const h=harness();h.api.setTicker('AMZN');h.get('indicatorSettingsBtn').onclick();h.get('strategyPreset').value='amzn';h.get('strategyPreset').onchange();h.get('indicatorForm').onsubmit({preventDefault(){}});
 assert.equal(h.api.getState().strategyPreset,'amzn');assert.equal(h.api.getState().interval,'D');assert.deepEqual(plain(h.api.getState().studies),['ema','macd']);assert.match(h.get('strategyPreview').textContent,/research|holdout/i);
 const inputs=h.api.getState().indicatorSettings;assert.deepEqual(plain(inputs.emas),[7,32]);assert.deepEqual([inputs.macdFast,inputs.macdSlow,inputs.macdSignal],[20,50,9]);
 await h.api.loadChart();assert.deepEqual(plain(h.nativeCalls.at(-1).options.settings.emas),[7,32]);assert.equal(h.nativeCalls.at(-1).options.settings.macdSlow,50);assert.match(h.get('strategyStatus').textContent,/AMZN.*research/);assert.match(h.get('strategyStatus').textContent,/tested on AMZN daily; no forecast/);
 assert.equal(harness({storage:h.stored()}).api.getState().strategyPreset,'amzn');h.get('resetTrendDefaults').onclick();assert.deepEqual(plain(h.api.getState().indicatorSettings.emas),[20,50,100,200]);
});
console.log(`${passed} focused regressions passed. Live integration is verified separately.`);
