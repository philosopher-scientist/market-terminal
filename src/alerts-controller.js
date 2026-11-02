// Embedded alongside the app. Monitoring is page-owned; no service or account.
const ALERT_STORAGE_KEY='market-terminal-alerts-v1';
const emptyAlerts=()=>({version:1,rules:[],history:[],paused:false,sound:false,desktop:false,tone:'chime',unread:0});
function validateAlertStore(input){
 if(!input||input.version!==1)throw Error('Unsupported alerts backup. Expected version 1.');
 const rules=MarketAlerts.validateRules(input.rules);
 if(!Array.isArray(input.history)||input.history.length>100||['paused','sound','desktop'].some(k=>typeof input[k]!=='boolean')||!['chime','bell','pulse'].includes(input.tone)||!Number.isInteger(input.unread)||input.unread<0||input.unread>1000)throw Error('Invalid alert preferences or history.');
 const history=input.history.map(item=>{
  if(!item||!['id','symbol','label','text','source','delay'].every(k=>typeof item[k]==='string'&&item[k].length<=600)||!Number.isFinite(item.at)||item.at<=0||item.at>8640000000000000||!Number.isFinite(item.sourceAt)||item.sourceAt<=0||item.sourceAt>8640000000000000||!Number.isFinite(item.price)||item.price<=0||typeof item.test!=='boolean')throw Error('Invalid alert history entry.');
  return Object.fromEntries(['id','symbol','label','text','source','delay','at','sourceAt','price','test'].map(k=>[k,item[k]]));
 });return {version:1,rules,history,paused:input.paused,sound:input.sound,desktop:input.desktop,tone:input.tone,unread:input.unread};
}
let alertState=emptyAlerts(),alertStorageIssue='';
try{const raw=localStorage.getItem(ALERT_STORAGE_KEY);if(raw)alertState=validateAlertStore(JSON.parse(raw));}catch{alertStorageIssue='Saved alerts could not be read. A valid market-list JSON backup can restore them.';}
let alertBusy=false,alertLastAttempt=0,alertConfigVersion=0,alertEditingId=null,alertStatuses=new Map(),alertAudio=null,alertCompletion=Promise.resolve(),alertFeedCache=new Map();
function saveAlerts(){try{localStorage.setItem(ALERT_STORAGE_KEY,JSON.stringify(alertState));return true;}catch{alertStorageIssue='Browser storage is unavailable. Export JSON to keep your alerts.';return false;}}
function alertsBackup(){return validateAlertStore(alertState);}
function restoreAlerts(input){alertState=validateAlertStore(input);alertConfigVersion++;alertStatuses.clear();saveAlerts();renderAlerts();}
function alertDescription(rule){return rule.type==='swing'?`${rule.direction==='either'?'Either direction':rule.direction==='up'?'Rise':'Fall'} ≥ ${rule.threshold}% / ${rule.windowHours}h`:`Price ${rule.type==='above'?'≥':'≤'} ${rule.threshold}`;}
function alertMessage(text,error=false){$('alertsMessage').textContent=text;$('alertsMessage').className='manager-status'+(error?' error':'');}
function alertSourceText(data){return data.provider==='yahoo'?(typeof data.delayMinutes==='number'?data.delayMinutes+' min reported delay':'delay unspecified'):'exchange snapshots; latency unspecified';}
function alertSnapshot(data,receivedAt=Date.now()){
 const last=data.bars?.[data.bars.length-1];if(!last)throw Error('No hourly candles returned.');
 let at,priceValue;
 if(data.provider==='yahoo'){
  if(!Number.isFinite(data.quoteTime)||!Number.isFinite(data.quote)||data.quote<=0)throw Error('The source did not supply a quote timestamp; alarm evaluation is waiting.');
  at=data.quoteTime*1000;priceValue=data.quote;
 }else{
  if(last.t*1000>receivedAt+60000||last.t*1000+3600000<receivedAt-600000)throw Error('No current hourly exchange candle; waiting for fresh data.');
  at=receivedAt;priceValue=last.c;
 }
 // OHLC timestamps mark opening, while completed closes belong at the hour end.
 const bars=data.bars.filter(b=>(b.t+3600)*1000<=at).map(b=>({t:b.t+3600,c:b.c}));
 return {price:priceValue,at,receivedAt,bars};
}
function formatAlertTime(ms){return new Date(ms).toISOString().slice(0,19).replace('T',' ')+' UTC';}
function renderAlerts(){
 const active=alertState.rules.filter(r=>r.enabled).length;
 $('alertsBtn').textContent='Alerts'+(alertState.unread?' · '+alertState.unread:active?' ('+active+')':'');
 $('alertsBtn').classList.toggle('has-alerts',alertState.unread>0);
 $('alertsSummary').textContent=alertState.paused?'All alarms paused.':`${active} enabled alarm${active===1?'':'s'} · ${alertBusy?'checking…':'checks every 60s while this page runs'}`;
 $('pauseAllAlerts').textContent=alertState.paused?'Resume all':'Pause all';$('checkAlertsNow').disabled=alertBusy;
 $('alertsStorageNotice').textContent=alertStorageIssue;
 $('alertSound').checked=alertState.sound;$('alertDesktop').checked=alertState.desktop;$('alertTone').value=alertState.tone;
 const audioStatus=alertState.sound?(alertAudio?.state==='running'?'Sound ready in this tab.':'Click Enable / test sound to arm audio in this tab.'):'Sound off.';
 const permission=typeof Notification==='undefined'?'unsupported':Notification.permission;
 $('alertDeliveryStatus').textContent=audioStatus+' Desktop notifications: '+permission+(alertState.desktop?' (selected).':'.')+' In-page history always works.';
 $('alertsRules').innerHTML=alertState.rules.length?alertState.rules.map(rule=>{
  const present=MARKETS.some(m=>m.id===rule.symbol),status=!present?'Market removed · monitoring paused':!rule.enabled?(rule.lastTriggeredAt&&!rule.repeat?'Triggered · rearm to enable':'Paused'):alertState.paused?'All alarms paused':alertStatuses.get(rule.id)||'Waiting for first check';
  return `<div class="alert-rule"><div><strong>${escapeHTML(rule.label||alertDescription(rule))}</strong><small>${escapeHTML(rule.symbol)} · ${escapeHTML(alertDescription(rule))} · ${rule.repeat?'Repeating':'Once'}</small><p>${escapeHTML(status)}</p></div><div class="alert-rule-actions"><button type="button" data-alert-action="edit" data-alert-id="${rule.id}">Edit</button><button type="button" data-alert-action="toggle" data-alert-id="${rule.id}">${rule.enabled?'Pause':'Enable'}</button><button type="button" data-alert-action="rearm" data-alert-id="${rule.id}">Rearm</button><button type="button" data-alert-action="remove" data-alert-id="${rule.id}">Remove</button></div></div>`;
 }).join(''):'<p class="fine">No alarms yet. Add a price level or a major-swing rule above.</p>';
 $('alertsHistory').innerHTML=alertState.history.length?alertState.history.map(item=>`<article class="alert-history"><strong>${item.test?'TEST · ':''}${escapeHTML(item.label||item.symbol)}</strong><p>${escapeHTML(item.text)}</p><small>${escapeHTML(formatAlertTime(item.at))} · ${escapeHTML(item.source)} · ${escapeHTML(item.delay)}<br>Source observation ${escapeHTML(formatAlertTime(item.sourceAt))}</small></article>`).join(''):'<p class="fine">No alerts triggered yet.</p>';
 const latest=alertState.history[0];$('alertBanner').hidden=!latest||!alertState.unread;if(latest)$('alertBannerText').textContent=(latest.test?'TEST · ':'')+latest.text;
}
function resetAlertForm(){alertEditingId=null;$('alertForm').reset();$('alertSymbol').value=current().id;$('alertType').value='above';$('alertWindow').value='24';$('alertDirection').value='either';$('alertRepeat').value='once';$('alertSubmit').textContent='Add alarm';$('cancelAlertEdit').hidden=true;updateAlertForm();}
function updateAlertForm(){const swing=$('alertType').value==='swing';$('alertSwingOptions').hidden=!swing;$('alertThresholdLabel').textContent=swing?'Swing threshold (%)':'Price level (quote currency)';$('alertThreshold').placeholder=swing?'5':'e.g. 250';$('alertThreshold').max=swing?'1000':'999999999999';}
function openAlerts(){closeDrawer();$('alertSymbol').innerHTML=MARKETS.map(m=>`<option value="${escapeHTML(m.id)}">${escapeHTML(m.ticker+' · '+m.name+' · '+m.symbol.split(':')[0])}</option>`).join('');resetAlertForm();alertState.unread=0;saveAlerts();alertMessage('');renderAlerts();$('alertsDialog').showModal();}
function alertAction(action,id){
 const rule=alertState.rules.find(r=>r.id===id);if(!rule)return;
 if(action==='edit'){
  alertEditingId=id;for(const [node,key] of [['alertSymbol','symbol'],['alertType','type'],['alertThreshold','threshold'],['alertWindow','windowHours'],['alertDirection','direction'],['alertLabel','label']])$(node).value=String(rule[key]);
  $('alertRepeat').value=rule.repeat?'repeat':'once';$('alertSubmit').textContent='Save & rearm';$('cancelAlertEdit').hidden=false;updateAlertForm();$('alertThreshold').focus();return;
 }
 if(action==='remove')alertState.rules=alertState.rules.filter(r=>r.id!==id);
 if(action==='toggle')alertState.rules=alertState.rules.map(r=>r.id===id?(r.enabled?{...r,enabled:false}:MarketAlerts.reset(r)):r);
 if(action==='rearm')alertState.rules=alertState.rules.map(r=>r.id===id?MarketAlerts.reset(r):r);
 if(alertEditingId===id)resetAlertForm();alertStatuses.delete(id);alertConfigVersion++;saveAlerts();renderAlerts();if(action!=='remove')refreshAlerts(true);
}
function persistAlertEvent(event){alertState.history.unshift(event);alertState.history=alertState.history.slice(0,100);alertState.unread=Math.min(1000,alertState.unread+1);saveAlerts();renderAlerts();}
async function playAlertTone(){
 if(!alertState.sound)return;
 if(!alertAudio||alertAudio.state!=='running')throw Error('Sound is not armed. Click Enable / test sound in this tab.');
 const tones=alertState.tone==='bell'?[880]:alertState.tone==='pulse'?[660,660,660]:[660,880,1100];
 tones.forEach((hz,i)=>{const oscillator=alertAudio.createOscillator(),gain=alertAudio.createGain(),start=alertAudio.currentTime+i*.17;oscillator.frequency.value=hz;oscillator.type='sine';gain.gain.setValueAtTime(.0001,start);gain.gain.exponentialRampToValueAtTime(.12,start+.02);gain.gain.exponentialRampToValueAtTime(.0001,start+.28);oscillator.connect(gain);gain.connect(alertAudio.destination);oscillator.start(start);oscillator.stop(start+.3);});
}
function deliverAlert(event){
 toast((event.test?'TEST · ':'')+event.text);
 if(alertState.sound)playAlertTone().catch(error=>{alertMessage(error.message,true);renderAlerts();});
 if(alertState.desktop&&typeof Notification!=='undefined'&&Notification.permission==='granted')try{new Notification(event.test?'Market Terminal · test':'Market Terminal · '+event.symbol,{body:event.text,tag:event.id});}catch{alertMessage('Desktop delivery unavailable in this browser. The alert is saved in history.',true);}
}
async function refreshAlerts(force=false){
 if(alertBusy)return alertCompletion;
 if(alertState.paused||(!force&&Date.now()-alertLastAttempt<60000))return;
 const symbols=[...new Set(alertState.rules.filter(r=>r.enabled&&MARKETS.some(m=>m.id===r.symbol)).map(r=>r.symbol))];if(!symbols.length){renderAlerts();return;}
 alertBusy=true;let finish;alertCompletion=new Promise(resolve=>finish=resolve);alertLastAttempt=Date.now();const version=alertConfigVersion;let next=0;renderAlerts();
 const worker=async()=>{while(next<symbols.length){const symbol=symbols[next++];if(version!==alertConfigVersion||alertState.paused)break;
  const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),20000);
  try{
   const market=MARKETS.find(m=>m.id===symbol),cache=alertFeedCache.get(symbol)||chartCache.get(symbol+'|60');
   const data=cache&&Date.now()-cache.receivedAt<55000?cache:{...await MarketData.request(market,'60',{signal:controller.signal}),receivedAt:Date.now()};
   alertFeedCache.set(symbol,data);if(alertFeedCache.size>20)alertFeedCache.delete(alertFeedCache.keys().next().value);
   const receivedAt=data.receivedAt||Date.now(),snapshot=alertSnapshot(data,receivedAt);
   if(version!==alertConfigVersion||alertState.paused||!MARKETS.some(m=>m.id===symbol))continue;
   let changed=false;
   for(let i=0;i<alertState.rules.length;i++){
    const rule=alertState.rules[i];if(rule.symbol!==symbol||!rule.enabled)continue;
    const result=MarketAlerts.evaluate(rule,snapshot,Date.now());alertState.rules[i]=result.rule;changed ||= JSON.stringify(rule)!==JSON.stringify(result.rule);
    alertStatuses.set(rule.id,result.reason+' · '+alertSourceText(data)+' · source '+formatAlertTime(snapshot.at));
    if(result.triggered){
     const text=rule.symbol+' · '+alertDescription(rule)+' · '+(rule.type==='swing'?change(result.value)+'; ':'')+'price '+price(snapshot.price)+(data.currency?' '+data.currency:'');
     const event={id:rule.id+'-'+Date.now(),symbol:rule.symbol,label:rule.label,text,at:Date.now(),sourceAt:snapshot.at,price:snapshot.price,source:data.source,delay:alertSourceText(data),test:false};
     persistAlertEvent(event);deliverAlert(event);
    }
   }if(changed)saveAlerts();
  }catch(error){if(version===alertConfigVersion)for(const rule of alertState.rules.filter(r=>r.symbol===symbol))alertStatuses.set(rule.id,'Check unavailable · '+(error.message||'Source error'));}
  finally{clearTimeout(timeout);renderAlerts();}
 }};
 try{await Promise.all([worker(),worker()]);}finally{alertBusy=false;renderAlerts();finish();if(version!==alertConfigVersion&&!alertState.paused)refreshAlerts(true);}
}
function alertsTick(){if(!alertState.paused&&!alertBusy&&Date.now()-alertLastAttempt>=60000)refreshAlerts();}
$('alertsBtn').onclick=$('viewAlertBanner').onclick=openAlerts;$('closeAlerts').onclick=()=>$('alertsDialog').close();
$('dismissAlertBanner').onclick=()=>{alertState.unread=0;saveAlerts();renderAlerts();};
$('alertType').onchange=updateAlertForm;$('cancelAlertEdit').onclick=resetAlertForm;
$('majorSwingPreset').onclick=()=>{resetAlertForm();$('alertType').value='swing';$('alertThreshold').value='5';$('alertRepeat').value='repeat';updateAlertForm();alertMessage('5% in 24h, either direction. Adjust it, then Add alarm.');};
$('alertForm').onsubmit=e=>{
 e.preventDefault();try{
  const symbol=$('alertSymbol').value;if(!MARKETS.some(m=>m.id===symbol))throw Error('Choose a saved market.');MarketData.routeSymbol(symbol);
  const rule={id:alertEditingId||'alarm-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,8),symbol,label:$('alertLabel').value.trim(),type:$('alertType').value,threshold:Number($('alertThreshold').value),windowHours:Number($('alertWindow').value),direction:$('alertDirection').value,repeat:$('alertRepeat').value==='repeat',enabled:true,lastTriggeredAt:null,latched:false,lastObservedAt:null};
  alertState.rules=MarketAlerts.validateRules(alertEditingId?alertState.rules.map(r=>r.id===alertEditingId?rule:r):[...alertState.rules,rule]);alertConfigVersion++;saveAlerts();resetAlertForm();renderAlerts();alertMessage('Alarm saved. A condition already met on the first valid check can trigger immediately.');refreshAlerts(true);
 }catch(error){alertMessage(error.message,true);}
};
$('alertsRules').addEventListener('click',e=>{const button=e.target.closest('button[data-alert-action]');if(button)alertAction(button.dataset.alertAction,button.dataset.alertId);});
$('pauseAllAlerts').onclick=()=>{alertState.paused=!alertState.paused;alertConfigVersion++;saveAlerts();renderAlerts();if(!alertState.paused)refreshAlerts(true);};
$('checkAlertsNow').onclick=()=>refreshAlerts(true);
$('clearAlertHistory').onclick=()=>{alertState.history=[];alertState.unread=0;saveAlerts();renderAlerts();};
$('alertTone').onchange=()=>{alertState.tone=$('alertTone').value;saveAlerts();};
$('alertSound').onchange=()=>{alertState.sound=$('alertSound').checked;saveAlerts();renderAlerts();};
$('testAlertSound').onclick=async()=>{try{const Audio=window.AudioContext||window.webkitAudioContext;if(!Audio)throw Error('Web Audio is unavailable in this browser.');alertAudio ||= new Audio();await alertAudio.resume();if(alertAudio.state!=='running')throw Error('Audio remains blocked in this browser.');alertState.sound=true;saveAlerts();await playAlertTone();alertMessage('Test tone played; sound is ready in this tab.');}catch(error){alertMessage(error.message,true);}renderAlerts();};
$('alertDesktop').onchange=()=>{alertState.desktop=$('alertDesktop').checked;saveAlerts();renderAlerts();};
$('enableAlertNotifications').onclick=async()=>{try{if(typeof Notification==='undefined')throw Error('Desktop notifications are unavailable here.');const permission=await Notification.requestPermission();alertState.desktop=permission==='granted';saveAlerts();alertMessage(permission==='granted'?'Desktop notifications enabled.':'Notification permission '+permission+'. In-page alerts remain available.',permission!=='granted');}catch(error){alertMessage(error.message,true);}renderAlerts();};
$('testAlarm').onclick=()=>{const now=Date.now(),event={id:'test-'+now,symbol:current().symbol,label:'Test alarm',text:'Test alarm: in-page banner, history and selected delivery options.',at:now,sourceAt:now,price:1,source:'Local test · no market condition',delay:'not market data',test:true};persistAlertEvent(event);alertMessage('Test alarm recorded. This did not evaluate a market condition.');deliverAlert(event);};
