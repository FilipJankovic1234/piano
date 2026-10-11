export const STANDALONE_HTML_SOURCE = `<!DOCTYPE html>
<html lang="sr" class="dark">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>AetherKeys — Kinelački Virtuelni Klavir (C3–C6)</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600&family=Plus+Jakarta+Sans:wght@400;500;600;700&family=Syne:wght@600;700&display=swap" rel="stylesheet" />
  <script src="https://cdn.jsdelivr.net/npm/@mediapipe/hands/hands.js" crossorigin="anonymous"></script>
  <style>
    :root {
      --bg-obsidian: #05070B;
      --border-hairline: rgba(148, 163, 184, 0.2);
      --accent-cyan: #06B6D4;
      --accent-amber: #F59E0B;
      --accent-emerald: #10B981;
      --text-primary: #F8FAFC;
      --text-muted: #94A3B8;
      --font-display: 'Syne', sans-serif;
      --font-sans: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, sans-serif;
      --font-mono: 'JetBrains Mono', monospace;
    }

    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
      user-select: none;
      -webkit-user-select: none;
    }

    html, body {
      width: 100vw;
      height: 100vh;
      overflow: hidden;
      background-color: var(--bg-obsidian);
      color: var(--text-primary);
      font-family: var(--font-sans);
    }

    /* Fullscreen Viewport Stage */
    .app-viewport {
      position: relative;
      width: 100vw;
      height: 100vh;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      overflow: hidden;
    }

    /* Clear, Unobstructed Mirrored Camera Feed (Full Viewport Behind Bottom Keyboard) */
    video#webcam {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      object-fit: cover;
      transform: scaleX(-1);
      z-index: 1;
      opacity: 0;
      transition: opacity 400ms ease;
    }

    video#webcam.active {
      opacity: 1;
    }

    /* Subtle protective gradient only at the very top bar and bottom keyboard edge */
    .camera-vignette {
      position: absolute;
      inset: 0;
      background: linear-gradient(
        180deg,
        rgba(5, 7, 11, 0.65) 0%,
        rgba(5, 7, 11, 0.0) 12%,
        rgba(5, 7, 11, 0.0) 68%,
        rgba(5, 7, 11, 0.85) 100%
      );
      pointer-events: none;
      z-index: 2;
    }

    /* Real-time Hand Kinematics & Aura Canvas */
    canvas#cv-overlay {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      pointer-events: none;
      z-index: 25;
    }

    /* Compact Top Bar (Leaves Top 72% Camera Field Completely Clear) */
    header.topbar {
      position: relative;
      z-index: 30;
      height: 54px;
      padding: 0 24px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      background: rgba(5, 7, 11, 0.72);
      backdrop-filter: blur(12px);
      border-bottom: 1px solid var(--border-hairline);
    }

    .brand-title {
      font-family: var(--font-display);
      font-size: 1.15rem;
      font-weight: 700;
      letter-spacing: -0.02em;
      color: var(--text-primary);
      text-decoration: none;
    }

    .telemetry-strip {
      display: flex;
      align-items: center;
      gap: 16px;
      font-family: var(--font-mono);
      font-variant-numeric: tabular-nums;
      font-size: 0.75rem;
      color: #E2E8F0;
    }

    @media (max-width: 900px) {
      .telemetry-strip {
        display: none;
      }
    }

    .status-dot {
      display: inline-block;
      width: 8px;
      height: 8px;
      border-radius: 50%;
      margin-right: 6px;
      background: #64748B;
    }

    .status-dot.online {
      background: var(--accent-emerald);
      box-shadow: 0 0 10px var(--accent-emerald);
    }

    .top-actions {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .control-inline {
      display: flex;
      align-items: center;
      gap: 8px;
      font-family: var(--font-mono);
      font-size: 0.74rem;
      color: var(--text-muted);
    }

    .control-inline input[type="range"] {
      width: 80px;
      accent-color: var(--accent-cyan);
      cursor: pointer;
    }

    .select-compact {
      background: rgba(15, 23, 42, 0.85);
      color: var(--text-primary);
      border: 1px solid var(--border-hairline);
      border-radius: 6px;
      padding: 5px 10px;
      font-family: var(--font-sans);
      font-size: 0.75rem;
      font-weight: 600;
      cursor: pointer;
    }

    .btn-primary {
      background: var(--accent-cyan);
      color: #041016;
      font-family: var(--font-sans);
      font-weight: 700;
      font-size: 0.8rem;
      padding: 8px 16px;
      border-radius: 8px;
      border: none;
      cursor: pointer;
      white-space: nowrap;
      transition: transform 120ms ease, opacity 120ms ease, background-color 150ms ease;
    }

    .btn-primary:hover {
      opacity: 0.92;
      transform: translateY(-1px);
    }

    .btn-primary.active-cam {
      background: #F43F5E;
      color: #FFFFFF;
    }

    /* Center Prompt (Hidden as soon as Camera starts so upper 70-75% is 100% clear) */
    .start-prompt {
      position: relative;
      z-index: 20;
      margin: auto;
      max-width: 460px;
      padding: 24px 28px;
      border-radius: 16px;
      background: rgba(11, 14, 23, 0.86);
      backdrop-filter: blur(16px);
      border: 1px solid var(--border-hairline);
      text-align: center;
      display: flex;
      flex-direction: column;
      gap: 12px;
      transition: opacity 250ms ease;
    }

    .start-prompt.hidden {
      opacity: 0;
      pointer-events: none;
    }

    .start-prompt h2 {
      font-family: var(--font-display);
      font-size: 1.15rem;
      color: var(--text-primary);
    }

    .start-prompt p {
      font-size: 0.8rem;
      color: var(--text-muted);
      line-height: 1.5;
    }

    /* BOTTOM PIANO KEYBOARD: Strictly Bottom 28% of Viewport Height */
    section.piano-dock {
      position: relative;
      z-index: 15;
      width: 100%;
      height: 28vh;
      min-height: 195px;
      max-height: 290px;
      background: rgba(7, 9, 14, 0.76);
      backdrop-filter: blur(14px);
      border-top: 1px solid rgba(255, 255, 255, 0.18);
      padding: 8px 14px 12px 14px;
      display: flex;
      flex-direction: column;
      gap: 6px;
      box-shadow: 0 -16px 48px rgba(0, 0, 0, 0.75);
    }

    .piano-header-strip {
      display: flex;
      align-items: center;
      justify-content: space-between;
      font-family: var(--font-mono);
      font-variant-numeric: tabular-nums;
      font-size: 0.7rem;
      color: var(--text-muted);
      padding: 0 4px;
    }

    .piano-keys-stage {
      position: relative;
      flex: 1;
      width: 100%;
      display: flex;
    }

    .white-key {
      flex: 1;
      height: 100%;
      margin: 0 1px;
      background: linear-gradient(180deg, rgba(255, 255, 255, 0.92) 0%, rgba(226, 232, 240, 0.84) 100%);
      border: 1px solid rgba(255, 255, 255, 0.45);
      border-radius: 0 0 8px 8px;
      display: flex;
      flex-direction: column;
      justify-content: flex-end;
      align-items: center;
      padding-bottom: 10px;
      cursor: pointer;
      position: relative;
      z-index: 5;
      transition: transform 55ms cubic-bezier(0.16, 1, 0.3, 1), background 55ms ease, box-shadow 55ms ease;
    }

    .white-key.hovered {
      background: linear-gradient(180deg, rgba(236, 254, 255, 0.96) 0%, rgba(165, 243, 252, 0.88) 100%);
      border-color: rgba(6, 182, 212, 0.75);
    }

    .white-key.active {
      transform: translateY(6px);
      background: linear-gradient(180deg, #67E8F9 0%, #06B6D4 100%);
      box-shadow: 0 0 32px rgba(6, 182, 212, 0.85), inset 0 0 12px rgba(255, 255, 255, 0.65);
      border-color: #ECFEFF;
    }

    .black-key {
      position: absolute;
      top: 0;
      height: 60%;
      background: linear-gradient(180deg, rgba(15, 23, 42, 0.96) 0%, rgba(2, 6, 23, 0.99) 100%);
      border: 1px solid rgba(148, 163, 184, 0.38);
      border-radius: 0 0 6px 6px;
      z-index: 12;
      display: flex;
      flex-direction: column;
      justify-content: flex-end;
      align-items: center;
      padding-bottom: 8px;
      cursor: pointer;
      box-shadow: 0 8px 18px rgba(0, 0, 0, 0.78);
      transition: transform 55ms cubic-bezier(0.16, 1, 0.3, 1), background 55ms ease, box-shadow 55ms ease;
    }

    .black-key.hovered {
      border-color: rgba(245, 158, 11, 0.85);
      background: linear-gradient(180deg, #1E293B 0%, #0F172A 100%);
    }

    .black-key.active {
      transform: translateY(4px);
      background: linear-gradient(180deg, #FDE68A 0%, #F59E0B 100%);
      box-shadow: 0 0 26px rgba(245, 158, 11, 0.9);
      border-color: #FFFBEB;
    }

    .key-note {
      font-family: var(--font-mono);
      font-size: 0.62rem;
      font-weight: 600;
      color: #0F172A;
      pointer-events: none;
    }

    .black-key .key-note {
      color: #CBD5E1;
      font-size: 0.54rem;
    }

    .black-key.active .key-note {
      color: #05070B;
      font-weight: 700;
    }
  </style>
</head>
<body>
  <div class="app-viewport" id="stage">
    <!-- Clear Mirrored Video Stream (Occupies Full Screen, Upper 72% Completely Unobstructed) -->
    <video id="webcam" playsinline muted></video>
    <div class="camera-vignette"></div>
    <canvas id="cv-overlay"></canvas>

    <!-- Sleek Top Bar (3 Zones) -->
    <header class="topbar">
      <a href="#" class="brand-title">AetherKeys</a>

      <div class="telemetry-strip">
        <span><span id="cam-dot" class="status-dot"></span><span id="cam-status">CAMERA STANDBY</span></span>
        <span>·</span>
        <span id="hand-status">RUKE: 0</span>
        <span>·</span>
        <span id="note-status">TON: —</span>
        <span>·</span>
        <span id="fps-status">0 FPS</span>
      </div>

      <div class="top-actions">
        <select id="preset-select" class="select-compact" title="Zvučni Preset">
          <option value="piano">Concert Grand Piano</option>
          <option value="rhodes">Vintage Tine EP</option>
          <option value="synth">Warm Analog Poly</option>
          <option value="pad">Glass Harmonic Pad</option>
        </select>

        <div class="control-inline" title="Osetljivost Okidanja (Niže = Lakši Pritisak)">
          <span>Osetljivost</span>
          <input type="range" id="sens-slider" min="50" max="150" value="100" />
        </div>

        <div class="control-inline" title="Jačina Zvuka">
          <span>Vol</span>
          <input type="range" id="vol-slider" min="0" max="100" value="85" />
        </div>

        <button id="btn-start" class="btn-primary">Start Camera &amp; Audio</button>
      </div>
    </header>

    <!-- Center Start Card (Automatically hides when camera starts so upper 72% is 100% clear) -->
    <div class="start-prompt" id="start-card">
      <h2>Kinelački Virtuelni Klavir (C3 – C6)</h2>
      <p>
        Gornjih 72% ekrana je čisto ogledalo kamere za praćenje ruku, dok je klavijatura od 3 pune oktave na samom dnu.<br />
        <strong>1 Prst = 1 Pokret = 1 Ton:</strong> Prelazak prsta preko dirke ne okida zvuk — ton se okida isključivo pri naglom savijanju zgloba ili spuštanju vrha prsta (IDLE → TRIGGER → LOCKED).
      </p>
      <div>
        <button id="btn-start-card" class="btn-primary">Start Camera &amp; Audio</button>
      </div>
    </div>

    <!-- Bottom 28% Ergonomic Piano Keyboard Overlay (3 Full Octaves: C3 to C6) -->
    <section class="piano-dock">
      <div class="piano-header-strip">
        <span>RASPON: C3 – C6 (3 PUNE OKTAVE · 37 DIRKI)</span>
        <span id="kinematic-readout">STATE MACHINE: 10 PRSTIJU NEZAVISNO (IDLE → TRIGGER → LOCKED)</span>
      </div>
      <div class="piano-keys-stage" id="piano-keys"></div>
    </section>
  </div>

  <script>
    /**
     * 10-FINGER KINEMATIC DEFINITIONS
     * Each finger tracks:
     * - tip: Landmark ID (4, 8, 12, 16, 20)
     * - joints: [MCP, PIP, DIP, TIP] for 3D joint flexion angle calculation
     */
    const FINGER_SPECS = [
      { tip: 4,  joints: [1, 2, 3, 4],     name: 'Palac' },
      { tip: 8,  joints: [5, 6, 7, 8],     name: 'Kažiprst' },
      { tip: 12, joints: [9, 10, 11, 12],  name: 'Srednji' },
      { tip: 16, joints: [13, 14, 15, 16], name: 'Domali' },
      { tip: 20, joints: [17, 18, 19, 20], name: 'Mali' }
    ];
    const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

    // Web Audio API Polyphonic Synthesizer (Fast 0.01s Attack + Natural Sustain)
    let audioCtx = null;
    let masterGain = null;
    const activeVoices = new Map();
    let currentPreset = 'piano';
    let sensitivityScale = 1.0; // 1.0 = default threshold

    function initAudio() {
      if (!audioCtx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        audioCtx = new AC({ latencyHint: 'interactive' });

        const compressor = audioCtx.createDynamicsCompressor();
        compressor.threshold.value = -14;
        compressor.knee.value = 15;
        compressor.ratio.value = 4;
        compressor.attack.value = 0.002;
        compressor.release.value = 0.15;

        masterGain = audioCtx.createGain();
        masterGain.gain.value = 0.85;

        compressor.connect(masterGain);
        masterGain.connect(audioCtx.destination);
        masterGain._bus = compressor;
      }
      if (audioCtx.state === 'suspended') {
        audioCtx.resume();
      }
    }

    function triggerAttack(note, freq, sourceId, velocity = 0.85) {
      initAudio();
      const now = audioCtx.currentTime;
      const vel = Math.min(1.0, Math.max(0.28, velocity));

      if (activeVoices.has(note)) {
        const existing = activeVoices.get(note);
        existing.sources.add(sourceId);
        // Re-strike articulation
        const peak = Math.min(0.48, Math.pow(vel, 1.25) * 0.44);
        existing.voiceGain.gain.cancelScheduledValues(now);
        existing.voiceGain.gain.setValueAtTime(Math.max(0.01, existing.voiceGain.gain.value), now);
        existing.voiceGain.gain.linearRampToValueAtTime(peak, now + 0.01);
        existing.voiceGain.gain.exponentialRampToValueAtTime(peak * 0.36, now + 0.48);
        return;
      }

      const voiceGain = audioCtx.createGain();
      voiceGain.gain.setValueAtTime(0.0001, now);

      const filter = audioCtx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(5400 * (0.45 + vel * 0.95), now);
      filter.frequency.exponentialRampToValueAtTime(1400, now + 0.65);

      const osc1 = audioCtx.createOscillator();
      const osc2 = audioCtx.createOscillator();
      const hammerOsc = audioCtx.createOscillator();
      const g2 = audioCtx.createGain();
      const hammerGain = audioCtx.createGain();

      if (currentPreset === 'piano') {
        osc1.type = 'triangle';
        osc2.type = 'sine';
        osc2.frequency.setValueAtTime(freq * 2, now);
        osc2.detune.setValueAtTime(3.5, now);
        g2.gain.value = 0.22 * vel;
      } else if (currentPreset === 'rhodes') {
        osc1.type = 'sine';
        osc2.type = 'sine';
        osc2.frequency.setValueAtTime(freq * 7, now);
        g2.gain.setValueAtTime(0.15 * vel, now);
        g2.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
      } else if (currentPreset === 'synth') {
        osc1.type = 'sawtooth';
        osc2.type = 'sawtooth';
        osc2.frequency.setValueAtTime(freq, now);
        osc2.detune.setValueAtTime(8, now);
        g2.gain.value = 0.35;
      } else {
        osc1.type = 'triangle';
        osc2.type = 'triangle';
        osc2.frequency.setValueAtTime(freq * 2, now);
        osc2.detune.setValueAtTime(-7, now);
        g2.gain.value = 0.26;
      }

      osc1.frequency.setValueAtTime(freq, now);
      hammerOsc.type = 'triangle';
      hammerOsc.frequency.setValueAtTime(freq * 5, now);
      hammerGain.gain.setValueAtTime(0.15 * vel * vel, now);
      hammerGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.025);

      osc1.connect(filter);
      osc2.connect(g2);
      g2.connect(filter);
      hammerOsc.connect(hammerGain);
      hammerGain.connect(filter);
      filter.connect(voiceGain);
      voiceGain.connect(masterGain._bus);

      // Fast 0.01s Attack + Sustain Envelope
      const peak = Math.min(0.48, Math.pow(vel, 1.25) * 0.44);
      const sustainLevel = Math.max(0.001, peak * 0.38);
      voiceGain.gain.setValueAtTime(0.0001, now);
      voiceGain.gain.linearRampToValueAtTime(peak, now + 0.01);
      voiceGain.gain.exponentialRampToValueAtTime(sustainLevel, now + 0.48);

      osc1.start(now);
      osc2.start(now);
      hammerOsc.start(now);

      activeVoices.set(note, { osc1, osc2, hammerOsc, voiceGain, sources: new Set([sourceId]) });
      document.getElementById('note-status').textContent = 'TON: ' + note + ' (' + Math.round(vel * 100) + '%)';
      updateKeyVisuals();
    }

    function triggerRelease(note, sourceId) {
      if (!audioCtx || !activeVoices.has(note)) return;
      const voice = activeVoices.get(note);
      voice.sources.delete(sourceId);
      if (voice.sources.size > 0) return;

      activeVoices.delete(note);
      const now = audioCtx.currentTime;
      const releaseTime = 0.55;
      voice.voiceGain.gain.cancelScheduledValues(now);
      voice.voiceGain.gain.setValueAtTime(Math.max(0.0001, voice.voiceGain.gain.value), now);
      voice.voiceGain.gain.exponentialRampToValueAtTime(0.0001, now + releaseTime);
      voice.osc1.stop(now + releaseTime + 0.03);
      voice.osc2.stop(now + releaseTime + 0.03);
      voice.hammerOsc.stop(now + releaseTime + 0.03);
      updateKeyVisuals();
    }

    // Build 3 Full Octaves Keyboard (C3 to C6 = 37 Keys)
    let keysData = [];
    function buildKeyboard() {
      const container = document.getElementById('piano-keys');
      container.innerHTML = '';
      keysData = [];
      const startOctave = 3;
      const octavesCount = 3;
      const totalSemitones = octavesCount * 12 + 1; // 37 keys: C3..C6
      const startMidi = (startOctave + 1) * 12; // 48
      let whiteCount = 0;

      for (let i = 0; i < totalSemitones; i++) {
        const midi = startMidi + i;
        const name = NOTE_NAMES[midi % 12];
        const oct = Math.floor(midi / 12) - 1;
        const isBlack = name.includes('#');
        const freq = 440 * Math.pow(2, (midi - 69) / 12);
        const wIdx = isBlack ? whiteCount - 1 : whiteCount;
        if (!isBlack) whiteCount++;
        keysData.push({ note: name + oct, freq, isBlack, wIdx, el: null });
      }

      keysData.filter(k => !k.isBlack).forEach(k => {
        const el = document.createElement('div');
        el.className = 'white-key';
        el.innerHTML = '<span class="key-note">' + k.note + '</span>';
        el.addEventListener('pointerdown', () => triggerAttack(k.note, k.freq, 'mouse', 0.85));
        el.addEventListener('pointerup', () => triggerRelease(k.note, 'mouse'));
        el.addEventListener('pointerleave', () => triggerRelease(k.note, 'mouse'));
        container.appendChild(el);
        k.el = el;
      });

      const whiteTotal = whiteCount;
      keysData.filter(k => k.isBlack).forEach(k => {
        const el = document.createElement('div');
        el.className = 'black-key';
        const wPercent = 100 / whiteTotal;
        const blackW = wPercent * 0.64;
        const leftPercent = (k.wIdx + 1) * wPercent - (blackW / 2);
        el.style.width = blackW + '%';
        el.style.left = leftPercent + '%';
        el.innerHTML = '<span class="key-note">' + k.note + '</span>';
        el.addEventListener('pointerdown', (e) => { e.stopPropagation(); triggerAttack(k.note, k.freq, 'mouse', 0.9); });
        el.addEventListener('pointerup', (e) => { e.stopPropagation(); triggerRelease(k.note, 'mouse'); });
        el.addEventListener('pointerleave', () => triggerRelease(k.note, 'mouse'));
        container.appendChild(el);
        k.el = el;
      });
    }

    function updateKeyVisuals(hoveredNotes = new Set()) {
      keysData.forEach(k => {
        if (!k.el) return;
        k.el.classList.toggle('active', activeVoices.has(k.note));
        k.el.classList.toggle('hovered', hoveredNotes.has(k.note) && !activeVoices.has(k.note));
      });
    }

    function hitTestKey(clientX, clientY) {
      // Check black keys first
      for (const k of keysData) {
        if (!k.isBlack || !k.el) continue;
        const r = k.el.getBoundingClientRect();
        if (clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom) return k;
      }
      // Check white keys
      for (const k of keysData) {
        if (k.isBlack || !k.el) continue;
        const r = k.el.getBoundingClientRect();
        if (clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom) return k;
      }
      return null;
    }

    // 3D Joint Angle Flexion (Measures bend angle at PIP and DIP joints, e.g. 5-6-8 & 6-7-8)
    function computeFlexionAngleDeg(landmarks, joints) {
      const p0 = landmarks[joints[0]];
      const p1 = landmarks[joints[1]];
      const p2 = landmarks[joints[2]];
      const p3 = landmarks[joints[3]];

      function bendAngle(a, b, c) {
        const ux = b.x - a.x, uy = b.y - a.y, uz = b.z - a.z;
        const vx = c.x - b.x, vy = c.y - b.y, vz = c.z - b.z;
        const magU = Math.hypot(ux, uy, uz) || 1e-6;
        const magV = Math.hypot(vx, vy, vz) || 1e-6;
        const dot = Math.max(-1, Math.min(1, (ux * vx + uy * vy + uz * vz) / (magU * magV)));
        return Math.acos(dot) * (180 / Math.PI);
      }

      const anglePIP = bendAngle(p0, p1, p2);
      const angleDIP = bendAngle(p1, p2, p3);
      const angleOverall = bendAngle(p0, p1, p3);
      return anglePIP * 0.45 + angleDIP * 0.35 + angleOverall * 0.35;
    }

    // Minimalist Hand Lines & Glowing Fingertip Auras (No Raw MediaPipe Dots)
    function renderNaturalHand(ctx, landmarks, width, height, perHandStates) {
      const toScreen = (lm) => ({ x: (1 - lm.x) * width, y: lm.y * height });
      const wrist = toScreen(landmarks[0]);
      const palmKnuckles = [1, 5, 9, 13, 17].map(i => toScreen(landmarks[i]));

      ctx.save();

      // Subtle minimalist palm arch curve
      ctx.beginPath();
      ctx.moveTo(palmKnuckles[0].x, palmKnuckles[0].y);
      for (let i = 1; i < palmKnuckles.length; i++) {
        const prev = palmKnuckles[i - 1];
        const cur = palmKnuckles[i];
        ctx.quadraticCurveTo(prev.x, prev.y, cur.x, cur.y);
      }
      ctx.strokeStyle = 'rgba(226, 232, 240, 0.22)';
      ctx.lineWidth = 1.4;
      ctx.stroke();

      // Smooth organic Bezier finger lines + glowing fingertip auras
      FINGER_SPECS.forEach((spec) => {
        const pts = spec.joints.map(idx => toScreen(landmarks[idx]));
        const st = perHandStates.get(spec.tip);
        const isLocked = st && st.state === 'LOCKED';
        const isHovering = st && st.hoveredNote !== null;

        ctx.beginPath();
        ctx.moveTo(wrist.x, wrist.y);
        ctx.quadraticCurveTo(pts[0].x, pts[0].y, (pts[0].x + pts[1].x) * 0.5, (pts[0].y + pts[1].y) * 0.5);
        ctx.quadraticCurveTo(pts[1].x, pts[1].y, (pts[1].x + pts[2].x) * 0.5, (pts[1].y + pts[2].y) * 0.5);
        ctx.quadraticCurveTo(pts[2].x, pts[2].y, pts[3].x, pts[3].y);

        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        // Soft outer translucent line
        ctx.strokeStyle = isLocked
          ? 'rgba(245, 158, 11, 0.48)'
          : 'rgba(6, 182, 212, 0.25)';
        ctx.lineWidth = isLocked ? 6 : 4;
        ctx.stroke();

        // Crisp minimalist inner filament
        ctx.strokeStyle = isLocked ? '#FDE68A' : 'rgba(248, 250, 252, 0.72)';
        ctx.lineWidth = 1.6;
        ctx.stroke();

        // Glowing Aura on Fingertip
        const tip = pts[3];
        const auraRadius = isLocked ? 20 : isHovering ? 15 : 11;
        const auraGrad = ctx.createRadialGradient(tip.x, tip.y, 1, tip.x, tip.y, auraRadius);

        if (isLocked) {
          auraGrad.addColorStop(0, 'rgba(254, 243, 199, 0.95)');
          auraGrad.addColorStop(0.45, 'rgba(245, 158, 11, 0.65)');
          auraGrad.addColorStop(1, 'rgba(245, 158, 11, 0.0)');
        } else if (isHovering) {
          auraGrad.addColorStop(0, 'rgba(224, 242, 254, 0.9)');
          auraGrad.addColorStop(0.5, 'rgba(6, 182, 212, 0.5)');
          auraGrad.addColorStop(1, 'rgba(6, 182, 212, 0.0)');
        } else {
          auraGrad.addColorStop(0, 'rgba(248, 250, 252, 0.75)');
          auraGrad.addColorStop(0.5, 'rgba(148, 163, 184, 0.28)');
          auraGrad.addColorStop(1, 'rgba(148, 163, 184, 0.0)');
        }

        ctx.beginPath();
        ctx.arc(tip.x, tip.y, auraRadius, 0, Math.PI * 2);
        ctx.fillStyle = auraGrad;
        ctx.fill();
      });

      ctx.restore();
    }

    buildKeyboard();

    // Controls
    document.getElementById('preset-select').addEventListener('change', (e) => {
      currentPreset = e.target.value;
    });
    document.getElementById('sens-slider').addEventListener('input', (e) => {
      // Higher slider value = more sensitive (lower threshold multiplier)
      const val = Number(e.target.value);
      sensitivityScale = 100 / val;
    });
    document.getElementById('vol-slider').addEventListener('input', (e) => {
      const val = Number(e.target.value);
      if (masterGain) masterGain.gain.value = val / 100;
    });

    // MediaPipe Hands & Real-Time 10-Finger Kinematic Loop
    const videoEl = document.getElementById('webcam');
    const canvasEl = document.getElementById('cv-overlay');
    const canvasCtx = canvasEl.getContext('2d');
    const fingerStates = new Map();
    const ripples = [];
    let cameraRunning = false;
    let lastFrameTime = performance.now();

    async function startCameraAndAudio() {
      initAudio();
      if (cameraRunning) return;
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' },
          audio: false
        });
        videoEl.srcObject = stream;
        await videoEl.play();
        videoEl.classList.add('active');
        cameraRunning = true;

        document.getElementById('start-card').classList.add('hidden');
        document.getElementById('cam-dot').className = 'status-dot online';
        document.getElementById('cam-status').textContent = 'CAMERA LIVE';
        const btn = document.getElementById('btn-start');
        btn.textContent = 'Camera & Audio Active';
        btn.classList.add('active-cam');

        const hands = new window.Hands({
          locateFile: (file) => 'https://cdn.jsdelivr.net/npm/@mediapipe/hands/' + file
        });
        hands.setOptions({
          maxNumHands: 2,
          modelComplexity: 1,
          minDetectionConfidence: 0.65,
          minTrackingConfidence: 0.65
        });
        hands.onResults(onHandResults);

        async function frameLoop() {
          if (!cameraRunning) return;
          if (videoEl.readyState >= 2) {
            await hands.send({ image: videoEl });
          }
          requestAnimationFrame(frameLoop);
        }
        frameLoop();
      } catch (err) {
        document.getElementById('cam-status').textContent = 'CAMERA ERROR';
      }
    }

    document.getElementById('btn-start').addEventListener('click', startCameraAndAudio);
    document.getElementById('btn-start-card').addEventListener('click', startCameraAndAudio);

    function onHandResults(results) {
      const now = performance.now();
      const dtSec = Math.max(0.008, Math.min(0.1, (now - lastFrameTime) / 1000));
      const fps = Math.min(60, Math.round(1 / dtSec));
      lastFrameTime = now;
      document.getElementById('fps-status').textContent = fps + ' FPS';

      const stageRect = document.getElementById('stage').getBoundingClientRect();
      if (canvasEl.width !== stageRect.width || canvasEl.height !== stageRect.height) {
        canvasEl.width = stageRect.width;
        canvasEl.height = stageRect.height;
      }

      canvasCtx.clearRect(0, 0, canvasEl.width, canvasEl.height);
      const hands = results.multiHandLandmarks || [];
      document.getElementById('hand-status').textContent = 'RUKE: ' + hands.length;

      const hoveredSet = new Set();
      const seenFingerIds = new Set();

      // Kinematic thresholds scaled by user sensitivity
      const VY_TRIGGER_THRESH = 190 * sensitivityScale;     // px/sec downward fingertip speed
      const ANG_VEL_THRESH = 135 * sensitivityScale;        // deg/sec joint flexion angular velocity
      const MIN_FLEX_ANGLE = 20 * sensitivityScale;         // minimum joint bend angle to allow strike
      const COOLDOWN_MS = 85;                               // minimum lock time before reset

      hands.forEach((landmarks, hIdx) => {
        const perHandStates = new Map();

        FINGER_SPECS.forEach((spec) => {
          const tipId = spec.tip;
          const fId = 'h' + hIdx + '_f' + tipId;
          seenFingerIds.add(fId);

          const lmTip = landmarks[tipId];
          const rawX = (1 - lmTip.x) * canvasEl.width;
          const rawY = lmTip.y * canvasEl.height;
          const rawAngle = computeFlexionAngleDeg(landmarks, spec.joints);

          const prev = fingerStates.get(fId) || {
            state: 'IDLE', // 'IDLE' | 'LOCKED'
            x: rawX,
            y: rawY,
            angle: rawAngle,
            lockedAtY: rawY,
            lockedAtAngle: rawAngle,
            lockedNote: null,
            lastTriggerTime: 0,
            hoveredNote: null
          };

          // Smooth position & angle slightly to suppress camera sensor noise
          const x = prev.x * 0.35 + rawX * 0.65;
          const y = prev.y * 0.35 + rawY * 0.65;
          const angle = prev.angle * 0.35 + rawAngle * 0.65;

          // C) Y-Velocity (dY / dt in px/s, positive = downward toward keys)
          const vy = (y - prev.y) / dtSec;
          // B) Angular Flexion Velocity (dAngle / dt in deg/s, positive = bending finger)
          const omegaFlex = (angle - prev.angle) / dtSec;

          // A) Screen position hit-test over piano keys
          const clientX = stageRect.left + x;
          const clientY = stageRect.top + y;
          const hitKey = hitTestKey(clientX, clientY);
          if (hitKey) hoveredSet.add(hitKey.note);

          let state = prev.state;
          let lockedAtY = prev.lockedAtY;
          let lockedAtAngle = prev.lockedAtAngle;
          let lockedNote = prev.lockedNote;
          let lastTriggerTime = prev.lastTriggerTime;

          /**
           * RIGOROUS 3-STAGE STATE MACHINE PER FINGER:
           * 1. IDLE (Hover): Finger hovers over key. Horizontal entry never triggers sound.
           * 2. TRIGGER: Fires ONLY when in IDLE over a key AND a sharp downward/flexion impulse occurs.
           * 3. LOCKED: Immediately locks after 1 tone. Cannot fire again until finger physically lifts or straightens.
           */
          if (state === 'IDLE') {
            const isSharpDownwardStrike = vy >= VY_TRIGGER_THRESH && (omegaFlex >= 25 || angle >= MIN_FLEX_ANGLE);
            const isSharpFlexionSnap = omegaFlex >= ANG_VEL_THRESH && angle >= MIN_FLEX_ANGLE && vy >= 45;

            if (hitKey && (isSharpDownwardStrike || isSharpFlexionSnap) && (now - lastTriggerTime >= COOLDOWN_MS)) {
              const normVel = Math.min(1.0, Math.max(0.35, (vy / 520) * 0.55 + (omegaFlex / 380) * 0.45));
              triggerAttack(hitKey.note, hitKey.freq, fId, normVel);

              // Transition immediately to LOCKED
              state = 'LOCKED';
              lockedAtY = y;
              lockedAtAngle = angle;
              lockedNote = hitKey.note;
              lastTriggerTime = now;

              ripples.push({ x, y, born: now, color: hitKey.isBlack ? '#F59E0B' : '#06B6D4' });
            }
          } else if (state === 'LOCKED') {
            // Must physically lift upward OR straighten finger joint to unlock back to IDLE
            const liftedUpward = (y <= lockedAtY - 12) || (vy < -110);
            const straightenedJoint = (angle <= lockedAtAngle - 7) || (angle < MIN_FLEX_ANGLE * 0.78);
            const leftKeyboardZone = !hitKey && (y < canvasEl.height * 0.68);

            if ((now - lastTriggerTime >= COOLDOWN_MS) && (liftedUpward || straightenedJoint || leftKeyboardZone)) {
              if (lockedNote) {
                triggerRelease(lockedNote, fId);
              }
              state = 'IDLE';
              lockedNote = null;
            }
          }

          const updated = {
            state,
            x,
            y,
            angle,
            vy,
            omegaFlex,
            lockedAtY,
            lockedAtAngle,
            lockedNote,
            lastTriggerTime,
            hoveredNote: hitKey ? hitKey.note : null
          };

          fingerStates.set(fId, updated);
          perHandStates.set(tipId, updated);
        });

        renderNaturalHand(canvasCtx, landmarks, canvasEl.width, canvasEl.height, perHandStates);
      });

      // Expanding light ripples on note trigger
      for (let i = ripples.length - 1; i >= 0; i--) {
        const r = ripples[i];
        const age = now - r.born;
        if (age > 420) {
          ripples.splice(i, 1);
          continue;
        }
        const p = age / 420;
        canvasCtx.save();
        canvasCtx.beginPath();
        canvasCtx.arc(r.x, r.y, 10 + p * 38, 0, Math.PI * 2);
        canvasCtx.strokeStyle = r.color;
        canvasCtx.globalAlpha = (1 - p) * 0.75;
        canvasCtx.lineWidth = 2;
        canvasCtx.stroke();
        canvasCtx.restore();
      }

      // Release any finger that left the camera view
      for (const [fId, st] of fingerStates.entries()) {
        if (!seenFingerIds.has(fId)) {
          if (st.lockedNote) triggerRelease(st.lockedNote, fId);
          fingerStates.delete(fId);
        }
      }

      updateKeyVisuals(hoveredSet);
    }
  </script>
</body>
</html>`;
