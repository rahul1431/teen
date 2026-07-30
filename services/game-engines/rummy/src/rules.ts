export type Suit = 'S' | 'H' | 'D' | 'C' | 'JK'
export type BotDifficulty = 'easy' | 'medium' | 'hard'

export interface Card {
  id: string
  rank: string // 'A'..'10','J','Q','K', or 'JOKER' for printed jokers
  suit: Suit
}

export interface RummyPlayer {
  user_id: string
  username: string
  seat: number
  is_bot: boolean
  bot_difficulty?: BotDifficulty
  hand: Card[]
  has_drawn: boolean
  has_taken_turn: boolean
  has_dropped: boolean
  is_eliminated: boolean
}

export interface RummyState {
  room_id: string
  stake: number
  rake_percent: number
  players: RummyPlayer[]
  closed_pile: Card[]
  open_pile: Card[]
  wild_rank: string
  wild_indicator: Card
  current_turn: number
  awaiting: 'draw' | 'discard'
  status: 'active' | 'completed'
  winner_id: string | null
  bot_difficulty: BotDifficulty
  turn_timeout_seconds: number
  turn_number: number
}

export interface ActionResult {
  winner_id: string
  prize: number
  rake_fee: number
  reason: 'valid_declare' | 'last_player_standing'
}

const SUITS: Suit[] = ['S', 'H', 'D', 'C']
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K']

export function buildDeck(deckCount: number): Card[] {
  const deck: Card[] = []
  let n = 0
  for (let d = 0; d < deckCount; d++) {
    for (const suit of SUITS) {
      for (const rank of RANKS) {
        deck.push({ id: `c${n++}`, rank, suit })
      }
    }
    deck.push({ id: `c${n++}`, rank: 'JOKER', suit: 'JK' })
  }
  return deck
}

export function shuffle<T>(arr: T[]): T[] {
  const out = [...arr]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

export function isJoker(card: Card, wildRank: string): boolean {
  return card.suit === 'JK' || card.rank === wildRank
}

export function createInitialState(
  roomId: string,
  stake: number,
  players: { user_id: string; username: string; seat: number; is_bot: boolean; bot_difficulty?: BotDifficulty }[],
  botDifficulty: BotDifficulty,
  deckCount: number,
  turnTimeoutSeconds: number,
  rakePercent: number,
): RummyState {
  const deck = shuffle(buildDeck(deckCount))
  const rummyPlayers: RummyPlayer[] = players
    .slice()
    .sort((a, b) => a.seat - b.seat)
    .map(p => ({
      user_id: p.user_id,
      username: p.username,
      seat: p.seat,
      is_bot: p.is_bot,
      bot_difficulty: p.bot_difficulty,
      hand: [],
      has_drawn: false,
      has_taken_turn: false,
      has_dropped: false,
      is_eliminated: false,
    }))

  let cursor = 0
  for (let round = 0; round < 13; round++) {
    for (const p of rummyPlayers) {
      p.hand.push(deck[cursor++])
    }
  }

  const wildIndicator = deck[cursor++]
  const wildRank = wildIndicator.suit === 'JK' ? '__NONE__' : wildIndicator.rank
  const openPile = [deck[cursor++]]
  const closedPile = deck.slice(cursor)

  return {
    room_id: roomId,
    stake,
    rake_percent: rakePercent,
    players: rummyPlayers,
    closed_pile: closedPile,
    open_pile: openPile,
    wild_rank: wildRank,
    wild_indicator: wildIndicator,
    current_turn: 0,
    awaiting: 'draw',
    status: 'active',
    winner_id: null,
    bot_difficulty: botDifficulty,
    turn_timeout_seconds: turnTimeoutSeconds,
    turn_number: 0,
  }
}

const RANK_VALUE: Record<string, number> = {
  A: 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10, J: 11, Q: 12, K: 13,
}

export interface GroupCheck { valid: boolean; kind: 'sequence' | 'set' | null; pure: boolean }

function isValidSequence(cards: Card[], wildRank: string): { valid: boolean; pure: boolean } {
  if (cards.length < 3) return { valid: false, pure: false }
  const jokers = cards.filter(c => isJoker(c, wildRank))
  const naturals = cards.filter(c => !isJoker(c, wildRank))
  if (naturals.length === 0) return { valid: false, pure: false }
  const suit = naturals[0].suit
  if (naturals.some(c => c.suit !== suit)) return { valid: false, pure: false }

  const size = cards.length
  const aceValues: (number | null)[] = naturals.some(c => c.rank === 'A') ? [1, 14] : [null]
  for (const aceValue of aceValues) {
    const values = naturals.map(c => (c.rank === 'A' && aceValue !== null ? aceValue : RANK_VALUE[c.rank]))
    const uniqueValues = new Set(values)
    if (uniqueValues.size !== values.length) continue // duplicate rank in this suit — can't be a run
    const natMin = Math.min(...values)
    const natMax = Math.max(...values)
    // Jokers can extend the run past the naturals' own min/max, not just fill
    // internal gaps — so search every window of length `size` that fully
    // contains [natMin, natMax] and stays within the valid rank range.
    // `maxRank` is 14 only when this candidate is treating Ace as high (the
    // ace itself occupies 14); a filler joker can never invent a non-Ace 14.
    const maxRank = aceValue === 14 ? 14 : 13
    const minRank = 1
    const lowStart = Math.max(minRank, natMax - size + 1)
    const lowEnd = Math.min(natMin, maxRank - size + 1)
    if (lowStart <= lowEnd) {
      // A valid window exists; jokers fill whatever slots in it the naturals
      // don't occupy — always exactly `size - naturals.length` slots, which
      // is exactly `jokers.length` by construction of `cards`.
      return { valid: true, pure: jokers.length === 0 }
    }
  }
  return { valid: false, pure: false }
}

function isValidSet(cards: Card[], wildRank: string): boolean {
  if (cards.length < 3 || cards.length > 4) return false
  const jokers = cards.filter(c => isJoker(c, wildRank))
  const naturals = cards.filter(c => !isJoker(c, wildRank))
  if (naturals.length === 0) return false
  const rank = naturals[0].rank
  if (naturals.some(c => c.rank !== rank)) return false
  const suits = naturals.map(c => c.suit)
  if (new Set(suits).size !== suits.length) return false // duplicate suit — invalid
  return naturals.length + jokers.length === cards.length
}

export function checkGroup(cards: Card[], wildRank: string): GroupCheck {
  const seq = isValidSequence(cards, wildRank)
  if (seq.valid) return { valid: true, kind: 'sequence', pure: seq.pure }
  if (isValidSet(cards, wildRank)) return { valid: true, kind: 'set', pure: false }
  return { valid: false, kind: null, pure: false }
}

export function validateDeclareGroups(
  hand: Card[],
  groupsOfIds: string[][],
  wildRank: string,
): { valid: boolean; reason?: string } {
  const flatIds = groupsOfIds.flat()
  if (flatIds.length !== 13) return { valid: false, reason: 'Groups must contain exactly 13 cards' }
  const uniqueFlat = new Set(flatIds)
  if (uniqueFlat.size !== flatIds.length) return { valid: false, reason: 'Duplicate card in groups' }
  const handIdSet = new Set(hand.map(c => c.id))
  for (const id of flatIds) {
    if (!handIdSet.has(id)) return { valid: false, reason: 'Group references a card not in hand' }
  }
  const byId = new Map(hand.map(c => [c.id, c]))
  let sequenceCount = 0
  let pureSequenceCount = 0
  for (const ids of groupsOfIds) {
    if (ids.length < 3) return { valid: false, reason: 'Every group must have at least 3 cards' }
    const cards = ids.map(id => byId.get(id)!)
    const check = checkGroup(cards, wildRank)
    if (!check.valid) return { valid: false, reason: 'One or more groups is not a valid sequence or set' }
    if (check.kind === 'sequence') {
      sequenceCount++
      if (check.pure) pureSequenceCount++
    }
  }
  if (sequenceCount < 2) return { valid: false, reason: 'Need at least 2 sequences' }
  if (pureSequenceCount < 1) return { valid: false, reason: 'Need at least 1 pure sequence (no jokers)' }
  return { valid: true }
}

export interface DeclareOutcome { valid: boolean; reason?: string }

export function advanceTurn(state: RummyState): void {
  const n = state.players.length
  let next = state.current_turn
  for (let i = 0; i < n; i++) {
    next = (next + 1) % n
    if (!state.players[next].is_eliminated && !state.players[next].has_dropped) {
      state.current_turn = next
      state.awaiting = 'draw'
      state.turn_number++
      return
    }
  }
}

function activePlayers(state: RummyState): RummyPlayer[] {
  return state.players.filter(p => !p.is_eliminated && !p.has_dropped)
}

function settleWinner(state: RummyState, winnerId: string, reason: ActionResult['reason']): ActionResult {
  const pot = Math.round(state.stake * state.players.length * 100) / 100
  const rakeFee = Math.round(pot * (state.rake_percent / 100) * 100) / 100
  const prize = Math.round((pot - rakeFee) * 100) / 100
  state.status = 'completed'
  state.winner_id = winnerId
  return { winner_id: winnerId, prize, rake_fee: rakeFee, reason }
}

function checkLastPlayerStanding(state: RummyState): ActionResult | null {
  const active = activePlayers(state)
  if (active.length === 1) return settleWinner(state, active[0].user_id, 'last_player_standing')
  return null
}

export function reshuffleIfNeeded(state: RummyState): void {
  if (state.closed_pile.length > 0) return
  if (state.open_pile.length <= 1) return
  const top = state.open_pile[state.open_pile.length - 1]
  const rest = state.open_pile.slice(0, -1)
  state.closed_pile = shuffle(rest)
  state.open_pile = [top]
}

export function drawFromClosed(state: RummyState, playerIdx: number): Card {
  if (state.status !== 'active') throw new Error('Game already over')
  if (state.awaiting !== 'draw') throw new Error('Not awaiting a draw')
  if (playerIdx !== state.current_turn) throw new Error('Not your turn')
  reshuffleIfNeeded(state)
  const card = state.closed_pile.pop()
  if (!card) throw new Error('No cards left to draw')
  state.players[playerIdx].hand.push(card)
  state.players[playerIdx].has_drawn = true
  state.awaiting = 'discard'
  return card
}

export function drawFromOpen(state: RummyState, playerIdx: number): Card {
  if (state.status !== 'active') throw new Error('Game already over')
  if (state.awaiting !== 'draw') throw new Error('Not awaiting a draw')
  if (playerIdx !== state.current_turn) throw new Error('Not your turn')
  const card = state.open_pile.pop()
  if (!card) throw new Error('Open pile is empty')
  state.players[playerIdx].hand.push(card)
  state.players[playerIdx].has_drawn = true
  state.awaiting = 'discard'
  return card
}

export function discardCard(state: RummyState, playerIdx: number, cardId: string): void {
  if (state.status !== 'active') throw new Error('Game already over')
  if (state.awaiting !== 'discard') throw new Error('Not awaiting a discard')
  if (playerIdx !== state.current_turn) throw new Error('Not your turn')
  const player = state.players[playerIdx]
  const idx = player.hand.findIndex(c => c.id === cardId)
  if (idx === -1) throw new Error('Card not in hand')
  const [card] = player.hand.splice(idx, 1)
  state.open_pile.push(card)
  player.has_drawn = false
  player.has_taken_turn = true
  advanceTurn(state)
}

export function attemptDeclare(
  state: RummyState,
  playerIdx: number,
  groupsOfIds: string[][],
): { outcome: DeclareOutcome; result: ActionResult | null } {
  if (state.status !== 'active') throw new Error('Game already over')
  if (state.awaiting !== 'discard') throw new Error('Draw before declaring')
  if (playerIdx !== state.current_turn) throw new Error('Not your turn')
  const player = state.players[playerIdx]
  const check = validateDeclareGroups(player.hand, groupsOfIds, state.wild_rank)
  if (!check.valid) {
    player.is_eliminated = true
    player.has_drawn = false
    player.has_taken_turn = true
    const lastStanding = checkLastPlayerStanding(state)
    if (!lastStanding) advanceTurn(state)
    return { outcome: check, result: lastStanding }
  }
  const result = settleWinner(state, player.user_id, 'valid_declare')
  return { outcome: check, result }
}

export function dropPlayer(state: RummyState, playerIdx: number): ActionResult | null {
  if (state.status !== 'active') throw new Error('Game already over')
  if (playerIdx !== state.current_turn) throw new Error('Not your turn')
  if (state.awaiting !== 'draw') throw new Error('Cannot drop mid-turn — draw or discard first')
  const player = state.players[playerIdx]
  if (player.has_taken_turn) throw new Error('First Drop is only available before your first turn')
  player.has_dropped = true
  const result = checkLastPlayerStanding(state)
  if (!result) advanceTurn(state)
  return result
}

export function forfeitPlayer(state: RummyState, userId: string): ActionResult | null {
  const idx = state.players.findIndex(p => p.user_id === userId)
  if (idx === -1 || state.status === 'completed') return null
  const player = state.players[idx]
  if (player.is_eliminated || player.has_dropped) return null
  player.is_eliminated = true
  const result = checkLastPlayerStanding(state)
  if (!result && idx === state.current_turn) advanceTurn(state)
  return result
}
