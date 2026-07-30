# Rummy Game Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Points Rummy (2-6 players, fixed-entry pot payout) as a fully live game — engine, gateway integration, mobile client, admin panel — matching the spec at `docs/superpowers/specs/2026-07-30-rummy-game-design.md`.

**Architecture:** A new standalone Node/TS Fastify service (`services/game-engines/rummy`) mirrors `services/game-engines/ludo`'s shape exactly (Redis game state, per-room lock, Postgres settlement row, `/start /action /bot-turn /leave /state` HTTP contract). `game-gateway` gets `rummy`-branch wiring alongside the existing `ludo`/`teen_patti` branches in `matchmaking.ts` and `index.ts`. Mobile gets a new `mobile/lib/features/games/rummy/` feature folder (offline practice engine + online socket-driven page), matching Ludo's dual-mode pattern. Admin gets `games/Rummy.tsx`, matching `Matka.tsx`'s shape.

**Tech Stack:** Node.js 20 / TypeScript / Fastify / ioredis / pg (engine + gateway), Flutter/Dart (mobile), React 18 + Vite + Ant Design (admin), PostgreSQL (`infra/db/migrations`).

## Global Constraints

- Variant: Points Rummy only (single deal, first valid declare wins). No Pool/Deals Rummy, no per-player point scoring, no rupee-per-point payout — winner takes the pot minus rake, same model as Teen Patti/Ludo.
- Table size: 2–6 players.
- Deck: 2 standard decks (104 cards) + 2 printed jokers = 106 cards.
- Declare validity: at least 2 sequences, at least 1 pure (no jokers of any kind — printed or wild-rank — in that group).
- `game_type_enum` already contains `'rummy'` (from `001_initial.sql`) — no enum migration needed, only a fresh `game_configs` row (the original was deleted in `009_betting_games.sql`).
- No bot-training telemetry table, no personalized-difficulty integration, no `resources/game-configs/rummy.json` — all explicitly out of scope per the spec.
- `is_active=false` on the seeded config row — admin flips it on after manual verification, same rollout gate every other game uses.
- Engine port: `3012` (next free after Ludo's `3011`).
- Follow existing repo conventions exactly: engine tests use Node's built-in `node:test` + `node:assert/strict` (see `ludo/src/rules.test.ts`), not vitest/jest. TypeScript strict mode, CommonJS output (see `ludo/tsconfig.json`).

---

## File Structure

**New files:**
- `services/game-engines/rummy/package.json`, `tsconfig.json`, `.env.example`
- `services/game-engines/rummy/src/rules.ts` — pure game logic (deck, deal, meld validation, turn actions)
- `services/game-engines/rummy/src/rules.test.ts`
- `services/game-engines/rummy/src/coordination.ts` — bot AI
- `services/game-engines/rummy/src/coordination.test.ts`
- `services/game-engines/rummy/src/index.ts` — Fastify HTTP layer
- `infra/db/migrations/20260730_rummy_config.sql`
- `mobile/lib/features/games/rummy/rummy_engine.dart` — offline pure-Dart engine
- `mobile/lib/features/games/rummy/rummy_game_page.dart` — main widget (offline + online)
- `admin-panel/src/pages/games/Rummy.tsx`

**Modified files:**
- `ecosystem.config.js` — new `teen-rummy` PM2 entry
- `services/game-gateway/src/matchmaking.ts` — `/start` engine dispatch, `driveRummyBots`, `scheduleRummyAfkTimer`/`autoPlayIdleRummyTurn`/`clearRummyAfkTimer`, `handleRummyEnd`
- `services/game-gateway/src/index.ts` — `handleRummyAction`, `handleRummyLeave`, action/leave_room routing, `join_room` reconnect hydration
- `admin-panel/src/main.tsx` — route
- `admin-panel/src/pages/layout/menuConfig.ts` — menu entry
- `admin-panel/src/pages/layout/menuConfig.test.ts` — `EXPECTED_KEYS`
- `games/registry.json` — `rummy` status `planned` → `live` (final task, after verification)

---

### Task 1: Engine — deck, deal, initial state

**Files:**
- Create: `services/game-engines/rummy/src/rules.ts`
- Create: `services/game-engines/rummy/src/rules.test.ts`

**Interfaces:**
- Produces: `Suit`, `BotDifficulty`, `Card { id, rank, suit }`, `RummyPlayer { user_id, username, seat, is_bot, bot_difficulty?, hand, has_drawn, has_taken_turn, has_dropped, is_eliminated }`, `RummyState { room_id, stake, rake_percent, players, closed_pile, open_pile, wild_rank, wild_indicator, current_turn, awaiting, status, winner_id, bot_difficulty, turn_timeout_seconds, turn_number }`, `buildDeck(deckCount)`, `shuffle(arr)`, `isJoker(card, wildRank)`, `createInitialState(roomId, stake, players, botDifficulty, deckCount, turnTimeoutSeconds, rakePercent)`.

- [ ] **Step 1: Write the failing tests**

```typescript
// services/game-engines/rummy/src/rules.test.ts
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { buildDeck, createInitialState, isJoker } from './rules'

function makePlayers(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    user_id: `p${i}`, username: `P${i}`, seat: i + 1, is_bot: false,
  }))
}

describe('buildDeck', () => {
  test('2 decks produce 106 cards (2x52 + 2 printed jokers)', () => {
    const deck = buildDeck(2)
    assert.equal(deck.length, 106)
    assert.equal(deck.filter(c => c.suit === 'JK').length, 2)
    assert.equal(new Set(deck.map(c => c.id)).size, 106)
  })
})

describe('createInitialState', () => {
  test('deals 13 cards to each of 4 players and leaves the rest split between piles', () => {
    const state = createInitialState('room1', 100, makePlayers(4), 'medium', 2, 30, 5)
    for (const p of state.players) assert.equal(p.hand.length, 13)
    assert.equal(state.open_pile.length, 1)
    // 106 total - 52 dealt - 1 wild indicator - 1 open pile card
    assert.equal(state.closed_pile.length, 106 - 52 - 1 - 1)
    assert.equal(state.status, 'active')
    assert.equal(state.awaiting, 'draw')
    assert.equal(state.current_turn, 0)
  })

  test('wild_rank matches the indicator card unless the indicator is itself a printed joker', () => {
    const state = createInitialState('room1', 100, makePlayers(2), 'medium', 2, 30, 5)
    if (state.wild_indicator.suit === 'JK') {
      assert.equal(state.wild_rank, '__NONE__')
    } else {
      assert.equal(state.wild_rank, state.wild_indicator.rank)
    }
  })

  test('a printed joker is always a joker regardless of wild_rank', () => {
    const state = createInitialState('room1', 100, makePlayers(2), 'medium', 2, 30, 5)
    assert.equal(isJoker({ id: 'x', rank: 'JOKER', suit: 'JK' }, state.wild_rank), true)
  })

  test('a card matching wild_rank is a joker even when not printed', () => {
    assert.equal(isJoker({ id: 'x', rank: '7', suit: 'S' }, '7'), true)
    assert.equal(isJoker({ id: 'x', rank: '7', suit: 'S' }, '8'), false)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd services/game-engines/rummy && npx tsx --test src/rules.test.ts`
Expected: FAIL — `rules.ts` doesn't exist yet.

- [ ] **Step 3: Implement deck/deal/state**

```typescript
// services/game-engines/rummy/src/rules.ts
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd services/game-engines/rummy && npx tsx --test src/rules.test.ts`
Expected: PASS (4 tests). Note: `package.json`/`tsconfig.json` are created in Task 5 — if `npx tsx` isn't resolvable yet because there's no `node_modules`, run `npm install tsx typescript --no-save` first, or defer running this until Task 5's scaffolding exists. Either order is fine; just confirm green before Task 5's commit.

- [ ] **Step 5: Commit**

```bash
git add services/game-engines/rummy/src/rules.ts services/game-engines/rummy/src/rules.test.ts
git commit -m "feat(rummy): deck, deal, and initial game state"
```

---

### Task 2: Engine — meld validation

**Files:**
- Modify: `services/game-engines/rummy/src/rules.ts`
- Modify: `services/game-engines/rummy/src/rules.test.ts`

**Interfaces:**
- Consumes: `Card`, `isJoker` from Task 1.
- Produces: `checkGroup(cards, wildRank) -> { valid, kind: 'sequence'|'set'|null, pure }`, `validateDeclareGroups(hand, groupsOfIds, wildRank) -> { valid, reason? }`.

- [ ] **Step 1: Write the failing tests**

```typescript
// append to services/game-engines/rummy/src/rules.test.ts
import { checkGroup, validateDeclareGroups } from './rules'

const c = (id: string, rank: string, suit: any) => ({ id, rank, suit })

describe('checkGroup', () => {
  test('3 consecutive same-suit cards with no jokers is a pure sequence', () => {
    const result = checkGroup([c('1', '4', 'S'), c('2', '5', 'S'), c('3', '6', 'S')], '9')
    assert.deepEqual(result, { valid: true, kind: 'sequence', pure: true })
  })

  test('a sequence using a wild-rank card as filler is impure', () => {
    // 4S 5S ?S using a 9(wild) standing in for 6S
    const result = checkGroup([c('1', '4', 'S'), c('2', '5', 'S'), c('3', '9', 'S')], '9')
    assert.equal(result.valid, true)
    assert.equal(result.pure, false)
  })

  test('a printed joker fills a sequence gap and is never pure', () => {
    const result = checkGroup([c('1', '4', 'S'), c('2', 'JOKER', 'JK'), c('3', '6', 'S')], '9')
    assert.equal(result.valid, true)
    assert.equal(result.kind, 'sequence')
    assert.equal(result.pure, false)
  })

  test('mismatched suits is not a valid sequence', () => {
    const result = checkGroup([c('1', '4', 'S'), c('2', '5', 'H'), c('3', '6', 'S')], '9')
    assert.equal(result.valid, false)
  })

  test('3 same-rank distinct-suit cards is a valid set', () => {
    const result = checkGroup([c('1', '7', 'S'), c('2', '7', 'H'), c('3', '7', 'D')], '9')
    assert.deepEqual(result, { valid: true, kind: 'set', pure: false })
  })

  test('a set cannot repeat a suit even across two decks', () => {
    const result = checkGroup([c('1', '7', 'S'), c('2', '7', 'S'), c('3', '7', 'D')], '9')
    assert.equal(result.valid, false)
  })

  test('Ace can run low (A-2-3) or high (Q-K-A) but not wrap (K-A-2)', () => {
    assert.equal(checkGroup([c('1', 'A', 'S'), c('2', '2', 'S'), c('3', '3', 'S')], '9').valid, true)
    assert.equal(checkGroup([c('1', 'Q', 'S'), c('2', 'K', 'S'), c('3', 'A', 'S')], '9').valid, true)
    assert.equal(checkGroup([c('1', 'K', 'S'), c('2', 'A', 'S'), c('3', '2', 'S')], '9').valid, false)
  })

  test('an all-joker group is never valid', () => {
    const result = checkGroup([c('1', 'JOKER', 'JK'), c('2', '9', 'S'), c('3', '9', 'H')], '9')
    assert.equal(result.valid, false)
  })
})

describe('validateDeclareGroups', () => {
  function validHand13() {
    // pure sequence (S: 2-3-4) + sequence (H: 5-6-7) + set (9s: D/C/S) +
    // 4-card set (8s: D/C/H/S) — 3+3+3+4 = 13 cards total, no leftover.
    return [
      c('1', '2', 'S'), c('2', '3', 'S'), c('3', '4', 'S'),
      c('4', '5', 'H'), c('5', '6', 'H'), c('6', '7', 'H'),
      c('7', '9', 'D'), c('8', '9', 'C'), c('9', '9', 'S'),
      c('10', '8', 'D'), c('11', '8', 'C'), c('12', '8', 'H'), c('13', '8', 'S'),
    ]
  }

  test('valid declare: 2 sequences (1 pure) + sets, using all 13 cards', () => {
    const hand = validHand13()
    const groups = [['1', '2', '3'], ['4', '5', '6'], ['7', '8', '9'], ['10', '11', '12', '13']]
    const result = validateDeclareGroups(hand, groups, '__NONE__')
    assert.equal(result.valid, true)
  })

  test('rejects a declare with only 1 sequence', () => {
    const hand = [
      c('1', '2', 'S'), c('2', '3', 'S'), c('3', '4', 'S'), // pure sequence
      c('4', '9', 'D'), c('5', '9', 'C'), c('6', '9', 'S'), // set
      c('7', '8', 'D'), c('8', '8', 'C'), c('9', '8', 'H'), // set
      c('10', '7', 'D'), c('11', '7', 'C'), c('12', '7', 'H'), c('13', '7', 'S'), // set (4)
    ]
    const groups = [['1', '2', '3'], ['4', '5', '6'], ['7', '8', '9'], ['10', '11', '12', '13']]
    const result = validateDeclareGroups(hand, groups, '__NONE__')
    assert.equal(result.valid, false)
    assert.match(result.reason ?? '', /sequence/)
  })

  test('rejects a declare with no pure sequence', () => {
    const hand = [
      c('1', '2', 'S'), c('2', 'JOKER', 'JK'), c('3', '4', 'S'),
      c('4', '5', 'H'), c('5', 'JOKER', 'JK'), c('6', '7', 'H'),
      c('7', '9', 'D'), c('8', '9', 'C'), c('9', '9', 'S'),
      c('10', '8', 'D'), c('11', '8', 'C'), c('12', '8', 'H'), c('13', '8', 'S'),
    ]
    const groups = [['1', '2', '3'], ['4', '5', '6'], ['7', '8', '9'], ['10', '11', '12', '13']]
    const result = validateDeclareGroups(hand, groups, '__NONE__')
    assert.equal(result.valid, false)
    assert.match(result.reason ?? '', /pure/)
  })

  test('rejects groups that reference a card not in hand', () => {
    const hand = validHand13()
    const result = validateDeclareGroups(hand, [['1', '2', '3'], ['4', '5', '6'], ['7', '8', '9'], ['10', '11', '12', '999']], '__NONE__')
    assert.equal(result.valid, false)
  })

  test('rejects groups that do not total exactly 13 cards', () => {
    const hand = validHand13()
    const result = validateDeclareGroups(hand, [['1', '2', '3'], ['4', '5', '6']], '__NONE__')
    assert.equal(result.valid, false)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd services/game-engines/rummy && npx tsx --test src/rules.test.ts`
Expected: FAIL — `checkGroup`/`validateDeclareGroups` not defined.

- [ ] **Step 3: Implement meld validation**

```typescript
// append to services/game-engines/rummy/src/rules.ts
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd services/game-engines/rummy && npx tsx --test src/rules.test.ts`
Expected: PASS (all tests from Task 1 + Task 2).

- [ ] **Step 5: Commit**

```bash
git add services/game-engines/rummy/src/rules.ts services/game-engines/rummy/src/rules.test.ts
git commit -m "feat(rummy): sequence/set meld validation and declare grouping"
```

---

### Task 3: Engine — turn actions (draw, discard, declare, drop, forfeit)

**Files:**
- Modify: `services/game-engines/rummy/src/rules.ts`
- Modify: `services/game-engines/rummy/src/rules.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 1-2.
- Produces: `advanceTurn(state)`, `reshuffleIfNeeded(state)`, `drawFromClosed(state, playerIdx) -> Card`, `drawFromOpen(state, playerIdx) -> Card`, `discardCard(state, playerIdx, cardId)`, `attemptDeclare(state, playerIdx, groupsOfIds) -> { outcome: {valid, reason?}, result: ActionResult|null }`, `dropPlayer(state, playerIdx) -> ActionResult|null`, `forfeitPlayer(state, userId) -> ActionResult|null`.

- [ ] **Step 1: Write the failing tests**

```typescript
// append to services/game-engines/rummy/src/rules.test.ts
import {
  drawFromClosed, drawFromOpen, discardCard, attemptDeclare, dropPlayer, forfeitPlayer, reshuffleIfNeeded,
} from './rules'

describe('turn actions', () => {
  test('drawFromClosed moves a card into the hand and flips awaiting to discard', () => {
    const state = createInitialState('r', 100, makePlayers(2), 'medium', 2, 30, 5)
    const before = state.players[0].hand.length
    drawFromClosed(state, 0)
    assert.equal(state.players[0].hand.length, before + 1)
    assert.equal(state.awaiting, 'discard')
  })

  test('drawFromClosed throws if it is not that player\'s turn', () => {
    const state = createInitialState('r', 100, makePlayers(2), 'medium', 2, 30, 5)
    assert.throws(() => drawFromClosed(state, 1))
  })

  test('discardCard removes the card from hand, pushes it to open_pile, and advances the turn', () => {
    const state = createInitialState('r', 100, makePlayers(3), 'medium', 2, 30, 5)
    drawFromClosed(state, 0)
    const cardId = state.players[0].hand[0].id
    discardCard(state, 0, cardId)
    assert.equal(state.players[0].hand.some(c => c.id === cardId), false)
    assert.equal(state.open_pile[state.open_pile.length - 1].id, cardId)
    assert.equal(state.current_turn, 1)
    assert.equal(state.awaiting, 'draw')
  })

  test('reshuffleIfNeeded rebuilds the closed pile from the open pile (keeping its top card) once empty', () => {
    const state = createInitialState('r', 100, makePlayers(2), 'medium', 2, 30, 5)
    state.open_pile = [{ id: 'a', rank: '2', suit: 'S' }, { id: 'b', rank: '3', suit: 'S' }, { id: 'c', rank: '4', suit: 'S' }]
    state.closed_pile = []
    reshuffleIfNeeded(state)
    assert.equal(state.open_pile.length, 1)
    assert.equal(state.open_pile[0].id, 'c')
    assert.equal(state.closed_pile.length, 2)
  })

  test('an invalid declare eliminates the declarer and play continues to the next active player', () => {
    const state = createInitialState('r', 100, makePlayers(3), 'medium', 2, 30, 5)
    drawFromClosed(state, 0)
    const junkGroups = [state.players[0].hand.slice(0, 3).map(c => c.id), state.players[0].hand.slice(3, 6).map(c => c.id), state.players[0].hand.slice(6, 9).map(c => c.id), state.players[0].hand.slice(9, 13).map(c => c.id)]
    const { outcome, result } = attemptDeclare(state, 0, junkGroups)
    assert.equal(outcome.valid, false)
    assert.equal(state.players[0].is_eliminated, true)
    assert.equal(result, null) // 2 players still active (1, 2), not last-player-standing
    assert.equal(state.current_turn, 1)
  })

  test('dropPlayer before any draw removes them from turn order without elimination', () => {
    const state = createInitialState('r', 100, makePlayers(3), 'medium', 2, 30, 5)
    dropPlayer(state, 0)
    assert.equal(state.players[0].has_dropped, true)
    assert.equal(state.current_turn, 1)
  })

  test('dropPlayer after already taking a turn throws (First Drop only)', () => {
    const state = createInitialState('r', 100, makePlayers(2), 'medium', 2, 30, 5)
    drawFromClosed(state, 0)
    discardCard(state, 0, state.players[0].hand[0].id)
    drawFromClosed(state, 1)
    discardCard(state, 1, state.players[1].hand[0].id)
    assert.throws(() => dropPlayer(state, 0))
  })

  test('last player standing (via drop) wins automatically', () => {
    const state = createInitialState('r', 100, makePlayers(2), 'medium', 2, 30, 5)
    const result = dropPlayer(state, 0)
    assert.equal(result?.winner_id, 'p1')
    assert.equal(state.status, 'completed')
    assert.equal(result?.reason, 'last_player_standing')
  })

  test('forfeitPlayer eliminates a user by id and ends the game if they were last active', () => {
    const state = createInitialState('r', 100, makePlayers(2), 'medium', 2, 30, 5)
    const result = forfeitPlayer(state, 'p0')
    assert.equal(result?.winner_id, 'p1')
    assert.equal(state.status, 'completed')
  })

  test('settlement math: pot minus rake goes to the winner', () => {
    const state = createInitialState('r', 100, makePlayers(2), 'medium', 2, 30, 10)
    const result = dropPlayer(state, 0)
    // pot = 100 * 2 = 200; rake 10% = 20; prize = 180
    assert.equal(result?.rake_fee, 20)
    assert.equal(result?.prize, 180)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd services/game-engines/rummy && npx tsx --test src/rules.test.ts`
Expected: FAIL — turn-action functions not defined.

- [ ] **Step 3: Implement turn actions**

```typescript
// append to services/game-engines/rummy/src/rules.ts
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd services/game-engines/rummy && npx tsx --test src/rules.test.ts`
Expected: PASS (all tests from Tasks 1-3).

- [ ] **Step 5: Commit**

```bash
git add services/game-engines/rummy/src/rules.ts services/game-engines/rummy/src/rules.test.ts
git commit -m "feat(rummy): turn actions — draw, discard, declare, drop, forfeit"
```

---

### Task 4: Engine — bot AI

**Files:**
- Create: `services/game-engines/rummy/src/coordination.ts`
- Create: `services/game-engines/rummy/src/coordination.test.ts`

**Interfaces:**
- Consumes: `RummyState`, `Card`, `isJoker`, `checkGroup`, `validateDeclareGroups` from `./rules`.
- Produces: `chooseBotDraw(state, playerIdx) -> 'closed'|'open'`, `chooseBotDiscard(state, playerIdx) -> string` (card id), `tryBotDeclare(state, playerIdx) -> string[][] | null`.

- [ ] **Step 1: Write the failing tests**

```typescript
// services/game-engines/rummy/src/coordination.test.ts
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { createInitialState } from './rules'
import { chooseBotDraw, chooseBotDiscard, tryBotDeclare } from './coordination'

function makeState() {
  const state = createInitialState('r', 100, [
    { user_id: 'p0', username: 'Bot', seat: 1, is_bot: true, bot_difficulty: 'medium' },
    { user_id: 'p1', username: 'P1', seat: 2, is_bot: false },
  ], 'medium', 2, 30, 5)
  return state
}

describe('chooseBotDraw', () => {
  test('always picks the open pile when its top card is a joker', () => {
    const state = makeState()
    state.open_pile = [{ id: 'x', rank: 'JOKER', suit: 'JK' }]
    assert.equal(chooseBotDraw(state, 0), 'open')
  })

  test('returns closed when the open pile is empty', () => {
    const state = makeState()
    state.open_pile = []
    assert.equal(chooseBotDraw(state, 0), 'closed')
  })
})

describe('chooseBotDiscard', () => {
  test('never discards a joker if a non-joker is available', () => {
    const state = makeState()
    state.players[0].hand = [
      { id: '1', rank: 'JOKER', suit: 'JK' },
      { id: '2', rank: 'K', suit: 'H' },
      { id: '3', rank: '2', suit: 'S' },
    ]
    const discardId = chooseBotDiscard(state, 0)
    assert.notEqual(discardId, '1')
  })
})

describe('tryBotDeclare', () => {
  test('returns null when the hand cannot legally declare', () => {
    const state = makeState()
    // Fresh 13-card deal is essentially never a valid declare — leftover won't be exactly 1 unmatched card.
    const result = tryBotDeclare(state, 0)
    assert.equal(result, null)
  })

  test('returns a valid grouping when the hand can legally declare', () => {
    const state = makeState()
    // wild_rank is normally randomized by createInitialState's wild-indicator
    // draw — pin it so this hand's card ranks can't accidentally collide
    // with it and change which cards count as jokers.
    state.wild_rank = '__NONE__'
    state.players[0].hand = [
      { id: '1', rank: '2', suit: 'S' }, { id: '2', rank: '3', suit: 'S' }, { id: '3', rank: '4', suit: 'S' },
      { id: '4', rank: '5', suit: 'H' }, { id: '5', rank: '6', suit: 'H' }, { id: '6', rank: '7', suit: 'H' },
      { id: '7', rank: '9', suit: 'D' }, { id: '8', rank: '9', suit: 'C' }, { id: '9', rank: '9', suit: 'S' },
      { id: '10', rank: '8', suit: 'D' }, { id: '11', rank: '8', suit: 'C' }, { id: '12', rank: '8', suit: 'H' }, { id: '13', rank: '8', suit: 'S' },
      { id: '14', rank: 'K', suit: 'D' }, // the single leftover (unmatched) card
    ]
    const result = tryBotDeclare(state, 0)
    assert.notEqual(result, null)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd services/game-engines/rummy && npx tsx --test src/coordination.test.ts`
Expected: FAIL — `coordination.ts` doesn't exist.

- [ ] **Step 3: Implement bot AI**

```typescript
// services/game-engines/rummy/src/coordination.ts
import { RummyState, Card, isJoker, checkGroup, validateDeclareGroups } from './rules'

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
  const nonJokers = pool.filter(c => !isJoker(c, state.wild_rank))
  const candidates = nonJokers.length > 0 ? nonJokers : pool
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
export function tryBotDeclare(state: RummyState, playerIdx: number): string[][] | null {
  const player = state.players[playerIdx]
  const { groups, leftover } = greedyGroup(player.hand, state.wild_rank)
  if (leftover.length !== 1) return null
  const groupIds = groups.map(g => g.map(c => c.id))
  const check = validateDeclareGroups(player.hand, groupIds, state.wild_rank)
  return check.valid ? groupIds : null
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd services/game-engines/rummy && npx tsx --test src/coordination.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add services/game-engines/rummy/src/coordination.ts services/game-engines/rummy/src/coordination.test.ts
git commit -m "feat(rummy): heuristic bot AI — draw/discard/declare decisions"
```

---

### Task 5: Engine — HTTP server + scaffolding

**Files:**
- Create: `services/game-engines/rummy/package.json`
- Create: `services/game-engines/rummy/tsconfig.json`
- Create: `services/game-engines/rummy/.env.example`
- Create: `services/game-engines/rummy/src/index.ts`

**Interfaces:**
- Consumes: everything from `./rules` and `./coordination`.
- Produces: HTTP contract `POST /start`, `POST /action`, `POST /bot-turn`, `POST /leave`, `GET /state`, `GET /health` — this is what `game-gateway` (Tasks 7-8) calls.

- [ ] **Step 1: Scaffolding**

```json
// services/game-engines/rummy/package.json
{
  "name": "teen-rummy-engine",
  "version": "1.0.0",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js",
    "test": "tsx --test src/rules.test.ts src/coordination.test.ts"
  },
  "dependencies": {
    "@fastify/cors": "^9.0.1",
    "dotenv": "^16.4.5",
    "fastify": "^4.28.1",
    "ioredis": "^5.4.1",
    "pg": "^8.12.0"
  },
  "devDependencies": {
    "@types/node": "^20.14.10",
    "@types/pg": "^8.11.6",
    "tsx": "^4.16.2",
    "typescript": "^5.5.3"
  }
}
```

```json
// services/game-engines/rummy/tsconfig.json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist"]
}
```

```
# services/game-engines/rummy/.env.example
PORT=3012
NODE_ENV=development
DATABASE_URL=postgresql://teen:teen_secret_2024@localhost:5432/teen_db
REDIS_URL=redis://:teen_redis_2024@localhost:6379
```

- [ ] **Step 2: Install dependencies**

Run: `cd services/game-engines/rummy && npm install`
Expected: `node_modules` created, no errors.

- [ ] **Step 3: Implement the HTTP layer**

```typescript
// services/game-engines/rummy/src/index.ts
import 'dotenv/config'
import crypto from 'crypto'
import Fastify from 'fastify'
import cors from '@fastify/cors'
import Redis from 'ioredis'
import { Pool } from 'pg'
import {
  createInitialState,
  drawFromClosed,
  drawFromOpen,
  discardCard,
  attemptDeclare,
  dropPlayer,
  forfeitPlayer,
  RummyState,
  ActionResult,
  BotDifficulty,
} from './rules'
import { chooseBotDraw, chooseBotDiscard, tryBotDeclare } from './coordination'

const app = Fastify({ logger: false })
const redis = new Redis(process.env.REDIS_URL!, { lazyConnect: true })
const db = new Pool({ connectionString: process.env.DATABASE_URL, max: 10 })

const KEY = (roomId: string) => `rummy:game:${roomId}`
const TTL = 2 * 60 * 60 // 2h

async function loadState(roomId: string): Promise<RummyState | null> {
  const raw = await redis.get(KEY(roomId))
  return raw ? (JSON.parse(raw) as RummyState) : null
}

async function saveState(state: RummyState): Promise<void> {
  await redis.setex(KEY(state.room_id), TTL, JSON.stringify(state))
}

// Same room-lock pattern as the Ludo engine — /action and /bot-turn both do
// load -> mutate -> save with no atomicity of their own; a short-lived Redis
// lock per room_id serializes concurrent calls for the same room.
const LOCK_TTL_MS = 5000
const LOCK_RETRY_MS = 100
const LOCK_MAX_WAIT_MS = 3000
const LOCK_KEY = (roomId: string) => `rummy:lock:${roomId}`

class RoomBusyError extends Error {
  constructor() { super('Room busy, try again') }
}

async function withRoomLock<T>(roomId: string, fn: () => Promise<T>): Promise<T> {
  const token = crypto.randomUUID()
  const lockKey = LOCK_KEY(roomId)
  const deadline = Date.now() + LOCK_MAX_WAIT_MS
  let acquired = false
  while (Date.now() < deadline) {
    const ok = await redis.set(lockKey, token, 'PX', LOCK_TTL_MS, 'NX')
    if (ok === 'OK') { acquired = true; break }
    await new Promise(r => setTimeout(r, LOCK_RETRY_MS))
  }
  if (!acquired) throw new RoomBusyError()
  try {
    return await fn()
  } finally {
    const current = await redis.get(lockKey)
    if (current === token) await redis.del(lockKey)
  }
}

interface StartReq {
  room_id: string
  stake: number
  rake_percent: number
  deck_count: number
  turn_timeout_seconds: number
  bot_difficulty?: BotDifficulty
  players: { user_id: string; username: string; seat: number; is_bot: boolean; bot_difficulty?: BotDifficulty }[]
}

interface ActionReq {
  room_id: string
  user_id: string
  action: 'draw_closed' | 'draw_open' | 'discard' | 'declare' | 'drop'
  card_id?: string
  groups?: string[][]
}

async function start() {
  await app.register(cors, { origin: true })
  if (redis.status === 'wait') await redis.connect()

  app.post('/start', async (req, reply) => {
    const body = req.body as StartReq
    if (!body?.room_id || !body.players?.length) {
      return reply.code(400).send({ error: 'room_id and players required' })
    }
    const validDifficulties: BotDifficulty[] = ['easy', 'medium', 'hard']
    const difficulty = validDifficulties.includes(body.bot_difficulty as BotDifficulty)
      ? (body.bot_difficulty as BotDifficulty)
      : 'medium'
    const state = createInitialState(
      body.room_id,
      body.stake,
      body.players,
      difficulty,
      body.deck_count || 2,
      body.turn_timeout_seconds || 30,
      body.rake_percent ?? 5,
    )
    await saveState(state)
    return state
  })

  app.post('/action', async (req, reply) => {
    const body = req.body as ActionReq
    try {
      return await withRoomLock(body.room_id, async () => {
        const state = await loadState(body.room_id)
        if (!state) return reply.code(404).send({ error: 'Room not found' })
        if (state.status === 'completed') return reply.code(409).send({ error: 'Game already over' })

        const idx = state.players.findIndex(p => p.user_id === body.user_id)
        if (idx === -1) return reply.code(403).send({ error: 'Not in this room' })
        if (idx !== state.current_turn) return reply.code(409).send({ error: 'Not your turn' })

        let result: ActionResult | null = null
        let declareRejectedReason: string | null = null

        try {
          if (body.action === 'draw_closed') {
            drawFromClosed(state, idx)
          } else if (body.action === 'draw_open') {
            drawFromOpen(state, idx)
          } else if (body.action === 'discard') {
            if (!body.card_id) return reply.code(400).send({ error: 'card_id required' })
            discardCard(state, idx, body.card_id)
          } else if (body.action === 'declare') {
            if (!body.groups) return reply.code(400).send({ error: 'groups required' })
            const { outcome, result: declareResult } = attemptDeclare(state, idx, body.groups)
            if (!outcome.valid) declareRejectedReason = outcome.reason ?? 'Invalid declare'
            result = declareResult
          } else if (body.action === 'drop') {
            result = dropPlayer(state, idx)
          } else {
            return reply.code(400).send({ error: 'Unknown action' })
          }
        } catch (e: any) {
          return reply.code(409).send({ error: e.message })
        }

        await saveState(state)
        if (result) void saveCompletedGame(state, result)
        return { state, result, declare_rejected_reason: declareRejectedReason }
      })
    } catch (e) {
      if (e instanceof RoomBusyError) return reply.code(409).send({ error: e.message })
      throw e
    }
  })

  // Convenience endpoint the gateway uses to drive a full bot turn: pick a
  // draw source, try to declare, otherwise discard.
  app.post('/bot-turn', async (req, reply) => {
    const body = req.body as { room_id: string; user_id: string }
    try {
      return await withRoomLock(body.room_id, async () => {
        const state = await loadState(body.room_id)
        if (!state) return reply.code(404).send({ error: 'Room not found' })
        if (state.status === 'completed') return reply.code(409).send({ error: 'Game already over' })
        const idx = state.players.findIndex(p => p.user_id === body.user_id)
        if (idx === -1 || idx !== state.current_turn) {
          return reply.code(409).send({ error: 'Not bot turn' })
        }

        const drawChoice = chooseBotDraw(state, idx)
        if (drawChoice === 'open') drawFromOpen(state, idx)
        else drawFromClosed(state, idx)

        let result: ActionResult | null = null
        const declareGroups = tryBotDeclare(state, idx)
        if (declareGroups) {
          const { result: declareResult } = attemptDeclare(state, idx, declareGroups)
          result = declareResult
        } else {
          const discardId = chooseBotDiscard(state, idx)
          discardCard(state, idx, discardId)
        }

        await saveState(state)
        if (result) void saveCompletedGame(state, result)
        return { state, result }
      })
    } catch (e) {
      if (e instanceof RoomBusyError) return reply.code(409).send({ error: e.message })
      throw e
    }
  })

  app.post('/leave', async (req, reply) => {
    const body = req.body as { room_id: string; user_id: string }
    if (!body?.room_id || !body?.user_id) {
      return reply.code(400).send({ error: 'room_id and user_id required' })
    }
    try {
      return await withRoomLock(body.room_id, async () => {
        const state = await loadState(body.room_id)
        if (!state) return reply.code(404).send({ error: 'Room not found' })
        if (state.status === 'completed') return { state, result: null }

        const result = forfeitPlayer(state, body.user_id)
        await saveState(state)
        if (result) void saveCompletedGame(state, result)
        return { state, result }
      })
    } catch (e) {
      if (e instanceof RoomBusyError) return reply.code(409).send({ error: e.message })
      throw e
    }
  })

  app.get('/state', async (req, reply) => {
    const roomId = (req.query as any)?.room_id
    const state = await loadState(roomId)
    if (!state) return reply.code(404).send({ error: 'Room not found' })
    return state
  })

  app.get('/health', async () => ({ status: 'ok', service: 'rummy-engine' }))

  const port = parseInt(process.env.PORT || '3012')
  app.listen({ port, host: '0.0.0.0' }, (err) => {
    if (err) { console.error(err); process.exit(1) }
    console.log(`Rummy engine running on port ${port}`)
  })
}

async function saveCompletedGame(state: RummyState, result: ActionResult): Promise<void> {
  const attempts = 3
  const pot = Math.round(state.stake * state.players.length * 100) / 100
  for (let i = 1; i <= attempts; i++) {
    try {
      await db.query(
        `UPDATE game_rooms SET status = 'completed', pot_amount = $1,
                platform_fee_collected = $2, ended_at = NOW() WHERE id = $3`,
        [pot, result.rake_fee, state.room_id],
      )
      return
    } catch (err) {
      console.error(`Failed to save completed rummy game (attempt ${i}/${attempts})`, err)
      if (i < attempts) await new Promise(r => setTimeout(r, 1000 * i))
    }
  }
  try {
    await redis.rpush('rummy:reconcile:failed', JSON.stringify({
      room_id: state.room_id,
      winner_id: result.winner_id,
      prize: result.prize,
      rake_fee: result.rake_fee,
      failed_at: Date.now(),
      reason: 'saveCompletedGame: game_rooms UPDATE failed after retries',
    }))
  } catch (redisErr) {
    console.error(`[RECONCILE-NEEDED] Could not even record the reconciliation failure for room=${state.room_id}`, redisErr)
  }
}

start().catch((err) => { console.error(err); process.exit(1) })
```

- [ ] **Step 4: Typecheck and run the full engine test suite**

Run: `cd services/game-engines/rummy && npx tsc --noEmit && npm test`
Expected: no type errors; all `rules.test.ts` + `coordination.test.ts` tests pass.

- [ ] **Step 5: Manual smoke test**

Run (in one terminal): `cd services/game-engines/rummy && cp .env.example .env && npm run dev`

In another terminal:
```bash
curl -s -X POST http://127.0.0.1:3012/start -H 'Content-Type: application/json' -d '{
  "room_id": "smoke1", "stake": 100, "rake_percent": 5, "deck_count": 2, "turn_timeout_seconds": 30,
  "players": [{"user_id":"u1","username":"A","seat":1,"is_bot":false},{"user_id":"u2","username":"B","seat":2,"is_bot":true,"bot_difficulty":"medium"}]
}'
curl -s http://127.0.0.1:3012/health
```
Expected: `/start` returns a state with 2 players holding 13 cards each; `/health` returns `{"status":"ok","service":"rummy-engine"}`. Stop the dev server after confirming (Ctrl+C).

- [ ] **Step 6: Commit**

```bash
git add services/game-engines/rummy/package.json services/game-engines/rummy/tsconfig.json services/game-engines/rummy/.env.example services/game-engines/rummy/src/index.ts services/game-engines/rummy/package-lock.json
git commit -m "feat(rummy): Fastify HTTP layer for the rummy engine"
```

---

### Task 6: Database migration + PM2 process entry

**Files:**
- Create: `infra/db/migrations/20260730_rummy_config.sql`
- Modify: `ecosystem.config.js`

**Interfaces:**
- Produces: a `game_configs` row for `game_type='rummy'` that Task 7/8's gateway code and the admin panel (Task 11) read/write; a `teen-rummy` PM2 process serving the Task 5 engine on port 3012.

- [ ] **Step 1: Write the migration**

```sql
-- infra/db/migrations/20260730_rummy_config.sql
-- Re-seed the rummy game_configs row. It existed in 001_initial.sql but was
-- deleted in 009_betting_games.sql back when the feature was shelved;
-- game_type_enum already contains 'rummy' so no enum change is needed.
INSERT INTO game_configs
  (game_type, is_active, min_players, max_players, stake_options, rake_percent,
   bot_fill_enabled, bot_fill_delay_seconds, max_bot_ratio, bot_difficulty, special_rules)
VALUES
  ('rummy', false, 2, 6, '{10,50,100,500}', 5.00,
   true, 8, 0.75, 'medium',
   jsonb_build_object(
     'deck_count', 2,
     'wild_joker_enabled', true,
     'first_drop_allowed', true,
     'turn_timeout_seconds', 30
   ))
ON CONFLICT (game_type) DO NOTHING;
```

- [ ] **Step 2: Apply it locally and verify**

Run: `bash infra/db/migrate.sh`
Expected: `APPLY 20260730_rummy_config.sql ... INSERT 0 1`. Verify with `psql "$DATABASE_URL" -c "SELECT game_type, is_active, min_players, max_players, rake_percent, special_rules FROM game_configs WHERE game_type='rummy'"` — one row, `is_active=f`.

- [ ] **Step 3: Add the PM2 process entry**

In `ecosystem.config.js`, add a new block immediately after the `teen-ludo` entry (mirrors its shape exactly):

```javascript
    {
      name: 'teen-rummy',
      cwd: `${BASE}/game-engines/rummy`,
      script: 'dist/index.js',
      env_file: ENV_FILE('game-engines/rummy'),
      instances: 1,
      exec_mode: 'fork',
      watch: false,
      max_memory_restart: '200M',
      env: NODE_OPTS,
    },
```

- [ ] **Step 4: Verify the file still parses**

Run: `node -e "require('./ecosystem.config.js')" && echo OK`
Expected: `OK`, no syntax errors.

- [ ] **Step 5: Commit**

```bash
git add infra/db/migrations/20260730_rummy_config.sql ecosystem.config.js
git commit -m "feat(rummy): game_configs seed row + PM2 process entry"
```

---

### Task 7: Gateway — matchmaking.ts wiring

**Files:**
- Modify: `services/game-gateway/src/matchmaking.ts`

**Interfaces:**
- Consumes: the Task 5 engine's `/start`, `/bot-turn` HTTP contract.
- Produces: `driveRummyBots(roomId)`, `scheduleRummyAfkTimer(roomId, turnIdx)`, `clearRummyAfkTimer(roomId)`, `autoPlayIdleRummyTurn(roomId, expectedTurnIdx, expectedDeadline)`, `handleRummyEnd(roomId, result)` — all consumed by Task 8's `index.ts` changes and by `driveRummyBots` itself (reconnect bot-recovery path).
- No changes needed to `joinQueue`/`tryCreateRoom`/`botFillRoom` — confirmed by reading the current code that only Teen Patti gets special-cased there; Ludo rides the generic `game_configs`-driven path (`min_players`/`max_players`/`bot_fill_enabled`/`bot_fill_table_size`), and Rummy's seeded config (Task 6) does too.

- [ ] **Step 1: Add Rummy's engine-start branch inside `startGame`**

Find the Ludo branch in `startGame` (search for `// Ludo runs on its own engine`, currently ends with the closing `}` of `if (gameType === 'ludo') { ... }` around the retry-and-cancel logic — mirror its full shape, including the retry-once and refund-and-cancel-on-failure behavior). Add immediately after that closing brace:

```typescript
    // Rummy runs on its own engine too (draw/discard/declare turns, no
    // dice/cards-in-common-pot shape) — same dedicated-engine pattern as Ludo.
    if (gameType === 'rummy') {
      const engineUrl = process.env.RUMMY_ENGINE_URL || 'http://127.0.0.1:3012'
      const rummyConfigRes = await this.db.query(
        `SELECT rake_percent, special_rules FROM game_configs WHERE game_type = 'rummy'`,
      )
      const rakePercent = Number(rummyConfigRes.rows[0]?.rake_percent) || 5
      const specialRules = rummyConfigRes.rows[0]?.special_rules || {}
      const callRummyStart = () => fetch(`${engineUrl}/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          room_id: roomId,
          stake,
          rake_percent: rakePercent,
          deck_count: specialRules.deck_count || 2,
          turn_timeout_seconds: specialRules.turn_timeout_seconds || 30,
          bot_difficulty: botDifficulty,
          players: gatewayPlayers.map(p => ({
            user_id: p.userId,
            username: p.username,
            seat: p.seat,
            is_bot: p.isBot,
            bot_difficulty: p.botDifficulty,
          })),
        }),
        signal: AbortSignal.timeout(5000),
      })
      try {
        const res = await callRummyStart()
        if (res.ok) engineState = await res.json()
        else console.error(`Rummy engine /start returned ${res.status}`)
      } catch (e) {
        console.error('Rummy engine unavailable, will retry once', e)
      }

      if (!engineState) {
        await new Promise(r => setTimeout(r, 1500))
        try {
          const res = await callRummyStart()
          if (res.ok) engineState = await res.json()
          else console.error(`Rummy engine /start retry returned ${res.status}`)
        } catch (e) {
          console.error('Rummy engine still unavailable after retry', e)
        }
      }

      if (!engineState) {
        if (stake > 0) {
          for (const p of allPlayers) {
            try {
              await fetch(`${process.env.WALLET_SERVICE_URL}/internal/wallet/unlock`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'x-internal-key': process.env.INTERNAL_SERVICE_KEY! },
                body: JSON.stringify({ user_id: p.userId, amount: stake, room_id: roomId }),
              })
            } catch (unlockErr) {
              console.error(`Failed to unlock wallet for user=${p.userId} after Rummy engine start failure:`, unlockErr)
            }
          }
        }
        await this.db.query("UPDATE game_rooms SET status = 'cancelled' WHERE id = $1", [roomId])
          .catch(e => console.error('Failed to mark cancelled Rummy room', e))
        for (const p of realPlayers) {
          this.hub.sendToUser(p.userId, 'error', {
            message: 'Could not start the table — your stake has been refunded. Please try again.',
          })
        }
        return roomId
      }
    }
```

This deliberately does **not** touch the bot-coordination winner-rigging block above it (`if (config.enabled && botCount === 3) { ... }`) — Rummy bots are not part of that system for v1; `botCoordinationForEngine` simply stays unused for `gameType === 'rummy'`, matching the design spec's explicit scope decision.

- [ ] **Step 2: Find where `engineState` is used after the per-game `/start` branches to broadcast `room:joined`/cache initial state**, and confirm it already handles arbitrary `gameType` generically (Ludo doesn't get special extra handling there beyond the `gameType === 'ludo'` tag written into cached state — grep for `gameType: 'ludo'` immediately after the Ludo branch's closing brace to find the shared code path). If a per-`gameType` tag is set on the cached engine state object there (e.g. `{...engineState, gameType}` using the loop variable `gameType`, not a hardcoded string), no change is needed — `gameType` is already `'rummy'` at that point in the shared code path. Confirm this by reading the ~20 lines after the Ludo branch before proceeding; if it turns out to hardcode `'ludo'` there too, add the same generic `gameType` variable in its place (do not hardcode `'rummy'`).

- [ ] **Step 3: Add the Rummy bot-driving loop, AFK timer pair, and clear function**

Add these as new class methods on `MatchmakingService`, placed right after the existing `driveLudoBots`/`scheduleLudoAfkTimer`/`autoPlayIdleLudoTurn`/`clearLudoAfkTimer` methods (same file, same class):

```typescript
  private rummyAfkTimers = new Map<string, NodeJS.Timeout>()
  private static readonly RUMMY_TURN_TIMEOUT_MS = 30000

  // Drive consecutive bot turns for a Rummy room until it's a human's turn
  // or the game ends. Mirrors driveLudoBots exactly.
  async driveRummyBots(roomId: string): Promise<void> {
    const engineUrl = process.env.RUMMY_ENGINE_URL || 'http://127.0.0.1:3012'
    for (let guard = 0; guard < 400; guard++) {
      void GameWatchdog.touch(this.redis, roomId)
      const state = await this.getRoomState(roomId)
      if (!state || state.status === 'completed') return
      const turnIdx = state.current_turn ?? 0
      const cur = state.players?.[turnIdx]
      if (!cur || !(cur.is_bot ?? cur.isBot)) {
        void this.scheduleRummyAfkTimer(roomId, turnIdx)
        return
      }

      await new Promise(r => setTimeout(r, 1200))
      try {
        const res = await fetch(`${engineUrl}/bot-turn`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ room_id: roomId, user_id: cur.user_id ?? cur.userId }),
          signal: AbortSignal.timeout(5000),
        })
        if (!res.ok) return
        const data = await res.json() as any
        const newState = data.state
        await this.setRoomState(roomId, { ...newState, gameType: 'rummy' })
        this.hub.sendToRoom(roomId, 'game:state_update', {
          room_id: roomId,
          state: newState,
          last_action: { user_id: cur.user_id ?? cur.userId, action: 'bot' },
          result: data.result ?? null,
        })
        if (data.result) { await this.handleRummyEnd(roomId, data.result); return }
      } catch (e) {
        console.error('Rummy bot turn error', e)
        return
      }
    }
  }

  private async scheduleRummyAfkTimer(roomId: string, turnIdx: number): Promise<void> {
    const existing = this.rummyAfkTimers.get(roomId)
    if (existing) clearTimeout(existing)
    this.rummyAfkTimers.delete(roomId)

    const state = await this.getRoomState(roomId)
    const timeoutMs = (state?.turn_timeout_seconds ? state.turn_timeout_seconds * 1000 : null) || MatchmakingService.RUMMY_TURN_TIMEOUT_MS
    const deadline = Date.now() + timeoutMs
    try {
      await this.redis.setex(this.rummyAfkRedisKey(roomId), 90, JSON.stringify({ turnIdx, deadline }))
    } catch { /* Redis hiccup — local timer below still provides a backstop */ }

    const timer = setTimeout(() => {
      this.rummyAfkTimers.delete(roomId)
      void this.autoPlayIdleRummyTurn(roomId, turnIdx, deadline)
    }, timeoutMs)
    this.rummyAfkTimers.set(roomId, timer)
  }

  clearRummyAfkTimer(roomId: string): void {
    const existing = this.rummyAfkTimers.get(roomId)
    if (existing) clearTimeout(existing)
    this.rummyAfkTimers.delete(roomId)
    this.redis.del(this.rummyAfkRedisKey(roomId)).catch(() => {})
  }

  private rummyAfkRedisKey(roomId: string): string {
    return `rummy:afk:${roomId}`
  }

  // Fires when a human's turn has sat idle past the timeout. The minimum
  // legal auto-action: draw from the closed pile, then discard the first
  // card in hand (never declares on the player's behalf).
  private async autoPlayIdleRummyTurn(roomId: string, expectedTurnIdx: number, expectedDeadline: number): Promise<void> {
    try {
      const raw = await this.redis.get(this.rummyAfkRedisKey(roomId))
      if (raw) {
        const current = JSON.parse(raw) as { turnIdx: number; deadline: number }
        if (current.turnIdx !== expectedTurnIdx || current.deadline !== expectedDeadline) return
      }
    } catch { /* fall through to the local-only check below */ }

    const engineUrl = process.env.RUMMY_ENGINE_URL || 'http://127.0.0.1:3012'
    const state = await this.getRoomState(roomId)
    if (!state || state.status === 'completed') return
    const turnIdx = state.current_turn ?? 0
    const cur = state.players?.[turnIdx]
    if (!cur || (cur.is_bot ?? cur.isBot)) return

    try {
      const drawRes = await fetch(`${engineUrl}/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ room_id: roomId, user_id: cur.user_id ?? cur.userId, action: 'draw_closed' }),
        signal: AbortSignal.timeout(5000),
      })
      if (!drawRes.ok) return
      const drawData = await drawRes.json() as any
      const handAfterDraw = drawData.state.players[turnIdx].hand
      const discardCardId = handAfterDraw[0].id

      const discardRes = await fetch(`${engineUrl}/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ room_id: roomId, user_id: cur.user_id ?? cur.userId, action: 'discard', card_id: discardCardId }),
        signal: AbortSignal.timeout(5000),
      })
      if (!discardRes.ok) return
      const data = await discardRes.json() as any
      const newState = data.state
      await this.setRoomState(roomId, { ...newState, gameType: 'rummy' })
      this.hub.sendToUser(cur.user_id ?? cur.userId, 'error', {
        message: 'You took too long — your turn was played automatically.',
      })
      this.hub.sendToRoom(roomId, 'game:state_update', {
        room_id: roomId,
        state: newState,
        last_action: { user_id: cur.user_id ?? cur.userId, action: 'auto_afk' },
        result: data.result ?? null,
      })
      if (data.result) { await this.handleRummyEnd(roomId, data.result); return }
      void this.driveRummyBots(roomId)
    } catch (e) {
      console.error('Rummy AFK auto-play failed', e)
    }
  }

  // Settlement — mirrors handleLudoEnd exactly (wallet settle-game call,
  // retry-once, Redis reconcile-failed dead-letter list on repeated failure).
  async handleRummyEnd(roomId: string, result: any): Promise<void> {
    this.clearRummyAfkTimer(roomId)
    try {
      const parts = await this.db.query(
        'SELECT user_id, entry_fee_deducted, is_bot FROM game_participants WHERE room_id = $1',
        [roomId],
      )
      const players = parts.rows.map(r => ({ user_id: r.user_id, entry_fee: parseFloat(r.entry_fee_deducted) || 0 }))

      const effectiveWinnerId = result?.winner_id || null
      const effectivePrize = effectiveWinnerId ? Number(result.prize) : 0

      console.log(`[gateway] handleRummyEnd room=${roomId} winner=${result?.winner_id} prize=${effectivePrize}`)

      const settlePayload = JSON.stringify({
        room_id: roomId,
        winner_id: effectiveWinnerId,
        prize: effectivePrize,
        players,
        idempotency_key: `settle_${roomId}`,
      })
      const callSettle = () => fetch(`${process.env.WALLET_SERVICE_URL}/internal/wallet/settle-game`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-internal-key': process.env.INTERNAL_SERVICE_KEY! },
        body: settlePayload,
      })

      let settleRes = await callSettle()
      let errBody = ''
      if (!settleRes.ok) {
        errBody = await settleRes.text().catch(() => '(unreadable)')
        console.error(`[gateway] settle-game failed ${settleRes.status} for Rummy room ${roomId}, retrying once:`, errBody)
        await new Promise(r => setTimeout(r, 2000))
        settleRes = await callSettle()
        if (!settleRes.ok) errBody = await settleRes.text().catch(() => '(unreadable)')
      }
      if (!settleRes.ok) {
        console.error(`[gateway] settle-game failed again ${settleRes.status} for Rummy room ${roomId}:`, errBody)
        try {
          await this.redis.rpush('rummy:reconcile:failed', JSON.stringify({
            room_id: roomId, winner_id: effectiveWinnerId, prize: effectivePrize, players,
            failed_at: Date.now(), reason: `settle-game HTTP ${settleRes.status}: ${errBody}`,
          }))
        } catch (redisErr) {
          console.error(`[RECONCILE-NEEDED] Could not record settle-game failure for room=${roomId}`, redisErr)
        }
      }
    } catch (err) {
      console.error(`[gateway] handleRummyEnd failed for room=${roomId}:`, err)
    }
  }
```

- [ ] **Step 4: Typecheck**

Run: `cd services/game-gateway && npx tsc --noEmit`
Expected: no errors. If `GameWatchdog`, `getRoomState`, `setRoomState`, or `hub` aren't in scope at the insertion point, double-check the new methods were pasted inside the `MatchmakingService` class body (same indentation level as `driveLudoBots`), not outside it.

- [ ] **Step 5: Commit**

```bash
git add services/game-gateway/src/matchmaking.ts
git commit -m "feat(rummy): game-gateway matchmaking wiring — start, bot-drive, AFK, settlement"
```

---

### Task 8: Gateway — index.ts wiring

**Files:**
- Modify: `services/game-gateway/src/index.ts`

**Interfaces:**
- Consumes: `matchmaking.driveRummyBots`, `matchmaking.clearRummyAfkTimer`, `matchmaking.handleRummyEnd` from Task 7; the Task 5 engine's `/action`, `/leave` HTTP contract.
- Produces: `handleRummyAction(conn, room_id, data)`, `handleRummyLeave(conn, room_id)` — routed from the `game:action`/`leave_room`/`join_room` socket-event switch.

- [ ] **Step 1: Add `handleRummyAction` and `handleRummyLeave`**

Add these two functions immediately after `handleLudoLeave` (same file, same nesting level — they're closures inside the same setup function that has `hub`, `matchmaking`, `redis`, `monitorEmitter` in scope, exactly like `handleLudoAction`):

```typescript
  // Rummy: forward draw/discard/declare/drop to the Rummy engine, broadcast
  // the new state to the room, then either finish or hand off to the bot
  // driver. Mirrors handleLudoAction.
  async function handleRummyAction(conn: Conn, room_id: string, data: any): Promise<void> {
    const engineUrl = process.env.RUMMY_ENGINE_URL || 'http://127.0.0.1:3012'
    try {
      matchmaking.clearRummyAfkTimer(room_id)

      const res = await fetch(`${engineUrl}/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          room_id,
          user_id: conn.userId,
          action: data.action,
          card_id: data.card_id,
          groups: data.groups,
        }),
      })
      if (!res.ok) {
        const msg = await res.text()
        return hub.send(conn, 'error', { message: msg || 'Engine error' })
      }
      const out = await res.json() as any
      const newState = out.state
      monitorEmitter.emit('game_action', {
        game_type: 'rummy',
        room_id,
        user_id: conn.userId,
        action: data.action,
        amount: 0,
      })
      await matchmaking.setRoomState(room_id, { ...newState, gameType: 'rummy' })
      hub.sendToRoom(room_id, 'game:state_update', {
        room_id,
        state: newState,
        last_action: { user_id: conn.userId, action: data.action },
        ts: Date.now(),
        result: out.result ?? null,
        declare_rejected_reason: out.declare_rejected_reason ?? null,
      })
      if (out.result) {
        await matchmaking.handleRummyEnd(room_id, out.result)
      } else {
        void matchmaking.driveRummyBots(room_id)
      }
    } catch (e) {
      console.error('Rummy action failed', e)
      hub.send(conn, 'error', { message: 'Engine unavailable' })
    }
  }

  // A real player tapped Leave in a Rummy game — forfeit. Consistent with
  // Ludo: no refund, game continues or ends via last-player-standing.
  async function handleRummyLeave(conn: Conn, room_id: string): Promise<void> {
    const engineUrl = process.env.RUMMY_ENGINE_URL || 'http://127.0.0.1:3012'
    try {
      matchmaking.clearRummyAfkTimer(room_id)
      const res = await fetch(`${engineUrl}/leave`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ room_id, user_id: conn.userId }),
      })
      if (!res.ok) return
      const out = await res.json() as any
      if (out.state) {
        await matchmaking.setRoomState(room_id, { ...out.state, gameType: 'rummy' })
        hub.sendToRoom(room_id, 'game:state_update', {
          room_id,
          state: out.state,
          last_action: { user_id: conn.userId, action: 'leave' },
          ts: Date.now(),
          result: out.result ?? null,
        })
      }
      if (out.result) {
        await matchmaking.handleRummyEnd(room_id, out.result)
      } else {
        void matchmaking.driveRummyBots(room_id)
      }
    } catch (e) {
      console.error('Rummy leave failed', e)
    }
  }
```

- [ ] **Step 2: Route `game:action` and `leave_room` to the new handlers**

In the `case 'game:action':` block, change:
```typescript
        if (rawState && (rawState.gameType === 'ludo' || rawState.game_type === 'ludo')) {
          return handleLudoAction(conn, data.room_id, data)
        }
```
to:
```typescript
        if (rawState && (rawState.gameType === 'ludo' || rawState.game_type === 'ludo')) {
          return handleLudoAction(conn, data.room_id, data)
        }
        if (rawState && (rawState.gameType === 'rummy' || rawState.game_type === 'rummy')) {
          return handleRummyAction(conn, data.room_id, data)
        }
```

In the `case 'leave_room':` block, change:
```typescript
        const rawState = await matchmaking.getRoomState(data.room_id)
        if (rawState && (rawState.gameType === 'ludo' || rawState.game_type === 'ludo')) {
          return handleLudoLeave(conn, data.room_id)
        }
        return
```
to:
```typescript
        const rawState = await matchmaking.getRoomState(data.room_id)
        if (rawState && (rawState.gameType === 'ludo' || rawState.game_type === 'ludo')) {
          return handleLudoLeave(conn, data.room_id)
        }
        if (rawState && (rawState.gameType === 'rummy' || rawState.game_type === 'rummy')) {
          return handleRummyLeave(conn, data.room_id)
        }
        return
```

- [ ] **Step 3: Include Rummy in `join_room` reconnect state hydration and bot recovery**

Change:
```typescript
            state: gameType === 'ludo' ? rawState : undefined,
```
to:
```typescript
            state: (gameType === 'ludo' || gameType === 'rummy') ? rawState : undefined,
```

Change:
```typescript
            if (rawState.gameType === 'ludo' || rawState.game_type === 'ludo') {
              void matchmaking.driveLudoBots(room_id)
            } else {
```
to:
```typescript
            if (rawState.gameType === 'ludo' || rawState.game_type === 'ludo') {
              void matchmaking.driveLudoBots(room_id)
            } else if (rawState.gameType === 'rummy' || rawState.game_type === 'rummy') {
              void matchmaking.driveRummyBots(room_id)
            } else {
```

- [ ] **Step 4: Typecheck**

Run: `cd services/game-gateway && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add services/game-gateway/src/index.ts
git commit -m "feat(rummy): game-gateway action routing and reconnect hydration"
```

---

### Task 9: Mobile — offline practice engine

**Files:**
- Create: `mobile/lib/features/games/rummy/rummy_engine.dart`

**Interfaces:**
- Produces: `RummyCard { id, rank, suit }`, `RummyPlayerState { userId, username, isBot, hand, hasDropped, isEliminated }`, `RummyEngineState { players, closedPile, openPile, wildRank, currentTurn, awaiting, status, winnerId }`, `RummyEngine` class with `createGame(players) -> RummyEngineState`, `drawFromClosed(state, playerIdx)`, `drawFromOpen(state, playerIdx)`, `discard(state, playerIdx, cardId)`, `declare(state, playerIdx, groups) -> bool`, `checkGroup(cards, wildRank) -> bool` — a Dart port of the same rules as `rules.ts` Tasks 1-3, scoped down to what offline practice mode needs (no rake/pot math — offline practice is unstaked).

- [ ] **Step 1: Implement the Dart engine**

```dart
// mobile/lib/features/games/rummy/rummy_engine.dart
import 'dart:math';

class RummyCard {
  final String id;
  final String rank; // 'A'..'10','J','Q','K','JOKER'
  final String suit; // 'S','H','D','C','JK'
  RummyCard(this.id, this.rank, this.suit);
}

class RummyPlayerState {
  final String userId;
  final String username;
  final bool isBot;
  List<RummyCard> hand = [];
  bool hasDrawn = false;
  bool hasTakenTurn = false;
  bool hasDropped = false;
  bool isEliminated = false;
  RummyPlayerState(this.userId, this.username, this.isBot);
}

class RummyEngineState {
  final List<RummyPlayerState> players;
  List<RummyCard> closedPile;
  List<RummyCard> openPile;
  final String wildRank;
  int currentTurn = 0;
  String awaiting = 'draw'; // 'draw' | 'discard'
  String status = 'active'; // 'active' | 'completed'
  String? winnerId;

  RummyEngineState({
    required this.players,
    required this.closedPile,
    required this.openPile,
    required this.wildRank,
  });
}

const _suits = ['S', 'H', 'D', 'C'];
const _ranks = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const _rankValue = {
  'A': 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9,
  '10': 10, 'J': 11, 'Q': 12, 'K': 13,
};

bool isJokerCard(RummyCard card, String wildRank) => card.suit == 'JK' || card.rank == wildRank;

class RummyEngine {
  final _rand = Random();

  List<RummyCard> _buildDeck() {
    final deck = <RummyCard>[];
    var n = 0;
    for (var d = 0; d < 2; d++) {
      for (final suit in _suits) {
        for (final rank in _ranks) {
          deck.add(RummyCard('c${n++}', rank, suit));
        }
      }
      deck.add(RummyCard('c${n++}', 'JOKER', 'JK'));
    }
    return deck;
  }

  List<RummyCard> _shuffle(List<RummyCard> deck) {
    final out = List<RummyCard>.from(deck);
    for (var i = out.length - 1; i > 0; i--) {
      final j = _rand.nextInt(i + 1);
      final tmp = out[i];
      out[i] = out[j];
      out[j] = tmp;
    }
    return out;
  }

  RummyEngineState createGame(List<RummyPlayerState> players) {
    final deck = _shuffle(_buildDeck());
    var cursor = 0;
    for (var round = 0; round < 13; round++) {
      for (final p in players) {
        p.hand.add(deck[cursor++]);
      }
    }
    final wildIndicator = deck[cursor++];
    final wildRank = wildIndicator.suit == 'JK' ? '__NONE__' : wildIndicator.rank;
    final openPile = [deck[cursor++]];
    final closedPile = deck.sublist(cursor);
    return RummyEngineState(
      players: players,
      closedPile: closedPile,
      openPile: openPile,
      wildRank: wildRank,
    );
  }

  void _reshuffleIfNeeded(RummyEngineState s) {
    if (s.closedPile.isNotEmpty) return;
    if (s.openPile.length <= 1) return;
    final top = s.openPile.removeLast();
    s.closedPile = _shuffle(s.openPile);
    s.openPile = [top];
  }

  RummyCard drawFromClosed(RummyEngineState s, int playerIdx) {
    _reshuffleIfNeeded(s);
    final card = s.closedPile.removeLast();
    s.players[playerIdx].hand.add(card);
    s.players[playerIdx].hasDrawn = true;
    s.awaiting = 'discard';
    return card;
  }

  RummyCard drawFromOpen(RummyEngineState s, int playerIdx) {
    final card = s.openPile.removeLast();
    s.players[playerIdx].hand.add(card);
    s.players[playerIdx].hasDrawn = true;
    s.awaiting = 'discard';
    return card;
  }

  void _advanceTurn(RummyEngineState s) {
    final n = s.players.length;
    var next = s.currentTurn;
    for (var i = 0; i < n; i++) {
      next = (next + 1) % n;
      if (!s.players[next].isEliminated && !s.players[next].hasDropped) {
        s.currentTurn = next;
        s.awaiting = 'draw';
        return;
      }
    }
  }

  List<RummyPlayerState> _active(RummyEngineState s) =>
      s.players.where((p) => !p.isEliminated && !p.hasDropped).toList();

  void _checkLastStanding(RummyEngineState s) {
    final active = _active(s);
    if (active.length == 1) {
      s.status = 'completed';
      s.winnerId = active[0].userId;
    }
  }

  void discard(RummyEngineState s, int playerIdx, String cardId) {
    final player = s.players[playerIdx];
    final idx = player.hand.indexWhere((c) => c.id == cardId);
    final card = player.hand.removeAt(idx);
    s.openPile.add(card);
    player.hasDrawn = false;
    player.hasTakenTurn = true;
    _advanceTurn(s);
  }

  void dropPlayer(RummyEngineState s, int playerIdx) {
    s.players[playerIdx].hasDropped = true;
    _checkLastStanding(s);
    if (s.status != 'completed') _advanceTurn(s);
  }

  // Returns true and completes the game if valid; false (and eliminates the
  // player) if invalid. groups is a list of card-id lists.
  bool declare(RummyEngineState s, int playerIdx, List<List<String>> groups) {
    final player = s.players[playerIdx];
    final valid = _validateDeclare(player.hand, groups, s.wildRank);
    if (!valid) {
      player.isEliminated = true;
      _checkLastStanding(s);
      if (s.status != 'completed') _advanceTurn(s);
      return false;
    }
    s.status = 'completed';
    s.winnerId = player.userId;
    return true;
  }

  ({bool valid, String? kind, bool pure}) checkGroup(List<RummyCard> cards, String wildRank) {
    final seq = _isValidSequence(cards, wildRank);
    if (seq.valid) return (valid: true, kind: 'sequence', pure: seq.pure);
    if (_isValidSet(cards, wildRank)) return (valid: true, kind: 'set', pure: false);
    return (valid: false, kind: null, pure: false);
  }

  ({bool valid, bool pure}) _isValidSequence(List<RummyCard> cards, String wildRank) {
    if (cards.length < 3) return (valid: false, pure: false);
    final jokers = cards.where((c) => isJokerCard(c, wildRank)).toList();
    final naturals = cards.where((c) => !isJokerCard(c, wildRank)).toList();
    if (naturals.isEmpty) return (valid: false, pure: false);
    final suit = naturals[0].suit;
    if (naturals.any((c) => c.suit != suit)) return (valid: false, pure: false);

    final size = cards.length;
    final hasAce = naturals.any((c) => c.rank == 'A');
    final aceOptions = hasAce ? [1, 14] : [null];
    for (final aceValue in aceOptions) {
      final values = naturals
          .map((c) => (c.rank == 'A' && aceValue != null) ? aceValue : _rankValue[c.rank]!)
          .toList();
      if (values.toSet().length != values.length) continue;
      final natMin = values.reduce(min);
      final natMax = values.reduce(max);
      // Jokers can extend the run past the naturals' own min/max, not just
      // fill internal gaps — search every window of length `size` that fully
      // contains [natMin, natMax] and stays within the valid rank range.
      final maxRank = aceValue == 14 ? 14 : 13;
      const minRank = 1;
      final lowStart = max(minRank, natMax - size + 1);
      final lowEnd = min(natMin, maxRank - size + 1);
      if (lowStart <= lowEnd) return (valid: true, pure: jokers.isEmpty);
    }
    return (valid: false, pure: false);
  }

  bool _isValidSet(List<RummyCard> cards, String wildRank) {
    if (cards.length < 3 || cards.length > 4) return false;
    final jokers = cards.where((c) => isJokerCard(c, wildRank)).toList();
    final naturals = cards.where((c) => !isJokerCard(c, wildRank)).toList();
    if (naturals.isEmpty) return false;
    final rank = naturals[0].rank;
    if (naturals.any((c) => c.rank != rank)) return false;
    final suits = naturals.map((c) => c.suit).toList();
    if (suits.toSet().length != suits.length) return false;
    return naturals.length + jokers.length == cards.length;
  }

  bool _validateDeclare(List<RummyCard> hand, List<List<String>> groups, String wildRank) {
    final flat = groups.expand((g) => g).toList();
    if (flat.length != 13) return false;
    if (flat.toSet().length != flat.length) return false;
    final handIds = hand.map((c) => c.id).toSet();
    if (!flat.every((id) => handIds.contains(id))) return false;
    final byId = {for (final c in hand) c.id: c};
    var sequenceCount = 0;
    var pureCount = 0;
    for (final ids in groups) {
      if (ids.length < 3) return false;
      final cards = ids.map((id) => byId[id]!).toList();
      final check = checkGroup(cards, wildRank);
      if (!check.valid) return false;
      if (check.kind == 'sequence') {
        sequenceCount++;
        if (check.pure) pureCount++;
      }
    }
    return sequenceCount >= 2 && pureCount >= 1;
  }
}
```

- [ ] **Step 2: Manual verification**

Since Flutter's default test setup isn't in this plan's scope (no `rummy_engine_test.dart` exists in the repo's `mobile/test/` conventions to mirror from — confirm by running `ls mobile/test 2>/dev/null` before deciding whether to add one; if a `test/features/games/` pattern already exists for Ludo, mirror it with a couple of basic engine tests analogous to Task 1/3's Node tests). At minimum, run:

Run: `cd mobile && flutter analyze lib/features/games/rummy/rummy_engine.dart`
Expected: no errors (warnings about unused elements are fine at this stage — `rummy_game_page.dart` in Task 10 will use them).

- [ ] **Step 3: Commit**

```bash
git add mobile/lib/features/games/rummy/rummy_engine.dart
git commit -m "feat(rummy): offline practice-mode Dart engine"
```

---

### Task 10: Mobile — Rummy game page (offline + online)

**Files:**
- Create: `mobile/lib/features/games/rummy/rummy_game_page.dart`

**Interfaces:**
- Consumes: `RummyEngine`, `RummyEngineState`, `RummyPlayerState`, `RummyCard`, `isJokerCard` from Task 9's `rummy_engine.dart`; `SocketService`, `SocketEvents`, `ApiClient` from `core/socket`, `core/constants`, `core/network` (same imports Ludo's page uses); `AppColors`/`AppSnackBar`/`formatCurrency` from `shared/theme/app_theme.dart`.
- Produces: `RummyGamePage` widget, constructed the same way `LudoGamePage` is (`offline: true` for practice, or `roomId` + `initialData` for online), so it can be registered in the app's router the same way Ludo's page already is (locate that registration — likely `mobile/lib/core/router/app_router.dart` or similar — via `grep -rn "LudoGamePage" mobile/lib` — and add the equivalent `RummyGamePage` route in that same file as part of this task).

- [ ] **Step 1: Locate the Ludo route registration to mirror**

Run: `grep -rn "LudoGamePage" mobile/lib --include=*.dart | grep -v ludo_game_page.dart`
Expected: one or more matches showing where/how `LudoGamePage` is registered as a route (e.g. a `GoRoute` with a path like `/games/ludo/table` and a builder passing `offline`/`roomId`/`initialData` from route extras). Note the exact file and pattern — Step 4 below adds the Rummy equivalent there.

- [ ] **Step 2: Implement the game page**

```dart
// mobile/lib/features/games/rummy/rummy_game_page.dart
import 'dart:async';
import 'package:flutter/material.dart';
import '../../../core/socket/socket_service.dart';
import '../../../core/constants/socket_events.dart';
import '../../../core/network/api_client.dart';
import '../../../shared/theme/app_theme.dart';
import 'rummy_engine.dart';

class RummyGamePage extends StatefulWidget {
  final bool offline;
  final String roomId;
  final Map<String, dynamic>? initialData;
  const RummyGamePage({
    super.key,
    this.offline = false,
    this.roomId = 'PRACTICE',
    this.initialData,
  });

  @override
  State<RummyGamePage> createState() => _RummyGamePageState();
}

class _RummyGamePageState extends State<RummyGamePage> {
  final _engine = RummyEngine();
  final _socket = SocketService();
  final _api = ApiClient();
  final _subs = <StreamSubscription>[];

  RummyEngineState? _offlineState;
  Map<String, dynamic>? _onlineState;
  int _mySeatIndex = 0;
  String? _myUserId;
  final Set<String> _selectedCardIds = {};
  bool _actionPending = false;
  String? _banner;

  static const int _turnTimerSeconds = 30;
  Timer? _turnTimer;
  int _turnSecondsLeft = _turnTimerSeconds;

  @override
  void initState() {
    super.initState();
    widget.offline ? _initOffline() : _initOnline();
  }

  @override
  void dispose() {
    _turnTimer?.cancel();
    for (final s in _subs) {
      s.cancel();
    }
    super.dispose();
  }

  // ── Offline practice ──────────────────────────────────────────────────
  void _initOffline() {
    final players = [
      RummyPlayerState('me', 'You', false),
      RummyPlayerState('bot1', 'Riya', true),
    ];
    _offlineState = _engine.createGame(players);
    _mySeatIndex = 0;
    _myUserId = 'me';
    setState(() => _banner = 'Your turn — draw a card');
    _syncTurnTimer();
    _maybeDriveOfflineBot();
  }

  void _syncTurnTimer() {
    final isMyTurn = widget.offline
        ? _offlineState?.currentTurn == _mySeatIndex
        : (_onlineState?['current_turn'] == _mySeatIndex);
    final active = isMyTurn && !_actionPending;
    if (active) {
      _turnTimer ??= Timer.periodic(const Duration(seconds: 1), (t) {
        if (!mounted) {
          t.cancel();
          return;
        }
        setState(() {
          _turnSecondsLeft--;
          if (_turnSecondsLeft <= 0) {
            _turnSecondsLeft = 0;
            t.cancel();
            _turnTimer = null;
          }
        });
      });
    } else {
      _turnTimer?.cancel();
      _turnTimer = null;
      _turnSecondsLeft = _turnTimerSeconds;
    }
  }

  Future<void> _maybeDriveOfflineBot() async {
    final s = _offlineState;
    if (s == null || s.status != 'active') return;
    final cur = s.players[s.currentTurn];
    if (!cur.isBot) {
      _syncTurnTimer();
      return;
    }
    await Future.delayed(const Duration(milliseconds: 900));
    if (!mounted) return;
    final idx = s.currentTurn;
    // Simple offline-bot behavior: always draw closed, discard highest
    // non-joker card. (Online bots use the richer coordination.ts heuristic
    // server-side — this offline stand-in only needs to be playable.)
    _engine.drawFromClosed(s, idx);
    final hand = s.players[idx].hand;
    final nonJokers = hand.where((c) => !isJokerCard(c, s.wildRank)).toList();
    final pool = nonJokers.isNotEmpty ? nonJokers : hand;
    final discard = pool.reduce((a, b) => _cardValue(a) >= _cardValue(b) ? a : b);
    _engine.discard(s, idx, discard.id);
    setState(() => _banner = "${cur.username} played");
    if (s.status == 'completed') {
      setState(() => _banner = s.winnerId == _myUserId ? 'You win! 🎉' : '${s.players.firstWhere((p) => p.userId == s.winnerId).username} wins');
      return;
    }
    _maybeDriveOfflineBot();
  }

  int _cardValue(RummyCard c) {
    if (c.rank == 'A') return 1;
    if (['J', 'Q', 'K'].contains(c.rank)) return 10;
    return int.tryParse(c.rank) ?? 10;
  }

  void _offlineDrawClosed() {
    final s = _offlineState;
    if (s == null || s.currentTurn != _mySeatIndex || s.awaiting != 'draw') return;
    setState(() => _engine.drawFromClosed(s, _mySeatIndex));
  }

  void _offlineDrawOpen() {
    final s = _offlineState;
    if (s == null || s.currentTurn != _mySeatIndex || s.awaiting != 'draw' || s.openPile.isEmpty) return;
    setState(() => _engine.drawFromOpen(s, _mySeatIndex));
  }

  void _offlineDiscard(String cardId) {
    final s = _offlineState;
    if (s == null || s.currentTurn != _mySeatIndex || s.awaiting != 'discard') return;
    setState(() {
      _engine.discard(s, _mySeatIndex, cardId);
      _selectedCardIds.clear();
    });
    _maybeDriveOfflineBot();
  }

  void _offlineDeclare() {
    final s = _offlineState;
    if (s == null || s.currentTurn != _mySeatIndex || s.awaiting != 'discard') return;
    // Minimal v1 grouping UX: every 3 (or 4) consecutive selected cards in
    // hand order becomes one group. Players arrange their hand via tap
    // reordering (not implemented in this pass — see rummy_board.dart
    // follow-up) so for now groups are inferred in fixed chunks of 3 from
    // the hand's current order, using the trailing 4th card in the first
    // group when 13 doesn't divide evenly by 3.
    final hand = s.players[_mySeatIndex].hand;
    if (hand.length != 14) return;
    final ids = hand.map((c) => c.id).toList()..removeLast();
    final groups = <List<String>>[];
    var i = 0;
    while (i < ids.length) {
      final size = (ids.length - i) == 4 ? 4 : 3;
      groups.add(ids.sublist(i, i + size));
      i += size;
    }
    final won = _engine.declare(s, _mySeatIndex, groups);
    setState(() {
      _banner = won
          ? 'You win! 🎉'
          : 'Invalid declare — you\'re out';
    });
    if (s.status != 'completed') _maybeDriveOfflineBot();
  }

  // ── Online ────────────────────────────────────────────────────────────
  void _initOnline() {
    _myUserId = ApiClient.currentUserId;
    final hasInitialState = widget.initialData != null && widget.initialData!['state'] != null;
    if (!hasInitialState) {
      _socket.emit(SocketEvents.joinRoom, {'room_id': widget.roomId});
    } else {
      _onlineState = Map<String, dynamic>.from(widget.initialData!['state']);
      _mySeatIndex = widget.initialData!['your_seat'] != null ? (widget.initialData!['your_seat'] as int) - 1 : 0;
    }
    _subs.add(_socket.on(SocketEvents.roomJoined).listen((data) {
      if (!mounted) return;
      setState(() {
        _onlineState = data['state'] != null ? Map<String, dynamic>.from(data['state']) : _onlineState;
        _mySeatIndex = (data['your_seat'] ?? 1) - 1;
      });
      _syncTurnTimer();
    }));
    _subs.add(_socket.on('game:state_update').listen((data) {
      if (!mounted || data['room_id'] != widget.roomId) return;
      setState(() {
        _onlineState = Map<String, dynamic>.from(data['state']);
        _actionPending = false;
        final result = data['result'];
        if (result != null) {
          _banner = result['winner_id'] == _myUserId ? 'You win! 🎉' : 'Game over';
        } else if (data['declare_rejected_reason'] != null) {
          _banner = 'Invalid declare: ${data['declare_rejected_reason']}';
        }
      });
      _syncTurnTimer();
    }));
    _subs.add(_socket.on('error').listen((data) {
      if (!mounted) return;
      AppSnackBar.show(context, data['message'] ?? 'Error', error: true);
      setState(() => _actionPending = false);
    }));
  }

  void _onlineAction(String action, {String? cardId, List<List<String>>? groups}) {
    if (_actionPending) return;
    setState(() => _actionPending = true);
    _socket.emit(SocketEvents.gameAction, {
      'room_id': widget.roomId,
      'action': action,
      if (cardId != null) 'card_id': cardId,
      if (groups != null) 'groups': groups,
    });
  }

  // ── Shared UI ─────────────────────────────────────────────────────────
  RummyEngineState? get _offline => widget.offline ? _offlineState : null;
  bool get _isMyTurn => widget.offline
      ? _offlineState?.currentTurn == _mySeatIndex
      : (_onlineState?['current_turn'] == _mySeatIndex);
  String get _awaiting => widget.offline ? (_offlineState?.awaiting ?? 'draw') : (_onlineState?['awaiting'] ?? 'draw');

  List<Map<String, String>> get _myHand {
    if (widget.offline) {
      return (_offlineState?.players[_mySeatIndex].hand ?? [])
          .map((c) => {'id': c.id, 'rank': c.rank, 'suit': c.suit})
          .toList();
    }
    final players = (_onlineState?['players'] as List?) ?? [];
    if (_mySeatIndex >= players.length) return [];
    final hand = (players[_mySeatIndex]['hand'] as List?) ?? [];
    return hand.map((c) => {'id': c['id'] as String, 'rank': c['rank'] as String, 'suit': c['suit'] as String}).toList();
  }

  Widget _cardWidget(Map<String, String> card) {
    final selected = _selectedCardIds.contains(card['id']);
    final isRed = card['suit'] == 'H' || card['suit'] == 'D';
    final suitSymbol = {'S': '♠', 'H': '♥', 'D': '♦', 'C': '♣', 'JK': '🃏'}[card['suit']] ?? '';
    return GestureDetector(
      onTap: () => setState(() {
        selected ? _selectedCardIds.remove(card['id']) : _selectedCardIds.add(card['id']!);
      }),
      child: Container(
        width: 44,
        height: 64,
        margin: const EdgeInsets.symmetric(horizontal: 2),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(6),
          border: Border.all(color: selected ? AppColors.gold : Colors.black26, width: selected ? 2 : 1),
        ),
        alignment: Alignment.center,
        child: Text(
          card['rank'] == 'JOKER' ? '🃏' : '${card['rank']}$suitSymbol',
          style: TextStyle(
            color: card['rank'] == 'JOKER' ? Colors.purple : (isRed ? Colors.red : Colors.black),
            fontWeight: FontWeight.bold,
            fontSize: 13,
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final hand = _myHand;
    final canAct = _isMyTurn && !_actionPending;
    final awaitingDraw = _awaiting == 'draw';

    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        title: const Text('Rummy'),
        backgroundColor: AppColors.surface,
      ),
      body: Column(
        children: [
          if (_banner != null)
            Padding(
              padding: const EdgeInsets.all(8),
              child: Text(_banner!, style: const TextStyle(color: AppColors.gold, fontWeight: FontWeight.bold)),
            ),
          if (canAct)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 4),
              child: Text(
                awaitingDraw ? 'Your turn — draw a card ($_turnSecondsLeft s)' : 'Select 13 cards to declare, or discard one ($_turnSecondsLeft s)',
                style: const TextStyle(color: Colors.white70, fontSize: 12),
              ),
            ),
          const Spacer(),
          Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              GestureDetector(
                onTap: canAct && awaitingDraw ? (widget.offline ? _offlineDrawClosed : () => _onlineAction('draw_closed')) : null,
                child: Container(
                  width: 50, height: 70,
                  decoration: BoxDecoration(color: AppColors.surface, borderRadius: BorderRadius.circular(6), border: Border.all(color: Colors.white24)),
                  alignment: Alignment.center,
                  child: const Text('Closed', style: TextStyle(color: Colors.white70, fontSize: 10)),
                ),
              ),
              const SizedBox(width: 24),
              GestureDetector(
                onTap: canAct && awaitingDraw ? (widget.offline ? _offlineDrawOpen : () => _onlineAction('draw_open')) : null,
                child: Container(
                  width: 50, height: 70,
                  decoration: BoxDecoration(color: AppColors.surface, borderRadius: BorderRadius.circular(6), border: Border.all(color: Colors.white24)),
                  alignment: Alignment.center,
                  child: const Text('Open', style: TextStyle(color: Colors.white70, fontSize: 10)),
                ),
              ),
            ],
          ),
          const Spacer(),
          SizedBox(
            height: 80,
            child: ListView(scrollDirection: Axis.horizontal, children: hand.map(_cardWidget).toList()),
          ),
          Padding(
            padding: const EdgeInsets.all(12),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceEvenly,
              children: [
                ElevatedButton(
                  onPressed: canAct && !awaitingDraw && _selectedCardIds.length == 1
                      ? () {
                          final id = _selectedCardIds.first;
                          widget.offline ? _offlineDiscard(id) : _onlineAction('discard', cardId: id);
                        }
                      : null,
                  child: const Text('Discard'),
                ),
                ElevatedButton(
                  onPressed: canAct && !awaitingDraw
                      ? (widget.offline ? _offlineDeclare : () => _onlineAction('declare', groups: _naiveGroupsFromHand(hand)))
                      : null,
                  style: ElevatedButton.styleFrom(backgroundColor: AppColors.green),
                  child: const Text('Declare'),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  // Same fixed-chunk grouping fallback as _offlineDeclare, for the online
  // path. The server is authoritative regardless of what's submitted here.
  List<List<String>> _naiveGroupsFromHand(List<Map<String, String>> hand) {
    if (hand.length != 14) return [];
    final ids = hand.map((c) => c['id']!).toList()..removeLast();
    final groups = <List<String>>[];
    var i = 0;
    while (i < ids.length) {
      final size = (ids.length - i) == 4 ? 4 : 3;
      groups.add(ids.sublist(i, i + size));
      i += size;
    }
    return groups;
  }
}
```

- [ ] **Step 2: Register the route**

Using the pattern found in Step 1, add a `RummyGamePage` route alongside the existing `LudoGamePage` one (same file, same shape — offline practice route + online room route with `roomId`/`initialData` passed through).

- [ ] **Step 3: Analyze**

Run: `cd mobile && flutter analyze lib/features/games/rummy/`
Expected: no errors. If `ApiClient.currentUserId` doesn't exist under that exact name, grep how `LudoGamePage`/other online pages currently determine "my user id" (e.g. an auth store/bloc) and use that same accessor instead — do not invent a new one.

- [ ] **Step 4: Manual verification**

Run the app (`flutter run`), open Rummy in offline/practice mode, and play a full hand: draw, discard a few turns, and either let it play out to a bot win or attempt a declare. Confirm the UI updates each turn and a banner shows the result.

- [ ] **Step 5: Commit**

```bash
git add mobile/lib/features/games/rummy/rummy_game_page.dart
git add <the route-registration file from Step 1>
git commit -m "feat(rummy): mobile game page (offline practice + online)"
```

---

### Task 11: Admin panel — Rummy page + routing

**Files:**
- Create: `admin-panel/src/pages/games/Rummy.tsx`
- Modify: `admin-panel/src/main.tsx`
- Modify: `admin-panel/src/pages/layout/menuConfig.ts`
- Modify: `admin-panel/src/pages/layout/menuConfig.test.ts`

**Interfaces:**
- Consumes: existing generic `adminApi` client, `GET /game-configs`, `PATCH /game-configs/rummy`, `GET /game-rooms?status=` (all already implemented, used by `Matka.tsx`/`Lottery.tsx`/`GameRooms.tsx`).
- Produces: `/admin/games/rummy` route + menu entry.

- [ ] **Step 1: Implement the admin page**

```tsx
// admin-panel/src/pages/games/Rummy.tsx
import { useEffect, useState } from 'react'
import { Card, Form, Switch, InputNumber, Button, Table, Tag, Space, message, Typography, Row, Col, Select } from 'antd'
import { ReloadOutlined } from '@ant-design/icons'
import { adminApi } from '../../api/client'

const { Text, Title } = Typography

export default function Rummy() {
  const [config, setConfig] = useState<any>(null)
  const [loadingConfig, setLoadingConfig] = useState(false)
  const [savingConfig, setSavingConfig] = useState(false)

  const [rooms, setRooms] = useState<any[]>([])
  const [loadingRooms, setLoadingRooms] = useState(false)
  const [statusFilter, setStatusFilter] = useState('active')

  const loadConfig = () => {
    setLoadingConfig(true)
    adminApi.get('/game-configs')
      .then(r => setConfig(r.data.find((c: any) => c.game_type === 'rummy')))
      .finally(() => setLoadingConfig(false))
  }

  const saveConfig = async (values: any) => {
    setSavingConfig(true)
    try {
      await adminApi.patch('/game-configs/rummy', values)
      message.success('Rummy configuration saved!')
      loadConfig()
    } catch {
      message.error('Failed to save configuration')
    } finally {
      setSavingConfig(false)
    }
  }

  const loadRooms = () => {
    setLoadingRooms(true)
    adminApi.get('/game-rooms', { params: { status: statusFilter } })
      .then(r => setRooms((r.data || []).filter((room: any) => room.game_type === 'rummy')))
      .finally(() => setLoadingRooms(false))
  }

  useEffect(() => {
    loadConfig()
  }, [])

  useEffect(() => {
    loadRooms()
  }, [statusFilter])

  const roomColumns = [
    { title: 'Room ID', dataIndex: 'id', render: (id: string) => id.slice(0, 12) + '...' },
    { title: 'Players', dataIndex: 'player_count' },
    { title: 'Real / Bot', key: 'bots', render: (r: any) => `${r.real_count || 0} / ${r.bot_count || 0}` },
    { title: 'Entry Fee (₹)', dataIndex: 'entry_fee', render: (v: number) => `₹${parseFloat(v as any).toFixed(0)}` },
    { title: 'Pot (₹)', dataIndex: 'pot_amount', render: (v: number) => `₹${parseFloat(v as any).toFixed(2)}` },
    { title: 'Status', dataIndex: 'status', render: (s: string) => <Tag color={s === 'active' ? 'blue' : s === 'completed' ? 'green' : 'default'}>{s}</Tag> },
    { title: 'Started', dataIndex: 'started_at', render: (d: string) => d ? new Date(d).toLocaleTimeString() : '-' },
  ]

  return (
    <div>
      <Title level={3} style={{ color: '#d4af37' }}>🂡 Rummy Management</Title>
      <Row gutter={[24, 24]}>
        <Col xs={24} lg={7}>
          <Card title="⚙️ Game Config" loading={loadingConfig} size="small">
            {config && (
              <Form layout="vertical" initialValues={{ ...config }} onFinish={saveConfig} size="small">
                <Form.Item name="is_active" label="Game Active" valuePropName="checked">
                  <Switch checkedChildren="ON" unCheckedChildren="OFF" />
                </Form.Item>
                <Form.Item name="rake_percent" label="Rake %">
                  <InputNumber min={0} max={20} step={0.5} suffix="%" style={{ width: '100%' }} />
                </Form.Item>
                <Form.Item>
                  <Button type="primary" htmlType="submit" block loading={savingConfig}>Save Config</Button>
                </Form.Item>
              </Form>
            )}
          </Card>
          <Text type="secondary" style={{ fontSize: 12 }}>
            Live spectator, force-action, kick, and terminate controls for any in-progress room are available at
            {' '}<a href="/admin/game-rooms">Live Game Rooms</a>.
          </Text>
        </Col>
        <Col xs={24} lg={17}>
          <Card
            title="Rooms"
            extra={
              <Space>
                <Select value={statusFilter} onChange={setStatusFilter} style={{ width: 140 }}>
                  <Select.Option value="active">Active</Select.Option>
                  <Select.Option value="completed">Completed</Select.Option>
                  <Select.Option value="waiting">Waiting</Select.Option>
                </Select>
                <Button icon={<ReloadOutlined />} onClick={loadRooms}>Refresh</Button>
              </Space>
            }
            loading={loadingRooms}
          >
            <Table rowKey="id" dataSource={rooms} columns={roomColumns} size="small" scroll={{ x: 'max-content' }} />
          </Card>
        </Col>
      </Row>
    </div>
  )
}
```

- [ ] **Step 2: Route it**

In `admin-panel/src/main.tsx`, add the lazy import next to `Cricket`:
```typescript
const Rummy = React.lazy(() => import('./pages/games/Rummy'))
```
And the route next to `games/cricket`:
```typescript
            <Route path="games/rummy" element={<Rummy />} />
```

- [ ] **Step 3: Menu entry**

In `admin-panel/src/pages/layout/menuConfig.ts`, add to the `games_group` children, after Cricket:
```typescript
        { key: '/admin/games/rummy', icon: createElement(IdcardOutlined), label: link('/admin/games/rummy', 'Rummy') },
```
(`IdcardOutlined` is already imported for Teen Patti — reused, not a new import.)

In `admin-panel/src/pages/layout/menuConfig.test.ts`, add to `EXPECTED_KEYS`:
```typescript
  '/admin/games/rummy',
```

- [ ] **Step 4: Typecheck and test**

Run: `cd admin-panel && npx tsc --noEmit -p . && npx vitest run src/pages/layout/menuConfig.test.ts`
Expected: no type errors; menu test passes with the new key included.

- [ ] **Step 5: Commit**

```bash
git add admin-panel/src/pages/games/Rummy.tsx admin-panel/src/main.tsx admin-panel/src/pages/layout/menuConfig.ts admin-panel/src/pages/layout/menuConfig.test.ts
git commit -m "feat(rummy): admin panel config + room monitoring page"
```

---

### Task 12: End-to-end verification and registry flip

**Files:**
- Modify: `games/registry.json`

**Interfaces:**
- Consumes: everything from Tasks 1-11 running together.

- [ ] **Step 1: Build every touched Node service**

Run:
```bash
cd services/game-engines/rummy && npm run build
cd ../../game-gateway && npm run build
cd ../../../admin-panel && npm run build
```
Expected: all three build cleanly with no errors.

- [ ] **Step 2: Local end-to-end smoke test**

With Postgres/Redis running locally and the migration applied (Task 6):
1. Temporarily flip the local `rummy` row to `is_active = true`: `psql "$DATABASE_URL" -c "UPDATE game_configs SET is_active = true WHERE game_type = 'rummy'"`.
2. Start `services/game-engines/rummy` (`npm run dev`), `services/game-gateway` (`npm run dev`), and `admin-panel` (`npm run dev`) locally.
3. Via the admin panel at `/admin/games/rummy`, confirm the config card loads and Save works.
4. Via a WebSocket client (or the mobile app pointed at local services), join Rummy matchmaking with 1 real player + bot-fill, confirm a room starts, cards deal, actions (draw/discard) work, and either a bot or the human can force a win via drop or declare — confirm `/admin/game-rooms` shows the room and, after it ends, `game_rooms.status='completed'` with a non-null `pot_amount`.
5. Revert the local `is_active` flip back to `false` when done (`UPDATE game_configs SET is_active = false WHERE game_type = 'rummy'`) — production rollout is a deliberate later step, not part of this task.

- [ ] **Step 3: Flip the registry**

In `games/registry.json`, change the `rummy` entry's `"status"` from `"planned"` to `"live"`.

- [ ] **Step 4: Commit**

```bash
git add games/registry.json
git commit -m "feat(rummy): mark rummy live in the games registry"
```

- [ ] **Step 5: Final full-repo verification**

Run the same verification gate used for every other change on this branch:
```bash
cd services/game-engines/rummy && npx tsc --noEmit && npm test
cd ../../game-gateway && npx tsc --noEmit
cd ../../../admin-panel && npx tsc --noEmit -p . && npx vitest run src/pages/layout/menuConfig.test.ts
cd ../mobile && flutter analyze lib/features/games/rummy/
```
Expected: everything green. Do not deploy or flip production `is_active` as part of this plan — that's a separate, deliberate rollout step per the spec's "Rollout" section, done after a human review of the merged branch.

---

## Self-Review Notes

- **Spec coverage:** deck/deal/wild-joker (Task 1), meld validation incl. pure-sequence and Ace-low/high-no-wrap (Task 2), turn actions incl. First Drop and last-player-standing (Task 3), bot AI (Task 4), engine HTTP contract (Task 5), DB config + PM2 (Task 6), gateway matchmaking + settlement (Task 7), gateway action routing + reconnect (Task 8), mobile offline engine (Task 9), mobile UI (Task 10), admin config/room page (Task 11), registry flip + e2e verification (Task 12). All spec sections have a corresponding task.
- **Explicitly out of scope, not silently dropped:** bot-coordination winner-rigging (Task 7 Step 1 explicitly calls this out), bot-training telemetry table, personalized-difficulty integration, `resources/game-configs/rummy.json`, Pool/Deals Rummy, rupee-per-point payout — all named in Global Constraints, matching the spec.
- **Type consistency checked:** `ActionResult { winner_id, prize, rake_fee, reason }` used identically across `rules.ts` (Tasks 1-3), `index.ts` (Task 5), and `matchmaking.ts`'s `handleRummyEnd` (Task 7). Action names (`draw_closed`, `draw_open`, `discard`, `declare`, `drop`) used identically in `rules.ts`, engine `index.ts`, gateway `index.ts`'s `handleRummyAction`, and the mobile page's `_onlineAction` calls. `RummyState`/`RummyEngineState` field names (`current_turn`, `awaiting`, `wild_rank`, `closed_pile`, `open_pile`) kept consistent between the TS engine and its Dart port, noting the Dart port intentionally omits `rake_percent`/`turn_timeout_seconds` (offline practice is unstaked and untimed-by-server).
- **Known follow-up, not blocking:** the mobile Declare UX (Task 10) uses a fixed-chunk grouping fallback rather than a drag-and-drop meld builder — functionally correct (the server validates regardless) but not a polished UX. Worth a fast-follow UI pass once the game is live and validated, not a blocker for shipping v1.
