let context: AudioContext | null = null

/**
 * A short camera-shutter click, synthesised so no audio file has to ship.
 * Two filtered noise bursts: the shutter opening, then closing.
 */
export function playShutter(): void {
  try {
    context ??= new AudioContext()
    const ctx = context
    if (ctx.state === 'suspended') void ctx.resume()
    const now = ctx.currentTime
    const burst = (at: number, frequency: number, level: number): void => {
      const length = Math.floor(ctx.sampleRate * 0.07)
      const buffer = ctx.createBuffer(1, length, ctx.sampleRate)
      const data = buffer.getChannelData(0)
      for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / length) ** 2
      const source = ctx.createBufferSource()
      source.buffer = buffer
      const filter = ctx.createBiquadFilter()
      filter.type = 'bandpass'
      filter.frequency.value = frequency
      filter.Q.value = 0.9
      const gain = ctx.createGain()
      gain.gain.setValueAtTime(0, now + at)
      gain.gain.linearRampToValueAtTime(level, now + at + 0.004)
      gain.gain.exponentialRampToValueAtTime(0.001, now + at + 0.07)
      source.connect(filter).connect(gain).connect(ctx.destination)
      source.start(now + at)
      source.stop(now + at + 0.08)
    }
    burst(0, 3200, 0.55)
    burst(0.075, 1900, 0.4)
  } catch {
    /* no audio device — the screenshot still happened */
  }
}

export type UiSound = 'move' | 'bump' | 'select' | 'back' | 'tab' | 'open' | 'launch'

/**
 * Host mode's interface sounds — soft clicks and chimes, synthesised like the
 * shutter. Each is a few short tones: [start Hz, end Hz, start s, length s, level].
 */
const UI_TONES: Record<UiSound, { wave: OscillatorType; tones: [number, number, number, number, number][] }> = {
  move: { wave: 'triangle', tones: [[1320, 1180, 0, 0.035, 0.05]] },
  bump: { wave: 'sine', tones: [[190, 120, 0, 0.09, 0.16]] },
  tab: {
    wave: 'triangle',
    tones: [
      [880, 880, 0, 0.04, 0.05],
      [1320, 1320, 0.035, 0.05, 0.045]
    ]
  },
  select: {
    wave: 'sine',
    tones: [
      [740, 760, 0, 0.07, 0.12],
      [1110, 1130, 0.05, 0.1, 0.1]
    ]
  },
  open: {
    wave: 'sine',
    tones: [
      [520, 560, 0, 0.09, 0.09],
      [780, 820, 0.06, 0.12, 0.08],
      [1040, 1060, 0.11, 0.14, 0.06]
    ]
  },
  back: {
    wave: 'sine',
    tones: [
      [860, 820, 0, 0.06, 0.1],
      [580, 540, 0.05, 0.09, 0.09]
    ]
  },
  launch: {
    wave: 'sine',
    tones: [
      [523, 523, 0, 0.16, 0.11],
      [659, 659, 0.08, 0.16, 0.1],
      [784, 784, 0.16, 0.2, 0.1],
      [1047, 1047, 0.24, 0.42, 0.09]
    ]
  }
}

export function playUi(sound: UiSound): void {
  try {
    context ??= new AudioContext()
    const ctx = context
    if (ctx.state === 'suspended') void ctx.resume()
    const now = ctx.currentTime
    const { wave, tones } = UI_TONES[sound]
    for (const [from, to, at, length, level] of tones) {
      const osc = ctx.createOscillator()
      osc.type = wave
      osc.frequency.setValueAtTime(from, now + at)
      osc.frequency.exponentialRampToValueAtTime(to, now + at + length)
      const gain = ctx.createGain()
      gain.gain.setValueAtTime(0, now + at)
      gain.gain.linearRampToValueAtTime(level, now + at + 0.006)
      gain.gain.exponentialRampToValueAtTime(0.0001, now + at + length)
      osc.connect(gain).connect(ctx.destination)
      osc.start(now + at)
      osc.stop(now + at + length + 0.02)
    }
  } catch {
    /* no audio device */
  }
}
