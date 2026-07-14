// 90-ball bingo card generator: a 3x9 grid, 5 numbers per row (15 total),
// column ranges 1-9,10-19,...,80-90 (last column has 11 possible numbers),
// numbers within a column sorted ascending top-to-bottom, rest blank (null).
//
// Column fill-counts are chosen first (each column gets 1-3 numbers,
// summing to 15), then which of the 3 rows get a number in each column is
// assigned with a greedy balancer that always fills the row(s) currently
// furthest from its target of 5 — this reliably converges to exactly 5
// per row for any valid column-count distribution in this range.
const COLUMN_RANGES: [number, number][] = [
  [1, 9], [10, 19], [20, 29], [30, 39], [40, 49],
  [50, 59], [60, 69], [70, 79], [80, 90],
]

function pickColumnCounts(): number[] {
  const counts = new Array(9).fill(1) // 9 columns, min 1 each = 9
  let remaining = 15 - 9 // 6 more to distribute, max 2 more per column (cap 3)
  while (remaining > 0) {
    const col = Math.floor(Math.random() * 9)
    if (counts[col] < 3) {
      counts[col]++
      remaining--
    }
  }
  return counts
}

function assignRows(columnCounts: number[]): boolean[][] {
  // grid[row][col] = true means this cell gets a number
  const grid: boolean[][] = [[], [], []].map(() => new Array(9).fill(false))
  const rowNeed = [5, 5, 5]
  const colOrder = [...Array(9).keys()].sort(() => Math.random() - 0.5)
  for (const col of colOrder) {
    const count = columnCounts[col]
    const rowsByNeed = [0, 1, 2].sort((a, b) => rowNeed[b] - rowNeed[a])
    for (let i = 0; i < count; i++) {
      const row = rowsByNeed[i]
      grid[row][col] = true
      rowNeed[row]--
    }
  }
  return grid
}

export function generateBingoCard(): (number | null)[][] {
  const columnCounts = pickColumnCounts()
  const grid = assignRows(columnCounts)
  const card: (number | null)[][] = [[], [], []].map(() => new Array(9).fill(null))
  for (let col = 0; col < 9; col++) {
    const filledRows = [0, 1, 2].filter(r => grid[r][col])
    if (!filledRows.length) continue
    const [lo, hi] = COLUMN_RANGES[col]
    const pool: number[] = []
    for (let n = lo; n <= hi; n++) pool.push(n)
    // Fisher-Yates partial shuffle, take the first `filledRows.length`
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[pool[i], pool[j]] = [pool[j], pool[i]]
    }
    const chosen = pool.slice(0, filledRows.length).sort((a, b) => a - b)
    filledRows.forEach((row, idx) => { card[row][col] = chosen[idx] })
  }
  return card
}

export type BingoTier = 'one_line' | 'two_lines' | 'full_house'

// Returns which tiers a card newly qualifies for, given the numbers called
// so far, EXCLUDING any tier already present in `alreadyWon` — cumulative,
// not "highest tier only": a card that completes all 3 rows returns
// ['one_line','two_lines','full_house'] in one call if none were recorded
// yet, or just the newly-reached ones if some were already recorded.
export function checkNewTiers(
  card: (number | null)[][],
  calledNumbers: number[],
  alreadyWon: BingoTier[],
): BingoTier[] {
  const called = new Set(calledNumbers)
  const completedRows = card.filter(row =>
    row.every(cell => cell === null || called.has(cell))
  ).length
  const newTiers: BingoTier[] = []
  if (completedRows >= 1 && !alreadyWon.includes('one_line')) newTiers.push('one_line')
  if (completedRows >= 2 && !alreadyWon.includes('two_lines')) newTiers.push('two_lines')
  if (completedRows >= 3 && !alreadyWon.includes('full_house')) newTiers.push('full_house')
  return newTiers
}
