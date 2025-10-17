// ============================
// 🐤 FLAPPY FIASCO - MULTIPLIER MODE
// ============================

// --- Utility Functions (must come first for hoisting) ---
function randr(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
function randf(min, max) {
  return Math.random() * (max - min) + min;
}
function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}
function playSound(name) {
  console.log("Play sound:", name); // placeholder for sound logic
}

// ============================
// 🎮 Main Game Object
// ============================
window.FF = {
  canvas: null,
  ctx: null,
  running: false,
  bet: 0,
  tokens: 0,
  multiplier: 1.0,
  bird: { x: 100, y: 200, vy: 0, alive: true },
  gravity: 0.5,
  flapForce: -7,
  pipes: [],
  distance: 0,
  wind: { dir: 0, strength: 0 },
  hunter: { x: -200, timer: 0 },
  lastTime: 0,

  // === INIT ===
  init: function () {
    this.canvas = document.getElementById("gameCanvas");
    this.ctx = this.canvas.getContext("2d");
    this.resizeCanvas();

    window.addEventListener("resize", this.resizeCanvas.bind(this));
    window.addEventListener("mousedown", this.flap.bind(this));
    window.addEventListener("keydown", e => { if (e.code === "Space") this.flap(); });

    this.tokens = Number(localStorage.getItem("tokens") || 1000);
    this.updateTokens();
    this.renderStartScreen();
  },

  // === Start a New Game ===
  startGame: function () {
    if (this.bet <= 0) {
      alert("Please place a bet first!");
      return;
    }
    if (this.bet > this.tokens) {
      alert("Not enough tokens!");
      return;
    }

    this.tokens -= this.bet;
    this.updateTokens();

    this.running = true;
    this.multiplier = 1.0;
    this.distance = 0;
    this.pipes = [];
    this.bird.y = this.canvas.height / 2;
    this.bird.vy = 0;
    this.bird.alive = true;
    this.lastTime = performance.now();

    requestAnimationFrame(this.gameLoop.bind(this));
  },

  // === Game Loop ===
  gameLoop: function (timestamp) {
    if (!this.running) return;

    const delta = (timestamp - this.lastTime) / 16.67;
    this.lastTime = timestamp;

    this.update(delta);
    this.draw();

    requestAnimationFrame(this.gameLoop.bind(this));
  },

  // === Update ===
  update: function (delta) {
    this.bird.vy += this.gravity * delta;
    this.bird.y += this.bird.vy * delta;

    // spawn pipes
    if (this.distance % 120 === 0) this.spawnPipe();

    // move pipes
    for (let p of this.pipes) p.x -= 3;
    this.pipes = this.pipes.filter(p => p.x > -80);

    // collision check
    for (let p of this.pipes) {
      if (
        this.bird.x + 20 > p.x && this.bird.x < p.x + 60 &&
        (this.bird.y < p.top || this.bird.y > p.bottom)
      ) {
        this.crash();
        return;
      }
    }

    // boundaries
    if (this.bird.y > this.canvas.height || this.bird.y < 0) {
      this.crash();
      return;
    }

    this.distance += delta * 2;
    this.multiplier += 0.001 * delta;
    document.getElementById("multiplier").textContent = this.multiplier.toFixed(2) + "x";
  },

  // === Drawing ===
  draw: function () {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    // background
    const gradient = ctx.createLinearGradient(0, 0, 0, this.canvas.height);
    gradient.addColorStop(0, "#1e0033");
    gradient.addColorStop(1, "#000000");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    // bird
    ctx.fillStyle = "#FFD700";
    ctx.beginPath();
    ctx.arc(this.bird.x, this.bird.y, 12, 0, Math.PI * 2);
    ctx.fill();

    // pipes
    ctx.fillStyle = "#00ffcc";
    for (let p of this.pipes) {
      ctx.fillRect(p.x, 0, 60, p.top);
      ctx.fillRect(p.x, p.bottom, 60, this.canvas.height - p.bottom);
    }

    // HUD
    ctx.fillStyle = "#fff";
    ctx.font = "20px Rajdhani";
    ctx.fillText("Bet: " + this.bet, 10, 25);
    ctx.fillText("Tokens: " + this.tokens, 10, 50);
    ctx.fillText("Multiplier: " + this.multiplier.toFixed(2) + "x", 10, 75);
  },

  // === Spawn Pipe ===
  spawnPipe: function () {
    const gapY = randr(150, this.canvas.height - 150);
    const gapSize = 120;
    this.pipes.push({
      x: this.canvas.width,
      top: gapY - gapSize / 2,
      bottom: gapY + gapSize / 2
    });
  },

  // === Flap ===
  flap: function () {
    if (!this.running || !this.bird.alive) return;
    this.bird.vy = this.flapForce;
    playSound("flap");
  },

  // === Crash ===
  crash: function () {
    playSound("crash");
    this.running = false;
    this.bird.alive = false;
    alert("💥 You crashed! Lost your bet of " + this.bet + " tokens.");
    this.renderStartScreen();
  },

  // === Cash Out ===
  cashOut: function () {
    if (!this.running) return;
    const win = Math.floor(this.bet * this.multiplier);
    this.tokens += win;
    playSound("cashout");
    alert("💰 You cashed out with " + win + " tokens!");
    this.running = false;
    this.renderStartScreen();
    this.updateTokens();
  },

  // === Betting ===
  placeBet: function (amount) {
    this.bet = amount;
    document.getElementById("bet").textContent = amount;
  },

  // === Helpers ===
  resizeCanvas: function () {
    this.canvas.width = window.innerWidth;
    this.canvas.height = window.innerHeight * 0.7;
  },
  updateTokens: function () {
    localStorage.setItem("tokens", this.tokens);
    const el = document.getElementById("tokens");
    if (el) el.textContent = this.tokens;
  },
  renderStartScreen: function () {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.ctx.fillStyle = "#fff";
    this.ctx.font = "30px Rajdhani";
    this.ctx.fillText("Tap START to play Flappy Fiasco!", 100, this.canvas.height / 2);
  }
};

// Initialize when page loads
window.addEventListener("load", () => {
  FF.init();
});
