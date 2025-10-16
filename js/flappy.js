// Flappy Fiasco — Multiplier Crash Mode
// Bet tokens -> fly -> multiplier rises -> cash out or crash.
// No external assets; pure Canvas + WebAudio. Uses common.js for tokens.

const FF = (() => {
  // ==== Canvas / DOM ====
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;

  const elTokens = document.getElementById('tokens');
  const elBet = document.getElementById('betInput');
  const btnStart = document.getElementById('startBtn');
  const btnCash = document.getElementById('cashBtn');

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

  // ==== Game constants ====
  const GRAVITY = 900;         // px/s^2
  const FLAP_FORCE = -300;     // px/s impulse
  const BASE_SPEED = 120;      // world scroll speed
  const PIPE_GAP = 120;
  const PIPE_INTERVAL = 1.8;   // seconds
  const CLOUD_INTERVAL = 2.7;
  const WIND_SWITCH_MIN = 5, WIND_SWITCH_MAX = 8;
  const WIND_MIN = 0.1, WIND_MAX = 0.6;
  const THROW_MIN = 2, THROW_MAX = 5;

  // Difficulty stages (time-based)
  const DIFF = [
    { t: 0,  wind: 1.0, speed: 1.0, throws: 1.0 },
    { t: 30, wind: 1.0, speed: 1.2, throws: 0.8 },
    { t: 60, wind: 1.2, speed: 1.4, throws: 1.0 },
    { t: 90, wind: 1.6, speed: 1.6, throws: 1.4 }
  ];

  // Multiplier tuning:
  const MULT_START = 1.00;        // set to 0.00 if you truly want 0x
  const MULT_PER_PIPE = 0.05;     // +0.05× per pipe pair cleared
  const MULT_PER_100M = 0.02;     // +0.02× every ~100m distance
  const MULT_GOLDEN = 0.25;       // +0.25× if golden egg caught
  const MULT_PER_SEC = 0.005;     // gentle time-based growth per second (scaled by difficulty)

  // ==== Audio (tiny beeps) ====
  const audio = (() => {
    let ctxA; let muted=false;
    function ensure(){ if(!ctxA) ctxA = new (window.AudioContext||window.webkitAudioContext)(); }
    function beep(freq=440, dur=0.06, type='sine', vol=0.05){
      if(muted) return;
      ensure();
      const o = ctxA.createOscillator(), g = ctxA.createGain();
      o.type=type; o.frequency.value=freq; g.gain.value=vol;
      o.connect(g); g.connect(ctxA.destination);
      o.start(); o.stop(ctxA.currentTime + dur);
    }
    return {
      flap(){ beep(660,.05,'square',.03); },
      ding(){ beep(1046,.08,'triangle',.05); },
      thud(){ beep(180,.12,'sawtooth',.06); },
      cash(){ beep(880,.12,'triangle',.08); },
      wind(){ beep(300,.02,'sine',.01); },
      toggle(){ muted=!muted; },
      muted(){ return muted; }
    };
  })();

  // ==== State ====
  let state = 'IDLE'; // IDLE | RUNNING | OVER
  let elapsed = 0, lastT = 0;

  let bet = 0;
  let multiplier = MULT_START;
  let distance = 0;
  let clears = 0;         // pipes passed
  let distAward = 0;      // track 100m steps for multiplier

  let pipes = [], clouds = [], projectiles = [];
  let pipeTimer = 0, cloudTimer = 0;

  const bird = { x: W*0.25, y: H*0.5, r:14, vy:0, vx:0 };
  const hunter = { x:60, y:H*0.5, throwTimer: randr(THROW_MIN, THROW_MAX) };

  let wind = { dir:'–', strength:0, timer:0, nextIn:0 };

  // ==== Utilities ====
  const clamp=(v,min,max)=>Math.max(min,Math.min(max,v));
  const rand=(a)=>a[Math.floor(Math.random()*a.length)];
  const randr=(a,b)=>a + Math.random()*(b-a);
  const chance=(p)=>Math.random()<p;

  function tierFor(t){ return DIFF.reduce((acc,cur)=> t>=cur.t?cur:acc, DIFF[0]); }

  // ==== Wind ====
  function scheduleWindSwitch(){ wind.nextIn = randr(WIND_SWITCH_MIN, WIND_SWITCH_MAX); }
  function startWindGust(){
    const dirs = ['LEFT','RIGHT','UP'];
    wind.dir = rand(dirs);
    wind.strength = randr(WIND_MIN, WIND_MAX);
    wind.timer = randr(1.5, 3.0);
    updateWindHUD();
    audio.wind();
  }
  function updateWind(dt){
    wind.timer -= dt; wind.nextIn -= dt;
    if (wind.timer <= 0){ wind.strength = 0; document.getElementById('windbar').style.width='0%'; }
    if (wind.nextIn <= 0){ startWindGust(); scheduleWindSwitch(); }
  }
  function updateWindHUD(){
    elWindDir.textContent = wind.dir==='LEFT'?'←': wind.dir==='RIGHT'?'→':'↑';
    document.getElementById('windbar').style.width = `${Math.round(wind.strength*100)}%`;
  }

  // ==== Obstacles & Hunter ====
  function spawnPipe(){
    const gapY = randr(60, H-60);
    const topH = clamp(gapY - PIPE_GAP/2, 30, H-PIPE_GAP-30);
    const botY = gapY + PIPE_GAP/2;
    const botH = clamp(H - botY, 30, H-30);
    const x = W + 40;
    pipes.push({ x, y:0, w:50, h:topH, passed:false, top:true });
    pipes.push({ x, y:H-botH, w:50, h:botH, passed:false, top:false });
  }
  function spawnCloud(){
    clouds.push({
      x: W + 60,
      y: randr(30, H-120),
      w: randr(60,120),
      h: randr(25,45),
      vx: -randr(40, 80),
      solid: chance(0.1)
    });
  }
  function updateHunter(dt, diff){
    hunter.y += (bird.y - hunter.y) * 0.02;
    hunter.throwTimer -= dt;
    if (hunter.throwTimer <= 0){
      throwProjectile();
      hunter.throwTimer = randr(THROW_MIN, THROW_MAX) / diff.throws;
    }
  }
  function throwProjectile(){
    const types = ["boot","hat","pie","goldenEgg"];
    const type = rand(types);
    const speed = randr(140, 220);
    const ang = Math.atan2(bird.y - hunter.y, (bird.x - hunter.x));
    projectiles.push({ x:hunter.x+20, y:hunter.y, r:10, vx:Math.cos(ang)*speed, vy:Math.sin(ang)*speed, type });
  }

  // ==== Input ====
  function flap(){ if(state!=='RUNNING')return; bird.vy = FLAP_FORCE; audio.flap(); }
  canvas.addEventListener('pointerdown', flap);
  window.addEventListener('keydown', e=>{
    if(e.code==='Space'){ e.preventDefault(); flap(); }
    if(e.key.toLowerCase()==='m'){ audio.toggle(); }
  });

  // ==== Round control ====
  function resetRound(){
    elapsed=0; lastT=0;
    multiplier = MULT_START;
    distance=0; clears=0; distAward=0;
    pipes=[]; clouds=[]; projectiles=[];
    pipeTimer=0; cloudTimer=0;
    bird.x=W*0.25; bird.y=H*0.5; bird.vy=0; bird.vx=0;
    hunter.x=60; hunter.y=H*0.5; hunter.throwTimer=randr(THROW_MIN,THROW_MAX);
    startWindGust(); scheduleWindSwitch(); updateWindHUD();
    elMult.textContent = `${multiplier.toFixed(2)}×`;
    elDist.textContent = '0';
    elClears.textContent = '0';
    btnCash.disabled = true;
    overWrap.style.display='none';
  }

  function startGame(){
    // read bet & validate
    const t = getTokens();
    let b = parseInt(elBet.value, 10);
    if(isNaN(b) || b<=0){ alert('Enter a valid bet (>=1).'); return; }
    if(b > t){ alert('Not enough tokens for that bet.'); return; }

    // lock bet and deduct
    bet = b;
    changeTokens(-bet);
    elTokens.textContent = getTokens();

    resetRound();
    state='RUNNING';
    btnCash.disabled=false;

    // start loop
    requestAnimationFrame(ts=>{
      lastT=ts/1000;
      requestAnimationFrame(frame);
    });
  }

  function cashOut(){
    if(state!=='RUNNING') return;
    state='OVER';
    const payout = Math.floor(bet * multiplier);
    changeTokens(payout);
    elTokens.textContent = getTokens();
    audio.cash();
    showOver('Cashed Out!', `Nice timing.`, bet, payout);
  }

  function crash(caption){
    if(state!=='RUNNING') return;
    state='OVER';
    audio.thud();
    showOver('Crash!', caption || 'Bonk! The hunter got you.', bet, 0);
  }

  function showOver(title, caption, betV, payV){
    overTitle.textContent = title;
    overCaption.textContent = caption;
    overBet.textContent = betV;
    overPayout.textContent = payV;
    btnCash.disabled = true;
    overWrap.style.display='flex';
  }

  // expose for HTML
  function setBet(v){
    if(v==='max'){ elBet.value = Math.max(1, getTokens()); }
    else { elBet.value = v; }
  }

  // ==== Update / Draw ====
  function frame(ts){
    const now = ts/1000;
    const dt = Math.min(0.033, now - lastT);
    lastT = now;
    update(dt);
    if(state!=='IDLE') requestAnimationFrame(frame);
  }

  function update(dt){
    if(state!=='RUNNING') return;

    elapsed += dt;
    const diff = tierFor(elapsed);

    // multiplier growth
    multiplier += MULT_PER_SEC * dt * diff.speed;

    // physics
    bird.vy += GRAVITY * dt;
    // wind forces
    if(wind.strength>0){
      if(wind.dir==='UP'){ bird.vy += -GRAVITY * wind.strength * 0.6 * dt; }
      if(wind.dir==='LEFT'){ bird.vx = -60 * wind.strength; }
      if(wind.dir==='RIGHT'){ bird.vx =  60 * wind.strength; }
    } else { bird.vx *= 0.9; }

    // integrate
    bird.y += bird.vy * dt;
    bird.x = clamp(bird.x + bird.vx*dt, 40, W-40);

    // bounds
    if(bird.y + bird.r >= H-8){ crash('Face-planted the runway!'); return; }
    if(bird.y - bird.r <= 0){ bird.y = bird.r; bird.vy = 0; }

    // spawns
    pipeTimer -= dt; cloudTimer -= dt;
    if(pipeTimer<=0){ spawnPipe(); pipeTimer = PIPE_INTERVAL / diff.speed; }
    if(cloudTimer<=0){ spawnCloud(); cloudTimer = CLOUD_INTERVAL / (0.8 + 0.4*diff.speed); }
    updateHunter(dt, diff);
    updateWind(dt);

    // move world
    const speed = BASE_SPEED * diff.speed;
    pipes.forEach(p=> p.x -= speed*dt);
    clouds.forEach(c=> c.x += c.vx*dt);
    projectiles.forEach(p=> { p.x += p.vx*dt; p.y += p.vy*dt; });

    // cleanup
    pipes = pipes.filter(p=> p.x + p.w > -10);
    clouds = clouds.filter(c=> c.x + c.w > -20);
    projectiles = projectiles.filter(p=> p.x<W+40 && p.x>-40 && p.y>-40 && p.y<H+40);

    // scoring → multiplier: pipe clears
    for(let i=0;i<pipes.length;i+=2){
      const top = pipes[i], bot = pipes[i+1];
      if(!top || !bot) continue;
      if(!top.passed && bird.x > (top.x + top.w)){
        top.passed = bot.passed = true;
        clears += 1;
        multiplier += MULT_PER_PIPE;
        audio.ding();
      }
    }

    // distance-based multiplier
    distance += speed*dt*0.25;
    if(Math.floor(distance/100) > distAward){
      const steps = Math.floor(distance/100) - distAward;
      multiplier += MULT_PER_100M * steps;
      distAward += steps;
    }

    // collisions
    if(checkCollisions()) return;

    // update HUD
    elMult.textContent = `${multiplier.toFixed(2)}×`;
    elDist.textContent = Math.floor(distance);
    elClears.textContent = clears;
    elTokens.textContent = getTokens();

    draw();
  }

  // ==== Collisions ====
  function rectHitCircle(rx, ry, rw, rh, cx, cy, cr){
    const nx = clamp(cx, rx, rx+rw);
    const ny = clamp(cy, ry, ry+rh);
    const dx = cx - nx, dy = cy - ny;
    return (dx*dx + dy*dy) <= cr*cr;
  }
  function checkCollisions(){
    // pipes
    for(const p of pipes){
      if(rectHitCircle(p.x,p.y,p.w,p.h,bird.x,bird.y,bird.r)){ crash('Piped and humbled!'); return true; }
    }
    // clouds (some solid)
    for(const c of clouds){
      if(c.solid && rectHitCircle(c.x,c.y,c.w,c.h,bird.x,bird.y,bird.r)){ crash('That cloud turned concrete!'); return true; }
    }
    // projectiles
    for(let i=0;i<projectiles.length;i++){
      const pr = projectiles[i];
      const dx = pr.x - bird.x, dy = pr.y - bird.y, rr = (pr.r+bird.r);
      if(dx*dx + dy*dy <= rr*rr){
        if(pr.type==='goldenEgg'){
          multiplier += MULT_GOLDEN;   // bonus bumps multiplier
          audio.ding();
          projectiles.splice(i,1); i--;
        } else {
          crash('Hunter’s throw landed!');
          return true;
        }
      }
    }
    return false;
  }

  // ==== Draw ====
  function draw(){
    // sky gradient shifts darker over time
    const k = clamp(elapsed/120, 0, 1);
    const top = lerpColor([10,0,24], [2,0,12], k);
    const bot = lerpColor([4,0,18], [1,0,8], k);
    const grd = ctx.createLinearGradient(0,0,0,H);
    grd.addColorStop(0, `rgb(${top.join(',')})`);
    grd.addColorStop(1, `rgb(${bot.join(',')})`);
    ctx.fillStyle = grd; ctx.fillRect(0,0,W,H);

    // gentle tilt on crosswind
    ctx.save();
    const tilt = wind.strength ? (wind.dir==='LEFT'?-1: wind.dir==='RIGHT'?1:0) * 0.05 : 0;
    ctx.translate(W/2,H/2); ctx.rotate(tilt); ctx.translate(-W/2,-H/2);

    // ground
    ctx.fillStyle='#0e1a33'; ctx.fillRect(0,H-8,W,8);

    // clouds
    clouds.forEach(c=>{
      ctx.fillStyle = c.solid? 'rgba(200,200,255,.9)' : 'rgba(200,200,255,.5)';
      roundRect(ctx, c.x, c.y, c.w, c.h, 12, true);
    });

    // pipes
    pipes.forEach(p=>{
      ctx.fillStyle='#5e3dbb';
      roundRect(ctx,p.x,p.y,p.w,p.h,8,true);
      ctx.strokeStyle='#9c27b0'; ctx.strokeRect(p.x+3,p.y+3,p.w-6,p.h-6);
    });

    // projectiles
    projectiles.forEach(drawProjectile);

    // bird
    drawBird();

    ctx.restore();
  }

  function drawBird(){
    ctx.fillStyle='#ffd166';
    ctx.beginPath(); ctx.arc(bird.x,bird.y,bird.r,0,Math.PI*2); ctx.fill();
    ctx.fillStyle='#000'; ctx.beginPath(); ctx.arc(bird.x+5,bird.y-4,3,0,Math.PI*2); ctx.fill();
    ctx.fillStyle='#ff8c42';
    ctx.beginPath(); ctx.moveTo(bird.x+bird.r,bird.y);
    ctx.lineTo(bird.x+bird.r+8,bird.y-3);
    ctx.lineTo(bird.x+bird.r,bird.y+3); ctx.closePath(); ctx.fill();
    const wy = bird.y + Math.sin(elapsed*10 + bird.vy*0.02)*4;
    ctx.fillStyle='#f4a261';
    ctx.beginPath(); ctx.ellipse(bird.x-6, wy, 8,5, 0,0,Math.PI*2); ctx.fill();
  }

  function drawProjectile(p){
    ctx.save(); ctx.translate(p.x,p.y);
    if(p.type==='boot'){ ctx.fillStyle='#4e342e'; roundRect(ctx,-8,-5,16,10,3,true); }
    else if(p.type==='hat'){ ctx.fillStyle='#1a237e'; roundRect(ctx,-9,-3,18,6,3,true); ctx.fillRect(-12,0,24,2); }
    else if(p.type==='pie'){ ctx.fillStyle='#d84315'; roundRect(ctx,-8,-4,16,8,4,true); }
    else if(p.type==='goldenEgg'){ ctx.fillStyle='#ffd700'; ctx.beginPath(); ctx.ellipse(0,0,8,11,0,0,Math.PI*2); ctx.fill(); }
    ctx.restore();
  }

  // drawing helpers
  function roundRect(ctx,x,y,w,h,r,fill){
    ctx.beginPath();
    ctx.moveTo(x+r,y);
    ctx.arcTo(x+w,y,x+w,y+h,r);
    ctx.arcTo(x+w,y+h,x,y+h,r);
    ctx.arcTo(x,y+h,x,y,r);
    ctx.arcTo(x,y,x+w,y,r);
    if(fill) ctx.fill(); else ctx.stroke();
  }
  const lerp=(a,b,t)=>Math.round(a+(b-a)*t);
  const lerpColor=(a,b,t)=>[ lerp(a[0],b[0],t), lerp(a[1],b[1],t), lerp(a[2],b[2],t) ];

  // ==== Public API ====
  function init(){
    elTokens.textContent = getTokens();
  }

  init();

  return {
    startGame,
    cashOut,
    setBet
  };
})();
