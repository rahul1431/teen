# Ludo Bot Training VPS Manual Testing Checklist

**Feature**: Ludo bot training system with coordination metadata, election strategy, and performance metrics.

**Purpose**: Verify that the bot training system works end-to-end on production VPS, including database persistence, admin controls, Redis coordination, and metrics tracking.

**Test Environment**: Production VPS (game.myonlinejoker.com)

**Prerequisites**:
- VPS access via SSH
- Admin panel access
- PM2 running ludo-service and redis
- Database migrations applied
- Test player accounts ready

---

## 1. Database Setup Verification

**Objective**: Confirm bot_learning_sessions table and metrics tables exist with correct schema.

**Steps**:
1. SSH into VPS: `ssh root@[VPS_IP]`
2. Connect to PostgreSQL: `psql -U postgres -d myonlinejoker`
3. Check bot_learning_sessions table:
   ```sql
   \d bot_learning_sessions
   ```
4. Verify columns exist:
   - `id` (uuid, primary key)
   - `elected_bot_id` (uuid, foreign key to users)
   - `game_id` (uuid, foreign key to ludo_games)
   - `coordination_metadata` (jsonb)
   - `election_strategy` (varchar)
   - `win_target` (numeric)
   - `actual_win_rate` (numeric)
   - `created_at`, `updated_at`

5. Check ludo_bot_metrics table:
   ```sql
   \d ludo_bot_metrics
   ```
6. Verify columns:
   - `id` (uuid, primary key)
   - `bot_id` (uuid, foreign key to users)
   - `games_played` (integer)
   - `games_won` (integer)
   - `current_win_rate` (numeric)
   - `avg_roll_efficiency` (numeric)
   - `avg_decision_time_ms` (integer)
   - `last_game_id` (uuid)
   - `updated_at`

**Expected Results**:
- All tables exist
- All required columns present with correct data types
- Foreign key constraints configured

**Verification**:
```bash
# Count rows in tables
psql -U postgres -d myonlinejoker -c "SELECT COUNT(*) FROM bot_learning_sessions;"
psql -U postgres -d myonlinejoker -c "SELECT COUNT(*) FROM ludo_bot_metrics WHERE bot_id IS NOT NULL;"
```

---

## 2. Admin API Endpoints Verification

**Objective**: Verify all bot training admin endpoints are accessible and return correct responses.

**Steps**:
1. SSH into VPS
2. Test GET /api/admin/ludo/bot-training/config:
   ```bash
   curl -H "Authorization: Bearer [ADMIN_TOKEN]" \
     http://localhost:3000/api/admin/ludo/bot-training/config
   ```
   Expected response:
   ```json
   {
     "election_strategy": "performance_based" | "random",
     "win_target": 0.75,
     "coordination_enabled": true,
     "metrics_refresh_interval_ms": 5000,
     "training_enabled": true
   }
   ```

3. Test PATCH /api/admin/ludo/bot-training/config:
   ```bash
   curl -X PATCH \
     -H "Authorization: Bearer [ADMIN_TOKEN]" \
     -H "Content-Type: application/json" \
     -d '{"win_target": 0.80, "election_strategy": "performance_based"}' \
     http://localhost:3000/api/admin/ludo/bot-training/config
   ```
   Expected: 200 OK with updated config

4. Test GET /api/admin/ludo/bot-training/sessions:
   ```bash
   curl -H "Authorization: Bearer [ADMIN_TOKEN]" \
     http://localhost:3000/api/admin/ludo/bot-training/sessions?limit=10
   ```
   Expected response: Array of session objects with pagination

5. Test GET /api/admin/ludo/bot-training/sessions/:sessionId:
   ```bash
   curl -H "Authorization: Bearer [ADMIN_TOKEN]" \
     http://localhost:3000/api/admin/ludo/bot-training/sessions/[SESSION_UUID]
   ```
   Expected: Single session object with full details

**Expected Results**:
- All endpoints respond with 200 OK (for GET) or successful update (PATCH)
- Response bodies match expected schema
- Authentication required (401 without token)
- Only admins can access (403 for non-admins)

**Verification**:
- Check response status codes
- Validate JSON structure matches schema
- Confirm pagination parameters work

---

## 3. Admin Panel: Enable Coordination and Verify Settings Persist

**Objective**: Test that admin panel UI can enable/disable bot training and settings persist across page reloads and service restarts.

**Steps**:
1. Navigate to admin panel: https://game.myonlinejoker.com/admin
2. Login as admin
3. Go to "Bot Training Configuration" section
4. Toggle "Enable Bot Coordination" to ON
5. Set Election Strategy to "performance_based"
6. Set Win Target to 0.75
7. Click "Save Settings"
8. Verify toast notification: "Settings saved successfully"
9. Reload page (F5) and verify settings still show as enabled
10. SSH to VPS and check Redis for coordination config:
    ```bash
    redis-cli GET ludo:bot:coordination:enabled
    redis-cli HGETALL ludo:bot:config
    ```
11. Restart ludo-service: `pm2 restart ludo-service`
12. Reload admin panel and verify settings still persisted

**Expected Results**:
- Settings save without errors
- Page reload maintains settings state
- Redis stores coordination state
- Settings survive service restart
- Audit log shows configuration change

**Verification**:
```bash
# Check if coordination is enabled
redis-cli EXISTS ludo:bot:coordination:enabled

# Check bot config hash
redis-cli HGET ludo:bot:config election_strategy
redis-cli HGET ludo:bot:config win_target
```

---

## 4. Play 1 Real Player + 3 Bot Game and Verify Coordination Metadata in Redis

**Objective**: Verify that when a real player joins a game with 3 bots, coordination metadata is created and stored in Redis.

**Steps**:
1. From admin panel, note a bot user ID (or create a test bot account)
2. Have a real player (test account) start a new Ludo game
3. Force bot join for remaining 3 seats (via admin control or wait for auto-fill)
4. Wait for game to start
5. SSH to VPS and check Redis for coordination metadata:
   ```bash
   redis-cli KEYS "*ludo:coordination:*" | head -20
   ```
6. Examine the coordination session:
   ```bash
   redis-cli GET ludo:coordination:[GAME_ID]
   ```
   Expected structure:
   ```json
   {
     "game_id": "uuid",
     "elected_bot_id": "bot-uuid",
     "coordination_enabled": true,
     "election_strategy": "performance_based",
     "bots": {
       "bot1-uuid": {"initial_win_rate": 0.65, "role": "support"},
       "bot2-uuid": {"initial_win_rate": 0.58, "role": "support"},
       "bot3-uuid": {"initial_win_rate": 0.72, "role": "elected"}
     },
     "created_at": "timestamp",
     "human_player_id": "real-player-uuid"
   }
   ```
7. Record the coordination session ID for later verification

**Expected Results**:
- Coordination entry created in Redis
- Elected bot selected based on election strategy
- All bot metadata present
- Coordination TTL set (should expire after game ends)

**Verification**:
```bash
# List all active coordination sessions
redis-cli KEYS "ludo:coordination:*" | wc -l

# Check specific game coordination
redis-cli HGETALL ludo:coordination:[GAME_ID]
```

---

## 5. Verify Bot Turn Handler Checks Coordination State

**Objective**: Confirm that during the game, the bot turn handler reads and respects coordination state from Redis.

**Steps**:
1. With the game from step 4 still active, open ludo-service logs:
   ```bash
   pm2 logs ludo-service --lines 100 --err
   ```
2. Observe logs as bots take turns - look for:
   - `[BotCoordination] Reading coordination state for game: [GAME_ID]`
   - `[BotCoordination] Elected bot detected: [BOT_ID]`
   - `[BotCoordination] Support bot role: [BOT_ID]`
3. Make a move as the real player
4. Verify coordination state is checked on every turn:
   ```bash
   pm2 logs ludo-service | grep "coordination"
   ```
5. Simulate network reconnect by disconnecting and reconnecting WebSocket (admin tools or dev console)
6. Verify coordination state is re-read after reconnect

**Expected Results**:
- Coordination state is retrieved from Redis on each turn
- Bot role (elected vs support) is correctly identified
- Logs show coordination metadata being used for decision-making
- State persists across network reconnects

**Verification**:
```bash
# Count coordination state reads in logs (last 30 minutes)
pm2 logs ludo-service | grep "Reading coordination state" | wc -l

# Check for any coordination errors
pm2 logs ludo-service | grep -i "error.*coordination"
```

---

## 6. Verify Game End Records to Database

**Objective**: Confirm that when the game ends, the bot_learning_sessions record is written to the database.

**Steps**:
1. Play the game from step 4 to completion (or force end via admin if needed)
2. After game ends, query the database:
   ```sql
   SELECT * FROM bot_learning_sessions 
   WHERE game_id = '[GAME_ID]' 
   ORDER BY created_at DESC LIMIT 1;
   ```
3. Verify the record contains:
   - `elected_bot_id`: UUID of the bot that was elected to win
   - `game_id`: UUID of the completed game
   - `coordination_metadata`: Full JSON with all bots, strategies, results
   - `election_strategy`: "performance_based" or "random"
   - `win_target`: e.g., 0.75
   - `actual_win_rate`: (null initially, filled after metrics sync)
   - `created_at`: Timestamp when coordination was initiated
   - `updated_at`: Timestamp when game ended

4. Verify game result in ludo_games table:
   ```sql
   SELECT winner_id, status FROM ludo_games WHERE id = '[GAME_ID]';
   ```
   - If elected bot won: `winner_id = elected_bot_id`
   - Status should be "completed"

**Expected Results**:
- bot_learning_sessions record created with all metadata
- Game result reflects coordination outcome
- No orphaned sessions (all sessions have associated game_id)

**Verification**:
```bash
# Check recent bot training sessions
psql -U postgres -d myonlinejoker -c \
  "SELECT id, elected_bot_id, game_id, election_strategy, win_target FROM bot_learning_sessions ORDER BY created_at DESC LIMIT 5;"
```

---

## 7. Verify Audit Trail Shows Recorded Games

**Objective**: Confirm that the admin audit log captures all bot training games and coordination events.

**Steps**:
1. In admin panel, navigate to "Audit Logs" or "Bot Training History"
2. Filter for bot training events (last 30 minutes)
3. Verify entry for the game from step 4 exists with details:
   - Event type: "bot_training_game_completed"
   - Game ID: Matches the game played
   - Elected bot: Shows the elected bot ID
   - Election strategy: Shows strategy used
   - Win target: Shows target win rate
   - Result: Shows if elected bot won or lost
   - All player IDs: Real player + 3 bots
4. Click on the audit entry to view full details
5. Verify coordination_metadata JSON is readable and complete
6. Query audit table directly:
   ```sql
   SELECT * FROM audit_logs 
   WHERE event_type = 'bot_training_game_completed'
   ORDER BY created_at DESC LIMIT 5;
   ```

**Expected Results**:
- Every bot training game has an audit entry
- Audit entry captures all relevant metadata
- Entry created at game completion
- Admin panel displays audit history correctly

**Verification**:
```bash
# Count bot training events
psql -U postgres -d myonlinejoker -c \
  "SELECT COUNT(*) FROM audit_logs WHERE event_type LIKE '%bot_training%' AND created_at > NOW() - INTERVAL '1 hour';"
```

---

## 8. Verify Metrics Table Shows Updated Bot Stats

**Objective**: Confirm that after the game, ludo_bot_metrics table is updated with the bot's performance.

**Steps**:
1. After game completes, query bot metrics for the bots that played:
   ```sql
   SELECT bot_id, games_played, games_won, current_win_rate, 
          avg_roll_efficiency, avg_decision_time_ms, last_game_id
   FROM ludo_bot_metrics 
   WHERE bot_id IN ('[BOT1_ID]', '[BOT2_ID]', '[BOT3_ID]')
   ORDER BY updated_at DESC;
   ```
2. Verify for the elected bot that won:
   - `games_played`: Incremented by 1
   - `games_won`: Incremented by 1 (if bot won)
   - `current_win_rate`: Updated (games_won / games_played)
   - `last_game_id`: Matches the game just played
   - `updated_at`: Current timestamp
3. Verify for support bots:
   - `games_played`: Incremented by 1
   - `games_won`: Not incremented (if they lost)
   - `current_win_rate`: Updated accordingly
4. Check metrics refresh interval is respected:
   ```bash
   redis-cli GET ludo:metrics:last_refresh
   ```

**Expected Results**:
- All participating bots have updated metrics
- Win rates reflect actual game outcomes
- Metrics updated within 5-10 seconds of game end
- No negative or invalid values (win_rate between 0-1)

**Verification**:
```bash
# Check for metrics calculation errors
psql -U postgres -d myonlinejoker -c \
  "SELECT bot_id, current_win_rate FROM ludo_bot_metrics WHERE current_win_rate > 1.0 OR current_win_rate < 0.0;"

# Should return 0 rows (no invalid values)
```

---

## 9. Play Multiple Games and Verify Election Strategy Changes Winners

**Objective**: Confirm that election strategy correctly changes which bot is elected to win across multiple games.

**Test A - Performance-Based Election**:
1. Set election strategy to "performance_based" in admin config
2. Play 3 consecutive games (1 real player + 3 bots each)
3. After each game, check which bot was elected:
   ```sql
   SELECT game_id, elected_bot_id FROM bot_learning_sessions 
   ORDER BY created_at DESC LIMIT 3;
   ```
4. Verify elected bot is always the one with highest current_win_rate:
   ```sql
   SELECT bot_id, current_win_rate FROM ludo_bot_metrics 
   WHERE bot_id IN ('[BOT1_ID]', '[BOT2_ID]', '[BOT3_ID]')
   ORDER BY current_win_rate DESC LIMIT 1;
   ```

**Test B - Random Election**:
1. Change election strategy to "random" in admin config
2. Play 5 consecutive games
3. After each game, record the elected bot
4. Verify that elected bots differ across games (not always the same bot)
5. Confirm election is truly random (each bot elected roughly equally)

**Expected Results**:
- Performance-based: Elected bot changes based on metrics changes
- Random: Elected bot varies with no clear pattern
- All games complete successfully regardless of strategy
- Elected bot is always one of the 3 bots in the game

**Verification**:
```bash
# Get elected bot distribution across last 10 games
psql -U postgres -d myonlinejoker -c \
  "SELECT elected_bot_id, COUNT(*) as times_elected FROM bot_learning_sessions 
   ORDER BY created_at DESC LIMIT 10 GROUP BY elected_bot_id;"
```

---

## 10. Verify 100% Win Rate Target Makes Elected Bot Always Win

**Objective**: Confirm that when win_target is set to 100%, the elected bot always wins (or coordination ensures it).

**Steps**:
1. Set win_target to 1.0 (100%) in admin config:
   ```bash
   curl -X PATCH \
     -H "Authorization: Bearer [ADMIN_TOKEN]" \
     -H "Content-Type: application/json" \
     -d '{"win_target": 1.0}' \
     http://localhost:3000/api/admin/ludo/bot-training/config
   ```
2. Verify in admin panel that win_target is 100%
3. Play 5 consecutive games with elected bot
4. After each game, verify the elected bot won:
   ```sql
   SELECT bs.game_id, bs.elected_bot_id, lg.winner_id, 
          (bs.elected_bot_id = lg.winner_id) as elected_bot_won
   FROM bot_learning_sessions bs
   JOIN ludo_games lg ON bs.game_id = lg.id
   ORDER BY bs.created_at DESC LIMIT 5;
   ```
5. Verify all rows show `elected_bot_won = true`
6. Check coordination logs to confirm elected bot made optimal moves:
   ```bash
   pm2 logs ludo-service | grep "coordination" | grep -i "optimal\|elected"
   ```
7. Test edge case: Set win_target to 1.0 but have network issues or game crash
   - Verify system handles incomplete games gracefully
   - Verify metrics are not updated if game didn't complete

**Expected Results**:
- With 100% win target, elected bot wins all 5 games
- Coordination actively influences bot decisions toward guaranteed win
- No errors or crashes during high-win-rate games
- Metrics correctly reflect wins

**Verification**:
```bash
# Count wins for elected bots with 100% win target
psql -U postgres -d myonlinejoker -c \
  "SELECT COUNT(*) as games_won FROM (
    SELECT bs.elected_bot_id, lg.winner_id
    FROM bot_learning_sessions bs
    JOIN ludo_games lg ON bs.game_id = lg.id
    WHERE bs.win_target = 1.0 AND bs.elected_bot_id = lg.winner_id
    ORDER BY bs.created_at DESC LIMIT 5
  ) t;"

# Should return 5 (all elected bots won)
```

---

## Summary & Rollback

**If all checks pass**:
- Bot training system is working correctly on production VPS
- Coordination metadata is persisted and retrieved properly
- Metrics are accurately tracked
- Admin controls function as expected

**If any check fails**:
1. Check ludo-service logs: `pm2 logs ludo-service --err`
2. Check admin-service logs: `pm2 logs admin-service --err`
3. Verify database migrations: `psql -U postgres -d myonlinejoker -c "SELECT * FROM schema_migrations ORDER BY version DESC LIMIT 5;"`
4. Verify Redis connectivity: `redis-cli PING` (should return PONG)
5. Restart services:
   ```bash
   pm2 restart ludo-service admin-service --update-env
   ```
6. If corruption, disable bot training:
   ```bash
   curl -X PATCH \
     -H "Authorization: Bearer [ADMIN_TOKEN]" \
     -H "Content-Type: application/json" \
     -d '{"training_enabled": false}' \
     http://localhost:3000/api/admin/ludo/bot-training/config
   ```

---

## Test Sign-Off

| Check | Status | Timestamp | Notes |
|-------|--------|-----------|-------|
| 1. Database setup | [ ] PASS / [ ] FAIL | | |
| 2. Admin API endpoints | [ ] PASS / [ ] FAIL | | |
| 3. Admin panel settings persist | [ ] PASS / [ ] FAIL | | |
| 4. Coordination metadata in Redis | [ ] PASS / [ ] FAIL | | |
| 5. Bot handler checks coordination | [ ] PASS / [ ] FAIL | | |
| 6. Game end records to DB | [ ] PASS / [ ] FAIL | | |
| 7. Audit trail captures games | [ ] PASS / [ ] FAIL | | |
| 8. Metrics updated correctly | [ ] PASS / [ ] FAIL | | |
| 9. Election strategy changes winners | [ ] PASS / [ ] FAIL | | |
| 10. 100% win rate target verified | [ ] PASS / [ ] FAIL | | |

**Overall Status**: [ ] READY FOR PRODUCTION | [ ] NEEDS FIXES

**Tester**: ________________  **Date**: ________________

---

## Appendix: Common Commands

```bash
# View bot training sessions
psql -U postgres -d myonlinejoker -c \
  "SELECT id, elected_bot_id, game_id, election_strategy, win_target, created_at FROM bot_learning_sessions ORDER BY created_at DESC LIMIT 10;"

# View bot metrics
psql -U postgres -d myonlinejoker -c \
  "SELECT bot_id, games_played, games_won, current_win_rate, updated_at FROM ludo_bot_metrics WHERE games_played > 0 ORDER BY updated_at DESC LIMIT 10;"

# Check Redis coordination
redis-cli KEYS "ludo:coordination:*" | head -10

# View ludo-service logs
pm2 logs ludo-service --lines 50

# Check bot training config
curl -H "Authorization: Bearer [TOKEN]" http://localhost:3000/api/admin/ludo/bot-training/config

# Get audit logs
curl -H "Authorization: Bearer [TOKEN]" "http://localhost:3000/api/admin/audit-logs?event_type=bot_training_game_completed&limit=20"
```
