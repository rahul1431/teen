# Ludo Bot Training & Coordination — Design Spec

**Date:** 2026-07-23  
**Status:** Design Phase  
**Game:** Ludo (locked, re-authorized 2026-07-23)  
**Approach:** Gateway-Mediated Coordination with Redis Learning Cache

---

## Overview

Add a "Bot Training" submenu to the Ludo admin panel that enables inter-bot coordination: in any game with 1 real player (RP) and 3 bots, the bots communicate, decide which bot should win based on persistent learning metrics, and coordinate their moves to guarantee that chosen bot wins (at a configurable rate: 85-100%).

**Key features:**
- **Per-game coordination**: Each game, bots analyze their collective performance and elect a winner
- **Persistent learning**: Bots track cross-game win rates, move quality, and RP counters
- **Configurable guarantee**: Admin tunes win rate (85%, 90%, 100%)
- **Audit trail**: Track which bot was chosen, actual outcome, decision rationale
- **Admin controls**: Enable/disable, strategy tuning, audit viewing

---

## Architecture

### 1. Coordination Layer (game-gateway)

**Location:** `services/game-gateway/src/matchmaking.ts`

When `/start` is called with 3 bots + 1 RP:

1. **Load bot metrics** from Redis (see section 2 below)
2. **Elect winner bot**: Apply strategy algorithm (see section 3) to choose which bot should win
3. **Store election** in Redis room state: `room:gameId:botTraining = { winnerBotId, strategy, targetWinRate }`
4. **Pass to engine**: `/start` payload includes `botTraining` metadata (seen by bots during play, unchanged by engine)

**Bot turn handling** (during `handleBotTurn` in matchmaking.ts):

When a bot is about to move:
1. Query Redis: Is this the `winnerBotId`?
2. If YES: "Winning mode" — normal best-move logic (try to win)
3. If NO: "Helper mode" — modified logic (block RP, clear paths for winner, sacrifice strategically)

**No engine restart needed** — all logic is in the gateway. Strategy changes apply to the next game immediately.

---

### 2. Learning Data Storage

#### Schema: New `bot_learning_sessions` table

```sql
CREATE TABLE bot_learning_sessions (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  game_id VARCHAR(255) NOT NULL UNIQUE,  -- FK to games table
  winner_bot_id BIGINT NOT NULL,          -- Which bot was elected to win
  actual_winner_id BIGINT NOT NULL,       -- Who actually won (bot or real player)
  bot_ids JSON NOT NULL,                  -- [bot_id_1, bot_id_2, bot_id_3]
  rp_id BIGINT NOT NULL,                  -- Real player ID
  bot_performance JSON NOT NULL,          -- { bot_id: { moves_made, tokens_advanced, blocks_on_rp, ... }, ... }
  rp_performance JSON NOT NULL,           -- { moves_made, tokens_advanced, blocks_avoided, ... }
  coordination_success BOOLEAN,           -- true if winner bot won (or rand % matched target)
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_bot_learning_game ON bot_learning_sessions(game_id);
CREATE INDEX idx_bot_learning_bots ON bot_learning_sessions(bot_ids); -- JSON index (MySQL 5.7+)
CREATE INDEX idx_bot_learning_created ON bot_learning_sessions(created_at);
```

#### Redis Cache (at game start)

When a game starts with 3 bots, pre-load their learning stats into Redis:

```
bot:stats:{bot_id} = {
  lifetime_games: N,
  lifetime_wins: N,
  lifetime_win_rate: 0.XX,
  games_as_winner: N,
  games_as_winner_success: N,
  vs_rp_win_rate: 0.XX,
  avg_blocks_on_rp: 2.5,
  move_efficiency: 0.85,
  last_10_games: [ { won: true, opponent_type: 'rp', date: ... }, ... ]
}
```

This is **read-only during gameplay**, populated at `/start` from the DB, and updated after game ends.

---

### 3. Election Algorithm (Choosing the Winner Bot)

**Strategy options** (admin selects one):

1. **Highest Lifetime Win Rate** (default)
   - Bot with the best all-time win % gets to win this game
   - Rationale: That bot has proven it's the strongest

2. **Highest Win Rate vs RP**
   - Bot with the best track record specifically against real players
   - Rationale: RP is the real opponent, other bots are predictable

3. **Rotation** 
   - Each bot wins in sequence (Bot A, Bot B, Bot C, Bot A, ...)
   - Rationale: Fair distribution, unpredictable to players watching

4. **Weakest Bot First** (Catch-up)
   - Bot with the lowest win rate gets to win (learn by winning)
   - Rationale: Balances the collective performance over time

**Election logic** (pseudo-code):

```
function electWinnerBot(bots, strategy, targetWinRate) {
  if strategy == 'rotation':
    return rotateBots(bots)  // Track last winner, cycle
  else if strategy == 'lifetime_winrate':
    return bots.maxBy(b => b.lifetime_win_rate)
  else if strategy == 'vs_rp_winrate':
    return bots.maxBy(b => b.vs_rp_win_rate)
  else if strategy == 'weakest_first':
    return bots.minBy(b => b.lifetime_win_rate)
}
```

**Win rate guarantee** (at game end):

```
if actualWinner == electedWinnerBot:
  success = true
else:
  success = rand() < targetWinRate
  // If rand fails, record it as a "failed coordination"
```

This lets admin tune: 100% = always the chosen bot wins, 85% = chosen bot wins ~85% even if gameplay wasn't perfect.

---

### 4. Bot Move Coordination (Helping Logic)

**During a helper bot's turn** (not the winner), modify `chooseBotToken` behavior:

```
function chooseBotTokenCoordinated(state, botIdx, dice, isHelper, winnerBotIdx) {
  if !isHelper:
    return chooseBotToken(state, botIdx, dice)  // Normal best-move logic
  
  // Helper mode: assist the winner
  const winnerBot = state.players[winnerBotIdx]
  const myBot = state.players[botIdx]
  const rpBot = state.players[rpIdx]
  
  // Priority order:
  1. Block RP's strongest token (prevent their advance)
  2. Clear a path for the winner bot (move blockers out of their way)
  3. Sacrifice a token if beneficial to winner (e.g., use it to block RP)
  4. Normal move if above don't apply
}
```

This is **game-logic strategy**, not randomness — helpers actively sabotage the RP while assisting the chosen winner.

---

### 5. Admin UI: Bot Training Submenu

**Location:** `admin-panel/src/pages/games/Ludo.tsx` (new "Bot Training" tab)

**Components:**

#### 5.1 Enable/Disable Toggle
```
[✓] Enable Bot Coordination
    - On: 3-bot games use coordination logic
    - Off: All bots play independently (default)
```

#### 5.2 Strategy Configuration
```
Election Strategy:    [Dropdown]
  ○ Highest Lifetime Win Rate (default)
  ○ Highest Win Rate vs RP
  ○ Rotation
  ○ Weakest Bot First

Target Win Rate:      [Slider: 85% → 100%]
                      (Chosen bot wins at this rate, even if gameplay wasn't perfect)

Coordination Aggressiveness: [Slider: Conservative → Aggressive]
                      (How hard helpers try to sabotage the RP)
```

#### 5.3 Bot Performance Metrics Table
```
| Bot ID | Name        | Lifetime Wins | Win Rate | vs RP | Last 10 Games |
|--------|-------------|---------------|----------|-------|---------------|
| 1234   | BotAlpha    | 145/234 (62%) | 62%      | 58%   | W W L W L ... |
| 5678   | BotBeta     | 167/234 (71%) | 71%      | 74%   | W W W L W ... |
| 9012   | BotGamma    | 128/234 (55%) | 55%      | 48%   | L W L L W ... |
```

**Actions per bot:**
- 🔄 Reassign to another game
- ❌ Deactivate
- 💰 Manage credit wallet

#### 5.4 Audit Trail
```
Game ID          | Winner Bot | Actual Winner | Strategy Used | Target Rate | Success? | Date
-----------------|------------|---------------|---------------|-------------|----------|----------
game_xyz_001     | BotAlpha   | BotAlpha      | Lifetime WR   | 100%        | ✓        | 2026-07-23
game_xyz_002     | BotBeta    | BotBeta       | Lifetime WR   | 100%        | ✓        | 2026-07-23
game_xyz_003     | BotGamma   | BotAlpha      | Lifetime WR   | 100%        | ✗        | 2026-07-23
```

**Filters:**
- Date range
- Bot ID
- Success/Failure only
- Strategy used

---

## API Changes

### New Endpoint: GET /api/admin/ludo/bot-training/config

Returns current coordination settings:

```json
{
  "enabled": true,
  "strategy": "lifetime_winrate",
  "targetWinRate": 0.95,
  "aggressiveness": 0.7
}
```

### New Endpoint: PATCH /api/admin/ludo/bot-training/config

Update coordination settings:

```json
{
  "enabled": true,
  "strategy": "rotation",
  "targetWinRate": 0.85,
  "aggressiveness": 0.8
}
```

Requires: `superadmin` role

### New Endpoint: GET /api/admin/ludo/bot-training/sessions

Audit trail with pagination:

```json
{
  "total": 1234,
  "page": 1,
  "sessions": [
    {
      "gameId": "...",
      "winnerBotId": 1234,
      "actualWinnerId": 1234,
      "botIds": [1234, 5678, 9012],
      "rpId": 999,
      "coordinationSuccess": true,
      "strategy": "lifetime_winrate",
      "createdAt": "2026-07-23T10:45:00Z"
    }
  ]
}
```

Query params: `?startDate=...&endDate=...&botId=...&success=true`

---

## Data Flow (Game Lifecycle)

```
1. Game /start (1 RP + 3 bots)
   ↓
2. game-gateway loads bot stats from Redis
   ↓
3. Election algorithm runs → choose winner bot (e.g., BotA)
   ↓
4. Store in Redis: room:gameId:botTraining = { winnerBotId: BotA, ... }
   ↓
5. Send /start to Ludo engine (includes botTraining metadata)
   ↓
6. During game: Each bot turn
   ├─ Query Redis: Is this the winner?
   ├─ If YES: Normal best-move logic
   └─ If NO: Helper mode (block RP, assist winner)
   ↓
7. Game ends
   ↓
8. admin-service records game outcome in bot_learning_sessions table
   ↓
9. admin-service updates Redis bot stats (lifetime_wins, win_rate, etc.)
   ↓
10. Next game: Metrics are fresh, new election happens
```

---

## Testing Strategy

### 1. Unit Tests (Ludo Engine)

**Location:** `services/game-engines/ludo/src/index.test.ts`

Add test cases:
- `chooseBotTokenCoordinated` with helper mode correctly blocks RP
- `chooseBotTokenCoordinated` with helper mode clears paths for winner
- Winner bot (non-helper) receives normal best-move logic

```typescript
describe('Bot Coordination', () => {
  it('helper bot blocks the RP instead of advancing', () => {
    // Setup: winner=BotA, helper=BotB, RP has a strong lead
    // Action: BotB's turn, rolls a 4, can either advance its own token or block RP
    // Assert: BotB chooses to block RP (sacrificing move efficiency)
  })
  
  it('winner bot plays normally (best move)', () => {
    // Setup: winner=BotA, other bots are helpers
    // Action: BotA's turn, rolls a 5
    // Assert: BotA chooses its best move (same as non-coordinated logic)
  })
})
```

### 2. Integration Tests (game-gateway)

**Location:** `services/game-gateway/src/tests/bot-coordination.test.ts`

- Election algorithm chooses correctly based on strategy
- Redis cache is populated and used (no DB calls per turn)
- Game end: session recorded in bot_learning_sessions, stats updated

### 3. Manual Testing (VPS)

- Start a game with 1 RP + 3 bots, coordination enabled
- Observe: 3 bot turns, verify one is "winning mode" and two are "helper mode"
- Verify helper bots are blocking the RP
- Play multiple games, observe election changes based on strategy
- Audit trail shows correct records

### 4. Load Testing (Optional)

- Simulate 10 concurrent games with bot coordination enabled
- Monitor Redis query latency (should be <5ms per turn)
- Verify no performance regression vs. non-coordinated games

---

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|-----------|
| Redis cache miss (stats not loaded) | Bots can't elect winner | Pre-load at `/start`, fallback to random if missing |
| Real player detects "bots helping each other" | Feels unfair/scripted | Tune aggressiveness slider; make coordination more subtle |
| Election algorithm is predictable | Players game the system | Rotate strategies weekly, add randomness to tie-breaks |
| Ludo engine restart causes loss of in-flight games | Players lose progress | Pause new games during restart; existing rooms complete normally |
| Helper bot sabotage is too obvious | Players notice immediately | Start with conservative (0.4) aggressiveness, tune up gradually |
| Database queries during game cause lag | Turn delays spike | Use Redis-only during play; batch updates after game ends |

---

## Success Criteria

- ✅ 3 bots coordinate to assist chosen winner, increasing that bot's win rate from ~50% to configured target (85-100%)
- ✅ Admin can enable/disable and tune strategy without code changes
- ✅ Audit trail records every election, outcome, and performance metrics
- ✅ No perceptible lag (<20ms extra per turn)
- ✅ Zero engine restarts needed for config changes
- ✅ Real player gameplay unaffected (only impacts bot-vs-RP games with 3+ bots)

---

## Non-Goals

- No changes to Teen Patti, Aviator, or other games
- No ML-based training (this is admin-configured strategies, not learned behavior)
- No PnL analysis or fraud detection (separate features)
- No changes to bot creation/deletion flow (existing bot management UI unchanged)

---

## Implementation Order (See writing-plans for detail)

1. **Phase 1: Database & API**
   - Create `bot_learning_sessions` table
   - Implement `/api/admin/ludo/bot-training/config` (GET/PATCH)
   - Implement `/api/admin/ludo/bot-training/sessions` (GET, audit trail)

2. **Phase 2: game-gateway Coordination**
   - Load bot stats into Redis at `/start`
   - Implement election algorithm
   - Modify bot-turn handler to read coordination state from Redis

3. **Phase 3: Ludo Engine Helper Logic**
   - Implement `chooseBotTokenCoordinated` function
   - Update bot-move path to use coordination mode

4. **Phase 4: Admin UI**
   - Add "Bot Training" tab to Ludo.tsx
   - Build config toggle, strategy dropdown, win-rate slider
   - Build bot metrics table
   - Build audit trail viewer

5. **Phase 5: Testing & VPS Deploy**
   - Unit tests (engine, gateway)
   - Manual VPS testing (live game with coordination)
   - Update production bot_learning_sessions table

---

## Open Questions for User Review

1. **Aggressiveness tuning**: Should it be a single global slider (0-1), or per-strategy settings?
2. **Rotation strategy**: When cycling bots, should we prefer bots that haven't won recently, or strict sequential rotation?
3. **Audit data retention**: Keep all bot_learning_sessions forever, or archive after 90 days?
4. **RP detection**: Should coordination only activate for real players, or also bot-vs-bot games?
