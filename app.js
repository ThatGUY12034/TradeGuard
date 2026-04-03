/* ==============================================
   TradeGuard — app.js
   GFT PRO 5K 2-Step Challenge Edition
   Rules: Phase1=8%, Phase2=4%, DailyDD=5%, MaxDD=8%, Payout cap=6% (first 2)
================================================ */

// ──────────────────────────────────────────────
// GFT PRO 5K RULES CONFIG
// ──────────────────────────────────────────────
const GFT_RULES = {
  name: 'GFT PRO 5K 2-Step',
  accountSize: 5000,
  phase1Target: 8,        // 8% = $400
  phase2Target: 4,        // 4% = $200
  dailyDrawdownPct: 5,    // 5% = $250/day
  maxDrawdownPct: 8,      // 8% = $400 total
  maxRiskPerTrade: 1,     // recommended max 1% on $5K = $50
  goatGuardFloat: 2,      // 2% floating loss = $100 → auto-close on funded
  payoutCapPct: 6,        // first 2 payouts capped at 6% = $300
  minTradingDays: 3,      // per phase & per payout cycle
  minDayProfitPct: 0.5,   // each of 3 days must show 0.5% profit = $25
  newsProfitCap: 1,       // max 1% profit from trades within 5min of news
  newsWindow: 5,          // minutes before/after high-impact news
  payoutSplit: 80,        // 80% profit split
  dailyProfitCap: 3000,   // funded: $3,000/day profit cap
};

// ──────────────────────────────────────────────
// CONFIG — API key fetched from Vercel
// ──────────────────────────────────────────────
let GROQ_API_KEY = null;

async function fetchApiKey() {
  try {
    const response = await fetch('/api/config');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    if (data.GROQ_API_KEY) {
      GROQ_API_KEY = data.GROQ_API_KEY;
      console.log('✅ API key loaded');
      return true;
    }
    return false;
  } catch (error) {
    console.warn('⚠️ Could not fetch API key:', error.message);
    return false;
  }
}

// ──────────────────────────────────────────────
// INSTRUMENT CONFIG TABLE
// ──────────────────────────────────────────────
function getInstrumentInfo(pair) {
  const p = pair.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (p.includes('XAU') || p.includes('GOLD'))  return { contract: 100,    unit: 'lots', pipSize: 0.01,   label: 'XAUUSD (Gold)' };
  if (p.includes('XAG') || p.includes('SILVER')) return { contract: 5000,   unit: 'lots', pipSize: 0.001,  label: 'XAGUSD (Silver)' };
  if (p.includes('JPY')) return { contract: 100000, unit: 'lots', pipSize: 0.01, label: pair, isJPY: true };
  if (p.includes('BTC'))  return { contract: 1,  unit: 'BTC',  pipSize: 1,      label: 'Bitcoin' };
  if (p.includes('ETH'))  return { contract: 1,  unit: 'ETH',  pipSize: 0.1,    label: 'Ethereum' };
  if (p.includes('SOL'))  return { contract: 1,  unit: 'SOL',  pipSize: 0.01,   label: 'Solana' };
  if (p.includes('XRP'))  return { contract: 1,  unit: 'XRP',  pipSize: 0.0001, label: 'XRP' };
  if (p.includes('US30') || p.includes('DOW'))  return { contract: 1,   unit: 'contracts', pipSize: 1,    label: 'US30 (Dow)' };
  if (p.includes('NAS100') || p.includes('NQ')) return { contract: 20,  unit: 'contracts', pipSize: 0.25, label: 'NAS100' };
  if (p.includes('SPX') || p.includes('SP500')) return { contract: 50,  unit: 'contracts', pipSize: 0.25, label: 'SP500' };
  if (p.includes('GER40') || p.includes('DAX')) return { contract: 1,   unit: 'contracts', pipSize: 1,    label: 'GER40 (DAX)' };
  if (p.includes('UK100') || p.includes('FTSE'))return { contract: 1,   unit: 'contracts', pipSize: 1,    label: 'UK100 (FTSE)' };
  if (p.includes('WTI') || p.includes('OIL') || p.includes('USOIL')) return { contract: 1000, unit: 'lots', pipSize: 0.01, label: 'WTI Oil' };
  if (p.includes('BRENT') || p.includes('UKOIL'))                    return { contract: 1000, unit: 'lots', pipSize: 0.01, label: 'Brent Oil' };
  return { contract: 100000, unit: 'lots', pipSize: 0.0001, label: pair };
}

// ──────────────────────────────────────────────
// CORE CALCULATION
// ──────────────────────────────────────────────
function computeLotSize({ accountSize, riskPercent, entryPrice, slPrice, tpPrice, direction, pair }) {
  const riskUSD = accountSize * riskPercent / 100;
  const info = getInstrumentInfo(pair);
  const slDist = Math.abs(entryPrice - slPrice);
  const tpDist = Math.abs(entryPrice - tpPrice);
  if (slDist === 0) return null;

  let lotSize;
  // Calculate based on instrument type
  if (pair.includes('XAU') || pair.includes('GOLD')) {
    // Gold: 1 lot = 100 units, 1 pip = 0.01, value per pip = $1 per lot
    lotSize = riskUSD / (slDist * 100);
  } 
  else if (pair.includes('JPY')) {
    // JPY pairs: pip = 0.01, value per pip = $1000 per lot (100,000 * 0.01 / 100)
    lotSize = riskUSD / (slDist * 1000);
  }
  else if (pair.includes('BTC') || pair.includes('ETH') || pair.includes('SOL') || pair.includes('XRP')) {
    // Crypto: 1 lot = 1 coin, value = pip size × contract
    lotSize = riskUSD / (slDist * info.contract);
  }
  else if (pair.includes('US30') || pair.includes('NAS100') || pair.includes('SPX')) {
    // Indices: varies by broker, but typical formula
    lotSize = riskUSD / (slDist * info.contract);
  }
  else {
    // Standard Forex: 1 lot = 100,000 units, 1 pip = 0.0001 = $10 per pip
    lotSize = riskUSD / (slDist * 10);  // 100,000 / 10000 = 10
  }

  const slOk = direction === 'BUY' ? slPrice < entryPrice : slPrice > entryPrice;
  const tpOk = direction === 'BUY' ? tpPrice > entryPrice : tpPrice < entryPrice;
  const slPips = slDist / info.pipSize;
  const tpPips = tpDist / info.pipSize;
  const rr = tpDist / slDist;
  const profitUSD = lotSize * tpDist * (info.contract / (info.isJPY ? 100 : 1));
  const lossUSD = lotSize * slDist * (info.contract / (info.isJPY ? 100 : 1));

  return {
    lotSize, riskUSD, lossUSD, profitUSD,
    slDist, tpDist, slPips, tpPips, rr,
    unit: info.unit, label: info.label,
    slOk, tpOk, riskPercent, accountSize,
    formula: `Risk ($${riskUSD.toFixed(2)}) ÷ (SL distance [${slDist.toFixed(5)}] × ${info.contract === 100000 ? '10' : info.contract}) = ${lotSize.toFixed(4)} ${info.unit}`
  };
}
// ──────────────────────────────────────────────
// GFT PRO RULE CHECKER
// ──────────────────────────────────────────────
function checkGFTRules({ riskPercent, riskUSD, accountSize, rr, slOk, tpOk }) {
  const dailyLimitUSD  = accountSize * GFT_RULES.dailyDrawdownPct / 100;  // $250
  const maxDDUSD       = accountSize * GFT_RULES.maxDrawdownPct / 100;    // $400
  const goatGuardUSD   = accountSize * GFT_RULES.goatGuardFloat / 100;    // $100
  const maxSafeRiskPct = (goatGuardUSD / accountSize) * 100;              // 2% = $100

  // How many consecutive losses before breach
  const lossesTillDD    = Math.floor(maxDDUSD / riskUSD);
  const lossesTillDaily = Math.floor(dailyLimitUSD / riskUSD);

  return [
    {
      ok: slOk && tpOk,
      cls: slOk && tpOk ? 'pass' : 'fail',
      icon: slOk && tpOk ? '✅' : '❌',
      text: `SL/TP Direction: ${slOk && tpOk ? 'Correct ✓' : 'WRONG — flip SL or TP'}`
    },
    {
      ok: riskPercent <= 1,
      cls: riskPercent <= 1 ? 'pass' : riskPercent <= 1.5 ? 'warn' : 'fail',
      icon: riskPercent <= 1 ? '✅' : riskPercent <= 1.5 ? '⚠️' : '❌',
      text: `Risk: ${riskPercent}% ($${riskUSD.toFixed(2)}) ${riskPercent <= 1 ? '— safe ✓' : riskPercent <= 1.5 ? '— borderline, keep ≤1%' : '— TOO HIGH for $5K account'}`
    },
    {
      ok: rr >= 2,
      cls: rr >= 2 ? 'pass' : rr >= 1.5 ? 'warn' : 'fail',
      icon: rr >= 2 ? '✅' : rr >= 1.5 ? '⚠️' : '❌',
      text: `R:R 1:${rr.toFixed(2)} ${rr >= 2 ? '— Excellent ✓' : rr >= 1.5 ? '— Acceptable' : '— Too low, avoid'}`
    },
    {
      ok: riskUSD <= goatGuardUSD,
      cls: riskUSD <= goatGuardUSD ? 'pass' : 'warn',
      icon: riskUSD <= goatGuardUSD ? '✅' : '⚠️',
      text: `Goat Guard: SL at $${riskUSD.toFixed(0)} vs $${goatGuardUSD} float limit — ${riskUSD <= goatGuardUSD ? 'safe ✓' : 'risk triggering auto-close!'}`
    },
    {
      ok: lossesTillDD >= 5,
      cls: lossesTillDD >= 8 ? 'pass' : lossesTillDD >= 5 ? 'warn' : 'fail',
      icon: lossesTillDD >= 8 ? '✅' : lossesTillDD >= 5 ? '⚠️' : '❌',
      text: `Buffer: ${lossesTillDD} consecutive losses before 8% max breach ($${maxDDUSD})`
    },
    {
      ok: lossesTillDaily >= 3,
      cls: lossesTillDaily >= 4 ? 'pass' : lossesTillDaily >= 3 ? 'warn' : 'fail',
      icon: lossesTillDaily >= 4 ? '✅' : lossesTillDaily >= 3 ? '⚠️' : '❌',
      text: `Daily: ${lossesTillDaily} losses before 5% daily limit ($${dailyLimitUSD})`
    }
  ];
}

// ──────────────────────────────────────────────
// STATE
// ──────────────────────────────────────────────
let lastCalc  = null;
let journal   = JSON.parse(localStorage.getItem('tg_j')  || '[]');
let dlEntries = JSON.parse(localStorage.getItem('tg_dl') || '[]');
let phase1PnL = parseFloat(localStorage.getItem('tg_p1') || '0');
let phase2PnL = parseFloat(localStorage.getItem('tg_p2') || '0');

// ──────────────────────────────────────────────
// THREE.JS BACKGROUND
// ──────────────────────────────────────────────
function initThree() {
  const canvas = document.getElementById('bg-canvas');
  if (!window.THREE || !canvas) return;
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  const scene  = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
  camera.position.z = 30;
  const particleGeo = new THREE.BufferGeometry();
  const count = 1200;
  const positions = new Float32Array(count * 3);
  const colors    = new Float32Array(count * 3);
  const colorOpts = [new THREE.Color(0x00c8ff), new THREE.Color(0x7b2fff), new THREE.Color(0xff2d8a), new THREE.Color(0x00ffb3)];
  for (let i = 0; i < count; i++) {
    positions[i*3]   = (Math.random()-0.5)*100;
    positions[i*3+1] = (Math.random()-0.5)*100;
    positions[i*3+2] = (Math.random()-0.5)*60;
    const c = colorOpts[Math.floor(Math.random()*4)];
    colors[i*3]=c.r; colors[i*3+1]=c.g; colors[i*3+2]=c.b;
  }
  particleGeo.setAttribute('position', new THREE.BufferAttribute(positions,3));
  particleGeo.setAttribute('color',    new THREE.BufferAttribute(colors,3));
  const particles = new THREE.Points(particleGeo, new THREE.PointsMaterial({ size:0.18, vertexColors:true, transparent:true, opacity:0.6 }));
  scene.add(particles);
  const shapes = [];
  const geos = [new THREE.OctahedronGeometry(1.2,0), new THREE.TetrahedronGeometry(1.2,0), new THREE.IcosahedronGeometry(1,0), new THREE.BoxGeometry(1.4,1.4,1.4)];
  const sCols = [0x00c8ff, 0x7b2fff, 0xff2d8a, 0x00ffb3];
  for (let i = 0; i < 10; i++) {
    const mesh = new THREE.Mesh(geos[i%4], new THREE.MeshBasicMaterial({ color:sCols[i%4], wireframe:true, transparent:true, opacity:0.15 }));
    mesh.position.set((Math.random()-0.5)*60, (Math.random()-0.5)*60, (Math.random()-0.5)*20-5);
    mesh.rotation.set(Math.random()*Math.PI, Math.random()*Math.PI, Math.random()*Math.PI);
    mesh.userData = { rx:(Math.random()-0.5)*0.008, ry:(Math.random()-0.5)*0.008 };
    scene.add(mesh); shapes.push(mesh);
  }
  const mainShape = new THREE.Mesh(new THREE.IcosahedronGeometry(2.5,1), new THREE.MeshBasicMaterial({ color:0x00c8ff, wireframe:true, transparent:true, opacity:0.3 }));
  mainShape.position.set(12,-3,5);
  scene.add(mainShape);
  let mouse = {x:0,y:0}, targetMouse = {x:0,y:0}, isDragging = false, prev = {x:0,y:0};
  document.addEventListener('mousemove', e => {
    targetMouse.x = (e.clientX/window.innerWidth -0.5)*2;
    targetMouse.y = -(e.clientY/window.innerHeight-0.5)*2;
    if (isDragging) { mainShape.rotation.y += (e.clientX-prev.x)*0.01; mainShape.rotation.x += (e.clientY-prev.y)*0.01; }
    prev = {x:e.clientX, y:e.clientY};
  });
  canvas.addEventListener('mousedown', ()=>isDragging=true);
  document.addEventListener('mouseup',  ()=>isDragging=false);
  let t = 0;
  (function animate() {
    requestAnimationFrame(animate); t += 0.008;
    mouse.x += (targetMouse.x-mouse.x)*0.05;
    mouse.y += (targetMouse.y-mouse.y)*0.05;
    particles.rotation.y = mouse.x*0.3; particles.rotation.x = mouse.y*0.15;
    shapes.forEach(s=>{ s.rotation.x+=s.userData.rx; s.rotation.y+=s.userData.ry; });
    mainShape.rotation.y += 0.003; mainShape.rotation.x += 0.002;
    mainShape.position.y = -3 + Math.sin(t)*1.2;
    camera.position.x += (mouse.x*3 - camera.position.x)*0.03;
    camera.position.y += (mouse.y*2 - camera.position.y)*0.03;
    renderer.render(scene, camera);
  })();
  window.addEventListener('resize', ()=>{
    camera.aspect = window.innerWidth/window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });
}

// ──────────────────────────────────────────────
// CURSOR + TRAIL
// ──────────────────────────────────────────────
function initCursor() {
  const cur  = document.getElementById('cursor');
  const ring = document.getElementById('cursor-ring');
  if (!cur || !ring) return;
  let cx=0,cy=0,rx=0,ry=0;
  document.addEventListener('mousemove', e=>{ cx=e.clientX; cy=e.clientY; });
  (function loop(){
    rx+=(cx-rx)*0.12; ry+=(cy-ry)*0.12;
    cur.style.left=cx+'px'; cur.style.top=cy+'px';
    ring.style.left=rx+'px'; ring.style.top=ry+'px';
    requestAnimationFrame(loop);
  })();
  document.querySelectorAll('a,button,.mag-btn,.dot,.social-link,.theme-toggle,.j-del,.popup-close').forEach(el=>{
    el.addEventListener('mouseenter', ()=>document.body.classList.add('hovering'));
    el.addEventListener('mouseleave', ()=>document.body.classList.remove('hovering'));
  });
  const trails=[];
  for(let i=0;i<8;i++){
    const t=document.createElement('div');
    t.className='cursor-trail'; document.body.appendChild(t);
    trails.push({el:t,x:0,y:0});
  }
  document.addEventListener('mousemove', e=>{ trails[0].x=e.clientX; trails[0].y=e.clientY; });
  (function loop(){
    for(let i=trails.length-1;i>0;i--){
      trails[i].x+=(trails[i-1].x-trails[i].x)*0.4;
      trails[i].y+=(trails[i-1].y-trails[i].y)*0.4;
      trails[i].el.style.left=trails[i].x+'px'; trails[i].el.style.top=trails[i].y+'px';
      trails[i].el.style.opacity=(1-i/trails.length)*0.3;
      const s=(8-i*0.8)+'px'; trails[i].el.style.width=s; trails[i].el.style.height=s;
    }
    requestAnimationFrame(loop);
  })();
}

// ──────────────────────────────────────────────
// GSAP ANIMATIONS
// ──────────────────────────────────────────────
function initGSAP() {
  if (!window.gsap) return;
  gsap.registerPlugin(ScrollTrigger, ScrollToPlugin);

  function heroAnim() {
    gsap.timeline()
      .to('.hero-badge',         { opacity:1, y:0, duration:0.6, ease:'power3.out' })
      .to('.hero-h1',            { opacity:1, duration:0.1 }, '-=0.3')
      .fromTo('.hero-h1 .line span', { y:'110%' }, { y:'0%', duration:0.8, stagger:0.12, ease:'power4.out' }, '-=0.1')
      .to('.hero-sub',           { opacity:1, y:0, duration:0.6, ease:'power3.out' }, '-=0.4')
      .to('.hero-cta',           { opacity:1, y:0, duration:0.6, ease:'power3.out' }, '-=0.3')
      .to('.scroll-hint',        { opacity:1, duration:0.6 }, '-=0.2');
  }

  window.addEventListener('load', ()=>{
    setTimeout(()=>{
      gsap.to('#loader', { opacity:0, duration:0.6, ease:'power2.inOut', onComplete:()=>{
        const l = document.getElementById('loader');
        if (l) l.style.display='none';
        heroAnim();
      }});
    }, 1800);
  });

  gsap.utils.toArray('.glass-card').forEach((el, i)=>{
    gsap.fromTo(el, { opacity:0, y:40 }, {
      opacity:1, y:0, duration:0.7, ease:'power3.out', delay:(i%3)*0.1,
      scrollTrigger:{ trigger:el, start:'top 85%', toggleActions:'play none none none' }
    });
  });

  gsap.utils.toArray('.section-h2,.section-tag,.section-sub').forEach(el=>{
    gsap.fromTo(el, { opacity:0, y:30 }, {
      opacity:1, y:0, duration:0.7, ease:'power3.out',
      scrollTrigger:{ trigger:el, start:'top 85%', toggleActions:'play none none none' }
    });
  });

  gsap.utils.toArray('[data-target]').forEach(el=>{
    ScrollTrigger.create({ trigger:el, start:'top 80%', onEnter:()=>{
      gsap.fromTo(el, { innerText:0 }, {
        innerText:+el.dataset.target, duration:1.5, ease:'power2.out',
        snap:{ innerText:1 }, onUpdate(){ el.innerText=Math.round(el.innerText); }
      });
    }});
  });

  window.addEventListener('scroll', ()=>{
    const nb = document.getElementById('navbar');
    if (nb) nb.classList.toggle('scrolled', window.scrollY>60);
  });

  document.querySelectorAll('a[href^="#"]').forEach(a=>{
    a.addEventListener('click', e=>{
      e.preventDefault();
      const target=document.querySelector(a.getAttribute('href'));
      if(target) gsap.to(window, { scrollTo:{ y:target, offsetY:80 }, duration:1, ease:'power3.inOut' });
    });
  });

  document.querySelectorAll('.tilt-card').forEach(card=>{
    card.addEventListener('mousemove', e=>{
      const r=card.getBoundingClientRect();
      const x=(e.clientX-r.left)/r.width-0.5;
      const y=(e.clientY-r.top)/r.height-0.5;
      gsap.to(card, { rotateX:-y*8, rotateY:x*8, transformPerspective:800, ease:'power1.out', duration:0.3 });
    });
    card.addEventListener('mouseleave', ()=>gsap.to(card, { rotateX:0, rotateY:0, duration:0.5, ease:'power3.out' }));
  });

  document.querySelectorAll('.mag-btn').forEach(btn=>{
    btn.addEventListener('mousemove', e=>{
      const r=btn.getBoundingClientRect();
      gsap.to(btn, { x:(e.clientX-r.left-r.width/2)*0.3, y:(e.clientY-r.top-r.height/2)*0.3, duration:0.3, ease:'power2.out' });
    });
    btn.addEventListener('mouseleave', ()=>gsap.to(btn, { x:0, y:0, duration:0.5, ease:'elastic.out(1,0.5)' }));
    btn.addEventListener('click', function(e){
      const ripple=document.createElement('span');
      ripple.className='btn-ripple';
      const size=Math.max(this.offsetWidth,this.offsetHeight)*2;
      const r=this.getBoundingClientRect();
      ripple.style.cssText=`width:${size}px;height:${size}px;left:${e.clientX-r.left-size/2}px;top:${e.clientY-r.top-size/2}px`;
      this.appendChild(ripple); setTimeout(()=>ripple.remove(),700);
    });
  });

  const tt = document.getElementById('themeToggle');
  if (tt) tt.addEventListener('click', ()=>{
    const html=document.documentElement; const isDark=html.dataset.theme==='dark';
    gsap.to('body', { opacity:0, duration:0.15, onComplete:()=>{
      html.dataset.theme=isDark?'light':'dark';
      gsap.to('body', { opacity:1, duration:0.15 });
    }});
  });
}

// ──────────────────────────────────────────────
// MOBILE NAV
// ──────────────────────────────────────────────
function toggleMobileNav() { document.getElementById('mobileNav').classList.toggle('open'); }
function closeMobileNav()  { document.getElementById('mobileNav').classList.remove('open'); }

// ──────────────────────────────────────────────
// POPUP MODAL
// ──────────────────────────────────────────────
function openPopup(calc) {
  const overlay = document.getElementById('resultPopup');
  const lot = calc.lotSize;

  let lotDisplay, lotUnit;
  if (calc.unit === 'lots') {
    if (lot >= 1)        { lotDisplay = lot.toFixed(2); }
    else if (lot >= 0.1) { lotDisplay = lot.toFixed(3); }
    else                 { lotDisplay = lot.toFixed(4); }
    lotUnit = lot >= 1 ? 'Standard Lots' : lot >= 0.1 ? 'Mini Lots' : 'Micro Lots';
    if (lot < 0.01) lotUnit = 'Nano — check broker min';
  } else {
    lotDisplay = lot.toFixed(4);
    lotUnit = calc.unit.toUpperCase();
  }

  document.getElementById('popup-lot-val').textContent  = lotDisplay;
  document.getElementById('popup-lot-unit').textContent = lotUnit;
  document.getElementById('popup-risk-usd').textContent   = '$' + calc.riskUSD.toFixed(2);
  document.getElementById('popup-profit-usd').textContent = '$' + calc.profitUSD.toFixed(2);
  document.getElementById('popup-rr').textContent         = '1 : ' + calc.rr.toFixed(2);
  document.getElementById('popup-sl-pips').textContent    = calc.slPips.toFixed(1) + ' pips';

  const rrEl = document.getElementById('popup-rr');
  rrEl.className = 'popup-stat-val' + (calc.rr >= 2 ? ' good' : calc.rr >= 1 ? ' warn' : ' bad');

  // GFT PRO specific rule alert
  const alertEl = document.getElementById('popup-rule-alert');
  const goatGuardUSD = GFT_RULES.accountSize * GFT_RULES.goatGuardFloat / 100;
  const dailyDD = GFT_RULES.accountSize * GFT_RULES.dailyDrawdownPct / 100;
  const maxDD   = GFT_RULES.accountSize * GFT_RULES.maxDrawdownPct / 100;

  if (!calc.slOk || !calc.tpOk) {
    alertEl.className = 'popup-rule-alert fail';
    alertEl.textContent = '❌ Direction mismatch — check SL/TP vs direction';
  } else if (calc.riskUSD > maxDD) {
    alertEl.className = 'popup-rule-alert fail';
    alertEl.textContent = `❌ Single trade risk $${calc.riskUSD.toFixed(0)} exceeds entire 8% max DD ($${maxDD})!`;
  } else if (calc.riskUSD > goatGuardUSD) {
    alertEl.className = 'popup-rule-alert fail';
    alertEl.textContent = `❌ Risk $${calc.riskUSD.toFixed(0)} > Goat Guard float limit $${goatGuardUSD} — auto-close risk!`;
  } else if (calc.riskPercent > 1.5) {
    alertEl.className = 'popup-rule-alert warn';
    alertEl.textContent = `⚠️ ${calc.riskPercent}% risk is high for a $5K account. Recommended: ≤1% ($50)`;
  } else if (calc.rr < 1.5) {
    alertEl.className = 'popup-rule-alert warn';
    alertEl.textContent = `⚠️ RR 1:${calc.rr.toFixed(2)} is below recommended 1:2 — don't take this`;
  } else {
    alertEl.className = 'popup-rule-alert pass';
    alertEl.textContent = `✅ GFT PRO compliant — RR 1:${calc.rr.toFixed(2)}, Risk $${calc.riskUSD.toFixed(2)} — safe to trade`;
  }

  // Formula
  const instrumentInfo = getInstrumentInfo(document.getElementById('c-pair').value || 'EURUSD');
  document.getElementById('popup-formula').innerHTML =
    `<strong>Formula:</strong> Risk ($${calc.riskUSD.toFixed(2)}) ÷ (SL distance [${calc.slDist.toFixed(5)}] × contract [${instrumentInfo.contract}])<br>
     <strong>= ${lotDisplay} ${calc.unit}</strong> — Instrument: ${calc.label}<br>
     <span style="color:#ff9500">GFT PRO: Daily DD $${dailyDD} | Max DD $${maxDD} | Goat Guard $${goatGuardUSD}</span>`;

  overlay.classList.add('open');
}

function closePopup() { document.getElementById('resultPopup').classList.remove('open'); }

// ──────────────────────────────────────────────
// CALCULATOR
// ──────────────────────────────────────────────
function doCalc() {
  const accountSize = parseFloat(document.getElementById('c-account').value)  || GFT_RULES.accountSize;
  const riskPercent = parseFloat(document.getElementById('c-risk').value)      || 0.75;
  const entryPrice  = parseFloat(document.getElementById('c-entry').value);
  const slPrice     = parseFloat(document.getElementById('c-sl-price').value);
  const tpPrice     = parseFloat(document.getElementById('c-tp-price').value);
  const direction   = document.getElementById('c-dir').value;
  const pair        = document.getElementById('c-pair').value.trim() || 'EURUSD';

  if (!entryPrice) { showToast('Enter Entry Price', 'warn'); return; }
  if (!slPrice)    { showToast('Enter Stop Loss Price', 'warn'); return; }
  if (!tpPrice)    { showToast('Enter Take Profit Price', 'warn'); return; }

  const result = computeLotSize({ accountSize, riskPercent, entryPrice, slPrice, tpPrice, direction, pair });
  if (!result) { showToast('Invalid prices — SL = Entry?', 'warn'); return; }

  lastCalc = { ...result, pair, direction, entryPrice, slPrice, tpPrice, riskPercent, accountSize,
    notes: document.getElementById('c-notes').value };

  const setVal = (id, val, cls='') => {
    const el = document.getElementById(id);
    if (!el) return;
    if (window.gsap) gsap.fromTo(el, { scale:0.8, opacity:0 }, { scale:1, opacity:1, duration:0.4, ease:'back.out(1.7)' });
    el.textContent = val;
    el.className   = 'res-val ' + cls;
  };

  const lotDisplay = result.unit === 'lots'
    ? result.lotSize.toFixed(result.lotSize < 0.01 ? 4 : 2) + ' lots'
    : result.lotSize.toFixed(4) + ' ' + result.unit;

  setVal('r-lots',   lotDisplay);
  setVal('r-rr',     '1:' + result.rr.toFixed(2), result.rr >= 2 ? '' : result.rr >= 1 ? 'warn' : 'danger');
  setVal('r-risk',   '$' + result.riskUSD.toFixed(2));
  setVal('r-profit', '$' + result.profitUSD.toFixed(2));

  const slDistEl = document.getElementById('r-sl-dist');
  const tpDistEl = document.getElementById('r-tp-dist');
  const slPipsEl = document.getElementById('r-sl-pips');
  const tpPipsEl = document.getElementById('r-tp-pips');
  if (slDistEl) slDistEl.textContent = result.slDist.toFixed(5);
  if (tpDistEl) tpDistEl.textContent = result.tpDist.toFixed(5);
  if (slPipsEl) slPipsEl.textContent = result.slPips.toFixed(1) + ' pips';
  if (tpPipsEl) tpPipsEl.textContent = result.tpPips.toFixed(1) + ' pips';

  // Run GFT PRO rules
  const rules = checkGFTRules(lastCalc);
  const ruleListEl = document.getElementById('ruleList');
  if (ruleListEl) {
    ruleListEl.innerHTML = rules.map((c,i)=>
      `<div class="rule-row ${c.cls}" style="animation-delay:${i*0.08}s">${c.icon} &nbsp; ${c.text}</div>`
    ).join('');
  }

  openPopup(lastCalc);
}

function resetCalc() {
  ['c-pair','c-entry','c-sl-price','c-tp-price','c-notes'].forEach(id=>{ const el=document.getElementById(id); if(el)el.value=''; });
  const riskEl = document.getElementById('c-risk');
  if (riskEl) riskEl.value = 0.75;
  const accEl = document.getElementById('c-account');
  if (accEl) accEl.value = GFT_RULES.accountSize;
  ['r-lots','r-rr','r-risk','r-profit','r-sl-dist','r-tp-dist'].forEach(id=>{ const el=document.getElementById(id); if(el){ el.textContent='—'; el.className='res-val'; }});
  ['r-sl-pips','r-tp-pips'].forEach(id=>{ const el=document.getElementById(id); if(el)el.textContent=''; });
  const ruleListEl = document.getElementById('ruleList');
  if (ruleListEl) ruleListEl.innerHTML='<div class="rule-row" style="color:var(--text3)">⬜ &nbsp;Enter trade details and calculate</div>';
  const aiOut = document.getElementById('aiOut');
  if (aiOut) aiOut.innerHTML='<div class="ai-header"><span class="ai-dot"></span>Awaiting Trade Data</div><div class="ai-content" style="color:var(--text3);font-size:12px;">Calculate a trade first, then click AI Analyze.</div>';
  lastCalc = null;
}

// ──────────────────────────────────────────────
// GROQ AI — GFT PRO CONTEXT
// ──────────────────────────────────────────────
async function runAI() {
  if (!lastCalc) { showToast('Calculate a trade first!', 'warn'); return; }
  if (!GROQ_API_KEY) {
    showToast('⚠️ API key not loaded. Check Vercel env vars.', 'warn');
    return;
  }

  const model = document.getElementById('aiModel').value;
  const btn   = document.getElementById('aiBtn');
  const out   = document.getElementById('aiOut');
  btn.disabled = true;
  out.innerHTML = `<div class="ai-header"><span class="ai-dot"></span>Groq — Analyzing GFT PRO trade</div><div style="color:var(--text3);font-size:12px;">Evaluating <span class="typing-dots"><span></span><span></span><span></span></span></div>`;

  const { accountSize, riskPercent, riskUSD, lotSize, unit, profitUSD, rr, entryPrice, slPrice, tpPrice, direction, pair, notes, slDist, tpDist, slPips, tpPips } = lastCalc;

  const prompt = `You are an elite prop trading coach for GFT PRO 5K 2-Step Challenge traders.

FIRM RULES — GFT PRO $5K:
- Phase 1 target: 8% ($400) | Phase 2 target: 4% ($200)
- Daily drawdown limit: 5% ($250) | Max drawdown: 8% ($400)
- Goat Guard: auto-closes funded trades if floating loss hits 2% ($100) — first trigger cuts split to 50%, second = breach
- First 2 payouts capped at 6% ($300) | 80% profit split
- Min 3 trading days per phase, each day needs 0.5% profit ($25)
- News trading allowed but profits capped at 1% within 5 min of high-impact news
- No hedging (same account, cross-account, cross-firm) — permanent ban
- Trades under 2 min on funded: profits don't count, losses do

TRADE DETAILS:
INSTRUMENT: ${pair} | DIRECTION: ${direction}
ENTRY: ${entryPrice} | SL: ${slPrice} (${slPips.toFixed(1)} pips) | TP: ${tpPrice} (${tpPips.toFixed(1)} pips)
Account: $${accountSize} | Risk: ${riskPercent}% ($${riskUSD.toFixed(2)})
Position: ${lotSize.toFixed(4)} ${unit} | Profit Target: $${profitUSD.toFixed(2)}
Risk:Reward: 1:${rr.toFixed(2)}
Notes: ${notes || 'None'}

Evaluate this trade specifically for GFT PRO $5K challenge:
1. 🎯 QUALITY SCORE /10
2. ✅ GFT PRO COMPLIANCE (daily DD, max DD, Goat Guard risk)
3. 📊 PHASE IMPACT (how does this trade affect Phase 1 or 2 progress?)
4. 💡 TOP 3 RECOMMENDATIONS specific to $5K account
5. ⚠️ RED FLAGS for GFT PRO specifically

Be concise, specific to the $5K account size, and mention the Goat Guard risk if applicable.`;

  try {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${GROQ_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages:[{ role:'user', content:prompt }], temperature:0.7, max_tokens:1024 })
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error.message);
    const text = data.choices[0].message.content;
    out.innerHTML = `<div class="ai-header"><span class="ai-dot"></span>⚡ ${model} — GFT PRO Analysis</div><div class="ai-content">${text.replace(/\n/g,'<br>')}</div>`;
  } catch(e) {
    out.innerHTML = `<div class="ai-header"><span class="ai-dot" style="background:#ff3b5c"></span>Error</div><div style="color:#ff3b5c;font-size:12px;">${e.message}</div>`;
  }
  btn.disabled = false;
}

// ──────────────────────────────────────────────
// JOURNAL
// ──────────────────────────────────────────────
function logThisTrade() {
  if (!lastCalc) { showToast('Calculate a trade first!', 'warn'); return; }
  const pair = document.getElementById('c-pair').value || 'Unknown';
  journal.unshift({
    id: Date.now(), date: new Date().toLocaleString(), pair, direction: lastCalc.direction,
    entry: lastCalc.entryPrice, slPrice: lastCalc.slPrice, tpPrice: lastCalc.tpPrice,
    lotSize: lastCalc.lotSize.toFixed(4), unit: lastCalc.unit,
    riskPercent: lastCalc.riskPercent, riskUSD: lastCalc.riskUSD.toFixed(2),
    profitUSD: lastCalc.profitUSD.toFixed(2), rr: lastCalc.rr.toFixed(2),
    notes: lastCalc.notes || '', outcome: 'OPEN'
  });
  localStorage.setItem('tg_j', JSON.stringify(journal));
  renderJournal();
  showToast('✓ Trade logged to GFT journal!', 'success');
  if (window.gsap) gsap.fromTo('#jList', { opacity:0 }, { opacity:1, duration:0.4 });
}

function setOutcome(id, outcome) {
  const trade = journal.find(j=>j.id===id);
  if (!trade) return;
  trade.outcome = outcome;
  // Auto-update phase P&L if win/loss
  const currentPhase = document.getElementById('ph-ph') ? document.getElementById('ph-ph').value : '1';
  if (outcome === 'WIN') {
    const pnlEl = document.getElementById('ph-pnl');
    if (pnlEl) {
      const current = parseFloat(pnlEl.value)||0;
      pnlEl.value = (current + parseFloat(trade.profitUSD)).toFixed(2);
      updatePhase();
    }
    // Also add to daily tracker
    dlEntries.push({ amt: parseFloat(trade.profitUSD), time: new Date().toLocaleTimeString(), pair: trade.pair });
    localStorage.setItem('tg_dl', JSON.stringify(dlEntries));
    renderDL();
  } else if (outcome === 'LOSS') {
    dlEntries.push({ amt: -parseFloat(trade.riskUSD), time: new Date().toLocaleTimeString(), pair: trade.pair });
    localStorage.setItem('tg_dl', JSON.stringify(dlEntries));
    renderDL();
  }
  localStorage.setItem('tg_j', JSON.stringify(journal));
  renderJournal();
  showToast(`Trade marked as ${outcome}`, outcome==='WIN'?'success':'warn');
}

function renderJournal() {
  const el = document.getElementById('jList');
  if (!el) return;
  const countEl = document.getElementById('jCount');
  if (countEl) countEl.textContent = journal.length;

  const wins  = journal.filter(j=>j.outcome==='WIN').length;
  const losses= journal.filter(j=>j.outcome==='LOSS').length;
  const closed= wins + losses;
  const winRate = closed ? ((wins/closed)*100).toFixed(1) : 0;
  const rrs = journal.map(j=>+j.rr).filter(r=>r>0);
  const avgRR = rrs.length ? (rrs.reduce((a,b)=>a+b)/rrs.length).toFixed(2) : '—';
  const miniStats = document.getElementById('jStatsMini');
  if (miniStats) miniStats.innerHTML = `📊 ${journal.length} trades | 🎯 ${winRate}% win | Avg RR 1:${avgRR}`;

  if (!journal.length) {
    el.innerHTML = '<div class="empty-journal">📒 No trades logged yet.<br>Calculate a trade and click + Log Trade.</div>';
    return;
  }

  el.innerHTML = journal.map(j=>`
    <div class="journal-row">
      <div class="j-pair">${escHtml(j.pair)}</div>
      <span class="j-badge ${j.direction==='BUY'?'buy-badge':'sell-badge'}">${j.direction}</span>
      <div class="j-meta">
        ${j.lotSize} ${j.unit} · ${j.riskPercent}% · $${j.riskUSD}<br>
        <small>E:${j.entry} SL:${j.slPrice} TP:${j.tpPrice} · ${j.date}</small>
      </div>
      <div class="j-rr ${+j.rr>=2?'':'bad'}">1:${j.rr}</div>
      <div class="j-outcome-btns">
        <button class="outcome-btn win  ${j.outcome==='WIN' ?'active':''}" onclick="setOutcome(${j.id},'WIN')">W</button>
        <button class="outcome-btn loss ${j.outcome==='LOSS'?'active':''}" onclick="setOutcome(${j.id},'LOSS')">L</button>
        <button class="outcome-btn be   ${j.outcome==='BE'  ?'active':''}" onclick="setOutcome(${j.id},'BE')">BE</button>
      </div>
      <button class="j-del" onclick="delJournal(${j.id})">✕</button>
    </div>
  `).join('');

  const statsEl = document.getElementById('jStats');
  if (statsEl) {
    const totalWon  = journal.filter(j=>j.outcome==='WIN').reduce((s,j)=>s+(parseFloat(j.profitUSD)||0),0);
    const totalLost = journal.filter(j=>j.outcome==='LOSS').reduce((s,j)=>s+(parseFloat(j.riskUSD)||0),0);
    const netPnL    = totalWon - totalLost;
    statsEl.innerHTML = `
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;padding-top:12px;border-top:1px solid var(--border);">
        <div style="text-align:center"><div style="font-size:9px;color:var(--text3);letter-spacing:1px;">WIN RATE</div><div style="font-size:20px;font-weight:700;color:var(--accent4);">${winRate}%</div></div>
        <div style="text-align:center"><div style="font-size:9px;color:var(--text3);letter-spacing:1px;">AVG R:R</div><div style="font-size:20px;font-weight:700;color:var(--accent);">1:${avgRR}</div></div>
        <div style="text-align:center"><div style="font-size:9px;color:var(--text3);letter-spacing:1px;">NET P&L</div><div style="font-size:16px;font-weight:600;color:${netPnL>=0?'var(--accent4)':'#ff3b5c'}">${netPnL>=0?'+':''}$${netPnL.toFixed(0)}</div></div>
        <div style="text-align:center"><div style="font-size:9px;color:var(--text3);letter-spacing:1px;">TRADES</div><div style="font-size:16px;font-weight:600;">${journal.length}</div></div>
      </div>`;
  }
}

function delJournal(id) {
  journal = journal.filter(j=>j.id!==id);
  localStorage.setItem('tg_j', JSON.stringify(journal));
  renderJournal(); showToast('Trade removed', 'info');
}
function clearJournal() {
  if (!confirm('Clear all journal entries?')) return;
  journal = []; localStorage.setItem('tg_j','[]'); renderJournal(); showToast('Journal cleared','warn');
}

function exportCSV() {
  if (!journal.length) { showToast('No trades to export','warn'); return; }
  const headers = ['Date','Pair','Direction','Entry','SL','TP','Size','Unit','Risk%','Risk$','Profit$','RR','Outcome','Notes'];
  const rows = journal.map(j=>[
    `"${j.date}"`,j.pair,j.direction,j.entry,j.slPrice,j.tpPrice,j.lotSize,j.unit,
    j.riskPercent,j.riskUSD,j.profitUSD,`1:${j.rr}`,j.outcome||'OPEN',`"${(j.notes||'').replace(/"/g,'""')}"`
  ]);
  const csv = [headers.join(','),...rows.map(r=>r.join(','))].join('\n');
  const blob = new Blob(['\uFEFF'+csv],{type:'text/csv;charset=utf-8;'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href=url; a.download=`tradeguard_gft_${new Date().toISOString().slice(0,10)}.csv`;
  document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
  showToast(`✅ Exported ${journal.length} trades`, 'success');
}

function importCSV() {
  const input = document.createElement('input');
  input.type='file'; input.accept='.csv';
  input.onchange = e => {
    const reader = new FileReader();
    reader.onload = ev => {
      try {
        const lines = ev.target.result.split('\n').filter(l=>l.trim()).slice(1);
        const imported = lines.map((line,i) => {
          const v = line.split(',');
          return {
            id: Date.now()+i, date: v[0]?.replace(/"/g,'')||new Date().toLocaleString(),
            pair:v[1]||'Unknown', direction:v[2]||'BUY', entry:v[3]||0, slPrice:v[4]||0, tpPrice:v[5]||0,
            lotSize:v[6]||0, unit:v[7]||'lots', riskPercent:v[8]||0.75, riskUSD:v[9]||0,
            profitUSD:v[10]||0, rr:(v[11]||'1:1').replace('1:',''), outcome:v[12]||'OPEN', notes:v[13]?.replace(/"/g,'')||''
          };
        });
        if (imported.length && confirm(`Import ${imported.length} trades?`)) {
          journal = [...imported,...journal];
          localStorage.setItem('tg_j',JSON.stringify(journal));
          renderJournal(); showToast(`Imported ${imported.length} trades`,'success');
        }
      } catch(err) { showToast('Import error: '+err.message,'warn'); }
    };
    reader.readAsText(e.target.files[0],'UTF-8');
  };
  input.click();
}

// ──────────────────────────────────────────────
// DAILY P&L TRACKER — GFT PRO LIMITS
// ──────────────────────────────────────────────
function addPnL() {
  const amt = parseFloat(document.getElementById('dl-amt').value);
  if (isNaN(amt)) return;
  dlEntries.push({ amt, time: new Date().toLocaleTimeString() });
  localStorage.setItem('tg_dl', JSON.stringify(dlEntries));
  document.getElementById('dl-amt').value = '';
  renderDL();
}
function resetPnL() { dlEntries=[]; localStorage.setItem('tg_dl','[]'); renderDL(); showToast('Daily reset','info'); }

function renderDL() {
  const acc   = parseFloat(document.getElementById('dl-acc').value)||GFT_RULES.accountSize;
  const lim   = parseFloat(document.getElementById('dl-lim').value)||GFT_RULES.dailyDrawdownPct;
  const limUSD= acc*lim/100;
  const total = dlEntries.reduce((s,e)=>s+e.amt,0);
  const loss  = Math.max(0,-total);
  const used  = Math.min(loss/limUSD*100,100);

  const te = document.getElementById('dlTotal');
  if (te) {
    te.textContent = (total>=0?'+':'')+'$'+total.toFixed(2);
    te.className = 'big-stat'+(total<0&&used>80?' red':'');
  }
  const dpEl = document.getElementById('dlPct');
  if (dpEl) dpEl.textContent = Math.abs(total/acc*100).toFixed(2)+'% of account';

  const bar = document.getElementById('dlBar');
  if (bar) {
    bar.style.width = used+'%';
    bar.className = 'pb-fill'+(used>80?' danger':used>50?' warn':'');
  }
  const barPctEl = document.getElementById('dlBarPct');
  if (barPctEl) barPctEl.textContent = used.toFixed(1)+'%';

  const note = document.getElementById('dlNote');
  if (note) {
    if (used>=100)    note.textContent = '🚨 5% DAILY LIMIT BREACHED — Stop ALL trading NOW! GFT will breach your account.';
    else if (used>80) note.textContent = `⚠️ ${used.toFixed(1)}% of $${limUSD} daily limit used — 1-2 more losses = breach. Stop now.`;
    else if (total>=0)note.textContent = `✅ In profit +$${total.toFixed(2)}. GFT daily limit safe. Keep going!`;
    else              note.textContent = `Loss: $${loss.toFixed(2)} / $${limUSD.toFixed(2)} limit. ${(100-used).toFixed(1)}% buffer left.`;
  }

  const dlLogEl = document.getElementById('dlLog');
  if (dlLogEl) dlLogEl.innerHTML = dlEntries.length
    ? dlEntries.map(e=>`<div class="log-item"><span style="color:var(--text3)">${e.time}</span><span class="${e.amt>=0?'pos':'neg'}">${e.amt>=0?'+':''}$${e.amt.toFixed(2)}</span></div>`).join('')
    : '<div style="color:var(--text3);font-size:12px;">No entries today.</div>';
}

// ──────────────────────────────────────────────
// PHASE PROGRESS — GFT PRO SPECIFIC
// ──────────────────────────────────────────────
function updatePhase() {
  const acc   = parseFloat(document.getElementById('ph-acc').value)||GFT_RULES.accountSize;
  const phase = document.getElementById('ph-ph').value;
  const pnl   = parseFloat(document.getElementById('ph-pnl').value)||0;
  const tgtP  = phase === '1' ? GFT_RULES.phase1Target : GFT_RULES.phase2Target;
  const tgtUSD= acc * tgtP / 100;
  const prog  = Math.max(0, Math.min(pnl/tgtUSD*100, 100));
  const rem   = Math.max(0, tgtUSD - pnl);

  // Update target display
  const tgtEl = document.getElementById('ph-tgt-display');
  if (tgtEl) tgtEl.textContent = `${tgtP}% ($${tgtUSD.toFixed(0)})`;

  if (window.gsap) gsap.to('#phProfBar',{ width:prog+'%', duration:0.8, ease:'power3.out' });
  else {
    const bar = document.getElementById('phProfBar');
    if (bar) bar.style.width = prog+'%';
  }

  const profValEl = document.getElementById('phProfVal');
  if (profValEl) profValEl.textContent = `$${pnl.toFixed(2)} / $${tgtUSD.toFixed(2)}`;

  const note = document.getElementById('phNote');
  if (note) {
    if (prog >= 100) note.textContent = `🎉 Phase ${phase} PASSED! ${phase==='1'?'Move to Phase 2 — target 4% ($200)':'Both phases DONE — claim your funded account!'}`;
    else {
      const tradesNeeded = Math.ceil(rem / (acc * 0.0075 * 1.5)); // at 0.75% risk, 1:1.5 RR
      note.textContent = `Need $${rem.toFixed(2)} more to pass Phase ${phase} (${tgtP}%). ≈${tradesNeeded} wins at your risk level.`;
    }
  }

  // Payout projection
  const payoutEl = document.getElementById('ph-payout');
  if (payoutEl && pnl > 0) {
    const maxPayout = Math.min(pnl, acc * GFT_RULES.payoutCapPct / 100);
    const yourCut   = maxPayout * GFT_RULES.payoutSplit / 100;
    payoutEl.textContent = `First payout est: $${yourCut.toFixed(0)} (6% cap × 80% split)`;
  }
}

// ──────────────────────────────────────────────
// CHALLENGE SUMMARY CARD
// ──────────────────────────────────────────────
function renderChallengeSummary() {
  const el = document.getElementById('challengeSummary');
  if (!el) return;
  const acc = GFT_RULES.accountSize;
  const dailyDD = acc * GFT_RULES.dailyDrawdownPct / 100;
  const maxDD   = acc * GFT_RULES.maxDrawdownPct / 100;
  const p1tgt   = acc * GFT_RULES.phase1Target / 100;
  const p2tgt   = acc * GFT_RULES.phase2Target / 100;
  const goatGuard = acc * GFT_RULES.goatGuardFloat / 100;
  const riskAt075 = acc * 0.0075;

  el.innerHTML = `
    <div class="challenge-grid">
      <div class="ch-item accent"><div class="ch-label">Account</div><div class="ch-val">$${acc.toLocaleString()}</div></div>
      <div class="ch-item green"><div class="ch-label">Phase 1 Target</div><div class="ch-val">8% = $${p1tgt}</div></div>
      <div class="ch-item blue"><div class="ch-label">Phase 2 Target</div><div class="ch-val">4% = $${p2tgt}</div></div>
      <div class="ch-item orange"><div class="ch-label">Daily DD Limit</div><div class="ch-val">5% = $${dailyDD}</div></div>
      <div class="ch-item red"><div class="ch-label">Max DD Limit</div><div class="ch-val">8% = $${maxDD}</div></div>
      <div class="ch-item purple"><div class="ch-label">Goat Guard Float</div><div class="ch-val">2% = $${goatGuard}</div></div>
      <div class="ch-item cyan"><div class="ch-label">Your Risk (0.75%)</div><div class="ch-val">$${riskAt075.toFixed(2)}/trade</div></div>
      <div class="ch-item green"><div class="ch-label">Losses Till Breach</div><div class="ch-val">${Math.floor(maxDD/riskAt075)} trades</div></div>
      <div class="ch-item blue"><div class="ch-label">Payout Cap (first 2)</div><div class="ch-val">6% = $${acc*0.06} → $${(acc*0.06*0.8).toFixed(0)} yours</div></div>
    </div>`;
}

// ──────────────────────────────────────────────
// UTILS
// ──────────────────────────────────────────────
function escHtml(str) {
  return (str||'').replace(/[&<>]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[m]));
}

function showToast(msg, type='success') {
  const colors = {
    success:'linear-gradient(135deg,#00ffb3,#00c8ff)',
    warn:'linear-gradient(135deg,#ffb800,#ff6b35)',
    info:'linear-gradient(135deg,#00c8ff,#7b2fff)'
  };
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  t.style.background = colors[type]||colors.success;
  document.body.appendChild(t);
  setTimeout(()=>t.remove(), 2800);
}

// ──────────────────────────────────────────────
// INIT
// ──────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  await fetchApiKey();
  initThree();
  initCursor();
  initGSAP();
  renderJournal();
  renderDL();
  renderChallengeSummary();

  // Set GFT PRO defaults in calculator
  const accEl = document.getElementById('c-account');
  if (accEl) accEl.value = GFT_RULES.accountSize;
  const riskEl = document.getElementById('c-risk');
  if (riskEl) riskEl.value = 0.75;
  const dlAccEl = document.getElementById('dl-acc');
  if (dlAccEl) dlAccEl.value = GFT_RULES.accountSize;
  const dlLimEl = document.getElementById('dl-lim');
  if (dlLimEl) dlLimEl.value = GFT_RULES.dailyDrawdownPct;
  const phAccEl = document.getElementById('ph-acc');
  if (phAccEl) phAccEl.value = GFT_RULES.accountSize;

  const popup = document.getElementById('resultPopup');
  if (popup) {
    popup.addEventListener('click', function(e){
      if (e.target === this) closePopup();
    });
  }
});