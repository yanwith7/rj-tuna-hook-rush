/*
 * All gameplay numbers and fixed voice event IDs live here.
 * Tune this file without touching the game loop.
 */
window.GAME_CONFIG = Object.freeze({
  title: 'RJ 的黄金鱼汛：Tuna Hook Rush',
  designWidth: 360,
  designHeight: 640,
  roundSeconds: 75,
  speedStart: 8,
  speedEnd: 14,
  speedRampSeconds: 90,
  eventIntervalMin: 1.5,
  eventIntervalMax: 2.5,
  fishChance: 0.60,
  bigFishIntervalMin: 20,
  bigFishIntervalMax: 30,
  maxFishOnScreen: 3,
  maxObstaclesOnScreen: 4,
  shields: 3,
  invincibleSeconds: 1.5,
  hookMinAngle: -55,
  hookMaxAngle: 55,
  hookHitTolerance: 15,
  gestureThreshold: 30,
  tapMaxMs: 200,
  normalSuccessCooldown: 15,
  perVoiceCooldown: 20,
  hudUpdateHz: 12,
  maxParticles: 48,
  lanes: [82, 180, 278],
  playerY: 540,
  assets: {
    rj: 'assets/images/rj-runner.png',
    tuna: 'assets/images/tuna-sprites.png'
  },
  fish: {
    small: { score: 10, coins: 1, reelTaps: 0, weight: '2.4 kg', label: '小金枪鱼', rarity: '普通', scale: 0.44 },
    medium: { score: 50, coins: 4, reelTaps: 3, weight: '8.8 kg', label: '中金枪鱼', rarity: '闪光', scale: 0.56 },
    large: { score: 200, coins: 18, reelTaps: 5, weight: '24.6 kg', label: '大金枪鱼', rarity: '稀有', scale: 0.70, slowSeconds: 2.2 }
  },
  obstacles: {
    jellyfish: { label: '水母', avoid: 'jump', hookStun: 1.5 },
    rock: { label: '礁石', avoid: 'jump' },
    net: { label: '渔网', avoid: 'slide', trapTaps: 3, slowSeconds: 2.8 }
  },
  voice: {
    /* Fixed event IDs: do not rename without also replacing game logic. */
    SUCCESS: { file: 'assets/audio/success.m4a', priority: 20, cooldown: 20 },
    SUCCESS_RARE: { file: 'assets/audio/success.m4a', priority: 40, cooldown: 20 },
    WARNING_1: { file: 'assets/audio/warning.m4a', priority: 60, cooldown: 0 },
    WARNING_2: { file: 'assets/audio/warning.m4a', priority: 70, cooldown: 0 },
    WARNING_3: { file: 'assets/audio/warning.m4a', priority: 90, cooldown: 0 },
    GAME_OVER: { file: 'assets/audio/gameover.m4a', priority: 100, cooldown: 0 }
  }
});
