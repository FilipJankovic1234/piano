export type SynthPresetId = 'grand-piano' | 'electric-rhodes' | 'analog-poly' | 'crystal-pad';

export interface ADSRConfig {
  attack: number;   // seconds (0.002 - 0.5)
  decay: number;    // seconds (0.05 - 1.5)
  sustain: number;  // level (0.0 - 1.0)
  release: number;  // seconds (0.05 - 2.5)
}

export interface SynthParams {
  preset: SynthPresetId;
  volume: number;       // 0.0 - 1.0
  filterCutoff: number; // Hz (400 - 12000)
  reverbMix: number;    // 0.0 - 0.8
  adsr: ADSRConfig;
}

export interface PianoKeyDef {
  note: string;       // e.g. "C3", "C#3" ... "C6"
  midi: number;       // e.g. 48 ... 84
  freq: number;       // e.g. 130.81 ... 1046.50
  isBlack: boolean;
  octave: number;
  baseName: string;   // C, C#, D...
  keyboardShortcut?: string;
  whiteIndex: number; // index among white keys (for positioning black keys)
}

export const PRESET_DEFAULTS: Record<
  SynthPresetId,
  { name: string; subtitle: string; adsr: ADSRConfig; filterCutoff: number; reverbMix: number }
> = {
  'grand-piano': {
    name: 'Concert Grand Piano',
    subtitle: 'Bogata harmonijska sinteza sa čekić-tranzijentom',
    adsr: { attack: 0.006, decay: 0.52, sustain: 0.24, release: 0.65 },
    filterCutoff: 5200,
    reverbMix: 0.28,
  },
  'electric-rhodes': {
    name: 'Vintage Tine EP',
    subtitle: 'Topli elektro-mehanički klavir sa zvonastim napadom',
    adsr: { attack: 0.01, decay: 0.65, sustain: 0.38, release: 0.78 },
    filterCutoff: 3800,
    reverbMix: 0.34,
  },
  'analog-poly': {
    name: 'Warm Analog Poly',
    subtitle: 'Dvostruki detunirani oscilator sa rezonantnim filterom',
    adsr: { attack: 0.015, decay: 0.4, sustain: 0.6, release: 0.5 },
    filterCutoff: 5600,
    reverbMix: 0.32,
  },
  'crystal-pad': {
    name: 'Glass Harmonic Pad',
    subtitle: 'Prozračni stakleni registar sa dugim odjekom',
    adsr: { attack: 0.045, decay: 0.85, sustain: 0.68, release: 1.3 },
    filterCutoff: 4400,
    reverbMix: 0.48,
  },
};

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const SHORTCUT_MAP = [
  'Z', 'S', 'X', 'D', 'C', 'V', 'G', 'B', 'H', 'N', 'J', 'M',
  'Q', '2', 'W', '3', 'E', 'R', '5', 'T', '6', 'Y', '7', 'U',
  'I', '9', 'O', '0', 'P', '[', '=', ']',
];

export function generateKeyboardKeys(startOctave = 3, octavesCount = 3): PianoKeyDef[] {
  const keys: PianoKeyDef[] = [];
  let whiteIdx = 0;
  const totalSemitones = octavesCount * 12 + 1; // e.g. 3 octaves = 37 keys (C3..C6)
  const startMidi = (startOctave + 1) * 12; // C3 = 48, C4 = 60

  for (let i = 0; i < totalSemitones; i++) {
    const midi = startMidi + i;
    const noteIndex = midi % 12;
    const octave = Math.floor(midi / 12) - 1;
    const baseName = NOTE_NAMES[noteIndex];
    const isBlack = baseName.includes('#');
    const freq = 440 * Math.pow(2, (midi - 69) / 12);

    const currentWhiteIndex = isBlack ? whiteIdx - 1 : whiteIdx;
    if (!isBlack) {
      whiteIdx++;
    }

    keys.push({
      note: `${baseName}${octave}`,
      midi,
      freq: Number(freq.toFixed(2)),
      isBlack,
      octave,
      baseName,
      keyboardShortcut: SHORTCUT_MAP[i],
      whiteIndex: currentWhiteIndex,
    });
  }

  return keys;
}

interface ActiveVoice {
  oscillators: OscillatorNode[];
  voiceGain: GainNode;
  filterNode: BiquadFilterNode;
  sources: Set<string>;
  startedAt: number;
  velocity: number;
}

export class PolySynthEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private compressor: DynamicsCompressorNode | null = null;
  private analyser: AnalyserNode | null = null;
  private delayNodeL: DelayNode | null = null;
  private delayNodeR: DelayNode | null = null;
  private reverbSendGain: GainNode | null = null;
  private activeVoices: Map<string, ActiveVoice> = new Map();

  private params: SynthParams = {
    preset: 'grand-piano',
    volume: 0.82,
    filterCutoff: PRESET_DEFAULTS['grand-piano'].filterCutoff,
    reverbMix: PRESET_DEFAULTS['grand-piano'].reverbMix,
    adsr: { ...PRESET_DEFAULTS['grand-piano'].adsr },
  };

  public init(): AudioContext {
    if (!this.ctx) {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AudioCtx({ latencyHint: 'interactive' });

      this.compressor = this.ctx.createDynamicsCompressor();
      this.compressor.threshold.value = -15;
      this.compressor.knee.value = 16;
      this.compressor.ratio.value = 4;
      this.compressor.attack.value = 0.002;
      this.compressor.release.value = 0.16;

      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = this.params.volume;

      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 1024;
      this.analyser.smoothingTimeConstant = 0.82;

      // Stereo acoustic room network
      this.reverbSendGain = this.ctx.createGain();
      this.reverbSendGain.gain.value = this.params.reverbMix;

      this.delayNodeL = this.ctx.createDelay(1.0);
      this.delayNodeR = this.ctx.createDelay(1.0);
      this.delayNodeL.delayTime.value = 0.11;
      this.delayNodeR.delayTime.value = 0.165;

      const feedbackL = this.ctx.createGain();
      const feedbackR = this.ctx.createGain();
      feedbackL.gain.value = 0.33;
      feedbackR.gain.value = 0.33;

      const dampFilter = this.ctx.createBiquadFilter();
      dampFilter.type = 'lowpass';
      dampFilter.frequency.value = 2800;

      this.reverbSendGain.connect(dampFilter);
      dampFilter.connect(this.delayNodeL);
      dampFilter.connect(this.delayNodeR);

      this.delayNodeL.connect(feedbackL);
      feedbackL.connect(this.delayNodeR);
      this.delayNodeR.connect(feedbackR);
      feedbackR.connect(this.delayNodeL);

      this.delayNodeL.connect(this.compressor);
      this.delayNodeR.connect(this.compressor);

      this.compressor.connect(this.masterGain);
      this.masterGain.connect(this.analyser);
      this.analyser.connect(this.ctx.destination);
    }

    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }

    return this.ctx;
  }

  public isReady(): boolean {
    return !!this.ctx && this.ctx.state === 'running';
  }

  public getAnalyser(): AnalyserNode | null {
    return this.analyser;
  }

  public updateParams(next: Partial<SynthParams>) {
    this.params = {
      ...this.params,
      ...next,
      adsr: next.adsr ? { ...this.params.adsr, ...next.adsr } : this.params.adsr,
    };

    if (this.ctx && this.masterGain) {
      this.masterGain.gain.setTargetAtTime(this.params.volume, this.ctx.currentTime, 0.015);
    }
    if (this.ctx && this.reverbSendGain) {
      this.reverbSendGain.gain.setTargetAtTime(this.params.reverbMix, this.ctx.currentTime, 0.02);
    }
  }

  public triggerAttack(note: string, freq: number, velocity = 0.8, sourceId = 'default'): void {
    const ctx = this.init();
    const now = ctx.currentTime;
    const clampedVel = Math.min(1.0, Math.max(0.18, velocity));

    const existing = this.activeVoices.get(note);
    if (existing) {
      existing.sources.add(sourceId);
      const peakGain = Math.min(0.48, Math.max(0.08, Math.pow(clampedVel, 1.35) * 0.44));
      existing.voiceGain.gain.cancelScheduledValues(now);
      existing.voiceGain.gain.setValueAtTime(Math.max(0.01, existing.voiceGain.gain.value), now);
      existing.voiceGain.gain.linearRampToValueAtTime(peakGain, now + this.params.adsr.attack);
      existing.voiceGain.gain.exponentialRampToValueAtTime(
        Math.max(0.001, peakGain * this.params.adsr.sustain),
        now + this.params.adsr.attack + this.params.adsr.decay
      );
      return;
    }

    const voiceGain = ctx.createGain();
    voiceGain.gain.setValueAtTime(0.0001, now);

    // Velocity-sensitive low-pass filter envelope (harder finger strike = brighter timbre)
    const filterNode = ctx.createBiquadFilter();
    filterNode.type = 'lowpass';
    const dynamicCutoff = Math.min(
      15000,
      this.params.filterCutoff * (0.4 + Math.pow(clampedVel, 1.2) * 1.15)
    );
    filterNode.frequency.setValueAtTime(dynamicCutoff, now);
    filterNode.frequency.exponentialRampToValueAtTime(
      Math.max(320, this.params.filterCutoff * 0.38),
      now + this.params.adsr.decay * 1.5
    );
    filterNode.Q.value = this.params.preset === 'analog-poly' ? 3.0 : 1.0;

    const oscillators: OscillatorNode[] = [];
    const { preset, adsr } = this.params;

    if (preset === 'grand-piano') {
      // Fundamental warm triangle + sine body + 2nd & 3rd harmonics + hammer strike transient
      const osc1 = ctx.createOscillator();
      osc1.type = 'triangle';
      osc1.frequency.setValueAtTime(freq, now);

      const osc2 = ctx.createOscillator();
      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(freq, now);
      osc2.detune.setValueAtTime(-2.5, now);

      const osc3 = ctx.createOscillator();
      osc3.type = 'sine';
      osc3.frequency.setValueAtTime(freq * 2, now);
      osc3.detune.setValueAtTime(3.5, now);

      const osc4 = ctx.createOscillator();
      osc4.type = 'sine';
      osc4.frequency.setValueAtTime(freq * 3, now);

      const g1 = ctx.createGain();
      const g2 = ctx.createGain();
      const g3 = ctx.createGain();
      const g4 = ctx.createGain();

      g1.gain.value = 0.58;
      g2.gain.value = 0.45;
      g3.gain.value = 0.2 * clampedVel;
      g4.gain.setValueAtTime(0.09 * clampedVel * clampedVel, now);
      g4.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);

      // Percussive hammer transient
      const hammerOsc = ctx.createOscillator();
      hammerOsc.type = 'triangle';
      hammerOsc.frequency.setValueAtTime(freq * 5.5, now);
      const hammerGain = ctx.createGain();
      hammerGain.gain.setValueAtTime(0.16 * Math.pow(clampedVel, 1.4), now);
      hammerGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.028);

      osc1.connect(g1);
      osc2.connect(g2);
      osc3.connect(g3);
      osc4.connect(g4);
      hammerOsc.connect(hammerGain);

      g1.connect(filterNode);
      g2.connect(filterNode);
      g3.connect(filterNode);
      g4.connect(filterNode);
      hammerGain.connect(filterNode);

      oscillators.push(osc1, osc2, osc3, osc4, hammerOsc);
    } else if (preset === 'electric-rhodes') {
      const osc1 = ctx.createOscillator();
      osc1.type = 'sine';
      osc1.frequency.setValueAtTime(freq, now);

      const osc2 = ctx.createOscillator();
      osc2.type = 'triangle';
      osc2.frequency.setValueAtTime(freq, now);
      osc2.detune.setValueAtTime(5, now);

      const tineOsc = ctx.createOscillator();
      tineOsc.type = 'sine';
      tineOsc.frequency.setValueAtTime(freq * 7, now);
      const tineGain = ctx.createGain();
      tineGain.gain.setValueAtTime(0.13 * clampedVel, now);
      tineGain.gain.exponentialRampToValueAtTime(0.0008, now + 0.19);

      osc1.connect(filterNode);
      osc2.connect(filterNode);
      tineOsc.connect(tineGain);
      tineGain.connect(filterNode);

      oscillators.push(osc1, osc2, tineOsc);
    } else if (preset === 'analog-poly') {
      const osc1 = ctx.createOscillator();
      osc1.type = 'sawtooth';
      osc1.frequency.setValueAtTime(freq, now);
      osc1.detune.setValueAtTime(-7, now);

      const osc2 = ctx.createOscillator();
      osc2.type = 'sawtooth';
      osc2.frequency.setValueAtTime(freq, now);
      osc2.detune.setValueAtTime(7, now);

      const subOsc = ctx.createOscillator();
      subOsc.type = 'square';
      subOsc.frequency.setValueAtTime(freq * 0.5, now);
      const subGain = ctx.createGain();
      subGain.gain.value = 0.2;

      const sawMix = ctx.createGain();
      sawMix.gain.value = 0.34;

      osc1.connect(sawMix);
      osc2.connect(sawMix);
      subOsc.connect(subGain);
      sawMix.connect(filterNode);
      subGain.connect(filterNode);

      oscillators.push(osc1, osc2, subOsc);
    } else {
      const osc1 = ctx.createOscillator();
      osc1.type = 'triangle';
      osc1.frequency.setValueAtTime(freq, now);
      osc1.detune.setValueAtTime(-9, now);

      const osc2 = ctx.createOscillator();
      osc2.type = 'triangle';
      osc2.frequency.setValueAtTime(freq, now);
      osc2.detune.setValueAtTime(9, now);

      const shimmerOsc = ctx.createOscillator();
      shimmerOsc.type = 'sine';
      shimmerOsc.frequency.setValueAtTime(freq * 2, now);
      const shimmerGain = ctx.createGain();
      shimmerGain.gain.value = 0.22 * clampedVel;

      osc1.connect(filterNode);
      osc2.connect(filterNode);
      shimmerOsc.connect(shimmerGain);
      shimmerGain.connect(filterNode);

      oscillators.push(osc1, osc2, shimmerOsc);
    }

    filterNode.connect(voiceGain);
    if (this.compressor) {
      voiceGain.connect(this.compressor);
    }
    if (this.reverbSendGain) {
      voiceGain.connect(this.reverbSendGain);
    }

    const peakGain = Math.min(0.48, Math.max(0.08, Math.pow(clampedVel, 1.35) * 0.44));
    const sustainLevel = Math.max(0.001, peakGain * adsr.sustain);

    voiceGain.gain.setValueAtTime(0.0001, now);
    voiceGain.gain.linearRampToValueAtTime(peakGain, now + adsr.attack);
    voiceGain.gain.exponentialRampToValueAtTime(sustainLevel, now + adsr.attack + adsr.decay);

    oscillators.forEach((osc) => osc.start(now));

    this.activeVoices.set(note, {
      oscillators,
      voiceGain,
      filterNode,
      sources: new Set([sourceId]),
      startedAt: now,
      velocity: clampedVel,
    });
  }

  public triggerRelease(note: string, sourceId = 'default'): void {
    if (!this.ctx) return;
    const voice = this.activeVoices.get(note);
    if (!voice) return;

    voice.sources.delete(sourceId);
    if (voice.sources.size > 0) {
      return;
    }

    this.activeVoices.delete(note);
    const now = this.ctx.currentTime;
    const releaseTime = this.params.adsr.release;

    try {
      voice.voiceGain.gain.cancelScheduledValues(now);
      voice.voiceGain.gain.setValueAtTime(Math.max(0.0001, voice.voiceGain.gain.value), now);
      voice.voiceGain.gain.exponentialRampToValueAtTime(0.0001, now + releaseTime);

      voice.oscillators.forEach((osc) => {
        try {
          osc.stop(now + releaseTime + 0.03);
        } catch {
          // Ignore already stopped
        }
      });

      setTimeout(() => {
        try {
          voice.voiceGain.disconnect();
          voice.filterNode.disconnect();
        } catch {
          // Ignore disconnect errors
        }
      }, (releaseTime + 0.08) * 1000);
    } catch {
      // Safe cleanup
    }
  }

  public panicAllOff(): void {
    for (const note of Array.from(this.activeVoices.keys())) {
      const voice = this.activeVoices.get(note);
      if (voice) {
        for (const src of Array.from(voice.sources)) {
          this.triggerRelease(note, src);
        }
      }
    }
  }
}

export const synthEngine = new PolySynthEngine();
