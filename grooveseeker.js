(function(){
"use strict";

const CFG={
  PAGE_SIZE:20,
  BATCH_SIZE:6,
  PAC_URL:"https://gsv3.ai/pacman/",
  EVENTS_CSV_URL:"https://huggingface.co/datasets/verdantdavid/gsv3_upcoming_events/resolve/main/gsv3_upcoming_events.csv"
};

const CATS=[
  {key:"music",    label:"Music",        color:"#FF2D78",terms:["concert","band","dj","live music","show","tour","festival","hip hop","jazz","metal","punk","edm","techno","rave","vinyl","singer","rapper","musician","indie","rock","pop","soul","funk","blues","electronic","dance music","performing"]},
  {key:"nightlife",label:"Nightlife",    color:"#FF6B35",terms:["bar","club","nightclub","happy hour","cocktail","brewery","pub","lounge","21+","late night","after party","bottle service","wine","beer","spirits","bartender","mixology","karaoke","drag"]},
  {key:"arts",     label:"Arts",         color:"#9D4EDD",terms:["art","gallery","museum","theatre","theater","poetry","reading","film","movie","exhibition","dance","ballet","opera","comedy","improv","spoken word","literary","author","book","painting","sculpture","performance art","craft"]},
  {key:"family",   label:"Family",       color:"#4CC9F0",terms:["family","kids","children","baby","toddler","all ages","kid-friendly","puppy","dogs","pet","playground","youth","parent","camp","birthday","baby rave"]},
  {key:"wellness", label:"Wellness",     color:"#FFE27A",terms:["yoga","meditation","fitness","wellness","pottery","cooking class","workshop","class","seminar","mindfulness","health","spa","pilates","barre","nutrition","healing","retreat","breathwork","kundalini"]},
  {key:"weird",    label:"Weird & Wild", color:"#C77DFF",terms:["immersive","escape room","cosplay","anime","gaming","trivia","paranormal","psychic","tarot","wrestling","roller derby","burlesque","cabaret","circus","magic","haunted","costume","themed","bizarre","surreal","underground"]}
];

const inferCat=t=>{
  const s=(t||"").toLowerCase();
  for(const c of CATS)if(c.terms.some(w=>s.includes(w)))return c;
  return{key:"other",label:"Event",color:"#9D4EDD"};
};

const parseCSV=raw=>{
  const rows=[];let row=[],field="",inQ=false;
  for(let i=0;i<raw.length;i++){
    const c=raw[i],n=raw[i+1];
    if(inQ){if(c==='"'&&n==='"'){field+='"';i++;continue;}if(c==='"'){inQ=false;continue;}field+=c;continue;}
    if(c==='"'){inQ=true;continue;}
    if(c===','){row.push(field);field="";continue;}
    if(c==='\r'&&n==='\n'){row.push(field);rows.push(row);row=[];field="";i++;continue;}
    if(c==='\n'||c==='\r'){row.push(field);rows.push(row);row=[];field="";continue;}
    field+=c;
  }
  row.push(field);rows.push(row);
  while(rows.length&&rows[rows.length-1].every(v=>!String(v||"").trim()))rows.pop();
  return rows;
};

const safe=v=>v==null?"":String(v);
const strip=s=>safe(s).replace(/<[^>]*>/g," ").replace(/\s+/g," ").trim();
const $=id=>document.getElementById(id);
const $$=sel=>document.querySelectorAll(sel);
const pickLabel=(t,l)=>{const m=safe(t).match(new RegExp("(?:^|\\n)\\s*"+l+"\\s*:\\s*([^\\n\\r]*)","i"));return m&&m[1]?strip(m[1]):"";};
const stripLabels=t=>strip(safe(t).replace(/(?:^|\n)\s*(location|venue|price|country)\s*:\s*[^\n\r]*/ig," ").replace(/\s*\|\s*/g," "));
const fmtDate=v=>{const s=safe(v).trim();const m=s.match(/^(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}(?::\d{2})?)(.*)$/);return m?m[1]+"\n"+m[2]+(m[3]||""):s;};
const inScope=(dv,scope)=>{
  if(!scope||scope==="all")return true;
  const now=new Date(),d=new Date(dv);if(isNaN(d))return true;
  if(scope==="week"){const s=new Date(now);s.setHours(0,0,0,0);const e=new Date(s);e.setDate(e.getDate()+7);return d>=s&&d<e;}
  if(scope==="month")return d>=new Date(now.getFullYear(),now.getMonth(),1)&&d<new Date(now.getFullYear(),now.getMonth()+1,1);
  return true;
};
const mapHeaders=h=>{
  const I={d:null,e:null,n:null,u:null};
  h.forEach((v,i)=>{const l=safe(v).toLowerCase().trim();if(I.d==null&&/^date/.test(l))I.d=i;else if(I.e==null&&/^event|^title|^name/.test(l))I.e=i;else if(I.n==null&&/^desc|^detail|^note/.test(l))I.n=i;else if(I.u==null&&/^url|^link/.test(l))I.u=i;});
  if(I.d==null)I.d=0;if(I.e==null)I.e=1;if(I.n==null)I.n=2;if(I.u==null)I.u=3;
  return I;
};
const parseRow=(r,I)=>{
  const d=safe(r[I.d]),e=safe(r[I.e]),n=safe(r[I.n]),u=safe(r[I.u]);
  return{d,e,u,cat:inferCat(e+" "+n),location:pickLabel(n,"location")||"N/A",venue:pickLabel(n,"venue")||"N/A",price:pickLabel(n,"price")||"N/A",nFull:n,nClean:stripLabels(n)};
};

let userCity=null,userRegion=null;
const setGeoLabel=t=>{const el=$("gsGeoLabel");if(el)el.textContent=t;};
const detectGeo=cb=>{
  if(!navigator.geolocation){setGeoLabel("All locations");if(cb)cb();return;}
  navigator.geolocation.getCurrentPosition(pos=>{
    fetch(`https://nominatim.openstreetmap.org/reverse?lat=${pos.coords.latitude}&lon=${pos.coords.longitude}&format=json`)
      .then(r=>r.json()).then(data=>{
        const a=data.address||{};
        userCity=(a.city||a.town||a.village||a.county||"").toLowerCase();
        userRegion=(a.state||"").toLowerCase();
        setGeoLabel("Scanning: "+(a.city||a.town||a.village||a.county||"Your area"));
        if(cb)cb();
      }).catch(()=>{setGeoLabel("All locations");if(cb)cb();});
  },()=>{setGeoLabel("All locations");if(cb)cb();});
};
const matchGeo=ev=>{
  if(!userCity&&!userRegion)return true;
  const h=(safe(ev.location)+" "+safe(ev.nFull)).toLowerCase();
  return(userCity&&h.includes(userCity))||(userRegion&&h.includes(userRegion));
};

const renderFeatured=evs=>{
  const el=$("gsFeatured");if(!el)return;
  const now=new Date();
  const pool=evs.filter(e=>{const d=new Date(e.d);return!isNaN(d)&&d>=now;});
  if(!pool.length){el.innerHTML='<div style="padding:18px 16px;font-family:var(--fm);font-size:11px;color:var(--gs-dim);font-style:italic">Check back soon.</div>';return;}
  for(let i=pool.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[pool[i],pool[j]]=[pool[j],pool[i]];}
  el.innerHTML="";
  pool.slice(0,4).forEach((ev,i)=>{
    const cat=ev.cat,a=document.createElement("a");
    a.className="gs-feat-item";
    a.href=/^https?:\/\//i.test(ev.u)?ev.u:"#gs-console";
    a.target=/^https?:\/\//i.test(ev.u)?"_blank":"_self";
    a.rel="noopener noreferrer";
    a.setAttribute("aria-label",`${strip(ev.e)} — ${cat.label}`);
    a.style.animationDelay=(i*.08)+"s";
    const loc=ev.location!=="N/A"?ev.location:"";
    const meta=[fmtDate(ev.d).replace("\n"," "),loc].filter(Boolean).join(" · ");
    a.innerHTML=`<div class="gs-feat-bar" style="background:${cat.color};box-shadow:0 0 6px ${cat.color}60" aria-hidden="true"></div><div class="gs-feat-body"><div class="gs-feat-cat" style="color:${cat.color}">${cat.label}</div><div class="gs-feat-name">${strip(ev.e)||"(Untitled)"}</div><div class="gs-feat-meta">${meta}</div></div><div class="gs-feat-arr" aria-hidden="true">›</div>`;
    el.appendChild(a);
  });
};

let allEvs=[],filtered=[],vis=CFG.PAGE_SIZE;
let scopeVal="all",catVal="all";
let batchIdx=0,planVotes=[],planPool=[];

const renderTable=()=>{
  const tb=$("gsTbody"),st=$("gsStatusText"),more=$("gsMoreBtn");
  if(!tb)return;
  const total=filtered.length,show=Math.min(vis,total);
  tb.innerHTML="";
  if(!total){
    tb.innerHTML='<tr><td colspan="8" class="gs-tbl-msg">Hmm, nothing matched that. Try a different vibe or broaden your search. Your scene is out there, we promise.</td></tr>';
    if(st)st.textContent="No events found.";if(more)more.style.display="none";return;
  }
  for(let i=0;i<show;i++){
    const ev=filtered[i],tr=document.createElement("tr");
    const tCat=document.createElement("td");tCat.className="tc-cat";
    tCat.innerHTML=`<span class="gs-cat-sq" style="background:${ev.cat.color};box-shadow:0 0 5px ${ev.cat.color}80" title="${ev.cat.label}" aria-label="${ev.cat.label}"></span>`;
    tr.appendChild(tCat);
    const tD=document.createElement("td");tD.className="tc-date";tD.textContent=fmtDate(ev.d);tr.appendChild(tD);
    const tE=document.createElement("td");tE.className="tc-ev gs-td-ev";
    const title=strip(ev.e)||"(Untitled)";
    if(/^https?:\/\//i.test(ev.u)){const a=document.createElement("a");a.href=ev.u;a.target="_blank";a.rel="noopener noreferrer";a.textContent=title;tE.appendChild(a);}
    else tE.textContent=title;
    tr.appendChild(tE);
    const tL=document.createElement("td");tL.className="tc-loc";tL.textContent=ev.location;tr.appendChild(tL);
    const tV=document.createElement("td");tV.className="tc-ven";tV.textContent=ev.venue;tr.appendChild(tV);
    const tP=document.createElement("td");tP.className="tc-pr";tP.textContent=ev.price;tr.appendChild(tP);
    const tN=document.createElement("td");tN.className="gs-desc-cell tc-desc";tN.textContent=strip(ev.nClean);
    tN.setAttribute("role","button");tN.setAttribute("tabindex","0");tN.setAttribute("aria-expanded","false");tN.setAttribute("aria-label","Event details — tap to expand");
    const tog=()=>{const o=tN.classList.toggle("open");tN.textContent=o?strip(ev.nFull):strip(ev.nClean);tN.setAttribute("aria-expanded",String(o));};
    tN.addEventListener("click",tog);tN.addEventListener("keydown",e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();tog();}});
    tr.appendChild(tN);
    const tLk=document.createElement("td");tLk.className="tc-lnk";
    if(/^https?:\/\//i.test(ev.u)){const a=document.createElement("a");a.href=ev.u;a.target="_blank";a.rel="noopener noreferrer";a.textContent="Open ›";a.setAttribute("aria-label",`Open ${title}`);tLk.appendChild(a);}
    tr.appendChild(tLk);tb.appendChild(tr);
  }
  if(st)st.textContent=show<total?`Showing ${show} of ${total} events near you`:`${total} event${total!==1?"s":""} in your scene`;
  if(more)more.style.display=total>vis?"inline-flex":"none";
};

const renderCards=()=>{
  const bEl=$("gsCardBatch"),prev=$("gsPrevBatch"),next=$("gsNextBatch");
  const lbl=$("gsBatchLabel"),cnt=$("gsPlanCount"),prg=$("gsPlanProgress");
  const see=$("gsShowResults"),nav=$("gsBatchNav");
  if(!bEl)return;
  const total=planPool.length,batches=Math.ceil(total/CFG.BATCH_SIZE)||1;
  const start=batchIdx*CFG.BATCH_SIZE,end=Math.min(start+CFG.BATCH_SIZE,total);
  bEl.innerHTML="";
  if(!total){bEl.innerHTML='<div style="color:var(--gs-dim);font-family:var(--fm);font-size:12px;font-style:italic;padding:12px 0">Nothing matched. Try a different vibe.</div>';if(nav)nav.style.display="none";return;}
  if(nav)nav.style.display="flex";
  planPool.slice(start,end).forEach((ev,si)=>{
    const idx=start+si,added=planVotes[idx]===true,cat=ev.cat;
    const card=document.createElement("div");
    card.className="gs-ev-card"+(added?" gs-added":"");
    card.style.setProperty("--cc",cat.color);
    card.style.animationDelay=(si*.06)+"s";
    card.setAttribute("role","article");
    card.setAttribute("aria-label",strip(ev.e)||"Event");
    const lnk=/^https?:\/\//i.test(ev.u)?`<a class="gs-evc-link" href="${ev.u}" target="_blank" rel="noopener noreferrer">More info</a>`:"";
    card.innerHTML=`<div class="gs-evc-num">Event ${String(idx+1).padStart(2,"0")} / ${total}</div><div class="gs-evc-cat">${cat.label}</div><div class="gs-evc-title">${strip(ev.e)||"(Untitled)"}</div><div class="gs-evc-date">${safe(ev.d)}</div><div class="gs-evc-desc">${strip(ev.nClean)}</div>${lnk}<button class="gs-add-btn${added?" gs-add-on":""}" type="button" aria-pressed="${added}">${added?"✓ Added to my night":"Add to my night"}</button>`;
    card.querySelector(".gs-add-btn").addEventListener("click",function(){planVotes[idx]=planVotes[idx]===true?false:true;renderCards();});
    bEl.appendChild(card);
  });
  if(prev)prev.disabled=batchIdx===0;
  if(next){
    const isLast=batchIdx>=batches-1;
    next.textContent=isLast?"See my picks ⚡":"Next →";
    next.onclick=isLast?showRes:()=>{batchIdx++;renderCards();window.scrollTo(0,0);};
  }
  if(lbl)lbl.textContent=`${batchIdx+1} / ${batches}`;
  const added=planVotes.filter(v=>v===true).length;
  if(cnt)cnt.textContent=`Your night so far: ${added} event${added!==1?"s":""}`;
  if(prg)prg.style.width=(total?added/total*100:0)+"%";
  if(see)see.style.display=added>0?"inline-flex":"none";
};

const showRes=()=>{
  const rEl=$("gsPlanResults"),bEl=$("gsCardBatch"),nav=$("gsBatchNav"),bar=document.querySelector(".gs-plan-bar");
  if(!rEl)return;
  rEl.style.display="block";
  if(bEl)bEl.style.display="none";if(nav)nav.style.display="none";if(bar)bar.style.display="none";
  const kept=planPool.filter((_,i)=>planVotes[i]===true);
  const sub=$("gsResultsSub");if(sub)sub.textContent=`${kept.length} event${kept.length!==1?"s":""} — lock it in, share it, show up.`;
  const grid=$("gsRGrid");
  if(grid){
    grid.innerHTML="";
    kept.forEach(ev=>{
      const c=document.createElement("div");c.className="gs-r-card";
      const lnk=/^https?:\/\//i.test(ev.u)?`<a href="${ev.u}" target="_blank" rel="noopener noreferrer">${ev.u}</a>`:"";
      c.innerHTML=`<div class="gs-r-card-title">${strip(ev.e)||"(Untitled)"}</div><div class="gs-r-card-date">${safe(ev.d)}</div><div class="gs-r-card-desc">${strip(ev.nClean)}</div>${lnk}`;
      grid.appendChild(c);
    });
  }
  const cal=$("gsRCal");
  if(cal){
    cal.innerHTML="";const days={};
    kept.forEach(ev=>{const d=new Date(safe(ev.d));const key=isNaN(d)?safe(ev.d):d.toLocaleDateString("en-US",{weekday:"long",year:"numeric",month:"long",day:"numeric"});(days[key]=days[key]||[]).push(ev);});
    Object.keys(days).sort().forEach(day=>{
      const sec=document.createElement("div");sec.className="gs-cal-day";
      sec.innerHTML=`<div class="gs-cal-day-hd">${day}</div><div class="gs-cal-evs"></div>`;
      const evEl=sec.querySelector(".gs-cal-evs");
      days[day].forEach(ev=>{
        const item=document.createElement("div");item.className="gs-cal-ev";
        const m=safe(ev.d).match(/(\d+:\d+\s*[AP]M)/i);
        const lnk=/^https?:\/\//i.test(ev.u)?`<a class="gs-cal-link" href="${ev.u}" target="_blank" rel="noopener noreferrer">${ev.u}</a>`:"";
        item.innerHTML=`<div class="gs-cal-time">${m?m[1].toUpperCase():"TBD"}</div><div class="gs-cal-info"><div class="gs-cal-title">${strip(ev.e)||"(Untitled)"}</div><div class="gs-cal-desc">${strip(ev.nClean)}</div>${lnk}</div>`;
        evEl.appendChild(item);
      });
      cal.appendChild(sec);
    });
  }
  const ta=$("gsExportText");
  if(ta)ta.value=kept.length?kept.map(ev=>[strip(ev.e),safe(ev.d),strip(ev.nClean),ev.u,"-".repeat(50)].join("\n")).join("\n"):"(No events added yet.)";
};

const applyFilters=()=>{
  const needle=safe($("gsSearch")&&$("gsSearch").value).toLowerCase().trim();
  filtered=allEvs.filter(ev=>{
    if(!inScope(ev.d,scopeVal))return false;
    if(catVal!=="all"&&ev.cat.key!==catVal)return false;
    if(!matchGeo(ev))return false;
    if(!needle)return true;
    return[ev.d,ev.e,ev.location,ev.venue,ev.price,ev.nFull].map(safe).join(" ").toLowerCase().includes(needle);
  });
  planPool=[...filtered];planVotes=new Array(planPool.length).fill(false);
  batchIdx=0;vis=CFG.PAGE_SIZE;renderTable();renderCards();
};

const setSt=t=>{const el=$("gsFooterStatus");if(el)el.textContent=t;};
const setMsg=h=>{const tb=$("gsTbody");if(tb)tb.innerHTML=`<tr><td colspan="8" class="gs-tbl-msg">${h}</td></tr>`;};

const loadEvs=async()=>{
  setSt("GrooveSeeker is on it.");setMsg("Loading your scene…");
  if(!CFG.EVENTS_CSV_URL){setMsg("Events feed not connected yet.");setSt("Not connected");return;}
  let csv="";
  try{
    const url=CFG.EVENTS_CSV_URL+(CFG.EVENTS_CSV_URL.includes("?")?"&":"?")+"_="+Date.now();
    const res=await fetch(url,{cache:"no-store",mode:"cors"});
    if(!res.ok)throw new Error("HTTP "+res.status);
    csv=await res.text();
  }catch(err){
    setMsg("Couldn't load events ("+err.message+"). Try refreshing.");
    setSt("Connection issue: "+err.message);
    return;
  }
  if(!csv||csv.trim().length<10){setMsg("Events feed returned empty data.");setSt("Empty feed");return;}
  let rows;
  try{rows=parseCSV(csv);}catch(err){setMsg("Feed parse error: "+err.message);setSt("Parse error");return;}
  if(!rows||rows.length<2){setMsg("No events in feed yet. Check back soon.");setSt("No events");return;}
  const I=mapHeaders(rows[0]);
  allEvs=rows.slice(1).map(r=>parseRow(r,I)).filter(ev=>ev.d||ev.e||ev.nFull||ev.u);
  renderFeatured(allEvs);applyFilters();
  setSt(`GrooveSeeker is on it. ${allEvs.length} events found.`);
  const srch=$("gsSearch");if(srch)srch.addEventListener("input",()=>{vis=CFG.PAGE_SIZE;applyFilters();});
  $$(".gs-fc").forEach(b=>b.addEventListener("click",function(){
    $$(".gs-fc").forEach(x=>{x.classList.remove("gs-fc-on");x.setAttribute("aria-pressed","false");});
    this.classList.add("gs-fc-on");this.setAttribute("aria-pressed","true");
    catVal=this.dataset.cat||"all";vis=CFG.PAGE_SIZE;applyFilters();
  }));
  $$(".gs-sc").forEach(b=>b.addEventListener("click",function(){
    $$(".gs-sc").forEach(x=>{x.classList.remove("gs-sc-on");x.setAttribute("aria-pressed","false");});
    this.classList.add("gs-sc-on");this.setAttribute("aria-pressed","true");
    scopeVal=this.dataset.scope||"all";vis=CFG.PAGE_SIZE;applyFilters();
  }));
  const more=$("gsMoreBtn");if(more)more.addEventListener("click",()=>{vis=Math.min(vis+CFG.PAGE_SIZE,filtered.length);renderTable();});
  const prev=$("gsPrevBatch");if(prev)prev.addEventListener("click",()=>{if(batchIdx>0){batchIdx--;renderCards();window.scrollTo(0,0);}});
};

const initTog=()=>{
  const tv=$("gsTableView"),cv=$("gsCardView"),bt=$("btnTable"),bc=$("btnPlan");
  if(!tv||!cv||!bt||!bc)return;
  const sw=v=>{const isT=v==="table";tv.style.display=isT?"block":"none";cv.style.display=isT?"none":"block";bt.classList.toggle("gs-vbtn-on",isT);bc.classList.toggle("gs-vbtn-on",!isT);bt.setAttribute("aria-pressed",String(isT));bc.setAttribute("aria-pressed",String(!isT));};
  bt.addEventListener("click",()=>sw("table"));bc.addEventListener("click",()=>sw("cards"));
};

const initTabs=()=>{
  $$(".gs-rtab").forEach(b=>b.addEventListener("click",function(){
    $$(".gs-rtab").forEach(x=>{x.classList.remove("gs-rtab-on");x.setAttribute("aria-selected","false");});
    this.classList.add("gs-rtab-on");this.setAttribute("aria-selected","true");
    const tab=this.dataset.rtab;
    const g=$("gsRGrid"),c=$("gsRCal"),e=$("gsRExport");
    if(g)g.style.display=tab==="grid"?"grid":"none";if(c)c.style.display=tab==="cal"?"block":"none";if(e)e.style.display=tab==="export"?"block":"none";
  }));
};

const initExp=()=>{
  const cp=$("gsCopyBtn"),dl=$("gsDownloadBtn"),ta=$("gsExportText");
  if(cp&&ta)cp.addEventListener("click",()=>{navigator.clipboard.writeText(ta.value).then(()=>{cp.textContent="Copied!";setTimeout(()=>cp.textContent="Copy my night",2000);}).catch(()=>{ta.select();document.execCommand("copy");cp.textContent="Copied!";setTimeout(()=>cp.textContent="Copy my night",2000);});});
  if(dl&&ta)dl.addEventListener("click",()=>{const blob=new Blob([ta.value],{type:"text/plain"});const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download="my-grooveseeker-night.txt";document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(url);a.remove();},1000);});
};

const initRst=()=>{
  const btn=$("gsRestartPlan");if(!btn)return;
  btn.addEventListener("click",()=>{
    planVotes=new Array(planPool.length).fill(false);batchIdx=0;
    const r=$("gsPlanResults"),b=$("gsCardBatch"),n=$("gsBatchNav"),bar=document.querySelector(".gs-plan-bar"),s=$("gsShowResults");
    if(r)r.style.display="none";if(b)b.style.display="grid";if(n)n.style.display="flex";if(bar)bar.style.display="flex";if(s)s.style.display="none";
    renderCards();
  });
};

const initSeeRes=()=>{const b=$("gsShowResults");if(b)b.addEventListener("click",showRes);};

const initGeo=()=>{
  const trigger=()=>detectGeo(()=>applyFilters());
  [$("gsSceneBtn"),$("gsSceneBtnInline")].forEach(btn=>{if(btn)btn.addEventListener("click",trigger);});
};

const initEggs=()=>{
  const pac=$("gsPacBtn");
  if(pac){
    const ensure=()=>{
      let ov=document.getElementById("gsArcOv");if(ov)return ov;
      if(!document.getElementById("gsArcSt")){const s=document.createElement("style");s.id="gsArcSt";s.textContent="#gsArcOv{position:fixed;inset:0;z-index:9999;display:none;align-items:center;justify-content:center;padding:16px;background:rgba(0,0,0,.88);}#gsArcOv[aria-hidden='false']{display:flex;}#gsArcShell{width:min(980px,calc(100vw - 32px));height:min(680px,calc(100dvh - 32px));border:2px solid #9D4EDD;background:#06040F;box-shadow:0 0 60px rgba(157,78,221,.3),6px 6px 0 rgba(255,45,120,.4);display:flex;flex-direction:column;overflow:hidden;}#gsArcBar{display:flex;align-items:center;justify-content:space-between;padding:10px 14px;background:#0D0A1A;border-bottom:1px solid rgba(157,78,221,.2);}#gsArcTitle{font-family:'Archivo Black',sans-serif;font-size:20px;letter-spacing:.10em;color:#FFE27A;}#gsArcBtns{display:flex;gap:8px;}.gsArcBtn{font-family:'Share Tech Mono',monospace;font-size:10px;letter-spacing:.16em;border:1px solid rgba(240,236,248,.15);background:transparent;color:#F0ECF8;padding:7px 14px;cursor:pointer;}.gsArcBtn:hover{border-color:#9D4EDD;color:#C77DFF;}#gsArcBody{position:relative;flex:1;background:#000;}#gsArcFrame{width:100%;height:100%;border:0;display:block;}#gsArcLoad{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#555;font-family:'Share Tech Mono',monospace;font-size:13px;}";document.head.appendChild(s);}
      ov=document.createElement("div");ov.id="gsArcOv";ov.setAttribute("aria-hidden","true");ov.setAttribute("role","dialog");ov.setAttribute("aria-modal","true");ov.setAttribute("aria-label","Arcade");
      ov.innerHTML=`<div id="gsArcShell" role="document"><div id="gsArcBar"><div id="gsArcTitle">⚡ ARCADE</div><div id="gsArcBtns"><button class="gsArcBtn" id="gsArcRl" type="button">Reload</button><button class="gsArcBtn" id="gsArcCl" type="button">✕ Close</button></div></div><div id="gsArcBody"><div id="gsArcLoad">Loading…</div><iframe id="gsArcFrame" title="Arcade" loading="lazy" referrerpolicy="no-referrer" scrolling="no"></iframe></div></div>`;
      document.body.appendChild(ov);
      const fr=ov.querySelector("#gsArcFrame"),ld=ov.querySelector("#gsArcLoad");
      const close=()=>{ov.setAttribute("aria-hidden","true");document.body.style.overflow="";try{fr.src="";}catch(_){}};
      const open=u=>{ov.setAttribute("aria-hidden","false");document.body.style.overflow="hidden";ld.style.display="flex";fr.src=u;fr.addEventListener("load",()=>{ld.style.display="none";},{once:true});};
      ov.addEventListener("click",e=>{if(e.target===ov)close();});
      const cl=ov.querySelector("#gsArcCl");const rl=ov.querySelector("#gsArcRl");
      cl&&cl.addEventListener("click",close);
      rl&&rl.addEventListener("click",()=>{if(!CFG.PAC_URL)return;ld.style.display="flex";fr.src=CFG.PAC_URL+(CFG.PAC_URL.includes("?")?"&":"?")+"v="+Date.now();});
      document.addEventListener("keydown",e=>{if(ov.getAttribute("aria-hidden")!=="false")return;if(e.key==="Escape"){e.preventDefault();close();}});
      ov.__open=open;return ov;
    };
    pac.addEventListener("click",()=>{if(!CFG.PAC_URL)return;const o=ensure();if(o&&o.__open)o.__open(CFG.PAC_URL);});
  }
};

const boot=()=>{
  initTog();initTabs();initExp();initRst();initSeeRes();initGeo();
  try{initEggs();}catch(_){}
  detectGeo();
  loadEvs().catch(()=>{});
};

document.readyState==="loading"?document.addEventListener("DOMContentLoaded",boot):boot();

})();
