/* ═══════════════════════════════════════════════════════════════
   Speed · Distance · Time — app.js
   ───────────────────────────────────────────────────────────────
   OWASP Top 10 mitigations (client-side static app):

   A01 Broken Access Control   → AuthSession.isValid() on every page load
                                 + session ID format validated before use
   A02 Cryptographic Failures  → passwords never stored; SHA-256 hashing
                                 in security.js; nonces via crypto.getRandomValues
   A03 Injection               → ALL user-supplied data written via
                                 textContent / DOM API; escHtml() guard on
                                 every remaining innerHTML
   A04 Insecure Design         → input bounds checked; quota-safe writes;
                                 history capped to prevent unbounded growth
   A05 Security Misconfig      → CSP + X-Frame-Options in index.html head
   A06 Vulnerable Components   → zero external JS dependencies
   A07 Auth Failures           → rate limiting in security.js (login layer);
                                 logout clears nonce + session
   A08 Software/Data Integrity → session IDs validated before every read;
                                 state schema validated on load
   A09 Logging/Monitoring      → no console.log of sensitive data
   A10 SSRF                    → zero server requests (fully static)
════════════════════════════════════════════════════════════════ */
'use strict';

/* ═══════════════════════════
   SESSION IDENTITY  (A01, A08)
═══════════════════════════ */
const SESSION_PFX  = 'sdt_session_';
const SESSIONS_KEY = 'sdt_sessions';

function getSessionId() {
  const id = sessionStorage.getItem('sdt_session_id') || '';
  return Validate.sessionId(id) ? id : null; // A08: validate format
}

function getSessionRecord() {
  const id = getSessionId();
  if (!id) return null;
  try { return JSON.parse(localStorage.getItem(SESSION_PFX + id)); } catch { return null; }
}

function saveSessionRecord(r) {
  if (!r || !Validate.sessionId(r.id)) return; // A08
  safeSet(SESSION_PFX + r.id, r);              // A04: quota-safe
}

function getSessionIds() {
  try {
    const ids = JSON.parse(localStorage.getItem(SESSIONS_KEY) || '[]');
    return Array.isArray(ids) ? ids.filter(id => Validate.sessionId(id)) : []; // A08
  } catch { return []; }
}

function getAllSessions() {
  return getSessionIds()
    .map(id => { try { return JSON.parse(localStorage.getItem(SESSION_PFX + id)); } catch { return null; } })
    .filter(Boolean);
}

/* ═══════════════════════════
   QUIZ STATE
═══════════════════════════ */
const CATS = {
  speed:    { label: 'Speed',    emoji: '🚗' },
  distance: { label: 'Distance', emoji: '📏' },
  time:     { label: 'Time',     emoji: '⏱️' },
  mixed:    { label: 'Mixed',    emoji: '🎲' }
};

function emptyState() {
  return {
    total: 0, correct: 0, bestStreak: 0,
    cats: { speed:{d:0,c:0}, distance:{d:0,c:0}, time:{d:0,c:0} },
    history: []
  };
}

/* A08: Validate loaded state shape to prevent prototype pollution or
   malformed localStorage data from corrupting the app */
function validateState(raw) {
  if (!raw || typeof raw !== 'object') return emptyState();
  const s = emptyState();
  s.total       = Number.isFinite(raw.total)       ? Math.max(0, raw.total)       : 0;
  s.correct     = Number.isFinite(raw.correct)      ? Math.max(0, raw.correct)     : 0;
  s.bestStreak  = Number.isFinite(raw.bestStreak)   ? Math.max(0, raw.bestStreak)  : 0;
  s.correct     = Math.min(s.correct, s.total); // correct can never exceed total
  ['speed','distance','time'].forEach(c => {
    const rc = raw.cats?.[c] || {};
    s.cats[c] = {
      d: Number.isFinite(rc.d) ? Math.max(0, rc.d) : 0,
      c: Number.isFinite(rc.c) ? Math.max(0, rc.c) : 0
    };
    s.cats[c].c = Math.min(s.cats[c].c, s.cats[c].d);
  });
  // A04: Cap history to 500 entries to prevent unbounded localStorage growth
  s.history = Array.isArray(raw.history) ? raw.history.slice(-500) : [];
  return s;
}

let state   = emptyState();
let session = { mode:'whole', cat:'mixed', diff:'easy', qty:10,
  idx:0, correct:0, streak:0, best:0, qs:[], answers:[], t0:[], totalTime:0 };
let selCat   = 'mixed';
let curQ     = null;
let answered = false;
let WHOLE    = null;
let DECIMAL  = null;

/* ═══════════════════════════
   A03: SAFE HTML ESCAPING
   (escHtml from security.js used for any remaining innerHTML)
═══════════════════════════ */
// escHtml() and escAttr() are defined in security.js
// safeSet(), Validate, AuthSession are defined in security.js

/* ═══════════════════════════
   NAVIGATION
═══════════════════════════ */
function goHome()   { show('homeScreen');   updateDash(); renderLeaderboard(); }
function goReview() {
  show('reviewScreen');
  const el = document.getElementById('reviewAll');
  if (!state.history.length) {
    el.textContent = '';
    const p = document.createElement('p');
    p.style.cssText = 'color:#7c5a8a;font-size:13px;padding:1rem 0;';
    p.textContent = 'No history yet.';
    el.appendChild(p);
    return;
  }
  // A03: build review items via DOM API
  el.textContent = '';
  [...state.history].reverse().forEach(a => el.appendChild(buildReviewItem(a)));
}

function show(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  ['setupRefBar','quizRefBar','resultsRefBar','reviewRefBar'].forEach(bid => {
    const el = document.getElementById(bid);
    if (el && !el.dataset.filled) { el.innerHTML = refBarHTML(); el.dataset.filled = '1'; }
  });
}

function selectMode(m) {
  if (m !== 'whole' && m !== 'decimal') return; // A04: whitelist
  session.mode = m;
  const titleEl = document.getElementById('setupTitle');
  const subEl   = document.getElementById('setupSub');
  if (titleEl) titleEl.textContent = m === 'whole' ? '🔢 Whole numbers quiz' : '🔣 Decimals quiz';
  if (subEl)   subEl.textContent   = m === 'whole' ? 'Whole numbers only'  : 'Includes fractional values';
  show('setupScreen');
}

function setCat(c) {
  const allowed = ['speed','distance','time','mixed'];
  if (!allowed.includes(c)) return; // A04: whitelist
  selCat = c;
  document.querySelectorAll('.setup-cats .cc').forEach(e => e.style.borderColor = 'transparent');
  const el = document.querySelector('.setup-cats .cc.' + c);
  if (el) el.style.borderColor = '#7c3aed';
}

function setDiff(d) {
  const allowed = ['easy','medium','hard'];
  if (!allowed.includes(d)) return; // A04: whitelist
  session.diff = d;
  ['easy','medium','hard'].forEach(x =>
    document.getElementById('diff-' + x).classList.toggle('active', x === d));
}

function setQty(n) {
  const allowed = [10, 20, 50];
  if (!allowed.includes(n)) return; // A04: whitelist
  session.qty = n;
  [10, 20, 50].forEach(x =>
    document.getElementById('qty-' + x).classList.toggle('active', x === n));
}

/* ═══════════════════════════
   REF BAR (safe static HTML)
═══════════════════════════ */
function refBarHTML() {
  // No user data — safe to use innerHTML for static template
  return `
  <div class="ref-tile">
    <div class="tri-row">
      <svg viewBox="0 0 120 106" width="58" height="51" class="tri-svg" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <polygon points="60,3 117,103 3,103" fill="#f9d6ff" stroke="#cc00cc" stroke-width="2.5" stroke-linejoin="round"/>
        <line x1="60" y1="53" x2="3"  y2="103" stroke="#cc00cc" stroke-width="2"/>
        <line x1="60" y1="53" x2="117" y2="103" stroke="#cc00cc" stroke-width="2"/>
        <line x1="21" y1="72" x2="99"  y2="72"  stroke="#cc00cc" stroke-width="2"/>
        <text x="60" y="67" text-anchor="middle" font-size="12" font-weight="800" fill="#5a005a" font-family="Nunito,sans-serif">Distance</text>
        <text x="31" y="92" text-anchor="middle" font-size="11" font-weight="800" fill="#5a005a" font-family="Nunito,sans-serif">Speed</text>
        <text x="89" y="92" text-anchor="middle" font-size="11" font-weight="800" fill="#5a005a" font-family="Nunito,sans-serif">Time</text>
      </svg>
      <div class="f-chips">
        <div class="fc"><div class="fci s">S</div><span class="fcv">D ÷ T</span></div>
        <div class="fc"><div class="fci d">D</div><span class="fcv">S × T</span></div>
        <div class="fc"><div class="fci t">T</div><span class="fcv">D ÷ S</span></div>
      </div>
    </div>
  </div>
  <div class="ref-tile">
    <div class="mins-lbl">Mins → Hours</div>
    <table class="mt"><thead><tr><th>min</th><th>hrs</th><th></th></tr></thead><tbody>
      <tr><td>6</td><td>0.1</td><td></td></tr>
      <tr><td>10</td><td>0.167</td><td></td></tr>
      <tr><td>15</td><td>0.25</td><td><span class="mp">¼</span></td></tr>
      <tr><td>20</td><td>0.33</td><td></td></tr>
      <tr><td>30</td><td>0.5</td><td><span class="mp">½</span></td></tr>
      <tr><td>40</td><td>0.67</td><td></td></tr>
      <tr><td>45</td><td>0.75</td><td><span class="mp">¾</span></td></tr>
      <tr><td>50</td><td>0.833</td><td></td></tr>
      <tr><td>60</td><td>1.0</td><td><span class="mp">1hr</span></td></tr>
    </tbody></table>
  </div>`;
}

/* ═══════════════════════════
   QUESTION GENERATION UTILS
═══════════════════════════ */
function sh(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function shOpts(correct, fakes) {
  const all = [correct, ...fakes.slice(0, 3)];
  sh(all);
  return { opts: all, ans: all.indexOf(correct) };
}

function interleave(...arrays) {
  const result = [];
  const maxLen = Math.max(...arrays.map(a => a.length));
  for (let i = 0; i < maxLen; i++)
    for (const arr of arrays) if (i < arr.length) result.push(arr[i]);
  return result;
}

function antiConsecutiveShuffle(qs) {
  sh(qs);
  for (let pass = 0; pass < 3; pass++) {
    for (let i = 2; i < qs.length; i++) {
      if (qs[i].ans === qs[i-1].ans && qs[i].ans === qs[i-2].ans) {
        const sw = Math.min(i + 1 + Math.floor(Math.random() * 4), qs.length - 1);
        if (sw !== i) [qs[i], qs[sw]] = [qs[sw], qs[i]];
      }
    }
  }
  return qs;
}

const V = [
  ['car','km','km/h'],['train','km','km/h'],['bus','miles','mph'],
  ['cyclist','km','km/h'],['lorry','km','km/h'],['plane','km','km/h'],
  ['boat','km','km/h'],['motorcycle','km','km/h'],['runner','km','km/h'],
  ['horse','km','km/h'],['tram','km','km/h'],['ferry','km','km/h'],
  ['rocket','km','km/h'],['speedboat','km','km/h'],['scooter','km','km/h'],
  ['van','km','km/h'],['ambulance','km','km/h'],['sports car','km','km/h'],
  ['electric car','km','km/h'],['minibus','miles','mph']
];

/* ── WHOLE NUMBER BANK (750 Qs) ── */
function buildWhole() {
  const spd=[],dst=[],tim=[];
  const SP=[[60,2],[80,3],[100,4],[120,3],[90,2],[70,5],[110,4],[50,3],[40,6],[150,2],[200,3],[160,4],[130,5],[75,4],[45,2],[55,3],[85,4],[95,5],[105,6],[115,4],[125,2],[135,3],[145,4],[155,5],[165,6],[175,4],[185,2],[195,3],[205,4],[215,5],[225,6],[235,4],[245,2],[255,3],[265,4],[30,7],[35,4],[25,8],[20,5],[15,6],[180,2],[170,3],[140,4],[210,5],[220,3],[230,4],[240,5],[250,2],[260,3],[270,4]];
  for(let i=0;i<250;i++){
    const v=V[i%V.length],p=SP[i%SP.length],s=p[0],t=p[1],d=s*t;
    const fk=[s-10,s+10,s+20].filter(x=>x>0&&x!==s); while(fk.length<3)fk.push(s+fk.length*5+1);
    const{opts,ans}=shOpts(s,sh([...fk]));
    spd.push({cat:'speed',diff:s>150?'hard':s>80?'medium':'easy',
      q:`A ${v[0]} travels ${d} ${v[1]} in ${t} hour${t>1?'s':''}. What is its average speed?`,
      opts:opts.map(o=>o+' '+v[2]),ans,hint:`Speed = ${d} ÷ ${t} = ${s} ${v[2]}`});
  }
  const DP=[[60,3],[80,2],[100,4],[120,3],[90,5],[70,6],[110,3],[50,4],[40,5],[150,2],[200,3],[160,2],[130,4],[75,4],[45,2],[55,3],[85,4],[95,3],[105,2],[115,4],[125,2],[135,3],[145,2],[155,4],[165,3],[175,2],[185,4],[195,3],[205,2],[215,4],[30,6],[35,4],[25,4],[20,5],[15,4],[180,3],[170,4],[140,5],[210,3],[220,2],[230,3],[240,2],[250,4],[260,3],[270,2],[280,3],[290,2],[300,3],[50,6],[60,4]];
  for(let i=0;i<250;i++){
    const v=V[i%V.length],p=DP[i%DP.length],s=p[0],t=p[1],d=s*t;
    const fk=[d-40,d+40,d+90].filter(x=>x>0&&x!==d); while(fk.length<3)fk.push(d+fk.length*15+5);
    const{opts,ans}=shOpts(d,sh([...fk]));
    dst.push({cat:'distance',diff:d>500?'hard':d>200?'medium':'easy',
      q:`A ${v[0]} travels at ${s} ${v[2]} for ${t} hour${t>1?'s':''}. How far does it travel?`,
      opts:opts.map(o=>o+' '+v[1]),ans,hint:`Distance = ${s} × ${t} = ${d} ${v[1]}`});
  }
  const TP=[[60,120],[80,160],[100,300],[120,240],[90,270],[70,350],[110,330],[50,200],[40,160],[150,300],[200,600],[160,320],[130,390],[75,225],[45,135],[55,165],[85,255],[95,285],[105,315],[115,460],[125,375],[135,405],[145,290],[155,310],[165,330],[175,350],[185,370],[195,390],[30,150],[35,140],[25,100],[20,100],[15,60],[180,360],[170,340],[140,280],[210,420],[220,440],[230,460],[240,480],[250,500],[260,520],[270,540],[280,560],[290,580],[300,600],[320,640],[340,680],[360,720],[400,800]];
  for(let i=0;i<250;i++){
    const v=V[i%V.length],p=TP[i%TP.length],s=p[0],d=p[1],t=d/s;
    if(!Number.isInteger(t)||t<1){if(tim.length)tim.push({...tim[tim.length-1]});continue;}
    const fk=[t-1,t+1,t+2].filter(x=>x>0&&x!==t); while(fk.length<3)fk.push(t+fk.length+1);
    const{opts,ans}=shOpts(t,sh([...fk]));
    tim.push({cat:'time',diff:t>5?'hard':t>2?'medium':'easy',
      q:`A ${v[0]} travels ${d} ${v[1]} at ${s} ${v[2]}. How long does the journey take?`,
      opts:opts.map(o=>o+' hour'+(o>1?'s':'')),ans,hint:`Time = ${d} ÷ ${s} = ${t} hour${t>1?'s':''}`});
  }
  while(tim.length<250)tim.push({...tim[tim.length-1]});
  return{speed:sh(spd),distance:sh(dst),time:sh(tim)};
}

/* ── DECIMAL BANK (750 Qs) ── */
function buildDecimal() {
  const spd=[],dst=[],tim=[];
  const SD=[[75,1.5],[90,2.5],[120,1.5],[60,2.5],[100,3.5],[80,4.5],[110,1.5],[50,2.5],[45,1.5],[130,2.5],[70,4.5],[140,3.5],[150,1.5],[160,2.5],[55,1.5],[85,2.5],[95,1.5],[105,3.5],[115,2.5],[125,1.5],[135,2.5],[145,1.5],[155,2.5],[165,1.5],[175,2.5],[185,1.5],[195,2.5],[205,1.5],[215,2.5],[225,1.5],[235,2.5],[245,1.5],[255,2.5],[265,1.5],[275,2.5],[65,1.5],[35,2.5],[25,1.5],[20,2.5],[15,4.5],[180,1.5],[170,2.5],[210,1.5],[220,2.5],[230,1.5],[240,2.5],[250,1.5],[260,2.5],[270,1.5],[280,2.5]];
  for(let i=0;i<250;i++){
    const v=V[i%V.length],p=SD[i%SD.length],s=p[0],t=p[1],d=s*t;
    const fk=[s-10,s+10,s+20].filter(x=>x>0&&x!==s); while(fk.length<3)fk.push(s+fk.length*5+1);
    const{opts,ans}=shOpts(s,sh([...fk]));
    spd.push({cat:'speed',diff:s>150?'hard':s>80?'medium':'easy',
      q:`A ${v[0]} travels ${d} ${v[1]} in ${t} hours. What is its average speed?`,
      opts:opts.map(o=>o+' '+v[2]),ans,hint:`Speed = ${d} ÷ ${t} = ${s} ${v[2]}`});
  }
  const DD=[[60,1.5],[80,2.5],[100,1.5],[120,2.5],[90,3.5],[70,4.5],[110,1.5],[50,2.5],[40,1.5],[150,2.5],[200,1.5],[160,2.5],[130,1.5],[75,2.5],[45,4.5],[55,1.5],[85,2.5],[95,3.5],[105,1.5],[115,2.5],[125,3.5],[135,1.5],[145,2.5],[155,1.5],[165,2.5],[175,1.5],[185,2.5],[195,1.5],[205,2.5],[215,3.5],[30,4.5],[35,2.5],[25,1.5],[20,2.5],[15,4.5],[180,1.5],[170,2.5],[140,1.5],[210,2.5],[220,1.5],[230,2.5],[240,1.5],[250,2.5],[260,1.5],[270,2.5],[280,1.5],[290,2.5],[300,1.5],[50,4.5],[60,2.5]];
  for(let i=0;i<250;i++){
    const v=V[i%V.length],p=DD[i%DD.length],s=p[0],t=p[1],d=parseFloat((s*t).toFixed(1));
    const fk=[parseFloat((d*0.8).toFixed(1)),parseFloat((d*1.2).toFixed(1)),parseFloat((d*1.35).toFixed(1))];
    const{opts,ans}=shOpts(d,sh([...fk]));
    dst.push({cat:'distance',diff:d>500?'hard':d>200?'medium':'easy',
      q:`A ${v[0]} travels at ${s} ${v[2]} for ${t} hours. How far does it travel?`,
      opts:opts.map(o=>o+' '+v[1]),ans,hint:`Distance = ${s} × ${t} = ${d} ${v[1]}`});
  }
  const TD=[[60,90],[80,120],[100,150],[120,180],[90,135],[70,105],[110,165],[50,75],[40,60],[150,225],[200,300],[160,240],[130,195],[75,112.5],[45,67.5],[55,82.5],[85,127.5],[95,142.5],[105,157.5],[115,172.5],[125,187.5],[135,202.5],[145,217.5],[155,232.5],[165,247.5],[175,262.5],[185,277.5],[195,292.5],[30,45],[35,52.5],[25,37.5],[20,30],[15,22.5],[180,270],[170,255],[140,210],[210,315],[220,330],[230,345],[240,360],[250,375],[260,390],[270,405],[280,420],[290,435],[300,450],[320,480],[340,510],[360,540],[400,600]];
  for(let i=0;i<250;i++){
    const v=V[i%V.length],p=TD[i%TD.length],s=p[0],d=p[1],t=parseFloat((d/s).toFixed(2));
    const fk=[parseFloat((t*0.75).toFixed(2)),parseFloat((t*1.5).toFixed(2)),parseFloat((t*2).toFixed(2))];
    const{opts,ans}=shOpts(t,sh([...fk]));
    tim.push({cat:'time',diff:t>5?'hard':t>2?'medium':'easy',
      q:`A ${v[0]} travels ${d} ${v[1]} at ${s} ${v[2]}. How long does the journey take?`,
      opts:opts.map(o=>o+' hours'),ans,hint:`Time = ${d} ÷ ${s} = ${t} hours`});
  }
  return{speed:sh(spd),distance:sh(dst),time:sh(tim)};
}

function ensureBanks() { if(!WHOLE)WHOLE=buildWhole(); if(!DECIMAL)DECIMAL=buildDecimal(); }
function getBk() { ensureBanks(); return session.mode==='whole'?WHOLE:DECIMAL; }

function getQs() {
  const bk=getBk();
  let pool;
  if(session.cat==='mixed'){
    const subs=['speed','distance','time'].map(c=>{
      let p=[...bk[c]].filter(q=>q.diff===session.diff);
      if(!p.length)p=[...bk[c]]; return sh(p);
    });
    pool=interleave(...subs);
  } else {
    pool=[...bk[session.cat]].filter(q=>q.diff===session.diff);
    if(!pool.length)pool=[...bk[session.cat]]; sh(pool);
  }
  return antiConsecutiveShuffle(pool).slice(0,session.qty);
}

/* ═══════════════════════════
   QUIZ FLOW
═══════════════════════════ */
function launchQuiz() {
  session.cat=selCat; session.idx=0; session.correct=0; session.streak=0; session.best=0;
  session.qs=getQs(); session.answers=[]; session.t0=[]; session.totalTime=0;
  const badge=document.getElementById('quizMBadge');
  if(badge){ badge.textContent=session.mode==='whole'?'Whole':'Decimal';
    badge.className='mbadge '+(session.mode==='whole'?'whole':'decimal'); }
  show('quizScreen'); loadQ();
}
function replayQuiz() { WHOLE=null; DECIMAL=null; launchQuiz(); }

function loadQ() {
  answered=false;
  document.getElementById('feedbackEl').style.display='none';
  if(session.idx>=session.qty){ showResults(); return; }
  curQ=session.qs[session.idx];
  session.t0[session.idx]=Date.now();
  setText('qCount',`Q ${session.idx+1} / ${session.qty}`);
  setText('qScore',`${session.correct} correct`);
  document.getElementById('progBar').style.width=Math.round(session.idx/session.qty*100)+'%';
  setText('streakNum',session.streak);
  const badge=document.getElementById('qBadge');
  badge.textContent=CATS[curQ.cat].emoji+' '+CATS[curQ.cat].label;
  badge.className='qbadge '+curQ.cat;
  setText('qText',curQ.q);
  const wrap=document.getElementById('optsWrap'); wrap.textContent='';
  curQ.opts.forEach((opt,i)=>{
    const b=document.createElement('button');
    b.type='button'; b.className='opt';
    b.textContent=opt; // A03: textContent
    b.addEventListener('click',()=>selAns(i,b));
    wrap.appendChild(b);
  });
}

/* A03: helper — never use innerHTML for dynamic content */
function setText(id, val) {
  const el=document.getElementById(id); if(el) el.textContent=val;
}

function selAns(i,btn) {
  if(answered)return; answered=true;
  const elapsed=Math.round((Date.now()-session.t0[session.idx])/100)/10;
  session.totalTime+=elapsed;
  document.querySelectorAll('.opt').forEach(b=>b.disabled=true);
  const ok=i===curQ.ans;
  btn.classList.add(ok?'correct':'wrong');
  if(!ok) document.querySelectorAll('.opt')[curQ.ans].classList.add('show-correct');
  if(ok){ session.correct++; session.streak++; if(session.streak>session.best)session.best=session.streak; }
  else session.streak=0;
  setText('streakNum',session.streak);
  setText('qScore',`${session.correct} correct`);
  if(state.cats[curQ.cat]){ state.cats[curQ.cat].d++; if(ok)state.cats[curQ.cat].c++; }
  state.total++; if(ok)state.correct++;
  if(session.best>state.bestStreak)state.bestStreak=session.best;
  const entry={q:curQ.q,cat:curQ.cat,ok,chosen:curQ.opts[i],right:curQ.opts[curQ.ans]};
  state.history.push(entry); session.answers.push(entry);
  showFeedback(ok,curQ.hint,curQ.opts[curQ.ans]);
  saveState();
}

function showFeedback(ok,hint,correct) {
  const fb=document.getElementById('feedbackEl');
  fb.className='fb '+(ok?'correct':'wrong');
  // A03: textContent for all user-derived values
  setText('fbIcon', ok?'✅':'❌');
  setText('fbLbl',  ok?'Correct!':'Incorrect');
  document.getElementById('fbLbl').className='fb-lbl '+(ok?'correct':'wrong');
  // hint is app-generated (not user input) — safe but still use textContent
  const hintEl=document.getElementById('fbHint');
  hintEl.textContent='';
  if(!ok){
    const ca=document.createElement('div');
    ca.style.marginBottom='4px';
    const caStrong=document.createElement('strong'); caStrong.textContent='Correct answer: ';
    ca.appendChild(caStrong); ca.appendChild(document.createTextNode(correct));
    hintEl.appendChild(ca);
  }
  const hw=document.createElement('div');
  const hwStrong=document.createElement('strong'); hwStrong.textContent='Working: ';
  hw.appendChild(hwStrong); hw.appendChild(document.createTextNode(hint));
  hintEl.appendChild(hw);
  const isLast=session.idx+1>=session.qty;
  const nxt=isLast?'See results 🏆':'Next →';
  const btns=document.getElementById('fbBtns');
  btns.textContent='';
  if(!ok){
    btns.className='fb-btns two';
    const tryBtn=document.createElement('button'); tryBtn.type='button'; tryBtn.className='fbbtn try';
    tryBtn.textContent='↩ Try again'; tryBtn.addEventListener('click',tryAgain);
    btns.appendChild(tryBtn);
  } else {
    btns.className='fb-btns one';
  }
  const nextBtn=document.createElement('button'); nextBtn.type='button'; nextBtn.className='fbbtn nxt';
  nextBtn.textContent=nxt; nextBtn.addEventListener('click',advance);
  btns.appendChild(nextBtn);
  fb.style.display='block';
}

function tryAgain() {
  answered=false;
  document.getElementById('feedbackEl').style.display='none';
  session.t0[session.idx]=Date.now();
  document.querySelectorAll('.opt').forEach((b,i)=>{
    b.disabled=false; b.className='opt';
    b.addEventListener('click',()=>selAns(i,b));
  });
}
function advance() {
  session.idx++; if(session.idx>=session.qty){ showResults(); return; } loadQ();
}

function showResults() {
  show('resultsScreen');
  const pct=Math.round(session.correct/session.qty*100);
  const avg=session.answers.length?(session.totalTime/session.answers.length).toFixed(1)+'s':'—';
  setText('resEmoji',pct>=90?'🏆':pct>=70?'🎉':pct>=50?'👍':'📚');
  setText('resTitle',pct>=90?'Outstanding!':pct>=70?'Great work!':pct>=50?'Good effort!':'Keep practising!');
  setText('resSub',`Scored ${session.correct} out of ${session.qty}`);
  setText('resPct',pct+'%'); setText('resBest',session.best+'🔥'); setText('resTime',avg);
  const ri=document.getElementById('reviewItems'); ri.textContent='';
  session.answers.forEach(a=>ri.appendChild(buildReviewItem(a)));
}

/* A03: Build review item via DOM API — never innerHTML with user data */
function buildReviewItem(a) {
  const wrap=document.createElement('div'); wrap.className='ri';
  const icon=document.createElement('div');
  icon.style.cssText='font-size:16px;flex-shrink:0;margin-top:1px';
  icon.textContent=a.ok?'✅':'❌';
  const info=document.createElement('div'); info.style.cssText='flex:1;min-width:0';
  const qDiv=document.createElement('div'); qDiv.className='rq'; qDiv.textContent=a.q;
  const aDiv=document.createElement('div'); aDiv.className='ra';
  const aLabel=document.createTextNode('Your answer: ');
  const aSpan=document.createElement('span'); aSpan.className=a.ok?'ca':'wa'; aSpan.textContent=a.chosen;
  aDiv.appendChild(aLabel); aDiv.appendChild(aSpan);
  if(!a.ok){
    aDiv.appendChild(document.createTextNode(' · Correct: '));
    const cSpan=document.createElement('span'); cSpan.className='ca'; cSpan.textContent=a.right;
    aDiv.appendChild(cSpan);
  }
  info.append(qDiv,aDiv);
  const badge=document.createElement('span');
  badge.className='qbadge '+a.cat; badge.style.cssText='margin:0;flex-shrink:0';
  badge.textContent=CATS[a.cat]?CATS[a.cat].emoji:'🎲';
  wrap.append(icon,info,badge);
  return wrap;
}

/* ═══════════════════════════
   SCORING
   Score = correct × accuracy%
   Rewards both volume (questions done) and quality (getting right).
   e.g. 80 correct at 90% accuracy = 7,200 pts
═══════════════════════════ */
const PLACE_MEDALS = ['🥇','🥈','🥉'];
const PLACE_COLOURS = {0:'#f59e0b', 1:'#94a3b8', 2:'#cd7c2f'};

function calcScore(correct, total) {
  if (!total || !correct) return 0;
  const acc = Math.round(correct / total * 100);
  return correct * acc;
}

function fmtScore(score) {
  if (!Number.isFinite(score) || score < 0) return '0';
  if (score >= 1_000_000) return (score/1_000_000).toFixed(1).replace(/\.0$/,'')+'M';
  if (score >= 1_000)     return (score/1_000).toFixed(1).replace(/\.0$/,'')+'k';
  return String(score);
}

function buildLeaderboardData() {
  const myId = getSessionId();
  const rows = getAllSessions().map(sess => {
    const st      = validateState(sess.state); // A08: validate before use
    const total   = st.total;
    const correct = st.correct;
    const streak  = st.bestStreak;
    const acc     = total > 0 ? Math.round(correct / total * 100) : 0;
    const score   = calcScore(correct, total);
    const catData = {};
    ['speed','distance','time'].forEach(c => {
      const cd = st.cats[c] || {d:0,c:0};
      catData[c] = {
        done:    cd.d,
        correct: cd.c,
        acc:     cd.d > 0 ? Math.round(cd.c / cd.d * 100) : null
      };
    });
    return {
      id: sess.id, name: sess.name, avatar: sess.avatar || '🚀',
      avatarBg: sess.avatarBg || 'av-bg-1',
      total, correct, acc, score, streak, catData,
      isMe: sess.id === myId
    };
  });
  // Sort by score desc → accuracy desc → total desc
  rows.sort((a,b) => b.score - a.score || b.acc - a.acc || b.total - a.total);
  return rows;
}

/* A03: Build entire leaderboard via DOM API — zero innerHTML with user data */
function renderLeaderboard() {
  const tbody = document.getElementById('leaderboardBody');
  if (!tbody) return;
  tbody.textContent = ''; // clear safely

  const rows = buildLeaderboardData();
  if (!rows.length) {
    const tr=document.createElement('tr');
    const td=document.createElement('td'); td.colSpan=7; td.className='lb-empty';
    td.textContent='No sessions yet — start a quiz to appear here!';
    tr.appendChild(td); tbody.appendChild(tr); return;
  }

  const maxScore = Math.max(...rows.map(r=>r.score), 1);

  rows.forEach((row, idx) => {
    const place     = idx < PLACE_MEDALS.length ? PLACE_MEDALS[idx] : String(idx+1);
    const posColour = PLACE_COLOURS[idx] || '#7c5a8a';
    const isMe      = row.isMe;

    const tr = document.createElement('tr');
    tr.className = 'lb-row' + (isMe ? ' lb-row-me' : '');

    /* ── Place cell ── */
    const tdPlace = document.createElement('td'); tdPlace.className='lb-place';
    const placeDiv = document.createElement('div'); placeDiv.className='lb-place-inner';
    placeDiv.style.color = posColour;
    placeDiv.textContent = place; // medal emoji or number — not user data
    tdPlace.appendChild(placeDiv); tr.appendChild(tdPlace);

    /* ── Player cell ── */
    const tdPlayer = document.createElement('td'); tdPlayer.className='lb-player';
    const av = document.createElement('div');
    av.className = 'lb-av ' + row.avatarBg; // avatarBg from whitelist
    av.textContent = row.avatar; // emoji — safe
    const nameWrap = document.createElement('div'); nameWrap.className='lb-name-wrap';
    const nameSpan = document.createElement('span'); nameSpan.className='lb-name';
    nameSpan.textContent = row.name; // A03: textContent for user name
    if (isMe) {
      const youBadge = document.createElement('span'); youBadge.className='lb-you';
      youBadge.textContent='you'; nameSpan.appendChild(youBadge);
    }
    const streakSpan = document.createElement('span'); streakSpan.className='lb-streak';
    streakSpan.textContent = `🔥 ${row.streak}  ·  ${row.total} done  ·  ${row.acc}% acc`;
    nameWrap.append(nameSpan, streakSpan);
    tdPlayer.append(av, nameWrap); tr.appendChild(tdPlayer);

    /* ── Category cells (Speed, Distance, Time) ── */
    ['speed','distance','time'].forEach(c => {
      const cd  = row.catData[c];
      const acc = cd.acc;
      const col = acc === null ? '#7c5a8a' : acc >= 80 ? '#16a34a' : acc >= 50 ? '#d97706' : '#dc2626';

      const td   = document.createElement('td'); td.className='lb-cat-cell';
      const accD = document.createElement('div'); accD.className='lb-cat-acc';
      accD.style.color = col;
      accD.textContent = acc === null ? '—' : acc + '%';
      const doneD = document.createElement('div'); doneD.className='lb-cat-done';
      doneD.textContent = cd.done > 0 ? `${cd.correct}/${cd.done}` : '—';
      td.append(accD, doneD); tr.appendChild(td);
    });

    /* ── Overall accuracy cell ── */
    const tdAcc = document.createElement('td'); tdAcc.className='lb-acc-cell';
    const accWrap = document.createElement('div'); accWrap.className='lb-acc-bar-wrap';
    const accNum = document.createElement('div'); accNum.className='lb-acc-num';
    accNum.textContent = row.acc + '%';
    const accBar = document.createElement('div'); accBar.className='lb-acc-bar';
    const accFill = document.createElement('div'); accFill.className='lb-acc-fill';
    accFill.style.width = row.acc + '%';
    accBar.appendChild(accFill);
    const accTotal = document.createElement('div'); accTotal.className='lb-total';
    accTotal.textContent = `${row.correct} correct / ${row.total}`;
    accWrap.append(accNum, accBar, accTotal); tdAcc.appendChild(accWrap); tr.appendChild(tdAcc);

    /* ── Score cell ── */
    const tdScore = document.createElement('td'); tdScore.className='lb-score-cell';
    const scoreNum = document.createElement('div'); scoreNum.className='lb-score-num';
    scoreNum.style.color = posColour;
    scoreNum.textContent = fmtScore(row.score);
    const scoreBar = document.createElement('div'); scoreBar.className='lb-score-bar';
    const scoreFill = document.createElement('div'); scoreFill.className='lb-score-fill';
    const barPct = maxScore > 0 ? Math.round(row.score / maxScore * 100) : 0;
    scoreFill.style.cssText = `width:${barPct}%;background:${posColour}`;
    scoreBar.appendChild(scoreFill);
    const scoreLbl = document.createElement('div'); scoreLbl.className='lb-score-lbl';
    scoreLbl.textContent='pts';
    tdScore.append(scoreNum, scoreBar, scoreLbl); tr.appendChild(tdScore);

    tbody.appendChild(tr);
  });
}

/* ═══════════════════════════
   DASHBOARD
═══════════════════════════ */
function updateDash() {
  // A01: re-verify auth on every dashboard update
  if (!AuthSession.isValid()) { doLogout(); return; }

  const rec = getSessionRecord();
  if (rec) {
    setText('sessionName', rec.name); // A03: textContent
    const avEl = document.getElementById('sessionAvatar');
    if (avEl) {
      avEl.textContent = rec.avatar || '🚀';
      avEl.className   = 'sess-av-badge ' + (rec.avatarBg || 'av-bg-1');
    }
  }

  const myScore = calcScore(state.correct, state.total);
  setText('hTotal',   state.total);
  setText('hCorrect', state.correct);
  setText('hAcc',     state.total > 0 ? Math.round(state.correct/state.total*100)+'%' : '—');
  setText('hStreak',  state.bestStreak + '🔥');
  setText('hScore',   fmtScore(myScore));

  ['speed','distance','time'].forEach(c => {
    const s = state.cats[c];
    const el = document.getElementById('pg-'+c);
    if (el) el.style.width = (s.d > 0 ? Math.round(s.c/s.d*100) : 0) + '%';
  });

  document.getElementById('histBtn').classList.toggle('hidden', state.total === 0);
}

function resetAll() {
  state = emptyState(); saveState(); updateDash(); renderLeaderboard();
}

/* ═══════════════════════════
   PERSISTENCE  (A04, A08)
═══════════════════════════ */
function saveState() {
  const rec = getSessionRecord(); if (!rec) return;
  rec.state      = state;
  rec.lastActive = Date.now();
  saveSessionRecord(rec);
}

function loadState() {
  const rec = getSessionRecord();
  if (rec && rec.state) state = validateState(rec.state); // A08
}

/* ═══════════════════════════
   AUTH  (A01, A07)
═══════════════════════════ */
function doLogout() {
  AuthSession.clear();
  sessionStorage.removeItem('sdt_session_id');
  window.location.replace('login.html');
}

/* ═══════════════════════════
   INIT  (A01: guard on load)
═══════════════════════════ */
(function init() {
  'use strict';
  // A01: Validate full session nonce — simple flag check is not enough
  if (!AuthSession.isValid() || !Validate.sessionId(sessionStorage.getItem('sdt_session_id')||'')) {
    AuthSession.clear();
    window.location.replace('login.html');
    return;
  }
  loadState();
  setCat('mixed');
  updateDash();
  renderLeaderboard();
})();
