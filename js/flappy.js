// ============================
// 🐤 FLAPPY FIASCO - MULTIPLIER MODE (FINAL WORKING BUILD)
// ============================

// --- Utility Functions ---
function randr(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
function randf(min, max) {
  return Math.random() * (max - min) + min;
}
function playSound(name) {
  console.log("Play sound:", name); // placeholder
}

// --- Main Game Object ---
window.FF = {
  canvas: null,
  ctx: null,
  running: false,
  bet: 0,
  tokens: 0,
  multiplier: 1.0,
  clears: 0,
  bird: { x: 100, y: 200, vy: 0, alive: true },
  gravity: 0.5,
  flapForce: -7,
  pipes: [],
  distance: 0,
  lastTime: 0,

  // === INIT ===
  init: function () {
    this.canvas = document.getElementById("game");
    this.ctx = this.canvas.getContext("2d");

    window.addEventListener("resize", this.resizeCanvas.bind(this));
    window.addEventListener("mousedown", this.flap.bind(this));
    window.addEventListener("keydown", (e) => {
      if (e.code === "Space") this.flap();
    });

    this.resizeCanvas();

    this.tokens = Number(localStorage.getItem("tokens")) || 100;
    this.updateTokens();
    this.showStartOverlay(true);
    this.updateUI();
  },

  // === Place Bet ===
  placeBet: function (amount) {
    const betInput = document.getElementById("betInput");

    if (amount === "max") {
      this.bet = this.tokens;
      betInput.value = this.tokens;
    } else {
      this.bet = Number(amount);
      betInput.value = amount;
    }
    console.log("Bet set to:", this.bet);
  },

  // === Start Game ===
  startGame: function () {
    const inputBet = Number(document.getElementById("betInput").value);
    this.bet = inputBet > 0 ? inputBet : this.bet;

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
    this.clears = 0;
    this.distance = 0;
    this.pipes = [];
    this.bird.y = this.canvas.height / 2;
    this.bird.vy = 0;
    this.bird.alive = true;
    this.lastTime = performance.now();

    document.getElementById("startBtn").disabled = true;
    document.getElementById("cashBtn").disabled = false;

    this.showStartOverlay(false);
    requestAnimationFrame(this.gameLoop.bind(this));
  },

  // === Game Loop ===
  gameLoop: function (timestamp) {
    if (!this.running) return;

    const delta = (timestamp - this.lastTime) / 16.67;
    this.lastTime = timestamp;

    this.update(delta);
    this.draw();
    this.updateUI();

    requestAnimationFrame(this.gameLoop.bind(this));
  },

  // === Update ===
  update: function (delta) {
    this.bird.vy += this.gravity * delta;
    this.bird.y += this.bird.vy * delta;

    // spawn pipes
    if (Math.floor(this.distance) % 100 === 0) this.spawnPipe();

    // move pipes
    for (let p of this.pipes) p.x -= 3;
    this.pipes = this.pipes.filter((p) => p.x > -80);

    // collision detection
    for (let p of this.pipes) {
      if (
        this.bird.x + 15 > p.x &&
        this.bird.x < p.x + 60 &&
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

    // score logic
    this.distance += delta * 2;
    this.multiplier += 0.001 * delta;
    if (this.distance % 60 === 0) this.clears++;

    // update UI continuously
    this.updateUI();
  },

  // === Draw Everything ===
  draw: function () {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    const gradient = ctx.createLinearGradient(0, 0, 0, this.canvas.height);
    gradient.addColorStop(0, "#150033");
    gradient.addColorStop(1, "#000");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    // bird
    ctx.fillStyle = "#FFD700";
    ctx.beginPath();
    ctx.arc(this.bird.x, this.bird.y, 10, 0, Math.PI * 2);
    ctx.fill();

    // pipes
    ctx.fillStyle = "#00ffcc";
    for (let p of this.pipes) {
      ctx.fillRect(p.x, 0, 60, p.top);
      ctx.fillRect(p.x, p.bottom, 60, this.canvas.height - p.bottom);
    }
  },

  // === Spawn Pipe ===
  spawnPipe: function () {
    const gapY = randr(150, this.canvas.height - 150);
    const gapSize = 120;
    this.pipes.push({
      x: this.canvas.width,
      top: gapY - gapSize / 2,
      bottom: gapY + gapSize / 2,
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
    this.running = false;
    this.bird.alive = false;
    playSound("crash");

    const overlay = document.getElementById("overOverlay");
    overlay.style.display = "flex";
    document.getElementById("overTitle").textContent = "💥 You Crashed!";
    document.getElementById("overCaption").textContent =
      "That pipe had your name on it!";
    document.getElementById("overBet").textContent = this.bet;
    document.getElementById("overPayout").textContent = 0;

    document.getElementById("startBtn").disabled = false;
    document.getElementById("cashBtn").disabled = true;

    this.updateTokens();
  },

  // === Cash Out ===
  cashOut: function () {
    if (!this.running) return;
    const win = Math.floor(this.bet * this.multiplier);
    this.tokens += win;

    playSound("cashout");
    alert("💰 You cashed out with " + win + " tokens!");

    document.getElementById("overTitle").textContent = "🏆 You Cashed Out!";
    document.getElementById("overCaption").textContent =
      "Great timing! You beat the odds.";
    document.getElementById("overBet").textContent = this.bet;
    document.getElementById("overPayout").textContent = win;
    document.getElementById("overOverlay").style.display = "flex";

    this.running = false;
    document.getElementById("startBtn").disabled = false;
    document.getElementById("cashBtn").disabled = true;
    this.updateTokens();
  },

  // === Helpers ===
  resizeCanvas: function () {
    this.canvas.width = Math.min(window.innerWidth * 0.9, 720);
    this.canvas.height = 360;
  },

  updateTokens: function () {
    localStorage.setItem("tokens", this.tokens);
    const el = document.getElementById("tokens");
    if (el) el.textContent = this.tokens;
  },

  updateUI: function () {
    document.getElementById("mult").textContent = this.multiplier.toFixed(2) + "×";
    document.getElementById("dist").textContent = Math.floor(this.distance);
    document.getElementById("clears").textContent = this.clears;
  },

  showStartOverlay: function (show) {
    const s = document.getElementById("startOverlay");
    const o = document.getElementById("overOverlay");
    s.style.display = show ? "flex" : "none";
    o.style.display = "none";
  },
};

// Initialize when page loads
window.addEventListener("load", () => {
  FF.init();
});
