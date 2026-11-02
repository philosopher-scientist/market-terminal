// Native market chart: no remote scripts, assets, embeds or charting dependencies.
const NativeMarketChart=(()=>{
  'use strict';
  const finite=value=>typeof value==='number'&&Number.isFinite(value);
  const period=value=>Math.max(1,Math.floor(Number(value)||1));
  const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
  function validateDrawings(items){
    if(!Array.isArray(items)||items.length>1000)throw Error('Drawings must be an array with at most 1,000 items.');
    function record(value,keys,label){if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!keys.includes(key)))throw Error(`Invalid ${label} fields.`);}
    function point(value){record(value,['t','value'],'trend anchor');if(!finite(value.t)||value.t<=0||!finite(value.value))throw Error('Trend anchors need positive finite UTC seconds and a finite price.');return {t:value.t,value:value.value};}
    return Array.from(items,item=>{
      if(item?.type==='horizontal'){record(item,['type','value'],'horizontal line');if(!finite(item.value))throw Error('Horizontal lines need a finite price.');return {type:'horizontal',value:item.value};}
      if(item?.type==='trend'){record(item,['type','a','b'],'trend line');return {type:'trend',a:point(item.a),b:point(item.b)};}
      throw Error('Unsupported drawing type. Expected trend or horizontal.');
    });
  }
  function sma(values,length){
    const n=period(length),out=Array(values.length).fill(null);let sum=0,run=0;
    values.forEach((value,index)=>{if(!finite(value)){sum=0;run=0;return;}sum+=value;run++;if(run>n)sum-=values[index-n];if(run>=n)out[index]=sum/n;});return out;
  }
  function ema(values,length){
    const n=period(length),out=Array(values.length).fill(null),alpha=2/(n+1);let seed=0,run=0,previous=null;
    values.forEach((value,index)=>{if(!finite(value)){seed=0;run=0;previous=null;return;}if(previous===null){seed+=value;run++;if(run===n)previous=seed/n;}else previous=value*alpha+previous*(1-alpha);out[index]=previous;});return out;
  }
  function rsi(values,length){
    const n=period(length),out=Array(values.length).fill(null);let gain=0,loss=0,run=0;
    for(let index=1;index<values.length;index++){
      if(!finite(values[index])||!finite(values[index-1])){gain=0;loss=0;run=0;continue;}
      const change=values[index]-values[index-1],up=Math.max(0,change),down=Math.max(0,-change);run++;
      if(run<=n){gain+=up;loss+=down;if(run===n){gain/=n;loss/=n;}}
      else{gain=(gain*(n-1)+up)/n;loss=(loss*(n-1)+down)/n;}
      if(run>=n)out[index]=loss===0?(gain===0?50:100):100-100/(1+gain/loss);
    }return out;
  }
  function bollinger(values,length,multiplier=2){
    const n=period(length),middle=sma(values,n),upper=Array(values.length).fill(null),lower=Array(values.length).fill(null),k=finite(multiplier)?multiplier:2;
    middle.forEach((mean,index)=>{if(mean===null)return;let squared=0;for(let j=index-n+1;j<=index;j++)squared+=(values[j]-mean)**2;const width=k*Math.sqrt(squared/n);upper[index]=mean+width;lower[index]=mean-width;});return {middle,upper,lower};
  }
  function macd(values,fast=12,slow=26,signalLength=9){
    const fastValues=ema(values,fast),slowValues=ema(values,slow),line=values.map((_,i)=>finite(fastValues[i])&&finite(slowValues[i])?fastValues[i]-slowValues[i]:null),signal=ema(line,signalLength),histogram=line.map((value,i)=>finite(value)&&finite(signal[i])?value-signal[i]:null);return {line,signal,histogram};
  }
  function donchian(rows,length){
    const n=period(length),upper=Array(rows.length).fill(null),lower=Array(rows.length).fill(null);
    for(let index=n;index<rows.length;index++){
      let high=-Infinity,low=Infinity,valid=true;
      for(let j=index-n;j<index;j++){const bar=rows[j];if(!bar||!finite(bar.h)||!finite(bar.l)||bar.h<bar.l){valid=false;break;}high=Math.max(high,bar.h);low=Math.min(low,bar.l);}
      if(valid){upper[index]=high;lower[index]=low;}
    }return {upper,lower};
  }
  function atr(rows,length=20){
    const n=period(length),out=Array(rows.length).fill(null);let previousClose=null,previous=null,seed=0,run=0;
    rows.forEach((bar,index)=>{
      if(!bar||![bar.h,bar.l,bar.c].every(finite)||bar.h<bar.l||bar.c<bar.l||bar.c>bar.h){previousClose=null;previous=null;seed=0;run=0;return;}
      // At the start of the available history, H−L is the only known true range.
      const range=previousClose===null?bar.h-bar.l:Math.max(bar.h-bar.l,Math.abs(bar.h-previousClose),Math.abs(bar.l-previousClose));previousClose=bar.c;
      if(previous===null){seed+=range;run++;if(run===n)previous=seed/n;}else previous=((n-1)*previous+range)/n;
      out[index]=previous;
    });return out;
  }
  function create(host){
    const palette={bg:'#080c11',grid:'#172330',muted:'#687c93',text:'#becbdb',blue:'#7db9ed',up:'#37caaa',down:'#ee6c7d',gold:'#d5b471',violet:'#b19be8'};
    const defaults={sma:200,emas:[20,50,100,200],bb:20,bbMult:2,rsi:14,macdFast:12,macdSlow:26,macdSignal:9,atr:20};
    let options={symbol:'',label:'Market',currency:'USD',style:'1',studies:[],volume:true,futureSpace:.2,intervalSeconds:0,settings:{...defaults}};
    let bars=[],studies={},view={start:0,count:0},width=0,height=0,ratio=1,headerBottom=79,futureSlots=0,panes=[],mode='pan',scale='linear',effectiveScale='linear',drawings=[],history=[],pending=null,pointer=null,drag=null,destroyed=false;
    const canvas=document.createElement('canvas'),legend=document.createElement('div'),ctx=canvas.getContext('2d');
    if(!ctx)throw Error('This browser does not provide a Canvas 2D context.');
    host.style.position='relative';host.style.overflow='hidden';
    Object.assign(canvas.style,{display:'block',width:'100%',height:'100%',touchAction:'none',outline:'none'});
    canvas.tabIndex=0;canvas.setAttribute('role','img');canvas.setAttribute('aria-label','Interactive market chart. Drag to pan, scroll to zoom. Arrow keys pan, plus and minus zoom, Home resets.');
    Object.assign(legend.style,{position:'absolute',top:'7px',left:'12px',right:'92px',font:'10px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace',color:palette.text,pointerEvents:'auto',whiteSpace:'pre',overflowX:'auto',overflowY:'hidden',scrollbarWidth:'thin',touchAction:'pan-x'});
    legend.tabIndex=0;legend.setAttribute('role','status');legend.setAttribute('aria-live','off');legend.setAttribute('aria-label','Chart values. Scroll horizontally to inspect every value.');
    host.append(canvas,legend);
    const listeners=[];
    function listen(target,event,handler,config){target.addEventListener(event,handler,config);listeners.push(()=>target.removeEventListener(event,handler,config));}
    const fmt=(value,digits)=>{if(!finite(value))return '—';const absolute=Math.abs(value);if(digits===undefined&&absolute>0&&absolute<1e-6)return value.toExponential(3);return value.toLocaleString('en-US',{maximumFractionDigits:digits??(absolute<1?Math.min(10,Math.max(6,3-Math.floor(Math.log10(absolute||1)))):absolute<100?3:2)});};
    const compact=value=>finite(value)?new Intl.NumberFormat('en-US',{notation:'compact',maximumFractionDigits:1}).format(value):'—';
    const utc=(time,short=false)=>{const date=new Date(time*1000);return short?date.toISOString().slice(5,16).replace('T',' '):date.toISOString().slice(0,16).replace('T',' ')+' UTC';};
    const plot=()=>({left:12,right:Math.max(13,width-90),width:Math.max(1,width-102)});
    const totalSlots=()=>bars.length+futureSlots;
    const stepSeconds=()=>finite(options.intervalSeconds)&&options.intervalSeconds>0?options.intervalSeconds:bars.length>1?Math.max(1,bars[bars.length-1].t-bars[bars.length-2].t):3600;
    function updateFutureSlots(){const requested=Number(options.futureSpace);options.futureSpace=finite(requested)?clamp(requested,0,.75):.2;futureSlots=Math.ceil(Math.min(180,bars.length)*options.futureSpace/(1-options.futureSpace));}
    function constrain(){const total=totalSlots();view.count=clamp(view.count||total,Math.min(12,total),total);view.start=clamp(view.start,0,Math.max(0,Math.min(bars.length-Math.min(2,bars.length),total-view.count)));}
    const visible=()=>({first:Math.max(0,Math.floor(view.start)),last:Math.min(bars.length-1,Math.ceil(view.start+view.count)-1)});
    const xAt=index=>{const p=plot();return p.left+(index-view.start+.5)*p.width/(view.count||1);};
    const indexAt=x=>{const p=plot();return clamp(view.start+(x-p.left)/p.width*view.count-.5,0,Math.max(0,totalSlots()-1));};
    function timeAt(index){if(!bars.length)return 0;if(index>=bars.length-1)return bars[bars.length-1].t+(index-bars.length+1)*stepSeconds();const lower=Math.max(0,Math.floor(index)),upper=Math.min(bars.length-1,lower+1);return bars[lower].t+(bars[upper].t-bars[lower].t)*(index-lower);}
    function indexForTime(time){
      if(!bars.length)return 0;if(time<bars[0].t)return (time-bars[0].t)/stepSeconds();if(time>=bars[bars.length-1].t)return bars.length-1+(time-bars[bars.length-1].t)/stepSeconds();let low=0,high=bars.length-1;
      while(low<high){const mid=Math.floor((low+high)/2);if(bars[mid].t<time)low=mid+1;else high=mid;}
      if(low===0)return 0;if(bars[low].t===time)return low;return low-1+(time-bars[low-1].t)/(bars[low].t-bars[low-1].t);
    }
    function layout(){
      const names=['price',...(options.volume?['volume']:[]),...['rsi','macd','atr'].filter(name=>options.studies.includes(name))],weights={price:1,volume:.24,rsi:.3,macd:.3,atr:.3};
      const top=headerBottom,bottom=height-27,gap=10,space=Math.max(20,bottom-top-gap*(names.length-1)),total=names.reduce((sum,name)=>sum+weights[name],0);let y=top;
      panes=names.map(name=>{const pane={name,top:y,bottom:y+space*weights[name]/total,min:0,max:1};y=pane.bottom+gap;return pane;});
    }
    function domains(){
      const {first,last}=visible();effectiveScale=scale;const price=panes[0],values=[];
      for(let i=first;i<=last;i++){values.push(bars[i].l,bars[i].h);if(options.studies.includes('sma'))values.push(studies.sma[i]);if(options.studies.includes('ema'))studies.emas.forEach(item=>values.push(item.values[i]));if(options.studies.includes('bb'))values.push(studies.bb.lower[i],studies.bb.upper[i]);if(options.studies.includes('turtle'))for(const length of [10,20,55])values.push(studies.turtle[length].lower[i],studies.turtle[length].upper[i]);}
      const good=values.filter(finite);let min=good.length?Math.min(...good):0,max=good.length?Math.max(...good):1;
      if(scale==='log'&&min<=0)effectiveScale='linear';
      if(effectiveScale==='log'){min=Math.log(min);max=Math.log(max);}const pad=Math.max((max-min)*.075,effectiveScale==='log'?.001:Math.abs(max)*.0001||1);price.min=min-pad;price.max=max+pad;
      panes.slice(1).forEach(pane=>{
        if(pane.name==='rsi'){pane.min=0;pane.max=100;return;}
        const data=pane.name==='volume'?bars.map(bar=>bar.v):pane.name==='atr'?studies.atr:studies.macd.line.map((value,i)=>[value,studies.macd.signal[i],studies.macd.histogram[i]]),range=[0];
        for(let i=first;i<=last;i++){const values=Array.isArray(data[i])?data[i]:[data[i]];range.push(...values.filter(finite));}
        pane.min=Math.min(...range);pane.max=Math.max(...range)||1;if(pane.name==='macd'){const pad=(pane.max-pane.min)*.1||.1;pane.min-=pad;pane.max+=pad;}
      });
    }
    function yAt(value,pane){if(pane.name==='price'&&effectiveScale==='log')value=Math.log(Math.max(Number.MIN_VALUE,value));return pane.bottom-(value-pane.min)/(pane.max-pane.min)*(pane.bottom-pane.top);}
    function valueAt(y,pane){const value=pane.min+(pane.bottom-y)/(pane.bottom-pane.top)*(pane.max-pane.min);return pane.name==='price'&&effectiveScale==='log'?Math.exp(value):value;}
    function text(value,x,y,color=palette.muted,align='left'){ctx.fillStyle=color;ctx.textAlign=align;ctx.fillText(value,x,y);}
    function line(x1,y1,x2,y2,color,width=1,dash=[]){ctx.strokeStyle=color;ctx.lineWidth=width;ctx.setLineDash(dash);ctx.beginPath();ctx.moveTo(x1,y1);ctx.lineTo(x2,y2);ctx.stroke();ctx.setLineDash([]);}
    function withClip(pane,draw){const p=plot();ctx.save();ctx.beginPath();ctx.rect(p.left,pane.top,p.width,pane.bottom-pane.top);ctx.clip();draw();ctx.restore();}
    function drawSeries(values,pane,color,lineWidth=1.25){
      const {first,last}=visible();ctx.strokeStyle=color;ctx.lineWidth=lineWidth;ctx.beginPath();let open=false;
      for(let i=Math.max(0,first-1);i<=Math.min(bars.length-1,last+1);i++){if(!finite(values[i])){open=false;continue;}const x=xAt(i),y=yAt(values[i],pane);if(open)ctx.lineTo(x,y);else{ctx.moveTo(x,y);open=true;}}ctx.stroke();
    }
    function drawSteps(values,pane,color,dash=[]){
      const {first,last}=visible(),half=plot().width/view.count/2;ctx.strokeStyle=color;ctx.lineWidth=1.2;ctx.setLineDash(dash);ctx.beginPath();let open=false,previousY=0;
      for(let i=Math.max(0,first-1);i<=Math.min(bars.length-1,last+1);i++){
        if(!finite(values[i])){open=false;continue;}const left=xAt(i)-half,right=xAt(i)+half,y=yAt(values[i],pane);
        if(open){ctx.lineTo(left,previousY);ctx.lineTo(left,y);}else{ctx.moveTo(left,y);open=true;}
        ctx.lineTo(right,y);previousY=y;
      }ctx.stroke();ctx.setLineDash([]);
    }
    function drawAxes(){
      const p=plot();ctx.font='10px ui-monospace,SFMono-Regular,Menlo,monospace';
      panes.forEach(pane=>{
        const divisions=pane.name==='price'?Math.max(2,Math.min(6,Math.floor((pane.bottom-pane.top)/50))):2;
        for(let i=0;i<=divisions;i++){const y=pane.top+(pane.bottom-pane.top)*i/divisions,value=valueAt(y,pane);line(p.left,y,p.right,y,palette.grid);text(pane.name==='volume'?compact(value):fmt(value,pane.name==='rsi'?0:undefined),p.right+8,y+3);}
        if(pane.name!=='price')text(pane.name==='volume'?'VOLUME':pane.name==='rsi'?`RSI ${options.settings.rsi}`:pane.name==='atr'?`ATR ${options.settings.atr}${options.settings.atr===20?' (N)':''}${options.currency?' · '+options.currency:''}`:'MACD',p.left+4,pane.top+12,palette.text);
      });
      const ticks=Math.max(2,Math.floor(p.width/125)),last=panes[panes.length-1];
      for(let i=0;i<ticks;i++){const index=clamp(Math.round(view.start+(i+.5)*view.count/ticks),0,totalSlots()-1),x=xAt(index),iso=new Date(timeAt(index)*1000).toISOString(),label=options.intervalSeconds>=604800?iso.slice(0,7):options.intervalSeconds>=86400?iso.slice(0,10):utc(timeAt(index),true);panes.forEach(pane=>line(x,pane.top,x,pane.bottom,palette.grid));text(label+(index>=bars.length?' proj.':''),x,last.bottom+19,palette.muted,'center');}
    }
    function drawProjectedSpace(){
      const p=plot(),edge=xAt(bars.length-1)+p.width/view.count/2,start=Math.max(p.left,edge);if(!futureSlots||start>=p.right)return;
      panes.forEach(pane=>{ctx.fillStyle='#0d131d';ctx.fillRect(start,pane.top,p.right-start,pane.bottom-pane.top);line(start,pane.top,start,pane.bottom,'#3d4c60',1,[3,4]);});
      ctx.save();ctx.beginPath();ctx.rect(start,panes[0].top,p.right-start,20);ctx.clip();text(p.right-start<130?'PROJ.':'PROJECTED · NO DATA',start+5,panes[0].top+13,palette.muted);ctx.restore();
    }
    function drawBars(){
      const p=plot(),price=panes[0],{first,last}=visible(),step=p.width/view.count,body=Math.max(1,Math.min(14,step*.64));
      withClip(price,()=>{
        if(options.style==='2')drawSeries(bars.map(bar=>bar.c),price,palette.blue,1.6);
        else for(let i=first;i<=last;i++){const bar=bars[i],x=xAt(i),color=bar.c>=bar.o?palette.up:palette.down;line(x,yAt(bar.h,price),x,yAt(bar.l,price),color);ctx.fillStyle=color;const top=Math.min(yAt(bar.o,price),yAt(bar.c,price));ctx.fillRect(x-body/2,top,body,Math.max(1,Math.abs(yAt(bar.o,price)-yAt(bar.c,price))));}
        if(options.studies.includes('bb')){drawSeries(studies.bb.upper,price,palette.violet);drawSeries(studies.bb.middle,price,'#756a99');drawSeries(studies.bb.lower,price,palette.violet);}
        if(options.studies.includes('sma'))drawSeries(studies.sma,price,palette.blue);
        if(options.studies.includes('ema'))studies.emas.forEach((item,index)=>drawSeries(item.values,price,[palette.gold,'#dc8fbd','#79c3bd',palette.blue,palette.violet][index%5]));
        if(options.studies.includes('turtle'))for(const [length,color,dash] of [[55,palette.blue,[]],[20,palette.gold,[]],[10,palette.violet,[4,3]]]){drawSteps(studies.turtle[length].upper,price,color,dash);drawSteps(studies.turtle[length].lower,price,color,dash);}
      });
      panes.slice(1).forEach(pane=>withClip(pane,()=>{
        if(pane.name==='volume')for(let i=first;i<=last;i++){ctx.fillStyle=bars[i].c>=bars[i].o?'#237e70':'#914454';ctx.fillRect(xAt(i)-body/2,yAt(bars[i].v,pane),body,Math.max(1,pane.bottom-yAt(bars[i].v,pane)));}
        if(pane.name==='rsi'){line(p.left,yAt(30,pane),p.right,yAt(30,pane),'#5a506e',1,[3,4]);line(p.left,yAt(70,pane),p.right,yAt(70,pane),'#5a506e',1,[3,4]);drawSeries(studies.rsi,pane,palette.violet);}
        if(pane.name==='macd'){for(let i=first;i<=last;i++){const value=studies.macd.histogram[i];if(!finite(value))continue;ctx.fillStyle=value>=0?palette.up:palette.down;const y=yAt(value,pane),zero=yAt(0,pane);ctx.fillRect(xAt(i)-body/2,Math.min(y,zero),body,Math.max(1,Math.abs(y-zero)));}drawSeries(studies.macd.line,pane,palette.blue);drawSeries(studies.macd.signal,pane,palette.gold);}
        if(pane.name==='atr')drawSeries(studies.atr,pane,palette.gold);
      }));
      const latest=bars[last];if(!latest)return;const lastY=yAt(latest.c,price);if(lastY>=price.top&&lastY<=price.bottom){line(p.left,lastY,p.right,lastY,latest.c>=latest.o?'#275d53':'#683a47',1,[3,4]);ctx.fillStyle=latest.c>=latest.o?palette.up:palette.down;ctx.fillRect(p.right+2,lastY-8,72,16);text(fmt(latest.c),p.right+7,lastY+3,palette.bg);}
    }
    function drawingPoint(event){const price=panes[0];if(!bars.length||!price||event.y<price.top||event.y>price.bottom)return null;return {t:timeAt(indexAt(event.x)),value:valueAt(event.y,price)};}
    function drawAnnotations(){
      const p=plot(),price=panes[0];withClip(price,()=>{
        const all=[...drawings];if(pending&&pointer){const next=drawingPoint(pointer);if(next)all.push({type:'trend',a:pending,b:next});}
        all.forEach(drawing=>{if(drawing.type==='horizontal'){const y=yAt(drawing.value,price);if(!finite(y))return;line(p.left,y,p.right,y,palette.gold,1,[6,3]);text(fmt(drawing.value),p.left+5,y-5,palette.gold);}else{const x1=xAt(indexForTime(drawing.a.t)),y1=yAt(drawing.a.value,price),x2=xAt(indexForTime(drawing.b.t)),y2=yAt(drawing.b.value,price);if(![x1,y1,x2,y2].every(finite))return;line(x1,y1,x2,y2,palette.gold,1.5);for(const [x,y] of [[x1,y1],[x2,y2]]){ctx.fillStyle=palette.gold;ctx.fillRect(x-2,y-2,4,4);}}});
      });
    }
    function updateLegend(){
      if(!bars.length){legend.textContent=`${options.label||options.symbol} · No market data`;return;}
      const index=pointer?Math.round(indexAt(pointer.x)):bars.length-1,bar=bars[index],parts=[],turtleLines=[];
      if(index>=bars.length){legend.textContent=`${options.symbol} · ${utc(timeAt(index))} · PROJECTED\nProjected space / no market data\n+${index-bars.length+1} bars · Drawing space only`;legend.title=legend.textContent;return;}
      if(options.studies.includes('sma'))parts.push(`SMA ${options.settings.sma} ${fmt(studies.sma[index])}`);
      if(options.studies.includes('ema'))studies.emas.forEach(item=>parts.push(`EMA ${item.length} ${fmt(item.values[index])}`));
      if(options.studies.includes('bb'))parts.push(`BB ${fmt(studies.bb.lower[index])} / ${fmt(studies.bb.upper[index])}`);
      if(options.studies.includes('rsi'))parts.push(`RSI ${fmt(studies.rsi[index],2)}`);
      if(options.studies.includes('macd'))parts.push(`MACD ${fmt(studies.macd.line[index])} / SIG ${fmt(studies.macd.signal[index])} / HIST ${fmt(studies.macd.histogram[index])}`);
      if(options.studies.includes('turtle')){
        const unit=options.intervalSeconds===86400?'d':' bars',range=(length,exit=false)=>{const channel=studies.turtle[length];return exit?`long L ${fmt(channel.lower[index])} / short H ${fmt(channel.upper[index])}`:`H ${fmt(channel.upper[index])} / L ${fmt(channel.lower[index])}`;};
        turtleLines.push(`Turtle S1 entry 20${unit} ${range(20)} · S2 entry 55${unit} ${range(55)}`,`S1 exit 10${unit} ${range(10,true)} · S2 exit 20${unit} ${range(20,true)}`);
      }
      if(options.studies.includes('atr'))parts.push(`ATR ${options.settings.atr}${options.settings.atr===20?' (N)':''} ${fmt(studies.atr[index])}${options.currency?' '+options.currency:''}`);
      if(options.volume)parts.push(`VOL ${compact(bar.v)}`);
      const scaleLabel=scale==='log'?(effectiveScale==='log'?' · LOG':' · LINEAR (nonpositive data)'):'';
      legend.textContent=[`${options.symbol} · ${utc(bar.t)}${scaleLabel}`,`O ${fmt(bar.o)} H ${fmt(bar.h)} L ${fmt(bar.l)} C ${fmt(bar.c)} ${options.currency||''}`,...turtleLines,parts.join(' · ')].join('\n');
      legend.title=legend.textContent;
    }
    function drawCrosshair(){
      if(!pointer||!bars.length)return;const p=plot(),pane=panes.find(item=>pointer.y>=item.top&&pointer.y<=item.bottom);if(!pane)return;
      const index=Math.round(indexAt(pointer.x)),x=xAt(index);panes.forEach(item=>line(x,item.top,x,item.bottom,'#536b82',1,[3,4]));line(p.left,pointer.y,p.right,pointer.y,'#536b82',1,[3,4]);
      ctx.fillStyle='#344a60';ctx.fillRect(p.right+2,pointer.y-8,72,16);text(pane.name==='volume'?compact(valueAt(pointer.y,pane)):fmt(valueAt(pointer.y,pane)),p.right+7,pointer.y+3,'#f0f5fa');
      const label=utc(timeAt(index),true)+(index>=bars.length?' proj.':''),labelWidth=ctx.measureText(label).width+12,labelX=clamp(x-labelWidth/2,p.left,p.right-labelWidth),bottom=panes[panes.length-1].bottom;ctx.fillStyle='#344a60';ctx.fillRect(labelX,bottom+4,labelWidth,20);text(label,labelX+6,bottom+18,'#f0f5fa');
    }
    function render(){
      if(destroyed||!width||!height)return;ctx.setTransform(ratio,0,0,ratio,0,0);ctx.fillStyle=palette.bg;ctx.fillRect(0,0,width,height);ctx.font='10px ui-monospace,SFMono-Regular,Menlo,monospace';
      if(!bars.length){text('No chart data available',width/2,height/2,palette.muted,'center');updateLegend();return;}
      layout();domains();drawProjectedSpace();drawAxes();drawBars();drawAnnotations();drawCrosshair();updateLegend();
    }
    function layoutLegend(){const legendHeight=options.studies.includes('turtle')?88:Math.min(64,height*.25);legend.style.height=`${legendHeight}px`;legend.style.maxHeight=`${legendHeight}px`;headerBottom=7+legendHeight+8;}
    function resize(){if(destroyed)return;const rect=host.getBoundingClientRect();width=Math.max(1,Math.round(rect.width||host.clientWidth||640));height=Math.max(1,Math.round(rect.height||host.clientHeight||400));ratio=Math.max(1,Math.min(3,window.devicePixelRatio||1));layoutLegend();canvas.width=Math.round(width*ratio);canvas.height=Math.round(height*ratio);render();}
    function setData(nextBars,nextOptions={}){
      if(destroyed)return;const previousSymbol=options.symbol,previousFuture=options.futureSpace,oldLength=bars.length,follow=view.start+view.count>=oldLength-.5;
      options={...options,...nextOptions,studies:[...(nextOptions.studies??options.studies)],settings:{...defaults,...options.settings,...nextOptions.settings}};
      layoutLegend();
      bars=nextBars.filter(bar=>bar&&[bar.t,bar.o,bar.h,bar.l,bar.c].every(finite)).map(bar=>({...bar,v:finite(bar.v)?Math.max(0,bar.v):0})).sort((a,b)=>a.t-b.t);
      updateFutureSlots();const closes=bars.map(bar=>bar.c),settings=options.settings;
      studies={sma:sma(closes,settings.sma),emas:settings.emas.map(length=>({length,values:ema(closes,length)})),bb:bollinger(closes,settings.bb,settings.bbMult),rsi:rsi(closes,settings.rsi),macd:macd(closes,settings.macdFast,settings.macdSlow,settings.macdSignal),atr:atr(bars,settings.atr),turtle:{10:donchian(bars,10),20:donchian(bars,20),55:donchian(bars,55)}};
      if(previousSymbol!==options.symbol||!oldLength||previousFuture!==options.futureSpace){resetView();if(previousSymbol!==options.symbol){drawings=[];history=[];pending=null;}}
      else if(follow)view.start+=bars.length-oldLength;
      constrain();canvas.setAttribute('aria-label',`${options.label||options.symbol} interactive ${options.style==='2'?'line':'candlestick'} chart. ${bars.length} bars. Drag to pan, scroll to zoom. Arrow keys pan, plus and minus zoom, Home resets.`);render();
    }
    function position(event){const rect=canvas.getBoundingClientRect();return {x:(event.clientX-rect.left)*width/rect.width,y:(event.clientY-rect.top)*height/rect.height};}
    function inside(point){const p=plot();return point.x>=p.left&&point.x<=p.right&&point.y>=headerBottom&&point.y<=height-27;}
    function zoom(factor,anchor=.5){if(!bars.length)return;const old=view.count;view.count=clamp(old*factor,Math.min(12,totalSlots()),totalSlots());view.start+=(old-view.count)*anchor;constrain();render();}
    listen(canvas,'wheel',event=>{const point=position(event);if(!inside(point)||!bars.length)return;event.preventDefault();zoom(Math.exp(clamp(event.deltaY,-300,300)*.002),(point.x-plot().left)/plot().width);},{passive:false});
    listen(canvas,'pointerdown',event=>{
      if(event.button!==0||!bars.length)return;const point=position(event);if(!inside(point))return;event.preventDefault();canvas.focus({preventScroll:true});pointer=point;
      if(mode==='pan'){drag={x:point.x,start:view.start,id:event.pointerId};canvas.setPointerCapture(event.pointerId);canvas.style.cursor='grabbing';}
      else{const value=drawingPoint(point);if(!value)return;if(mode==='horizontal'){rememberDrawings();drawings.push({type:'horizontal',value:value.value});}else if(pending){rememberDrawings();drawings.push({type:'trend',a:pending,b:value});pending=null;}else pending=value;}render();
    });
    listen(canvas,'pointermove',event=>{const point=position(event);if(drag){view.start=drag.start-(point.x-drag.x)*view.count/plot().width;constrain();}pointer=inside(point)?point:null;render();});
    function release(event){if(!drag)return;try{canvas.releasePointerCapture(drag.id);}catch{}drag=null;canvas.style.cursor=mode==='pan'?'grab':'crosshair';pointer=inside(position(event))?position(event):null;render();}
    listen(canvas,'pointerup',release);listen(canvas,'pointercancel',release);
    listen(canvas,'pointerleave',()=>{if(!drag){pointer=null;render();}});
    listen(canvas,'dblclick',()=>{if(mode==='pan')resetView();});
    listen(canvas,'keydown',event=>{if(!['ArrowLeft','ArrowRight','+','=','-','Home'].includes(event.key))return;event.preventDefault();if(event.key==='Home')resetView();else if(['+','=','-'].includes(event.key))zoom(event.key==='-'?1.3:1/1.3);else{view.start+=(event.key==='ArrowLeft'?-1:1)*view.count*.1;constrain();render();}});
    function resetView(){const count=Math.min(180,totalSlots()),blank=Math.min(futureSlots,Math.round(count*options.futureSpace)),real=Math.min(bars.length,count-blank);view={start:Math.max(0,bars.length-real),count};pointer=null;constrain();render();}
    function setFutureSpace(fraction){if(!finite(Number(fraction)))return;options.futureSpace=clamp(Number(fraction),0,.75);updateFutureSlots();resetView();}
    function setMode(value){mode=['pan','trend','horizontal'].includes(value)?value:'pan';pending=null;drag=null;canvas.style.cursor=mode==='pan'?'grab':'crosshair';render();}
    function rememberDrawings(){history.push(drawings.slice());if(history.length>50)history.shift();}
    function clearDrawings(){if(drawings.length)rememberDrawings();drawings=[];pending=null;render();}
    function undo(){if(destroyed)return false;if(pending){pending=null;render();return true;}if(!history.length)return false;drawings=history.pop();render();return true;}
    function getWorkspace(){return {drawings:validateDrawings(drawings),undoHistory:history.map(validateDrawings)};}
    function setWorkspace(workspace){
      if(!workspace||typeof workspace!=='object'||Array.isArray(workspace)||Object.keys(workspace).some(key=>!['drawings','undoHistory'].includes(key)))throw Error('Invalid drawing workspace.');
      const nextDrawings=validateDrawings(workspace.drawings);let nextHistory;
      if(workspace.undoHistory===undefined)nextHistory=Array.from({length:Math.min(50,nextDrawings.length)},(_,i)=>nextDrawings.slice(0,Math.max(0,nextDrawings.length-50)+i));
      else{if(!Array.isArray(workspace.undoHistory)||workspace.undoHistory.length>50)throw Error('Drawing undo history must contain at most 50 snapshots.');nextHistory=Array.from(workspace.undoHistory,validateDrawings);}
      // Validate every snapshot before changing live drawing, gesture or history state.
      if(drag){try{canvas.releasePointerCapture(drag.id);}catch{}}
      drawings=nextDrawings;history=nextHistory;pending=null;drag=null;pointer=null;canvas.style.cursor=mode==='pan'?'grab':'crosshair';render();
    }
    function setScale(value){scale=value==='log'?'log':'linear';render();}
    function toDataURL(){
      // The accessible legend is DOM text; paint its current viewport into PNGs.
      ctx.save();ctx.setTransform(ratio,0,0,ratio,0,0);ctx.fillStyle=palette.bg;ctx.fillRect(0,0,width,headerBottom);ctx.beginPath();ctx.rect(12,7,plot().width,headerBottom-15);ctx.clip();ctx.font='10px ui-monospace,SFMono-Regular,Menlo,monospace';
      legend.textContent.split('\n').forEach((value,index)=>text(value,12-(legend.scrollLeft||0),19+index*16,palette.text));ctx.restore();const result=canvas.toDataURL('image/png');render();return result;
    }
    function getSnapshot(){return {symbol:options.symbol,bars:bars.length,panes:panes.map(pane=>pane.name),visible:{start:view.start,count:view.count,end:view.start+view.count},futureSpace:options.futureSpace,futureSlots,drawings:drawings.length,drawingItems:drawings.map(drawing=>drawing.type==='trend'?{...drawing,a:{...drawing.a},b:{...drawing.b}}:{...drawing}),pending:!!pending,canUndo:!!pending||history.length>0,mode,scale,effectiveScale,width,height};}
    const observer=typeof ResizeObserver!=='undefined'?new ResizeObserver(resize):null;if(observer)observer.observe(host);else listen(window,'resize',resize);
    canvas.style.cursor='grab';resize();
    return {setData,resize,resetView,setMode,clearDrawings,undo,getWorkspace,setWorkspace,setScale,setFutureSpace,toDataURL,getSnapshot,destroy(){destroyed=true;observer?.disconnect();listeners.forEach(remove=>remove());canvas.remove();legend.remove();bars=[];drawings=[];history=[];pending=null;}};
  }
  return {create,validateDrawings,indicators:{sma,ema,rsi,bollinger,macd,donchian,atr}};
})();
