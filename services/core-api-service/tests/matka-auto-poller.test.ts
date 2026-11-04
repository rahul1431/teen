import { describe, it, expect } from 'vitest'
import { generateRandomPanna, MatkaAutoDeclaringPoller } from '../src/helpers/matka-auto-poller'

describe('generateRandomPanna', () => {
  it('should generate a 3 digit numeric string', () => {
    for (let i = 0; i < 100; i++) {
      const panna = generateRandomPanna()
      expect(panna).toMatch(/^[0-9]{3}$/)
    }
  })

  it('should generate a panna with digits sorted in ascending order (where 0 counts as 10)', () => {
    for (let i = 0; i < 100; i++) {
      const panna = generateRandomPanna()
      const values = panna.split('').map(c => c === '0' ? 10 : parseInt(c, 10))
      expect(values[0]).toBeLessThanOrEqual(values[1])
      expect(values[1]).toBeLessThanOrEqual(values[2])
    }
  })
})
