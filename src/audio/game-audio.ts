/**
 * Web Audio for the car, adapted from the owner's other Boston prototype: an
 * engine made of an idle loop and a driving loop crossfaded and pitched by a
 * simulated gearbox, road noise that follows speed, a tyre scrub loop for
 * tight turns and handbrake slides, impact thuds scaled by the change in
 * velocity, a horn and a neighbourhood ambience bed. Everything plays from
 * local files; the browser never calls the sound service. The context starts
 * on the first key or pointer gesture, as browsers require, and the master
 * gain closes while the tab is hidden.
 */
type SoundName = 'engine-idle' | 'engine-drive' | 'city-ambience' | 'tire-road' | 'tire-skid' | 'horn' | 'impact-light' | 'impact-heavy';

interface Loop {
  source: AudioBufferSourceNode;
  gain: GainNode;
  filter: BiquadFilterNode;
}

export interface AudioControls {
  steer: number;
  handbrake: boolean;
  /** Sideways speed of the chassis, metres per second. */
  slip: number;
}

const LOOPS: SoundName[] = ['engine-idle', 'engine-drive', 'city-ambience', 'tire-road', 'tire-skid'];
const ONE_SHOTS: SoundName[] = ['horn', 'impact-light', 'impact-heavy'];
const MASTER_LEVEL = 0.75;
/** Speeds (m/s) at which the automatic gearbox shifts up; shifting down happens a little lower. */
const SHIFTS = [0, 6.5, 12.8, 20, 29, 40];
const clamp = (value: number, low = 0, high = 1): number => Math.max(low, Math.min(high, value));

export class GameAudio {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private readonly buffers = new Map<SoundName, AudioBuffer>();
  private readonly loops = new Map<SoundName, Loop>();
  private readonly failed = new Set<SoundName>();
  private readonly oneShots = new Set<AudioBufferSourceNode>();
  private readonly base: string;
  private mutedFlag = false;
  private paused = false;
  private gear = 0;
  private rpm = 850;
  private previousTime = 0;
  private lastHorn = -Infinity;
  private lastImpact = -Infinity;
  private gate = -1;

  constructor(base: string) {
    this.base = base;
    window.addEventListener('keydown', this.start, { capture: true });
    window.addEventListener('pointerdown', this.start, { capture: true });
    document.addEventListener('visibilitychange', this.visibilityChanged);
    window.addEventListener('pagehide', this.hidePage);
  }

  /** True once the loops are playing. */
  get ready(): boolean {
    return this.loops.size > 0;
  }

  get muted(): boolean {
    return this.mutedFlag;
  }

  /** A read-only snapshot for the diagnostics. */
  get status(): { context: string; loaded: number; failed: string[]; rpm: number; gear: number } {
    return { context: this.context?.state ?? 'not-started', loaded: this.buffers.size, failed: [...this.failed], rpm: Math.round(this.rpm), gear: this.gear + 1 };
  }

  /** Creates the context inside a user gesture; later calls only resume it. */
  readonly start = (): void => {
    if (!this.context) {
      let context: AudioContext;
      try {
        context = new AudioContext({ latencyHint: 'interactive' });
      } catch {
        return;
      }
      this.context = context;
      this.master = context.createGain();
      this.master.gain.value = 0;
      const highpass = context.createBiquadFilter();
      highpass.type = 'highpass';
      highpass.frequency.value = 35;
      const compressor = context.createDynamicsCompressor();
      compressor.threshold.value = -14;
      compressor.knee.value = 18;
      compressor.ratio.value = 4;
      compressor.attack.value = 0.008;
      compressor.release.value = 0.18;
      this.master.connect(highpass);
      highpass.connect(compressor);
      compressor.connect(context.destination);
      void this.loadSounds();
    }
    this.resume();
  };

  /**
   * Per frame. `speed` is the signed forward speed in metres per second and
   * `throttle` the signed pedal (negative brakes or reverses).
   */
  update(speed: number, throttle: number, controls: AudioControls): void {
    const context = this.context;
    if (!context) return;
    this.syncMaster();
    const now = context.currentTime;
    const dt = clamp(now - this.previousTime, 0, 0.1);
    this.previousTime = now;
    if (this.paused || document.hidden) return;

    const velocity = Math.abs(Number.isFinite(speed) ? speed : 0);
    const pedal = clamp(Number.isFinite(throttle) ? Math.abs(throttle) : 0);
    const braking = speed * throttle < -0.5;
    const load = braking ? 0 : pedal;
    // Gentle automatic shifts keep the engine from becoming a rising siren.
    if (speed < -0.2) this.gear = 0;
    else {
      while (this.gear < 4 && velocity > SHIFTS[this.gear + 1] + 0.7) this.gear += 1;
      while (this.gear > 0 && velocity < SHIFTS[this.gear] - 0.9) this.gear -= 1;
    }
    const span = SHIFTS[this.gear + 1] - SHIFTS[this.gear];
    const progress = clamp((velocity - SHIFTS[this.gear]) / span, 0, 1.2);
    const targetRpm = velocity < 0.7 ? 850 + load * 1050 : 1250 + progress * 2300 + load * 450;
    this.rpm += (targetRpm - this.rpm) * (1 - Math.exp(-dt * 5));
    const mix = clamp(Math.max(velocity / 6, load * 0.52));
    this.setLoop('engine-idle', Math.cos((mix * Math.PI) / 2) * (0.43 + load * 0.12), clamp(this.rpm / 1000, 0.82, 1.55), 780 + load * 650);
    this.setLoop('engine-drive', Math.sin((mix * Math.PI) / 2) * (0.46 + load * 0.3), clamp(this.rpm / 2600, 0.55, 1.8), 1300 + load * 2400 + this.rpm * 0.25);
    this.setLoop('city-ambience', 0.17 / (1 + velocity * 0.035), 1, 4200);
    this.setLoop('tire-road', Math.pow(clamp(velocity / 25), 0.8) * 0.44, clamp(0.62 + velocity / 32, 0.62, 1.6), 1400 + velocity * 90);

    const steer = clamp(Math.abs(controls.steer));
    const cornerScrub = clamp((steer * velocity * velocity - 115) / 200) * 0.5;
    const lockedTires = controls.handbrake ? clamp((velocity - 1.5) / 8) : 0;
    const sliding = clamp((controls.slip - 2.5) / 5) * 0.6;
    const hardBraking = braking && pedal > 0.85 && velocity > 8 ? 0.2 : 0;
    this.setLoop('tire-skid', Math.max(cornerScrub, lockedTires, sliding, hardBraking) * 0.32, clamp(0.85 + velocity * 0.014, 0.85, 1.4), 3600);
  }

  horn(): void {
    const context = this.context;
    if (!context || this.mutedFlag || this.paused || document.hidden) return;
    const now = context.currentTime;
    if (now - this.lastHorn < 0.7) return;
    this.resume();
    this.lastHorn = now;
    this.oneShot('horn', 0.7, 1);
  }

  /** A thud scaled by the change in velocity, metres per second. */
  impact(deltaV: number): void {
    const context = this.context;
    if (!context || this.mutedFlag || this.paused || document.hidden) return;
    const now = context.currentTime;
    if (now - this.lastImpact < 0.22) return;
    this.lastImpact = now;
    if (deltaV > 7) this.oneShot('impact-heavy', clamp(0.45 + deltaV * 0.05, 0, 0.9), 0.95 + Math.random() * 0.1);
    else this.oneShot('impact-light', clamp(0.25 + deltaV * 0.1, 0, 0.8), 0.9 + Math.random() * 0.2);
  }

  toggleMute(): boolean {
    this.mutedFlag = !this.mutedFlag;
    if (this.mutedFlag) this.stopOneShots();
    this.syncMaster();
    if (!this.mutedFlag) this.resume();
    return this.mutedFlag;
  }

  setPaused(paused: boolean): void {
    if (paused && !this.paused) this.stopOneShots();
    this.paused = paused;
    this.syncMaster();
  }

  private readonly resume = (): void => {
    if (!this.mutedFlag && !document.hidden && this.context?.state === 'suspended') void this.context.resume().catch(() => undefined);
  };

  private readonly visibilityChanged = (): void => {
    if (document.hidden) this.stopOneShots();
    this.syncMaster();
    if (!document.hidden) this.resume();
  };

  private readonly hidePage = (): void => {
    this.paused = true;
    this.stopOneShots();
    this.syncMaster();
  };

  private syncMaster(): void {
    if (!this.context || !this.master) return;
    const target = this.mutedFlag || this.paused || document.hidden ? 0 : MASTER_LEVEL;
    if (target === this.gate) return;
    this.gate = target;
    this.master.gain.setTargetAtTime(target, this.context.currentTime, target === 0 ? 0.025 : 0.09);
  }

  private async loadSounds(): Promise<void> {
    const context = this.context!;
    await Promise.all(
      [...LOOPS, ...ONE_SHOTS].map(async (name) => {
        try {
          const response = await fetch(`${this.base}${name}.mp3`, { signal: AbortSignal.timeout(15_000) });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          let buffer = await context.decodeAudioData(await response.arrayBuffer());
          const loop = LOOPS.includes(name);
          if (loop) buffer = this.seamlessBuffer(buffer);
          this.normalize(buffer, loop ? 0.13 : 0.2);
          this.buffers.set(name, buffer);
          if (loop) this.createLoop(name, buffer);
        } catch (err) {
          this.failed.add(name);
          console.warn(`audio: ${name} unavailable`, err);
        }
      }),
    );
  }

  private createLoop(name: SoundName, buffer: AudioBuffer): void {
    const context = this.context!;
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    const filter = context.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = 0.5;
    const gain = context.createGain();
    gain.gain.value = 0;
    source.connect(filter);
    filter.connect(gain);
    gain.connect(this.master!);
    this.loops.set(name, { source, gain, filter });
    source.start();
  }

  private setLoop(name: SoundName, volume: number, rate: number, cutoff: number): void {
    const loop = this.loops.get(name);
    if (!loop || !this.context) return;
    const now = this.context.currentTime;
    let level = volume;
    if (name === 'engine-idle' && this.failed.has('engine-drive')) level = Math.max(level, 0.46);
    if (name === 'engine-drive' && this.failed.has('engine-idle')) level = Math.max(level, 0.4);
    loop.gain.gain.setTargetAtTime(level, now, name === 'tire-skid' ? 0.07 : 0.14);
    loop.source.playbackRate.setTargetAtTime(rate, now, 0.12);
    loop.filter.frequency.setTargetAtTime(cutoff, now, 0.12);
  }

  private oneShot(name: SoundName, volume: number, rate: number): void {
    const context = this.context;
    const buffer = this.buffers.get(name);
    if (!context || !buffer || !this.master) return;
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = rate;
    const gain = context.createGain();
    gain.gain.value = volume;
    source.connect(gain);
    gain.connect(this.master);
    this.oneShots.add(source);
    source.onended = () => {
      this.oneShots.delete(source);
      source.disconnect();
      gain.disconnect();
    };
    source.start();
  }

  /** Crossfades the final 60 ms into the beginning to soften codec and loop seams. */
  private seamlessBuffer(input: AudioBuffer): AudioBuffer {
    const overlap = Math.min(Math.floor(input.sampleRate * 0.06), Math.floor(input.length / 4));
    const length = input.length - overlap;
    const output = this.context!.createBuffer(input.numberOfChannels, length, input.sampleRate);
    for (let channel = 0; channel < input.numberOfChannels; channel += 1) {
      const source = input.getChannelData(channel);
      const target = output.getChannelData(channel);
      target.set(source.subarray(overlap));
      for (let i = 0; i < overlap; i += 1) {
        const t = i / (overlap - 1);
        target[length - overlap + i] = source[input.length - overlap + i] * (1 - t) + source[i] * t;
      }
    }
    return output;
  }

  /** Brings differing generations to a common loudness, keeping peak headroom. */
  private normalize(buffer: AudioBuffer, targetRms: number): void {
    let energy = 0;
    let peak = 0;
    for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
      const samples = buffer.getChannelData(channel);
      for (let i = 0; i < samples.length; i += 1) {
        energy += samples[i] * samples[i];
        peak = Math.max(peak, Math.abs(samples[i]));
      }
    }
    const rms = Math.sqrt(energy / (buffer.length * buffer.numberOfChannels));
    const scale = Math.min(targetRms / Math.max(0.001, rms), 0.75 / Math.max(0.001, peak), 4);
    for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
      const samples = buffer.getChannelData(channel);
      for (let i = 0; i < samples.length; i += 1) samples[i] *= scale;
    }
  }

  private stopOneShots(): void {
    for (const source of this.oneShots) {
      try {
        source.stop();
      } catch {
        // Already ended.
      }
    }
    this.oneShots.clear();
  }
}
