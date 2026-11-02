// Reproducible close-only experiment. No forecasts, positions or returns are implied.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';

export const EXPECTED_PROTOCOL_SHA='6ff83408f77b67f4587c4c97d754153160ec84ddd300843e0520633441399278';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const sha=value=>crypto.createHash('sha256').update(value).digest('hex');
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const nativeSource=fs.readFileSync(path.join(root,'src/native-chart.js'),'utf8');
const nativeContext=vm.createContext({console,Intl,Date,Math,Number,Set,Map,Array,JSON});
vm.runInContext(nativeSource+'\nglobalThis.studyIndicators=NativeMarketChart.indicators;',nativeContext);
export const indicators=nativeContext.studyIndicators;

export function validateBars(bars){
 if(!Array.isArray(bars)||bars.length<2)throw Error('At least two daily bars are required.');
 const dates=new Set();
 bars.forEach((b,index)=>{
  if(!b||!/^\d{4}-\d{2}-\d{2}$/.test(b.date)||!Number.isFinite(Date.parse(b.date))||![b.t,b.o,b.h,b.l,b.c,b.v].every(finite)||b.t<=0||b.l<=0||b.h<Math.max(b.o,b.c)||b.l>Math.min(b.o,b.c)||b.v<0||dates.has(b.date)||(index&&bars[index-1].t>=b.t)||(index&&bars[index-1].date>=b.date))throw Error('Invalid or non-chronological daily bar at index '+index+'.');
  if(new Date(b.t*1000).toISOString().slice(0,10)!==b.date)throw Error('Daily date/timestamp mismatch at index '+index+'.');
  dates.add(b.date);
 });return bars;
}

export function zigzag(bars,threshold=.15){
 if(!finite(threshold)||threshold<=0||threshold>=1)throw Error('A directional-change threshold must be between zero and one.');
 if(!bars.length)return {threshold,pivots:[],pending:null};
 if(!finite(bars[0].c)||bars[0].c<=0)throw Error('ZigZag requires positive finite closes.');
 const pivots=[];let trend=0,minIndex=0,maxIndex=0,extremeIndex=0;
 const rose=(price,reference)=>(price-reference)/reference+threshold*Number.EPSILON*8>=threshold;
 const fell=(price,reference)=>(reference-price)/reference+threshold*Number.EPSILON*8>=threshold;
 const record=(index,confirmedIndex,type)=>({index,date:bars[index].date,type,direction:type==='trough'?'bull':'bear',price:bars[index].c,confirmedIndex,confirmedDate:bars[confirmedIndex].date,confirmationPrice:bars[confirmedIndex].c});
 for(let i=1;i<bars.length;i++){
  const price=bars[i].c;
  if(!finite(price)||price<=0)throw Error('ZigZag requires positive finite closes.');
  if(!trend){
   if(price<bars[minIndex].c)minIndex=i;if(price>bars[maxIndex].c)maxIndex=i;
   if(rose(price,bars[minIndex].c)){pivots.push(record(minIndex,i,'trough'));trend=1;extremeIndex=i;}
   else if(fell(price,bars[maxIndex].c)){pivots.push(record(maxIndex,i,'peak'));trend=-1;extremeIndex=i;}
  }else if(trend===1){
   if(price>bars[extremeIndex].c)extremeIndex=i;
   if(fell(price,bars[extremeIndex].c)){pivots.push(record(extremeIndex,i,'peak'));trend=-1;extremeIndex=i;}
  }else{
   if(price<bars[extremeIndex].c)extremeIndex=i;
   if(rose(price,bars[extremeIndex].c)){pivots.push(record(extremeIndex,i,'trough'));trend=1;extremeIndex=i;}
  }
 }
 const pending=trend?{type:trend===1?'peak':'trough',index:extremeIndex,date:bars[extremeIndex].date,price:bars[extremeIndex].c,trend:trend===1?'bull':'bear',confirmed:false}:{type:'undetermined',minIndex,maxIndex,minPrice:bars[minIndex].c,maxPrice:bars[maxIndex].c,confirmed:false};
 return {threshold,pivots,pending};
}

export function statesToSignals(bars,desired,configId='test'){
 let state=0;const signals=[];
 desired.forEach((next,index)=>{if(next!==1&&next!==-1)return;if(!state){state=next;return;}if(next===state)return;state=next;signals.push({configId,index,date:bars[index].date,direction:next===1?'bull':'bear',close:bars[index].c});});
 return signals;
}

export function calculateSeries(bars,config){
 const closes=bars.map(b=>b.c),emaPair=config.ema,macdConfig=config.macd;
 return {emaFast:emaPair?Array.from(indicators.ema(closes,emaPair[0])):null,emaSlow:emaPair?Array.from(indicators.ema(closes,emaPair[1])):null,macd:macdConfig?Object.fromEntries(Object.entries(indicators.macd(closes,...macdConfig)).map(([key,value])=>[key,Array.from(value)])):null};
}

export function generateSignals(bars,config){
 const series=calculateSeries(bars,config),desired=bars.map((_,i)=>{
  const diff=series.emaFast&&finite(series.emaFast[i])&&finite(series.emaSlow[i])?series.emaFast[i]-series.emaSlow[i]:null,hist=series.macd?.histogram[i];
  if(config.kind==='ema')return diff===null?0:Math.sign(diff);
  if(config.kind==='macd')return finite(hist)?Math.sign(hist):0;
  if(config.kind==='hist-turn'){
   if(i<3)return 0;const h=series.macd.histogram;
   if(![h[i],h[i-1],h[i-2],h[i-3]].every(finite))return 0;
   return h[i]>h[i-1]&&h[i-1]>h[i-2]&&h[i-2]>h[i-3]?1:h[i]<h[i-1]&&h[i-1]<h[i-2]&&h[i-2]<h[i-3]?-1:0;
  }
  if(config.kind!=='combined')throw Error('Unknown signal kind '+config.kind);
  if(diff===null||!finite(hist))return 0;
  return diff>0&&hist>0?1:diff<0&&hist<0?-1:0;
 });return {signals:statesToSignals(bars,desired,config.id),desired,series};
}

export function matchSignals(signals,pivots,{leadBars=10,lagBars=20}={}){
 if(!Number.isInteger(leadBars)||leadBars<0||!Number.isInteger(lagBars)||lagBars<0)throw Error('Matching windows must be nonnegative integer bar counts.');
 const matched=[];
 for(const direction of ['bull','bear']){
  const ss=signals.filter(s=>s.direction===direction).sort((a,b)=>a.index-b.index),pp=pivots.filter(p=>p.direction===direction).sort((a,b)=>a.index-b.index);
  const stride=pp.length+1,size=(ss.length+1)*stride,count=new Int32Array(size),cost=new Int32Array(size),choice=new Uint8Array(size);
  for(let i=ss.length-1;i>=0;i--)for(let j=pp.length-1;j>=0;j--){
   const here=i*stride+j,skipSignal=(i+1)*stride+j,skipPivot=i*stride+j+1;
   let bestCount=count[skipSignal],bestCost=cost[skipSignal],bestChoice=1,bestPriority=1;
   const offer=(n,c,action,priority)=>{if(n>bestCount||(n===bestCount&&(c<bestCost||(c===bestCost&&priority<bestPriority)))){bestCount=n;bestCost=c;bestChoice=action;bestPriority=priority;}};
   offer(count[skipPivot],cost[skipPivot],2,2);
   const lag=ss[i].index-pp[j].index;
   if(lag>=-leadBars&&lag<=lagBars){const next=(i+1)*stride+j+1;offer(count[next]+1,cost[next]+Math.abs(lag),3,0);}
   count[here]=bestCount;cost[here]=bestCost;choice[here]=bestChoice;
  }
  let i=0,j=0;while(i<ss.length&&j<pp.length){const action=choice[i*stride+j];if(action===3){const signal=ss[i++],pivot=pp[j++],lagBars=signal.index-pivot.index;matched.push({signal,pivot,lagBars,confirmationLagBars:signal.index-pivot.confirmedIndex,prePivot:lagBars<0});}else if(action===1)i++;else j++;}
 }
 return matched.sort((a,b)=>a.pivot.index-b.pivot.index||a.signal.index-b.signal.index);
}

const median=values=>{if(!values.length)return null;const sorted=[...values].sort((a,b)=>a-b),middle=Math.floor(sorted.length/2);return sorted.length%2?sorted[middle]:(sorted[middle-1]+sorted[middle])/2;};
const summarizeLags=matches=>({medianPivotLagBars:median(matches.map(m=>m.lagBars)),medianAbsPivotLagBars:median(matches.map(m=>Math.abs(m.lagBars))),medianConfirmationLagBars:median(matches.map(m=>m.confirmationLagBars)),minPivotLagBars:matches.length?Math.min(...matches.map(m=>m.lagBars)):null,maxPivotLagBars:matches.length?Math.max(...matches.map(m=>m.lagBars)):null});

export function scorePeriod(bars,signals,pivots,period,matching={leadBars:10,lagBars:20}){
 const startIndex=bars.findIndex(b=>b.date>=period.start);let endIndex=-1;for(let i=bars.length-1;i>=0;i--)if(bars[i].date<=period.end){endIndex=i;break;}
 if(startIndex<0||endIndex<startIndex)throw Error('No bars in evaluation period '+period.start+'..'+period.end);
 const windowPivots=pivots.filter(p=>p.index>=startIndex&&p.index<=endIndex),eligiblePivots=windowPivots.filter(p=>p.index-matching.leadBars>=startIndex&&p.index+matching.lagBars<=endIndex&&p.confirmedIndex<=endIndex),excludedPivots=windowPivots.filter(p=>!eligiblePivots.includes(p)),periodSignals=signals.filter(s=>s.index>=startIndex&&s.index<=endIndex),matches=matchSignals(periodSignals,eligiblePivots,matching);
 const days=(Date.parse(bars[endIndex].date)-Date.parse(bars[startIndex].date))/86400000+1,years=days/365.2425;
 const precision=periodSignals.length?matches.length/periodSignals.length:null,recall=eligiblePivots.length?matches.length/eligiblePivots.length:null;
 const pre=matches.filter(m=>m.prePivot).length;
 const metrics={start:bars[startIndex].date,end:bars[endIndex].date,bars:endIndex-startIndex+1,calendarYears:years,signalCount:periodSignals.length,signalsPerYear:periodSignals.length/years,eligiblePivots:eligiblePivots.length,matchedPivots:matches.length,precision,recall,f1:precision===null||recall===null?null:precision+recall?2*precision*recall/(precision+recall):0,unmatchedSignals:periodSignals.length-matches.length,unmatchedSignalsPerYear:(periodSignals.length-matches.length)/years,prePivotMatched:pre,prePivotRecall:eligiblePivots.length?pre/eligiblePivots.length:null,prePivotPrecision:periodSignals.length?pre/periodSignals.length:null,atOrAfterPivotMatched:matches.length-pre,excludedBoundaryPivots:excludedPivots.length,excludedPivotDates:excludedPivots.map(p=>p.date),...summarizeLags(matches),byDirection:{}};
 for(const direction of ['bull','bear']){const sig=periodSignals.filter(s=>s.direction===direction),piv=eligiblePivots.filter(p=>p.direction===direction),m=matches.filter(x=>x.signal.direction===direction);metrics.byDirection[direction]={signals:sig.length,pivots:piv.length,matches:m.length,precision:sig.length?m.length/sig.length:null,recall:piv.length?m.length/piv.length:null,prePivotMatched:m.filter(x=>x.prePivot).length,...summarizeLags(m)};}
 return {metrics,matches,signals:periodSignals,eligiblePivots,excludedPivots};
}

export function makeConfigurations(protocol){
 const candidates=[];
 for(const ema of protocol.emaPairs)for(const macd of protocol.macdConfigs)candidates.push({id:`ema${ema.join('_')}_macd${macd.join('_')}`,kind:'combined',ema:[...ema],macd:[...macd],label:`EMA ${ema.join('/')} + MACD ${macd.join('/')}`});
 if(candidates.length!==protocol.candidateCount)throw Error('Candidate count does not match protocol.');
 const controls=[
  {id:'control_macd_12_26_9',kind:'macd',macd:[12,26,9],label:'MACD12/26/9 signal crossover only'},
  {id:'control_ema_20_50',kind:'ema',ema:[20,50],label:'EMA20/50 crossover only'},
  {id:'control_ema_50_200',kind:'ema',ema:[50,200],label:'EMA50/200 crossover only'},
  {id:'control_default',kind:'combined',ema:[20,50],macd:[12,26,9],label:'Default EMA20/50 + MACD12/26/9'},
  {id:'control_hist_turn_3',kind:'hist-turn',macd:[12,26,9],label:'MACD12/26/9 histogram rising/falling for three consecutive changes'}
 ];return {candidates,controls};
}

const rankRecords=records=>[...records].sort((a,b)=>b.metrics.f1-a.metrics.f1||a.metrics.unmatchedSignalsPerYear-b.metrics.unmatchedSignalsPerYear||(a.metrics.medianAbsPivotLagBars??Infinity)-(b.metrics.medianAbsPivotLagBars??Infinity)||(a.id<b.id?-1:a.id>b.id?1:0));
export function selectConfiguration(training,validation,settings){
 const allowed=record=>finite(record.metrics.f1)&&record.metrics.signalsPerYear<=settings.researchMaxFlipsPerYear+1e-12;
 const trainRanking=rankRecords(training.filter(allowed)),shortlist=trainRanking.slice(0,settings.shortlist),ids=new Set(shortlist.map(r=>r.id)),validationRanking=rankRecords(validation.filter(record=>ids.has(record.id)&&allowed(record))),chosen=validationRanking[0]||null;
 return {status:chosen?'selected':'no eligible candidate',selectedId:chosen?.id||null,selectedConfig:chosen?.config||null,shortlistIds:shortlist.map(r=>r.id),trainRanking:trainRanking.map(r=>r.id),validationRanking:validationRanking.map(r=>r.id),reason:chosen?'Training shortlist, then validation-only selection under frozen signal-rate guard.':'No candidate met the fixed selection requirements; the guard was not relaxed.',holdoutUsedForSelection:false};
}

export function warmupComparison(bars,config){
 if(!config)return null;const tail=bars.slice(-500),all=generateSignals(bars,config),short=generateSignals(tail,config),at=bars.length-1,last=tail.length-1,values=[];
 const add=(name,period,full,truncated)=>values.push({indicator:name,period,fullHistory:full,latest500:truncated,difference:finite(full)&&finite(truncated)?truncated-full:null,relativePercent:finite(full)&&full!==0&&finite(truncated)?(truncated-full)/Math.abs(full)*100:null});
 add('EMA fast',config.ema?.[0],all.series.emaFast?.[at]??null,short.series.emaFast?.[last]??null);add('EMA slow',config.ema?.[1],all.series.emaSlow?.[at]??null,short.series.emaSlow?.[last]??null);
 for(const key of ['line','signal','histogram'])add('MACD '+key,config.macd,all.series.macd?.[key][at]??null,short.series.macd?.[key][last]??null);
 let compared=0,differentDesired=0;for(let i=Math.max(0,last-199);i<=last;i++){compared++;if(all.desired[bars.length-tail.length+i]!==short.desired[i])differentDesired++;}
 return {date:bars[at].date,fullBars:bars.length,truncatedBars:tail.length,values,last200DesiredComparisons:compared,last200DifferentDesired:differentDesired,note:'Same completed date and native formulas; this isolates finite-history seeding, not remote provider revisions or the current forming bar.'};
}

export function performStudy(bars,protocol,{onSelection=()=>{},onHoldoutStart=()=>{}}={}){
 validateBars(bars);const {candidates,controls}=makeConfigurations(protocol),calculations=new Map([...candidates,...controls].map(config=>[config.id,generateSignals(bars,config)]));
 const benchmarks=new Map([protocol.threshold,...protocol.sensitivityThresholds].map(threshold=>[threshold,zigzag(bars,threshold)])),main=benchmarks.get(protocol.threshold),matching=protocol.matching;
 const record=(config,period,benchmark=main,detail=false)=>{const score=scorePeriod(bars,calculations.get(config.id).signals,benchmark.pivots,period,matching);return {id:config.id,config,metrics:score.metrics,...(detail?{matches:score.matches}:{})};};
 const training=candidates.map(config=>record(config,protocol.periods.train)),validation=candidates.map(config=>record(config,protocol.periods.validation)),selection=selectConfiguration(training,validation,protocol.selection);
 onSelection(selection); // Parent/CLI writes this before any holdout score is computed.
 onHoldoutStart();
 const chosen=selection.selectedId?candidates.find(c=>c.id===selection.selectedId):null,finalConfigs=[...(chosen?[chosen]:[]),...controls],holdout=finalConfigs.map(config=>record(config,protocol.periods.holdout,main,true));
 const sensitivity=protocol.sensitivityThresholds.map(threshold=>({threshold,holdout:finalConfigs.map(config=>record(config,protocol.periods.holdout,benchmarks.get(threshold),true))}));
 return {configurations:{candidates,controls},training,validation,selection,holdout,sensitivity,warmupComparison:warmupComparison(bars,chosen),pendingExtremes:[...benchmarks].map(([threshold,data])=>({threshold,pending:data.pending})),benchmarks,calculations};
}

const csv=(rows,columns)=>[columns.join(','),...rows.map(row=>columns.map(key=>{const value=row[key]??'';return '"'+String(value).replaceAll('"','""')+'"';}).join(','))].join('\n')+'\n';
function main(){
 const args=process.argv.slice(2),get=flag=>args[args.indexOf(flag)+1];
 if(!['--input','--protocol','--out'].every(flag=>args.includes(flag)&&args[args.indexOf(flag)+1]))throw Error('Usage: node research/research-amzn-study.mjs --input bars.json --protocol protocol.json --out fresh-directory');
 const inputPath=path.resolve(get('--input')),protocolPath=path.resolve(get('--protocol')),out=path.resolve(get('--out'));
 if(fs.existsSync(out))throw Error('Refusing to overwrite existing experiment output '+out);
 fs.mkdirSync(out,{recursive:true});
 try{
  const inputBytes=fs.readFileSync(inputPath),protocolBytes=fs.readFileSync(protocolPath),protocol=JSON.parse(protocolBytes),bars=JSON.parse(inputBytes);
  if(sha(protocolBytes)!==EXPECTED_PROTOCOL_SHA)throw Error('Protocol SHA does not match the frozen study protocol.');
  if(sha(inputBytes)!==protocol.dataSha256)throw Error('Input SHA does not match the admitted daily data.');
  const identities={protocolSha256:sha(protocolBytes),dataSha256:sha(inputBytes),nativeChartSha256:sha(nativeSource),runnerSha256:sha(fs.readFileSync(fileURLToPath(import.meta.url))),node:process.version,inputPath,protocolPath,sourceFunction:'NativeMarketChart.indicators.ema/macd'};
  fs.writeFileSync(path.join(out,'source-identity.json'),JSON.stringify(identities,null,2)+'\n');
  let selectionWrittenAt,holdoutEvaluationStartedAt;
  const result=performStudy(bars,protocol,{onSelection:selection=>{selectionWrittenAt=new Date().toISOString();fs.writeFileSync(path.join(out,'selection.json'),JSON.stringify({writtenAt:selectionWrittenAt,identities,...selection},null,2)+'\n');},onHoldoutStart:()=>{holdoutEvaluationStartedAt=new Date().toISOString();}});
  const {benchmarks,calculations,...serializable}=result;
  const metadata={symbol:protocol.symbol,createdAt:new Date().toISOString(),dataFirst:bars[0].date,dataLast:bars.at(-1).date,dataBars:bars.length,selectionWrittenAt,holdoutEvaluationStartedAt,annualization:'Inclusive actual first-to-last calendar span / 365.2425',identities,limitations:protocol.limits};
  fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({metadata,...serializable},null,2)+'\n');
  const signalRows=[...calculations].flatMap(([modelId,calculation])=>calculation.signals.map(signal=>({modelId,...signal})));
  fs.writeFileSync(path.join(out,'signals.csv'),csv(signalRows,['modelId','index','date','direction','close']));
  const pivotRows=[...benchmarks].flatMap(([threshold,benchmark])=>benchmark.pivots.map(pivot=>({threshold,...pivot})));
  fs.writeFileSync(path.join(out,'pivots.csv'),csv(pivotRows,['threshold','type','direction','index','date','price','confirmedIndex','confirmedDate','confirmationPrice']));
  const matchRows=[{threshold:protocol.threshold,holdout:result.holdout},...result.sensitivity].flatMap(group=>group.holdout.flatMap(record=>record.matches.map(match=>({threshold:group.threshold,partition:'holdout',modelId:record.id,pivotType:match.pivot.type,pivotDate:match.pivot.date,confirmationDate:match.pivot.confirmedDate,signalDate:match.signal.date,lagBars:match.lagBars,confirmationLagBars:match.confirmationLagBars,prePivot:match.prePivot}))));
  fs.writeFileSync(path.join(out,'matches.csv'),csv(matchRows,['threshold','partition','modelId','pivotType','pivotDate','confirmationDate','signalDate','lagBars','confirmationLagBars','prePivot']));
  console.log(JSON.stringify({selected:result.selection,holdout:result.holdout.map(record=>({id:record.id,...record.metrics})),output:out},null,2));
 }catch(error){fs.writeFileSync(path.join(out,'failed.json'),JSON.stringify({at:new Date().toISOString(),error:error.stack},null,2)+'\n');throw error;}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main();
