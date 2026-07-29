// Generates a short two-tone chime with the Web Audio API instead of
// shipping a binary audio asset.
export function playChime(): void {
  try {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext
    const ctx = new AudioCtx()
    const now = ctx.currentTime

    const playTone = (freq: number, startOffset: number, duration: number) => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.setValueAtTime(freq, now + startOffset)
      gain.gain.setValueAtTime(0.15, now + startOffset)
      gain.gain.exponentialRampToValueAtTime(0.001, now + startOffset + duration)
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start(now + startOffset)
      osc.stop(now + startOffset + duration)
    }

    playTone(880, 0, 0.12)
    playTone(1174.66, 0.13, 0.15)
  } catch {
    // Audio unsupported/blocked (e.g. autoplay policy before first user gesture) — silently skip.
  }
}
