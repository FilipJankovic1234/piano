import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import {
  Camera,
  CameraOff,
  Volume2,
  VolumeX,
  Hand,
  Copy,
  Check,
  Download,
  Code2,
  Sliders,
  X,
} from 'lucide-react';
import {
  synthEngine,
  generateKeyboardKeys,
  PRESET_DEFAULTS,
  SynthPresetId,
  PianoKeyDef,
} from './audio/synthEngine';
import { STANDALONE_HTML_SOURCE } from './standalone/standaloneHtmlTemplate';

declare global {
  interface Window {
    Hands?: new (config: { locateFile: (file: string) => string }) => {
      setOptions: (options: {
        maxNumHands: number;
        modelComplexity: number;
        minDetectionConfidence: number;
        minTrackingConfidence: number;
      }) => void;
      onResults: (callback: (results: MediaPipeResults) => void) => void;
      send: (input: { image: HTMLVideoElement }) => Promise<void>;
      close: () => Promise<void>;
    };
  }
}

interface Landmark {
  x: number;
  y: number;
  z: number;
}

interface MediaPipeResults {
  multiHandLandmarks?: Landmark[][];
}

interface FingerSpec {
  tip: 4 | 8 | 12 | 16 | 20;
  joints: [number, number, number, number]; // [MCP, PIP, DIP, TIP]
  name: string;
}

const FINGER_SPECS: readonly FingerSpec[] = [
  { tip: 4, joints: [1, 2, 3, 4], name: 'Palac' },
  { tip: 8, joints: [5, 6, 7, 8], name: 'Kažiprst' },
  { tip: 12, joints: [9, 10, 11, 12], name: 'Srednji' },
  { tip: 16, joints: [13, 14, 15, 16], name: 'Domali' },
  { tip: 20, joints: [17, 18, 19, 20], name: 'Mali' },
];

type FingerMachineState = 'IDLE' | 'LOCKED';

interface FingerKinematicRecord {
  id: string;
  tipId: number;
  name: string;
  state: FingerMachineState;
  x: number;
  y: number;
  angle: number;
  vy: number;
  omegaFlex: number;
  lockedAtY: number;
  lockedAtAngle: number;
  lockedNote: string | null;
  lastTriggerTime: number;
  hoveredNote: string | null;
}

interface RippleEffect {
  x: number;
  y: number;
  color: string;
  born: number;
}

// Compute 3D joint flexion angle in degrees (e.g. landmarks 5-6-8 and 6-7-8 for index finger)
function computeFlexionAngleDeg(
  landmarks: Landmark[],
  joints: [number, number, number, number]
): number {
  const p0 = landmarks[joints[0]];
  const p1 = landmarks[joints[1]];
  const p2 = landmarks[joints[2]];
  const p3 = landmarks[joints[3]];
  if (!p0 || !p1 || !p2 || !p3) return 0;

  const bendAngle = (a: Landmark, b: Landmark, c: Landmark): number => {
    const ux = b.x - a.x;
    const uy = b.y - a.y;
    const uz = b.z - a.z;
    const vx = c.x - b.x;
    const vy = c.y - b.y;
    const vz = c.z - b.z;
    const magU = Math.hypot(ux, uy, uz) || 1e-6;
    const magV = Math.hypot(vx, vy, vz) || 1e-6;
    const dot = Math.max(-1, Math.min(1, (ux * vx + uy * vy + uz * vz) / (magU * magV)));
    return Math.acos(dot) * (180 / Math.PI);
  };

  const anglePIP = bendAngle(p0, p1, p2);
  const angleDIP = bendAngle(p1, p2, p3);
  const angleOverall = bendAngle(p0, p1, p3);
  return anglePIP * 0.45 + angleDIP * 0.35 + angleOverall * 0.35;
}

export default function App() {
  // Overlay modal states (kept closed during playing so upper 72% camera feed is 100% clear)
  const [showHtmlModal, setShowHtmlModal] = useState(false);
  const [showSettingsDrawer, setShowSettingsDrawer] = useState(false);
  const [copiedHtml, setCopiedHtml] = useState(false);

  // Camera & Hand Tracking state
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [simHandActive, setSimHandActive] = useState(false);
  const [detectedHandsCount, setDetectedHandsCount] = useState(0);
  const [fps, setFps] = useState(0);

  // Kinematic State Machine Thresholds (1 Finger = 1 Movement = 1 Note)
  const [sensitivity, setSensitivity] = useState(100); // 50..150%
  const [vyThreshold, setVyThreshold] = useState(190); // px/sec downward speed
  const [angVelThreshold, setAngVelThreshold] = useState(135); // deg/sec flexion speed
  const [minFlexAngle, setMinFlexAngle] = useState(20); // degrees

  // Audio & Keyboard Settings (3 Full Octaves C3–C6 at bottom 28% of screen)
  const [preset, setPreset] = useState<SynthPresetId>('grand-piano');
  const [octavesCount, setOctavesCount] = useState<2 | 3>(3);
  const [volume, setVolume] = useState(0.85);
  const [isMuted, setIsMuted] = useState(false);

  // Active & Hovered Key Visuals
  const [activeNotesMap, setActiveNotesMap] = useState<Record<string, number>>({});
  const [hoveredNotesSet, setHoveredNotesSet] = useState<Set<string>>(new Set());
  const [lastTriggeredNote, setLastTriggeredNote] = useState<{
    note: string;
    vel: number;
    finger: string;
  } | null>(null);

  // Refs for real-time loops
  const stageRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const cvCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const keyElementsRef = useRef<Map<string, HTMLDivElement>>(new Map());
  const fingerStatesRef = useRef<Map<string, FingerKinematicRecord>>(new Map());
  const ripplesRef = useRef<RippleEffect[]>([]);
  const cameraRunningRef = useRef(false);
  const simHandRef = useRef({
    active: false,
    x: 0.5,
    y: 0.65,
    striking: false,
    strikeProgress: 0,
  });

  const thresholdsRef = useRef({
    sensitivity,
    vyThreshold,
    angVelThreshold,
    minFlexAngle,
  });

  useEffect(() => {
    thresholdsRef.current = {
      sensitivity,
      vyThreshold,
      angVelThreshold,
      minFlexAngle,
    };
  }, [sensitivity, vyThreshold, angVelThreshold, minFlexAngle]);

  const startOctave = octavesCount === 3 ? 3 : 4;
  const pianoKeys = useMemo(
    () => generateKeyboardKeys(startOctave, octavesCount),
    [startOctave, octavesCount]
  );
  const whiteKeys = useMemo(() => pianoKeys.filter((k) => !k.isBlack), [pianoKeys]);
  const blackKeys = useMemo(() => pianoKeys.filter((k) => k.isBlack), [pianoKeys]);

  // Sync synth parameters with fast 0.01s Attack & natural Sustain
  useEffect(() => {
    const def = PRESET_DEFAULTS[preset];
    synthEngine.updateParams({
      preset,
      volume: isMuted ? 0 : volume,
      filterCutoff: def.filterCutoff,
      reverbMix: def.reverbMix,
      adsr: {
        attack: 0.01,
        decay: def.adsr.decay,
        sustain: def.adsr.sustain,
        release: def.adsr.release,
      },
    });
  }, [preset, volume, isMuted]);

  const triggerNoteAttack = useCallback(
    (
      keyDef: PianoKeyDef,
      velocity: number,
      sourceId: string,
      fingerName: string,
      rippleCoords?: { x: number; y: number }
    ) => {
      synthEngine.triggerAttack(keyDef.note, keyDef.freq, velocity, sourceId);
      setActiveNotesMap((prev) => ({ ...prev, [keyDef.note]: velocity }));
      setLastTriggeredNote({
        note: keyDef.note,
        vel: Math.round(velocity * 100),
        finger: fingerName,
      });

      if (rippleCoords) {
        ripplesRef.current.push({
          x: rippleCoords.x,
          y: rippleCoords.y,
          color: keyDef.isBlack ? '#F59E0B' : '#06B6D4',
          born: performance.now(),
        });
      }
    },
    []
  );

  const triggerNoteRelease = useCallback((note: string, sourceId: string) => {
    synthEngine.triggerRelease(note, sourceId);
    setActiveNotesMap((prev) => {
      const next = { ...prev };
      delete next[note];
      return next;
    });
  }, []);

  // Hit-test screen coordinates against piano keys at the bottom of the screen
  const hitTestKeyAtPoint = useCallback(
    (clientX: number, clientY: number): PianoKeyDef | null => {
      for (const bKey of blackKeys) {
        const el = keyElementsRef.current.get(bKey.note);
        if (!el) continue;
        const r = el.getBoundingClientRect();
        if (clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom) {
          return bKey;
        }
      }
      for (const wKey of whiteKeys) {
        const el = keyElementsRef.current.get(wKey.note);
        if (!el) continue;
        const r = el.getBoundingClientRect();
        if (clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom) {
          return wKey;
        }
      }
      return null;
    },
    [blackKeys, whiteKeys]
  );

  // Subtle, Minimalist Hand Lines & Glowing Fingertip Auras (Zero Raw Dots)
  const renderNaturalHand = useCallback(
    (
      ctx: CanvasRenderingContext2D,
      landmarks: Landmark[],
      width: number,
      height: number,
      perHandStates: Map<number, FingerKinematicRecord>
    ) => {
      const toScreen = (lm: Landmark) => ({
        x: (1 - lm.x) * width,
        y: lm.y * height,
      });

      const wrist = toScreen(landmarks[0]);
      const knuckles = [1, 5, 9, 13, 17].map((i) => toScreen(landmarks[i]));

      ctx.save();

      // Subtle minimalist palm arch line
      ctx.beginPath();
      ctx.moveTo(knuckles[0].x, knuckles[0].y);
      for (let i = 1; i < knuckles.length; i++) {
        const prev = knuckles[i - 1];
        const cur = knuckles[i];
        ctx.quadraticCurveTo(prev.x, prev.y, cur.x, cur.y);
      }
      ctx.strokeStyle = 'rgba(226, 232, 240, 0.22)';
      ctx.lineWidth = 1.4;
      ctx.stroke();

      // Smooth Bezier finger lines & glowing fingertip auras
      FINGER_SPECS.forEach((spec) => {
        const pts = spec.joints.map((idx) => toScreen(landmarks[idx]));
        const st = perHandStates.get(spec.tip);
        const isLocked = st?.state === 'LOCKED';
        const isHovering = st?.hoveredNote !== null;

        ctx.beginPath();
        ctx.moveTo(wrist.x, wrist.y);
        ctx.quadraticCurveTo(
          pts[0].x,
          pts[0].y,
          (pts[0].x + pts[1].x) * 0.5,
          (pts[0].y + pts[1].y) * 0.5
        );
        ctx.quadraticCurveTo(
          pts[1].x,
          pts[1].y,
          (pts[1].x + pts[2].x) * 0.5,
          (pts[1].y + pts[2].y) * 0.5
        );
        ctx.quadraticCurveTo(pts[2].x, pts[2].y, pts[3].x, pts[3].y);

        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        // Soft outer translucent line
        ctx.strokeStyle = isLocked ? 'rgba(245, 158, 11, 0.48)' : 'rgba(6, 182, 212, 0.25)';
        ctx.lineWidth = isLocked ? 6 : 4;
        ctx.stroke();

        // Minimalist inner filament
        ctx.strokeStyle = isLocked ? '#FDE68A' : 'rgba(248, 250, 252, 0.75)';
        ctx.lineWidth = 1.6;
        ctx.stroke();

        // Glowing Fingertip Aura
        const tip = pts[3];
        const auraRadius = isLocked ? 22 : isHovering ? 16 : 12;
        const auraGrad = ctx.createRadialGradient(tip.x, tip.y, 1, tip.x, tip.y, auraRadius);

        if (isLocked) {
          auraGrad.addColorStop(0, 'rgba(254, 243, 199, 0.96)');
          auraGrad.addColorStop(0.45, 'rgba(245, 158, 11, 0.68)');
          auraGrad.addColorStop(1, 'rgba(245, 158, 11, 0.0)');
        } else if (isHovering) {
          auraGrad.addColorStop(0, 'rgba(224, 242, 254, 0.92)');
          auraGrad.addColorStop(0.5, 'rgba(6, 182, 212, 0.52)');
          auraGrad.addColorStop(1, 'rgba(6, 182, 212, 0.0)');
        } else {
          auraGrad.addColorStop(0, 'rgba(248, 250, 252, 0.78)');
          auraGrad.addColorStop(0.5, 'rgba(148, 163, 184, 0.28)');
          auraGrad.addColorStop(1, 'rgba(148, 163, 184, 0.0)');
        }

        ctx.beginPath();
        ctx.arc(tip.x, tip.y, auraRadius, 0, Math.PI * 2);
        ctx.fillStyle = auraGrad;
        ctx.fill();
      });

      ctx.restore();
    },
    []
  );

  // Real-Time 10-Finger Kinematic Loop (IDLE -> TRIGGER -> LOCKED)
  const lastFrameTimeRef = useRef<number>(performance.now());

  const processHandLandmarks = useCallback(
    (multiHandLandmarks: Landmark[][], now: number) => {
      const stageEl = stageRef.current;
      const canvasEl = cvCanvasRef.current;
      if (!stageEl || !canvasEl) return;

      const dtSec = Math.max(0.008, Math.min(0.1, (now - lastFrameTimeRef.current) / 1000));
      lastFrameTimeRef.current = now;
      setFps(Math.min(60, Math.round(1 / dtSec)));

      const stageRect = stageEl.getBoundingClientRect();
      if (canvasEl.width !== stageRect.width || canvasEl.height !== stageRect.height) {
        canvasEl.width = stageRect.width;
        canvasEl.height = stageRect.height;
      }

      const ctx = canvasEl.getContext('2d');
      if (!ctx) return;
      ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);

      setDetectedHandsCount(multiHandLandmarks.length);

      const {
        sensitivity: sensPct,
        vyThreshold: baseVy,
        angVelThreshold: baseAngVel,
        minFlexAngle: baseMinAngle,
      } = thresholdsRef.current;

      const scale = 100 / Math.max(40, sensPct);
      const VY_TRIGGER_THRESH = baseVy * scale;
      const ANG_VEL_THRESH = baseAngVel * scale;
      const MIN_FLEX_ANGLE = baseMinAngle * scale;
      const COOLDOWN_MS = 85;

      const hoveredSet = new Set<string>();
      const seenFingerIds = new Set<string>();

      multiHandLandmarks.forEach((landmarks, hIdx) => {
        const perHandStates = new Map<number, FingerKinematicRecord>();

        FINGER_SPECS.forEach((spec) => {
          const tipId = spec.tip;
          const fId = `h${hIdx}_f${tipId}`;
          seenFingerIds.add(fId);

          const lmTip = landmarks[tipId];
          if (!lmTip) return;

          const rawX = (1 - lmTip.x) * canvasEl.width;
          const rawY = lmTip.y * canvasEl.height;
          const rawAngle = computeFlexionAngleDeg(landmarks, spec.joints);

          const prev = fingerStatesRef.current.get(fId);
          const x = prev ? prev.x * 0.35 + rawX * 0.65 : rawX;
          const y = prev ? prev.y * 0.35 + rawY * 0.65 : rawY;
          const angle = prev ? prev.angle * 0.35 + rawAngle * 0.65 : rawAngle;

          // C) Downward Y-Velocity (dY / dt in px/sec)
          const vy = prev ? (y - prev.y) / dtSec : 0;
          // B) Joint Flexion Angular Velocity (dAngle / dt in deg/sec)
          const omegaFlex = prev ? (angle - prev.angle) / dtSec : 0;

          // A) Screen Position over Piano Key
          const clientX = stageRect.left + x;
          const clientY = stageRect.top + y;
          const hitKey = hitTestKeyAtPoint(clientX, clientY);
          if (hitKey) {
            hoveredSet.add(hitKey.note);
          }

          let state: FingerMachineState = prev?.state ?? 'IDLE';
          let lockedAtY = prev?.lockedAtY ?? y;
          let lockedAtAngle = prev?.lockedAtAngle ?? angle;
          let lockedNote = prev?.lockedNote ?? null;
          let lastTriggerTime = prev?.lastTriggerTime ?? 0;

          /**
           * RIGOROUS 3-STAGE STATE MACHINE PER FINGER:
           * 1. IDLE (Hover): Finger hovers above key. Simple hover/crossing NEVER triggers sound.
           * 2. TRIGGER: Fires 1 note ONLY when in IDLE over a key AND a sudden downward/flexion movement occurs.
           * 3. LOCKED: Immediately locks. Cannot fire again until physically lifted or straightened back to IDLE.
           */
          if (state === 'IDLE') {
            const isSharpDownwardStrike =
              vy >= VY_TRIGGER_THRESH && (omegaFlex >= 25 || angle >= MIN_FLEX_ANGLE);
            const isSharpFlexionSnap =
              omegaFlex >= ANG_VEL_THRESH && angle >= MIN_FLEX_ANGLE && vy >= 45;

            if (
              hitKey &&
              (isSharpDownwardStrike || isSharpFlexionSnap) &&
              now - lastTriggerTime >= COOLDOWN_MS
            ) {
              const normVel = Math.min(
                1.0,
                Math.max(0.35, (vy / 520) * 0.55 + (omegaFlex / 380) * 0.45)
              );
              triggerNoteAttack(hitKey, normVel, fId, spec.name, { x, y });

              state = 'LOCKED';
              lockedAtY = y;
              lockedAtAngle = angle;
              lockedNote = hitKey.note;
              lastTriggerTime = now;
            }
          } else if (state === 'LOCKED') {
            const liftedUpward = y <= lockedAtY - 12 || vy < -110;
            const straightenedJoint =
              angle <= lockedAtAngle - 7 || angle < MIN_FLEX_ANGLE * 0.78;
            const leftKeyboardZone = !hitKey && y < canvasEl.height * 0.68;

            if (
              now - lastTriggerTime >= COOLDOWN_MS &&
              (liftedUpward || straightenedJoint || leftKeyboardZone)
            ) {
              if (lockedNote) {
                triggerNoteRelease(lockedNote, fId);
              }
              state = 'IDLE';
              lockedNote = null;
            }
          }

          const record: FingerKinematicRecord = {
            id: fId,
            tipId,
            name: spec.name,
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
            hoveredNote: hitKey?.note ?? null,
          };

          fingerStatesRef.current.set(fId, record);
          perHandStates.set(tipId, record);
        });

        renderNaturalHand(ctx, landmarks, canvasEl.width, canvasEl.height, perHandStates);
      });

      // Render expanding ripples on strike
      const remainingRipples: RippleEffect[] = [];
      ripplesRef.current.forEach((r) => {
        const age = now - r.born;
        if (age < 420) {
          const p = age / 420;
          ctx.save();
          ctx.beginPath();
          ctx.arc(r.x, r.y, 10 + p * 38, 0, Math.PI * 2);
          ctx.strokeStyle = r.color;
          ctx.globalAlpha = (1 - p) * 0.75;
          ctx.lineWidth = 2;
          ctx.stroke();
          ctx.restore();
          remainingRipples.push(r);
        }
      });
      ripplesRef.current = remainingRipples;

      // Cleanup lost fingers
      for (const [fId, st] of fingerStatesRef.current.entries()) {
        if (!seenFingerIds.has(fId)) {
          if (st.lockedNote) {
            triggerNoteRelease(st.lockedNote, fId);
          }
          fingerStatesRef.current.delete(fId);
        }
      }

      setHoveredNotesSet(hoveredSet);
    },
    [hitTestKeyAtPoint, renderNaturalHand, triggerNoteAttack, triggerNoteRelease]
  );

  // Start / Stop Camera & Audio
  const toggleCameraAndAudio = async () => {
    synthEngine.init();
    setCameraError(null);

    if (cameraRunningRef.current) {
      cameraRunningRef.current = false;
      setCameraActive(false);
      setDetectedHandsCount(0);
      synthEngine.panicAllOff();
      setActiveNotesMap({});

      if (videoRef.current && videoRef.current.srcObject) {
        const stream = videoRef.current.srcObject as MediaStream;
        stream.getTracks().forEach((t) => t.stop());
        videoRef.current.srcObject = null;
      }
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          facingMode: 'user',
        },
        audio: false,
      });

      if (!videoRef.current) return;
      videoRef.current.srcObject = stream;
      await videoRef.current.play();

      if (!window.Hands) {
        throw new Error('MediaPipe Hands CDN se učitava. Pokušajte ponovo za sekundu.');
      }

      const hands = new window.Hands({
        locateFile: (file: string) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`,
      });

      hands.setOptions({
        maxNumHands: 2,
        modelComplexity: 1,
        minDetectionConfidence: 0.65,
        minTrackingConfidence: 0.65,
      });

      hands.onResults((results: MediaPipeResults) => {
        processHandLandmarks(results.multiHandLandmarks || [], performance.now());
      });

      cameraRunningRef.current = true;
      setCameraActive(true);
      setSimHandActive(false);
      simHandRef.current.active = false;

      const framePump = async () => {
        if (!cameraRunningRef.current || !videoRef.current) return;
        if (videoRef.current.readyState >= 2) {
          try {
            await hands.send({ image: videoRef.current });
          } catch {
            // Ignore transient frame errors
          }
        }
        if (cameraRunningRef.current) {
          requestAnimationFrame(framePump);
        }
      };

      requestAnimationFrame(framePump);
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : 'Kamera nije dostupna. Aktivirana je 3D simulacija šake.';
      setCameraError(msg);
      setSimHandActive(true);
      simHandRef.current.active = true;
    }
  };

  // Optional 3D Simulated Hand loop (move mouse to hover, click to perform a rapid downward/flexion strike with Index finger)
  useEffect(() => {
    if (!simHandActive || cameraActive) return;

    let animId = 0;

    const buildSimulatedLandmarks = (cx: number, cy: number, strikeProg: number): Landmark[] => {
      const mx = 1 - cx;
      const my = cy;
      const spread = [-0.085, -0.042, 0.0, 0.042, 0.084];
      const lengths = [0.09, 0.135, 0.148, 0.136, 0.11];
      const landmarks: Landmark[] = new Array(21).fill(null).map(() => ({ x: mx, y: my, z: 0 }));

      landmarks[0] = { x: mx, y: my - 0.15, z: 0 };

      FINGER_SPECS.forEach((spec, idx) => {
        const dx = spread[idx];
        const len = lengths[idx];
        const s = spec.tip === 8 ? strikeProg : 0;
        const [j0, j1, j2, j3] = spec.joints;

        landmarks[j0] = { x: mx + dx * 0.65, y: my - 0.06, z: 0 };
        landmarks[j1] = { x: mx + dx * 0.85, y: my - 0.06 + len * 0.42, z: -0.01 - s * 0.03 };
        landmarks[j2] = {
          x: mx + dx * 0.95 + s * 0.02,
          y: my - 0.06 + len * 0.74 + s * 0.025,
          z: -0.02 - s * 0.07,
        };
        landmarks[j3] = {
          x: mx + dx - s * 0.015,
          y: my - 0.06 + len + s * 0.055,
          z: -0.025 - s * 0.1,
        };
      });

      return landmarks;
    };

    const simLoop = () => {
      const now = performance.now();
      if (simHandRef.current.striking) {
        simHandRef.current.strikeProgress = Math.min(1.0, simHandRef.current.strikeProgress + 0.35);
      } else {
        simHandRef.current.strikeProgress *= 0.65;
      }

      const lms = buildSimulatedLandmarks(
        simHandRef.current.x,
        simHandRef.current.y,
        simHandRef.current.strikeProgress
      );
      processHandLandmarks([lms], now);
      animId = requestAnimationFrame(simLoop);
    };

    animId = requestAnimationFrame(simLoop);
    return () => cancelAnimationFrame(animId);
  }, [simHandActive, cameraActive, processHandLandmarks]);

  const handleCopyStandaloneHtml = async () => {
    try {
      await navigator.clipboard.writeText(STANDALONE_HTML_SOURCE);
      setCopiedHtml(true);
      setTimeout(() => setCopiedHtml(false), 2500);
    } catch {
      // Ignore
    }
  };

  const handleDownloadStandaloneHtml = () => {
    const blob = new Blob([STANDALONE_HTML_SOURCE], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'aetherkeys-virtual-piano.html';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div
      ref={stageRef}
      onPointerMove={(e) => {
        if (!simHandActive || cameraActive || !stageRef.current) return;
        const rect = stageRef.current.getBoundingClientRect();
        simHandRef.current.x = Math.max(0.05, Math.min(0.95, (e.clientX - rect.left) / rect.width));
        simHandRef.current.y = Math.max(0.1, Math.min(0.94, (e.clientY - rect.top) / rect.height));
      }}
      onPointerDown={() => {
        if (simHandActive && !cameraActive) {
          simHandRef.current.striking = true;
        }
      }}
      onPointerUp={() => {
        if (simHandActive && !cameraActive) {
          simHandRef.current.striking = false;
        }
      }}
      className="relative w-screen h-screen overflow-hidden bg-[#05070B] text-slate-100 flex flex-col justify-between select-none"
    >
      {/* 1. CLEAR MIRRORED CAMERA STREAM (Upper 72% is 100% unobstructed so user sees hands & face clearly) */}
      <video
        ref={videoRef}
        playsInline
        muted
        className={`absolute inset-0 w-full h-full object-cover scale-x-[-1] z-[1] transition-opacity duration-500 ${
          cameraActive ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
      />

      {/* Subtle protective edge vignette only at top bar and bottom keyboard border */}
      <div
        className="absolute inset-0 pointer-events-none z-[2]"
        style={{
          background:
            'linear-gradient(180deg, rgba(5,7,11,0.68) 0%, rgba(5,7,11,0.0) 12%, rgba(5,7,11,0.0) 68%, rgba(5,7,11,0.86) 100%)',
        }}
      />

      {/* 2. MINIMALIST HAND LINES & GLOWING FINGERTIP AURAS CANVAS */}
      <canvas
        ref={cvCanvasRef}
        className="absolute inset-0 w-full h-full pointer-events-none z-[25]"
      />

      {/* 3. SLEEK TOP BAR CONTRACT (3 Zones: Brand, Navigation/Telemetry, Primary Action) */}
      <header className="relative z-30 h-14 px-5 bg-[#05070B]/75 backdrop-blur-md border-b border-slate-800/70 flex items-center justify-between">
        <a
          href="#top"
          onClick={(e) => e.preventDefault()}
          className="font-display text-lg font-bold tracking-tight text-slate-50"
        >
          AetherKeys
        </a>

        <nav className="hidden lg:flex items-center gap-6 text-xs font-mono text-slate-300">
          <div className="flex items-center gap-2">
            <span
              className={`w-2 h-2 rounded-full ${
                cameraActive
                  ? 'bg-emerald-400 shadow-[0_0_10px_#10B981]'
                  : simHandActive
                  ? 'bg-amber-400 shadow-[0_0_10px_#F59E0B]'
                  : 'bg-slate-600'
              }`}
            />
            <span>
              {cameraActive
                ? 'KAMERA AKTIVNA'
                : simHandActive
                ? 'SIMULACIJA ŠAKE'
                : 'CAMERA STANDBY'}
            </span>
          </div>
          <span className="text-slate-600">·</span>
          <span>RUKE: {detectedHandsCount}</span>
          <span className="text-slate-600">·</span>
          <span className="text-cyan-400">
            {lastTriggeredNote
              ? `TON: ${lastTriggeredNote.note} (${lastTriggeredNote.finger} · VEL ${lastTriggeredNote.vel}%)`
              : '1 PRST = 1 POKRET = 1 TON'}
          </span>
          <span className="text-slate-600">·</span>
          <span>{fps} FPS</span>
        </nav>

        <div className="flex items-center gap-2.5">
          <button
            onClick={() => setShowSettingsDrawer(!showSettingsDrawer)}
            className={`px-3 py-1.5 rounded-lg border text-xs font-semibold flex items-center gap-1.5 cursor-pointer transition-colors whitespace-nowrap ${
              showSettingsDrawer
                ? 'bg-cyan-500/20 border-cyan-400 text-cyan-300'
                : 'bg-slate-900/85 border-slate-700/80 text-slate-300 hover:text-white'
            }`}
          >
            <Sliders className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Kalibracija &amp; Zvuk</span>
          </button>

          <button
            onClick={() => setShowHtmlModal(true)}
            className="px-3 py-1.5 rounded-lg bg-slate-900/85 hover:bg-slate-800 border border-slate-700/80 text-xs font-semibold text-cyan-300 flex items-center gap-1.5 cursor-pointer transition-colors whitespace-nowrap"
          >
            <Code2 className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">HTML Kod</span>
          </button>

          <button
            onClick={toggleCameraAndAudio}
            className={`px-4 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap transition-all cursor-pointer flex items-center gap-2 ${
              cameraActive
                ? 'bg-rose-500 hover:bg-rose-600 text-white shadow-lg shadow-rose-500/25'
                : 'bg-cyan-400 hover:bg-cyan-300 text-slate-950 shadow-lg shadow-cyan-500/25'
            }`}
          >
            {cameraActive ? (
              <>
                <CameraOff className="w-3.5 h-3.5" />
                <span>Stop Camera</span>
              </>
            ) : (
              <>
                <Camera className="w-3.5 h-3.5" />
                <span>Start Camera &amp; Audio</span>
              </>
            )}
          </button>
        </div>
      </header>

      {/* Optional Floating Calibration Popover (Only visible when clicked so camera view remains 100% open) */}
      {showSettingsDrawer && (
        <div className="absolute top-16 right-5 z-40 w-80 rounded-2xl bg-[#0B0E17]/92 backdrop-blur-xl border border-slate-700/80 p-4 shadow-2xl flex flex-col gap-4 text-xs">
          <div className="flex items-center justify-between border-b border-slate-800 pb-2.5">
            <span className="font-semibold text-slate-200">
              Kinelački Parametri i Audio Sinteza
            </span>
            <button
              onClick={() => setShowSettingsDrawer(false)}
              className="text-slate-400 hover:text-white cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-slate-400">Zvučni Preset (Attack 0.01s)</span>
            <div className="grid grid-cols-2 gap-1.5">
              {(Object.keys(PRESET_DEFAULTS) as SynthPresetId[]).map((k) => (
                <button
                  key={k}
                  onClick={() => setPreset(k)}
                  className={`p-2 rounded-lg border text-left font-semibold cursor-pointer truncate ${
                    preset === k
                      ? 'bg-cyan-500/20 border-cyan-400 text-cyan-200'
                      : 'bg-slate-950 border-slate-800 text-slate-400'
                  }`}
                >
                  {PRESET_DEFAULTS[k].name}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <div className="flex justify-between">
              <span className="text-slate-300">Osetljivost Okidanja (Threshold)</span>
              <span className="font-mono text-cyan-400">{sensitivity}%</span>
            </div>
            <input
              type="range"
              min="50"
              max="150"
              value={sensitivity}
              onChange={(e) => setSensitivity(Number(e.target.value))}
              className="w-full accent-cyan-400 cursor-pointer"
            />
          </div>

          <div className="flex flex-col gap-1">
            <div className="flex justify-between">
              <span className="text-slate-300">Prag Y-Brzine (dY/dt)</span>
              <span className="font-mono text-cyan-400">{vyThreshold} px/s</span>
            </div>
            <input
              type="range"
              min="100"
              max="320"
              value={vyThreshold}
              onChange={(e) => setVyThreshold(Number(e.target.value))}
              className="w-full accent-cyan-400 cursor-pointer"
            />
          </div>

          <div className="flex flex-col gap-1">
            <div className="flex justify-between">
              <span className="text-slate-300">Minimalni Ugao Savijanja Zgloba</span>
              <span className="font-mono text-cyan-400">{minFlexAngle}°</span>
            </div>
            <input
              type="range"
              min="12"
              max="38"
              value={minFlexAngle}
              onChange={(e) => setMinFlexAngle(Number(e.target.value))}
              className="w-full accent-cyan-400 cursor-pointer"
            />
          </div>

          <div className="flex flex-col gap-1">
            <div className="flex justify-between">
              <button
                onClick={() => setIsMuted(!isMuted)}
                className="flex items-center gap-1.5 text-slate-300 cursor-pointer"
              >
                {isMuted ? (
                  <VolumeX className="w-3.5 h-3.5 text-rose-400" />
                ) : (
                  <Volume2 className="w-3.5 h-3.5 text-cyan-400" />
                )}
                <span>Jačina Zvuka</span>
              </button>
              <span className="font-mono text-cyan-400">
                {isMuted ? 'MUTE' : `${Math.round(volume * 100)}%`}
              </span>
            </div>
            <input
              type="range"
              min="0"
              max="1"
              step="0.02"
              value={isMuted ? 0 : volume}
              onChange={(e) => {
                setIsMuted(false);
                setVolume(Number(e.target.value));
              }}
              className="w-full accent-cyan-400 cursor-pointer"
            />
          </div>

          <div className="grid grid-cols-2 gap-2 pt-1">
            <button
              onClick={() => setOctavesCount(3)}
              className={`py-1.5 rounded-lg border font-mono font-semibold cursor-pointer ${
                octavesCount === 3
                  ? 'bg-cyan-500/20 border-cyan-400 text-cyan-300'
                  : 'bg-slate-950 border-slate-800 text-slate-400'
              }`}
            >
              3 Oktave (C3–C6)
            </button>
            <button
              onClick={() => setOctavesCount(2)}
              className={`py-1.5 rounded-lg border font-mono font-semibold cursor-pointer ${
                octavesCount === 2
                  ? 'bg-cyan-500/20 border-cyan-400 text-cyan-300'
                  : 'bg-slate-950 border-slate-800 text-slate-400'
              }`}
            >
              2 Oktave (C4–C6)
            </button>
          </div>
        </div>
      )}

      {/* Center Welcome Prompt (Disappears as soon as Camera or Sim Hand starts so upper 72% is 100% clear) */}
      {!cameraActive && !simHandActive && (
        <div className="relative z-20 my-auto mx-auto max-w-md px-6 py-6 rounded-2xl bg-[#0B0E17]/88 backdrop-blur-xl border border-slate-800/90 text-center flex flex-col items-center gap-3.5 shadow-2xl">
          <div className="w-11 h-11 rounded-xl bg-cyan-500/15 border border-cyan-500/40 flex items-center justify-center text-cyan-400">
            <Camera className="w-5 h-5" />
          </div>
          <h2 className="font-display text-lg font-bold text-slate-50">
            Kinelački Virtuelni Klavir (C3 – C6)
          </h2>
          <p className="text-xs text-slate-400 leading-relaxed">
            Gornjih <span className="text-slate-200 font-medium">72% ekrana</span> ostaje čisto za zrcalni prikaz kamere, dok je klavijatura na samom dnu.<br />
            <span className="text-cyan-300 font-medium">1 Prst = 1 Pokret = 1 Ton:</span> Ton se okida isključivo pri naglom savijanju zgloba ili spuštanju prsta (<span className="font-mono">IDLE → TRIGGER → LOCKED</span>).
          </p>
          {cameraError && (
            <div className="text-[11px] text-amber-300 bg-amber-950/50 border border-amber-500/40 rounded-lg px-3 py-1.5">
              {cameraError}
            </div>
          )}
          <div className="flex flex-wrap items-center justify-center gap-2.5 pt-1">
            <button
              onClick={toggleCameraAndAudio}
              className="px-4 py-2.5 rounded-lg bg-cyan-400 hover:bg-cyan-300 text-slate-950 text-xs font-bold flex items-center gap-2 cursor-pointer transition-all"
            >
              <Camera className="w-4 h-4" />
              <span>Start Camera &amp; Audio</span>
            </button>
            <button
              onClick={() => {
                synthEngine.init();
                setSimHandActive(true);
                simHandRef.current.active = true;
              }}
              className="px-3.5 py-2.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-200 text-xs font-semibold flex items-center gap-1.5 cursor-pointer transition-all"
            >
              <Hand className="w-4 h-4 text-amber-400" />
              <span>3D Simulacija Ruke</span>
            </button>
          </div>
        </div>
      )}

      {/* 4. BOTTOM PIANO KEYBOARD: Strictly Bottom 28% of Viewport Height (28vh) */}
      <section className="relative z-15 w-full h-[28vh] min-h-[195px] max-h-[290px] mt-auto bg-[#07090E]/78 backdrop-blur-xl border-t border-white/18 px-3 sm:px-4 pt-2 pb-3 flex flex-col gap-1.5 shadow-[0_-16px_48px_rgba(0,0,0,0.8)]">
        <div className="flex items-center justify-between px-1 text-[11px] font-mono text-slate-400">
          <span>
            KLAVIJATURA: C{startOctave} – C{startOctave + octavesCount} ({pianoKeys.length} DIRKI ·{' '}
            {PRESET_DEFAULTS[preset].name})
          </span>
          <span className="hidden sm:inline">
            STATE MACHINE: IDLE (Hover) → TRIGGER (dY/dt + Flexion) → LOCKED (Reset pri podizanju)
          </span>
        </div>

        {/* Piano Keys Container */}
        <div className="relative flex-1 w-full flex select-none">
          {/* White Keys */}
          {whiteKeys.map((keyDef) => {
            const isPressed = keyDef.note in activeNotesMap;
            const isHovered = hoveredNotesSet.has(keyDef.note);
            const isC = keyDef.baseName === 'C';
            return (
              <div
                key={keyDef.note}
                ref={(el) => {
                  if (el) keyElementsRef.current.set(keyDef.note, el);
                  else keyElementsRef.current.delete(keyDef.note);
                }}
                onPointerDown={(e) => {
                  e.currentTarget.setPointerCapture(e.pointerId);
                  const stageRect = stageRef.current?.getBoundingClientRect();
                  const ripple = stageRect
                    ? { x: e.clientX - stageRect.left, y: e.clientY - stageRect.top }
                    : undefined;
                  triggerNoteAttack(keyDef, 0.85, `ptr_${e.pointerId}`, 'Dodir', ripple);
                }}
                onPointerUp={(e) => triggerNoteRelease(keyDef.note, `ptr_${e.pointerId}`)}
                onPointerCancel={(e) => triggerNoteRelease(keyDef.note, `ptr_${e.pointerId}`)}
                onPointerLeave={(e) => {
                  if (e.buttons > 0) {
                    triggerNoteRelease(keyDef.note, `ptr_${e.pointerId}`);
                  }
                }}
                className={`flex-1 h-full mx-[1px] rounded-b-lg border flex flex-col justify-end items-center pb-2.5 cursor-pointer relative z-[5] transition-all duration-75 ${
                  isPressed
                    ? 'translate-y-1.5 bg-gradient-to-b from-cyan-300 via-cyan-400 to-cyan-500 border-cyan-100 shadow-[0_0_32px_rgba(6,182,212,0.85)]'
                    : isHovered
                    ? 'bg-gradient-to-b from-cyan-50/95 to-cyan-200/88 border-cyan-400/80'
                    : 'bg-gradient-to-b from-white/92 via-slate-100/86 to-slate-200/80 border-white/45 hover:from-white/95 hover:to-slate-100/90'
                }`}
              >
                <span
                  className={`font-mono text-[10px] sm:text-[11px] tracking-tighter ${
                    isPressed
                      ? 'text-slate-950 font-bold'
                      : isC
                      ? 'text-cyan-950 font-bold'
                      : 'text-slate-800 font-semibold'
                  }`}
                >
                  {keyDef.note}
                </span>
              </div>
            );
          })}

          {/* Black Keys */}
          {blackKeys.map((keyDef) => {
            const isPressed = keyDef.note in activeNotesMap;
            const isHovered = hoveredNotesSet.has(keyDef.note);
            const whiteKeyWidthPercent = 100 / whiteKeys.length;
            const blackKeyWidthPercent = whiteKeyWidthPercent * 0.64;
            const leftPercent =
              (keyDef.whiteIndex + 1) * whiteKeyWidthPercent - blackKeyWidthPercent / 2;

            return (
              <div
                key={keyDef.note}
                ref={(el) => {
                  if (el) keyElementsRef.current.set(keyDef.note, el);
                  else keyElementsRef.current.delete(keyDef.note);
                }}
                style={{
                  width: `${blackKeyWidthPercent}%`,
                  left: `${leftPercent}%`,
                }}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  e.currentTarget.setPointerCapture(e.pointerId);
                  const stageRect = stageRef.current?.getBoundingClientRect();
                  const ripple = stageRect
                    ? { x: e.clientX - stageRect.left, y: e.clientY - stageRect.top }
                    : undefined;
                  triggerNoteAttack(keyDef, 0.9, `ptr_${e.pointerId}`, 'Dodir', ripple);
                }}
                onPointerUp={(e) => {
                  e.stopPropagation();
                  triggerNoteRelease(keyDef.note, `ptr_${e.pointerId}`);
                }}
                onPointerCancel={(e) => {
                  e.stopPropagation();
                  triggerNoteRelease(keyDef.note, `ptr_${e.pointerId}`);
                }}
                onPointerLeave={(e) => {
                  if (e.buttons > 0) {
                    triggerNoteRelease(keyDef.note, `ptr_${e.pointerId}`);
                  }
                }}
                className={`absolute top-0 h-[60%] rounded-b-md border z-[12] flex flex-col justify-end items-center pb-2 cursor-pointer transition-all duration-75 ${
                  isPressed
                    ? 'translate-y-1 bg-gradient-to-b from-amber-300 via-amber-400 to-amber-500 border-amber-100 shadow-[0_0_26px_rgba(245,158,11,0.9)]'
                    : isHovered
                    ? 'bg-gradient-to-b from-slate-800 to-slate-900 border-amber-400/85'
                    : 'bg-gradient-to-b from-slate-900/96 via-slate-950/99 to-black border-slate-700/80 shadow-[0_8px_18px_rgba(0,0,0,0.78)]'
                }`}
              >
                <span
                  className={`font-mono text-[8px] sm:text-[9px] font-semibold ${
                    isPressed ? 'text-slate-950 font-bold' : 'text-slate-300'
                  }`}
                >
                  {keyDef.note}
                </span>
              </div>
            );
          })}
        </div>
      </section>

      {/* Single-File HTML Code Modal */}
      {showHtmlModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-[#0B0E17] border border-slate-800 rounded-2xl max-w-5xl w-full max-h-[88vh] flex flex-col overflow-hidden shadow-2xl">
            <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between gap-4">
              <div>
                <h3 className="font-display text-lg font-bold text-slate-50">
                  Kompletan Single-File HTML Kod (C3–C6 · Kinelački State Machine)
                </h3>
                <p className="text-xs text-slate-400">
                  Spreman za direktno pokretanje u Google Chrome ili Firefox pregledaču.
                </p>
              </div>
              <div className="flex items-center gap-2.5">
                <button
                  onClick={handleCopyStandaloneHtml}
                  className="px-3.5 py-2 rounded-lg bg-slate-900 border border-slate-700 hover:border-cyan-400 text-xs font-semibold text-slate-100 flex items-center gap-1.5 cursor-pointer"
                >
                  {copiedHtml ? (
                    <>
                      <Check className="w-4 h-4 text-emerald-400" />
                      <span className="text-emerald-300">Kopirano!</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-4 h-4 text-cyan-400" />
                      <span>Kopiraj HTML</span>
                    </>
                  )}
                </button>
                <button
                  onClick={handleDownloadStandaloneHtml}
                  className="px-3.5 py-2 rounded-lg bg-cyan-400 hover:bg-cyan-300 text-slate-950 text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                >
                  <Download className="w-4 h-4" />
                  <span>Preuzmi .HTML</span>
                </button>
                <button
                  onClick={() => setShowHtmlModal(false)}
                  className="p-2 rounded-lg text-slate-400 hover:text-white cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>
            <pre className="p-5 text-xs font-mono text-slate-300 overflow-auto flex-1 leading-relaxed select-all">
              {STANDALONE_HTML_SOURCE}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}
