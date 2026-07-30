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
