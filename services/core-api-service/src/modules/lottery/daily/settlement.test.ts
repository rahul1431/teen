import { matchTicketToTier } from './settlement'

describe('Daily Lottery Settlement', () => {
  describe('matchTicketToTier', () => {
    it('should return "exact" for exact match', () => {
      expect(matchTicketToTier('1234', '1234')).toBe('exact')
      expect(matchTicketToTier('0000', '0000')).toBe('exact')
      expect(matchTicketToTier('9999', '9999')).toBe('exact')
    })

    it('should return "last_3" for last 3 digits match', () => {
      expect(matchTicketToTier('1234', '5234')).toBe('last_3')
      expect(matchTicketToTier('0123', '5123')).toBe('last_3')
      expect(matchTicketToTier('9999', '1999')).toBe('last_3')
    })

    it('should return "last_2" for last 2 digits match when last 3 do not match', () => {
      expect(matchTicketToTier('1234', '5634')).toBe('last_2')
      expect(matchTicketToTier('0012', '5612')).toBe('last_2')
      expect(matchTicketToTier('9999', '1299')).toBe('last_2')
    })

    it('should return "last_1" for last 1 digit match when last 2 do not match', () => {
      expect(matchTicketToTier('1234', '5674')).toBe('last_1')
      expect(matchTicketToTier('0010', '5620')).toBe('last_1')
      expect(matchTicketToTier('9999', '1239')).toBe('last_1')
    })

    it('should return null for no match', () => {
      expect(matchTicketToTier('1234', '5678')).toBeNull()
      expect(matchTicketToTier('0000', '1111')).toBeNull()
      expect(matchTicketToTier('1111', '2222')).toBeNull()
    })

    it('should prioritize exact > last_3 > last_2 > last_1', () => {
      // Exact match should win over all others
      expect(matchTicketToTier('1234', '1234')).toBe('exact')

      // Last_3 should win over last_2 and last_1
      expect(matchTicketToTier('1234', '5234')).toBe('last_3')

      // Last_2 should win over last_1
      expect(matchTicketToTier('1234', '5634')).toBe('last_2')

      // Last_1 is the lowest priority
      expect(matchTicketToTier('1234', '5674')).toBe('last_1')
    })

    it('should handle edge cases with leading zeros', () => {
      expect(matchTicketToTier('0001', '0001')).toBe('exact')
      expect(matchTicketToTier('0001', '5001')).toBe('last_3')
      expect(matchTicketToTier('0001', '5501')).toBe('last_2')
      expect(matchTicketToTier('0001', '5601')).toBe('last_2') // '01' === '01' in last 2 digits
      expect(matchTicketToTier('0001', '5602')).toBeNull()
      expect(matchTicketToTier('0001', '5671')).toBe('last_1') // '1' === '1' in last 1 digit
    })
  })

  describe('Settlement Logic', () => {
    it('should match ticket number correctly against all tiers', () => {
      const testCases = [
        { ticket: '1234', winning: '1234', expected: 'exact' },
        { ticket: '1234', winning: '0234', expected: 'last_3' },
        { ticket: '1234', winning: '0534', expected: 'last_2' },
        { ticket: '1234', winning: '0564', expected: 'last_1' },
        { ticket: '1234', winning: '0565', expected: null },
      ]

      for (const tc of testCases) {
        expect(matchTicketToTier(tc.ticket, tc.winning)).toBe(tc.expected)
      }
    })

    it('should correctly determine no-win cases', () => {
      // No winning number should match
      expect(matchTicketToTier('1111', '2222')).toBeNull()
      expect(matchTicketToTier('1111', '2111')).toBe('last_3')
      expect(matchTicketToTier('1111', '2211')).toBe('last_2')
      expect(matchTicketToTier('1111', '2221')).toBe('last_1')
    })
  })
})
