// Frozen, causal event study. Warnings are not trades; reused history is exploratory.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {isDeepStrictEqual} from 'node:util';
import {validateBars,zigzag,generateSignals,indicators} from './research-amzn-study.mjs';
import {rollingDivergence,confirmedPivotDivergence} from './research-divergence-engine.mjs';

export const PROTOCOL_SHA='537f207ae83cd4c46933c6774df423e05a8661767d313efdc1d72f4b269941bc';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const sha=x=>crypto.createHash('sha256').update(x).digest('hex');
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const median=xs=>{if(!xs.length)return null;const a=[...xs].sort((x,y)=>x-y),i=Math.floor(a.length/2);return a.length%2?a[i]:(a[i-1]+a[i])/2;};
export function validateLockedSelection(locked,protocol,sources,admittedBytes){
 if(locked?.identity?.protocolSha256!==PROTOCOL_SHA||!isDeepStrictEqual(locked.identity.sourceSha256,sources))throw Error('Locked selection source/protocol identity mismatch.');
 if(sha(admittedBytes)!==protocol.dataSha256||locked.identity.dataSha256!==protocol.dataSha256)throw Error('Admitted data SHA differs from the frozen protocol or selection.');
 if(locked.selectedId===null&&locked.selectedConfig===null)return true;
 const fixed=protocol.candidates.find(c=>c.id===locked.selectedId);
 if(!fixed||!isDeepStrictEqual(fixed,locked.selectedConfig)||locked.validationRanking?.[0]!==locked.selectedId)throw Error('Locked candidate/config does not match the protocol and selected validation rank.');
 return true;
}

export function matchWindow(signals,pivots,{minLag,maxLag}){
 if(!Number.isInteger(minLag)||!Number.isInteger(maxLag)||minLag>maxLag)throw Error('Invalid matching window.');
 const matches=[];
 for(const direction of ['bull','bear']){
  const ss=signals.filter(s=>s.direction===direction).sort((a,b)=>a.index-b.index),pp=pivots.filter(p=>p.direction===direction).sort((a,b)=>a.index-b.index),stride=pp.length+1,size=(ss.length+1)*stride,count=new Int32Array(size),cost=new Int32Array(size),choice=new Uint8Array(size);
  for(let i=ss.length-1;i>=0;i--)for(let j=pp.length-1;j>=0;j--){
   const at=i*stride+j,skip=(i+1)*stride+j;let n=count[skip],c=cost[skip],action=1,priority=1;
   const offer=(nn,cc,aa,pr)=>{if(nn>n||(nn===n&&(cc<c||(cc===c&&pr<priority)))){n=nn;c=cc;action=aa;priority=pr;}};
   const skipP=i*stride+j+1;offer(count[skipP],cost[skipP],2,2);
   const lag=ss[i].index-pp[j].index;if(lag>=minLag&&lag<=maxLag){const next=(i+1)*stride+j+1;offer(count[next]+1,cost[next]+Math.abs(lag),3,0);}
   count[at]=n;cost[at]=c;choice[at]=action;
  }
  let i=0,j=0;while(i<ss.length&&j<pp.length){const action=choice[i*stride+j];if(action===3){const signal=ss[i++],pivot=pp[j++];matches.push({signal,pivot,lagBars:signal.index-pivot.index});}else if(action===1)i++;else j++;}
 }
 return matches.sort((a,b)=>a.pivot.index-b.pivot.index);
}
export function scoreWindow(bars,signals,pivots,period,window,eligibility={minLag:-20,maxLag:5}){
 const start=bars.findIndex(b=>b.date>=period.start);let end=-1;for(let i=bars.length-1;i>=0;i--)if(bars[i].date<=period.end){end=i;break;}
 if(start<0||end<start)throw Error('No bars in evaluation period.');
 const periodPivots=pivots.filter(p=>p.index>=start&&p.index<=end),eligible=periodPivots.filter(p=>p.index+eligibility.minLag>=start&&p.index+eligibility.maxLag<=end&&p.confirmedIndex<=end),ss=signals.filter(s=>s.index>=start&&s.index<=end),matches=matchWindow(ss,eligible,window),years=((Date.parse(bars[end].date)-Date.parse(bars[start].date))/86400000+1)/365.2425;
 const precision=ss.length?matches.length/ss.length:null,recall=eligible.length?matches.length/eligible.length:null;
 const metrics={start:bars[start].date,end:bars[end].date,bars:end-start+1,years,warnings:ss.length,warningsPerYear:ss.length/years,pivots:eligible.length,matched:matches.length,precision,recall,f1:precision===null||recall===null?null:precision+recall?2*precision*recall/(precision+recall):0,unmatched:ss.length-matches.length,unmatchedPerYear:(ss.length-matches.length)/years,medianLag:median(matches.map(m=>m.lagBars)),excludedPivots:periodPivots.length-eligible.length,byDirection:{}};
 for(const d of ['bull','bear']){const sig=ss.filter(s=>s.direction===d),piv=eligible.filter(p=>p.direction===d),mm=matches.filter(m=>m.signal.direction===d);metrics.byDirection[d]={warnings:sig.length,pivots:piv.length,matched:mm.length,recall:piv.length?mm.length/piv.length:null,precision:sig.length?mm.length/sig.length:null,medianLag:median(mm.map(m=>m.lagBars))};}
 return {metrics,matches,eligiblePivots:eligible,excludedPivots:periodPivots.filter(p=>!eligible.includes(p)),signals:ss};
}
const rank=rows=>[...rows].sort((a,b)=>b.early.f1-a.early.f1||b.early.precision-a.early.precision||a.early.unmatchedPerYear-b.early.unmatchedPerYear||a.id.localeCompare(b.id));
export function selectCandidate(development,validation,rules){
 const allowed=r=>finite(r.early.f1)&&r.early.warningsPerYear<=rules.maxWarningsPerYear&&['bull','bear'].every(d=>r.early.byDirection[d].matched>=rules.minEarlyEachDirection);
 const trainingRanking=rank(development.filter(allowed)),shortlist=trainingRanking.slice(0,rules.shortlist),ids=new Set(shortlist.map(r=>r.id)),validationRanking=rank(validation.filter(r=>ids.has(r.id)&&allowed(r))),selected=validationRanking[0];
 return {status:selected?'research candidate selected':'no eligible candidate',selectedId:selected?.id||null,selectedConfig:selected?.config||null,shortlistIds:shortlist.map(r=>r.id),trainingRanking:trainingRanking.map(r=>r.id),validationRanking:validationRanking.map(r=>r.id),exposedUsedForSelection:false,eligibleForPreset:false,reason:'Exposed history is exploratory; only the frozen prospective gate can admit a new preset.'};
}
export function assessGate(candidate,baseline,context,plan){
 if(!context.prospective||!context.configLocked)return {status:'not-admissible',reason:'Untouched prospective data and a locked candidate are required.',eligibleForPreset:false};
 if(context.completedBars<plan.horizonBars)return {status:'pending',reason:'The fixed prospective horizon is not complete.',eligibleForPreset:false,completedBars:context.completedBars,requiredBars:plan.horizonBars};
 const minimum=plan.minimum;
 if(!candidate||!baseline||context.pivots<minimum.eligiblePivots||context.bullPivots<minimum.pivotsEachDirection||context.bearPivots<minimum.pivotsEachDirection||candidate.early.warnings<minimum.warningsEachModel||baseline.early.warnings<minimum.warningsEachModel)return {status:'inconclusive',reason:'Insufficient observations at the fixed horizon; do not extend or relax after seeing the result.',eligibleForPreset:false};
 const a=candidate.early,b=baseline.early,x=candidate.secondary,y=baseline.secondary,g=plan.gate;
 const atLeast=(v,threshold)=>finite(v)&&finite(threshold)&&v+1e-12>=threshold,atMost=(v,threshold)=>finite(v)&&finite(threshold)&&v<=threshold+1e-12;
 const checks={earlyRecall:atLeast(a.recall,g.earlyRecallMin)&&atLeast(a.recall-b.recall,g.earlyRecallImprovement),earlyBothDirections:['bull','bear'].every(d=>a.byDirection[d].matched>=g.minEarlyMatchesEachDirection),fewerUnmatched:atMost(a.unmatchedPerYear,b.unmatchedPerYear*g.unmatchedRateRatioMax),earlyPrecision:atLeast(a.precision-b.precision,g.earlyPrecisionImprovement),secondaryCoverage:atLeast(x.recall,y.recall),secondaryTiming:atMost(x.medianLag,g.secondaryMedianLagMax)&&finite(y.medianLag)&&x.medianLag<y.medianLag,warningRate:atMost(a.warningsPerYear,g.maxWarningsPerYear)};
 const pass=Object.values(checks).every(Boolean);return {status:pass?'pass':'fail',checks,eligibleForPreset:pass,reason:'Pragmatic research admission; no significance, execution or profitability claim.'};
}

export function signalsFor(bars,config){
 if(config.algorithm)return (config.algorithm==='confirmed'?confirmedPivotDivergence:rollingDivergence)(bars,config).signals;
 if(config.kind!=='rsi-reentry')return generateSignals(bars,config).signals;
 const rsi=indicators.rsi(bars.map(b=>b.c),config.rsi),signals=[];
 for(let i=1;i<bars.length;i++){if(!finite(rsi[i-1])||!finite(rsi[i]))continue;const direction=rsi[i-1]<=30&&rsi[i]>30?'bull':rsi[i-1]>=70&&rsi[i]<70?'bear':null;if(direction)signals.push({configId:config.id,index:i,date:bars[i].date,direction,close:bars[i].c});}return signals;
}
export function makeRecord(bars,signals,pivots,config,period,benchmark){
 const early=scoreWindow(bars,signals,pivots,period,benchmark.primary,benchmark.secondary),secondary=scoreWindow(bars,signals,pivots,period,benchmark.secondary,benchmark.secondary);
 return {id:config.id,config,early:early.metrics,secondary:secondary.metrics,earlyMatches:early.matches,secondaryMatches:secondary.matches};
}
export function performScreen(bars,protocol,onSelection=()=>{}){
 validateBars(bars);if(protocol.candidates.length!==protocol.candidateCount)throw Error('Candidate count differs from the frozen protocol.');
 const configs=[...protocol.candidates,...protocol.controls],signals=new Map(configs.map(c=>[c.id,signalsFor(bars,c)])),pivots=zigzag(bars,protocol.benchmark.threshold).pivots;
 const periodRecords=period=>configs.map(c=>makeRecord(bars,signals.get(c.id),pivots,c,period,protocol.benchmark));
 const development=periodRecords(protocol.periods.development),validation=periodRecords(protocol.periods.validation),selection=selectCandidate(development.filter(r=>r.config.algorithm),validation.filter(r=>r.config.algorithm),protocol.selection);
 onSelection(selection);
 const exposed=periodRecords(protocol.periods.exposed),chosen=selection.selectedConfig,finalConfigs=[...(chosen?[chosen]:[]),...protocol.controls];
 const sensitivity=protocol.benchmark.sensitivityThresholds.map(threshold=>({threshold,exposed:finalConfigs.map(c=>makeRecord(bars,signals.get(c.id),zigzag(bars,threshold).pivots,c,protocol.periods.exposed,protocol.benchmark))}));
 return {selection,development,validation,exposed,sensitivity,signals,pivots};
}
const csv=(rows,columns)=>[columns.join(','),...rows.map(r=>columns.map(k=>'"'+String(r[k]??'').replaceAll('"','""')+'"').join(','))].join('\n')+'\n';
function main(){
 const args=process.argv.slice(2),get=(flag,fallback)=>args.includes(flag)?args[args.indexOf(flag)+1]:fallback;
 if(!args.includes('--out'))throw Error('Usage: node research/research-amzn-divergence.mjs --out fresh-directory [--input daily-bars.json] [--forward --selection selection.json --admitted original-bars.json]');
 const protocolPath=path.resolve(get('--protocol',path.join(root,'research/protocols/amzn-divergence-study.json'))),protocolBytes=fs.readFileSync(protocolPath),protocol=JSON.parse(protocolBytes);
 if(sha(protocolBytes)!==PROTOCOL_SHA)throw Error('Frozen protocol SHA mismatch.');
 // The immutable protocol records data relative to its original evidence directory.
 const admittedPath=path.resolve(get('--admitted',path.resolve(root,'evidence/amzn-divergence-study',protocol.data)));
 const inputPath=path.resolve(get('--input',admittedPath)),inputBytes=fs.readFileSync(inputPath),bars=JSON.parse(inputBytes);validateBars(bars);
 const out=path.resolve(get('--out'));if(fs.existsSync(out))throw Error('Refusing to overwrite an experiment directory.');fs.mkdirSync(out,{recursive:true});
 const sourceFiles=['research/research-amzn-divergence.mjs','research/research-divergence-engine.mjs','research/research-amzn-study.mjs','src/native-chart.js'],sourceSha256=Object.fromEntries(sourceFiles.map(p=>[p,sha(fs.readFileSync(path.join(root,p)))])),identity={protocolSha256:sha(protocolBytes),dataSha256:sha(inputBytes),sourceSha256,node:process.version,createdAt:new Date().toISOString()};
 const write=(name,value)=>fs.writeFileSync(path.join(out,name),JSON.stringify(value,null,2)+'\n');write('identity.json',identity);
 try{
  if(args.includes('--forward')){
   if(!args.includes('--selection'))throw Error('Forward mode requires the locked selection.json.');
   const locked=JSON.parse(fs.readFileSync(path.resolve(get('--selection'))));
   const admittedBytes=fs.readFileSync(admittedPath);validateLockedSelection(locked,protocol,sourceSha256,admittedBytes);
   const admitted=JSON.parse(admittedBytes);
   if(sha(JSON.stringify(bars.slice(0,admitted.length)))!==sha(JSON.stringify(admitted)))throw Error('Forward input must preserve the complete admitted history; provider revisions need explicit review.');
   const today=new Date().toISOString().slice(0,10),complete=bars.filter(b=>b.date<today),future=complete.filter(b=>b.date>=protocol.prospective.start).slice(0,protocol.prospective.horizonBars);
   if(!locked.selectedConfig){write('forward.json',{status:'no locked candidate',eligibleForPreset:false,completedBars:future.length});console.log('No candidate was eligible for a prospective test.');return;}
   if(future.length<protocol.prospective.horizonBars){const gate={status:'pending',eligibleForPreset:false,completedBars:future.length,requiredBars:protocol.prospective.horizonBars,start:protocol.prospective.start};write('forward.json',gate);console.log(JSON.stringify(gate));return;}
   const last=future.at(-1),prefix=complete.filter(b=>b.date<=last.date),period={start:protocol.prospective.start,end:last.date},pivots=zigzag(prefix,protocol.benchmark.threshold).pivots,baselineConfig=protocol.controls.find(c=>c.id===protocol.prospective.baselineId),candidate=makeRecord(prefix,signalsFor(prefix,locked.selectedConfig),pivots,locked.selectedConfig,period,protocol.benchmark),baseline=makeRecord(prefix,signalsFor(prefix,baselineConfig),pivots,baselineConfig,period,protocol.benchmark),context={prospective:true,configLocked:true,completedBars:future.length,pivots:candidate.early.pivots,bullPivots:candidate.early.byDirection.bull.pivots,bearPivots:candidate.early.byDirection.bear.pivots},gate=assessGate(candidate,baseline,context,protocol.prospective);
   write('forward.json',{gate,candidate,baseline,period});console.log(JSON.stringify(gate));return;
  }
  if(sha(inputBytes)!==protocol.dataSha256)throw Error('Study data SHA differs from the admitted snapshot.');
  const result=performScreen(bars,protocol,selection=>write('selection.json',{identity,lockedAt:new Date().toISOString(),...selection})),{signals,pivots,...serializable}=result;
  write('results.json',{identity,evidenceStatus:protocol.evidenceStatus,...serializable});
  const rows=['development','validation','exposed'].flatMap(part=>result[part].map(r=>({period:part,id:r.id,filter:r.config.filter||'control',oscillator:r.config.oscillatorMode||'control',warnings:r.early.warnings,warningsPerYear:r.early.warningsPerYear,pivots:r.early.pivots,earlyMatched:r.early.matched,earlyPrecision:r.early.precision,earlyRecall:r.early.recall,earlyF1:r.early.f1,earlyUnmatched:r.early.unmatched,earlyUnmatchedPerYear:r.early.unmatchedPerYear,earlyMedianLag:r.early.medianLag,nearMatched:r.secondary.matched,nearRecall:r.secondary.recall,nearMedianLag:r.secondary.medianLag})));
  fs.writeFileSync(path.join(out,'metrics.csv'),csv(rows,Object.keys(rows[0])));
  const signalRows=[...signals].flatMap(([id,ss])=>ss.map(s=>({modelId:id,...s})));fs.writeFileSync(path.join(out,'signals.csv'),csv(signalRows,['modelId','index','date','direction','close','anchorIndex','referenceIndex','detectedAtIndex','source','rsiDelta','macdDelta','priceAtrDelta']));
  fs.writeFileSync(path.join(out,'pivots.csv'),csv(pivots,['index','date','direction','price','confirmedIndex','confirmedDate']));
  const near=scoreWindow(bars,[],pivots,protocol.periods.exposed,protocol.benchmark.secondary,protocol.benchmark.secondary),swingRows=near.eligiblePivots.map(p=>{const record=result.exposed.find(r=>r.id===result.selection.selectedId),early=record?.earlyMatches.find(m=>m.pivot.index===p.index),secondary=record?.secondaryMatches.find(m=>m.pivot.index===p.index);return {date:p.date,direction:p.direction,confirmedDate:p.confirmedDate,selectedId:result.selection.selectedId,earlyWarning:early?.signal.date,earlyLag:early?.lagBars,nearWarning:secondary?.signal.date,nearLag:secondary?.lagBars};});
  fs.writeFileSync(path.join(out,'selected-swings.csv'),csv(swingRows,['date','direction','confirmedDate','selectedId','earlyWarning','earlyLag','nearWarning','nearLag']));
  write('promotion.json',{status:'not-admissible',eligibleForPreset:false,reason:'This is exposed historical data. No fresh forward observations exist yet.',prospective:protocol.prospective});
  console.log(JSON.stringify({selection:result.selection,exposed:result.exposed.filter(r=>r.id===result.selection.selectedId||!r.config.algorithm).map(({id,early,secondary})=>({id,early,secondary})),out},null,2));
 }catch(error){write('failed.json',{error:error.stack});throw error;}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main();
