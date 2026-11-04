import { describe, it, expect, vi } from 'vitest'
import { PlayerMemoryManager, DEFAULT_PLAYER_MEMORY } from '../bot-memory/player-memory'
import { RummyWorkingMemory } from '../bot-memory/working-memory-rummy'

describe('Bot Cognitive Memory Engine', () => {
  describe('PlayerMemoryManager', () => {
    it('should return default memory for new untracked player', async () => {
      const mockRedis: any = {
        get: vi.fn().mockResolvedValue(null),
        setex: vi.fn().mockResolvedValue('OK'),
      }
      const mockDb: any = {
        query: vi.fn().mockResolvedValue({ rows: [] }),
      }

      const mem = await PlayerMemoryManager.getPlayerMemory(mockRedis, mockDb, 'player-123')
      expect(mem.userId).toBe('player-123')
      expect(mem.vpipRate).toBe(50.0)
      expect(mem.tiltScore).toBe(1.0)
      expect(mem.consecutiveLosses).toBe(0)
    })

    it('should adapt Teen Patti profile against a nit (high fold-to-raise)', () => {
      const base = {
        fold_probability: 0.30,
        call_probability: 0.45,
        raise_probability: 0.25,
      }
      const nitMemory = {
        ...DEFAULT_PLAYER_MEMORY,
        userId: 'nit-user',
        foldToRaiseRatio: 80.0, // Nit!
        lastActionAt: new Date(),
      }

      const adapted = PlayerMemoryManager.adaptTeenPattiProfile(base, nitMemory)
      // Bot should raise significantly more to steal from the nit
      expect(adapted.raise_probability).toBeGreaterThan(base.raise_probability)
      expect(adapted.fold_probability + adapted.call_probability + adapted.raise_probability).toBeCloseTo(1.0, 2)
    })

    it('should adapt Teen Patti profile against a calling station (never folds)', () => {
      const base = {
        fold_probability: 0.30,
        call_probability: 0.45,
        raise_probability: 0.25,
      }
      const fishMemory = {
        ...DEFAULT_PLAYER_MEMORY,
        userId: 'fish-user',
        foldToRaiseRatio: 15.0, // Calling station!
        bluffCallTendency: 85.0,
        lastActionAt: new Date(),
      }

      const adapted = PlayerMemoryManager.adaptTeenPattiProfile(base, fishMemory)
      // Bot should reduce raises (no bluffing) and call/value bet more
      expect(adapted.raise_probability).toBeLessThan(base.raise_probability)
      expect(adapted.call_probability).toBeGreaterThan(base.call_probability)
    })

    it('should adapt Teen Patti profile against a tilted player', () => {
      const base = {
        fold_probability: 0.30,
        call_probability: 0.45,
        raise_probability: 0.25,
      }
      const tiltedMemory = {
        ...DEFAULT_PLAYER_MEMORY,
        userId: 'tilt-user',
        tiltScore: 2.5, // Highly tilted!
        consecutiveLosses: 4,
        lastActionAt: new Date(),
      }

      const adapted = PlayerMemoryManager.adaptTeenPattiProfile(base, tiltedMemory)
      // Bot traps the tilted player by calling wider
      expect(adapted.call_probability).toBeGreaterThan(base.call_probability)
      expect(adapted.fold_probability).toBeLessThan(base.fold_probability)
    })
  })

  describe('RummyWorkingMemory', () => {
    it('should compute dangerous discard cards from opponent open pile picks', async () => {
      // Simulate opponent having picked 7 of Hearts (7H)
      const mockState = {
        roomId: 'room-1',
        seenDiscards: ['7H'],
        playerPicks: {
          'opp-1': ['7H'],
        },
        playerDiscards: {},
        closedDrawCounts: {},
      }
      const mockRedis: any = {
        get: vi.fn().mockResolvedValue(JSON.stringify(mockState)),
      }

      const unsafe = await RummyWorkingMemory.getUnsafeDiscards(mockRedis, 'room-1', 'opp-1')
      
      // 1. Sequence neighbors in Hearts: 6H and 8H
      expect(unsafe).toContain('6H')
      expect(unsafe).toContain('8H')
      // 2. Second degree neighbors: 5H and 9H
      expect(unsafe).toContain('5H')
      expect(unsafe).toContain('9H')
      // 3. Same rank for triplet/set: 7D, 7S, 7C
      expect(unsafe).toContain('7D')
      expect(unsafe).toContain('7S')
      expect(unsafe).toContain('7C')
    })

    it('should detect when cards are fully exhausted (2 copies discarded in 2-deck game)', async () => {
      const mockState = {
        roomId: 'room-2',
        seenDiscards: ['KH', 'KH', 'AS'],
        playerPicks: {},
        playerDiscards: {},
        closedDrawCounts: {},
      }
      const mockRedis: any = {
        get: vi.fn().mockResolvedValue(JSON.stringify(mockState)),
      }

      const isKhExhausted = await RummyWorkingMemory.isCardFullyExhausted(mockRedis, 'room-2', { rank: 'K', suit: 'H' })
      const isAsExhausted = await RummyWorkingMemory.isCardFullyExhausted(mockRedis, 'room-2', { rank: 'A', suit: 'S' })

      expect(isKhExhausted).toBe(true)
      expect(isAsExhausted).toBe(false)
    })
  })
})

