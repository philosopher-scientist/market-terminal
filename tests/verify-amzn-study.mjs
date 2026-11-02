import assert from 'node:assert/strict';
import * as study from '../research/research-amzn-study.mjs';

const barsOf=closes=>closes.map((c,index)=>({date:new Date(Date.UTC(2020,0,index+1)).toISOString().slice(0,10),t:Date.UTC(2020,0,index+1)/1000,o:c,h:c+1,l:Math.max(.01,c-1),c,v:100}));
let passed=0;
const test=(name,fn)=>{fn();passed++;console.log('PASS '+name);};
const plain=value=>JSON.parse(JSON.stringify(value));
const period={start:'2020-01-01',end:'2020-02-19'};

test('Hindsight pivots retain the extreme and the later causal confirmation separately',()=>{
 const result=study.zigzag(barsOf([100,120,125,110,100,115,130,110]),.15);
 assert.deepEqual(result.pivots.map(p=>[p.type,p.index,p.confirmedIndex]),[['trough',0,1],['peak',2,4],['trough',4,5],['peak',6,7]]);
 assert.equal(result.pending.type,'trough');assert.equal(result.pending.index,7);
});

test('Exact percentage boundaries are inclusive and unfinished extrema are not scored',()=>{
 const result=study.zigzag(barsOf([100,110,120,108,119]),.1);
 assert.deepEqual(result.pivots.map(p=>[p.type,p.index,p.confirmedIndex]),[['trough',0,1],['peak',2,3],['trough',3,4]]);
 assert.equal(result.pending.type,'peak');assert.equal(result.pending.index,4);
 assert.deepEqual(study.zigzag([], .1).pivots,[]);assert.throws(()=>study.zigzag(barsOf([1,2]),0));assert.throws(()=>study.zigzag([{c:NaN},{c:1}],.1));
});

test('Mixed readings retain state and initialization emits no warning',()=>{
 const bars=barsOf([1,2,3,4,5,6]);const signals=study.statesToSignals(bars,[1,0,-1,0,-1,1]);
 assert.deepEqual(signals.map(s=>[s.index,s.direction]),[[2,'bear'],[5,'bull']]);
});

test('Indicator series use the production native functions and complete warmup',()=>{
 const bars=barsOf([1,4,2,5,3,6,2,5,8]);const config={id:'native',kind:'combined',ema:[2,3],macd:[2,4,2]},result=study.calculateSeries(bars,config);
 assert.deepEqual(result.emaFast,Array.from(study.indicators.ema(bars.map(b=>b.c),2)));
 assert.deepEqual(result.macd.histogram,Array.from(study.indicators.macd(bars.map(b=>b.c),2,4,2).histogram));
 assert.ok(result.macd.histogram.slice(0,4).every(x=>x===null));
});

test('Native EMA and MACD match hand-calculated SMA-seeded vectors',()=>{
 const close=[1,3,2,6,4,8],near=(actual,expected)=>{
  assert.equal(actual.length,expected.length);
  actual.forEach((value,index)=>expected[index]===null?assert.equal(value,null):assert.ok(Math.abs(value-expected[index])<1e-12,`${index}: ${value} != ${expected[index]}`));
 };
 near(Array.from(study.indicators.ema(close,2)),[null,2,2,14/3,38/9,182/27]);
 const macd=study.indicators.macd(close,2,3,2);
 near(Array.from(macd.line),[null,null,0,2/3,2/9,20/27]);
 near(Array.from(macd.signal),[null,null,null,1/3,7/27,47/81]);
 near(Array.from(macd.histogram),[null,null,null,1/3,-1/27,13/81]);
});

test('Signals are prefix-causal under arbitrary future appended prices',()=>{
 const bars=barsOf(Array.from({length:120},(_,i)=>100+Math.sin(i/5)*15+i/10));
 for(const kind of ['combined','ema','macd','hist-turn']){
  const config={id:kind,kind,ema:[3,8],macd:[3,9,3]},prefix=bars.slice(0,75),before=study.generateSignals(prefix,config).signals;
  const after=study.generateSignals([...prefix,...bars.slice(75).map((b,i)=>({...b,c:i%2?10000:1}))],config).signals.filter(s=>s.index<75);
  assert.deepEqual(after,before,kind+' must not use later closes');
 }
});

test('Ordered matching maximizes cardinality before distance and prevents duplicate assignments',()=>{
 const signals=[{index:0,direction:'bull'},{index:10,direction:'bull'}],pivots=[{index:10,direction:'bull',confirmedIndex:13},{index:20,direction:'bull',confirmedIndex:23}];
 const matches=study.matchSignals(signals,pivots,{leadBars:10,lagBars:0});
 assert.equal(matches.length,2);assert.deepEqual(matches.map(m=>m.lagBars),[-10,-10]);
 assert.equal(new Set(matches.map(m=>m.signal.index)).size,2);assert.equal(new Set(matches.map(m=>m.pivot.index)).size,2);
 assert.equal(study.matchSignals([{index:10,direction:'bull'}],pivots,{leadBars:10,lagBars:0}).length,1);
});

test('Matching respects direction and inclusive window endpoints',()=>{
 const pivot={index:20,direction:'bear',confirmedIndex:30};
 for(const index of [10,40])assert.equal(study.matchSignals([{index,direction:'bear'}],[pivot],{leadBars:10,lagBars:20}).length,1);
 for(const index of [9,41])assert.equal(study.matchSignals([{index,direction:'bear'}],[pivot],{leadBars:10,lagBars:20}).length,0);
 assert.equal(study.matchSignals([{index:20,direction:'bull'}],[pivot]).length,0);
});

test('Matching minimizes total absolute lag among maximum-cardinality assignments',()=>{
 const signals=[{index:8,direction:'bull'},{index:10,direction:'bull'},{index:19,direction:'bull'}],pivots=[{index:10,direction:'bull',confirmedIndex:12},{index:20,direction:'bull',confirmedIndex:24}];
 const matches=study.matchSignals(signals,pivots,{leadBars:10,lagBars:20});
 assert.deepEqual(matches.map(m=>m.signal.index),[10,19]);assert.equal(matches.reduce((total,m)=>total+Math.abs(m.lagBars),0),1);
});

test('Period scoring excludes unsupported pivot boundaries but counts all warnings conservatively',()=>{
 const bars=barsOf(Array(50).fill(100)),signals=[{index:9,date:bars[9].date,direction:'bull'},{index:20,date:bars[20].date,direction:'bear'}];
 const pivots=[{index:6,date:bars[6].date,direction:'bull',confirmedIndex:8},{index:10,date:bars[10].date,direction:'bull',confirmedIndex:12},{index:40,date:bars[40].date,direction:'bear',confirmedIndex:46}];
 const scored=study.scorePeriod(bars,signals,pivots,{start:bars[5].date,end:bars[44].date},{leadBars:2,lagBars:3});
 assert.equal(scored.metrics.signalCount,2);assert.equal(scored.metrics.eligiblePivots,1);assert.equal(scored.metrics.excludedBoundaryPivots,2);assert.equal(scored.metrics.matchedPivots,1);
 assert.equal(scored.metrics.precision,.5);assert.equal(scored.metrics.recall,1);assert.equal(scored.metrics.f1,2/3);assert.equal(scored.metrics.prePivotRecall,1);assert.equal(scored.metrics.medianPivotLagBars,-1);assert.equal(scored.metrics.medianConfirmationLagBars,-3);assert.equal(scored.metrics.unmatchedSignals,1);
});

const record=(id,f1,rate=4,extra={})=>({id,config:{id},metrics:{f1,signalsPerYear:rate,unmatchedSignalsPerYear:1,medianAbsPivotLagBars:3},...extra});
test('Selection shortlists training then chooses validation without reading holdout scores',()=>{
 const training=[record('A',.8),record('B',.7),record('C',.6),record('D',.9,9)],validation=[record('A',.5),record('B',.6),record('C',1),record('D',1)],settings={researchMaxFlipsPerYear:8,shortlist:2};
 const result=study.selectConfiguration(training,validation,settings);assert.deepEqual(result.shortlistIds,['A','B']);assert.equal(result.selectedId,'B');assert.equal(result.holdoutUsedForSelection,false);
 const poisoned=study.selectConfiguration(training.map(r=>({...r,holdout:{f1:r.id==='C'?999:0}})),validation.map(r=>({...r,holdout:{f1:r.id==='A'?999:0}})),settings);
 assert.deepEqual(poisoned,result);
 assert.equal(study.selectConfiguration([record('A',.8,9)],[record('A',.9)],settings).selectedId,null);
});

test('Native warmup comparison uses the same final date and exposes seed differences',()=>{
 const bars=barsOf(Array.from({length:900},(_,i)=>100+i/10+Math.sin(i/20)*10)),config={id:'warmup',kind:'combined',ema:[20,200],macd:[12,26,9]},result=study.warmupComparison(bars,config);
 assert.equal(result.date,bars.at(-1).date);assert.equal(result.fullBars,900);assert.equal(result.truncatedBars,500);assert.equal(result.values.length,5);assert.equal(result.last200DesiredComparisons,200);assert.ok(result.values.every(row=>Number.isFinite(row.difference)));
});

test('Synthetic full path writes selection before evaluating holdout and never mutates its input',()=>{
 const bars=barsOf(Array.from({length:1500},(_,i)=>100+Math.sin(i/60)*25+i/100)),copy=JSON.stringify(bars),order=[];
 const protocol={emaPairs:[[7,32],[10,30],[12,26],[20,50],[20,100],[50,200]],macdConfigs:[[8,21,5],[12,26,9],[16,32,9],[20,50,9]],candidateCount:24,threshold:.15,sensitivityThresholds:[.1,.2],matching:{leadBars:10,lagBars:20},selection:{researchMaxFlipsPerYear:8,shortlist:5},periods:{train:{start:bars[250].date,end:bars[749].date},validation:{start:bars[750].date,end:bars[1099].date},holdout:{start:bars[1100].date,end:bars[1499].date}}};
 const result=study.performStudy(bars,protocol,{onSelection:()=>order.push('selection'),onHoldoutStart:()=>order.push('holdout')});
 assert.deepEqual(order,['selection','holdout']);assert.equal(result.training.length,24);assert.equal(result.validation.length,24);assert.equal(result.sensitivity.length,2);assert.equal(JSON.stringify(bars),copy);assert.equal(result.selection.holdoutUsedForSelection,false);
 assert.ok(result.holdout.length>=5);for(const group of result.sensitivity)assert.deepEqual(group.holdout.map(r=>r.id),result.holdout.map(r=>r.id));
});

test('Daily data rejects duplicate dates, invalid OHLC and mislabeled timestamps',()=>{
 const bars=barsOf([100,101,102]);assert.equal(study.validateBars(bars),bars);
 assert.throws(()=>study.validateBars([bars[0],bars[0]]));assert.throws(()=>study.validateBars([{...bars[0],h:10},bars[1]]));assert.throws(()=>study.validateBars([{...bars[0],date:'2019-01-01'},bars[1]]));
});

console.log(passed+' AMZN study checks passed. Real data has not been evaluated by this test.');
