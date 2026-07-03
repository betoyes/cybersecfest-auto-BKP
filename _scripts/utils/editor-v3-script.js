'use strict';

/** Script do editor visual v3 — alinhamento por elemento + persistência */
function editorV3Script(slug, opts = {}) {
  const _saveUrl    = opts.saveUrl    || (slug.startsWith('cast-') ? '/api/cast/arte/salvar' : '/api/arte/salvar');
  const _previewUrl = opts.previewUrl || '';
  return `(function(){
var BG=document.getElementById('art-bg');
var OL=document.getElementById('art-overlay');
var CV=document.getElementById('the-canvas');
var LOGO=document.getElementById('el-logo')||document.querySelector('.logo-img,.logo-cyberfest,.art-content .lg');
var TITL=document.getElementById('el-title')||document.querySelector('#el-title,.headline,.hl,h1.headline');
var SUB=document.getElementById('el-sub')||document.querySelector('#el-sub,.subtitulo,.subtitle,.sb');
var ECO=document.getElementById('el-eco');
var CTA=document.getElementById('el-cta');
var OLS={original:null,dark:'rgba(2,5,10,.92)',
  light:'radial-gradient(ellipse at center,rgba(255,255,255,.10) 0%,rgba(2,5,10,.78) 100%)',
  accent:'linear-gradient(135deg,rgba(20,168,244,.40) 0%,rgba(2,5,10,.85) 100%)',
  none:'rgba(0,0,0,0)'};
var isCast='${slug}'.startsWith('cast-');
var S={x:50,y:50,z:110,bo:100,fl:false,sat:100,oo:100,bgc:'#02050A',ol:'original',fw:'700',
  tta:'center',sta:'center',
  lx:0,ly:0,ls:100,lo:100,tx:0,ty:0,ts:100,sx:0,sy:0,ex:0,ey:0,eo:75,
  ct:'',cx:0,cy:0};

function normAlign(ta){
  if(!ta||ta==='start')return'left';
  if(ta==='end')return'right';
  if(ta==='center'||ta==='left'||ta==='right')return ta;
  return'left';
}
function detectAlign(el){
  if(!el)return'center';
  var p=el.closest('.ct,.bc,.bb,.lc,.tc,.art-content');
  if(p){
    var pt=normAlign(getComputedStyle(p).textAlign);
    if(pt&&pt!=='left')return pt;
  }
  return normAlign(getComputedStyle(el).textAlign);
}
function alignSelf(ta){return ta==='center'?'center':ta==='right'?'flex-end':'flex-start';}
function transformOrigin(ta){return ta==='center'?'50% 0':ta==='right'?'100% 0':'0 0';}

function applyAlign(el,ta){
  if(!el)return;
  el.style.textAlign=ta;
  var p=el.parentElement;
  if(p&&getComputedStyle(p).display.indexOf('flex')>=0){
    el.style.alignSelf=alignSelf(ta);
  }
}

function uBg(){
  if(!BG)return;
  var flt=S.sat===100?'none':'saturate('+(S.sat/100)+')';
  if(BG.tagName==='IMG'){
    var z=S.z/100;
    var nw=BG.naturalWidth||1,nh=BG.naturalHeight||1;
    var cw=BG.offsetWidth||1,ch=BG.offsetHeight||1;
    var nr=nw/nh,cr=cw/ch;
    // overflow from object-fit:cover
    var xOvf=nr>cr?(nw*ch/nh-cw):0;
    var yOvf=nr<=cr?(nh*cw/nw-ch):0;
    // additional overflow from scale
    var totalX=xOvf+cw*(z-1);
    var totalY=yOvf+ch*(z-1);
    var tx=-(S.x-50)/50*(totalX/2);
    var ty=-(S.y-50)/50*(totalY/2);
    BG.style.objectPosition='50% 50%';
    BG.style.transform=(S.fl?'scaleX(-1) ':'')+'translate('+tx+'px,'+ty+'px) scale('+z+')';
    BG.style.opacity=S.bo/100;
    BG.style.filter=flt;
  }else{
    BG.style.backgroundPosition=S.x+'% '+S.y+'%';
    BG.style.backgroundSize=S.z<=100?'cover':S.z+'%';
    BG.style.opacity=S.bo/100;
    BG.style.transform=S.fl?'scaleX(-1)':'none';
    BG.style.filter=flt;
  }
}
function uOL(){
  if(!OL)return;
  OL.style.opacity=S.oo/100;
  if(S.ol==='original'){
    OL.style.removeProperty('background');
    OL.style.removeProperty('background-image');
  }else{
    OL.style.background=OLS[S.ol]||'';
  }
}
function uCV(){if(CV)CV.style.backgroundColor=S.bgc;}
function uTxt(){
  document.querySelectorAll('#el-title,.headline,.hl,.art-content h1').forEach(function(h){
    h.style.fontWeight=S.fw;
  });
  applyAlign(TITL,S.tta);
  applyAlign(SUB,S.sta);
}
function uEl(){
  if(LOGO){LOGO.style.transform='translate('+S.lx+'px,'+S.ly+'px) scale('+(S.ls/100)+')';LOGO.style.transformOrigin='0 50%';LOGO.style.opacity=S.lo/100;}
  if(TITL){
    TITL.style.transform='translate('+S.tx+'px,'+S.ty+'px) scale('+(S.ts/100)+')';
    TITL.style.transformOrigin=transformOrigin(S.tta);
  }
  if(SUB){
    SUB.style.transform='translate('+S.sx+'px,'+S.sy+'px)';
    SUB.style.transformOrigin=transformOrigin(S.sta);
  }
  if(ECO){
    ECO.style.transform=(S.ex||S.ey)?('translate('+S.ex+'px,'+S.ey+'px)'):'';
    ECO.querySelectorAll('img').forEach(function(i){i.style.opacity=S.eo/100;});
  }
  uCta();
}
function uCta(){
  if(!CTA)return;
  CTA.style.transform=(S.cx||S.cy)?('translate('+S.cx+'px,'+S.cy+'px)'):'';
  if(S.ct){
    var arrow=CTA.querySelector('.pill-arrow');
    CTA.textContent=S.ct;
    if(arrow)CTA.appendChild(arrow);
    else CTA.insertAdjacentHTML('beforeend',' <span class="pill-arrow">→</span>');
  }
}
function all(){uBg();uOL();uCV();uTxt();uEl();}

function setSeg(id,val){
  document.querySelectorAll('#'+id+' .ep-sb').forEach(function(b){
    b.classList.toggle('on',b.dataset.v===val);
  });
}
function setSlider(id,k,vid,suf,val){
  var e=document.getElementById(id),v=document.getElementById(vid);
  if(e)e.value=val;
  if(v)v.textContent=val+suf;
  S[k]=typeof val==='number'?val:parseFloat(val);
}

function loadState(){
  var saved=document.getElementById('editor-state');
  if(saved){
    try{
      var raw=JSON.parse(saved.textContent);
      if(raw.ta&&!raw.tta)raw.tta=raw.ta;
      if(raw.ta&&!raw.sta)raw.sta=raw.ta;
      Object.assign(S,raw);
      if(raw.pb&&!('sat' in raw))S.sat=0;
      return;
    }catch(e){}
  }
  S.tta=detectAlign(TITL);
  S.sta=detectAlign(SUB);
  if(CTA){
    var clone=CTA.cloneNode(true);
    var ar=clone.querySelector('.pill-arrow');
    if(ar)ar.remove();
    S.ct=clone.textContent.trim();
  }
}

function setTog(id,on){
  var b=document.getElementById(id);
  if(b)b.classList.toggle('on',!!on);
}

function syncUi(){
  setSlider('sx','x','vx','%',S.x);
  setSlider('sy','y','vy','%',S.y);
  setSlider('sz','z','vz','%',S.z);var vzEl=document.getElementById('vz');if(vzEl)vzEl.textContent=S.z<=100?'cover':S.z+'%';
  setSlider('sbo','bo','vbo','%',S.bo);
  setSlider('ssat','sat','vsat','%',S.sat);
  setSlider('soo','oo','voo','%',S.oo);
  setSlider('slx','lx','vlx','px',S.lx);
  setSlider('sly','ly','vly','px',S.ly);
  setSlider('sls','ls','vls','%',S.ls);
  setSlider('slo','lo','vlo','%',S.lo);
  setSlider('stx','tx','vtx','px',S.tx);
  setSlider('sty','ty','vty','px',S.ty);
  setSlider('sts','ts','vts','%',S.ts);
  setSlider('ssx','sx','vsx','px',S.sx);
  setSlider('ssy','sy','vsy','px',S.sy);
  setSlider('sex','ex','vex','px',S.ex);
  setSlider('sey','ey','vey','px',S.ey);
  setSlider('seo','eo','veo','%',S.eo);
  setSlider('scx','cx','vcx','px',S.cx);
  setSlider('scy','cy','vcy','px',S.cy);
  var ctaTxt=document.getElementById('ctaTxt');
  if(ctaTxt)ctaTxt.value=S.ct||'';
  setTog('btnFlip',S.fl);
  var cp=document.getElementById('cpick'),ch=document.getElementById('chex');
  if(cp)cp.value=S.bgc;if(ch)ch.value=S.bgc;
  var os=document.getElementById('ols');if(os)os.value=S.ol||'original';
  setSeg('fwseg',String(S.fw));
  setSeg('ttaseg',S.tta);
  setSeg('staseg',S.sta);
}

function sl(id,k,vid,suf,fn){
  var e=document.getElementById(id),v=document.getElementById(vid);
  if(!e)return;
  e.addEventListener('input',function(){S[k]=parseFloat(this.value);if(v)v.textContent=this.value+suf;fn();});
}
sl('sx','x','vx','%',uBg);sl('sy','y','vy','%',uBg);sl('sz','z','vz','%',uBg);sl('sbo','bo','vbo','%',uBg);sl('ssat','sat','vsat','%',uBg);
sl('soo','oo','voo','%',uOL);
sl('slx','lx','vlx','px',uEl);sl('sly','ly','vly','px',uEl);sl('sls','ls','vls','%',uEl);sl('slo','lo','vlo','%',uEl);
sl('stx','tx','vtx','px',uEl);sl('sty','ty','vty','px',uEl);sl('sts','ts','vts','%',uEl);
sl('ssx','sx','vsx','px',uEl);sl('ssy','sy','vsy','px',uEl);
sl('sex','ex','vex','px',uEl);sl('sey','ey','vey','px',uEl);sl('seo','eo','veo','%',uEl);
sl('scx','cx','vcx','px',uCta);sl('scy','cy','vcy','px',uCta);

var ctaTxt=document.getElementById('ctaTxt');
if(ctaTxt)ctaTxt.addEventListener('input',function(){S.ct=this.value.toUpperCase();uCta();});

function bindSeg(id,key,fn){
  document.querySelectorAll('#'+id+' .ep-sb').forEach(function(b){
    b.addEventListener('click',function(){
      document.querySelectorAll('#'+id+' .ep-sb').forEach(function(x){x.classList.remove('on');});
      this.classList.add('on');S[key]=this.dataset.v;fn();
    });
  });
}

var btnFlip=document.getElementById('btnFlip');
if(btnFlip)btnFlip.addEventListener('click',function(){S.fl=!S.fl;setTog('btnFlip',S.fl);uBg();});

var cp=document.getElementById('cpick'),ch=document.getElementById('chex');
if(cp)cp.addEventListener('input',function(){S.bgc=this.value;if(ch)ch.value=this.value;uCV();});
if(ch)ch.addEventListener('input',function(){var v=this.value.trim();if(/^#[0-9a-fA-F]{6}$/.test(v)){S.bgc=v;if(cp)cp.value=v;uCV();}});

var os=document.getElementById('ols');
if(os)os.addEventListener('change',function(){S.ol=this.value;uOL();});

bindSeg('fwseg','fw',uTxt);
bindSeg('ttaseg','tta',function(){uTxt();uEl();});
bindSeg('staseg','sta',function(){uTxt();uEl();});

var rstAll=document.getElementById('rstAll');
if(rstAll)rstAll.addEventListener('click',function(){
  S.x=50;S.y=50;S.z=100;S.bo=100;S.fl=false;S.sat=100;S.oo=100;S.bgc='#02050A';S.ol='original';S.fw='700';
  syncUi();all();
});

var rstEl=document.getElementById('rstEl');
if(rstEl)rstEl.addEventListener('click',function(){
  S.lx=0;S.ly=0;S.ls=100;S.lo=100;S.tx=0;S.ty=0;S.ts=100;S.sx=0;S.sy=0;S.ex=0;S.ey=0;S.eo=75;
  S.cx=0;S.cy=0;
  if(CTA){var c=CTA.cloneNode(true);var a=c.querySelector('.pill-arrow');if(a)a.remove();S.ct=c.textContent.trim();}
  else S.ct='';
  S.tta=detectAlign(TITL);S.sta=detectAlign(SUB);
  setSlider('slx','lx','vlx','px',0);setSlider('sly','ly','vly','px',0);
  setSlider('sls','ls','vls','%',100);setSlider('slo','lo','vlo','%',100);
  setSlider('stx','tx','vtx','px',0);setSlider('sty','ty','vty','px',0);setSlider('sts','ts','vts','%',100);
  setSlider('ssx','sx','vsx','px',0);setSlider('ssy','sy','vsy','px',0);
  setSlider('sex','ex','vex','px',0);setSlider('sey','ey','vey','px',0);setSlider('seo','eo','veo','%',75);
  setSlider('scx','cx','vcx','px',0);setSlider('scy','cy','vcy','px',0);
  var ctaInp=document.getElementById('ctaTxt');if(ctaInp)ctaInp.value=S.ct||'';
  setSeg('ttaseg',S.tta);setSeg('staseg',S.sta);
  all();
});

var btnExport=document.getElementById('btnExport');
if(btnExport)btnExport.addEventListener('click',function(){
  var self=this;self.textContent='⏳ Gerando...';self.classList.add('busy');
  var canvas=document.getElementById('the-canvas');
  var ew=parseInt(canvas.dataset.exportW||'1080',10);
  var eh=parseInt(canvas.dataset.exportH||'1350',10);
  var sc=ew/(canvas.offsetWidth||540);
  var badge=canvas.querySelector('.badge-layout');
  if(badge)badge.style.display='none';
  domtoimage.toPng(canvas,{width:ew,height:eh,quality:1,bgcolor:'#02050A',style:{transform:'scale('+sc+')',transformOrigin:'top left'}}).then(function(dataUrl){
    if(badge)badge.style.display='';
    var a=document.createElement('a');a.download='cybersecfest-${slug}.png';a.href=dataUrl;
    document.body.appendChild(a);a.click();document.body.removeChild(a);
    self.textContent='✓ Baixado!';self.classList.remove('busy');
    setTimeout(function(){self.textContent='⬇ Exportar PNG';},2500);
  }).catch(function(){if(badge)badge.style.display='';self.textContent='⬇ Exportar PNG';self.classList.remove('busy');});
});

var btnSave=document.getElementById('btnSave');
if(btnSave)btnSave.addEventListener('click',function(){
  var self=this;
  self.textContent='⏳ Salvando...';self.classList.add('busy');
  var saveUrl='${_saveUrl}';
  var saveBody={slug:'${slug}',state:S};
  if(SUB)saveBody.subtitle=SUB.innerHTML;
  if(hlEdit)saveBody.headline=hlEdit.value.replace(/\\n/g,'<br>');
  if(hlBlue)saveBody.palavras_azuis=hlBlue.value.trim();
  fetch(saveUrl,{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify(saveBody)
  }).then(function(r){return r.json();}).then(function(data){
    if(data.ok){
      self.textContent='✓ Salvo!';
      var es=document.getElementById('editor-state');
      if(!es){es=document.createElement('script');es.type='application/json';es.id='editor-state';document.body.appendChild(es);}
      es.textContent=JSON.stringify(S);
      if(data.padrao&&data.layout){
        self.textContent='✓ Padrão '+data.layout;
        if(data.message) setTimeout(function(){ alert(data.message); }, 100);
      }
    }else{
      self.textContent='✗ Erro';
      alert(data.erro||'Falha ao salvar');
    }
    self.classList.remove('busy');
    setTimeout(function(){self.textContent='💾 Salvar';},2500);
  }).catch(function(){
    self.textContent='✗ Erro';
    self.classList.remove('busy');
    alert('Salvar só funciona com o servidor local (npm run dev).');
    setTimeout(function(){self.textContent='💾 Salvar';},2500);
  });
});

var tbt=document.querySelector('.tb-title');
if(tbt){var h=document.querySelector('#el-title,.headline,.hl');if(h)tbt.textContent=h.textContent.trim().slice(0,65);}

var ctaSec=document.getElementById('ctaSection');
if(ctaSec&&!CTA)ctaSec.style.display='none';

var subEdit=document.getElementById('subEdit');
if(subEdit&&SUB){
  subEdit.value=(SUB.innerHTML||'').replace(/<br\\s*\\/?>/gi,'\\n').replace(/<[^>]+>/g,'').trim();
  subEdit.addEventListener('input',function(){
    if(SUB)SUB.innerHTML=this.value.replace(/\\n/g,'<br>');
  });
}

var HL_MAX_W=10,HL_MAX_L=5;
function plainHl(el){
  if(!el)return'';
  return(el.innerHTML||'').replace(/<br\\s*\\/?>/gi,' ').replace(/<[^>]+>/g,'').replace(/\\s+/g,' ').trim();
}
function lineHl(el){
  if(!el)return 1;
  var h=el.innerHTML||'';
  if(/<br\\s*\\/?>|\\n/i.test(h))return h.split(/<br\\s*\\/?>|\\n/i).map(function(l){return l.replace(/<[^>]+>/g,'').trim();}).filter(Boolean).length;
  return 1;
}
function blueWordsFromDom(el){
  var out=[];
  if(!el)return out;
  el.querySelectorAll('span[style*="14A8F4"],span[style*="#14a8f4"]').forEach(function(s){
    var t=(s.textContent||'').trim();
    if(t)out.push(t);
  });
  return out;
}
function expectedBlue(){
  var m=document.getElementById('arte-meta');
  if(!m)return[];
  try{
    var j=JSON.parse(m.textContent||'{}');
    return String(j.palavras_azuis||'').split(',').map(function(w){return w.trim();}).filter(Boolean);
  }catch(e){return[];}
}
function updateHlCounter(){
  var box=document.getElementById('hl-counter');
  if(!box||!TITL)return;
  var wc=plainHl(TITL).split(/\\s+/).filter(Boolean).length;
  var lc=lineHl(TITL);
  var ew=document.getElementById('hl-words');
  var el=document.getElementById('hl-lines');
  var eb=document.getElementById('hl-blue');
  var wr=document.getElementById('hl-warn');
  if(ew)ew.textContent=wc+'/'+HL_MAX_W;
  if(el)el.textContent=lc+'/'+HL_MAX_L;
  var blues=blueWordsFromDom(TITL);
  var exp=expectedBlue();
  if(eb)eb.textContent=blues.length?blues.join(', '):(exp.length?exp.join(', ')+' (?)':'—');
  var msgs=[];
  if(wc>HL_MAX_W)msgs.push('Máx '+HL_MAX_W+' palavras');
  if(lc>HL_MAX_L)msgs.push('Máx '+HL_MAX_L+' linhas');
  exp.forEach(function(w){
    if(plainHl(TITL).toLowerCase().indexOf(w.toLowerCase())<0)msgs.push('"'+w+'" não está no título');
  });
  if(wr){wr.hidden=!msgs.length;wr.textContent=msgs.join(' · ');}
  box.classList.toggle('warn',msgs.length>0);
  box.classList.toggle('ok',msgs.length===0&&wc>0);
}
if(TITL){
  updateHlCounter();
  try{
    var mo=new MutationObserver(updateHlCounter);
    mo.observe(TITL,{childList:true,characterData:true,subtree:true});
  }catch(e){setInterval(updateHlCounter,1200);}
}

var hlEdit=document.getElementById('hlEdit');
var hlBlue=document.getElementById('hlBlue');
var ACCENT=isCast?'#6366f1':'#14A8F4';
function getBlueWords(){
  return(hlBlue?hlBlue.value:'').split(/[\\s,]+/).map(function(w){return w.trim().toUpperCase();}).filter(Boolean);
}
function buildTitlHtml(text,bw){
  return text.split('\\n').map(function(line){
    return line.split(' ').map(function(word){
      var clean=word.replace(/[.,!?:;«»"""'']/g,'').toUpperCase();
      return bw.indexOf(clean)>=0?'<span style="color:'+ACCENT+'">'+word+'</span>':word;
    }).join(' ');
  }).join('<br>');
}
if(hlEdit&&TITL){
  var initBlue=[];
  TITL.querySelectorAll('span[style*="color"]').forEach(function(s){var t=(s.textContent||'').trim();if(t)initBlue.push(t.toUpperCase());});
  hlEdit.value=(TITL.innerHTML||'').replace(/<br\\s*\\/?>/gi,'\\n').replace(/<[^>]+>/g,'').trim();
  if(hlBlue)hlBlue.value=initBlue.join(' ');
  function applyTitle(){if(TITL)TITL.innerHTML=buildTitlHtml(hlEdit.value,getBlueWords());}
  hlEdit.addEventListener('input',applyTitle);
  if(hlBlue)hlBlue.addEventListener('input',applyTitle);
}

var FORMATOS={
  feed_vertical:{w:540,h:675,ew:1080,eh:1350,label:'Feed Vertical 4:5',scale:1,offY:0},
  feed_quadrado:{w:540,h:540,ew:1080,eh:1080,label:'Feed Quadrado 1:1',scale:540/675,offY:0},
  // stretch:true = rediagrama (inner acompanha o canvas e o layout reflow);
  // sem stretch seria letterbox (arte 675 fixa + faixas)
  stories:{w:540,h:960,ew:1080,eh:1920,label:'Stories 9:16',scale:1,offY:0,stretch:true}
};
function applyFormato(id){
  var f=FORMATOS[id]||FORMATOS.feed_vertical;
  var cv=document.getElementById('the-canvas');
  if(!cv)return;
  cv.dataset.formato=id;
  cv.dataset.exportW=String(f.ew);
  cv.dataset.exportH=String(f.eh);
  cv.style.width=f.w+'px';
  cv.style.height=f.h+'px';
  var sp=document.getElementById('story-polish');
  if(sp)sp.media=f.stretch?'all':'not all';
  var inner=cv.querySelector('.art-canvas-inner');
  if(inner){
    if(f.stretch){
      inner.style.width=f.w+'px';
      inner.style.height=f.h+'px';
      inner.style.transform='';
      inner.style.transformOrigin='';
      inner.style.marginTop='';
    }else{
      inner.style.width='540px';
      inner.style.height='675px';
      inner.style.transform=f.scale!==1?'scale('+f.scale+')':'';
      inner.style.transformOrigin='top center';
      inner.style.marginTop=f.offY?f.offY+'px':'';
    }
  }
  var fl=document.getElementById('fmtLabel');
  var fd=document.getElementById('fmtDims');
  if(fl)fl.textContent=f.label;
  if(fd)fd.textContent=f.ew+' × '+f.eh+' px';
}
var fmtSel=document.getElementById('fmtSel');
if(fmtSel){
  fmtSel.addEventListener('change',function(){applyFormato(this.value);});
  applyFormato(fmtSel.value||'feed_vertical');
}else if(CV&&CV.dataset.formato){
  applyFormato(CV.dataset.formato);
}

var _pvTimer=null;
function _applyPreview(html){
  var pf=document.getElementById('previewFrame');
  if(!pf)return;
  var h=html.replace(
    "if(location.search.includes('embed'))document.documentElement.classList.add('embed');",
    "document.documentElement.classList.add('embed');"
  );
  pf.srcdoc=h;
  pf.style.opacity='1';
}
function schedulePreview(){
  var pf=document.getElementById('previewFrame');
  if(!pf)return;
  clearTimeout(_pvTimer);
  pf.style.opacity='0.4';
  _pvTimer=setTimeout(function(){
    fetch('${_previewUrl}',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({slug:'${slug}',state:S})
    }).then(function(r){return r.text();}).then(_applyPreview)
    .catch(function(){pf.style.opacity='1';});
  },600);
}
if('${_previewUrl}'){
  var pvPane=document.getElementById('previewPane');
  if(pvPane)pvPane.style.display='';
  var pl=document.getElementById('pl');
  if(pl){
    pl.addEventListener('input',schedulePreview);
    pl.addEventListener('click',function(e){
      if(e.target.classList.contains('ep-sb')||e.target.id==='btnFlip')schedulePreview();
    });
  }
}

loadState();
syncUi();
all();
})();`;
}

module.exports = { editorV3Script };
