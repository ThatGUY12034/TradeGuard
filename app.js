/* ==============================================
   TradeGuard — app.js
   All calculator logic, AI, journal, tracker,
   Three.js, GSAP animations, cursor, popup
================================================ */

// ──────────────────────────────────────────────
// CONFIG — API key will be fetched from Vercel
// ──────────────────────────────────────────────
let GROQ_API_KEY = null; // Initialize as null, will be fetched

// Fetch API key from Vercel environment (secure)
async function fetchApiKey() {
  try {
    const response = await fetch('/api/config');
    
    // Check if response is OK
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    
    const data = await response.json();
    
    if (data.GROQ_API_KEY && data.GROQ_API_KEY !== "YOUR_LOCAL_TEST_KEY_HERE") {
      GROQ_API_KEY = data.GROQ_API_KEY;
      console.log('✅ API key loaded from environment');
      return true;
    } else {
      console.warn('⚠️ No valid API key found, using fallback for local testing');
      // For local development, you can set a test key here
      GROQ_API_KEY = null; // Will show warning when AI is used
      return false;
    }
  } catch (error) {
    console.warn('⚠️ Could not fetch API key:', error.message);
    console.warn('💡 Make sure you have an API endpoint at /api/config');
    console.warn('💡 For local development, create a local-config.js file');
    GROQ_API_KEY = null;
    return false;
  }
}

// ──────────────────────────────────────────────
// LOT SIZE FORMULA — EXPLAINED
// ──────────────────────────────────────────────
/*
  The universal formula for position sizing:

  Lot Size = Risk ($) / (Stop Loss in price * Pip/Point Value per Lot)

  Where:
    Risk ($)              = Account Size × Risk %
    Stop Loss in price    = |Entry Price − SL Price|
    Pip Value per lot     = varies per instrument (see getInstrumentInfo)

  For standard Forex (EURUSD, GBPUSD etc.):
    1 standard lot = 100,000 units
    1 pip = 0.0001 price move
    Pip value = $10 per standard lot (when USD is quote currency)
    So: lots = riskUSD / (sl_pips × 10)

  For XAUUSD (Gold):
    1 standard lot = 100 oz
    1 pip = $0.01 price move (2nd decimal)
    Pip value = $1 per micro-lot → $100 per standard lot
    But we work in full price distance, so:
    lots = riskUSD / (slDistance × 100)   [100 = contract size]

  For JPY pairs (USDJPY, GBPJPY):
    1 pip = 0.01 price move
    Pip value ≈ $9.09 per lot (approximate at 110 USDJPY)
    We use price distance directly:
    lots = riskUSD / (slDistance × 1000 / jpyRate)

  For simplicity we use:
    lots = riskUSD / (slDistance × contractSize)
  where contractSize captures the instrument scaling.
*/

// ──────────────────────────────────────────────
// INSTRUMENT CONFIG TABLE
// ──────────────────────────────────────────────
function getInstrumentInfo(pair) {
  const p = pair.toUpperCase().replace(/[^A-Z0-9]/g, '');

  // Gold / Silver
  if (p.includes('XAU') || p.includes('GOLD'))  return { contract: 100,    unit: 'lots',      pipSize: 0.01,   label: 'XAUUSD (Gold)' };
  if (p.includes('XAG') || p.includes('SILVER')) return { contract: 5000,   unit: 'lots',      pipSize: 0.001,  label: 'XAGUSD (Silver)' };

  // JPY pairs — pip = 0.01, contract = 100,000 → value ≈ $9
  if (p.includes('JPY')) return { contract: 100000, unit: 'lots', pipSize: 0.01, label: pair, isJPY: true };

  // Crypto (return units, not lots)
  if (p.includes('BTC'))  return { contract: 1,  unit: 'BTC',  pipSize: 1,      label: 'Bitcoin' };
  if (p.includes('ETH'))  return { contract: 1,  unit: 'ETH',  pipSize: 0.1,    label: 'Ethereum' };
  if (p.includes('SOL'))  return { contract: 1,  unit: 'SOL',  pipSize: 0.01,   label: 'Solana' };
  if (p.includes('XRP'))  return { contract: 1,  unit: 'XRP',  pipSize: 0.0001, label: 'XRP' };

  // US Indices
  if (p.includes('US30') || p.includes('DOW'))  return { contract: 1,   unit: 'contracts', pipSize: 1,    label: 'US30 (Dow)' };
  if (p.includes('NAS100') || p.includes('NQ')) return { contract: 20,  unit: 'contracts', pipSize: 0.25, label: 'NAS100' };
  if (p.includes('SPX') || p.includes('SP500')) return { contract: 50,  unit: 'contracts', pipSize: 0.25, label: 'SP500' };
  if (p.includes('GER40') || p.includes('DAX')) return { contract: 1,   unit: 'contracts', pipSize: 1,    label: 'GER40 (DAX)' };
  if (p.includes('UK100') || p.includes('FTSE'))return { contract: 1,   unit: 'contracts', pipSize: 1,    label: 'UK100 (FTSE)' };

  // Oil
  if (p.includes('WTI') || p.includes('OIL') || p.includes('USOIL')) return { contract: 1000, unit: 'lots', pipSize: 0.01, label: 'WTI Oil' };
  if (p.includes('BRENT') || p.includes('UKOIL'))                    return { contract: 1000, unit: 'lots', pipSize: 0.01, label: 'Brent Oil' };

  // Default: standard Forex pair (USD quote or cross)
  // 1 std lot = 100,000 units, 1 pip = 0.0001, pip value = $10
  return { contract: 100000, unit: 'lots', pipSize: 0.0001, label: pair };
}

// ──────────────────────────────────────────────
// CORE CALCULATION (CORRECT FORMULA)
// ──────────────────────────────────────────────
function computeLotSize({ accountSize, riskPercent, entryPrice, slPrice, tpPrice, direction, pair }) {
  const riskUSD   = accountSize * riskPercent / 100;
  const info      = getInstrumentInfo(pair);

  // Price distances (always positive)
  const slDist = Math.abs(entryPrice - slPrice);
  const tpDist = Math.abs(entryPrice - tpPrice);

  if (slDist === 0) return null;

  // Validate direction
  const slOk = direction === 'BUY' ? slPrice < entryPrice : slPrice > entryPrice;
  const tpOk = direction === 'BUY' ? tpPrice > entryPrice : tpPrice < entryPrice;

  /*
    Lot size formula:
      lots = riskUSD / (slDist × contract)
    
    This works because:
      P&L per lot = price_change × contract
    So: riskUSD = lots × slDist × contract
    Therefore: lots = riskUSD / (slDist × contract)
  */
  const lotSize = riskUSD / (slDist * info.contract);

  // SL & TP in pips
  const slPips = slDist / info.pipSize;
  const tpPips = tpDist / info.pipSize;
  const rr     = tpDist / slDist;

  // Dollar values
  const profitUSD = lotSize * tpDist * info.contract;
  const lossUSD   = lotSize * slDist * info.contract; // should equal riskUSD

  return {
    lotSize, riskUSD, lossUSD, profitUSD,
    slDist, tpDist, slPips, tpPips, rr,
    unit: info.unit, label: info.label,
    slOk, tpOk, riskPercent, accountSize,
    formula: `Risk ($${riskUSD.toFixed(2)}) ÷ (SL distance [${slDist.toFixed(5)}] × contract [${info.contract}]) = ${lotSize.toFixed(4)} ${info.unit}`
  };
}

// ──────────────────────────────────────────────
// STATE
// ──────────────────────────────────────────────
let lastCalc = null;
let journal  = JSON.parse(localStorage.getItem('tg_j')  || '[]');
let dlEntries= JSON.parse(localStorage.getItem('tg_dl') || '[]');

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

  // Particles
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

  // Floating wireframe shapes
  const shapes = [];
  const geos   = [new THREE.OctahedronGeometry(1.2,0), new THREE.TetrahedronGeometry(1.2,0), new THREE.IcosahedronGeometry(1,0), new THREE.BoxGeometry(1.4,1.4,1.4)];
  const sCols  = [0x00c8ff, 0x7b2fff, 0xff2d8a, 0x00ffb3];
  for (let i = 0; i < 10; i++) {
    const mesh = new THREE.Mesh(geos[i%4], new THREE.MeshBasicMaterial({ color:sCols[i%4], wireframe:true, transparent:true, opacity:0.15 }));
    mesh.position.set((Math.random()-0.5)*60, (Math.random()-0.5)*60, (Math.random()-0.5)*20-5);
    mesh.rotation.set(Math.random()*Math.PI, Math.random()*Math.PI, Math.random()*Math.PI);
    mesh.userData = { rx:(Math.random()-0.5)*0.008, ry:(Math.random()-0.5)*0.008 };
    scene.add(mesh); shapes.push(mesh);
  }

  // Draggable icosahedron
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

  // Trail
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
  gsap.registerPlugin(ScrollTrigger, ScrollToPlugin);

  // Hero entrance
  function heroAnim() {
    gsap.timeline()
      .to('.hero-badge',          { opacity:1, y:0, duration:0.6, ease:'power3.out' })
      .to('.hero-h1',             { opacity:1, duration:0.1 }, '-=0.3')
      .fromTo('.hero-h1 .line span', { y:'110%' }, { y:'0%', duration:0.8, stagger:0.12, ease:'power4.out' }, '-=0.1')
      .to('.hero-sub',            { opacity:1, y:0, duration:0.6, ease:'power3.out' }, '-=0.4')
      .to('.hero-cta',            { opacity:1, y:0, duration:0.6, ease:'power3.out' }, '-=0.3')
      .to('.scroll-hint',         { opacity:1, duration:0.6 }, '-=0.2');
  }

  // Loader → hero
  window.addEventListener('load', ()=>{
    setTimeout(()=>{
      gsap.to('#loader', { opacity:0, duration:0.6, ease:'power2.inOut', onComplete:()=>{
        document.getElementById('loader').style.display='none';
        heroAnim();
      }});
    }, 1800);
  });

  // Scroll-triggered card reveals
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

  // Stats counter
  gsap.utils.toArray('[data-target]').forEach(el=>{
    ScrollTrigger.create({ trigger:el, start:'top 80%', onEnter:()=>{
      gsap.fromTo(el, { innerText:0 }, {
        innerText:+el.dataset.target, duration:1.5, ease:'power2.out',
        snap:{ innerText:1 }, onUpdate(){ el.innerText=Math.round(el.innerText); }
      });
    }});
  });

  // Navbar on scroll
  window.addEventListener('scroll', ()=>{
    document.getElementById('navbar').classList.toggle('scrolled', window.scrollY>60);
  });

  // Smooth scroll nav links
  document.querySelectorAll('a[href^="#"]').forEach(a=>{
    a.addEventListener('click', e=>{
      e.preventDefault();
      const target=document.querySelector(a.getAttribute('href'));
      if(target) gsap.to(window, { scrollTo:{ y:target, offsetY:80 }, duration:1, ease:'power3.inOut' });
    });
  });

  // 3D tilt on cards
  document.querySelectorAll('.tilt-card').forEach(card=>{
    card.addEventListener('mousemove', e=>{
      const r=card.getBoundingClientRect();
      const x=(e.clientX-r.left)/r.width-0.5;
      const y=(e.clientY-r.top)/r.height-0.5;
      gsap.to(card, { rotateX:-y*8, rotateY:x*8, transformPerspective:800, ease:'power1.out', duration:0.3 });
    });
    card.addEventListener('mouseleave', ()=>gsap.to(card, { rotateX:0, rotateY:0, duration:0.5, ease:'power3.out' }));
  });

  // Magnetic buttons
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

  // Theme toggle
  document.getElementById('themeToggle').addEventListener('click', ()=>{
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

  // Format lot display
  let lotDisplay, lotUnit;
  if (calc.unit === 'lots') {
    if (lot >= 1)       { lotDisplay = lot.toFixed(2); }
    else if (lot >= 0.1){ lotDisplay = lot.toFixed(3); }
    else                { lotDisplay = lot.toFixed(4); }
    lotUnit = lot >= 1 ? 'Standard Lots' : lot >= 0.1 ? 'Mini Lots' : 'Micro Lots';
    if (lot < 0.01) lotUnit = 'Nano — check pip value';
  } else {
    lotDisplay = lot.toFixed(4);
    lotUnit = calc.unit.toUpperCase();
  }

  document.getElementById('popup-lot-val').textContent  = lotDisplay;
  document.getElementById('popup-lot-unit').textContent = lotUnit;

  // Breakdown stats
  document.getElementById('popup-risk-usd').textContent   = '$' + calc.riskUSD.toFixed(2);
  document.getElementById('popup-profit-usd').textContent = '$' + calc.profitUSD.toFixed(2);
  document.getElementById('popup-rr').textContent         = '1 : ' + calc.rr.toFixed(2);
  document.getElementById('popup-sl-pips').textContent    = calc.slPips.toFixed(1) + ' pips';

  // Colour RR
  const rrEl = document.getElementById('popup-rr');
  rrEl.className = 'popup-stat-val' + (calc.rr >= 2 ? ' good' : calc.rr >= 1 ? ' warn' : ' bad');

  // Formula line
  const instrumentInfo = getInstrumentInfo(document.getElementById('c-pair').value);
  document.getElementById('popup-formula').innerHTML =
    `<strong>Formula:</strong> Risk ($${calc.riskUSD.toFixed(2)}) ÷ (SL distance [${calc.slDist.toFixed(5)}] × contract size [${instrumentInfo.contract}])<br>
     <strong>= ${lotDisplay} ${calc.unit}</strong><br>
     Instrument: ${calc.label}`;

  // Rule alert
  const alertEl = document.getElementById('popup-rule-alert');
  if (!calc.slOk || !calc.tpOk) {
    alertEl.className = 'popup-rule-alert fail';
    alertEl.textContent = '❌ Direction mismatch — check SL/TP placement vs direction';
  } else if (calc.riskPercent > 2) {
    alertEl.className = 'popup-rule-alert fail';
    alertEl.textContent = `❌ Risk ${calc.riskPercent}% exceeds The5ers 2% max per trade rule!`;
  } else if (calc.rr < 1) {
    alertEl.className = 'popup-rule-alert warn';
    alertEl.textContent = `⚠️ RR of 1:${calc.rr.toFixed(2)} is below 1:1 — not recommended`;
  } else if (calc.rr < 2) {
    alertEl.className = 'popup-rule-alert warn';
    alertEl.textContent = `⚠️ RR of 1:${calc.rr.toFixed(2)} is acceptable but aim for 1:2+`;
  } else {
    alertEl.className = 'popup-rule-alert pass';
    alertEl.textContent = `✅ Trade passes all The5ers Bootcamp rules — RR 1:${calc.rr.toFixed(2)}`;
  }

  overlay.classList.add('open');
}

function closePopup() { document.getElementById('resultPopup').classList.remove('open'); }

// ──────────────────────────────────────────────
// CALCULATOR
// ──────────────────────────────────────────────
function doCalc() {
  const accountSize  = parseFloat(document.getElementById('c-account').value)  || 20000;
  const riskPercent  = parseFloat(document.getElementById('c-risk').value)      || 1;
  const entryPrice   = parseFloat(document.getElementById('c-entry').value);
  const slPrice      = parseFloat(document.getElementById('c-sl-price').value);
  const tpPrice      = parseFloat(document.getElementById('c-tp-price').value);
  const direction    = document.getElementById('c-dir').value;
  const pair         = document.getElementById('c-pair').value.trim() || 'EURUSD';

  if (!entryPrice) { showToast('Enter Entry Price', 'warn'); return; }
  if (!slPrice)    { showToast('Enter Stop Loss Price', 'warn'); return; }
  if (!tpPrice)    { showToast('Enter Take Profit Price', 'warn'); return; }

  const result = computeLotSize({ accountSize, riskPercent, entryPrice, slPrice, tpPrice, direction, pair });
  if (!result) { showToast('Invalid prices — SL = Entry?', 'warn'); return; }

  lastCalc = { ...result, pair, direction, entryPrice, slPrice, tpPrice, riskPercent, accountSize,
    notes: document.getElementById('c-notes').value };

  // Update result boxes
  const setVal = (id, val, cls='') => {
    const el = document.getElementById(id);
    if (!el) return;
    gsap.fromTo(el, { scale:0.8, opacity:0 }, { scale:1, opacity:1, duration:0.4, ease:'back.out(1.7)' });
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
  document.getElementById('r-sl-dist').textContent = result.slDist.toFixed(5);
  document.getElementById('r-tp-dist').textContent = result.tpDist.toFixed(5);
  document.getElementById('r-sl-pips').textContent = result.slPips.toFixed(1) + ' pips';
  document.getElementById('r-tp-pips').textContent = result.tpPips.toFixed(1) + ' pips';

  runRules(lastCalc);

  // Open popup automatically
  openPopup(lastCalc);
}

function runRules({ riskPercent, riskUSD, accountSize, rr, slOk, tpOk }) {
  const checks = [
    { ok: slOk && tpOk, cls: slOk&&tpOk?'pass':'fail',
      text: `SL/TP Direction: ${slOk&&tpOk?'Correct ✓':'WRONG — flip SL or TP'}`, icon: slOk&&tpOk?'✅':'❌' },
    { ok: riskPercent<=2, cls: riskPercent<=2?'pass':'fail',
      text: `Risk per trade: ${riskPercent}% ${riskPercent<=2?'≤ 2% ✓':'> 2% — VIOLATION'}`, icon: riskPercent<=2?'✅':'❌' },
    { ok: rr>=2, cls: rr>=2?'pass':rr>=1?'warn':'fail',
      text: `R:R 1:${rr.toFixed(2)} ${rr>=2?'Excellent ✓':rr>=1?'Acceptable — aim for 1:2+':'Poor — avoid'}`, icon: rr>=2?'✅':rr>=1?'⚠️':'❌' },
    { ok: (riskUSD/accountSize*100)<=2, cls:(riskUSD/accountSize*100)<=2?'pass':'warn',
      text: `Single trade DD: ${(riskUSD/accountSize*100).toFixed(2)}% ${(riskUSD/accountSize*100)<=2?'✓':'— keep under 2%'}`, icon:(riskUSD/accountSize*100)<=2?'✅':'⚠️' }
  ];
  document.getElementById('ruleList').innerHTML = checks.map((c,i)=>
    `<div class="rule-row ${c.cls}" style="animation-delay:${i*0.08}s">${c.icon} &nbsp; ${c.text}</div>`
  ).join('');
}

function resetCalc() {
  ['c-pair','c-entry','c-sl-price','c-tp-price','c-notes'].forEach(id=>{ const el=document.getElementById(id); if(el)el.value=''; });
  document.getElementById('c-risk').value = 1;
  ['r-lots','r-rr','r-risk','r-profit','r-sl-dist','r-tp-dist'].forEach(id=>{ const el=document.getElementById(id); if(el){ el.textContent='—'; el.className='res-val'; }});
  ['r-sl-pips','r-tp-pips'].forEach(id=>{ const el=document.getElementById(id); if(el)el.textContent=''; });
  document.getElementById('ruleList').innerHTML='<div class="rule-row" style="color:var(--text3)">⬜ &nbsp;Enter trade details and calculate</div>';
  document.getElementById('aiOut').innerHTML='<div class="ai-header"><span class="ai-dot"></span>Awaiting Trade Data</div><div class="ai-content" style="color:var(--text3);font-size:12px;">Calculate a trade first, then click AI Analyze.</div>';
  lastCalc = null;
}

// ──────────────────────────────────────────────
// GROQ AI
// ──────────────────────────────────────────────
async function runAI() {
  if (!lastCalc) { showToast('Calculate a trade first!', 'warn'); return; }
  if (!GROQ_API_KEY) {
    showToast('⚠️ API key not loaded. Check your Vercel environment variables.', 'warn');
    return;
  }

  const model = document.getElementById('aiModel').value;
  const btn   = document.getElementById('aiBtn');
  const out   = document.getElementById('aiOut');
  btn.disabled = true;
  out.innerHTML = `<div class="ai-header"><span class="ai-dot"></span>Groq — Analyzing</div><div style="color:var(--text3);font-size:12px;">Evaluating <span class="typing-dots"><span></span><span></span><span></span></span></div>`;

  const { accountSize, riskPercent, riskUSD, lotSize, unit, profitUSD, rr, entryPrice, slPrice, tpPrice, direction, pair, notes, slDist, tpDist, slPips, tpPips } = lastCalc;

  const prompt = `You are an elite prop trading coach. Analyze this trade for a The5ers $20K Bootcamp trader.

INSTRUMENT: ${pair} | DIRECTION: ${direction}
ENTRY: ${entryPrice} | SL: ${slPrice} (dist: ${slDist.toFixed(5)} / ${slPips.toFixed(1)} pips) | TP: ${tpPrice} (dist: ${tpDist.toFixed(5)} / ${tpPips.toFixed(1)} pips)

RISK MANAGEMENT:
- Account: $${accountSize} | Risk: ${riskPercent}% ($${riskUSD.toFixed(2)})
- Position: ${lotSize.toFixed(4)} ${unit} | Profit Target: $${profitUSD.toFixed(2)}
- Risk:Reward: 1:${rr.toFixed(2)}
- Notes: ${notes || 'None'}

RULES: 2% max risk/trade, mandatory SL, 5% max daily DD, 6% profit target/phase.

Structured evaluation:
1. 🎯 QUALITY SCORE /10
2. ✅ PROP FIRM COMPLIANCE
3. 📊 RISK ASSESSMENT
4. 💡 TOP 3 RECOMMENDATIONS
5. ⚠️ RED FLAGS

Be concise and actionable.`;

  try {
    const res  = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${GROQ_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages:[{ role:'user', content:prompt }], temperature:0.7, max_tokens:1024 })
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error.message);
    const text = data.choices[0].message.content;
    out.innerHTML = `<div class="ai-header"><span class="ai-dot"></span>⚡ ${model}</div><div class="ai-content">${text.replace(/\n/g,'<br>')}</div>`;
  } catch(e) {
    out.innerHTML = `<div class="ai-header"><span class="ai-dot" style="background:#ff3b5c"></span>Error</div><div style="color:#ff3b5c;font-size:12px;">${e.message}<br><br>Get a free key → https://console.groq.com/keys</div>`;
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
    notes: lastCalc.notes || ''
  });
  localStorage.setItem('tg_j', JSON.stringify(journal));
  renderJournal();
  showToast('✓ Trade logged!', 'success');
  gsap.fromTo('#jList', { opacity:0 }, { opacity:1, duration:0.4 });
}

function renderJournal() {
  const el = document.getElementById('jList');
  if (!el) return;
  const countEl = document.getElementById('jCount');
  if (countEl) countEl.textContent = journal.length;

  const rrs = journal.map(j=>+j.rr).filter(r=>r>0);
  const avgRR = rrs.length ? (rrs.reduce((a,b)=>a+b)/rrs.length).toFixed(2) : '—';
  const wins  = journal.filter(j=>+j.rr>=2).length;
  const winRate = journal.length ? ((wins/journal.length)*100).toFixed(1) : 0;
  const miniStats = document.getElementById('jStatsMini');
  if (miniStats) miniStats.innerHTML = `📊 ${journal.length} trades | 🎯 ${winRate}% quality | Avg RR 1:${avgRR}`;

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
      <button class="j-del" onclick="delJournal(${j.id})">✕</button>
    </div>
  `).join('');

  const statsEl = document.getElementById('jStats');
  if (statsEl) {
    const totalRisk = journal.reduce((s,j)=>s+(parseFloat(j.riskUSD)||0),0);
    statsEl.innerHTML = `
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;padding-top:12px;border-top:1px solid var(--border);">
        <div style="text-align:center"><div style="font-size:9px;color:var(--text3);letter-spacing:1px;">QUALITY RATE</div><div style="font-size:20px;font-weight:700;color:var(--accent4);">${winRate}%</div></div>
        <div style="text-align:center"><div style="font-size:9px;color:var(--text3);letter-spacing:1px;">AVG R:R</div><div style="font-size:20px;font-weight:700;color:var(--accent);">1:${avgRR}</div></div>
        <div style="text-align:center"><div style="font-size:9px;color:var(--text3);letter-spacing:1px;">TOTAL RISK</div><div style="font-size:16px;font-weight:600;">$${totalRisk.toFixed(0)}</div></div>
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

// CSV Export
function exportCSV() {
  if (!journal.length) { showToast('No trades to export','warn'); return; }
  const headers = ['Date','Pair','Direction','Entry','SL','TP','Size','Unit','Risk%','Risk$','Profit$','RR','Notes'];
  const rows = journal.map(j=>[
    `"${j.date}"`,j.pair,j.direction,j.entry,j.slPrice,j.tpPrice,j.lotSize,j.unit,
    j.riskPercent,j.riskUSD,j.profitUSD,`1:${j.rr}`,`"${(j.notes||'').replace(/"/g,'""')}"`
  ]);
  const csv = [headers.join(','),...rows.map(r=>r.join(','))].join('\n');
  const blob = new Blob(['\uFEFF'+csv],{type:'text/csv;charset=utf-8;'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href=url; a.download=`tradeguard_${new Date().toISOString().slice(0,10)}.csv`;
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
            lotSize:v[6]||0, unit:v[7]||'lots', riskPercent:v[8]||1, riskUSD:v[9]||0,
            profitUSD:v[10]||0, rr:(v[11]||'1:1').replace('1:',''), notes:v[12]?.replace(/"/g,'')||''
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
// DAILY P&L TRACKER
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
  const acc   = parseFloat(document.getElementById('dl-acc').value)||20000;
  const lim   = parseFloat(document.getElementById('dl-lim').value)||5;
  const limUSD= acc*lim/100;
  const total = dlEntries.reduce((s,e)=>s+e.amt,0);
  const loss  = Math.max(0,-total);
  const used  = Math.min(loss/limUSD*100,100);

  const te = document.getElementById('dlTotal');
  te.textContent = (total>=0?'+':'')+'$'+total.toFixed(2);
  te.className = 'big-stat'+(total<0&&used>80?' red':'');
  document.getElementById('dlPct').textContent = Math.abs(total/acc*100).toFixed(2)+'% of account';

  const bar = document.getElementById('dlBar');
  bar.style.width = used+'%';
  bar.className = 'pb-fill'+(used>80?' danger':used>50?' warn':'');
  document.getElementById('dlBarPct').textContent = used.toFixed(1)+'%';

  const note = document.getElementById('dlNote');
  if (used>=100)      note.textContent = '🚨 LIMIT BREACHED — Stop trading NOW!';
  else if (used>80)   note.textContent = `⚠️ ${used.toFixed(1)}% of limit used — consider stopping.`;
  else if (total>=0)  note.textContent = `✅ In profit +$${total.toFixed(2)}. Daily limit safe.`;
  else                note.textContent = `Loss: $${loss.toFixed(2)} / $${limUSD.toFixed(2)}. ${(100-used).toFixed(1)}% buffer left.`;

  document.getElementById('dlLog').innerHTML = dlEntries.length
    ? dlEntries.map(e=>`<div class="log-item"><span style="color:var(--text3)">${e.time}</span><span class="${e.amt>=0?'pos':'neg'}">${e.amt>=0?'+':''}$${e.amt.toFixed(2)}</span></div>`).join('')
    : '<div style="color:var(--text3);font-size:12px;">No entries today.</div>';
}

// ──────────────────────────────────────────────
// PHASE PROGRESS
// ──────────────────────────────────────────────
function updatePhase() {
  const acc   = parseFloat(document.getElementById('ph-acc').value)||20000;
  const tgtP  = parseFloat(document.getElementById('ph-tgt').value)||6;
  const pnl   = parseFloat(document.getElementById('ph-pnl').value)||0;
  const phase = document.getElementById('ph-ph').value;
  const tgtUSD= acc*tgtP/100;
  const prog  = Math.max(0,Math.min(pnl/tgtUSD*100,100));
  const rem   = Math.max(0,tgtUSD-pnl);

  gsap.to('#phProfBar',{ width:prog+'%', duration:0.8, ease:'power3.out' });
  document.getElementById('phProfVal').textContent = `$${pnl.toFixed(2)} / $${tgtUSD.toFixed(2)}`;
  const note = document.getElementById('phNote');
  if (prog>=100) note.textContent=`🎉 Phase ${phase} PASSED! Move to next phase.`;
  else note.textContent=`Need $${rem.toFixed(2)} more to pass Phase ${phase}. Stay disciplined.`;
}

// ──────────────────────────────────────────────
// UTILS
// ──────────────────────────────────────────────
function escHtml(str) {
  return (str||'').replace(/[&<>]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[m]));
}

function showToast(msg, type='success') {
  const colors = { success:'linear-gradient(135deg,#00ffb3,#00c8ff)', warn:'linear-gradient(135deg,#ffb800,#ff6b35)', info:'linear-gradient(135deg,#00c8ff,#7b2fff)' };
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
  // Fetch API key from Vercel environment first
  await fetchApiKey();
  
  initThree();
  initCursor();
  initGSAP();
  renderJournal();
  renderDL();

  // Close popup on overlay click
  const popup = document.getElementById('resultPopup');
  if (popup) {
    popup.addEventListener('click', function(e){
      if (e.target === this) closePopup();
    });
  }
});