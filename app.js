/* ─────────────────────────────────────────────────────
   Speed · Distance · Time Quiz — app.js
   3 categories: Speed · Distance · Time  (no Conversions)
   Multi-session: each session stored under sdt_session_{id}
   Live leaderboard: ranked by accuracy then total done
───────────────────────────────────────────────────── */

/* ── SESSION IDENTITY ── */
const SESSION_PFX = 'sdt_session_';

function getSessionId()     { return sessionStorage.getItem('sdt_session_id') || null; }
function getSessionRecord() {
  const id = getSessionId(); if (!id) return null;
  try { return JSON.parse(localStorage.getItem(SESSION_PFX + id)); } catch { return null; }
}
function saveSessionRecord(r) {
  if (!r) return;
  localStorage.setItem(SESSION_PFX + r.id, JSON.stringify(r));
}
function getSessionIds() {
  try { return JSON.parse(localStorage.getItem('sdt_sessions') || '[]'); } catch { return []; }
}
function getAllSessions() {
  return getSessionIds().map(id => {
    try { return JSON.parse(localStorage.getItem(SESSION_PFX + id)); } catch { return null; }
  }).filter(Boolean);
}

/* ── STATE ── */
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

let state   = emptyState();
let session = { mode:'whole', cat:'mixed', diff:'easy', qty:10,
  idx:0, correct:0, streak:0, best:0, qs:[], answers:[], t0:[], totalTime:0 };
let selCat  = 'mixed';
let curQ    = null;
let answered = false;
let WHOLE   = null, DECIMAL = null;

/* ── NAV ── */
function goHome()   { show('homeScreen'); updateDash(); renderLeaderboard(); }
function goReview() {
  show('reviewScreen');
  const el = document.getElementById('reviewAll');
  if (!state.history.length) { el.innerHTML='<p style="color:#7c5a8a;font-size:13px;padding:1rem 0;">No history yet.</p>'; return; }
  el.innerHTML = state.history.slice().reverse().map(ri).join('');
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
  session.mode = m;
  document.getElementById('setupTitle').textContent = m==='whole' ? '🔢 Whole numbers quiz' : '🔣 Decimals quiz';
  document.getElementById('setupSub').textContent   = m==='whole' ? 'Whole numbers only' : 'Includes fractional values';
  show('setupScreen');
}
function setCat(c) {
  selCat = c;
  document.querySelectorAll('.setup-cats .cc').forEach(e => e.style.borderColor='transparent');
  const el = document.querySelector('.setup-cats .cc.'+c);
  if (el) el.style.borderColor = '#7c3aed';
}
function setDiff(d) {
  session.diff = d;
  ['easy','medium','hard'].forEach(x => document.getElementById('diff-'+x).classList.toggle('active', x===d));
}
function setQty(n) {
  session.qty = n;
  [10,20,50].forEach(x => document.getElementById('qty-'+x).classList.toggle('active', x===n));
}

/* ── REF BAR ── */
function refBarHTML() {
  return `
  <div class="ref-tile">
    <div class="tri-row">
      <svg viewBox="0 0 120 106" width="58" height="51" class="tri-svg" xmlns="http://www.w3.org/2000/svg">
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
    <table class="mt">
      <thead><tr><th>min</th><th>hrs</th><th></th></tr></thead>
      <tbody>
        <tr><td>6</td><td>0.1</td><td></td></tr>
        <tr><td>10</td><td>0.167</td><td></td></tr>
        <tr><td>15</td><td>0.25</td><td><span class="mp">¼</span></td></tr>
        <tr><td>20</td><td>0.33</td><td></td></tr>
        <tr><td>30</td><td>0.5</td><td><span class="mp">½</span></td></tr>
        <tr><td>40</td><td>0.67</td><td></td></tr>
        <tr><td>45</td><td>0.75</td><td><span class="mp">¾</span></td></tr>
        <tr><td>50</td><td>0.833</td><td></td></tr>
        <tr><td>60</td><td>1.0</td><td><span class="mp">1hr</span></td></tr>
      </tbody>
    </table>
  </div>`;
}

/* ── UTILS ── */
function sh(a) {
  for (let i=a.length-1;i>0;i--) { const j=Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; }
  return a;
}
function shOpts(correct, fakes) {
  const all=[correct,...fakes.slice(0,3)]; sh(all);
  return { opts:all, ans:all.indexOf(correct) };
}
function interleave(...arrays) {
  const result=[]; const maxLen=Math.max(...arrays.map(a=>a.length));
  for(let i=0;i<maxLen;i++) for(const arr of arrays) if(i<arr.length) result.push(arr[i]);
  return result;
}
function antiConsecutiveShuffle(qs) {
  sh(qs);
  for(let pass=0;pass<3;pass++) {
    for(let i=2;i<qs.length;i++) {
      if(qs[i].ans===qs[i-1].ans&&qs[i].ans===qs[i-2].ans) {
        const sw=Math.min(i+1+Math.floor(Math.random()*4),qs.length-1);
        if(sw!==i)[qs[i],qs[sw]]=[qs[sw],qs[i]];
      }
    }
  }
  return qs;
}

/* ── VEHICLES ── */
const V=[
  ['car','km','km/h'],['train','km','km/h'],['bus','miles','mph'],
  ['cyclist','km','km/h'],['lorry','km','km/h'],['plane','km','km/h'],
  ['boat','km','km/h'],['motorcycle','km','km/h'],['runner','km','km/h'],
  ['horse','km','km/h'],['tram','km','km/h'],['ferry','km','km/h'],
  ['rocket','km','km/h'],['speedboat','km','km/h'],['scooter','km','km/h'],
  ['van','km','km/h'],['ambulance','km','km/h'],['sports car','km','km/h'],
  ['electric car','km','km/h'],['minibus','miles','mph']
];

/* ── WHOLE NUMBER BANK (750 Qs: 250 speed + 250 distance + 250 time) ── */
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

/* ── QUIZ FLOW ── */
function launchQuiz() {
  session.cat=selCat; session.idx=0; session.correct=0; session.streak=0; session.best=0;
  session.qs=getQs(); session.answers=[]; session.t0=[]; session.totalTime=0;
  const badge=document.getElementById('quizMBadge');
  badge.textContent=session.mode==='whole'?'Whole':'Decimal';
  badge.className='mbadge '+(session.mode==='whole'?'whole':'decimal');
  show('quizScreen'); loadQ();
}
function replayQuiz() { WHOLE=null; DECIMAL=null; launchQuiz(); }

function loadQ() {
  answered=false;
  document.getElementById('feedbackEl').style.display='none';
  if(session.idx>=session.qty){showResults();return;}
  curQ=session.qs[session.idx];
  session.t0[session.idx]=Date.now();
  document.getElementById('qCount').textContent  =`Q ${session.idx+1} / ${session.qty}`;
  document.getElementById('qScore').textContent  =`${session.correct} correct`;
  document.getElementById('progBar').style.width =Math.round(session.idx/session.qty*100)+'%';
  document.getElementById('streakNum').textContent=session.streak;
  const badge=document.getElementById('qBadge');
  badge.textContent=CATS[curQ.cat].emoji+' '+CATS[curQ.cat].label;
  badge.className='qbadge '+curQ.cat;
  document.getElementById('qText').textContent=curQ.q;
  const wrap=document.getElementById('optsWrap'); wrap.innerHTML='';
  curQ.opts.forEach((opt,i)=>{
    const b=document.createElement('button');
    b.className='opt'; b.textContent=opt;
    b.addEventListener('click',()=>selAns(i,b)); wrap.appendChild(b);
  });
}

function selAns(i,btn) {
  if(answered)return; answered=true;
  const el=Math.round((Date.now()-session.t0[session.idx])/100)/10;
  session.totalTime+=el;
  document.querySelectorAll('.opt').forEach(b=>b.disabled=true);
  const ok=i===curQ.ans;
  btn.classList.add(ok?'correct':'wrong');
  if(!ok)document.querySelectorAll('.opt')[curQ.ans].classList.add('show-correct');
  if(ok){session.correct++;session.streak++;if(session.streak>session.best)session.best=session.streak;}
  else session.streak=0;
  document.getElementById('streakNum').textContent=session.streak;
  document.getElementById('qScore').textContent=`${session.correct} correct`;
  if(state.cats[curQ.cat]){state.cats[curQ.cat].d++;if(ok)state.cats[curQ.cat].c++;}
  state.total++;if(ok)state.correct++;
  if(session.best>state.bestStreak)state.bestStreak=session.best;
  const entry={q:curQ.q,cat:curQ.cat,ok,chosen:curQ.opts[i],right:curQ.opts[curQ.ans]};
  state.history.push(entry); session.answers.push(entry);
  showFeedback(ok,curQ.hint,curQ.opts[curQ.ans]);
  saveState();
}

function showFeedback(ok,hint,correct) {
  const fb=document.getElementById('feedbackEl');
  fb.className='fb '+(ok?'correct':'wrong');
  document.getElementById('fbIcon').textContent=ok?'✅':'❌';
  document.getElementById('fbLbl').textContent =ok?'Correct!':'Incorrect';
  document.getElementById('fbLbl').className   ='fb-lbl '+(ok?'correct':'wrong');
  document.getElementById('fbHint').innerHTML  =ok
    ?`<strong>Working:</strong> ${hint}`
    :`<strong>Correct answer:</strong> ${correct}<br><strong>Working:</strong> ${hint}`;
  const isLast=session.idx+1>=session.qty;
  const nxt=isLast?'See results 🏆':'Next →';
  if(ok){
    document.getElementById('fbBtns').className='fb-btns one';
    document.getElementById('fbBtns').innerHTML=`<button class="fbbtn nxt" onclick="advance()">${nxt}</button>`;
  } else {
    document.getElementById('fbBtns').className='fb-btns two';
    document.getElementById('fbBtns').innerHTML=
      `<button class="fbbtn try" onclick="tryAgain()">↩ Try again</button>
       <button class="fbbtn nxt" onclick="advance()">${nxt}</button>`;
  }
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
  session.idx++; if(session.idx>=session.qty){showResults();return;} loadQ();
}

function showResults() {
  show('resultsScreen');
  const pct=Math.round(session.correct/session.qty*100);
  const avg=session.answers.length?(session.totalTime/session.answers.length).toFixed(1)+'s':'—';
  document.getElementById('resEmoji').textContent=pct>=90?'🏆':pct>=70?'🎉':pct>=50?'👍':'📚';
  document.getElementById('resTitle').textContent=pct>=90?'Outstanding!':pct>=70?'Great work!':pct>=50?'Good effort!':'Keep practising!';
  document.getElementById('resSub').textContent  =`Scored ${session.correct} out of ${session.qty}`;
  document.getElementById('resPct').textContent  =pct+'%';
  document.getElementById('resBest').textContent =session.best+'🔥';
  document.getElementById('resTime').textContent =avg;
  document.getElementById('reviewItems').innerHTML=session.answers.map(ri).join('');
}

function ri(a) {
  return `<div class="ri">
    <div style="font-size:16px;flex-shrink:0;margin-top:1px">${a.ok?'✅':'❌'}</div>
    <div style="flex:1;min-width:0">
      <div class="rq">${a.q}</div>
      <div class="ra">Your answer: <span class="${a.ok?'ca':'wa'}">${a.chosen}</span>
        ${!a.ok?` · Correct: <span class="ca">${a.right}</span>`:''}</div>
    </div>
    <span class="qbadge ${a.cat}" style="margin:0;flex-shrink:0">${CATS[a.cat]?CATS[a.cat].emoji:'🎲'}</span>
  </div>`;
}

/* ── SCORING ──
   Score = correct × accuracy  (e.g. 80 correct at 90% acc = 7200 pts)
   This rewards both volume (questions done) and quality (accuracy).
   Displayed as integer points, sorted highest → lowest. */

const PLACE_MEDALS = ['🥇','🥈','🥉'];

function calcScore(correct, total) {
  if (!total || !correct) return 0;
  const acc = Math.round(correct / total * 100);
  return correct * acc; // e.g. 80 correct × 90% = 7200
}

function fmtScore(score) {
  if (score >= 1000) return (score/1000).toFixed(1).replace(/\.0$/,'') + 'k';
  return String(score);
}

function buildLeaderboard() {
  const all  = getAllSessions();
  const myId = getSessionId();

  const rows = all.map(sess => {
    const st     = sess.state || {};
    const total  = st.total    || 0;
    const correct= st.correct  || 0;
    const streak = st.bestStreak || 0;
    const acc    = total > 0 ? Math.round(correct / total * 100) : 0;
    const score  = calcScore(correct, total);
    const cats   = st.cats || {};
    const catData = {};
    ['speed','distance','time'].forEach(c => {
      const cd = cats[c] || {d:0,c:0};
      catData[c] = {
        done:    cd.d || 0,
        correct: cd.c || 0,
        acc:     cd.d > 0 ? Math.round(cd.c / cd.d * 100) : null
      };
    });
    return { id:sess.id, name:sess.name, avatar:sess.avatar||'🚀', avatarBg:sess.avatarBg||'av-bg-1',
      total, correct, acc, score, streak, catData, isMe: sess.id === myId };
  });

  // Sort by score desc, then accuracy desc, then total desc
  rows.sort((a,b) => b.score - a.score || b.acc - a.acc || b.total - a.total);
  return rows;
}

function renderLeaderboard() {
  const el = document.getElementById('leaderboardBody');
  if (!el) return;

  const rows = buildLeaderboard();
  const myId = getSessionId();

  if (!rows.length) {
    el.innerHTML = `<tr><td colspan="7" class="lb-empty">No sessions yet — start a quiz to appear here!</td></tr>`;
    return;
  }

  // Find max score for bar scaling
  const maxScore = Math.max(...rows.map(r => r.score), 1);

  el.innerHTML = rows.map((row, idx) => {
    const place     = idx < PLACE_MEDALS.length ? PLACE_MEDALS[idx] : `${idx+1}`;
    const isMe      = row.id === myId;
    const highlight = isMe ? ' lb-row-me' : '';

    // Category cells: show correct/done and accuracy%
    const catCells = ['speed','distance','time'].map(c => {
      const cd  = row.catData[c];
      const acc = cd.acc;
      const col = acc === null ? '#777' : acc >= 80 ? '#16a34a' : acc >= 50 ? '#d97706' : '#dc2626';
      const accTxt = acc === null ? '—' : acc + '%';
      const doneTxt= cd.done > 0 ? `${cd.correct}/${cd.done}` : '—';
      return `<td class="lb-cat-cell">
        <div class="lb-cat-acc" style="color:${col}">${accTxt}</div>
        <div class="lb-cat-done">${doneTxt}</div>
      </td>`;
    }).join('');

    // Score bar width relative to top scorer
    const barPct = maxScore > 0 ? Math.round(row.score / maxScore * 100) : 0;

    // Position badge colour
    const posColour = idx === 0 ? '#f59e0b' : idx === 1 ? '#94a3b8' : idx === 2 ? '#cd7c2f' : '#7c5a8a';

    return `<tr class="lb-row${highlight}" data-id="${row.id}">
      <td class="lb-place">
        <div class="lb-place-inner" style="color:${posColour}">${place}</div>
      </td>
      <td class="lb-player">
        <div class="lb-av ${row.avatarBg}">${row.avatar}</div>
        <div class="lb-name-wrap">
          <span class="lb-name">${escHtml(row.name)}${isMe ? ' <span class="lb-you">you</span>' : ''}</span>
          <span class="lb-streak">🔥 ${row.streak} &nbsp;·&nbsp; ${row.total} done &nbsp;·&nbsp; ${row.acc}% acc</span>
        </div>
      </td>
      ${catCells}
      <td class="lb-acc-cell">
        <div class="lb-acc-bar-wrap">
          <div class="lb-acc-num">${row.acc}%</div>
          <div class="lb-acc-bar"><div class="lb-acc-fill" style="width:${row.acc}%"></div></div>
          <div class="lb-total">${row.correct} correct / ${row.total}</div>
        </div>
      </td>
      <td class="lb-score-cell">
        <div class="lb-score-num" style="color:${posColour}">${fmtScore(row.score)}</div>
        <div class="lb-score-bar"><div class="lb-score-fill" style="width:${barPct}%;background:${posColour}"></div></div>
        <div class="lb-score-lbl">pts</div>
      </td>
    </tr>`;
  }).join('');
}

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

/* ── DASHBOARD ── */
function updateDash() {
  const rec = getSessionRecord();
  const nameEl = document.getElementById('sessionName');
  const avEl   = document.getElementById('sessionAvatar');
  if (rec) {
    if(nameEl) nameEl.textContent = rec.name;
    if(avEl)   { avEl.textContent=rec.avatar||'🚀'; avEl.className='sess-av-badge '+(rec.avatarBg||'av-bg-1'); }
  }
  const myScore = calcScore(state.correct, state.total);
  document.getElementById('hTotal').textContent   = state.total;
  document.getElementById('hCorrect').textContent = state.correct;
  document.getElementById('hAcc').textContent     = state.total>0 ? Math.round(state.correct/state.total*100)+'%' : '—';
  document.getElementById('hStreak').textContent  = state.bestStreak+'🔥';
  const scoreEl = document.getElementById('hScore');
  if (scoreEl) scoreEl.textContent = fmtScore(myScore);
  ['speed','distance','time'].forEach(c=>{
    const s=state.cats[c];
    const el=document.getElementById('pg-'+c);
    if(el) el.style.width=(s.d>0?Math.round(s.c/s.d*100):0)+'%';
  });
  document.getElementById('histBtn').classList.toggle('hidden', state.total===0);
}

function resetAll() {
  state=emptyState(); saveState(); updateDash(); renderLeaderboard();
}

/* ── PERSISTENCE ── */
function saveState() {
  const rec=getSessionRecord(); if(!rec)return;
  rec.state=state; rec.lastActive=Date.now(); saveSessionRecord(rec);
}
function loadState() {
  const rec=getSessionRecord();
  if(rec&&rec.state) state={...emptyState(),...rec.state};
}

/* ── AUTH ── */
function doLogout() {
  if(confirm('Sign out and return to the login page?')) {
    sessionStorage.removeItem('sdt_auth');
    sessionStorage.removeItem('sdt_session_id');
    window.location.replace('login.html');
  }
}

/* ── INIT ── */
loadState(); setCat('mixed'); updateDash(); renderLeaderboard();
