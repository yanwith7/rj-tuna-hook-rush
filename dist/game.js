(() => {
  'use strict';

  const C = window.GAME_CONFIG;
  const canvas = document.querySelector('#game');
  const ctx = canvas.getContext('2d');
  const shell = document.querySelector('#game-shell');
  const hud = document.querySelector('#hud');
  const screens = {
    start: document.querySelector('#start-screen'),
    pause: document.querySelector('#pause-screen'),
    result: document.querySelector('#result-screen'),
    settings: document.querySelector('#settings-screen')
  };
  const ui = {
    score: document.querySelector('#score'), coins: document.querySelector('#coins'), combo: document.querySelector('#combo'),
    shields: document.querySelector('#shields'), angleNeedle: document.querySelector('#angle-needle'), angleLabel: document.querySelector('#angle-label'),
    catchCard: document.querySelector('#catch-card'), comboPop: document.querySelector('#combo-pop'), tapPrompt: document.querySelector('#tap-prompt'),
    startHigh: document.querySelector('#start-high-score'), resultTitle: document.querySelector('#result-title'), resultKicker: document.querySelector('#result-kicker'),
    resultScore: document.querySelector('#result-score'), resultFish: document.querySelector('#result-fish'), resultLargest: document.querySelector('#result-largest'),
    resultHigh: document.querySelector('#result-high'), toast: document.querySelector('#toast'),
    voiceToggle: document.querySelector('#voice-toggle'), volume: document.querySelector('#volume-range'), frequency: document.querySelector('#voice-frequency')
  };

  const STORE_KEY = 'rj-tuna-hook-rush-v1';
  const initialProfile = { highScore: 0, coins: 0, settings: { voice: true, volume: 0.8, frequency: 'normal' } };
  let profile = readProfile();
  let rjImage;
  let tunaImage;
  let lastAt = performance.now();
  let pointer = null;
  let toastTimer = 0;

  class Pool {
    constructor(factory, limit = 30) { this.factory = factory; this.free = Array.from({ length: limit }, factory); }
    acquire() { return this.free.pop() || this.factory(); }
    release(value) { Object.keys(value).forEach((key) => { delete value[key]; }); this.free.push(value); }
  }
  const eventPool = new Pool(() => ({}), 10);
  const particlePool = new Pool(() => ({}), 48);

  function freshGame() {
    return {
      mode: 'start', elapsed: 0, speed: C.speedStart, score: 0, coins: 0, combo: 0, caught: 0,
      shields: C.shields, lane: 1, playerX: C.lanes[1], jumpingUntil: 0, slidingUntil: 0, invincibleUntil: 0,
      hook: { mode: 'ready', angle: 0, manualAngle: 0, progress: 0, target: null, stunUntil: 0 },
      events: [], particles: [], nextEventAt: 1.1, nextBigFishAt: random(C.bigFishIntervalMin, C.bigFishIntervalMax),
      reel: null, slowUntil: 0, netTrap: null, flash: 0, shake: 0, cardUntil: 0, comboUntil: 0,
      endingAt: 0, largest: '—', maxFishRank: 0, pendingMessage: '', inputHintUntil: 0
    };
  }
  let game = freshGame();

  class VoiceManager {
    constructor() {
      this.audios = new Map(); this.lastPlayed = new Map(); this.lastSuccessAt = -Infinity; this.active = null; this.activePriority = -1;
      Object.entries(C.voice).forEach(([id, details]) => {
        const audio = new Audio(details.file);
        audio.preload = 'metadata'; audio.addEventListener('ended', () => { if (this.active === audio) { this.active = null; this.activePriority = -1; } });
        this.audios.set(id, audio);
      });
    }
    unlock() {
      this.audios.forEach((audio) => { audio.volume = 0; audio.play().then(() => { audio.pause(); audio.currentTime = 0; audio.volume = profile.settings.volume; }).catch(() => {}); });
    }
    play(id) {
      const config = C.voice[id]; const audio = this.audios.get(id); const now = performance.now() / 1000;
      if (!audio || !profile.settings.voice) return false;
      if (profile.settings.frequency === 'low' && (id === 'SUCCESS' || id === 'SUCCESS_RARE') && Math.random() < 0.55) return false;
      if (this.lastPlayed.get(id) && now - this.lastPlayed.get(id) < config.cooldown) return false;
      if (id === 'SUCCESS' && now - this.lastSuccessAt < C.normalSuccessCooldown) return false;
      if (this.active && this.activePriority > config.priority) return false;
      if (this.active && this.active !== audio) { this.active.pause(); this.active.currentTime = 0; }
      audio.pause(); audio.currentTime = 0; audio.volume = profile.settings.volume;
      this.active = audio; this.activePriority = config.priority; this.lastPlayed.set(id, now);
      if (id === 'SUCCESS') this.lastSuccessAt = now;
      audio.play().catch(() => {});
      return true;
    }
  }
  const voice = new VoiceManager();

  function readProfile() {
    try { return { ...initialProfile, ...JSON.parse(localStorage.getItem(STORE_KEY)), settings: { ...initialProfile.settings, ...JSON.parse(localStorage.getItem(STORE_KEY)).settings } }; }
    catch (_) { return structuredClone(initialProfile); }
  }
  function saveProfile() { localStorage.setItem(STORE_KEY, JSON.stringify(profile)); }
  function random(min, max) { return min + Math.random() * (max - min); }
  function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
  function now() { return game.elapsed; }
  function laneX(index) { return C.lanes[clamp(index, 0, 2)]; }
  function rankOf(fish) { return fish === 'large' ? 3 : fish === 'medium' ? 2 : 1; }

  function setScreen(name, visible) { screens[name].classList.toggle('is-visible', visible); }
  function closeOverlays() { Object.keys(screens).forEach((name) => setScreen(name, false)); }
  function showToast(message) { clearTimeout(toastTimer); ui.toast.textContent = message; ui.toast.classList.add('is-showing'); toastTimer = setTimeout(() => ui.toast.classList.remove('is-showing'), 1900); }
  function setHud(visible) { hud.classList.toggle('is-hidden', !visible); }
  function updatePersistentUi() {
    ui.startHigh.textContent = profile.highScore;
    ui.voiceToggle.checked = profile.settings.voice; ui.volume.value = profile.settings.volume; ui.frequency.value = profile.settings.frequency;
  }
  function updateHud() {
    ui.score.textContent = game.score; ui.coins.textContent = profile.coins + game.coins; ui.combo.textContent = game.combo;
    ui.shields.innerHTML = Array.from({ length: C.shields }, (_, index) => `<span class="shell ${index >= game.shields ? 'is-broken' : ''}">◒</span>`).join('');
    const angle = Math.round(activeHookAngle()); ui.angleNeedle.style.transform = `rotate(${angle}deg)`; ui.angleLabel.textContent = `${angle}°`;
    ui.catchCard.classList.toggle('is-hidden', now() > game.cardUntil || !game.pendingMessage); ui.catchCard.innerHTML = game.pendingMessage;
    ui.comboPop.classList.toggle('is-hidden', now() > game.comboUntil || game.combo < 2); ui.comboPop.textContent = `${game.combo} 连击！`;
    const reel = game.reel || game.netTrap;
    ui.tapPrompt.classList.toggle('is-hidden', !reel);
    if (reel) ui.tapPrompt.textContent = game.reel ? `连点收线 ${game.reel.taps}/${game.reel.required}` : `挣脱渔网 ${game.netTrap.taps}/${game.netTrap.required}`;
  }

  function loadAssets() {
    rjImage = new Image(); tunaImage = new Image();
    rjImage.src = C.assets.rj; tunaImage.src = C.assets.tuna;
  }

  function startGame() {
    voice.unlock();
    game = freshGame(); game.mode = 'playing'; lastAt = performance.now();
    closeOverlays(); setHud(true); updateHud();
  }
  function returnHome() { game = freshGame(); closeOverlays(); setScreen('start', true); setHud(false); updatePersistentUi(); }
  function togglePause() {
    if (game.mode === 'playing') { game.mode = 'paused'; setScreen('pause', true); }
    else if (game.mode === 'paused') { game.mode = 'playing'; setScreen('pause', false); lastAt = performance.now(); }
  }
  function finishGame(gameOver) {
    if (game.mode === 'result') return;
    game.mode = 'result'; profile.coins += game.coins; profile.highScore = Math.max(profile.highScore, game.score); saveProfile();
    ui.resultKicker.textContent = gameOver ? '贝壳全碎' : '满载返航'; ui.resultTitle.textContent = gameOver ? 'Game Over' : '满载返航！';
    ui.resultScore.textContent = game.score; ui.resultFish.textContent = game.caught; ui.resultLargest.textContent = game.largest; ui.resultHigh.textContent = profile.highScore;
    setHud(false); setScreen('result', true); updatePersistentUi();
  }

  function spawnEvent() {
    const fishOnScreen = game.events.filter((event) => event.kind === 'fish').length;
    const obstacleOnScreen = game.events.filter((event) => event.kind === 'obstacle').length;
    let kind = Math.random() < C.fishChance ? 'fish' : 'obstacle';
    if (kind === 'fish' && fishOnScreen >= C.maxFishOnScreen) kind = 'obstacle';
    if (kind === 'obstacle' && obstacleOnScreen >= C.maxObstaclesOnScreen) kind = 'fish';
    const obstacleLanes = new Set(game.events.filter((event) => event.kind === 'obstacle').map((event) => event.lane));
    const fishLanes = new Set(game.events.filter((event) => event.kind === 'fish').map((event) => event.lane));
    // Obstacles are limited to two distinct lanes, guaranteeing a safe route.
    // A fish never shares a lane with a live obstacle, which makes hook reads
    // and dodge choices unambiguous on a phone-sized screen.
    if (kind === 'obstacle' && obstacleLanes.size >= 2) kind = 'fish';
    const viableLanes = [0, 1, 2].filter((lane) => kind === 'fish'
      ? !obstacleLanes.has(lane)
      : !obstacleLanes.has(lane) && !fishLanes.has(lane));
    if (!viableLanes.length) return;
    const lane = viableLanes[Math.floor(Math.random() * viableLanes.length)];
    const event = eventPool.acquire();
    Object.assign(event, { kind, lane, progress: 0, hit: false, captured: false, passed: false, id: `${Date.now()}-${Math.random()}` });
    if (kind === 'fish') {
      let fish = 'small';
      if (game.elapsed >= game.nextBigFishAt) { fish = 'large'; game.nextBigFishAt = game.elapsed + random(C.bigFishIntervalMin, C.bigFishIntervalMax); }
      else if (Math.random() < 0.28) fish = 'medium';
      event.fish = fish; event.leap = random(0, Math.PI * 2);
    } else {
      const types = Object.keys(C.obstacles); event.obstacle = types[Math.floor(Math.random() * types.length)];
    }
    game.events.push(event);
  }
  function releaseEvent(event) { eventPool.release(event); }
  function addParticles(x, y, color, count = 8) {
    for (let index = 0; index < count; index += 1) {
      const particle = particlePool.acquire();
      Object.assign(particle, { x, y, vx: random(-60, 60), vy: random(-80, 16), life: random(.34, .75), max: 0, color, size: random(2, 5) }); particle.max = particle.life;
      game.particles.push(particle);
    }
  }
  function changeLane(delta) { if (game.mode !== 'playing') return; game.lane = clamp(game.lane + delta, 0, 2); }
  function jump() { if (game.mode !== 'playing') return; game.jumpingUntil = game.elapsed + .58; }
  function slide() { if (game.mode !== 'playing') return; game.slidingUntil = game.elapsed + .48; }
  function activeHookAngle() {
    if (game.hook.mode === 'aiming') return game.hook.manualAngle;
    if (game.hook.mode === 'firing' && game.hook.target) return game.hook.target.angle;
    return Math.sin(game.elapsed * 1.75) * C.hookMaxAngle;
  }
  function chooseHookTarget(angleOverride = activeHookAngle()) {
    const candidates = game.events.filter((event) => event.kind === 'fish' && !event.captured && event.progress > .05 && event.progress < .63);
    let best = null;
    for (const event of candidates) {
      const pos = eventPosition(event); const targetAngle = Math.atan2(pos.x - 180, pos.y - 54) * 180 / Math.PI;
      const error = Math.abs(targetAngle - angleOverride);
      if (error <= C.hookHitTolerance && (!best || error < best.error)) best = { event, angle: targetAngle, error };
    }
    return best;
  }
  function fireHook(angleOverride = null) {
    if (game.mode !== 'playing' || game.hook.mode !== 'ready' || game.elapsed < game.hook.stunUntil) return;
    const angle = angleOverride === null ? activeHookAngle() : angleOverride;
    const target = chooseHookTarget(angle);
    game.hook.mode = 'firing'; game.hook.progress = 0; game.hook.target = target || { event: null, angle, error: 99 };
    if (!target) { game.pendingMessage = '<strong>空钩！</strong>找准跃出线再试一次'; game.cardUntil = game.elapsed + .7; }
  }
  function completeCapture(event) {
    const details = C.fish[event.fish]; game.score += details.score; game.coins += details.coins; game.caught += 1; game.combo += 1; game.comboUntil = game.elapsed + 1.05;
    if (rankOf(event.fish) > game.maxFishRank) { game.maxFishRank = rankOf(event.fish); game.largest = `${details.label} · ${details.weight}`; }
    game.pendingMessage = `<strong>${details.rarity} ${details.label}</strong>${details.weight} · +${details.score} 分`;
    game.cardUntil = game.elapsed + 2.1; addParticles(eventPosition(event).x, eventPosition(event).y, event.fish === 'large' ? '#ffcf4d' : '#9fe8db', 13);
    voice.play(event.fish === 'large' ? 'SUCCESS_RARE' : 'SUCCESS');
    if (details.slowSeconds) game.slowUntil = game.elapsed + details.slowSeconds;
    event.captured = true; event.passed = true;
  }
  function hitFish(event) {
    const details = C.fish[event.fish];
    if (details.reelTaps) { game.reel = { event, required: details.reelTaps, taps: 0 }; game.pendingMessage = `<strong>${details.label} 咬钩！</strong>快连点收线`; game.cardUntil = game.elapsed + 99; }
    else completeCapture(event);
  }
  function reelTap() {
    if (game.reel) {
      game.reel.taps += 1; addParticles(180, 100, '#ffd561', 3);
      if (game.reel.taps >= game.reel.required) { const event = game.reel.event; game.reel = null; completeCapture(event); }
      return true;
    }
    if (game.netTrap) {
      game.netTrap.taps += 1; addParticles(game.playerX, 510, '#bde9ff', 3);
      if (game.netTrap.taps >= game.netTrap.required) { game.netTrap = null; game.pendingMessage = '<strong>挣脱成功！</strong>继续向前跑'; game.cardUntil = game.elapsed + 1.2; }
      return true;
    }
    return false;
  }
  function obstacleHit(event) {
    if (game.elapsed < game.invincibleUntil || event.hit) return;
    event.hit = true; game.combo = 0; game.shields -= 1; game.flash = .32; game.shake = .28;
    if (navigator.vibrate) navigator.vibrate([22, 35, 22]);
    const warningId = `WARNING_${4 - game.shields}`; voice.play(warningId); addParticles(game.playerX, 535, '#ff6d69', 18);
    if (event.obstacle === 'jellyfish') game.hook.stunUntil = game.elapsed + C.obstacles.jellyfish.hookStun;
    if (event.obstacle === 'net') game.netTrap = { required: C.obstacles.net.trapTaps, taps: 0 };
    if (game.shields <= 0) { game.mode = 'ending'; game.endingAt = game.elapsed + 2.5; game.pendingMessage = '<strong>最后一枚贝壳碎了…</strong>'; game.cardUntil = game.endingAt; }
    else { game.invincibleUntil = game.elapsed + C.invincibleSeconds; game.pendingMessage = `<strong>警告 ${4 - game.shields}/3</strong>贝壳护盾破裂`; game.cardUntil = game.elapsed + 1.4; }
  }
  function eventPosition(event) {
    const y = 128 + event.progress * 448; const spread = .35 + event.progress * .65;
    return { x: 180 + (laneX(event.lane) - 180) * spread, y };
  }
  function playerIsJumping() { return game.elapsed < game.jumpingUntil; }
  function playerIsSliding() { return game.elapsed < game.slidingUntil; }
  function updateEvents(dt) {
    const travel = dt * (0.095 + game.speed / 110) * (game.elapsed < game.slowUntil || game.netTrap ? .64 : 1);
    for (let index = game.events.length - 1; index >= 0; index -= 1) {
      const event = game.events[index]; event.progress += travel;
      if (event.kind === 'obstacle' && !event.hit && event.progress > .84 && event.progress < .97 && event.lane === game.lane) {
        const avoid = C.obstacles[event.obstacle].avoid; const clear = avoid === 'jump' ? playerIsJumping() : playerIsSliding();
        if (!clear) obstacleHit(event);
      }
      // Tuna leap over the sea only.  They dive back before reaching the sand,
      // while obstacles continue along the beach toward RJ.
      const leavesScreen = event.kind === 'fish' ? event.progress > .72 : event.progress > 1.08;
      if (leavesScreen || event.passed) {
        if (event.kind === 'fish' && !event.captured && leavesScreen) game.combo = 0;
        game.events.splice(index, 1); releaseEvent(event);
      }
    }
  }
  function updateHook(dt) {
    const hook = game.hook;
    if (hook.mode !== 'firing') return;
    hook.progress += dt * 2.9;
    if (hook.progress >= .56 && hook.target?.event && !hook.target.event.hookHit) { hook.target.event.hookHit = true; hitFish(hook.target.event); }
    if (hook.progress >= 1) { hook.mode = 'ready'; hook.progress = 0; hook.target = null; }
  }
  function updateParticles(dt) {
    for (let index = game.particles.length - 1; index >= 0; index -= 1) {
      const p = game.particles[index]; p.life -= dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 110 * dt;
      if (p.life <= 0) { game.particles.splice(index, 1); particlePool.release(p); }
    }
  }
  function update(dt) {
    if (game.mode === 'paused' || game.mode === 'start' || game.mode === 'result') return;
    game.elapsed += dt; game.speed = C.speedStart + (C.speedEnd - C.speedStart) * clamp(game.elapsed / C.speedRampSeconds, 0, 1);
    game.playerX += (laneX(game.lane) - game.playerX) * Math.min(1, dt * 14);
    game.flash = Math.max(0, game.flash - dt); game.shake = Math.max(0, game.shake - dt);
    if (game.mode === 'ending') { if (game.elapsed >= game.endingAt) { voice.play('GAME_OVER'); finishGame(true); } return; }
    if (game.elapsed >= game.nextEventAt) { spawnEvent(); game.nextEventAt = game.elapsed + random(C.eventIntervalMin, C.eventIntervalMax); }
    if (game.elapsed >= C.roundSeconds) { finishGame(false); return; }
    updateEvents(dt); updateHook(dt); updateParticles(dt); updateHud();
  }

  function pxRect(x, y, width, height, color) { ctx.fillStyle = color; ctx.fillRect(Math.round(x), Math.round(y), Math.round(width), Math.round(height)); }
  function drawOcean() {
    const gradient = ctx.createLinearGradient(0, 0, 0, 430); gradient.addColorStop(0, '#0a83dc'); gradient.addColorStop(.55, '#0065ba'); gradient.addColorStop(1, '#054e96'); ctx.fillStyle = gradient; ctx.fillRect(0, 0, 360, 430);
    for (let y = 88; y < 415; y += 42) { for (let x = ((Math.floor(game.elapsed * 18 + y) % 46) - 46); x < 360; x += 46) { pxRect(x, y, 22, 3, '#62c9f0'); pxRect(x + 14, y + 4, 17, 2, '#199fd4'); } }
    ctx.fillStyle = '#e0c07f'; ctx.fillRect(0, 425, 360, 215); ctx.fillStyle = '#f7d58b'; ctx.fillRect(0, 438, 360, 202);
    ctx.strokeStyle = '#e0ae60'; ctx.lineWidth = 2; for (let y = 462; y < 640; y += 38) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(360, y + 20); ctx.stroke(); }
    const horizon = 424; const bottom = 640; ctx.fillStyle = '#d7b16b';
    [0, 1, 2, 3].forEach((line) => { const t = line / 3; const topX = 180 + (line - 1.5) * 10; const bottomX = (line - 1.5) * 115; ctx.beginPath(); ctx.moveTo(topX, horizon); ctx.lineTo(bottomX + 180, bottom); ctx.lineTo(bottomX + 246, bottom); ctx.closePath(); ctx.fill(); });
    ctx.fillStyle = '#f7d58b'; [0, 1, 2].forEach((lane) => { const topX = 180 + (lane - 1) * 12; const bottomX = 180 + (lane - 1) * 100; ctx.beginPath(); ctx.moveTo(topX - 5, horizon); ctx.lineTo(bottomX - 26, bottom); ctx.lineTo(bottomX + 26, bottom); ctx.lineTo(topX + 5, horizon); ctx.closePath(); ctx.fill(); });
  }
  function drawHook() {
    const hook = game.hook; const angle = activeHookAngle() * Math.PI / 180; const length = hook.mode === 'firing' ? 50 + hook.progress * 270 : 65;
    const x = 180 + Math.sin(angle) * length; const y = 47 + Math.cos(angle) * length;
    ctx.strokeStyle = '#ffdc70'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(180, 0); ctx.lineTo(180, 47); ctx.lineTo(x, y); ctx.stroke();
    ctx.save(); ctx.translate(x, y); ctx.rotate(angle); pxRect(-7, -5, 14, 10, '#f7b930'); pxRect(-4, -3, 8, 6, '#fff1a7'); ctx.strokeStyle = '#f8bd35'; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(0, 9, 9, Math.PI * .1, Math.PI * 1.15); ctx.stroke(); ctx.restore();
  }
  function drawFish(event) {
    const pos = eventPosition(event); const details = C.fish[event.fish]; const leap = Math.sin((event.progress * 4.6 + event.leap) * Math.PI) * -42 * (1 - event.progress * .35); const size = (32 + event.progress * 43) * details.scale;
    ctx.save(); ctx.translate(pos.x, pos.y + leap); ctx.rotate(Math.sin(event.progress * 9 + event.leap) * .14); ctx.imageSmoothingEnabled = false;
    // The generated sheet has generous, intentionally uneven spacing.  These
    // source windows isolate one fish each instead of cutting through a tail.
    const source = event.fish === 'small'
      ? { x: 38, y: 176, width: 470, height: 390 }
      : event.fish === 'medium'
        ? { x: 510, y: 135, width: 665, height: 450 }
        : { x: 1130, y: 72, width: 985, height: 555 };
    if (tunaImage?.complete && tunaImage.naturalWidth) ctx.drawImage(tunaImage, source.x, source.y, source.width, source.height, -size * 1.55, -size * .72, size * 3.1, size * 1.44);
    else { pxRect(-size, -size / 2, size * 2, size, '#6ba9d3'); pxRect(size, -size / 3, size / 2, size * .66, '#2d5e9f'); }
    ctx.restore();
  }
  function drawObstacle(event) {
    const pos = eventPosition(event); const scale = .38 + event.progress * .74; ctx.save(); ctx.translate(pos.x, pos.y); ctx.scale(scale, scale);
    if (event.obstacle === 'jellyfish') { pxRect(-17, -6, 34, 22, '#da78dc'); pxRect(-12, -11, 24, 10, '#f0a4e9'); ctx.strokeStyle = '#efb5eb'; ctx.lineWidth = 3; [-10, 0, 10].forEach((x) => { ctx.beginPath(); ctx.moveTo(x, 16); ctx.quadraticCurveTo(x - 5, 31, x + 2, 39); ctx.stroke(); }); }
    if (event.obstacle === 'rock') { ctx.fillStyle = '#536879'; ctx.beginPath(); ctx.moveTo(-24, 19); ctx.lineTo(-12, -18); ctx.lineTo(8, -26); ctx.lineTo(25, 18); ctx.closePath(); ctx.fill(); pxRect(-12, -11, 8, 4, '#92adbe'); }
    if (event.obstacle === 'net') { ctx.strokeStyle = '#d6e9de'; ctx.lineWidth = 3; for (let i = -22; i <= 22; i += 11) { ctx.beginPath(); ctx.moveTo(i, -25); ctx.lineTo(i, 27); ctx.moveTo(-27, i); ctx.lineTo(27, i); ctx.stroke(); } ctx.strokeStyle = '#8caec2'; ctx.strokeRect(-27, -27, 54, 54); }
    ctx.restore();
  }
  function drawPlayer() {
    const jumpProgress = playerIsJumping() ? 1 - (game.jumpingUntil - game.elapsed) / .58 : 0; const jump = playerIsJumping() ? Math.sin(jumpProgress * Math.PI) * 72 : 0; const sliding = playerIsSliding();
    ctx.save(); ctx.translate(game.playerX + (game.shake ? random(-3, 3) : 0), 552 - jump); if (sliding) ctx.scale(1.28, .68); if (game.elapsed < game.invincibleUntil && Math.floor(game.elapsed * 16) % 2) ctx.globalAlpha = .35;
    if (rjImage?.complete && rjImage.naturalWidth) { ctx.imageSmoothingEnabled = false; ctx.drawImage(rjImage, -52, -94, 104, 104); }
    else { ctx.fillStyle = '#fff'; ctx.fillRect(-30, -57, 60, 70); ctx.fillStyle = '#151b28'; ctx.fillRect(-23, -45, 46, 26); }
    ctx.restore();
  }
  function drawParticles() { game.particles.forEach((p) => { ctx.globalAlpha = p.life / p.max; pxRect(p.x, p.y, p.size, p.size, p.color); }); ctx.globalAlpha = 1; }
  function drawFlash() { if (game.flash > 0) { ctx.fillStyle = `rgba(255, 61, 81, ${game.flash * 1.25})`; ctx.fillRect(0, 0, 360, 640); } }
  function drawTime() { if (game.mode === 'playing' || game.mode === 'ending') { const ratio = clamp((C.roundSeconds - game.elapsed) / C.roundSeconds, 0, 1); pxRect(12, 62, 133, 5, '#07386f'); pxRect(12, 62, 133 * ratio, 5, '#ffdc70'); } }
  function draw() {
    ctx.clearRect(0, 0, 360, 640); drawOcean(); drawTime();
    game.events.filter((event) => event.kind === 'fish').forEach(drawFish); game.events.filter((event) => event.kind === 'obstacle').forEach(drawObstacle);
    drawHook(); drawPlayer(); drawParticles(); drawFlash();
  }
  function loop(timestamp) { const dt = Math.min(.05, (timestamp - lastAt) / 1000); lastAt = timestamp; update(dt); draw(); requestAnimationFrame(loop); }

  function canvasPoint(event) { const rect = canvas.getBoundingClientRect(); return { x: (event.clientX - rect.left) * C.designWidth / rect.width, y: (event.clientY - rect.top) * C.designHeight / rect.height }; }
  function pointAngle(point) { return clamp(Math.atan2(point.x - 180, Math.max(20, point.y - 47)) * 180 / Math.PI, C.hookMinAngle, C.hookMaxAngle); }
  function onPointerDown(event) {
    if (event.target !== canvas || game.mode !== 'playing') return;
    const point = canvasPoint(event); pointer = { id: event.pointerId, start: point, point, began: performance.now(), moved: false }; canvas.setPointerCapture?.(event.pointerId);
    if (reelTap()) event.preventDefault();
  }
  function onPointerMove(event) {
    if (!pointer || pointer.id !== event.pointerId || game.mode !== 'playing') return; const point = canvasPoint(event); pointer.point = point;
    const dx = point.x - pointer.start.x; const dy = point.y - pointer.start.y;
    if (Math.hypot(dx, dy) > C.gestureThreshold) { pointer.moved = true; if (Math.abs(dx) > Math.abs(dy)) { changeLane(dx > 0 ? 1 : -1); pointer.start = point; } }
    if (!pointer.moved && performance.now() - pointer.began > 240 && !game.reel && !game.netTrap) { game.hook.mode = 'aiming'; game.hook.manualAngle = pointAngle(point); }
    if (game.hook.mode === 'aiming') game.hook.manualAngle = pointAngle(point);
  }
  function onPointerUp(event) {
    if (!pointer || pointer.id !== event.pointerId) return; const point = canvasPoint(event); const dx = point.x - pointer.start.x; const dy = point.y - pointer.start.y;
    if (pointer.moved) { if (Math.abs(dy) > Math.abs(dx)) { if (dy < -C.gestureThreshold) jump(); if (dy > C.gestureThreshold) slide(); } }
    else if (!game.reel && !game.netTrap) {
      const manualAngle = game.hook.mode === 'aiming' ? game.hook.manualAngle : null;
      if (game.hook.mode === 'aiming') game.hook.mode = 'ready';
      fireHook(manualAngle);
    }
    pointer = null;
  }
  function onKeyDown(event) {
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', ' '].includes(event.key)) event.preventDefault();
    if (event.key === 'Escape') togglePause(); if (game.mode !== 'playing') return;
    if (event.key === 'ArrowLeft') changeLane(-1); if (event.key === 'ArrowRight') changeLane(1); if (event.key === 'ArrowUp') jump(); if (event.key === 'ArrowDown') slide(); if (event.key === ' ' && !reelTap()) fireHook();
  }

  document.querySelector('#start-button').addEventListener('click', startGame);
  document.querySelector('#pause-button').addEventListener('click', togglePause);
  document.querySelector('#resume-button').addEventListener('click', togglePause);
  document.querySelector('#restart-from-pause').addEventListener('click', startGame);
  document.querySelector('#home-from-pause').addEventListener('click', returnHome);
  document.querySelector('#restart-button').addEventListener('click', startGame);
  document.querySelector('#home-from-result').addEventListener('click', returnHome);
  document.querySelector('#open-settings').addEventListener('click', () => setScreen('settings', true));
  document.querySelector('#close-settings').addEventListener('click', () => setScreen('settings', false));
  document.querySelector('#share-button').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(location.href); showToast('链接已复制，发给一起出海的朋友吧！'); }
    catch (_) { window.prompt('复制这个链接分享：', location.href); }
  });
  ui.voiceToggle.addEventListener('change', () => { profile.settings.voice = ui.voiceToggle.checked; saveProfile(); });
  ui.volume.addEventListener('input', () => { profile.settings.volume = Number(ui.volume.value); saveProfile(); });
  ui.frequency.addEventListener('change', () => { profile.settings.frequency = ui.frequency.value; saveProfile(); });
  canvas.addEventListener('pointerdown', onPointerDown); canvas.addEventListener('pointermove', onPointerMove); canvas.addEventListener('pointerup', onPointerUp); canvas.addEventListener('pointercancel', () => { pointer = null; if (game.hook.mode === 'aiming') game.hook.mode = 'ready'; });
  window.addEventListener('keydown', onKeyDown); document.addEventListener('visibilitychange', () => { if (document.hidden && game.mode === 'playing') togglePause(); });

  loadAssets(); updatePersistentUi(); returnHome(); requestAnimationFrame(loop);
})();
