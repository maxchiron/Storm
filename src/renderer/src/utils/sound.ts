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
