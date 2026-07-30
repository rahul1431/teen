import { RummyState, Card, isJoker, checkGroup, validateDeclareGroups, findValidDeclareGrouping } from './rules'

function cardValue(card: Card, wildRank: string): number {
  if (isJoker(card, wildRank)) return 0
  if (card.rank === 'A') return 1
  if (['J', 'Q', 'K'].includes(card.rank)) return 10
  return parseInt(card.rank, 10) || 10
}

// Greedily pulls the largest valid sequence/set out of the remaining cards,
// repeating until nothing more can be formed. Not optimal (doesn't
// backtrack), but good enough for a heuristic bot and cheap: O(n^4) on a
// 14-card hand is ~38k checkGroup calls worst case.
function greedyGroup(hand: Card[], wildRank: string): { groups: Card[][]; leftover: Card[] } {
  const remaining = [...hand]
  const groups: Card[][] = []

  function findAndExtract(size: 3 | 4): boolean {
    for (let i = 0; i < remaining.length; i++) {
      for (let j = i + 1; j < remaining.length; j++) {
        for (let k = j + 1; k < remaining.length; k++) {
          if (size === 3) {
            const candidate = [remaining[i], remaining[j], remaining[k]]
            if (checkGroup(candidate, wildRank).valid) {
              groups.push(candidate)
              ;[k, j, i].forEach(idx => remaining.splice(idx, 1))
              return true
            }
          } else {
            for (let l = k + 1; l < remaining.length; l++) {
              const candidate = [remaining[i], remaining[j], remaining[k], remaining[l]]
              if (checkGroup(candidate, wildRank).valid) {
                groups.push(candidate)
                ;[l, k, j, i].forEach(idx => remaining.splice(idx, 1))
                return true
              }
            }
          }
        }
      }
    }
    return false
  }

  let progress = true
  while (progress && remaining.length >= 3) {
    progress = findAndExtract(4) || findAndExtract(3)
  }
  return { groups, leftover: remaining }
}

export function chooseBotDraw(state: RummyState, playerIdx: number): 'closed' | 'open' {
  const player = state.players[playerIdx]
  const topOfOpen = state.open_pile[state.open_pile.length - 1]
  if (!topOfOpen) return 'closed'
  if (isJoker(topOfOpen, state.wild_rank)) return 'open'
  const usefulness = player.hand.filter(c =>
    c.rank === topOfOpen.rank || (c.suit === topOfOpen.suit && c.suit !== 'JK'),
  ).length
  const threshold = state.bot_difficulty === 'hard' ? 1 : state.bot_difficulty === 'medium' ? 2 : 3
  return usefulness >= threshold ? 'open' : 'closed'
}

export function chooseBotDiscard(state: RummyState, playerIdx: number): string {
  const player = state.players[playerIdx]
  const { leftover } = greedyGroup(player.hand, state.wild_rank)
  const pool = leftover.length > 0 ? leftover : player.hand
  const poolNonJokers = pool.filter(c => !isJoker(c, state.wild_rank))
  const handNonJokers = player.hand.filter(c => !isJoker(c, state.wild_rank))
  // Never discard a joker while the hand holds ANY non-joker card, even one
  // greedyGroup happened to lock inside a completed meld — breaking that
  // meld by discarding one of its cards is still better than surrendering
  // a joker to the open pile.
  const candidates = poolNonJokers.length > 0 ? poolNonJokers : handNonJokers.length > 0 ? handNonJokers : pool
  let worst = candidates[0]
  let worstValue = cardValue(worst, state.wild_rank)
  for (const c of candidates) {
    const v = cardValue(c, state.wild_rank)
    if (v > worstValue) { worst = c; worstValue = v }
  }
  return worst.id
}

// Returns a valid declare grouping if the bot's current hand (14 cards,
// post-draw) can legally declare right now, else null.
//
// Uses the EXACT search in rules.ts rather than greedyGroup above: greedy
// doesn't backtrack, so it can extract a locally-valid meld that strands the
// rest of the hand and then report "can't declare" on a hand that genuinely
// wins. greedyGroup is still used for chooseBotDiscard's leftover heuristic,
// where an approximate melding is all that's needed.
export function tryBotDeclare(state: RummyState, playerIdx: number): string[][] | null {
  const player = state.players[playerIdx]
  const groupIds = findValidDeclareGrouping(player.hand, state.wild_rank)
  if (!groupIds) return null
  // Defensive: the search already guarantees this, but a declare is
  // irreversible (a rejected one eliminates the bot), so re-verify.
  const check = validateDeclareGroups(player.hand, groupIds, state.wild_rank)
  return check.valid ? groupIds : null
}
