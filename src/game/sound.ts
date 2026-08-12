let context: AudioContext | null = null;

function audioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const AudioContextClass = window.AudioContext;
  if (!AudioContextClass) return null;
  context ??= new AudioContextClass();
  return context;
}

export async function primeAudio(): Promise<void> {
  const audio = audioContext();
  if (audio?.state === "suspended") await audio.resume();
}

function tone(
  frequency: number,
  duration: number,
  options: {
    delay?: number;
    endFrequency?: number;
    gain?: number;
    type?: OscillatorType;
  } = {},
): void {
  const audio = audioContext();
  if (!audio || audio.state !== "running") return;
  const start = audio.currentTime + (options.delay ?? 0);
  const end = start + duration;
  const oscillator = audio.createOscillator();
  const volume = audio.createGain();

  oscillator.type = options.type ?? "square";
  oscillator.frequency.setValueAtTime(frequency, start);
  if (options.endFrequency) {
    oscillator.frequency.exponentialRampToValueAtTime(options.endFrequency, end);
  }
  volume.gain.setValueAtTime(0.0001, start);
  volume.gain.exponentialRampToValueAtTime(options.gain ?? 0.055, start + Math.min(0.012, duration / 3));
  volume.gain.exponentialRampToValueAtTime(0.0001, end);
  oscillator.connect(volume);
  volume.connect(audio.destination);
  oscillator.start(start);
  oscillator.stop(end + 0.02);
}

export function playCountdownBeep(go = false): void {
  void primeAudio();
  if (go) {
    tone(988, 0.46, { endFrequency: 1319, gain: 0.07 });
    tone(494, 0.46, { endFrequency: 659, gain: 0.025, type: "triangle" });
  } else {
    tone(784, 0.105, { gain: 0.06 });
  }
}

export function playCorrectSound(): void {
  void primeAudio();
  tone(660, 0.055, { endFrequency: 880, gain: 0.04 });
  tone(990, 0.07, { delay: 0.045, endFrequency: 1180, gain: 0.045 });
}

export function playWrongSound(): void {
  void primeAudio();
  tone(190, 0.13, { endFrequency: 92, gain: 0.055, type: "sawtooth" });
  tone(125, 0.1, { delay: 0.03, endFrequency: 72, gain: 0.025, type: "square" });
}

export function playGoalSound(): void {
  void primeAudio();
  [523, 659, 784, 1047].forEach((frequency, index) => {
    tone(frequency, index === 3 ? 0.48 : 0.16, {
      delay: index * 0.11,
      gain: index === 3 ? 0.065 : 0.05,
    });
  });
  tone(262, 0.75, { gain: 0.025, type: "triangle" });
}
