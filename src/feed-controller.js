// Embedded inside the application closure. Feed credentials never enter catalog exports.
const FEED_STORAGE_KEY='market-terminal-feeds-v1';
const FEED_PROVIDER_OPTIONS=[['kraken','Kraken'],['coinbase','Coinbase Exchange'],['bitstamp','Bitstamp'],['binance','Binance'],['binance-us','Binance.US'],['yahoo','Yahoo Finance'],['twelve','Twelve Data (optional key)']];
const FEED_TRANSPORT_OPTIONS=[['corsdev','cors.dev'],['allorigins','AllOrigins'],['corslol','cors.lol']];
let feedStorageIssue='',feedSettingsReady=false;
function readFeedSettings(){return MarketData.config();}
function feedSafeText(value){
 let text=String(value??'');const key=MarketData.config().twelveKey;
 if(key)text=text.split(key).join('[redacted]');
 return escapeHTML(text);
}
function fillFeedSettings(config=readFeedSettings()){
 $('feedMaxSources').value=String(config.maxSources);$('feedTimeout').value=String(config.timeoutMs/1000);
 if($('feedDeadline'))$('feedDeadline').value=String(config.deadlineMs/1000);
 $('feedTwelveKey').value=config.twelveKey;
 $('feedProviders').innerHTML=FEED_PROVIDER_OPTIONS.map(([id,label])=>`<label><input type="checkbox" data-feed-provider="${id}" ${config.providers.includes(id)?'checked':''}> ${label}</label>`).join('');
 $('feedTransports').innerHTML=FEED_TRANSPORT_OPTIONS.map(([id,label])=>`<label><input type="checkbox" data-feed-transport="${id}" ${config.stockTransports.includes(id)?'checked':''}> ${label}</label>`).join('');
}
function feedFormSettings(){
 const before=readFeedSettings(),selected=(selector,key)=>{
  const enabled=Array.from(document.querySelectorAll(selector)).filter(node=>node.checked).map(node=>node.dataset[key]);
  return [...before[key==='feedProvider'?'providers':'stockTransports'].filter(id=>enabled.includes(id)),...enabled.filter(id=>!before[key==='feedProvider'?'providers':'stockTransports'].includes(id))];
 };
 return {...before,maxSources:Number($('feedMaxSources').value),timeoutMs:Number($('feedTimeout').value)*1000,deadlineMs:$('feedDeadline')?Number($('feedDeadline').value)*1000:before.deadlineMs,providers:selected('input[data-feed-provider]','feedProvider'),stockTransports:selected('input[data-feed-transport]','feedTransport'),twelveKey:$('feedTwelveKey').value.trim()};
}
function renderFeedSettingsStatus(){
 const config=readFeedSettings(),m=current();
 $('feedStatus').textContent=feedStorageIssue||`Up to ${config.maxSources} compatible paths per request · ${config.timeoutMs/1000}s per attempt · ${config.deadlineMs/1000}s total. Relays and mirrors are paths, not independent data providers.`;
 if(m){
  let coverage;
  try{coverage=MarketData.coverage(m,state.interval);}catch(error){$('feedCoverage').innerHTML=`<p class="fine">${feedSafeText(error.message||'Coverage unavailable.')}</p>`;}
  if(coverage){
   const rows=[['candles','Candles'],['quote','Quotes'],['book','Order book / depth'],['trades','Recent trades']].map(([key,label])=>{
    const paths=coverage[key]||[],providers=new Set(paths.map(path=>path.provider)),active=paths.slice(0,config.maxSources);
    return `<p><strong>${label}:</strong> ${paths.length} compatible path${paths.length===1?'':'s'} / ${providers.size} independent provider${providers.size===1?'':'s'}; up to ${active.length} tried.<br><span class="fine">${paths.length?paths.map(path=>feedSafeText(path.label||path.id)).join(' → '):'No compatible enabled source.'}</span></p>`;
   }).join('');
   $('feedCoverage').innerHTML=`<p><strong>${feedSafeText(m.symbol)}</strong> · ${feedSafeText(state.interval)} chart interval</p>${rows}<p class="fine">A requested source count cannot add unsupported markets, intervals or currencies. Stock relays still use the same Yahoo data provider; an enabled optional stock provider needs its own key. Surrounding quote, book and trade panels are enabled only for starter crypto; other markets retain their chart and its quote.</p>`;
  }
 }
 const health=MarketData.health(),now=Date.now();
 $('feedHealth').innerHTML=health.length?health.map(item=>`<p><strong>${feedSafeText(item.label||item.id)}</strong> · ${item.policyBlocked?'blocked by upstream owner for this configuration':item.cooldownUntil>now?'cooling down for '+Math.ceil((item.cooldownUntil-now)/1000)+'s':item.lastSuccessAt?'available after a successful request':'not currently cooling down'}${item.lastError?'<br><span class="fine">'+feedSafeText(item.lastError)+'</span>':''}</p>`).join(''):'<p class="fine">No source failures or recovery checks recorded in this tab.</p>';
}
function openFeedSettings(){
 fillFeedSettings();$('feedError').textContent='';renderFeedSettingsStatus();$('feedsDialog').showModal();
}
function applyFeedSettings(input){
 // Validate before touching requests, caches, browser storage or the active settings.
 const checked=MarketData.validateConfig(input);
 MarketData.configure(checked);
 chartVersion++;marketVersion++;
 if(typeof alertConfigVersion!=='undefined')alertConfigVersion++;
 chartController?.abort();detailController?.abort();quoteController?.abort();
 chartBusy=false;detailBusy=false;quoteBusy=false;
 chartCache.clear();alertFeedCache.clear();
 if(typeof rememberChartWorkspace==='function')rememberChartWorkspace(true);
 if(typeof chartData!=='undefined')chartData=null;
 if(typeof quotes!=='undefined')quotes={};
 if(typeof book!=='undefined')book=null;
 if(typeof tapeAt!=='undefined')tapeAt=0;
 if(typeof resetDetails==='function')resetDetails();
 try{localStorage.setItem(FEED_STORAGE_KEY,JSON.stringify(checked));feedStorageIssue='';}
 catch{feedStorageIssue='Feed settings apply in this tab, but browser storage is unavailable. Your optional key and source choices were not saved.';}
 $('feedError').textContent='';fillFeedSettings(checked);renderFeedSettingsStatus();
 const tasks=[()=>loadChart(true),()=>refreshQuotes(),()=>refreshAlerts(true)];
 if(current()?.crypto)tasks.push(()=>refreshDetails());
 Promise.allSettled(tasks.map(task=>Promise.resolve().then(task))).then(()=>{if($('feedsDialog').open)renderFeedSettingsStatus();});
 toast(feedStorageIssue?'Feed settings applied for this tab only.':'Feed settings saved. Checking configured sources.');
 return readFeedSettings();
}
function initFeedSettings(){
 if(feedSettingsReady)return;feedSettingsReady=true;
 try{
  const raw=localStorage.getItem(FEED_STORAGE_KEY);
  if(raw)MarketData.configure(MarketData.validateConfig(JSON.parse(raw)));
 }catch{feedStorageIssue='Saved feed settings could not be read. Default sources are active; apply settings to save a replacement.';}
 $('feedSettingsBtn').onclick=openFeedSettings;$('closeFeeds').onclick=()=>$('feedsDialog').close();
 $('feedsForm').onsubmit=e=>{e.preventDefault();try{applyFeedSettings(feedFormSettings());}catch(error){$('feedError').textContent=String(error.message||'Invalid feed settings.');}};
 $('resetFeeds').onclick=()=>{try{applyFeedSettings(MarketData.defaults);}catch(error){$('feedError').textContent=String(error.message||'Feed defaults could not be applied.');}};
}
