(() => {
  "use strict";

  const root = document.getElementById("gameRoot");
  const canvas = document.getElementById("gameCanvas");
  const ctx = canvas.getContext("2d");
  const overlay = document.getElementById("overlay");
  const overlayTitle = document.getElementById("overlayTitle");
  const overlayText = document.getElementById("overlayText");
  const status = document.getElementById("status");
  const musicButton = document.getElementById("musicButton");

  const COLS = 25;
  const ROWS = 19;
  const MAG_SIZE = 12;
  const SHOT_DAMAGE = 50;
  const MONSTER_HP = 250;
  const MONSTER_RESPAWN_SECONDS = 4;

  // The monster ALWAYS returns to this same tile.
  const MONSTER_SPAWN = { x: COLS - 1.5, y: 1.5 };
  const EXIT = { x: COLS - 1.5, y: ROWS - 1.5 };

  const keys = new Set();

  let maze = [];
  let bullets = [];
  let particles = [];

  let width = 800;
  let height = 600;
  let dpr = 1;
  let tile = 26;
  let offsetX = 0;
  let offsetY = 0;

  let running = false;
  let gameOver = false;
  let escaped = false;
  let hasKey = false;
  let elapsed = 0;
  let sprintTouch = false;
  let screenShake = 0;
  let lastFrame = performance.now();
  let uiScale = 1;
  let playerHint = 7;
  let lastResizeSignature = "";

  const coarsePointer =
    window.matchMedia && window.matchMedia("(hover: none) and (pointer: coarse)").matches;

  // Floating virtual joystick: touch anywhere on the maze and drag to move.
  const stick = {
    active: false,
    pointerId: null,
    originX: 0,
    originY: 0,
    x: 0,
    y: 0,
    dx: 0,
    dy: 0,
    travel: 0,
    startedAt: 0,
  };

  const STICK_RADIUS = 52;
  const STICK_DEADZONE = 7;

  const player = {
    x: 1.5,
    y: 1.5,
    radius: 0.25,
    speed: 5,
    stamina: 100,
    hp: 100,
    invincible: 0,
    facingX: 1,
    facingY: 0,
    ammo: MAG_SIZE,
    reloading: 0,
    shotCooldown: 0,
  };

  const monster = {
    x: MONSTER_SPAWN.x,
    y: MONSTER_SPAWN.y,
    radius: 0.33,
    speed: 2.7,
    path: [],
    repath: 0,
    animation: 0,
    hp: MONSTER_HP,
    maxHp: MONSTER_HP,
    alive: true,
    stun: 0,
    flash: 0,
    attackCooldown: 0.8,
    attackAnimation: 0,
    respawn: 0,
  };

  const keyItem = {
    x: 0,
    y: 0,
    collected: false,
  };

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const random = (min, max) => min + Math.random() * (max - min);

  // ---------------------------------------------------------------------------
  // Horror music (generated with Web Audio — no external audio file required)
  // ---------------------------------------------------------------------------

  let audioContext = null;
  let masterGain = null;
  let musicEnabled = true;
  let heartbeatTimer = null;
  let stingerTimer = null;

  // Soundtrack file from sound/. If it cannot be played the generated Web Audio
  // score below takes over, so the game always has music.
  const musicTrack = document.getElementById("musicTrack");
  const TRACK_VOLUME_CALM = 0.42;
  const TRACK_VOLUME_DANGER = 0.85;

  let trackFailed = false;
  let proceduralStarted = false;
  let trackVolume = TRACK_VOLUME_CALM;
  let trackGain = null;

  if (musicTrack) {
    musicTrack.volume = TRACK_VOLUME_CALM;

    musicTrack.addEventListener("error", () => {
      trackFailed = true;
      // Fall back to the generated score if the file is missing or unplayable.
      if (musicEnabled) startProceduralScore();
    });
  } else {
    trackFailed = true;
  }

  function trackUsable() {
    return Boolean(musicTrack) && !trackFailed;
  }

  // iOS ignores HTMLMediaElement.volume, so once the Web Audio graph is running
  // the track is routed through a gain node instead. Only done while the context
  // is actually running, otherwise the routing would silence the track.
  function connectTrackToGraph() {
    if (trackGain || !audioContext || audioContext.state !== "running") return;
    if (!audioContext.createMediaElementSource) return;

    try {
      const source = audioContext.createMediaElementSource(musicTrack);

      trackGain = audioContext.createGain();
      trackGain.gain.value = trackVolume;

      source.connect(trackGain);
      trackGain.connect(audioContext.destination);

      musicTrack.volume = 1;
    } catch (error) {
      // Already connected, or unsupported: keep using element volume.
      trackGain = null;
    }
  }

  function playTrack() {
    if (!trackUsable() || !musicEnabled) return;

    connectTrackToGraph();

    const attempt = musicTrack.play();

    // Browsers reject play() outside a user gesture; the next tap retries.
    if (attempt && typeof attempt.catch === "function") {
      attempt.catch(() => {});
    }
  }

  function playTone(frequency, start, duration, volume, type = "sine", detune = 0) {
    if (!audioContext || !masterGain || !musicEnabled) return;

    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();

    oscillator.type = type;
    oscillator.frequency.value = frequency;
    oscillator.detune.value = detune;

    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, volume), start + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);

    oscillator.connect(gain);
    gain.connect(masterGain);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.05);
  }

  function playNoiseHit(volume = 0.03, duration = 0.3) {
    if (!audioContext || !masterGain || !musicEnabled) return;

    const length = Math.floor(audioContext.sampleRate * duration);
    const buffer = audioContext.createBuffer(1, length, audioContext.sampleRate);
    const data = buffer.getChannelData(0);

    for (let i = 0; i < length; i += 1) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / length);
    }

    const source = audioContext.createBufferSource();
    const filter = audioContext.createBiquadFilter();
    const gain = audioContext.createGain();

    source.buffer = buffer;
    filter.type = "bandpass";
    filter.frequency.value = random(250, 900);
    filter.Q.value = 8;
    gain.gain.value = volume;

    source.connect(filter);
    filter.connect(gain);
    gain.connect(masterGain);
    source.start();
  }

  // The Web Audio context also powers the gunshot and monster effects, so it is
  // created whether or not the soundtrack file is used.
  function ensureAudioContext() {
    if (audioContext) return true;

    const AudioContextClass = window.AudioContext || window.webkitAudioContext;

    if (!AudioContextClass) return false;

    audioContext = new AudioContextClass();
    masterGain = audioContext.createGain();
    masterGain.gain.value = 0.11;
    masterGain.connect(audioContext.destination);

    return true;
  }

  function startProceduralScore() {
    if (proceduralStarted || !ensureAudioContext()) return;

    proceduralStarted = true;

    {
      const drones = [
        [36.7, "sawtooth", 0.014, 0],
        [38.9, "triangle", 0.012, -17],
        [55, "sine", 0.009, 9],
      ];

      drones.forEach(([frequency, type, volume, detune]) => {
        const oscillator = audioContext.createOscillator();
        const gain = audioContext.createGain();

        oscillator.type = type;
        oscillator.frequency.value = frequency;
        oscillator.detune.value = detune;
        gain.gain.value = volume;

        oscillator.connect(gain);
        gain.connect(masterGain);
        oscillator.start();
      });

      heartbeatTimer = window.setInterval(() => {
        if (!musicEnabled || !audioContext) return;

        const distance = Math.hypot(player.x - monster.x, player.y - monster.y);
        const danger = monster.alive ? clamp(1 - distance / 12, 0, 1) : 0;
        const now = audioContext.currentTime;

        playTone(46, now, 0.16, 0.07 + 0.08 * danger);
        playTone(41, now + 0.19, 0.22, 0.045 + 0.06 * danger);

        if (danger > 0.55 && Math.random() < 0.4) {
          playNoiseHit(0.016 + 0.02 * danger, 0.2);
        }
      }, 720);

      stingerTimer = window.setInterval(() => {
        if (!musicEnabled || !audioContext) return;

        const notes = [73.4, 77.8, 82.4, 92.5, 98];
        const base = notes[Math.floor(Math.random() * notes.length)];
        const now = audioContext.currentTime;

        playTone(base, now, random(0.8, 1.8), 0.016, "triangle", random(-28, 28));
        playTone(
          base * Math.pow(2, 6 / 12),
          now + 0.05,
          random(0.5, 1.2),
          0.008,
          "sine",
          random(-18, 18),
        );
      }, 2400);
    }

    if (audioContext.state === "suspended") {
      audioContext.resume();
    }

    masterGain.gain.setTargetAtTime(0.11, audioContext.currentTime, 0.1);
  }

  function startHorrorMusic() {
    if (!musicEnabled) return;

    if (!ensureAudioContext()) {
      musicButton.disabled = true;
      musicButton.textContent = "Music unavailable";
      return;
    }

    if (audioContext.state === "suspended") {
      audioContext.resume();
    }

    if (trackUsable()) {
      playTrack();
      return;
    }

    startProceduralScore();
  }

  // The soundtrack leans louder the closer the monster gets.
  function updateMusicIntensity(dt) {
    if (!trackUsable()) return;

    const distance = Math.hypot(player.x - monster.x, player.y - monster.y);
    const danger = monster.alive ? clamp(1 - distance / 12, 0, 1) : 0;
    const target =
      TRACK_VOLUME_CALM + (TRACK_VOLUME_DANGER - TRACK_VOLUME_CALM) * danger;

    trackVolume += (target - trackVolume) * clamp(dt * 1.6, 0, 1);

    const level = clamp(trackVolume, 0, 1);

    if (trackGain) {
      trackGain.gain.value = level;
    } else {
      musicTrack.volume = level;
    }
  }

  function toggleMusic() {
    musicEnabled = !musicEnabled;
    musicButton.textContent = `Music: ${musicEnabled ? "On" : "Off"}`;

    if (musicEnabled) {
      startHorrorMusic();
      return;
    }

    if (trackUsable()) musicTrack.pause();

    if (masterGain && audioContext) {
      masterGain.gain.setTargetAtTime(0, audioContext.currentTime, 0.08);
    }
  }

  // ---------------------------------------------------------------------------
  // Maze generation and pathfinding
  // ---------------------------------------------------------------------------

  function generateMaze() {
    maze = Array.from({ length: ROWS }, () => Array(COLS).fill("#"));

    const stack = [[1, 1]];
    const carvingDirections = [
      [2, 0],
      [-2, 0],
      [0, 2],
      [0, -2],
    ];

    maze[1][1] = ".";

    while (stack.length) {
      const [cx, cy] = stack[stack.length - 1];
      const options = [];

      for (const [dx, dy] of carvingDirections) {
        const nx = cx + dx;
        const ny = cy + dy;

        if (
          nx > 0 &&
          ny > 0 &&
          nx < COLS - 1 &&
          ny < ROWS - 1 &&
          maze[ny][nx] === "#"
        ) {
          options.push([nx, ny, dx, dy]);
        }
      }

      if (!options.length) {
        stack.pop();
        continue;
      }

      const [nx, ny, dx, dy] = options[Math.floor(Math.random() * options.length)];
      maze[cy + dy / 2][cx + dx / 2] = ".";
      maze[ny][nx] = ".";
      stack.push([nx, ny]);
    }

    // Keep player spawn, monster lair, and exit open.
    maze[1][1] = ".";
    maze[1][COLS - 2] = ".";
    maze[ROWS - 2][COLS - 2] = ".";

    placeKey();
  }

  function getDistanceMap() {
    const queue = [[1, 1]];
    const distances = new Map([["1,1", 0]]);
    const directions = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ];

    for (let i = 0; i < queue.length; i += 1) {
      const [x, y] = queue[i];
      const baseDistance = distances.get(`${x},${y}`);

      for (const [dx, dy] of directions) {
        const nx = x + dx;
        const ny = y + dy;
        const key = `${nx},${ny}`;

        if (
          nx < 0 ||
          ny < 0 ||
          nx >= COLS ||
          ny >= ROWS ||
          maze[ny][nx] === "#" ||
          distances.has(key)
        ) {
          continue;
        }

        distances.set(key, baseDistance + 1);
        queue.push([nx, ny]);
      }
    }

    return distances;
  }

  function placeKey() {
    const distances = getDistanceMap();
    let best = [3, 3];
    let bestDistance = -1;

    for (const [cell, distance] of distances.entries()) {
      const [x, y] = cell.split(",").map(Number);

      const isMonsterSpawn = x === COLS - 2 && y === 1;
      const isExit = x === COLS - 2 && y === ROWS - 2;

      if (isMonsterSpawn || isExit) continue;

      if (distance > bestDistance) {
        bestDistance = distance;
        best = [x, y];
      }
    }

    keyItem.x = best[0] + 0.5;
    keyItem.y = best[1] + 0.5;
  }

  function findPath(startX, startY, goalX, goalY) {
    const sx = Math.floor(startX);
    const sy = Math.floor(startY);
    const gx = Math.floor(goalX);
    const gy = Math.floor(goalY);

    const queue = [[sx, sy]];
    const seen = new Set([`${sx},${sy}`]);
    const previous = new Map();

    const directions = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ];

    for (let i = 0; i < queue.length; i += 1) {
      const [x, y] = queue[i];
      if (x === gx && y === gy) break;

      for (const [dx, dy] of directions) {
        const nx = x + dx;
        const ny = y + dy;
        const key = `${nx},${ny}`;

        if (
          nx < 0 ||
          ny < 0 ||
          nx >= COLS ||
          ny >= ROWS ||
          maze[ny][nx] === "#" ||
          seen.has(key)
        ) {
          continue;
        }

        seen.add(key);
        previous.set(key, [x, y]);
        queue.push([nx, ny]);
      }
    }

    if (!seen.has(`${gx},${gy}`)) return [];

    const result = [];
    let current = [gx, gy];

    while (current && (current[0] !== sx || current[1] !== sy)) {
      result.push({
        x: current[0] + 0.5,
        y: current[1] + 0.5,
      });

      current = previous.get(`${current[0]},${current[1]}`);
    }

    return result.reverse();
  }

  // ---------------------------------------------------------------------------
  // Collision / movement
  // ---------------------------------------------------------------------------

  function isWallAt(x, y) {
    const cellX = Math.floor(x);
    const cellY = Math.floor(y);

    return (
      cellX < 0 ||
      cellY < 0 ||
      cellX >= COLS ||
      cellY >= ROWS ||
      maze[cellY][cellX] === "#"
    );
  }

  function canStand(x, y, radius) {
    return (
      !isWallAt(x - radius, y - radius) &&
      !isWallAt(x + radius, y - radius) &&
      !isWallAt(x - radius, y + radius) &&
      !isWallAt(x + radius, y + radius)
    );
  }

  function moveEntity(entity, dx, dy, radius) {
    if (canStand(entity.x + dx, entity.y, radius)) {
      entity.x += dx;
    }

    if (canStand(entity.x, entity.y + dy, radius)) {
      entity.y += dy;
    }
  }

  // ---------------------------------------------------------------------------
  // Game actions
  // ---------------------------------------------------------------------------

  function beginGame() {
    if (gameOver || escaped) return;

    running = true;
    overlay.classList.add("hidden");
    startHorrorMusic();
    root.focus();
  }

  function createBurst(x, y, count, color = "#e8b979") {
    for (let i = 0; i < count; i += 1) {
      particles.push({
        x,
        y,
        vx: random(-2.5, 2.5),
        vy: random(-2.5, 2.5),
        life: random(0.18, 0.42),
        color,
      });
    }
  }

  function respawnMonster() {
    Object.assign(monster, {
      x: MONSTER_SPAWN.x,
      y: MONSTER_SPAWN.y,
      hp: MONSTER_HP,
      alive: true,
      stun: 0,
      flash: 0,
      attackCooldown: 0.8,
      attackAnimation: 0,
      respawn: 0,
      path: [],
      repath: 0,
    });

    status.textContent = "The monster respawned at the same lair with full health.";
  }

  function restartGame() {
    playerHint = 7;
    keys.clear();
    sprintTouch = false;
    stick.active = false;
    stick.pointerId = null;
    stick.dx = 0;
    stick.dy = 0;

    root.querySelectorAll(".held").forEach((element) => {
      element.classList.remove("held");
    });

    generateMaze();

    Object.assign(player, {
      x: 1.5,
      y: 1.5,
      stamina: 100,
      hp: 100,
      invincible: 0,
      facingX: 1,
      facingY: 0,
      ammo: MAG_SIZE,
      reloading: 0,
      shotCooldown: 0,
    });

    Object.assign(monster, {
      x: MONSTER_SPAWN.x,
      y: MONSTER_SPAWN.y,
      path: [],
      repath: 0,
      animation: 0,
      hp: MONSTER_HP,
      alive: true,
      stun: 0,
      flash: 0,
      attackCooldown: 0.8,
      attackAnimation: 0,
      respawn: 0,
    });

    keyItem.collected = false;
    hasKey = false;
    elapsed = 0;
    gameOver = false;
    escaped = false;
    running = true;
    screenShake = 0;
    bullets = [];
    particles = [];

    overlay.classList.add("hidden");
    status.textContent = "Monster HP 250 · Gun damage 50 · Find the key and escape.";

    startHorrorMusic();
    root.focus();
  }

  function reload() {
    if (player.reloading > 0 || player.ammo === MAG_SIZE) return;

    player.reloading = 0.85;
    status.textContent = "Reloading...";
  }

  function shoot() {
    if (gameOver || escaped) {
      restartGame();
      return;
    }

    beginGame();

    if (player.reloading > 0 || player.shotCooldown > 0) return;

    if (player.ammo <= 0) {
      reload();
      return;
    }

    let dx = player.facingX;
    let dy = player.facingY;
    const length = Math.hypot(dx, dy) || 1;

    dx /= length;
    dy /= length;

    player.ammo -= 1;
    player.shotCooldown = 0.18;

    bullets.push({
      x: player.x + dx * 0.38,
      y: player.y + dy * 0.38,
      vx: dx * 11,
      vy: dy * 11,
      life: 1.3,
    });

    screenShake = 2;
  }

  function monsterAttack() {
    if (
      !monster.alive ||
      monster.attackCooldown > 0 ||
      monster.stun > 0 ||
      Math.hypot(player.x - monster.x, player.y - monster.y) > 0.72
    ) {
      return;
    }

    monster.attackCooldown = 1.05;
    monster.attackAnimation = 0.34;

    if (player.invincible <= 0) {
      player.hp = clamp(player.hp - 24, 0, 100);
      player.invincible = 0.7;
      screenShake = 9;

      createBurst(player.x, player.y, 12, "#ff9f96");
      status.textContent = `The monster attacked! Player HP: ${player.hp}`;

      if (audioContext && musicEnabled) {
        const now = audioContext.currentTime;
        playTone(52, now, 0.25, 0.16, "sawtooth");
        playNoiseHit(0.05, 0.24);
      }

      if (player.hp <= 0) {
        gameOver = true;
        running = false;

        overlay.classList.remove("hidden");
        overlayTitle.textContent = "YOU WERE DEFEATED";
        overlayText.textContent = coarsePointer
          ? "Tap Restart to try again."
          : "Press R or Restart to try again.";
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Update
  // ---------------------------------------------------------------------------

  function updateMonster(dt) {
    if (!monster.alive) {
      if (monster.respawn > 0) {
        monster.respawn -= dt;

        if (monster.respawn <= 0) {
          respawnMonster();
        }
      }

      return;
    }

    monster.animation += dt;
    monster.flash = Math.max(0, monster.flash - dt);
    monster.stun = Math.max(0, monster.stun - dt);
    monster.attackCooldown = Math.max(0, monster.attackCooldown - dt);
    monster.attackAnimation = Math.max(0, monster.attackAnimation - dt);

    if (monster.stun > 0) return;

    if (Math.hypot(player.x - monster.x, player.y - monster.y) < 0.72) {
      monsterAttack();
      return;
    }

    monster.repath -= dt;

    if (monster.repath <= 0) {
      monster.repath = 0.2;
      monster.path = findPath(monster.x, monster.y, player.x, player.y);
    }

    if (!monster.path.length) return;

    const target = monster.path[0];
    const dx = target.x - monster.x;
    const dy = target.y - monster.y;
    const distance = Math.hypot(dx, dy);

    if (distance < 0.07) {
      monster.path.shift();
      return;
    }

    const speed =
      monster.speed +
      Math.min(elapsed / 120, 0.4) +
      (hasKey ? 0.18 : 0);

    moveEntity(
      monster,
      (dx / distance) * speed * dt,
      (dy / distance) * speed * dt,
      monster.radius,
    );
  }

  function update(dt) {
    if (!running || gameOver || escaped) return;

    playerHint = Math.max(0, playerHint - dt);

    elapsed += dt;
    player.invincible = Math.max(0, player.invincible - dt);
    player.shotCooldown = Math.max(0, player.shotCooldown - dt);

    if (player.reloading > 0) {
      player.reloading -= dt;

      if (player.reloading <= 0) {
        player.reloading = 0;
        player.ammo = MAG_SIZE;
        status.textContent = "Reloaded.";
      }
    }

    let dx =
      (keys.has("d") || keys.has("arrowright") ? 1 : 0) -
      (keys.has("a") || keys.has("arrowleft") ? 1 : 0);

    let dy =
      (keys.has("s") || keys.has("arrowdown") ? 1 : 0) -
      (keys.has("w") || keys.has("arrowup") ? 1 : 0);

    // Touch joystick takes over when no movement key is held.
    if (!dx && !dy && stick.active) {
      dx = stick.dx;
      dy = stick.dy;
    }

    let throttle = 1;

    if (dx || dy) {
      const length = Math.hypot(dx, dy);
      throttle = clamp(length, 0, 1);
      dx /= length;
      dy /= length;
      player.facingX = dx;
      player.facingY = dy;
    }

    const sprinting =
      (keys.has("shift") || sprintTouch) &&
      player.stamina > 1 &&
      (dx || dy);

    const movementSpeed = player.speed * (sprinting ? 1.72 : 1) * throttle;

    moveEntity(
      player,
      dx * movementSpeed * dt,
      dy * movementSpeed * dt,
      player.radius,
    );

    player.stamina = clamp(
      player.stamina + (sprinting ? -38 : 24) * dt,
      0,
      100,
    );

    updateMonster(dt);

    bullets.forEach((bullet) => {
      if (bullet.life <= 0) return;

      bullet.x += bullet.vx * dt;
      bullet.y += bullet.vy * dt;
      bullet.life -= dt;

      if (isWallAt(bullet.x, bullet.y)) {
        bullet.life = 0;
        return;
      }

      const hitsMonster =
        monster.alive &&
        Math.hypot(bullet.x - monster.x, bullet.y - monster.y) <
          monster.radius + 0.11;

      if (!hitsMonster) return;

      bullet.life = 0;
      monster.hp = clamp(monster.hp - SHOT_DAMAGE, 0, monster.maxHp);
      monster.stun = 0.32;
      monster.flash = 0.15;
      screenShake = 5;

      createBurst(monster.x, monster.y, 10);

      if (monster.hp <= 0) {
        monster.alive = false;
        monster.respawn = MONSTER_RESPAWN_SECONDS;
        monster.path = [];

        status.textContent =
          "Monster down — it respawns at the same lair in 4 seconds.";
      } else {
        status.textContent =
          `Heavy hit! Monster HP: ${monster.hp}/${monster.maxHp}`;
      }
    });

    bullets = bullets.filter((bullet) => bullet.life > 0);

    particles.forEach((particle) => {
      particle.x += particle.vx * dt;
      particle.y += particle.vy * dt;
      particle.life -= dt;
    });

    particles = particles.filter((particle) => particle.life > 0);

    if (
      !keyItem.collected &&
      Math.hypot(player.x - keyItem.x, player.y - keyItem.y) < 0.5
    ) {
      keyItem.collected = true;
      hasKey = true;
      status.textContent = "KEY FOUND — RUN TO THE EXIT!";
    }

    if (Math.hypot(player.x - EXIT.x, player.y - EXIT.y) < 0.5) {
      if (hasKey) {
        escaped = true;
        running = false;

        overlay.classList.remove("hidden");
        overlayTitle.textContent = "YOU ESCAPED";
        overlayText.textContent = `Time ${elapsed.toFixed(1)} seconds · ${
          coarsePointer ? "Tap Restart" : "Press R"
        } to play again.`;
      } else {
        status.textContent = "Exit locked — find the golden key first.";
      }
    }

    screenShake = Math.max(0, screenShake - 28 * dt);
  }

  // ---------------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------------

  // Space the maze may occupy: the panel's width, and whatever vertical room is
  // left once the title, control deck, and status line are accounted for.
  function availableSpace() {
    const panel = canvas.parentElement;
    const shellHeight = root.getBoundingClientRect().height;
    const panelHeight = panel.getBoundingClientRect().height;
    const chrome = Math.max(0, shellHeight - panelHeight);

    const bodyStyle = getComputedStyle(document.body);
    const paddingY =
      parseFloat(bodyStyle.paddingTop) + parseFloat(bodyStyle.paddingBottom);
    const paddingX =
      parseFloat(bodyStyle.paddingLeft) + parseFloat(bodyStyle.paddingRight);

    const view = window.visualViewport;
    const viewportWidth = (view && view.width) || window.innerWidth;
    const viewportHeight = (view && view.height) || window.innerHeight;

    // The viewport bound guards against a panel measurement taken mid-rotation,
    // before the new layout has been applied.
    return {
      width: Math.max(220, Math.min(panel.clientWidth, viewportWidth - paddingX)),
      height: Math.max(160, viewportHeight - chrome - paddingY - 6),
    };
  }

  function hudStripHeight() {
    return Math.max(32, Math.round(48 * uiScale));
  }

  function resizeCanvas() {
    const space = availableSpace();

    dpr = Math.min(window.devicePixelRatio || 1, 2);

    // Fit the board to BOTH axes so the whole maze stays on screen in portrait,
    // in landscape, and on desktop without any page scrolling. The HUD strip is
    // sized from the tile, so one repeat settles the reserved height.
    const tileByWidth = space.width / COLS;
    let reserved = 46;

    for (let pass = 0; pass < 2; pass += 1) {
      const tileByHeight = (space.height - reserved) / ROWS;

      tile = clamp(Math.floor(Math.min(tileByWidth, tileByHeight)), 10, 34);
      uiScale = clamp(tile / 26, 0.5, 1.1);
      reserved = hudStripHeight() + 6;
    }

    offsetX = 0;
    offsetY = hudStripHeight() + 2;
    width = COLS * tile;
    height = ROWS * tile + offsetY;

    // Below roughly 270px wide there is no room even at the smallest tile, so the
    // board is scaled down as a whole rather than letting CSS squash it.
    const displayScale = Math.min(1, space.width / width);
    const displayWidth = Math.round(width * displayScale);
    const displayHeight = Math.round(height * displayScale);

    const signature = `${width}x${height}x${dpr}x${displayWidth}`;
    if (signature === lastResizeSignature) return;
    lastResizeSignature = signature;

    canvas.style.width = `${displayWidth}px`;
    canvas.style.height = `${displayHeight}px`;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function drawMaze() {
    ctx.fillStyle = "#090b0f";
    ctx.fillRect(0, 0, width, height);

    for (let y = 0; y < ROWS; y += 1) {
      for (let x = 0; x < COLS; x += 1) {
        const px = offsetX + x * tile;
        const py = offsetY + y * tile;

        if (maze[y][x] === "#") {
          const gradient = ctx.createLinearGradient(
            px,
            py,
            px + tile,
            py + tile,
          );

          gradient.addColorStop(0, "#3d444d");
          gradient.addColorStop(1, "#20252b");

          ctx.fillStyle = gradient;
          ctx.fillRect(px, py, tile, tile);

          ctx.fillStyle = "rgba(255,255,255,.05)";
          ctx.fillRect(px + 2, py + 2, tile - 4, 2);
        } else {
          ctx.fillStyle = (x + y) % 2 ? "#403a34" : "#463f38";
          ctx.fillRect(px, py, tile, tile);

          ctx.strokeStyle = "rgba(0,0,0,.08)";
          ctx.strokeRect(px + 0.5, py + 0.5, tile - 1, tile - 1);
        }
      }
    }

    const spawnX = offsetX + MONSTER_SPAWN.x * tile;
    const spawnY = offsetY + MONSTER_SPAWN.y * tile;

    ctx.strokeStyle = "#862c39";
    ctx.lineWidth = 2;
    ctx.strokeRect(
      spawnX - tile * 0.38,
      spawnY - tile * 0.38,
      tile * 0.76,
      tile * 0.76,
    );

    ctx.fillStyle = "#c66a76";
    ctx.font = `700 ${Math.max(7, tile * 0.18)}px system-ui`;
    ctx.textAlign = "center";
    ctx.fillText("LAIR", spawnX, spawnY + 3);

    const exitX = offsetX + EXIT.x * tile;
    const exitY = offsetY + EXIT.y * tile;

    ctx.fillStyle = hasKey ? "#3f9b56" : "#273c2d";
    ctx.fillRect(
      exitX - tile * 0.3,
      exitY - tile * 0.4,
      tile * 0.6,
      tile * 0.8,
    );

    ctx.fillStyle = "#ffffff";
    ctx.fillText("EXIT", exitX, exitY + 2);

    if (!keyItem.collected) {
      const keyX = offsetX + keyItem.x * tile;
      const keyY = offsetY + keyItem.y * tile;

      ctx.fillStyle = "#edc64b";
      ctx.beginPath();
      ctx.arc(keyX, keyY, tile * 0.13, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillRect(keyX, keyY - tile * 0.035, tile * 0.3, tile * 0.07);
    }

    ctx.textAlign = "left";
  }

  function drawPlayer() {
    const x = offsetX + player.x * tile;
    const y = offsetY + player.y * tile;

    // "This one is you" ring, shown until the run is underway.
    if (playerHint > 0) {
      const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 160);

      ctx.save();
      ctx.globalAlpha = clamp(playerHint / 2, 0, 1) * (0.32 + 0.38 * pulse);
      ctx.strokeStyle = "#8fd0ff";
      ctx.lineWidth = Math.max(1.5, tile * 0.07);
      ctx.beginPath();
      ctx.arc(x, y, tile * (0.44 + 0.07 * pulse), 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    ctx.save();
    ctx.translate(x, y);

    if (
      player.invincible > 0 &&
      Math.floor(player.invincible * 16) % 2 === 0
    ) {
      ctx.globalAlpha = 0.5;
    }

    // Body
    ctx.fillStyle = "#315f91";
    ctx.fillRect(-tile * 0.13, -tile * 0.12, tile * 0.26, tile * 0.28);

    // Head
    ctx.fillStyle = "#cf9b77";
    ctx.beginPath();
    ctx.arc(0, -tile * 0.21, tile * 0.13, 0, Math.PI * 2);
    ctx.fill();

    // Legs
    ctx.fillStyle = "#20242b";
    ctx.fillRect(-tile * 0.12, tile * 0.12, tile * 0.085, tile * 0.2);
    ctx.fillRect(tile * 0.035, tile * 0.12, tile * 0.085, tile * 0.2);

    // Blaster points in last movement direction.
    ctx.rotate(Math.atan2(player.facingY, player.facingX));
    ctx.fillStyle = "#24272b";
    ctx.fillRect(tile * 0.1, -tile * 0.05, tile * 0.35, tile * 0.1);

    ctx.fillStyle = "#6c7279";
    ctx.fillRect(tile * 0.38, -tile * 0.03, tile * 0.13, tile * 0.06);

    ctx.restore();
  }

  function drawMonster() {
    if (!monster.alive) return;

    const x = offsetX + monster.x * tile;
    const y = offsetY + monster.y * tile;

    const breathing = Math.sin(monster.animation * 5) * tile * 0.025;
    const stride = Math.sin(monster.animation * 10) * tile * 0.09;

    ctx.save();
    ctx.translate(x, y + breathing);

    if (monster.flash > 0) {
      ctx.globalAlpha = 0.5;
    }

    ctx.fillStyle = "rgba(0,0,0,.4)";
    ctx.beginPath();
    ctx.ellipse(
      0,
      tile * 0.3,
      tile * 0.34,
      tile * 0.1,
      0,
      0,
      Math.PI * 2,
    );
    ctx.fill();

    // Legs
    ctx.strokeStyle = "#34292b";
    ctx.lineWidth = Math.max(3, tile * 0.13);
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(-tile * 0.11, tile * 0.08);
    ctx.lineTo(-tile * 0.19, tile * 0.34 + stride);
    ctx.moveTo(tile * 0.11, tile * 0.08);
    ctx.lineTo(tile * 0.19, tile * 0.34 - stride);
    ctx.stroke();

    // Torso
    ctx.fillStyle = "#4b3b40";
    ctx.beginPath();
    ctx.ellipse(
      0,
      -tile * 0.03,
      tile * 0.28,
      tile * 0.37,
      0,
      0,
      Math.PI * 2,
    );
    ctx.fill();

    // Arms / attack pose
    ctx.strokeStyle = "#463338";
    ctx.lineWidth = Math.max(3, tile * 0.12);
    ctx.beginPath();

    if (monster.attackAnimation > 0) {
      ctx.moveTo(-tile * 0.2, -tile * 0.12);
      ctx.lineTo(-tile * 0.55, -tile * 0.04);
      ctx.moveTo(tile * 0.2, -tile * 0.12);
      ctx.lineTo(tile * 0.62, -tile * 0.13);
    } else {
      ctx.moveTo(-tile * 0.2, -tile * 0.12);
      ctx.lineTo(-tile * 0.42, tile * 0.07 - stride);
      ctx.moveTo(tile * 0.2, -tile * 0.12);
      ctx.lineTo(tile * 0.42, tile * 0.07 + stride);
    }

    ctx.stroke();

    // Head
    ctx.fillStyle = "#3c3034";
    ctx.beginPath();
    ctx.ellipse(
      0,
      -tile * 0.45,
      tile * 0.21,
      tile * 0.23,
      0,
      0,
      Math.PI * 2,
    );
    ctx.fill();

    // Eyes
    ctx.fillStyle = "#efe574";
    ctx.beginPath();
    ctx.arc(-tile * 0.075, -tile * 0.49, tile * 0.04, 0, Math.PI * 2);
    ctx.fill();

    ctx.beginPath();
    ctx.arc(tile * 0.075, -tile * 0.49, tile * 0.04, 0, Math.PI * 2);
    ctx.fill();

    // Mouth
    ctx.fillStyle = "#130a0d";
    ctx.beginPath();
    ctx.ellipse(
      0,
      -tile * 0.35,
      tile * 0.13,
      tile * 0.085,
      0,
      0,
      Math.PI * 2,
    );
    ctx.fill();

    // Teeth
    ctx.fillStyle = "#eee1da";

    for (let i = -2; i <= 2; i += 1) {
      ctx.beginPath();
      ctx.moveTo(i * tile * 0.035 - tile * 0.018, -tile * 0.39);
      ctx.lineTo(i * tile * 0.035, -tile * 0.3);
      ctx.lineTo(i * tile * 0.035 + tile * 0.018, -tile * 0.39);
      ctx.fill();
    }

    ctx.restore();
  }

  function drawBar(x, y, widthValue, value, color, barHeight = 8) {
    ctx.fillStyle = "rgba(255,255,255,.14)";
    ctx.fillRect(x, y, widthValue, barHeight);

    ctx.fillStyle = color;
    ctx.fillRect(x, y, widthValue * clamp(value, 0, 1), barHeight);
  }

  function drawHud() {
    const s = uiScale;
    const strip = hudStripHeight();
    const font = Math.max(9, Math.round(10.5 * s));
    const barHeight = Math.max(5, Math.round(7 * s));
    const left = Math.round(7 * s);
    const right = width - Math.round(7 * s);
    const gap = Math.round(6 * s) + 2;
    const row1 = Math.round(strip * 0.33);
    const row2 = Math.round(strip * 0.74);

    ctx.fillStyle = "#06090e";
    ctx.fillRect(0, 0, width, strip);

    ctx.fillStyle = "rgba(255,255,255,.10)";
    ctx.fillRect(0, strip - 1, width, 1);

    ctx.font = `700 ${font}px system-ui`;
    ctx.textBaseline = "middle";

    const monsterText = monster.alive
      ? `${monster.hp}/${monster.maxHp}`
      : `${Math.max(0, monster.respawn).toFixed(1)}s`;
    const keyText = hasKey ? "KEY ✓" : "FIND KEY";

    // Measure the readouts first, then give the bars whatever room is left, so
    // nothing overlaps on a narrow board.
    const monsterTextWidth = ctx.measureText(monsterText).width;
    const keyTextWidth = ctx.measureText(keyText).width;
    const labelWidth =
      Math.max(ctx.measureText("HP").width, ctx.measureText("STA").width) + gap;
    const barsStart = left + labelWidth;
    const monsterBarRight = right - monsterTextWidth - gap;
    const barWidth = clamp(
      Math.floor((monsterBarRight - barsStart - gap) / 2),
      30,
      150,
    );

    ctx.textAlign = "left";
    ctx.fillStyle = "#fff";

    ctx.fillText("HP", left, row1);
    drawBar(
      barsStart,
      row1 - barHeight / 2,
      barWidth,
      player.hp / 100,
      "#6fcf83",
      barHeight,
    );

    ctx.fillText("STA", left, row2);
    drawBar(
      barsStart,
      row2 - barHeight / 2,
      barWidth,
      player.stamina / 100,
      "#82bee7",
      barHeight,
    );

    const ammoX = barsStart + barWidth + gap;
    const ammoRoom = right - keyTextWidth - gap - ammoX;
    const ammoFull =
      player.reloading > 0
        ? "RELOADING"
        : `AMMO ${player.ammo}/${MAG_SIZE}`;
    const ammoShort =
      player.reloading > 0 ? "RLD" : `${player.ammo}/${MAG_SIZE}`;

    ctx.fillText(
      ctx.measureText(ammoFull).width <= ammoRoom ? ammoFull : ammoShort,
      ammoX,
      row2,
    );

    drawBar(
      monsterBarRight - barWidth,
      row1 - barHeight / 2,
      barWidth,
      monster.alive
        ? monster.hp / monster.maxHp
        : monster.respawn / MONSTER_RESPAWN_SECONDS,
      monster.alive ? "#b9434e" : "#b98049",
      barHeight,
    );

    ctx.textAlign = "right";
    ctx.fillText(monsterText, right, row1);

    ctx.fillStyle = hasKey ? "#e8c979" : "#fff";
    ctx.fillText(keyText, right, row2);

    ctx.textBaseline = "alphabetic";
    ctx.textAlign = "left";
  }

  // On-screen thumb stick, drawn where the finger actually landed.
  function drawTouchStick() {
    if (!stick.active) return;

    const knobX = stick.originX + stick.dx * STICK_RADIUS;
    const knobY = stick.originY + stick.dy * STICK_RADIUS;

    ctx.save();
    ctx.globalAlpha = 0.5;

    ctx.lineWidth = 2;
    ctx.strokeStyle = "#9fb8dd";
    ctx.beginPath();
    ctx.arc(stick.originX, stick.originY, STICK_RADIUS, 0, Math.PI * 2);
    ctx.stroke();

    ctx.globalAlpha = 0.75;
    ctx.fillStyle = "#cfe0f7";
    ctx.beginPath();
    ctx.arc(knobX, knobY, Math.max(12, STICK_RADIUS * 0.34), 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  function draw() {
    const shakeX = screenShake ? random(-screenShake, screenShake) : 0;
    const shakeY = screenShake ? random(-screenShake, screenShake) : 0;

    ctx.save();
    ctx.translate(shakeX, shakeY);

    drawMaze();

    bullets.forEach((bullet) => {
      ctx.fillStyle = "#ffd36b";
      ctx.beginPath();
      ctx.arc(
        offsetX + bullet.x * tile,
        offsetY + bullet.y * tile,
        Math.max(2, tile * 0.075),
        0,
        Math.PI * 2,
      );
      ctx.fill();
    });

    particles.forEach((particle) => {
      ctx.globalAlpha = clamp(particle.life * 4, 0, 1);
      ctx.fillStyle = particle.color;
      ctx.fillRect(
        offsetX + particle.x * tile,
        offsetY + particle.y * tile,
        3,
        3,
      );
      ctx.globalAlpha = 1;
    });

    drawPlayer();
    drawMonster();
    drawHud();

    ctx.restore();

    // Outside the shake transform so the stick stays under the thumb.
    drawTouchStick();
  }

  function frame(now) {
    const dt = Math.min(0.033, (now - lastFrame) / 1000);
    lastFrame = now;

    update(dt);
    updateMusicIntensity(dt);
    draw();

    requestAnimationFrame(frame);
  }

  // ---------------------------------------------------------------------------
  // Input
  // ---------------------------------------------------------------------------

  root.addEventListener("pointerdown", () => {
    root.focus();
    beginGame();
  });

  window.addEventListener("keydown", (event) => {
    if (event.target instanceof Element && event.target.matches("input,textarea,select")) {
      return;
    }

    const key = event.key.toLowerCase();
    const handled = [
      "w",
      "a",
      "s",
      "d",
      "arrowup",
      "arrowdown",
      "arrowleft",
      "arrowright",
      "shift",
      "j",
      "e",
      "r",
    ];

    if (handled.includes(key)) {
      event.preventDefault();
    }

    if (key === "r") {
      restartGame();
      return;
    }

    if (key === "j") shoot();
    if (key === "e") reload();

    keys.add(key);
    beginGame();
  });

  window.addEventListener("keyup", (event) => {
    keys.delete(event.key.toLowerCase());
  });

  window.addEventListener("blur", () => {
    keys.clear();
    sprintTouch = false;
  });

  function bindHoldButton(button, key) {
    const press = (event) => {
      event.preventDefault();
      // Capture so a finger sliding slightly off the pad keeps moving.
      if (button.setPointerCapture) {
        try {
          button.setPointerCapture(event.pointerId);
        } catch (error) {
          /* capture is best-effort */
        }
      }
      button.classList.add("held");
      keys.add(key);
      beginGame();
    };

    const release = () => {
      button.classList.remove("held");
      keys.delete(key);
    };

    button.addEventListener("pointerdown", press);
    button.addEventListener("pointerup", release);
    button.addEventListener("pointercancel", release);
    button.addEventListener("lostpointercapture", release);
    button.addEventListener("contextmenu", (event) => event.preventDefault());
  }

  root.querySelectorAll("[data-hold]").forEach((button) => {
    bindHoldButton(button, button.dataset.hold);
  });

  document.getElementById("shootButton").addEventListener("click", shoot);
  document.getElementById("reloadButton").addEventListener("click", reload);
  document.getElementById("restartButton").addEventListener("click", restartGame);
  musicButton.addEventListener("click", toggleMusic);

  const sprintButton = document.getElementById("sprintButton");

  sprintButton.addEventListener("pointerdown", (event) => {
    event.preventDefault();

    if (sprintButton.setPointerCapture) {
      try {
        sprintButton.setPointerCapture(event.pointerId);
      } catch (error) {
        /* capture is best-effort */
      }
    }

    sprintButton.classList.add("held");
    sprintTouch = true;
    beginGame();
  });

  const stopSprint = () => {
    sprintButton.classList.remove("held");
    sprintTouch = false;
  };

  sprintButton.addEventListener("pointerup", stopSprint);
  sprintButton.addEventListener("pointercancel", stopSprint);
  sprintButton.addEventListener("lostpointercapture", stopSprint);

  // ---------------------------------------------------------------------------
  // Touch: drag anywhere on the maze to move, tap to shoot
  // ---------------------------------------------------------------------------

  function canvasPoint(event) {
    const rect = canvas.getBoundingClientRect();

    return {
      x: ((event.clientX - rect.left) / rect.width) * width,
      y: ((event.clientY - rect.top) / rect.height) * height,
    };
  }

  function updateStick(point) {
    const rawX = point.x - stick.originX;
    const rawY = point.y - stick.originY;
    const distance = Math.hypot(rawX, rawY);

    stick.travel = Math.max(stick.travel, distance);

    if (distance <= STICK_DEADZONE) {
      stick.dx = 0;
      stick.dy = 0;
      return;
    }

    const magnitude = Math.min(1, distance / STICK_RADIUS);

    stick.dx = (rawX / distance) * magnitude;
    stick.dy = (rawY / distance) * magnitude;
  }

  function endStick() {
    stick.active = false;
    stick.pointerId = null;
    stick.dx = 0;
    stick.dy = 0;
  }

  canvas.addEventListener("pointerdown", (event) => {
    // Mouse play stays keyboard-driven; the stick is for touch and pen.
    if (event.pointerType === "mouse") return;

    event.preventDefault();

    const point = canvasPoint(event);

    stick.active = true;
    stick.pointerId = event.pointerId;
    stick.originX = point.x;
    stick.originY = point.y;
    stick.dx = 0;
    stick.dy = 0;
    stick.travel = 0;
    stick.startedAt = performance.now();

    if (canvas.setPointerCapture) {
      try {
        canvas.setPointerCapture(event.pointerId);
      } catch (error) {
        /* capture is best-effort */
      }
    }

    beginGame();
  });

  canvas.addEventListener("pointermove", (event) => {
    if (!stick.active || event.pointerId !== stick.pointerId) return;

    event.preventDefault();
    updateStick(canvasPoint(event));
  });

  const finishStick = (event) => {
    if (!stick.active || event.pointerId !== stick.pointerId) return;

    const quick = performance.now() - stick.startedAt < 260;
    const stationary = stick.travel < 14;

    endStick();

    // A quick tap that never really moved is a shot.
    if (event.type === "pointerup" && quick && stationary) shoot();
  };

  canvas.addEventListener("pointerup", finishStick);
  canvas.addEventListener("pointercancel", finishStick);
  canvas.addEventListener("lostpointercapture", finishStick);
  canvas.addEventListener("contextmenu", (event) => event.preventDefault());

  // ---------------------------------------------------------------------------
  // Fullscreen (hidden where the browser has no Fullscreen API, e.g. iPhone)
  // ---------------------------------------------------------------------------

  const fullscreenButton = document.getElementById("fullscreenButton");

  if (!document.documentElement.requestFullscreen) {
    fullscreenButton.hidden = true;
  } else {
    fullscreenButton.addEventListener("click", () => {
      if (document.fullscreenElement) {
        document.exitFullscreen();
      } else {
        document.documentElement.requestFullscreen().catch(() => {
          fullscreenButton.hidden = true;
        });
      }
    });

    document.addEventListener("fullscreenchange", () => {
      fullscreenButton.textContent = document.fullscreenElement
        ? "Exit Fullscreen"
        : "Fullscreen";
      resizeCanvas();
    });
  }

  // Backgrounding a tab or app should never leave a key or the stick stuck on.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") {
      keys.clear();
      sprintTouch = false;
      endStick();
      root.querySelectorAll(".held").forEach((element) => {
        element.classList.remove("held");
      });

      if (trackUsable()) musicTrack.pause();
      return;
    }

    // Mobile browsers suspend audio when the tab or app is backgrounded.
    if (audioContext && musicEnabled && audioContext.state === "suspended") {
      audioContext.resume().catch(() => {});
    }

    if (running && musicEnabled) playTrack();
  });

  // ---------------------------------------------------------------------------
  // Boot
  // ---------------------------------------------------------------------------

  overlayText.textContent = coarsePointer
    ? "You are the figure in the blue ring. Drag the maze to move · tap to shoot."
    : "You are the figure in the blue ring. Press WASD or the arrow keys to move.";

  generateMaze();
  resizeCanvas();

  // Re-fit on rotation, browser-chrome changes, and window resizes. The first
  // pass runs immediately; the second re-measures once the new layout has
  // settled, which rotation needs. resizeCanvas writes nothing when the
  // computed size is unchanged, so this settles instead of looping.
  const refit = () => {
    resizeCanvas();
    requestAnimationFrame(resizeCanvas);
  };

  window.addEventListener("resize", refit);
  window.addEventListener("orientationchange", () => setTimeout(refit, 120));

  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", refit);
  }

  new ResizeObserver(refit).observe(document.body);

  requestAnimationFrame(frame);
})();
