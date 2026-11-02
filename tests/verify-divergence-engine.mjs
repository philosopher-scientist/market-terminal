import assert from 'node:assert/strict';
import {indicators} from '../research/research-amzn-study.mjs';
import * as engine from '../research/research-divergence-engine.mjs';

const barsOf=closes=>closes.map((c,i)=>({date:new Date(Date.UTC(2020,0,i+1)).toISOString().slice(0,10),t:Date.UTC(2020,0,i+1)/1000,o:c,h:c+1,l:Math.max(.01,c-1),c,v:100}));
const fake=(bars,{rsi=[],macd=[],ema=[],atr=[],volume=[]}={})=>({rsi:bars.map((_,i)=>rsi[i]??50),normalizedMacd:bars.map((_,i)=>macd[i]??0),ema:bars.map((b,i)=>ema[i]??b.c),atr:bars.map((_,i)=>atr[i]??1),volumeMeanPrevious:bars.map((_,i)=>volume[i]??100)});
const base={id:'fixture',lookback:4,minSeparation:2,maxSeparation:60,left:1,right:1,cooldown:0,oscillatorMode:'both'};
const shape=events=>events.map(s=>[s.index,s.direction,s.anchorIndex,s.referenceIndex]);
let passed=0;
const test=(name,fn)=>{fn();passed++;console.log('PASS '+name);};

test('A bullish rolling divergence is emitted at the current new low, with both indicator anchors',()=>{
 const bars=barsOf([10,9,8,10,9,8.5,7.5]),features=fake(bars,{rsi:[50,40,20,50,40,35,30],macd:[0,0,-2,0,0,0,-1]});
 const signals=engine.generateFromFeatures(bars,base,features).signals;
 assert.deepEqual(shape(signals),[[6,'bull',6,2]]);assert.equal(signals[0].date,bars[6].date);assert.equal(signals[0].detectedAtIndex,6);assert.equal(signals[0].rsiDelta,10);assert.equal(signals[0].macdDelta,1);assert.equal(signals[0].priceAtrDelta,.5);
});

test('Bearish divergence requires a higher price high and lower oscillator readings; ties do not qualify',()=>{
 const bars=barsOf([10,11,12,10,11,11.5,12.5]),features=fake(bars,{rsi:[50,60,80,50,60,65,70],macd:[0,0,2,0,0,0,1]});
 assert.deepEqual(shape(engine.generateFromFeatures(bars,base,features).signals),[[6,'bear',6,2]]);
 const equal=fake(bars,{rsi:[50,60,80,50,60,65,80],macd:[0,0,2,0,0,0,2]});
 assert.equal(engine.generateFromFeatures(bars,{...base,oscillatorMode:'either'},equal).signals.length,0);
});

test('RSI and MACD mode ablations are distinct, with strict optional strength thresholds',()=>{
 const bars=barsOf([10,9,8,10,9,8.5,7.5]),features=fake(bars,{rsi:[50,40,20,50,40,35,30],macd:[0,0,-2,0,0,0,-3]});
 for(const mode of ['rsi','either'])assert.equal(engine.generateFromFeatures(bars,{...base,oscillatorMode:mode},features).signals.length,1);
 for(const mode of ['macd','both'])assert.equal(engine.generateFromFeatures(bars,{...base,oscillatorMode:mode},features).signals.length,0);
 assert.equal(engine.generateFromFeatures(bars,{...base,oscillatorMode:'rsi',minRsiDelta:10},features).signals.length,1);
 assert.equal(engine.generateFromFeatures(bars,{...base,oscillatorMode:'rsi',minRsiDelta:10.01},features).signals.length,0);
});

test('Raw MACD divergence preserves raw direction when changing ATR would invert ratio-based direction',()=>{
 const bars=barsOf([10,9,8,10,9,8.5,7.5]),features=fake(bars,{rsi:[50,40,20,50,40,35,30],macd:[0,0,-2,0,0,0,-1],atr:[1,1,1,1,1,1,3]});
 features.macd={line:[0,0,-2,0,0,0,-3]};
 assert.equal(engine.generateFromFeatures(bars,{...base,macdComparison:'atr'},features).signals.length,1);
 assert.equal(engine.generateFromFeatures(bars,{...base,macdComparison:'raw'},features).signals.length,0);
 features.macd.line[6]=1;const config={...base,macdComparison:'raw',minMacdDelta:1};
 const result=engine.generateFromFeatures(bars,config,features);assert.equal(result.signals.length,1);assert.equal(result.signals[0].macdDelta,1);
 assert.equal(engine.generateFromFeatures(bars,{...config,minMacdDelta:1.01},features).signals.length,0);
});

test('Confirmed-pivot divergence is emitted after the right-hand bars, never at the pivot date',()=>{
 const bars=barsOf([10,8,10,11,9,7,9]),features=fake(bars,{rsi:[50,20,50,60,40,30,50],macd:[0,-2,0,1,0,-1,0]});
 const result=engine.generateFromFeatures(bars,base,features,'confirmed');
 assert.deepEqual(shape(result.signals),[[6,'bull',5,1]]);assert.equal(result.signals[0].date,bars[6].date);
 const clipped=Object.fromEntries(Object.entries(features).map(([k,v])=>[k,v.slice(0,6)]));assert.equal(engine.generateFromFeatures(bars.slice(0,6),base,clipped,'confirmed').signals.length,0);
});

test('The most recent tied rolling extreme is used, and too-close references are rejected',()=>{
 const bars=barsOf([10,8,9,8,9,7]),features=fake(bars,{rsi:[50,10,50,20,50,30],macd:[0,-3,0,-2,0,-1]});
 assert.deepEqual(shape(engine.generateFromFeatures(bars,{...base,minSeparation:2},features).signals),[[5,'bull',5,3]]);
 assert.equal(engine.generateFromFeatures(bars,{...base,minSeparation:3},features).signals.length,0);
});

test('Cooldown limits same-direction warning repeats without a position-state latch',()=>{
 const bars=barsOf([10,9,8,10,9,8.5,7.5,7,6.5,6,5.5]),features=fake(bars,{rsi:[50,40,10,50,40,35,20,30,40,50,60],macd:[0,0,-5,0,0,0,-4,-3,-2,-1,0]});
 const config={...base,minSeparation:1,cooldown:3};
 assert.deepEqual(engine.generateFromFeatures(bars,config,features).signals.map(s=>s.index),[6,9]);
});

test('EMA stretch, price-distance ATR and relative-volume filters use the stated causal bar',()=>{
 const bars=barsOf([10,9,8,10,9,8.5,7.5]),features=fake(bars,{rsi:[50,40,20,50,40,35,30],macd:[0,0,-2,0,0,0,-1],ema:[10,10,10,10,10,10,8]});
 assert.equal(engine.generateFromFeatures(bars,{...base,context:'ema-stretch',emaMinAtr:.5,minPriceAtr:.5,volumeMinRatio:1},features).signals.length,1);
 for(const extra of [{emaMinAtr:.51,context:'ema-stretch'},{minPriceAtr:.51},{volumeMinRatio:1.01}])assert.equal(engine.generateFromFeatures(bars,{...base,...extra},features).signals.length,0);
 const notStretched={...features,ema:[...features.ema.slice(0,6),7]};assert.equal(engine.generateFromFeatures(bars,{...base,context:'ema-stretch'},notStretched).signals.length,0);
});

test('Confirmed filters use EMA and ATR at the pivot but volume at its later detection bar',()=>{
 const bars=barsOf([10,8,10,11,9,7,9]);bars[5].v=10;bars[6].v=200;
 const features=fake(bars,{rsi:[50,20,50,60,40,30,50],macd:[0,-2,0,1,0,-1,0],ema:[10,10,10,10,10,8,8],atr:[1,1,1,1,1,2,100]});
 const config={...base,context:'ema-stretch',emaMinAtr:.5,minPriceAtr:.5,volumeMinRatio:2};
 assert.deepEqual(shape(engine.generateFromFeatures(bars,config,features,'confirmed').signals),[[6,'bull',5,1]]);
 assert.equal(engine.generateFromFeatures(bars,{...config,maxSeparation:3},features,'confirmed').signals.length,0);
});

test('Missing warmups and invalid feature lengths cannot manufacture divergence',()=>{
 const bars=barsOf([10,9,8,10,9,8.5,7.5]),features=fake(bars);
 features.rsi[2]=null;features.normalizedMacd[2]=null;
 assert.equal(engine.generateFromFeatures(bars,base,features).signals.length,0);
 assert.throws(()=>engine.generateFromFeatures(bars,base,{...features,rsi:[1]}),/length|align/i);
});

test('Feature calculations are native, normalize MACD at each anchor and exclude current volume from the reference',()=>{
 const bars=barsOf(Array.from({length:80},(_,i)=>100+Math.sin(i/4)*10+i/10));bars.at(-1).v=10000;
 const config={rsi:14,macd:[12,26,9],atr:20,ema:20,volumePeriod:20},features=engine.calculateFeatures(bars,config),closes=bars.map(b=>b.c);
 assert.deepEqual(features.rsi,Array.from(indicators.rsi(closes,14)));assert.deepEqual(features.ema,Array.from(indicators.ema(closes,20)));assert.deepEqual(features.atr,Array.from(indicators.atr(bars,20)));
 assert.equal(features.volumeMeanPrevious.at(-1),100);
 features.normalizedMacd.forEach((x,i)=>{if(features.macd.line[i]===null||features.atr[i]===null||features.atr[i]===0)assert.equal(x,null);else assert.equal(x,features.macd.line[i]/features.atr[i]);});
 const hist=engine.calculateFeatures(bars,{...config,macdComponent:'histogram'});assert.equal(hist.normalizedMacd.at(-1),hist.macd.histogram.at(-1)/hist.atr.at(-1));
});

test('Public rolling and confirmed paths are prefix-causal, including EMA/ATR/volume filters',()=>{
 const bars=barsOf(Array.from({length:350},(_,i)=>100+Math.sin(i/4)*(5+Math.sin(i/37)*5)+Math.sin(i/47)*12));
 const appended=[...bars.slice(0,250),...bars.slice(250).map((b,i)=>({...b,o:i%2?500:30,h:i%2?501:31,l:i%2?499:29,c:i%2?500:30,v:100000}))];
 for(const fn of [engine.rollingDivergence,engine.confirmedPivotDivergence])for(const macdComparison of ['raw','atr'])for(const extra of [{},{context:'ema-stretch',emaMinAtr:.25,minPriceAtr:.25,volumeMinRatio:1}]){
  const config={...base,lookback:20,left:3,right:3,minSeparation:5,macdComparison,...extra};
  const before=fn(bars.slice(0,250),config).signals,after=fn(appended,config).signals.filter(s=>s.index<250);assert.ok(before.length>0,'Causality fixture must exercise actual '+fn.name+' warnings');assert.deepEqual(after,before);
 }
});

test('Empty and short history produce no warnings; invalid OHLC and config fail explicitly',()=>{
 assert.equal(engine.rollingDivergence([]).signals.length,0);assert.equal(engine.confirmedPivotDivergence(barsOf([100])).signals.length,0);
 assert.throws(()=>engine.rollingDivergence([{...barsOf([100])[0],h:50}]),/Invalid/);
 for(const config of [{oscillatorMode:'hidden'},{macd:[26,12,9]},{macdComparison:'unknown'},{cooldown:-1},{maxSeparation:2,minSeparation:5},{minRsiDelta:NaN}])assert.throws(()=>engine.normalizeConfig(config));
});

console.log(passed+' causal divergence engine checks passed. No real AMZN outcomes were computed.');
