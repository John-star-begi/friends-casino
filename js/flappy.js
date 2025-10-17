/* ============================
   FLAPPY FIASCO — CLEAN BUILD
   - Fixed global FF
   - No tilt, no clouds
   - Fixed hunter offset
   - Fixed bird X
   - Distinct projectiles
   - Mult starts at 0; block early cashout
   - Admin hooks
   ============================ */

/* ---------- Small helpers (hoisted) ---------- */
function clamp(v, min, max){ return Math.max(min, Math.min(max, v)); }
function randChoice(a){ return a[Math.floor(Math.random()*a.length)]; }
function randf(a,b){ return a + Math.random()*(b-a); }
function randi(a,b){ return Math.floor(randf(a,b+1)); }

/* ---------- Tiny audio beeps (no external files) ---------- */
const SFX = (()=>{ 
  let ac; let muted=false;
  function ensure(){ if(!ac) ac = new (window.AudioContext||window.webkitAudioContext)(); }
  function beep(freq=440, dur=0.07, type='sine', vol=0.05){
    if(muted) return;
    ensure();
    const o=ac.createOscillator(), g=ac.createGain();
    o.type=type; o.frequency.value=freq; g.gain.value=vol;
    o.connect(g); g.connect(ac.destination); o.start(); o.stop(ac.currentTime+dur);
  }
  return {
    flap(){ beep(700,.05,'square',.03); },
    ding(){ beep(1100,.08,'triangle',.05); },
    thud(){ beep(180,.12,'sawtooth',.06); },
    cash(){ beep(900,.12,'triangle',.08); },
    wind(){ beep(300,.02,'sine',.01); },
    toggle(){ muted=!muted; }
  };
})();

/* ===========================================================
   Create a global shell FIRST so inline onclick finds window.FF
   =========================================================== */
window.FF = {
  // These will be wired up in init()
  init: ()=>{},
  setBet: ()=>{},
  placeBet: ()=>{},
  startGame: ()=>{},
  cashOut: ()=>{},
  applyAdmin: ()=>{}
};

/* Wrap the whole game safely so we can assign methods after */
(function(){
  'use strict';

  /* ---------- DOM refs (assigned in init) ---------- */
  let cvs, ctx, W, H;
  let elTokens, elBet, btnStart, btnCash;
  let elMult, elDist, elClears, elWindBar, elWindDir;
  let overWrap, overTitle, overCaption, overBet, overPayout;

  /* ---------- Tunables / Admin-controlled defaults ---------- */
  let GRAVITY = 900;          // px/s^2
  let FLAP_FORCE = -320;      // px/s
  let BASE_SPEED = 150;       // px/s world speed

  // Multiplier tuning (slower, per your request)
  let MULT_START = 0.00;
  let MULT_PER_PIPE = 0.03;
  let MULT_PER_100M = 0.01;
  let MULT_GOLDEN = 0.15;
  let MULT_PER_SEC = 0.0015;

  // Pipes
  let PIPE_GAP_BASE = 120;
  let PIPE_INTERVAL = 1.4;    // seconds between pairs

  // Hunter / projectiles
  let THROW_MIN = 1.6, THROW_MAX = 3.4;
  let PROJECTILE_SPEED_MULT = 1.0;
  const HUNTER_OFFSET = 180;  // px behind bird

  // Difficulty tiers over time
  const DIFF = [
    { t: 0,   speed: 1.00, throws: 0.8, gapMult: 1.00, wind: 1.0, label:'Mild' },
    { t: 30,  speed: 1.20, throws: 1.0, gapMult: 0.95, wind: 1.1, label:'Moderate' },
    { t: 60,  speed: 1.40, throws: 1.15, gapMult: 0.90, wind: 1.25, label:'Strong' },
    { t: 90,  speed: 1.60, throws: 1.35, gapMult: 0.85, wind: 1.5, label:'Chaotic' },
  ];
  function tierFor(t){ return DIFF.reduce((a,c)=>t>=c.t?c:a, DIFF[0]); }

  /* ---------- Game state ---------- */
  let state = 'IDLE'; // IDLE | RUNNING | OVER
  let lastT = 0, elapsed = 0;

  let bet = 0;
  let tokens = Number(localStorage.getItem('tokens')) || 100;

  let multiplier = MULT_START;
  let distance = 0, distSteps = 0, clears = 0;

  let pipes = [];
  let projectiles = [];

  let pipeTimer = 0;

  const bird = { x: 0, y: 0, r: 14, vy: 0, alive: true };
  const hunter = { x: 0, y: 0, throwTimer: 0 };

  const wind = { dir:'–', strength:0, timer:0, nextIn: randf(4,7) };

  /* ---------- Input ---------- */
  function flap(){
    if (state !== 'RUNNING' || !bird.alive) return;
    bird.vy = FLAP_FORCE;
    SFX.flap();
  }

  function bindInputs(){
    cvs.addEventListener('pointerdown', flap);

    window.addEventListener('keydown', e => {
      const key = e.code.toLowerCase();

      // Space → flap; Shift+Space or "C" → cash out
      if (key === 'space') {
        e.preventDefault();
        if (e.shiftKey) {
          window.FF.cashOut();
        } else {
          flap();
        }
      }
      if (key === 'keyc') { e.preventDefault(); window.FF.cashOut(); }
      if (key === 'keym') { e.preventDefault(); SFX.toggle(); }
      if (e.key.toLowerCase() === 'a') { // toggle admin panel
        const panel = document.getElementById('adminPanel');
        if (panel) panel.style.display = (panel.style.display === 'none') ? 'block' : 'none';
      }
    });
  }

  /* ---------- Public API (assigned onto window.FF) ---------- */
  window.FF.init = function init(){
    // Query DOM now (after HTML exists)
    cvs = document.getElementById('game');
    ctx = cvs.getContext('2d');
    W = cvs.width; H = cvs.height;

    elTokens  = document.getElementById('tokens');
    elBet     = document.getElementById('betInput');
    btnStart  = document.getElementById('startBtn');
    btnCash   = document.getElementById('cashBtn');

    elMult    = document.getElementById('mult');
    elDist    = document.getElementById('dist');
    elClears  = document.getElementById('clears');
    elWindBar = document.getElementById('windbar');
    elWindDir = document.getElementById('windDir');

    overWrap   = document.getElementById('overOverlay');
    overTitle  = document.getElementById('overTitle');
    overCaption= document.getElementById('overCaption');
    overBet    = document.getElementById('overBet');
    overPayout = document.getElementById('overPayout');

    // initial positions
    bird.x = W * 0.25;
    bird.y = H * 0.5;
    hunter.x = bird.x - HUNTER_OFFSET;
    hunter.y = bird.y;
    hunter.throwTimer = randf(THROW_MIN, THROW_MAX);

    // tokens + HUD
    updateHUD();

    // inputs
    bindInputs();
  };

  window.FF.setBet = function setBet(v){
    // kept for compatibility with earlier HTML
    if (v === 'max') {
      bet = tokens;
      if (elBet) elBet.value = tokens;
    } else {
      bet = Number(v);
      if (elBet) elBet.value = bet;
    }
  };

  window.FF.placeBet = function placeBet(v){
    // newer name (both work)
    window.FF.setBet(v);
  };

  window.FF.startGame = function startGame(){
    // sync from input if present
    const manual = Number(elBet && elBet.value);
    if (manual > 0) bet = manual;

    if (!bet || bet <= 0) { alert('Please place a bet first!'); return; }
    if (bet > tokens)     { alert('Not enough tokens!');      return; }

    tokens -= bet; saveTokens();

    // reset round
    state='RUNNING';
    elapsed=0; lastT=0;
    multiplier = MULT_START;
    distance=0; distSteps=0; clears=0;
    pipes.length=0; projectiles.length=0;
    pipeTimer=0;
    bird.y=H*0.5; bird.vy=0; bird.alive=true;
    hunter.x=bird.x - HUNTER_OFFSET; hunter.y=H*0.5; hunter.throwTimer=randf(THROW_MIN,THROW_MAX);
    wind.dir='–'; wind.strength=0; wind.timer=0; wind.nextIn=randf(4,7);
    if (overWrap) overWrap.style.display='none';
    if (btnStart) btnStart.disabled=true;
    if (btnCash)  btnCash.disabled=false;

    requestAnimationFrame(ts=>{ lastT=ts/1000; requestAnimationFrame(loop); });
  };

  window.FF.cashOut = function cashOut(){
    if (state!=='RUNNING') return;

    if (multiplier <= 1.0) {
      alert("❌ You can’t cash out yet — multiplier must rise first!");
      return;
    }

    state='OVER';
    const payout = Math.max(0, Math.floor(bet * multiplier));
    tokens += payout; saveTokens();
    if (btnStart) btnStart.disabled=false;
    if (btnCash)  btnCash.disabled=true;

    if (overTitle)  overTitle.textContent='🏆 You Cashed Out!';
    if (overCaption)overCaption.textContent='Great timing!';
    if (overBet)    overBet.textContent=bet;
    if (overPayout) overPayout.textContent=payout;
    if (overWrap)   overWrap.style.display='flex';
    SFX.cash();
  };

  /* ---------- Admin ---------- */
  window.FF.applyAdmin = function applyAdmin(){
    // Read from your Admin Panel inputs if present
    const g  = document.getElementById('adminGravity');
    const ff = document.getElementById('adminFlap');
    const sp = document.getElementById('adminSpeed');

    const mSec  = document.getElementById('adminMultSec');
    const mPipe = document.getElementById('adminMultPipe');
    const mDist = document.getElementById('adminMultDist');
    const mGold = document.getElementById('adminMultGold');

    const gap   = document.getElementById('adminGap');
    const pint  = document.getElementById('adminPipeInterval');

    const tMin  = document.getElementById('adminThrowMin');
    const tMax  = document.getElementById('adminThrowMax');
    const pSpd  = document.getElementById('adminProjSpeed');

    const windPow = document.getElementById('adminWind');

    if (g)   GRAVITY = Number(g.value);
    if (ff)  FLAP_FORCE = Number(ff.value);
    if (sp)  BASE_SPEED = Number(sp.value);

    if (mSec)  MULT_PER_SEC = Number(mSec.value);
    if (mPipe) MULT_PER_PIPE = Number(mPipe.value);
    if (mDist) MULT_PER_100M = Number(mDist.value);
    if (mGold) MULT_GOLDEN = Number(mGold.value);

    if (gap)  PIPE_GAP_BASE = Number(gap.value);
    if (pint) PIPE_INTERVAL = Number(pint.value);

    if (tMin) THROW_MIN = Number(tMin.value);
    if (tMax) THROW_MAX = Number(tMax.value);
    if (pSpd) PROJECTILE_SPEED_MULT = Number(pSpd.value) || 1.0;

    if (windPow) { for (const d of DIFF) d.wind = Number(windPow.value); }

    alert("✅ Live settings applied!");
  };

  /* ---------- Loop ---------- */
  function loop(ts){
    const now = ts/1000, dt = Math.min(0.033, now - lastT); lastT=now;
    if(state==='RUNNING'){ update(dt); draw(); }
    if(state!=='IDLE') requestAnimationFrame(loop);
  }

  /* ---------- Update ---------- */
  function update(dt){
    elapsed += dt;
    const tier = tierFor(elapsed);

    // Multiplier growth (time)
    multiplier += MULT_PER_SEC * dt * tier.speed;

    // Physics
    bird.vy += GRAVITY * dt;

    // (Wind gusts: up/crosswind influences; NO tilt and NO clouds)
    updateWind(dt, tier);

    // Integrate
    bird.y += bird.vy * dt;
    bird.x  = W * 0.25; // lock horizontally
    if (bird.y + bird.r >= H-8){ crash('Face-planted the runway!'); return; }
    if (bird.y - bird.r <= 0){ bird.y = bird.r; bird.vy = 0; }

    // Spawns
    pipeTimer -= dt;
    if(pipeTimer<=0){
      spawnPipePair(tier);
      pipeTimer = PIPE_INTERVAL / tier.speed;
    }

    updateHunter(dt, tier);

    // Move world
    const speed = BASE_SPEED * tier.speed;
    for(const p of pipes){ p.x -= speed*dt; }
    for(const pr of projectiles){ pr.x += pr.vx*dt; pr.y += pr.vy*dt; }

    // Cleanup
    pipes = pipes.filter(p=> p.x + p.w > -10);
    projectiles = projectiles.filter(pr=> pr.x>-40 && pr.x<W+40 && pr.y>-40 && pr.y<H+40);

    // Clears (when passing a pair)
    for(let i=0;i<pipes.length;i+=2){
      const top=pipes[i], bot=pipes[i+1]; if(!top||!bot) continue;
      if(!top.passed && (bird.x > top.x + top.w)){
        top.passed = bot.passed = true;
        clears += 1;
        multiplier += MULT_PER_PIPE;
        SFX.ding();
      }
    }

    // Distance-based multiplier (every 100m)
    distance += speed*dt*0.25;
    const step = Math.floor(distance/100);
    if(step>distSteps){
      multiplier += MULT_PER_100M * (step - distSteps);
      distSteps = step;
    }

    // Collisions
    if(checkCollisions()) return;

    updateHUD();
  }

  /* ---------- Spawning ---------- */
  function spawnPipePair(tier){
    const gap = Math.max(90, PIPE_GAP_BASE * tier.gapMult);
    const gapY = randf(60, H-60);
    const topH = clamp(gapY - gap/2, 30, H-gap-30);
    const botY = gapY + gap/2;
    const botH = clamp(H - botY, 30, H-30);
    const x = W + 50;
    pipes.push({ x, y:0,    w:55, h:topH,    passed:false });
    pipes.push({ x, y:H-botH,w:55, h:botH,    passed:false });
  }

  function updateHunter(dt, tier){
    // Always fixed behind bird; follow on Y
    hunter.x = (W * 0.25) - HUNTER_OFFSET;
    hunter.y += (bird.y - hunter.y) * 0.1;

    hunter.throwTimer -= dt;
    if(hunter.throwTimer<=0){
      throwProjectile(tier);
      hunter.throwTimer = randf(THROW_MIN,THROW_MAX) / tier.throws;
    }
  }

  function throwProjectile(tier){
    const types = ['boot','hat','pie','goldenEgg'];
    const type = randChoice(types);
    const base = randf(160, 240) * (0.9 + 0.2*tier.speed) * PROJECTILE_SPEED_MULT;
    const ang = Math.atan2(bird.y - hunter.y, bird.x - hunter.x);
    projectiles.push({
      x: hunter.x+22, y:hunter.y, r:10,
      vx: Math.cos(ang)*base, vy: Math.sin(ang)*base,
      type
    });
  }

  function updateWind(dt, tier){
    // gust timers
    wind.timer -= dt; wind.nextIn -= dt;
    if(wind.timer<=0){ wind.strength=0; if(elWindBar) elWindBar.style.width='0%'; }
    if(wind.nextIn<=0){
      wind.dir = randChoice(['LEFT','RIGHT','UP']);
      wind.strength = randf(0.15, 0.65) * tier.wind;
      wind.timer = randf(1.5, 3.0);
      wind.nextIn = randf(4,8);
      SFX.wind();
      if (elWindDir) elWindDir.textContent = wind.dir==='LEFT'?'←': wind.dir==='RIGHT'?'→':'↑';
      if (elWindBar) elWindBar.style.width = `${Math.round(Math.min(1,wind.strength)*100)}%`;
    }

    // apply vertical wind only (no horizontal drift to keep bird centered)
    if(wind.strength>0 && wind.dir==='UP'){
      bird.vy += -GRAVITY * 0.65 * wind.strength * dt;
    }
  }

  /* ---------- Collisions ---------- */
  function hitRectCircle(rx,ry,rw,rh,cx,cy,cr){
    const nx = clamp(cx, rx, rx+rw);
    const ny = clamp(cy, ry, ry+rh);
    const dx=cx-nx, dy=cy-ny;
    return (dx*dx+dy*dy) <= cr*cr;
  }

  function checkCollisions(){
    // pipes
    for(const p of pipes){
      if(hitRectCircle(p.x,p.y,p.w,p.h,bird.x,bird.y,bird.r)){
        crash('Piped and humbled!');
        return true;
      }
    }
    // projectiles
    for(let i=0;i<projectiles.length;i++){
      const pr = projectiles[i];
      const dx=pr.x-bird.x, dy=pr.y-bird.y, rr=(pr.r+bird.r);
      if(dx*dx+dy*dy <= rr*rr){
        if(pr.type==='goldenEgg'){
          multiplier += MULT_GOLDEN; SFX.ding();
          projectiles.splice(i,1); i--; continue;
        } else {
          crash('Hunter’s throw landed!');
          return true;
        }
      }
    }
    return false;
  }

  function crash(msg){
    state='OVER'; bird.alive=false; SFX.thud();
    if (btnStart) btnStart.disabled=false;
    if (btnCash)  btnCash.disabled=true;
    if (overTitle)   overTitle.textContent='💥 You Crashed!';
    if (overCaption) overCaption.textContent=msg||'Ouch.';
    if (overBet)     overBet.textContent=bet;
    if (overPayout)  overPayout.textContent=0;
    if (overWrap)    overWrap.style.display='flex';
    saveTokens();
  }

  /* ---------- Drawing ---------- */
  function draw(){
    // dark gradient (no tilt)
    const k = clamp(elapsed/120, 0, 1);
    const top = [Math.round(10*(1-k)+2*k),0,Math.round(24*(1-k)+12*k)];
    const bot = [Math.round(4*(1-k)+1*k),0,Math.round(18*(1-k)+8*k)];
    const g = ctx.createLinearGradient(0,0,0,H);
    g.addColorStop(0, `rgb(${top.join(',')})`);
    g.addColorStop(1, `rgb(${bot.join(',')})`);
    ctx.fillStyle=g; ctx.fillRect(0,0,W,H);

    // ground
    ctx.fillStyle='#0e1a33'; ctx.fillRect(0,H-8,W,8);

    // pipes
    for(const p of pipes){
      ctx.fillStyle='#5e3dbb';
      roundRect(ctx,p.x,p.y,p.w,p.h,8,true);
      ctx.strokeStyle='#9c27b0'; ctx.strokeRect(p.x+3,p.y+3,p.w-6,p.h-6);
    }

    // hunter
    ctx.fillStyle = '#f44336';
    ctx.beginPath();
    ctx.arc(hunter.x, hunter.y, 12, 0, Math.PI*2);
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#ffeb3b';
    ctx.stroke();

    // projectiles (distinct shapes)
    for (const pr of projectiles) {
      ctx.save();
      switch (pr.type) {
        case 'boot':
          ctx.fillStyle = '#795548';  // brown rectangle
          ctx.fillRect(pr.x - 8, pr.y - 5, 16, 10);
          break;
        case 'hat':
          ctx.fillStyle = '#3f51b5';  // blue trapezoid
          ctx.beginPath();
          ctx.moveTo(pr.x - 10, pr.y + 5);
          ctx.lineTo(pr.x, pr.y - 8);
          ctx.lineTo(pr.x + 10, pr.y + 5);
          ctx.closePath();
          ctx.fill();
          break;
        case 'pie':
          ctx.fillStyle = '#ff7043';  // orange semicircle
          ctx.beginPath();
          ctx.arc(pr.x, pr.y, 10, 0, Math.PI, false);
          ctx.fill();
          break;
        case 'goldenEgg':
          ctx.fillStyle = '#ffd700';  // yellow ellipse
          ctx.beginPath();
          ctx.ellipse(pr.x, pr.y, 7, 10, 0, 0, Math.PI * 2);
          ctx.fill();
          break;
      }
      ctx.restore();
    }

    // bird (top)
    ctx.fillStyle = bird.alive ? '#fff200' : '#999';
    ctx.beginPath();
    ctx.arc(bird.x, bird.y, bird.r, 0, Math.PI*2);
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#000';
    ctx.stroke();

    // HUD overlay text
    ctx.font = '18px Rajdhani';
    ctx.fillStyle = '#fff';
    ctx.fillText(`Tokens: ${tokens}`, 12, 24);
    ctx.fillText(`Bet: ${bet}`, 12, 44);
    ctx.fillText(`Mult: ${multiplier.toFixed(2)}×`, 12, 64);
  }

  /* ---------- Drawing helper ---------- */
  function roundRect(ctx, x, y, w, h, r, fill){
    ctx.beginPath();
    ctx.moveTo(x+r, y);
    ctx.lineTo(x+w-r, y);
    ctx.quadraticCurveTo(x+w, y, x+w, y+r);
    ctx.lineTo(x+w, y+h-r);
    ctx.quadraticCurveTo(x+w, y+h, x+w-r, y+h);
    ctx.lineTo(x+r, y+h);
    ctx.quadraticCurveTo(x, y+h, x, y+h-r);
    ctx.lineTo(x, y+r);
    ctx.quadraticCurveTo(x, y, x+r, y);
    ctx.closePath();
    if(fill) ctx.fill(); else ctx.stroke();
  }

  /* ---------- HUD & storage ---------- */
  function updateHUD(){
    if (elTokens) elTokens.textContent = tokens;
    if (elMult)   elMult.textContent = multiplier.toFixed(2) + '×';
    if (elDist)   elDist.textContent = Math.floor(distance);
    if (elClears) elClears.textContent = clears;
    if (elWindBar) elWindBar.style.width = `${Math.round(Math.min(1,wind.strength)*100)}%`;
  }

  function saveTokens(){
    localStorage.setItem('tokens', tokens);
    updateHUD();
  }

})(); // end module

/* ---------- Boot after DOM ready ---------- */
window.addEventListener('load', ()=> window.FF.init());
