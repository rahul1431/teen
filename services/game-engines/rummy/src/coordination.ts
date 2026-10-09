import { RummyState, Card, isJoker, checkGroup, validateDeclareGroups, findValidDeclareGrouping } from './rules'

const RANK_VALS: Record<string, number> = {
  A: 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10, J: 11, Q: 12, K: 13
};

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

// Evaluates how well a card connects with the rest of the hand (potential pure sequences, sequences with jokers, sets)
function evaluateCardSynergy(c: Card, hand: Card[], wildRank: string): number {
  if (isJoker(c, wildRank)) return 100 // Jokers have maximum synergy
  
  let score = 0
  const cRankVal = RANK_VALS[c.rank] || 0
  let sameRankCount = 0
  let consecutiveCount = 0
  let gapCount = 0

  for (const other of hand) {
    if (other.id === c.id) continue
    if (isJoker(other, wildRank)) continue

    if (other.rank === c.rank && other.suit !== c.suit) {
      sameRankCount++
    }

    if (other.suit === c.suit) {
      const oRankVal = RANK_VALS[other.rank] || 0
      const diff = Math.abs(cRankVal - oRankVal)
      if (diff === 1) {
        consecutiveCount++
      } else if (diff === 2) {
        gapCount++
      }
    }
  }

  // Consecutive cards (e.g. 7♠ and 8♠) are prime for pure sequences
  score += consecutiveCount * 15
  // Gap sequences (e.g. 7♠ and 9♠) are good potential sequences
  score += gapCount * 7
  // Same rank (e.g. 7♠ and 7♦) for sets
  score += sameRankCount * 8

  return score
}

export function chooseBotDraw(state: RummyState, playerIdx: number): 'closed' | 'open' {
  const player = state.players[playerIdx]
  const topOfOpen = state.open_pile[state.open_pile.length - 1]
  if (!topOfOpen) return 'closed'
  if (isJoker(topOfOpen, state.wild_rank)) return 'open'

  // Calculate if the top of open card directly forms or completes a sequence or set
  const testHand = [...player.hand, topOfOpen]
  const curMelds = greedyGroup(player.hand, state.wild_rank)
  const newMelds = greedyGroup(testHand, state.wild_rank)

  // If drawing open creates an additional valid group or reduces deadwood significantly, take it
  if (newMelds.groups.length > curMelds.groups.length) {
    return 'open'
  }

  const synergy = evaluateCardSynergy(topOfOpen, player.hand, state.wild_rank)
  const threshold = state.bot_difficulty === 'hard' ? 12 : state.bot_difficulty === 'medium' ? 15 : 25
  return synergy >= threshold ? 'open' : 'closed'
}

export function chooseBotDiscard(state: RummyState, playerIdx: number): string {
  const player = state.players[playerIdx]
  const { groups, leftover } = greedyGroup(player.hand, state.wild_rank)
  const pool = leftover.length > 0 ? leftover : player.hand
  const poolNonJokers = pool.filter(c => !isJoker(c, state.wild_rank))
  const handNonJokers = player.hand.filter(c => !isJoker(c, state.wild_rank))
  // Never discard a joker while the hand holds ANY non-joker card
  const candidates = poolNonJokers.length > 0 ? poolNonJokers : handNonJokers.length > 0 ? handNonJokers : pool

  let bestDiscard = candidates[0]
  let maxDiscardDesirability = -9999

  for (const c of candidates) {
    const val = cardValue(c, state.wild_rank) // High point value card (10, J, Q, K)
    const synergy = evaluateCardSynergy(c, player.hand, state.wild_rank)

    // Higher desirability to discard = High card points + Low synergy/connection to hand
    let discardScore = (val * 1.5) - synergy

    // If bot difficulty is easy, introduce minor noise
    if (state.bot_difficulty === 'easy') {
      discardScore += (Math.random() * 8 - 4)
    }

    if (discardScore > maxDiscardDesirability) {
      maxDiscardDesirability = discardScore
      bestDiscard = c
    }
  }

  return bestDiscard.id
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
