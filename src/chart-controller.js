// Embedded in the application's closure, alongside its UI and persistent state.
let chartEngine=null,chartData=null,chartController=null,chartBusy=false,lastChartAttempt=0,chartRenderedKey='',chartFailure='',chartCache=new Map();
let chartRenderedSymbol='',chartWorkspaceReady=false,pendingWorkspace=null,chartWorkspaces=new Map();
let indicatorDraftBasis=null;
function validateDrawingStore(input){
 if(input===undefined)return {};
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).length>5000)throw Error('Invalid saved chart drawings.');
 const result={};let total=0;
 for(const [symbol,items] of Object.entries(input)){
  if(!/^[A-Z0-9_]{1,30}:[A-Z0-9][A-Z0-9._!/-]{0,69}$/.test(symbol))throw Error('Saved drawings need an exchange-qualified symbol.');
  const checked=NativeMarketChart.validateDrawings(items);total+=checked.length;if(total>10000)throw Error('Keep at most 10,000 saved lines in a backup.');result[symbol]=checked;
 }
 return result;
}
function rememberChartWorkspace(persist=false){
 if(!chartEngine||!chartWorkspaceReady)return;
 const workspace=chartEngine.getWorkspace(),symbol=chartRenderedSymbol;chartWorkspaces.set(symbol,workspace);
 if(JSON.stringify(workspace.drawings)!==JSON.stringify(state.drawings[symbol]||[])){
  state.drawings[symbol]=workspace.drawings;if(persist)save();
 }
}
function mergeDrawingWorkspaces(incoming){
 for(const [symbol,drawings] of Object.entries(incoming)){
  state.drawings[symbol]=drawings;chartWorkspaces.delete(symbol);
  if(chartRenderedSymbol===symbol){pendingWorkspace={drawings};if(chartWorkspaceReady)chartEngine.setWorkspace(pendingWorkspace);}
 }
}
function indicatorInputs(value){
 const s={...INDICATOR_DEFAULTS,...value};
 const integer=(v,min,max)=>Number.isInteger(v)&&v>=min&&v<=max;
 if(!integer(s.sma,2,300)||!Array.isArray(s.emas)||!s.emas.length||s.emas.length>5||s.emas.some(n=>!integer(n,1,300))||!integer(s.bb,2,300)||!Number.isFinite(s.bbMult)||s.bbMult<.5||s.bbMult>5||!integer(s.rsi,2,100)||!integer(s.atr,2,300)||!integer(s.macdFast,2,100)||!integer(s.macdSlow,3,300)||s.macdSlow<=s.macdFast||!integer(s.macdSignal,2,100))throw Error('Use periods 2–300 (EMA may be 1; RSI / MACD fast / signal up to 100), 1–5 EMA lengths, BB multiplier 0.5–5, and MACD slow greater than fast.');
 return {...s,emas:[...new Set(s.emas)]};
}
function strategyInputsMatch(a,b){return Object.keys(INDICATOR_DEFAULTS).every(key=>JSON.stringify(a[key])===JSON.stringify(b[key]));}
function strategyMatches(id){const p=STRATEGY_PRESETS[id];return !!p&&state.interval===p.interval&&state.volume===p.volume&&state.studies.length===p.studies.length&&p.studies.every(s=>state.studies.includes(s))&&strategyInputsMatch(state.indicatorSettings,p.settings);}
function inferStrategyPreset(){return Object.keys(STRATEGY_PRESETS).find(strategyMatches)||'custom';}
function renderStrategyStatus(){
 const name=STRATEGY_PRESETS[state.strategyPreset]?.name||'Custom indicators';
 const turtle=state.studies.includes('turtle');
 const research=state.strategyPreset==='amzn'?' · tested on AMZN daily; no forecast':'';
 $('strategyStatus').textContent=name+research+(turtle?` · ${state.interval==='D'?'daily':'bar-based'} channels: entries 20/55, exits 10/20${state.interval==='D'?'':' bars; select 1D for days'}`:'')+(state.studies.includes('atr')?` · ATR ${state.indicatorSettings.atr} in price units; latest bar may be forming`:'');
}
function fillIndicatorInputs(settings){
 for(const [id,key] of [['inputSma','sma'],['inputBb','bb'],['inputBbMult','bbMult'],['inputRsi','rsi'],['inputAtr','atr'],['inputMacdFast','macdFast'],['inputMacdSlow','macdSlow'],['inputMacdSignal','macdSignal']])$(id).value=String(settings[key]);
 $('inputEmas').value=settings.emas.join(', ');
}
function renderPresetPreview(){const p=STRATEGY_PRESETS[$('strategyPreset').value];$('strategyPreview').textContent=p?p.description+' Select Apply inputs to use this daily view.':'Custom inputs and study visibility. Periods count bars; use 1D for daily channels.';}
function applyStrategyPreset(id){
 const preset=STRATEGY_PRESETS[id];if(!preset)throw Error('Choose a supported indicator preset.');
 rememberChartWorkspace(true);state.indicatorSettings=indicatorInputs(preset.settings);state.interval=preset.interval;state.studies=[...preset.studies];state.volume=preset.volume;state.strategyPreset=id;save();renderControls();loadChart();
}
function chartOptions(){return {symbol:current().symbol,label:current().name,currency:chartData?.currency||'',style:state.style,studies:state.studies,volume:state.volume,settings:state.indicatorSettings,intervalSeconds:MarketData.intervals[state.interval].seconds,futureSpace:state.futureSpace};}
function readyChart(){
 const key=current().id+'|'+state.interval;
 if(!chartEngine||chartRenderedKey!==key){
  rememberChartWorkspace(true);chartEngine?.destroy();$('chartHost').replaceChildren();chartEngine=NativeMarketChart.create($('chartHost'));chartRenderedKey=key;chartRenderedSymbol=current().id;
  pendingWorkspace=chartWorkspaces.get(chartRenderedSymbol)||{drawings:state.drawings[chartRenderedSymbol]||[]};chartWorkspaceReady=false;
  setDrawMode('pan');chartEngine.setScale($('chartScale').value||'linear');
 }
 const bars=chartData?.key===key?chartData.bars:[];chartEngine.setData(bars,chartOptions());
 if(bars.length&&!chartWorkspaceReady){chartEngine.setWorkspace(pendingWorkspace);chartWorkspaceReady=true;pendingWorkspace=null;}
 updateDrawingStatus();
}
function chartStatusText(){
 if(!chartData)return chartFailure?'Data unavailable':'Loading market data';
 const stale=Date.now()-chartData.receivedAt>90000||!!chartFailure;
 return `${stale?'STALE · ':''}${chartData.bars.length} bars · fetched ${timeUTC(chartData.receivedAt)} UTC${chartFailure?' · refresh failed':''}`;
}
async function loadChart(force=false){
 const version=++chartVersion,m=current(),interval=state.interval,key=m.id+'|'+interval;
 chartController?.abort();const controller=new AbortController();chartController=controller;chartBusy=true;lastChartAttempt=Date.now();chartFailure='';
 const changed=chartData?.key!==key;if(changed)chartData=null;
 try{
  readyChart();renderFeedTiming(m);renderQuote();
  const cached=chartCache.get(key);
  if(!force&&cached&&Date.now()-cached.receivedAt<chartRefreshMs(m)){chartData=cached;readyChart();$('chartMessage').hidden=true;$('chartStatus').textContent=chartStatusText();renderFeedTiming(m);renderQuote();renderMarketDetails(m);return;}
  if(changed)chartMessage('Loading market candles',`Connecting to ${m.symbol} · ${INTERVALS.find(x=>x[0]===interval)[1]}…`);
  $('chartStatus').textContent=chartData?'Refreshing chart snapshot':'Loading market data';
  const timeout=setTimeout(()=>controller.abort(),25000);
  try{
   const result=await MarketData.request(m,interval,{signal:controller.signal});
   if(version!==chartVersion)return;
   chartData={...result,key,receivedAt:Date.now()};chartCache.set(key,chartData);
   if(chartCache.size>80)chartCache.delete(chartCache.keys().next().value);
   readyChart();$('chartMessage').hidden=true;$('chartStatus').textContent=chartStatusText();renderFeedTiming(m);renderQuote();renderMarketDetails(m);
  }finally{clearTimeout(timeout);}
 }catch(error){
  if(version!==chartVersion)return;chartFailure=error.message||'Chart data unavailable';
  if(chartData){$('chartMessage').hidden=true;$('chartStatus').textContent=chartStatusText();renderQuote();renderFeedTiming(m);}
  else{$('chartStatus').textContent='Data unavailable';chartMessage('Chart data unavailable',chartFailure+' Check your connection or retry.',true);renderFeedTiming(m);renderQuote();}
 }finally{if(version===chartVersion)chartBusy=false;}
}
function chartRefreshMs(m){return /^(KRAKEN|BINANCE):/.test(m.symbol)?20000:60000;}
function updateDrawingStatus(){const s=chartEngine?.getSnapshot();if(!s)return;const label=(s.drawings||0)+' line'+(s.drawings===1?'':'s')+(s.pending?' · finish trend or Esc':'');if($('drawingStatus').textContent!==label)$('drawingStatus').textContent=label;$('undoChart').disabled=!s.canUndo;}
function setDrawMode(mode){chartEngine?.setMode(mode);document.querySelectorAll('[data-draw-mode]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.drawMode===mode)));updateDrawingStatus();}
function undoChartAction(showEmpty=false){
 const pending=chartEngine?.getSnapshot().pending,undone=chartEngine?.undo?.()||false;
 rememberChartWorkspace(true);setDrawMode('pan');if(undone)toast(pending?'Unfinished trend cancelled.':'Last drawing change undone.');else if(showEmpty)toast('No chart drawing changes to undo.');return undone;
}
function handleChartKeyDown(e){
 const active=document.activeElement,editing=['INPUT','TEXTAREA','SELECT'].includes(active?.tagName)||active?.isContentEditable;
 const openDialog=['alertsDialog','indicatorDialog','marketsDialog','aboutDialog'].find(id=>$(id).open);
 if(e.key==='Escape'){
  if(openDialog){e.preventDefault();$(openDialog).close();return;}
  if($('app').classList.contains('drawer-open')){e.preventDefault();closeDrawer();return;}
  if(document.fullscreenElement){e.preventDefault();document.exitFullscreen();return;}
  if($('mainChart').classList.contains('focus-mode')){e.preventDefault();$('mainChart').classList.remove('focus-mode');return;}
  if(editing)return;e.preventDefault();undoChartAction();return;
 }
 if((e.ctrlKey||e.metaKey)&&!e.shiftKey&&e.key.toLowerCase()==='z'){
  if(editing||openDialog)return;e.preventDefault();undoChartAction();return;
 }
 if(e.key==='/'&&!e.ctrlKey&&!e.metaKey&&!editing&&!openDialog){e.preventDefault();if(matchMedia('(max-width:650px)').matches)openDrawer();else $('search').focus();}
}
function openIndicatorSettings(){
 indicatorDraftBasis=null;fillIndicatorInputs(state.indicatorSettings);$('strategyPreset').value=state.strategyPreset;renderPresetPreview();$('indicatorError').textContent='';$('indicatorDialog').showModal();
}
$('indicatorSettingsBtn').onclick=openIndicatorSettings;$('closeIndicatorSettings').onclick=()=>$('indicatorDialog').close();
$('strategyPreset').onchange=()=>{const selected=$('strategyPreset').value,preset=STRATEGY_PRESETS[selected];indicatorDraftBasis=preset?selected:null;if(preset)fillIndicatorInputs(preset.settings);renderPresetPreview();};
$('indicatorForm').addEventListener('input',e=>{if(e.target.tagName==='INPUT'){$('strategyPreset').value='custom';renderPresetPreview();}});
$('resetTrendDefaults').onclick=()=>{applyStrategyPreset('trend');$('indicatorDialog').close();toast('Daily trend defaults applied.');};
$('indicatorForm').onsubmit=e=>{
 e.preventDefault();try{
  const inputs=indicatorInputs({sma:Number($('inputSma').value),emas:$('inputEmas').value.split(',').map(n=>Number(n.trim())),bb:Number($('inputBb').value),bbMult:Number($('inputBbMult').value),rsi:Number($('inputRsi').value),atr:Number($('inputAtr').value),macdFast:Number($('inputMacdFast').value),macdSlow:Number($('inputMacdSlow').value),macdSignal:Number($('inputMacdSignal').value)});
  const selected=$('strategyPreset').value,preset=STRATEGY_PRESETS[selected];
  if(preset&&strategyInputsMatch(inputs,preset.settings))applyStrategyPreset(selected);
  else{rememberChartWorkspace(true);const basis=STRATEGY_PRESETS[indicatorDraftBasis];if(basis){state.interval=basis.interval;state.studies=[...basis.studies];state.volume=basis.volume;}state.indicatorSettings=inputs;state.strategyPreset='custom';save();renderControls();loadChart();}
  $('indicatorDialog').close();
 }catch(error){$('indicatorError').textContent=error.message;}
};
$('resetChartView').onclick=()=>chartEngine?.resetView();$('clearDrawings').onclick=()=>{chartEngine?.clearDrawings();rememberChartWorkspace(true);updateDrawingStatus();};
$('undoChart').onclick=()=>undoChartAction(true);
$('futureSpace').onchange=()=>{state.futureSpace=Number($('futureSpace').value);chartEngine?.setFutureSpace(state.futureSpace);save();};
document.addEventListener('pointerup',e=>{if(e.target.closest?.('#chartHost')){rememberChartWorkspace(true);updateDrawingStatus();}});
window.addEventListener('pagehide',()=>rememberChartWorkspace(true));
$('chartScale').onchange=()=>chartEngine?.setScale($('chartScale').value);
$('saveChartImage').onclick=()=>{if(!chartData)return;const a=document.createElement('a');a.href=chartEngine.toDataURL();a.download=current().ticker+'-chart.png';document.body.append(a);a.click();a.remove();};
