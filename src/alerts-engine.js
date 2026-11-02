// Pure alert evaluation, embedded into the portable application by its authoring helper.
const MarketAlerts=(()=>{
 'use strict';
 const finite=value=>typeof value==='number'&&Number.isFinite(value);
 const positive=value=>finite(value)&&value>0;
 const validTime=value=>positive(value)&&value<=8640000000000000;
 const timestamp=value=>value===null||validTime(value);
 const fields=['id','symbol','label','type','threshold','windowHours','direction','repeat','enabled','lastTriggeredAt','latched','lastObservedAt'];
 const cooldownMs=30*60*1000;
 function validateRules(list){
  if(!Array.isArray(list)||list.length>50)throw Error('Keep at most 50 alert rules.');
  const ids=new Set(),symbols=new Set();
  return Array.from(list,rule=>{
   if(!rule||typeof rule!=='object'||Array.isArray(rule)||Object.keys(rule).some(key=>!fields.includes(key))||fields.some(key=>!Object.hasOwn(rule,key)))throw Error('Each alert needs the complete supported rule fields.');
   if(typeof rule.id!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(rule.id)||ids.has(rule.id))throw Error('Alert IDs must be unique and use letters, numbers, hyphens or underscores.');
   if(typeof rule.symbol!=='string'||!/^[A-Z0-9_]{1,30}:[A-Z0-9][A-Z0-9._!/-]{0,69}$/.test(rule.symbol))throw Error('Alerts need an uppercase exchange-qualified symbol.');
   if(typeof rule.label!=='string'||rule.label.length>80)throw Error('Alert labels may contain at most 80 characters.');
   if(!['above','below','swing'].includes(rule.type)||!positive(rule.threshold)||rule.threshold>=1e12||(rule.type==='swing'&&rule.threshold>1000))throw Error('Choose a positive price level or a swing percentage up to 1,000%.');
   if(![1,24].includes(rule.windowHours)||!['up','down','either'].includes(rule.direction))throw Error('Choose a 1-hour or 24-hour window and an up, down or either direction.');
   if(['repeat','enabled','latched'].some(key=>typeof rule[key]!=='boolean')||!timestamp(rule.lastTriggeredAt)||!timestamp(rule.lastObservedAt))throw Error('Invalid saved alert state.');
   ids.add(rule.id);symbols.add(rule.symbol);if(symbols.size>20)throw Error('Monitor at most 20 different markets at a time.');
   return Object.fromEntries(fields.map(key=>[key,rule[key]]));
  });
 }
 function reset(input){return {...validateRules([input])[0],enabled:true,latched:false,lastTriggeredAt:null,lastObservedAt:null};}
 function evaluate(input,snapshot,nowMs){
  const rule=validateRules([input])[0];
  const result=(reason,value=null,baseline=null,triggered=false)=>({rule,triggered,reason,value,baseline});
  if(!rule.enabled)return result('Paused');
  if(!validTime(nowMs)||!snapshot||!positive(snapshot.price)||!validTime(snapshot.at)||!validTime(snapshot.receivedAt))return result('Waiting for valid price data');
  if(snapshot.at>nowMs+60000||snapshot.receivedAt>nowMs+60000)return result('Source time is in the future');
  if(nowMs-snapshot.receivedAt>120000)return result('Fetched data is stale');
  if(nowMs-snapshot.at>36*60*60*1000)return result('Source data is stale');
  if(rule.lastObservedAt!==null&&snapshot.at<=rule.lastObservedAt)return result('Waiting for a newer source observation');
  let value=snapshot.price,baseline=null;
  if(rule.type==='swing'){
   const boundary=snapshot.at/1000-rule.windowHours*3600;let selected=null;
   if(Array.isArray(snapshot.bars))for(const bar of snapshot.bars){if(bar&&positive(bar.t)&&positive(bar.c)&&bar.t<=boundary&&(!selected||bar.t>=selected.t))selected=bar;}
   if(!selected||boundary-selected.t>90*60)return result('Waiting for enough '+rule.windowHours+'h history');
   baseline=selected.c;value=(snapshot.price-baseline)/baseline*100;
   if(!finite(value))return result('Waiting for valid comparison data');
  }
  const tolerance=rule.threshold*Number.EPSILON*8;
  const condition=rule.type==='above'?value>=rule.threshold:rule.type==='below'?value<=rule.threshold:rule.direction==='up'?value+tolerance>=rule.threshold:rule.direction==='down'?value-tolerance<=-rule.threshold:Math.abs(value)+tolerance>=rule.threshold;
  rule.lastObservedAt=snapshot.at;
  if(!condition){rule.latched=false;return result('Armed',value,baseline);}
  if(rule.latched)return result('Waiting for condition to reset',value,baseline);
  rule.latched=true;
  if(rule.lastTriggeredAt!==null&&nowMs-rule.lastTriggeredAt<cooldownMs)return result('Cooldown · waiting for a new crossing',value,baseline);
  rule.lastTriggeredAt=nowMs;if(!rule.repeat)rule.enabled=false;
  return result('Triggered',value,baseline,true);
 }
 return {validateRules,evaluate,reset};
})();
