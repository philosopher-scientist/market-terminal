import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync(new URL('../src/native-chart.js',import.meta.url),'utf8');
const context=vm.createContext({console,Intl,Date,Math,Number,Set,Map,Array,JSON});
vm.runInContext(source+'\nglobalThis.engine=NativeMarketChart;',context);
const {indicators}=context.engine;
const plain=value=>JSON.parse(JSON.stringify(value));
const near=(actual,expected,tolerance=1e-10)=>assert.ok(Math.abs(actual-expected)<=tolerance,`${actual} != ${expected}`);
const validDrawingInput=[{type:'trend',a:{t:1700000000,value:101},b:{t:1700604800,value:109}},{type:'horizontal',value:107}];
const canonicalDrawings=context.engine.validateDrawings(validDrawingInput);
assert.deepEqual(plain(canonicalDrawings),validDrawingInput);
canonicalDrawings[0].a.value=999;
assert.equal(validDrawingInput[0].a.value,101,'Drawing validation must return deep clones');
for(const invalid of [null,Array(1),[{type:'ray',value:1}],[{type:'horizontal',value:Infinity}],[{type:'horizontal',value:1,extra:'unsupported'}],[{type:'trend',a:{t:0,value:1},b:{t:1,value:2}}],[{type:'trend',a:{t:1,value:NaN},b:{t:2,value:2}}],Array.from({length:1001},()=>({type:'horizontal',value:1}))])assert.throws(()=>context.engine.validateDrawings(invalid));

assert.deepEqual(plain(indicators.sma([1,2,3,4,5],3)),[null,null,2,3,4]);
assert.deepEqual(plain(indicators.ema([1,2,3,4,5,6],3)),[null,null,2,3,4,5]);
const exponential=indicators.ema([1,4,2,5,3,6],3);
[7/3,11/3,10/3,14/3].forEach((value,index)=>near(exponential[index+2],value));
const bands=indicators.bollinger([1,2,3,4],3,2);
assert.deepEqual(plain(bands.middle),[null,null,2,3]);
assert.equal(bands.upper[1],null);
near(bands.upper[2],2+2*Math.sqrt(2/3));
near(bands.lower[3],3-2*Math.sqrt(2/3));
const closes=[44.34,44.09,44.15,43.61,44.33,44.83,45.10,45.42,45.84,46.08,45.89,46.03,45.61,46.28,46.28,46.00,46.03,46.41,46.22,45.64,46.21];
const relative=indicators.rsi(closes,14);
assert.ok(relative.slice(0,14).every(value=>value===null));
near(relative[14],70.4641,.0001);
near(relative[15],66.2496,.0001);
assert.deepEqual(plain(indicators.rsi([1,2,3,4],3)),[null,null,null,100]);
assert.deepEqual(plain(indicators.rsi([4,3,2,1],3)),[null,null,null,0]);
assert.deepEqual(plain(indicators.rsi([2,2,2,2],3)),[null,null,null,50]);
const convergence=indicators.macd(Array.from({length:20},(_,index)=>index+1),3,5,2);
assert.ok(convergence.line.slice(0,4).every(value=>value===null));
assert.equal(convergence.signal[4],null);
near(convergence.line[4],1);
near(convergence.signal[5],1);
convergence.histogram.slice(5).forEach(value=>near(value,0));
const oscillating=indicators.macd([1,4,2,5,3,6],2,3,2);
[-1/6,7/18,1/54,73/162].forEach((value,index)=>near(oscillating.line[index+2],value));
[1/9,4/81,77/243].forEach((value,index)=>near(oscillating.signal[index+3],value));
[5/18,-5/162,65/486].forEach((value,index)=>near(oscillating.histogram[index+3],value));
assert.deepEqual(plain(indicators.ema([null,null,1,2,3,4],3)),[null,null,null,null,2,3]);
for(const calculate of [indicators.sma,indicators.ema,indicators.rsi])assert.deepEqual(plain(calculate([],3)),[]);

// Turtle levels use only preceding completed bars; today's extreme cannot move
// today's entry threshold. ATR uses a true-range SMA seed then Wilder smoothing.
const channelBars=[{h:12,l:8},{h:14,l:7},{h:13,l:9},{h:99,l:1},{h:1000,l:.5}];
const channel=indicators.donchian(channelBars,3);
assert.deepEqual(plain(channel.upper),[null,null,null,14,99]);
assert.deepEqual(plain(channel.lower),[null,null,null,7,1]);
const missingChannel=indicators.donchian([{h:2,l:1},{h:NaN,l:1},{h:4,l:2},{h:5,l:3}],2);
assert.deepEqual(plain(missingChannel.upper),[null,null,null,null]);
assert.deepEqual(plain(indicators.donchian([],20)),{upper:[],lower:[]});
const rangeBars=[{h:10,l:8,c:9},{h:15,l:14,c:14.5},{h:15,l:13,c:14},{h:16,l:15,c:15.5}];
const ranges=indicators.atr(rangeBars,3);
assert.deepEqual(plain(ranges.slice(0,2)),[null,null]);near(ranges[2],10/3);near(ranges[3],26/9);
const seededATR=indicators.atr([...Array.from({length:20},()=>({h:10,l:8,c:9})),{h:22,l:20,c:21}],20);
assert.ok(seededATR.slice(0,19).every(value=>value===null));near(seededATR[19],2);near(seededATR[20],2.55);
assert.deepEqual(plain(indicators.atr([],20)),[]);
assert.deepEqual(plain(indicators.atr([{h:5,l:3,c:4},{h:NaN,l:3,c:4},{h:7,l:5,c:6},{h:8,l:6,c:7}],2)),[null,null,null,2]);

// Exercise the public lifecycle and events with a minimal DOM. Pixel/layout QA is
// intentionally performed by the parent against the integrated real browser app.
const noop=()=>{};
const renderedText=[],fills=[],lineEndpoints=[],lineStarts=[],segments=[],strokeCalls=[];let clipCount=0,pathPoint=null,currentDash=[];
const validCoordinates=(...values)=>values.forEach(value=>assert.ok(Number.isFinite(value),`Invalid Canvas coordinate: ${value}`));
const drawing=new Proxy({
  measureText:text=>({width:String(text).length*6}),
  fillText:(label,x,y)=>{validCoordinates(x,y);renderedText.push(label);},
  fillRect:(...coordinates)=>{validCoordinates(...coordinates);fills.push({color:drawing.fillStyle,coordinates});},
  rect:validCoordinates,setTransform:validCoordinates,clip:()=>clipCount++,
  beginPath:()=>pathPoint=null,setLineDash:value=>currentDash=[...value],
  stroke:()=>strokeCalls.push({color:drawing.strokeStyle,dash:[...currentDash]}),
  moveTo:(x,y)=>{validCoordinates(x,y);lineStarts.push({x,y,color:drawing.strokeStyle});pathPoint=[x,y];},
  lineTo:(x,y)=>{validCoordinates(x,y);lineEndpoints.push([x,y]);if(pathPoint)segments.push({a:pathPoint,b:[x,y],color:drawing.strokeStyle,dash:[...currentDash]});pathPoint=[x,y];}
},{get:(target,key)=>key in target?target[key]:noop,set:(target,key,value)=>(target[key]=value,true)});
class Element{
  constructor(tag){this.tagName=tag;this.children=[];this.style={};this.events={};this.attributes={};this.width=0;this.height=0;this.clientWidth=960;this.clientHeight=640;this.textContent='';}
  append(...items){this.children.push(...items);items.forEach(item=>item.parentElement=this);}
  appendChild(item){this.append(item);return item;}
  setAttribute(key,value){this.attributes[key]=value;}
  addEventListener(name,handler){this.events[name]=handler;}
  removeEventListener(name){delete this.events[name];}
  getBoundingClientRect(){return {left:0,top:0,width:960,height:640};}
  getContext(){return drawing;}
  toDataURL(){return 'data:image/png;base64,test';}
  setPointerCapture(){}
  releasePointerCapture(){}
  focus(){context.document.activeElement=this;}
  remove(){if(this.parentElement)this.parentElement.children=this.parentElement.children.filter(item=>item!==this);}
}
const windowEvents={};
Object.assign(context,{document:{createElement:tag=>new Element(tag)},window:{devicePixelRatio:2,addEventListener:(name,fn)=>windowEvents[name]=fn,removeEventListener:name=>delete windowEvents[name]},ResizeObserver:class{observe(){}disconnect(){}},requestAnimationFrame:fn=>{fn();return 1;},cancelAnimationFrame:noop});
const host=new Element('div'),chart=context.engine.create(host);
const bars=Array.from({length:100},(_,index)=>({t:1700000000+index*3600,o:100+index,h:102+index,l:99+index,c:101+index,v:1000+index}));
chart.setData(bars,{symbol:'TEST',label:'Test market',currency:'USD',style:'1',studies:['sma','rsi','macd'],volume:true,intervalSeconds:3600});
assert.equal(chart.getSnapshot().bars,100);
assert.equal(chart.getSnapshot().futureSpace,.2);
assert.equal(chart.getSnapshot().futureSlots,25);
assert.equal(chart.getSnapshot().visible.end,125);
assert.ok(renderedText.some(label=>label.includes('proj.')),'Future date-axis ticks are explicitly labelled projected');
assert.deepEqual(plain(chart.getSnapshot().panes),['price','volume','rsi','macd']);
assert.equal(host.children.length,2);
assert.equal(host.children[0].tagName,'canvas');
const canvas=host.children[0];
const original=chart.getSnapshot().visible;
canvas.events.wheel({preventDefault:noop,clientX:500,clientY:150,deltaY:-100});
assert.ok(chart.getSnapshot().visible.count<original.count);
const zoomed=chart.getSnapshot().visible;
canvas.events.pointerdown({clientX:500,clientY:150,button:0,pointerId:0,preventDefault:noop});
assert.equal(context.document.activeElement,canvas,'Chart pointer input must focus the canvas for keyboard shortcuts');
canvas.events.pointermove({clientX:400,clientY:150,pointerId:0});
assert.ok(chart.getSnapshot().visible.start>zoomed.start);
canvas.events.pointerup({clientX:400,clientY:150,pointerId:0});
assert.match(host.children[1].textContent,/O .* H .* L .* C /);
assert.match(host.children[1].textContent,/RSI/);
chart.setData(bars,{symbol:'TEST',label:'Test market',currency:'USD',style:'2',studies:[],volume:false});
assert.equal(chart.getSnapshot().visible.count,zoomed.count);
assert.deepEqual(plain(chart.getSnapshot().panes),['price']);
assert.equal(chart.getSnapshot().canUndo,false);
chart.setMode('horizontal');
canvas.events.pointerdown({clientX:350,clientY:150,button:0,pointerId:1,preventDefault:noop});
assert.equal(chart.getSnapshot().drawings,1);
assert.equal(chart.getSnapshot().canUndo,true);
assert.equal(chart.undo(),true);
assert.equal(chart.getSnapshot().drawings,0);
assert.equal(chart.getSnapshot().canUndo,false);
assert.equal(chart.undo(),false);
canvas.events.pointerdown({clientX:350,clientY:150,button:0,pointerId:1,preventDefault:noop});
chart.setMode('trend');
canvas.events.pointerdown({clientX:350,clientY:150,button:0,pointerId:2,preventDefault:noop});
assert.equal(chart.getSnapshot().pending,true);
let escapePrevented=false;
canvas.events.keydown({key:'Escape',preventDefault:()=>escapePrevented=true});
assert.equal(escapePrevented,false,'Escape is reserved for the parent document handler');
assert.equal(chart.getSnapshot().pending,true,'Canvas must not consume or mutate the parent Escape action');
assert.equal(chart.undo(),true);
assert.equal(chart.getSnapshot().pending,false);
assert.equal(chart.getSnapshot().drawings,1,'Cancelling a trend must preserve the existing committed line');
canvas.events.pointerdown({clientX:350,clientY:150,button:0,pointerId:2,preventDefault:noop});
canvas.events.pointerdown({clientX:500,clientY:250,button:0,pointerId:3,preventDefault:noop});
assert.equal(chart.getSnapshot().drawings,2);
assert.equal(chart.undo(),true);
assert.equal(chart.getSnapshot().drawings,1,'Undo completed trend leaves the earlier horizontal line');
chart.clearDrawings();
assert.equal(chart.getSnapshot().drawings,0);
assert.equal(chart.undo(),true);
assert.equal(chart.getSnapshot().drawings,1,'Undo restores a cleared line');
chart.setData(bars,{symbol:'TEST',style:'1',studies:['ema'],volume:true});
assert.equal(chart.getSnapshot().canUndo,true,'Style and study updates preserve history');
assert.equal(chart.undo(),true);
assert.equal(chart.getSnapshot().drawings,0);
chart.setMode('trend');
canvas.events.pointerdown({clientX:350,clientY:150,button:0,pointerId:2,preventDefault:noop});
canvas.events.pointerdown({clientX:500,clientY:250,button:0,pointerId:3,preventDefault:noop});
assert.equal(chart.getSnapshot().drawings,1);
chart.setScale('log');
assert.equal(chart.getSnapshot().scale,'log');
assert.equal(chart.getSnapshot().effectiveScale,'log');
chart.resetView();
assert.equal(chart.getSnapshot().visible.count,125);
chart.setMode('trend');
canvas.events.pointerdown({clientX:400,clientY:150,button:0,pointerId:6,preventDefault:noop});
canvas.events.pointerdown({clientX:850,clientY:250,button:0,pointerId:7,preventDefault:noop});
assert.ok(chart.getSnapshot().drawingItems.at(-1).b.t>bars.at(-1).t,'A trend can end after the latest actual bar');
const futureDrawing=chart.getSnapshot().drawingItems.at(-1);
assert.ok(futureDrawing.b.t<=bars.at(-1).t+chart.getSnapshot().futureSlots*3600,'Future endpoint uses bounded interval-based projection');
canvas.events.pointermove({clientX:850,clientY:250,pointerId:7});
assert.match(host.children[1].textContent,/Projected space \/ no market data/);
assert.doesNotMatch(host.children[1].textContent,/O .* H .* L .* C /,'Future crosshair must not display a fabricated final-bar quote');
assert.equal(chart.undo(),true);
renderedText.length=0;chart.setData(bars,{symbol:'TEST',style:'1',studies:[],volume:false,intervalSeconds:604800});
assert.ok(renderedText.some(label=>/^20\d{2}-\d{2}(?: proj\.)?$/.test(String(label))),'Weekly axes must show the year when projecting across years');
chart.resetView();
chart.setMode('trend');
lineEndpoints.length=0;
canvas.events.pointerdown({clientX:400,clientY:150,button:0,pointerId:6,preventDefault:noop});
canvas.events.pointerdown({clientX:850,clientY:250,button:0,pointerId:7,preventDefault:noop});
assert.ok(chart.getSnapshot().drawingItems.at(-1).b.t>bars.at(-1).t+chart.getSnapshot().futureSlots*3600,'Explicit weekly interval controls future dates instead of inferring hourly fixture spacing');
assert.ok(lineEndpoints.some(([x,y])=>Math.abs(x-850)<1e-6&&Math.abs(y-250)<1e-6),'Projected timestamp maps back to the chosen visual trend endpoint');
assert.equal(chart.undo(),true);
fills.length=0;chart.resize();
assert.equal(fills.filter(fill=>fill.color==='#37caaa').length,101,'Only the 100 actual candles plus the latest-price badge are painted; future slots add no candles');
chart.setData(bars,{symbol:'TEST',intervalSeconds:3600});
chart.setFutureSpace(.5);
assert.equal(chart.getSnapshot().futureSpace,.5);
assert.equal(chart.getSnapshot().futureSlots,100);
assert.equal(chart.getSnapshot().visible.count,180);
canvas.events.wheel({preventDefault:noop,clientX:500,clientY:150,deltaY:100000});
assert.ok(chart.getSnapshot().visible.count<=200);
canvas.events.pointerdown({clientX:500,clientY:150,button:0,pointerId:8,preventDefault:noop});
chart.setMode('pan');
canvas.events.pointerdown({clientX:500,clientY:150,button:0,pointerId:8,preventDefault:noop});
canvas.events.pointermove({clientX:-50000,clientY:150,pointerId:8});
assert.ok(chart.getSnapshot().visible.start<=98,'Panning retains at least two actual bars');
assert.ok(chart.getSnapshot().visible.end<=200,'Panning stays inside bounded future slots');
canvas.events.pointerup({clientX:-50000,clientY:150,pointerId:8});
chart.setFutureSpace(0);
assert.equal(chart.getSnapshot().futureSlots,0);
assert.equal(chart.getSnapshot().visible.end,100);
chart.setFutureSpace(.2);
chart.setData(bars.slice(0,40),{symbol:'OTHER',style:'1',studies:[],volume:false});
assert.equal(chart.getSnapshot().drawings,0);
assert.equal(chart.getSnapshot().canUndo,false,'A new symbol starts a fresh drawing history');
assert.equal(chart.undo(),false);
assert.equal(chart.getSnapshot().visible.count,50);
assert.equal(chart.getSnapshot().futureSpace,.2);
assert.equal(chart.getSnapshot().futureSlots,10);
chart.setMode('trend');
canvas.events.pointerdown({clientX:350,clientY:150,button:0,pointerId:4,preventDefault:noop});
assert.equal(chart.getSnapshot().canUndo,true,'An unfinished trend can be cancelled without prior drawing history');
assert.equal(chart.undo(),true);
assert.equal(chart.getSnapshot().canUndo,false);
chart.setMode('horizontal');
for(let index=0;index<55;index++)canvas.events.pointerdown({clientX:350,clientY:150,button:0,pointerId:5,preventDefault:noop});
assert.equal(chart.getSnapshot().drawings,55);
let undone=0;while(chart.undo())undone++;
assert.equal(undone,50,'Drawing history is bounded to the latest 50 committed changes');
assert.equal(chart.getSnapshot().drawings,5);
chart.clearDrawings();
chart.clearDrawings();
assert.equal(chart.undo(),true);
assert.equal(chart.getSnapshot().drawings,5,'Clear restores the entire drawing set; a second empty Clear adds no history');
chart.setData([{t:1,o:-2,h:1,l:-3,c:-1,v:10}],{symbol:'NEGATIVE',style:'1',studies:[],volume:false});
assert.equal(chart.getSnapshot().effectiveScale,'linear');
assert.match(host.children[1].textContent,/nonpositive data/);
chart.setData([],{symbol:'EMPTY',style:'1',studies:[],volume:false});
assert.equal(chart.getSnapshot().bars,0);
assert.match(host.children[1].textContent,/No market data/);
chart.setData([{t:1,o:1e-10,h:2e-10,l:1e-11,c:1e-10,v:10}],{symbol:'TINY',style:'1',studies:[],volume:false});
assert.match(host.children[1].textContent,/C 1\.000e-10/);
assert.equal(host.children[1].textContent,host.children[1].title);
assert.match(chart.toDataURL(),/^data:image\/png/);
chart.resize();
chart.destroy();
assert.equal(host.children.length,0);
assert.equal(Object.keys(canvas.events).length,0);

// A persisted drawing uses absolute UTC anchors through 1W → 1h → 1D → 1W,
// including anchors outside the currently downloaded intraday history.
const weekly=Array.from({length:12},(_,i)=>({t:1700000000+i*604800,o:105,h:113,l:100,c:110,v:1000}));
const hourly=Array.from({length:100},(_,i)=>({...weekly[0],t:weekly.at(-1).t-(99-i)*3600}));
const daily=Array.from({length:40},(_,i)=>({...weekly[0],t:weekly.at(-1).t-(39-i)*86400}));
const workspaceHost=new Element('div'),workspaceChart=context.engine.create(workspaceHost),workspaceCanvas=workspaceHost.children[0];
workspaceChart.setData(weekly,{symbol:'WORK',style:'1',studies:[],volume:false,intervalSeconds:604800});
workspaceChart.setMode('trend');
workspaceCanvas.events.pointerdown({clientX:350,clientY:150,button:0,pointerId:20,preventDefault:noop});
workspaceCanvas.events.pointerdown({clientX:850,clientY:250,button:0,pointerId:21,preventDefault:noop});
workspaceChart.setMode('horizontal');
workspaceCanvas.events.pointerdown({clientX:500,clientY:280,button:0,pointerId:22,preventDefault:noop});
const serializedWorkspace=JSON.stringify(workspaceChart.getWorkspace()),expectedWorkspace=JSON.parse(serializedWorkspace);
assert.equal(expectedWorkspace.drawings.length,2);
assert.ok(expectedWorkspace.drawings[0].a.t<hourly[0].t);
const beforeClip=clipCount;lineStarts.length=0;
workspaceChart.setData(hourly,{symbol:'WORK',intervalSeconds:3600});
assert.deepEqual(plain(workspaceChart.getWorkspace()),expectedWorkspace);
assert.ok(lineStarts.some(point=>point.color==='#d5b471'&&point.x<0),'A weekly anchor older than the hourly history extrapolates left rather than pinning to the first candle');
assert.ok(clipCount>beforeClip,'Offscreen annotation rendering retains the price-pane clip');
workspaceChart.destroy();
const restoredHost=new Element('div'),restored=context.engine.create(restoredHost),restoredCanvas=restoredHost.children[0];
restored.setData(hourly,{symbol:'WORK',style:'1',studies:[],volume:false,intervalSeconds:3600});
const restoreInput=JSON.parse(serializedWorkspace);restored.setWorkspace(restoreInput);
restoreInput.drawings[0].a.t=1;restoreInput.undoHistory[1][0].a.value=999;
assert.deepEqual(plain(restored.getWorkspace()),expectedWorkspace,'Restored workspace must own deep clones of its drawings and history');
const exported=restored.getWorkspace();exported.drawings[0].b.value=999;exported.undoHistory[1][0].a.t=1;
assert.deepEqual(plain(restored.getWorkspace()),expectedWorkspace,'Exported workspace must not expose mutable internal arrays or anchor objects');
for(const [data,seconds] of [[daily,86400],[weekly,604800],[hourly,3600],[weekly,604800]]){
  restored.setData(data,{symbol:'WORK',intervalSeconds:seconds});
  assert.deepEqual(plain(restored.getWorkspace()),expectedWorkspace,'Interval changes preserve exact absolute anchors and undo history');
}
assert.equal(restored.undo(),true);
assert.deepEqual(plain(restored.getWorkspace().drawings),expectedWorkspace.drawings.slice(0,1),'Imported history can undo the last committed horizontal line');
restored.setWorkspace({drawings:expectedWorkspace.drawings});
assert.equal(restored.undo(),true);
assert.deepEqual(plain(restored.getWorkspace().drawings),expectedWorkspace.drawings.slice(0,1),'A drawings-only import seeds addition history');
restored.setWorkspace({drawings:Array.from({length:55},(_,i)=>({type:'horizontal',value:100+i}))});
let importedUndos=0;while(restored.undo())importedUndos++;
assert.equal(importedUndos,50,'Seeded import history retains at most 50 changes');
assert.equal(restored.getWorkspace().drawings.length,5);
restored.setWorkspace(JSON.parse(serializedWorkspace));restored.setMode('trend');
restoredCanvas.events.pointerdown({clientX:350,clientY:150,button:0,pointerId:23,preventDefault:noop});
const atomicBefore=plain(restored.getWorkspace());
for(const invalid of [{drawings:[],undoHistory:[[{type:'horizontal',value:NaN}]]},{drawings:[{type:'bad'}]},{drawings:[],undoHistory:Array(1)},{drawings:[],undoHistory:Array.from({length:51},()=>[])}]){
  assert.throws(()=>restored.setWorkspace(invalid));
  assert.deepEqual(plain(restored.getWorkspace()),atomicBefore,'Invalid workspace must leave drawings and history unchanged');
  assert.equal(restored.getSnapshot().pending,true,'Validation must precede pending/drag mutation');
}
restored.setWorkspace(JSON.parse(serializedWorkspace));
assert.equal(restored.getSnapshot().pending,false);
restored.setMode('pan');restoredCanvas.events.pointerdown({clientX:500,clientY:150,button:0,pointerId:24,preventDefault:noop});
restored.setWorkspace(JSON.parse(serializedWorkspace));const stableStart=restored.getSnapshot().visible.start;
restoredCanvas.events.pointermove({clientX:100,clientY:150,pointerId:24});
assert.equal(restored.getSnapshot().visible.start,stableStart,'Restoring a workspace cancels an active pan');
restored.destroy();

const turtleHost=new Element('div'),turtleChart=context.engine.create(turtleHost),turtleCanvas=turtleHost.children[0];
const turtleBars=Array.from({length:80},(_,i)=>({t:1700000000+i*86400,o:100+i,h:102+i,l:99+i,c:101+i,v:1000}));
turtleChart.setData(turtleBars,{symbol:'TURTLE',label:'Turtle fixture',currency:'USD',studies:['turtle'],volume:false,intervalSeconds:86400});
segments.length=0;strokeCalls.length=0;renderedText.length=0;turtleChart.resize();
const channelColors=['#7db9ed','#d5b471','#b19be8'],channelSegments=segments.filter(segment=>channelColors.includes(segment.color));
assert.ok(channelSegments.length>0);
assert.ok(channelSegments.every(segment=>Math.abs(segment.a[0]-segment.b[0])<1e-8||Math.abs(segment.a[1]-segment.b[1])<1e-8),'Donchian thresholds render steps rather than diagonal interpolation');
for(const color of channelColors)assert.equal(strokeCalls.filter(call=>call.color===color).length,2,'Each channel has one high/low pair; 20-bar entry and exit levels are not painted twice');
assert.ok(strokeCalls.some(call=>call.color==='#b19be8'&&String(call.dash)==='4,3'),'10-bar exits are visibly dashed');
const actualEnd=12+80*(960-102)/100;
assert.ok(channelSegments.every(segment=>Math.max(segment.a[0],segment.b[0])<=actualEnd+1e-8),'Turtle steps stop at the last actual candle and do not fabricate future levels');
assert.match(turtleHost.children[1].textContent,/S1 entry 20d H 180 \/ L 158/);
assert.match(turtleHost.children[1].textContent,/S2 entry 55d H 180 \/ L 123/);
assert.match(turtleHost.children[1].textContent,/S1 exit 10d long L 168 \/ short H 180/);
assert.match(turtleHost.children[1].textContent,/S2 exit 20d long L 158 \/ short H 180/);
const turtleLegend=turtleHost.children[1],turtleLegendLines=turtleLegend.textContent.split('\n');
assert.equal(turtleLegendLines.length,5,'Turtle legend separates entries, exits and supporting studies into five lines');
assert.match(turtleLegendLines[2],/S1 entry.*S2 entry/);assert.doesNotMatch(turtleLegendLines[2],/exit/);
assert.match(turtleLegendLines[3],/S1 exit.*S2 exit/);assert.doesNotMatch(turtleLegendLines[3],/entry/);
assert.equal(turtleLegend.style.height,'88px','Five visible text lines leave room for the horizontal scrollbar');
assert.ok(segments.some(segment=>segment.color==='#172330'&&segment.a[0]===12&&segment.b[0]===870&&segment.a[1]===103&&segment.b[1]===103),'The price pane begins below the enlarged legend and its scrollbar');
turtleChart.setData(turtleBars,{studies:['turtle','atr'],settings:{atr:20}});
assert.deepEqual(plain(turtleChart.getSnapshot().panes),['price','atr']);
assert.match(turtleHost.children[1].textContent,/ATR 20 \(N\) 3 USD/);
assert.match(turtleHost.children[1].textContent.split('\n')[4],/ATR 20 \(N\) 3 USD/);
assert.ok(renderedText.includes('ATR 20 (N) · USD'));
assert.ok(!renderedText.includes('RSI 14'));
segments.length=0;turtleChart.setData(turtleBars,{studies:['ema','atr']});
assert.equal(turtleLegend.style.height,'64px','Switching studies immediately returns the ordinary legend height without a resize');
assert.equal(turtleLegend.textContent.split('\n').length,3);
assert.ok(segments.some(segment=>segment.color==='#172330'&&segment.a[0]===12&&segment.b[0]===870&&segment.a[1]===79&&segment.b[1]===79),'Ordinary study updates restore the earlier plot boundary');
segments.length=0;turtleChart.setData(turtleBars,{studies:['turtle','atr']});
assert.equal(turtleLegend.style.height,'88px','Switching Turtle back on reserves all legend rows immediately');
assert.ok(segments.some(segment=>segment.color==='#172330'&&segment.a[0]===12&&segment.b[0]===870&&segment.a[1]===103&&segment.b[1]===103));
assert.equal(turtleLegend.title,turtleLegend.textContent,'The accessible legend retains every complete value');
assert.equal(turtleLegend.style.overflowX,'auto');
const desktopBounds=turtleHost.getBoundingClientRect;turtleHost.getBoundingClientRect=()=>({left:0,top:0,width:390,height:300});
segments.length=0;turtleChart.resize();assert.equal(turtleLegend.style.height,'88px');
assert.ok(segments.some(segment=>segment.color==='#172330'&&segment.a[0]===12&&segment.b[0]===300&&segment.a[1]===103&&segment.b[1]===103),'Mobile-sized resizing keeps the price pane below all five legend rows');
turtleHost.getBoundingClientRect=desktopBounds;turtleChart.resize();
turtleChart.setScale('log');assert.equal(turtleChart.getSnapshot().effectiveScale,'log');
turtleChart.setData(turtleBars,{intervalSeconds:604800});assert.match(turtleHost.children[1].textContent,/S1 entry 20 bars/);assert.doesNotMatch(turtleHost.children[1].textContent,/entry 20d/);
turtleChart.setData(turtleBars.slice(0,10),{symbol:'SHORT',intervalSeconds:86400});assert.match(turtleHost.children[1].textContent,/S2 entry 55d H — \/ L —/);assert.match(turtleHost.children[1].textContent,/ATR 20 \(N\) —/);
turtleChart.setData(turtleBars,{symbol:'TURTLE',intervalSeconds:86400});
turtleCanvas.events.pointermove({clientX:850,clientY:150,pointerId:30});assert.match(turtleHost.children[1].textContent,/Projected space \/ no market data/);assert.doesNotMatch(turtleHost.children[1].textContent,/ATR|S1|S2/);
turtleChart.setData([],{symbol:'EMPTY'});assert.match(turtleHost.children[1].textContent,/No market data/);turtleChart.destroy();
console.log('PASS: indicator vectors including prior-window Donchian and seeded Wilder ATR; stepped Turtle levels/exit styles/units/ATR pane without future data; chart lifecycle/zoom/pan/undo/future space; finite clipped Canvas coordinates; validated atomic workspace cloning/JSON recreation; exact 1W↔1h↔1D anchors and restored/seeded bounded undo history; empty data and cleanup.');
