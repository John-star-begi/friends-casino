/* ============================
   FLAPPY FIASCO — MULTIPLIER + HUNTER + WIND (FINAL)
   Works with flappy.html you shared.
   ============================ */

/* ---------- Hoisted helpers ---------- */
function clamp(v, min, max){ return Math.max(min, Math.min(max, v)); }
function randChoice(a){ return a[Math.floor(Math.random()*a.length)]; }
function randf(a,b){ return a + Math.random()*(b-a); }
function randi(a,b){ return Math.floor(randf(a,b+1)); }

/* Tiny audio beeps (no external files) */
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

/* ---------- Main game object ---------- */
window.FF = (()=>{
  // DOM
  const cvs = document.getElementById('game');
  const ctx = cvs.getContext('2d');

  const elTokens = document.getElementById('tokens');
  const elBet = document.getElementById('betInput');
  const btnStart = document.getElementById('startBtn');
  const btnCash  = document.getElementById('cashBtn');

  const elMult = document.getElementById('mult');
  const elDist = document.getElementById('dist');
  const elClears = document.getElementById('clears');
  const elWindBar = document.getElementById('windbar');
  const elWindDir = document.getElementById('windDir');

  const overWrap = document.getElementById('overOverlay');
  const overTitle = document.getElementById('overTitle');
  const overCaption = document.getElementById('overCaption');
  const overBet = document.getElementById('overBet');
  const overPayout = document.getElementById('overPayout');

  // Constants
  const W = cvs.width, H = cvs.height;
  const GRAVITY = 900;          // px/s^2
  const FLAP_FORCE = -320;      // px/s impulse
  const BASE_SPEED = 150;       // base world speed (scales up)
  const PIPE_GAP_BASE = 120;    // gap size
  const PIPE_INTERVAL = 1.4;    // seconds between pipe pairs (scales)
  const CLOUD_INTERVAL = 2.5;   // seconds
  const THROW_MIN = 1.6, THROW_MAX = 3.4;

  // Difficulty tiers over time
  const DIFF = [
    { t: 0,   speed: 1.00, throws: 0.8, gapMult: 1.00, wind: 1.0, label:'Mild' },
    { t: 30,  speed: 1.20, throws: 1.0, gapMult: 0.95, wind: 1.1, label:'Moderate' },
    { t: 60,  speed: 1.40, throws: 1.15, gapMult: 0.90, wind: 1.25, label:'Strong' },
    { t: 90,  speed: 1.60, throws: 1.35, gapMult: 0.85, wind: 1.5, label:'Chaotic' },
  ];
  function tierFor(t){ return DIFF.reduce((a,c)=>t>=c.t?c:a, DIFF[0]); }

  // Multiplier tuning
  const MULT_START = 1.00;
  const MULT_PER_PIPE = 0.06;   // tougher game → slightly higher pipe boost
  const MULT_PER_100M = 0.02;   // per 100m
  const MULT_GOLDEN = 0.30;     // golden egg bonus
  const MULT_PER_SEC = 0.0045;  // gentle drift per second (scaled by diff)

  // State
  let state = 'IDLE'; // IDLE|RUNNING|OVER
  let lastT = 0, elapsed = 0;

  let bet = 0;
  let tokens = Number(localStorage.getItem('tokens')) || 100;

  let multiplier = MULT_START;
  let distance = 0, distSteps = 0, clears = 0;

  let pipes = [];     // store as pairs: top & bottom with same x
  let clouds = [];
  let projectiles = [];

  let pipeTimer=0, cloudTimer=0;

  const bird = { x: W*0.25, y: H*0.5, r:14, vy:0, vx:0, alive:true };

  const hunter = { x: 60, y: H*0.5, throwTimer: randf(THROW_MIN,THROW_MAX) };

  const wind = { dir:'–', strength:0, timer:0, nextIn: randf(4,7) };

  // Input
  function flap(){
    if(state!=='RUNNING' || !bird.alive) return;
    bird.vy = FLAP_FORCE;
    SFX.flap();
  }
  cvs.addEventListener('pointerdown', flap);
  window.addEventListener('keydown', e=>{
    if(e.code==='Space'){ e.preventDefault(); flap(); }
    if(e.key.toLowerCase()==='m'){ SFX.toggle(); }
  });

  /* ---------- Public API ---------- */
  function init(){
    elTokens.textContent = tokens;
    updateHUD();
  }

  function setBet(v){
    if(v==='max'){
      bet = tokens;
      elBet.value = tokens;
    } else {
      bet = Number(v);
      elBet.value = bet;
    }
  }

  function startGame(){
    const manual = Number(elBet.value);
    if (manual>0) bet = manual;

    if(!bet || bet<=0){ alert('Please place a bet first!'); return; }
    if(bet>tokens){ alert('Not enough tokens!'); return; }

    tokens -= bet; saveTokens();

    // reset round
    state='RUNNING';
    elapsed=0; lastT=0;
    multiplier = MULT_START;
    distance=0; distSteps=0; clears=0;
    pipes.length=0; clouds.length=0; projectiles.length=0;
    pipeTimer=0; cloudTimer=0;
    bird.y=H*0.5; bird.vy=0; bird.vx=0; bird.alive=true;
    hunter.x=60; hunter.y=H*0.5; hunter.throwTimer=randf(THROW_MIN,THROW_MAX);
    wind.dir='–'; wind.strength=0; wind.timer=0; wind.nextIn=randf(4,7);
    overWrap.style.display='none';
    btnStart.disabled=true; btnCash.disabled=false;

    requestAnimationFrame(ts=>{ lastT=ts/1000; requestAnimationFrame(loop); });
  }

  function cashOut(){
    if(state!=='RUNNING') return;
    state='OVER';
    const payout = Math.max(0, Math.floor(bet * multiplier));
    tokens += payout; saveTokens();
    btnStart.disabled=false; btnCash.disabled=true;

    overTitle.textContent='🏆 You Cashed Out!';
    overCaption.textContent='Great timing!';
    overBet.textContent=bet; overPayout.textContent=payout;
    overWrap.style.display='flex';
  }

  /* ---------- Core Loop ---------- */
  function loop(ts){
    const now = ts/1000, dt = Math.min(0.033, now - lastT); lastT=now;
    if(state==='RUNNING'){ update(dt); draw(); }
    if(state!=='IDLE') requestAnimationFrame(loop);
  }

  function update(dt){
    elapsed += dt;
    const tier = tierFor(elapsed);

    // multiplier growth (time)
    multiplier += MULT_PER_SEC * dt * tier.speed;

    // physics
    bird.vy += GRAVITY * dt;
    // wind forces
    if(wind.strength>0){
      if(wind.dir==='UP'){ bird.vy += -GRAVITY * 0.65 * wind.strength * dt; }
      if(wind.dir==='LEFT'){ bird.vx = -70 * wind.strength; }
      if(wind.dir==='RIGHT'){ bird.vx =  70 * wind.strength; }
    } else { bird.vx *= 0.9; }

    // integrate
    bird.y += bird.vy * dt;
    bird.x = clamp(bird.x + bird.vx * dt, 40, W-40);

    // bounds
    if(bird.y + bird.r >= H-8){ return crash('Face-planted the runway!'); }
    if(bird.y - bird.r <= 0){ bird.y = bird.r; bird.vy = 0; }

    // timers/spawns
    pipeTimer -= dt; cloudTimer -= dt;
    if(pipeTimer<=0){
      spawnPipePair(tier);
      // faster spawns with difficulty
      pipeTimer = PIPE_INTERVAL / tier.speed;
    }
    if(cloudTimer<=0){
      spawnCloud(tier);
      cloudTimer = CLOUD_INTERVAL / (0.8 + 0.4*tier.speed);
    }

    updateHunter(dt, tier);
    updateWind(dt, tier);

    // move world
    const speed = BASE_SPEED * tier.speed;
    for(const p of pipes){ p.x -= speed*dt; }
    for(const c of clouds){ c.x += c.vx*dt; }
    for(const pr of projectiles){ pr.x += pr.vx*dt; pr.y += pr.vy*dt; }

    // cleanup
    pipes = pipes.filter(p=> p.x + p.w > -10);
    clouds = clouds.filter(c=> c.x + c.w > -20);
    projectiles = projectiles.filter(pr=> pr.x>-40 && pr.x<W+40 && pr.y>-40 && pr.y<H+40);

    // clears: when bird passes a pipe pair's trailing edge once
    for(let i=0;i<pipes.length;i+=2){
      const top=pipes[i], bot=pipes[i+1]; if(!top||!bot) continue;
      if(!top.passed && (bird.x > top.x + top.w)){
        top.passed = bot.passed = true;
        clears += 1;
        multiplier += MULT_PER_PIPE;
        SFX.ding();
      }
    }

    // distance-based multiplier (every 100m)
    distance += speed*dt*0.25;
    const step = Math.floor(distance/100);
    if(step>distSteps){
      multiplier += MULT_PER_100M * (step - distSteps);
      distSteps = step;
    }

    // collisions
    if(checkCollisions()) return;

    updateHUD();
  }

  /* ---------- Spawning ---------- */
  function spawnPipePair(tier){
    // gap shrinks slightly with difficulty
    const gap = Math.max(90, PIPE_GAP_BASE * tier.gapMult);
    const gapY = randf(60, H-60);
    const topH = clamp(gapY - gap/2, 30, H-gap-30);
    const botY = gapY + gap/2;
    const botH = clamp(H - botY, 30, H-30);
    const x = W + 50;
    pipes.push({ x, y:0, w:55, h:topH, passed:false });
    pipes.push({ x, y:H-botH, w:55, h:botH, passed:false });
  }

  function spawnCloud(tier){
    const solid = Math.random()<0.12; // 12% solid
    clouds.push({
      x: W+60,
      y: randf(30, H-120),
      w: randf(60,120),
      h: randf(25,45),
      vx: -randf(45, 85) * tier.speed,
      solid
    });
  }

  /* ---------- Hunter & Wind ---------- */
  function updateHunter(dt, tier){
    // lazy follow
    hunter.y += (bird.y - hunter.y) * 0.02;
    hunter.throwTimer -= dt;
    if(hunter.throwTimer<=0){
      throwProjectile(tier);
      hunter.throwTimer = randf(THROW_MIN,THROW_MAX) / tier.throws;
    }
  }

  function throwProjectile(tier){
    const types = ['boot','hat','pie','goldenEgg'];
    const type = randChoice(types);
    const s = randf(160, 240) * (0.9 + 0.2*tier.speed);
    const ang = Math.atan2(bird.y - hunter.y, bird.x - hunter.x);
    projectiles.push({
      x: hunter.x+22, y:hunter.y, r:10,
      vx: Math.cos(ang)*s, vy: Math.sin(ang)*s,
      type
    });
  }

  function updateWind(dt, tier){
    wind.timer -= dt; wind.nextIn -= dt;
    if(wind.timer<=0){ wind.strength=0; elWindBar.style.width='0%'; }
    if(wind.nextIn<=0){
      wind.dir = randChoice(['LEFT','RIGHT','UP']);
      wind.strength = randf(0.15, 0.65) * tier.wind;
      wind.timer = randf(1.5, 3.0);
      wind.nextIn = randf(4,8);
      SFX.wind();
      elWindDir.textContent = wind.dir==='LEFT'?'←': wind.dir==='RIGHT'?'→':'↑';
      elWindBar.style.width = `${Math.round(Math.min(1,wind.strength)*100)}%`;
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
        return crash('Piped and humbled!');
      }
    }
    // clouds
    for(const c of clouds){
      if(c.solid && hitRectCircle(c.x,c.y,c.w,c.h,bird.x,bird.y,bird.r)){
        return crash('That cloud turned concrete!');
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
          return crash('Hunter’s throw landed!');
        }
      }
    }
    return false;
  }

  function crash(msg){
    state='OVER'; bird.alive=false; SFX.thud();
    btnStart.disabled=false; btnCash.disabled=true;
    overTitle.textContent='💥 You Crashed!'; overCaption.textContent=msg||'Ouch.';
    overBet.textContent=bet; overPayout.textContent=0;
    overWrap.style.display='flex';
    saveTokens();
    return true;
  }

  /* ---------- Drawing ---------- */
  function draw(){
    // background gradient darkens over time
    const k = clamp(elapsed/120, 0, 1);
    const top = [Math.round(10*(1-k)+2*k),0,Math.round(24*(1-k)+12*k)];
    const bot = [Math.round(4*(1-k)+1*k),0,Math.round(18*(1-k)+8*k)];
    const g = ctx.createLinearGradient(0,0,0,H);
    g.addColorStop(0, `rgb(${top.join(',')})`);
    g.addColorStop(1, `rgb(${bot.join(',')})`);
    ctx.fillStyle=g; ctx.fillRect(0,0,W,H);

    // subtle tilt with crosswind
    ctx.save();
    const tilt = wind.strength ? (wind.dir==='LEFT'?-1: wind.dir==='RIGHT'?1:0)*0.05 : 0;
    ctx.translate(W/2,H/2); ctx.rotate(tilt); ctx.translate(-W/2,-H/2);

    // ground
    ctx.fillStyle='#0e1a33'; ctx.fillRect(0,H-8,W,8);

    // clouds
    for(const c of clouds){
      ctx.fillStyle = c.solid? 'rgba(200,200,255,.9)' : 'rgba(200,200,255,.5)';
      roundRect(ctx, c.x, c.y, c.w, c.h, 12, true);
    }

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

    // projectiles
    for(const pr of projectiles){
      ctx.fillStyle = pr.type==='goldenEgg' ? '#ffd700' : '#ff9800';
      ctx.beginPath();
      ctx.arc(pr.x, pr.y, pr.r, 0, Math.PI*2);
      ctx.fill();
    }

    // bird (draw on top)
    ctx.fillStyle = bird.alive ? '#fff200' : '#999';
    ctx.beginPath();
    ctx.arc(bird.x, bird.y, bird.r, 0, Math.PI*2);
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#000';
    ctx.stroke();

    ctx.restore(); // remove tilt transform

    // HUD overlay text
    ctx.font = '18px Rajdhani';
    ctx.fillStyle = '#fff';
    ctx.fillText(`Tokens: ${tokens}`, 12, 24);
    ctx.fillText(`Bet: ${bet}`, 12, 44);
    ctx.fillText(`Mult: ${multiplier.toFixed(2)}×`, 12, 64);
  }

  /* ---------- Drawing helpers ---------- */
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

  /* ---------- HUD update + save ---------- */
  function updateHUD(){
    elTokens.textContent = tokens;
    elMult.textContent = multiplier.toFixed(2) + '×';
    elDist.textContent = Math.floor(distance);
    elClears.textContent = clears;
    elWindBar.style.width = `${Math.round(Math.min(1,wind.strength)*100)}%`;
  }

  function saveTokens(){
    localStorage.setItem('tokens', tokens);
    updateHUD();
  }

  /* ---------- Return public API ---------- */
  return { init, setBet, startGame, cashOut };
})();

/* ---------- Boot ---------- */
window.addEventListener('load', ()=>FF.init());

