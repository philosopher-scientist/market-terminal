import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {matchWindow,scoreWindow,selectCandidate,assessGate,validateLockedSelection,PROTOCOL_SHA} from '../research/research-amzn-divergence.mjs';
let passed=0;const test=(name,fn)=>{fn();passed++;console.log('PASS '+name);};
const signal=(index,direction='bull')=>({index,direction,date:'fixture'});
const pivot=(index,direction='bull')=>({index,direction,date:'fixture',confirmedIndex:index+4});
test('Strict early matching accepts -20 and -1 but rejects same-day and later warnings',()=>{
 const matches=matchWindow([signal(10),signal(29),signal(30),signal(31)],[pivot(30)],{minLag:-20,maxLag:-1});
 assert.equal(matches.length,1);assert.equal(matches[0].signal.index,29);assert.equal(matches[0].lagBars,-1);
 assert.equal(matchWindow([signal(10)],[pivot(30)],{minLag:-20,maxLag:-1}).length,1);
 assert.equal(matchWindow([signal(9),signal(30),signal(31)],[pivot(30)],{minLag:-20,maxLag:-1}).length,0);
});
test('Matching maximizes cardinality, preserves direction and uses each event once',()=>{
 const matches=matchWindow([signal(8),signal(18),signal(19,'bear')],[pivot(20),pivot(30)],{minLag:-20,maxLag:-1});
 assert.equal(matches.length,2);assert.equal(new Set(matches.map(x=>x.signal.index)).size,2);assert.equal(new Set(matches.map(x=>x.pivot.index)).size,2);
});
const bars=Array.from({length:100},(_,i)=>({date:new Date(Date.UTC(2020,0,1+i)).toISOString().slice(0,10),c:100}));
test('Early and secondary windows share eligible pivots and count every warning',()=>{
 const pp=[pivot(10),pivot(30),pivot(70),{...pivot(90),confirmedIndex:101}],ss=[signal(0),signal(25),signal(73),signal(99)];
 const common={minLag:-20,maxLag:5},period={start:bars[0].date,end:bars[99].date};
 const early=scoreWindow(bars,ss,pp,period,{minLag:-20,maxLag:-1},common),near=scoreWindow(bars,ss,pp,period,common,common);
 assert.equal(early.metrics.pivots,2);assert.equal(near.metrics.pivots,2);assert.equal(early.metrics.warnings,4);assert.equal(early.metrics.matched,1);assert.equal(near.metrics.matched,2);assert.equal(early.metrics.excludedPivots,2);
});
const row=(id,f1=.5,extra={})=>({id,config:{id},early:{f1,precision:.5,unmatchedPerYear:2,warningsPerYear:4,byDirection:{bull:{matched:1},bear:{matched:1}},...extra},secondary:{}});
const selectionRules={maxWarningsPerYear:8,shortlist:1,minEarlyEachDirection:1};
test('Validation selects only from the development shortlist; zero coverage cannot qualify',()=>{
 assert.equal(selectCandidate([row('a',.8),row('b',.7)],[row('a',.1),row('b',.9)],selectionRules).selectedId,'a');
 assert.equal(selectCandidate([row('a',.8,{warningsPerYear:9})],[row('a')],selectionRules).selectedId,null);
 assert.equal(selectCandidate([row('a')],[row('a',.9,{byDirection:{bull:{matched:2},bear:{matched:0}}})],selectionRules).selectedId,null);
});
const plan={horizonBars:1260,minimum:{eligiblePivots:20,pivotsEachDirection:8,warningsEachModel:20},gate:{earlyRecallMin:.2,earlyRecallImprovement:.1,minEarlyMatchesEachDirection:2,unmatchedRateRatioMax:.8,earlyPrecisionImprovement:.1,secondaryRecallAtLeastBaseline:true,secondaryMedianLagMax:3,secondaryMedianLagBelowBaseline:true,maxWarningsPerYear:8}};
const baseline={early:{warnings:40,recall:.1,precision:.1,unmatchedPerYear:7,warningsPerYear:8,byDirection:{bull:{matched:1},bear:{matched:1}}},secondary:{recall:.5,medianLag:10}};
const candidate={early:{warnings:25,recall:.4,precision:.4,unmatchedPerYear:3,warningsPerYear:5,byDirection:{bull:{matched:4},bear:{matched:4}}},secondary:{recall:.6,medianLag:2}};
const context={prospective:true,configLocked:true,completedBars:1260,pivots:20,bullPivots:10,bearPivots:10};
test('Exposed-history improvements can never pass the untouched-data gate',()=>{
 assert.equal(assessGate(candidate,baseline,{...context,prospective:false},plan).status,'not-admissible');
});
test('Forward gate waits for its fixed horizon then rejects insufficient sample',()=>{
 assert.equal(assessGate(candidate,baseline,{...context,completedBars:1259},plan).status,'pending');
 assert.equal(assessGate(candidate,baseline,{...context,pivots:19},plan).status,'inconclusive');
 assert.equal(assessGate({...candidate,early:{...candidate.early,warnings:0}},baseline,context,plan).status,'inconclusive');
});
test('Forward gate requires all timing, false-alarm, coverage and rate criteria',()=>{
 assert.equal(assessGate(candidate,baseline,context,plan).status,'pass');
 for(const extra of [{recall:.1},{precision:.15},{unmatchedPerYear:6},{warningsPerYear:9}])assert.equal(assessGate({...candidate,early:{...candidate.early,...extra}},baseline,context,plan).status,'fail');
 assert.equal(assessGate({...candidate,secondary:{recall:.4,medianLag:2}},baseline,context,plan).status,'fail');
 assert.equal(assessGate({...candidate,secondary:{recall:.6,medianLag:4}},baseline,context,plan).status,'fail');
});
test('Forward percentage improvement boundaries are inclusive despite binary rounding',()=>{
 const a={...candidate,early:{...candidate.early,recall:.3,precision:.3,unmatchedPerYear:5.6,warningsPerYear:8}},b={...baseline,early:{...baseline.early,recall:.2,precision:.2}};
 assert.equal(assessGate(a,b,context,plan).status,'pass');
});
test('Forward admission rejects altered admitted data or its recorded SHA',()=>{
 const bytes=Buffer.from('[1]'),dataSha256=crypto.createHash('sha256').update(bytes).digest('hex'),config={id:'fixed',rsi:14},protocol={candidates:[config],dataSha256},sources={'engine':'hash'},locked={selectedId:'fixed',selectedConfig:config,validationRanking:['fixed'],identity:{protocolSha256:PROTOCOL_SHA,dataSha256,sourceSha256:sources}};
 assert.doesNotThrow(()=>validateLockedSelection(locked,protocol,sources,bytes));
 assert.throws(()=>validateLockedSelection(locked,protocol,sources,Buffer.from('[2]')),/data|SHA/i);
 assert.throws(()=>validateLockedSelection({...locked,identity:{...locked.identity,dataSha256:'edited'}},protocol,sources,bytes),/data|SHA/i);
});
test('Forward admission rejects retuned or inconsistent selection records',()=>{
 const bytes=Buffer.from('[1]'),dataSha256=crypto.createHash('sha256').update(bytes).digest('hex'),config={id:'fixed',rsi:14},protocol={candidates:[config],dataSha256},sources={'engine':'hash'},locked={selectedId:'fixed',selectedConfig:config,validationRanking:['fixed'],identity:{protocolSha256:PROTOCOL_SHA,dataSha256,sourceSha256:sources}};
 assert.throws(()=>validateLockedSelection({...locked,selectedConfig:{...config,rsi:7}},protocol,sources,bytes),/candidate|selection|config/i);
 assert.throws(()=>validateLockedSelection({...locked,selectedId:'other'},protocol,sources,bytes),/candidate|selection|config/i);
});
console.log(passed+' divergence-study checks passed. Synthetic fixtures are not live forward evidence.');
