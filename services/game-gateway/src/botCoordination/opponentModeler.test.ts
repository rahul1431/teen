import { describe, it, expect } from 'vitest'
import { OpponentModeler } from './opponentModeler'
import { pickReactionEmoji } from './botReactions'

describe('OpponentModeler classification', () => {
  it('defaults to balanced when sample size is too small', () => {
    const result = OpponentModeler.classifyTendency({
      actionsCount: 3,
      foldCount: 2,
      callCount: 1,
      raiseCount: 0,
    })
    expect(result).toBe('balanced')
  })

  it('classifies maniac_aggressor when raise rate is >= 40%', () => {
    const result = OpponentModeler.classifyTendency({
      actionsCount: 10,
      foldCount: 1,
      callCount: 4,
      raiseCount: 5, // 50% raise
    })
    expect(result).toBe('maniac_aggressor')
  })

  it('classifies calling_station when call rate is >= 50%', () => {
    const result = OpponentModeler.classifyTendency({
      actionsCount: 10,
      foldCount: 1,
      callCount: 7, // 70% call
      raiseCount: 2,
    })
    expect(result).toBe('calling_station')
  })

  it('classifies tight_folder when fold rate is >= 35%', () => {
    const result = OpponentModeler.classifyTendency({
      actionsCount: 10,
      foldCount: 4, // 40% fold
      callCount: 3,
      raiseCount: 3,
    })
    expect(result).toBe('tight_folder')
  })

  it('classifies balanced when play is mixed evenly', () => {
    const result = OpponentModeler.classifyTendency({
      actionsCount: 10,
      foldCount: 2, // 20%
      callCount: 4, // 40%
      raiseCount: 3, // 30%
    })
    expect(result).toBe('balanced')
  })
})

describe('BotReactions emoji picker', () => {
  it('picks appropriate emojis for win', () => {
    const emoji = pickReactionEmoji('win')
    expect(typeof emoji).toBe('string')
    expect(emoji.length).toBeGreaterThan(0)
  })

  it('picks appropriate emojis for bad_beat', () => {
    const emoji = pickReactionEmoji('bad_beat')
    expect(typeof emoji).toBe('string')
    expect(emoji.length).toBeGreaterThan(0)
  })

  it('picks appropriate emojis for declare', () => {
    const emoji = pickReactionEmoji('declare')
    expect(typeof emoji).toBe('string')
    expect(emoji.length).toBeGreaterThan(0)
  })
})
