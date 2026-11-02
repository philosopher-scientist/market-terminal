import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const code=fs.readFileSync(new URL('../src/alerts-engine.js',import.meta.url),'utf8');
const context=vm.createContext({console});vm.runInContext(code+'\nglobalThis.alerts=MarketAlerts;',context);
const alerts=context.alerts,plain=value=>JSON.parse(JSON.stringify(value));
const now=Date.parse('2026-11-02T18:00:00Z'),hour=3600000;
const rule=(changes={})=>({id:'alarm-1',symbol:'NASDAQ:AMZN',label:'Amazon alarm',type:'above',threshold:100,windowHours:1,direction:'either',repeat:false,enabled:true,lastTriggeredAt:null,latched:false,lastObservedAt:null,...changes});
const snapshot=(price=100,at=now,changes={})=>({price,at,receivedAt:now,bars:[],...changes});
const bars=(at,entries)=>entries.map(([hoursAgo,c])=>({t:(at-hoursAgo*hour)/1000,c}));
let count=0;
function test(name,fn){fn();count++;console.log('PASS',name);}

test('Inclusive price levels trigger once and preserve input',()=>{
 for(const type of ['above','below']){
  const input=rule({type}),before=plain(input),result=alerts.evaluate(input,snapshot(),now);
  assert.equal(result.triggered,true);assert.equal(result.rule.enabled,false);assert.equal(result.rule.latched,true);assert.equal(result.rule.lastTriggeredAt,now);assert.equal(result.rule.lastObservedAt,now);assert.equal(result.value,100);assert.equal(result.baseline,null);assert.deepEqual(input,before);
  assert.equal(alerts.evaluate(result.rule,snapshot(100,now+hour,{receivedAt:now+hour}),now+hour).triggered,false);
 }
});
test('Wrong side of a price level remains armed',()=>{
 for(const [type,price] of [['above',99],['below',101]]){
  const result=alerts.evaluate(rule({type}),snapshot(price),now);assert.equal(result.triggered,false);assert.equal(result.rule.enabled,true);assert.equal(result.rule.latched,false);assert.equal(result.rule.lastObservedAt,now);
 }
});
test('One-hour and 24-hour swings evaluate up, down and either directions',()=>{
 for(const windowHours of [1,24])for(const [direction,price,expected] of [['up',110,true],['up',90,false],['down',90,true],['down',110,false],['either',110,true],['either',90,true]]){
  const result=alerts.evaluate(rule({type:'swing',threshold:5,windowHours,direction}),snapshot(price,now,{bars:bars(now,[[windowHours,100],[0,price]])}),now);
  assert.equal(result.triggered,expected);assert.ok(Math.abs(result.value-(price-100))<1e-10);assert.equal(result.baseline,100);
 }
});
test('Swing baseline is the latest valid close at or before the window boundary',()=>{
 const result=alerts.evaluate(rule({type:'swing',threshold:5}),snapshot(110,now,{bars:bars(now,[[2,80],[1.1,100],[.9,105],[0,110]]).reverse()}),now);
 assert.equal(result.triggered,true);assert.equal(result.baseline,100);assert.ok(Math.abs(result.value-10)<1e-10);
});
test('Exact upward and downward percentage boundaries are inclusive',()=>{
 for(const [direction,price] of [['up',110],['down',90],['either',90]]){
  const result=alerts.evaluate(rule({type:'swing',threshold:10,direction}),snapshot(price,now,{bars:bars(now,[[1,100],[0,price]])}),now);assert.equal(result.triggered,true);
 }
});
test('Sparse, missing and malformed history cannot invent a swing',()=>{
 const input=rule({type:'swing',threshold:5}),before=plain(input);
 for(const history of [[],bars(now,[[.9,100],[0,110]]),bars(now,[[3,100],[0,110]]),[{t:(now-hour)/1000,c:0}],[{t:(now-hour)/1000,c:NaN}],[null]]){
  const result=alerts.evaluate(input,snapshot(110,now,{bars:history}),now);assert.equal(result.triggered,false);assert.equal(result.value,null);assert.equal(result.baseline,null);assert.deepEqual(plain(result.rule),before);
 }
});
test('Old, future and invalid source snapshots leave evaluation state unchanged',()=>{
 const input=rule(),before=plain(input);
 for(const data of [null,{},snapshot(0),snapshot(NaN),snapshot(Infinity),snapshot(110,now-36*hour-1),snapshot(110,now+60001),snapshot(110,now,{receivedAt:now-120001}),snapshot(110,now,{receivedAt:now+60001}),snapshot(110,now,{receivedAt:NaN})]){
  const result=alerts.evaluate(input,data,now);assert.equal(result.triggered,false);assert.deepEqual(plain(result.rule),before);
 }
 assert.equal(alerts.evaluate(input,snapshot(100,now-36*hour),now).triggered,true);
});
test('Identical or out-of-order observations never rearm or retrigger',()=>{
 const first=alerts.evaluate(rule({repeat:true}),snapshot(110),now);
 for(const data of [snapshot(90),snapshot(90,now-1)]){
  const result=alerts.evaluate(first.rule,data,now);assert.equal(result.triggered,false);assert.deepEqual(plain(result.rule),plain(first.rule));
 }
});
test('Repeating alarms require a fresh reset then a new crossing',()=>{
 const first=alerts.evaluate(rule({repeat:true}),snapshot(110),now);
 const held=alerts.evaluate(first.rule,snapshot(120,now+hour,{receivedAt:now+hour}),now+hour);assert.equal(held.triggered,false);
 const reset=alerts.evaluate(held.rule,snapshot(90,now+hour+1000,{receivedAt:now+hour+1000}),now+hour+1000);assert.equal(reset.rule.latched,false);
 const again=alerts.evaluate(reset.rule,snapshot(100,now+hour+2000,{receivedAt:now+hour+2000}),now+hour+2000);assert.equal(again.triggered,true);assert.equal(again.rule.enabled,true);
});
test('Cooldown suppresses a crossing without a delayed notification while condition stays true',()=>{
 const first=alerts.evaluate(rule({repeat:true}),snapshot(110),now);
 const rearmed=alerts.evaluate(first.rule,snapshot(90,now+1000,{receivedAt:now+1000}),now+1000);
 const suppressed=alerts.evaluate(rearmed.rule,snapshot(110,now+2000,{receivedAt:now+2000}),now+2000);assert.equal(suppressed.triggered,false);assert.equal(suppressed.rule.latched,true);
 const held=alerts.evaluate(suppressed.rule,snapshot(110,now+hour,{receivedAt:now+hour}),now+hour);assert.equal(held.triggered,false);
 const reset=alerts.evaluate(held.rule,snapshot(90,now+hour+1000,{receivedAt:now+hour+1000}),now+hour+1000);
 assert.equal(alerts.evaluate(reset.rule,snapshot(110,now+hour+2000,{receivedAt:now+hour+2000}),now+hour+2000).triggered,true);
});
test('Exactly 30 minutes permits a fresh repeating crossing',()=>{
 const first=alerts.evaluate(rule({repeat:true}),snapshot(110),now);
 const reset=alerts.evaluate(first.rule,snapshot(90,now+1000,{receivedAt:now+1000}),now+1000);
 assert.equal(alerts.evaluate(reset.rule,snapshot(110,now+1800000,{receivedAt:now+1800000}),now+1800000).triggered,true);
});
test('Saved rules round-trip, clone and preserve duplicate suppression',()=>{
 const first=alerts.evaluate(rule({repeat:true}),snapshot(110),now),saved=JSON.parse(JSON.stringify([first.rule])),checked=alerts.validateRules(saved);
 assert.deepEqual(plain(checked),saved);checked[0].label='Changed';assert.notEqual(saved[0].label,'Changed');
 assert.equal(alerts.evaluate(alerts.validateRules(saved)[0],snapshot(110),now).triggered,false);
});
test('Reset rearms a cloned rule without changing its specification',()=>{
 const fired=alerts.evaluate(rule(),snapshot(),now).rule,reset=alerts.reset(fired);
 assert.equal(reset.enabled,true);assert.equal(reset.latched,false);assert.equal(reset.lastTriggeredAt,null);assert.equal(reset.lastObservedAt,null);assert.equal(fired.enabled,false);assert.equal(reset.symbol,fired.symbol);assert.equal(reset.threshold,fired.threshold);
});
test('Validation rejects invalid records, duplicate IDs, excess rules and excess symbols atomically',()=>{
 const original=rule(),before=plain(original),bad=[null,{}, {...original,threshold:0},{...original,threshold:1e12},{...original,threshold:'100'},{...original,type:'invalid'},{...original,symbol:'amzn'},{...original,symbol:'nasdaq:amzn'},{...original,id:'bad id'}, {...original,label:'x'.repeat(81)},{...original,windowHours:2},{...original,direction:'both'},{...original,enabled:1},{...original,repeat:'yes'},{...original,latched:1},{...original,lastTriggeredAt:Infinity},{...original,lastObservedAt:0},{...original,type:'swing',threshold:1001},{...original,unexpected:true}];
 for(const invalid of bad){assert.throws(()=>alerts.validateRules([original,invalid]));assert.deepEqual(original,before);}
 assert.throws(()=>alerts.validateRules([original,original]));assert.throws(()=>alerts.validateRules(Array.from({length:51},(_,i)=>rule({id:'r'+i}))));assert.throws(()=>alerts.validateRules(Array.from({length:21},(_,i)=>rule({id:'r'+i,symbol:'NASDAQ:TEST'+i}))));assert.throws(()=>alerts.validateRules(new Array(1)));assert.throws(()=>alerts.validateRules({}));
 assert.equal(alerts.validateRules(Array.from({length:50},(_,i)=>rule({id:'r'+i,symbol:'NASDAQ:TEST'+(i%20)}))).length,50);
});
test('Disabled rules do not consume observations and invalid evaluation clocks do not trigger',()=>{
 const paused=rule({enabled:false}),before=plain(paused),result=alerts.evaluate(paused,snapshot(),now);assert.equal(result.triggered,false);assert.deepEqual(plain(result.rule),before);
 assert.equal(alerts.evaluate(rule(),snapshot(),NaN).triggered,false);assert.equal(alerts.evaluate(rule(),snapshot(),Infinity).triggered,false);
 assert.equal(alerts.evaluate(rule(),snapshot(100,1e300,{receivedAt:1e300}),1e300).triggered,false);
});
console.log(`${count} alert-engine behavior checks passed.`);
