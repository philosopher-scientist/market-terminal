// Causal research helpers. These warnings are not trades or forecasts.
import {indicators} from './research-amzn-study.mjs';

const finite=x=>typeof x==='number'&&Number.isFinite(x);
export function normalizeConfig(input={}){
 const c={id:'divergence',rsi:14,macd:[12,26,9],atr:20,ema:20,volumePeriod:20,lookback:20,minSeparation:5,maxSeparation:60,left:3,right:3,oscillatorMode:'both',macdComponent:'line',macdComparison:'atr',minRsiDelta:0,minMacdDelta:0,minPriceAtr:0,context:'none',emaMinAtr:0,volumeMinRatio:0,cooldown:10,...input};
 for(const key of ['rsi','atr','ema','volumePeriod','lookback','minSeparation','maxSeparation','left','right'])if(!Number.isInteger(c[key])||c[key]<1)throw Error(key+' must be a positive integer.');
 if(!Number.isInteger(c.cooldown)||c.cooldown<0)throw Error('cooldown must be a nonnegative integer.');
 if(!Array.isArray(c.macd)||c.macd.length!==3||!c.macd.every(x=>Number.isInteger(x)&&x>0)||c.macd[0]>=c.macd[1])throw Error('MACD must contain positive fast/slow/signal periods with fast < slow.');
 if(!['rsi','macd','both','either'].includes(c.oscillatorMode))throw Error('Unsupported oscillatorMode.');
 if(!['line','histogram'].includes(c.macdComponent))throw Error('Unsupported MACD component.');
 if(!['raw','atr'].includes(c.macdComparison))throw Error('Unsupported MACD comparison.');
 if(!['none','ema-stretch'].includes(c.context))throw Error('Unsupported EMA context.');
 for(const key of ['minRsiDelta','minMacdDelta','minPriceAtr','emaMinAtr','volumeMinRatio'])if(!finite(c[key])||c[key]<0)throw Error(key+' must be finite and nonnegative.');
 if(c.maxSeparation<c.minSeparation)throw Error('Maximum separation must cover minimum separation.');
 return {...c,macd:[...c.macd]};
}

function validateBars(bars){
 if(!Array.isArray(bars))throw Error('Bars must be an array.');
 bars.forEach((b,i)=>{
  if(!b||![b.o,b.h,b.l,b.c,b.v,b.t].every(finite)||Math.min(b.o,b.h,b.l,b.c)<=0||b.v<0||b.h<Math.max(b.o,b.c)||b.l>Math.min(b.o,b.c)||!/^\d{4}-\d{2}-\d{2}$/.test(b.date)||new Date(b.t*1000).toISOString().slice(0,10)!==b.date||(i&&bars[i-1].t>=b.t))throw Error('Invalid or unordered daily bar at '+i+'.');
 });
}

export function calculateFeatures(bars,input={}){
 const c=normalizeConfig(input);validateBars(bars);
 const closes=bars.map(b=>b.c),volumes=bars.map(b=>b.v),atr=Array.from(indicators.atr(bars,c.atr));
 const macd=Object.fromEntries(Object.entries(indicators.macd(closes,...c.macd)).map(([k,v])=>[k,Array.from(v)]));
 const means=Array.from(indicators.sma(volumes,c.volumePeriod));
 return {rsi:Array.from(indicators.rsi(closes,c.rsi)),ema:Array.from(indicators.ema(closes,c.ema)),atr,macd,normalizedMacd:macd[c.macdComponent].map((v,i)=>finite(v)&&finite(atr[i])&&atr[i]>0?v/atr[i]:null),volumeMeanPrevious:bars.map((_,i)=>i?means[i-1]:null)};
}

export function generateFromFeatures(bars,input,features,mode='rolling'){
 const c=normalizeConfig(input);validateBars(bars);
 if(!['rolling','confirmed'].includes(mode))throw Error('Unsupported divergence mode.');
 for(const key of ['rsi','normalizedMacd','ema','atr','volumeMeanPrevious'])if(!Array.isArray(features?.[key])||features[key].length!==bars.length)throw Error('Feature '+key+' must align with the bars length.');
 if(c.macdComparison==='raw'&&(!Array.isArray(features.macd?.[c.macdComponent])||features.macd[c.macdComponent].length!==bars.length))throw Error('Raw MACD feature must align with the bars length.');
 const signals=[],lastWarning={bull:-Infinity,bear:-Infinity},lastPivot={bull:null,bear:null};
 function candidate(direction,anchor,reference,detected){
  const distance=anchor-reference;if(distance<c.minSeparation||distance>c.maxSeparation)return null;
  const sign=direction==='bull'?1:-1,priceDelta=(bars[reference].c-bars[anchor].c)*sign;
  const atr=features.atr[anchor];if(!(priceDelta>0)||!finite(atr)||atr<=0)return null;
  const rsiDelta=finite(features.rsi[anchor])&&finite(features.rsi[reference])?(features.rsi[anchor]-features.rsi[reference])*sign:null;
  const macdSource=c.macdComparison==='raw'?features.macd[c.macdComponent]:features.normalizedMacd;
  // Raw direction is preserved; scaling both terms by the same known anchor ATR
  // makes only the strength threshold comparable. The atr mode instead compares
  // each point's ratio and can therefore have a different direction.
  const macdDelta=finite(macdSource[anchor])&&finite(macdSource[reference])?(macdSource[anchor]-macdSource[reference])*sign/(c.macdComparison==='raw'?atr:1):null;
  const rsiPass=finite(rsiDelta)&&rsiDelta>0&&rsiDelta>=c.minRsiDelta,macdPass=finite(macdDelta)&&macdDelta>0&&macdDelta>=c.minMacdDelta;
  const oscillatorPass=c.oscillatorMode==='rsi'?rsiPass:c.oscillatorMode==='macd'?macdPass:c.oscillatorMode==='both'?rsiPass&&macdPass:rsiPass||macdPass;
  const priceAtrDelta=priceDelta/atr;if(!oscillatorPass||priceAtrDelta<c.minPriceAtr)return null;
  if(c.context==='ema-stretch'){
   const ema=features.ema[anchor],stretch=finite(ema)?(ema-bars[anchor].c)*sign/atr:null;
   if(!finite(stretch)||stretch<=0||stretch<c.emaMinAtr)return null;
  }
  if(c.volumeMinRatio>0){const mean=features.volumeMeanPrevious[detected];if(!finite(mean)||mean<=0||bars[detected].v/mean<c.volumeMinRatio)return null;}
  return {configId:c.id,index:detected,date:bars[detected].date,direction,close:bars[detected].c,anchorIndex:anchor,referenceIndex:reference,detectedAtIndex:detected,source:mode,rsiDelta,macdDelta,priceAtrDelta};
 }
 for(let detected=0;detected<bars.length;detected++){
  const pending=[];
  if(mode==='rolling'&&detected>=c.lookback){
   let low=detected-c.lookback,high=low;
   for(let j=low+1;j<detected;j++){if(bars[j].c<=bars[low].c)low=j;if(bars[j].c>=bars[high].c)high=j;}
   if(bars[detected].c<bars[low].c){const signal=candidate('bull',detected,low,detected);if(signal)pending.push(signal);}
   if(bars[detected].c>bars[high].c){const signal=candidate('bear',detected,high,detected);if(signal)pending.push(signal);}
  }else if(mode==='confirmed'){
   const anchor=detected-c.right;if(anchor<c.left)continue;
   let low=true,high=true;
   for(let j=anchor-c.left;j<=anchor+c.right;j++){if(j===anchor)continue;if(bars[anchor].c>=bars[j].c)low=false;if(bars[anchor].c<=bars[j].c)high=false;}
   for(const [direction,isPivot] of [['bull',low],['bear',high]])if(isPivot){
    const reference=lastPivot[direction];lastPivot[direction]=anchor;
    if(reference!==null){const signal=candidate(direction,anchor,reference,detected);if(signal)pending.push(signal);}
   }
  }
  // A daily close carries no within-bar ordering; never choose one side of an ambiguity.
  if(pending.length!==1)continue;
  const event=pending[0];if(detected-lastWarning[event.direction]<c.cooldown)continue;
  lastWarning[event.direction]=detected;signals.push(event);
 }
 return {signals,features};
}
export function rollingDivergence(bars,input={}){return generateFromFeatures(bars,input,calculateFeatures(bars,input),'rolling');}
export function confirmedPivotDivergence(bars,input={}){return generateFromFeatures(bars,input,calculateFeatures(bars,input),'confirmed');}
