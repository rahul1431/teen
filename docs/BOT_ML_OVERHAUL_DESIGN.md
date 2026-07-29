# Bot Training & ML System — Complete Overhaul Design Doc

**Date:** 2026-07-11  
**Version:** 1.0  
**Status:** Design Approved  
**Timeline:** 5-6 weeks (sequential phases)  
**Team:** 6 engineers (2 backend, 2 ML, 2 DevOps)

---

## Executive Summary

This document specifies the complete overhaul of the bot training and ML infrastructure across 4 sequential phases:

- **P0 (Weeks 1-2+3 validation):** Fix 6 critical data quality & model safety issues; validate in production
- **P1 (Weeks 3-4):** Build metrics dashboard & drift detection; implement A/B testing framework
- **P2 (Weeks 5-6):** Add personalized difficulty & anomaly detection; scale to 6-hourly rebuilds
- **P3 (Week 6+ planning):** Design horizontal scaling & real-time streaming infrastructure

**Success Criteria:**
- P0: Zero regressions in production; all 6 fixes passing tests; win-rate stability ±2%
- P1: Drift detection within 3 hours; metrics dashboard live; A/B framework ready
- P2: +3-5% retention from personalized difficulty; anomaly detection flagging potential cheaters
- P3: Architecture ready to scale from 500 to 5K+ concurrent games

---

## PART 1: Context & Current State

### Current Architecture

```
Bot-Learning-Service (TypeScript, Fastify)
  ├─ Builds bot profiles nightly (percentile-based)
  ├─ 3 difficulty tiers: Easy (0-25%), Medium (40-60%), Hard (75%+)
  ├─ Stores in PostgreSQL bot_profiles + Redis cache (1hr TTL)
  └─ Serves profiles to Game-Gateway at game start

Churn-ML-Service (Python, FastAPI)
  ├─ Random Forest classifier (100 trees, 6 features)
  ├─ Predicts churn risk (0-100%) per user
  ├─ Auto-trains on first prediction (cold-start)
  └─ Falls back to synthetic data if insufficient real data

Game-Gateway (TypeScript)
  ├─ Fetches bot profile on game start
  ├─ Picks bot action: fold/call/raise (probabilistic)
  ├─ Adds decision delay: avg_delay_ms ± 30% (human-like)
  └─ Broadcasts state to real players

Profile Persistence
  ├─ PostgreSQL: bot_profiles, bot_learning_config tables
  ├─ Redis: 1hr cache with 500ms HTTP timeout fallback
  └─ Hardcoded profiles: Fallback if services unavailable
```

### Critical Issues (12 Found)

**P0 Issues (Must Fix for Data Quality):**
1. Min sample size = 10 (too low; unrepresentative profiles)
2. No train/test split (churn model overfitting undetected)
3. Blocking model training (gateway timeout on first prediction)
4. Cold-start synthetic data unrealistic (skews predictions)
5. No audit trail for admin changes (impossible to debug fairness complaints)
6. Win-rate derivation oversimplified (ignores game state)

**P1+ Issues (Fairness & Observability):**
7. Percentile gaps exclude 30% of players (25-40%, 60-75%)
8. No metrics dashboard (flying blind on bot performance)
9. No model versioning (can't rollback bad training)
10. Hard bot unfairly calibrated (may be too strong vs average players)
11. Profile rebuild query missing indices (5+ min scans at scale)
12. Config updates not transactional (partial failures → inconsistent state)

---

## PART 2: Phase 0 — Critical Fixes (Weeks 1-2 + 3 Validation)

### Objective

Fix 6 data quality & model safety issues. Validate in production with real player data and 48-hour monitoring to ensure zero regressions before moving to P1.

### Components to Fix

#### **A. Bot-Learning-Service (Backend Team)**

**Fix 1: Increase Min Sample Size**
- **Current:** `MIN_SAMPLE_SIZE = 10`
- **Problem:** Early profiles built from first 10 players (noisy, unrepresentative)
- **Fix:** Change to `MIN_SAMPLE_SIZE = 50`
- **Validation:** Percentile tiers computed from 50+ players have lower variance
- **File:** `services/bot-learning-service/src/profile-builder.ts:24`

```typescript
// Before:
const MIN_SAMPLE_SIZE = 10

// After:
const MIN_SAMPLE_SIZE = 50  // Minimum 50 players per tier for statistical significance
```

**Fix 2: Introduce 5-Tier Percentile System**
- **Current:** Easy (0-25%), Medium (40-60%), Hard (75%+) → 30% excluded
- **Problem:** 30% of players (25-40%, 60-75%) have no matching bot tier
- **Fix:** Introduce 5 tiers covering full spectrum
  - Tier 0 (Ultra-Easy): 0-20% percentile
  - Tier 1 (Easy): 20-40% percentile
  - Tier 2 (Medium): 40-60% percentile
  - Tier 3 (Hard): 60-80% percentile
  - Tier 4 (Expert): 80%+ percentile

**OR** (if 5 tiers too complex):
  - Tier 0: 0-30%, Tier 1: 30-50%, Tier 2: 50-70%, Tier 3: 70-100%
  - Chosen: 4-tier system (better coverage, manageable complexity)

- **File:** `services/bot-learning-service/src/profile-builder.ts:143-151`

**Fix 3: Improve Win-Rate Derivation Model**
- **Current:** Linear formula `fold = 0.60 - (winRate / 200)` ignores game state
- **Problem:** Two players with same win-rate could play opposite strategies but get identical bot profile
- **Fix:** Use logistic regression on fold/call/raise features
  - Input features: win_rate, folds_per_hand, calls_per_hand, raises_per_hand, position_variance
  - Output: (fold_probability, call_probability, raise_probability) for bot profile
  - Training: Fit on 30 days of player data (existing pipeline)

- **File:** `services/bot-learning-service/src/profile-builder.ts:220-250`

```typescript
// Before:
const fold_probability = 0.60 - (winRate / 200)

// After (pseudocode):
const features = {
  winRate: player.win_rate,
  foldRatio: player.total_folds / player.total_hands,
  callRatio: player.total_calls / player.total_hands,
  raiseRatio: player.total_raises / player.total_hands,
  positionVariance: variance(player.positional_win_rates)
}
const [foldProb, callProb, raiseProb] = await trainBehaviorModel(features, playerHistoryData)
// Store in bot_profiles
```

**Fix 4: Add Audit Logging for Profile Overrides**
- **Current:** Admin changes to bot profiles are silent; no logging
- **Problem:** Impossible to debug when bot behavior changes; no compliance trail
- **Fix:** Add `bot_profile_audit_log` table; log all overrides with admin user ID, timestamp, changes

- **File:** `services/bot-learning-service/src/profile-builder.ts:260-277`

```typescript
// New table schema:
CREATE TABLE bot_profile_audit_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  game_type VARCHAR(50) NOT NULL,
  difficulty VARCHAR(20) NOT NULL,
  admin_user_id UUID NOT NULL,
  changes JSONB NOT NULL,  -- {field: old_value → new_value}
  timestamp TIMESTAMP NOT NULL DEFAULT NOW(),
  reason VARCHAR(500)  -- Why the change was made
);

// On profile override:
async overrideProfile(gameType: string, difficulty: string, overrides: Partial<BotProfile>) {
  const admin_user_id = req.user.id
  await db.query(`
    INSERT INTO bot_profile_audit_log 
    (game_type, difficulty, admin_user_id, changes, timestamp)
    VALUES ($1, $2, $3, $4, $5)
  `, [gameType, difficulty, admin_user_id, JSON.stringify(overrides), new Date()])
  
  // Apply override
  await updateProfile(gameType, difficulty, overrides)
  
  // Emit event for monitoring
  eventBus.emit('profile_override', { gameType, difficulty, overrides, admin: admin_user_id })
}
```

---

#### **B. Churn-ML-Service (ML Team)**

**Fix 5: Add Train/Test Split & Cross-Validation**
- **Current:** Model trains on full dataset; accuracy reported on same data (misleading)
- **Problem:** True generalization unknown; model likely overfitted; real performance ~40-50% worse
- **Fix:** Add sklearn train_test_split (80/20), 5-fold cross-validation, holdout test set

- **File:** `services/churn-ml-service/main.py:92-96`

```python
from sklearn.model_selection import train_test_split, cross_val_score

def train_churn_model():
    X, y = prepare_training_data()
    
    # Train/test split
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=42, stratify=y
    )
    
    # Train model
    model = RandomForestClassifier(n_estimators=100, max_depth=10, random_state=42)
    model.fit(X_train, y_train)
    
    # Evaluate
    train_accuracy = model.score(X_train, y_train)
    test_accuracy = model.score(X_test, y_test)
    cv_scores = cross_val_score(model, X_train, y_train, cv=5)
    
    print(f"Train accuracy: {train_accuracy:.2%}")
    print(f"Test accuracy: {test_accuracy:.2%}")
    print(f"Cross-val mean: {cv_scores.mean():.2%} (±{cv_scores.std():.2%})")
    
    # Reject model if test accuracy too low
    if test_accuracy < 0.65:
        logger.warn(f"Model rejected: test_accuracy {test_accuracy:.2%} < 0.65")
        return None
    
    return model
```

**Validation Criteria:**
- Test accuracy ≥ 0.65 (65% correct on unseen data)
- Cross-val std < 0.10 (consistent across folds; not overfit to one fold)
- Train-test gap < 0.15 (not more than 15% overfitting)

**Fix 6: Implement Async Model Training (Non-Blocking)**
- **Current:** First prediction after restart waits 10+ seconds (synchronous training)
- **Problem:** Game-gateway timeout (2s); returns null churn prediction; degraded experience
- **Fix:** Queue training asynchronously; return cached fallback immediately

- **File:** `services/churn-ml-service/main.py:110-112`

```python
import asyncio
from queue import Queue

model = None
training_in_progress = False

@app.post('/predict')
async def predict(user_id: int):
    global model, training_in_progress
    
    # If model missing, queue async training
    if model is None:
        if not training_in_progress:
            training_in_progress = True
            asyncio.create_task(async_train_model())
        
        # Return cached fallback immediately (no wait)
        return {
            'churn_risk': 'unknown',
            'cached': True,
            'training': True,
            'message': 'Model training in background; using fallback'
        }
    
    # Model ready; predict immediately
    features = extract_features(user_id)
    prediction = model.predict([features])[0]
    churn_probability = float(model.predict_proba([features])[0][1])
    
    return {
        'churn_risk': churn_probability,
        'cached': False,
        'training': False
    }

async def async_train_model():
    """Train model in background without blocking predictions."""
    global model, training_in_progress
    try:
        logger.info("Background model training started")
        model = await asyncio.to_thread(train_churn_model)
        logger.info(f"Background training completed; model ready")
    except Exception as e:
        logger.error(f"Background training failed: {e}")
    finally:
        training_in_progress = False
```

**Fix 7: Replace Unrealistic Cold-Start Synthetic Data**
- **Current:** Hardcoded outliers: `[150, 20, 150, 50, 1500, 500]` (500 deposits never seen in real data)
- **Problem:** Cold-start predictions systematically misclassify real users
- **Fix:** Generate realistic synthetic data matching empirical distribution from real users

- **File:** `services/churn-ml-service/main.py:72-86`

```python
import numpy as np

def generate_synthetic_training_data(n_samples=100):
    """Generate realistic synthetic data matching real user distribution."""
    # Query actual user statistics
    real_stats = db.query("""
        SELECT 
            PERCENTILE_CONT(0.10) OVER () as p10_deposits,
            PERCENTILE_CONT(0.50) OVER () as p50_deposits,
            PERCENTILE_CONT(0.90) OVER () as p90_deposits,
            PERCENTILE_CONT(0.50) OVER () as p50_net_profit,
            STDDEV(net_profit) OVER () as std_net_profit,
            AVG(net_profit) OVER () as mean_net_profit
        FROM wallet_transactions
        WHERE created_at > NOW() - INTERVAL '28 days'
    """)
    
    synthetic_data = []
    for _ in range(n_samples):
        # Days since deposit: log-normal distribution (inactivity decay)
        days_since_deposit = np.random.lognormal(mean=2.5, sigma=1.2)
        
        # Total deposits: Poisson distribution (count of transactions)
        total_deposits = np.random.poisson(lam=real_stats['p50_deposits'])
        
        # Recent deposits: Uniform 0-50% of total
        deposits_last_14 = total_deposits * np.random.uniform(0, 0.5)
        
        # Prior deposits: For trend detection
        deposits_prior_14 = total_deposits * np.random.uniform(0, 0.5)
        
        # Games played: Related to deposits
        total_games = int(total_deposits * np.random.uniform(5, 20))
        
        # Net profit: Normal distribution matching real mean/std
        net_profit = np.random.normal(
            loc=real_stats['mean_net_profit'],
            scale=real_stats['std_net_profit']
        )
        
        synthetic_data.append([
            days_since_deposit,
            total_deposits,
            deposits_last_14,
            deposits_prior_14,
            total_games,
            net_profit
        ])
    
    return np.array(synthetic_data)
```

---

#### **C. Database & Infrastructure (DevOps Team)**

**Fix 8: Add Index for Profile Rebuild Query**
- **Current:** Nightly rebuild scans 1M+ rows with no index on timestamp
- **Problem:** 5+ minute full table scans at 2 AM during maintenance
- **Fix:** Add composite index (joined_at DESC, is_bot, status)

- **File:** `infra/db/migrations/XXX_add_profile_rebuild_index.sql`

```sql
-- Add index for profile rebuild query performance
CREATE INDEX idx_game_participants_rebuild 
ON game_participants(joined_at DESC, is_bot, status)
INCLUDE (profit, user_id, game_type);

-- Verify query plan uses index:
EXPLAIN ANALYZE
SELECT gp.*, gr.game_type
FROM game_participants gp
JOIN game_rooms gr ON gr.id = gp.room_id
WHERE gp.joined_at > NOW() - INTERVAL '30 days'
  AND gp.is_bot = false
  AND gr.status = 'completed'
ORDER BY gp.profit DESC;
-- Expected: Index Scan on idx_game_participants_rebuild
```

**Fix 9: Make Config Updates Transactional**
- **Current:** Updates loop through params one-by-one; partial failures leave inconsistent state
- **Problem:** If 3rd parameter fails, first 2 already committed
- **Fix:** Wrap in BEGIN/COMMIT/ROLLBACK

- **File:** `services/bot-learning-service/src/profile-builder.ts:63-81`

```typescript
async updateConfig(updates: Partial<BotConfig>) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    
    // Build dynamic SET clause
    const setClauses = Object.entries(updates)
      .map(([key, _], idx) => `${key} = $${idx + 1}`)
      .join(', ')
    
    // Execute all updates in single transaction
    await client.query(
      `UPDATE bot_learning_config SET ${setClauses}`,
      Object.values(updates)
    )
    
    await client.query('COMMIT')
    logger.info(`Config updated: ${Object.keys(updates).join(', ')}`)
  } catch (err) {
    await client.query('ROLLBACK')
    logger.error(`Config update failed; rolled back: ${err.message}`)
    throw err
  } finally {
    client.release()
  }
}
```

**Fix 10: Implement Model Versioning**
- **Current:** Single `model.pkl` file; no way to rollback bad training
- **Problem:** One bad training run ruins production predictions
- **Fix:** Version models as `model_v{timestamp}.pkl` with metadata; only activate if test_accuracy > 0.70

- **File:** `services/churn-ml-service/main.py` (model storage)

```python
import json
import time
import os

def save_model_versioned(model, train_accuracy, test_accuracy):
    """Save model with version and metadata; only activate if test_accuracy passes threshold."""
    timestamp = int(time.time())
    version = f"model_v{timestamp}"
    
    # Create versioned model directory
    model_dir = f"/opt/teen/ml/churn-models/{version}"
    os.makedirs(model_dir, exist_ok=True)
    
    # Save model
    model_path = f"{model_dir}/model.pkl"
    pickle.dump(model, open(model_path, 'wb'))
    
    # Save metadata
    metadata = {
        'version': version,
        'timestamp': timestamp,
        'train_accuracy': float(train_accuracy),
        'test_accuracy': float(test_accuracy),
        'created_at': datetime.utcnow().isoformat(),
        'features': ['days_since_deposit', 'total_deposits', 'deposits_last_14', 'deposits_prior_14', 'total_games', 'net_profit'],
        'hyperparams': {'n_estimators': 100, 'max_depth': 10}
    }
    json.dump(metadata, open(f"{model_dir}/metadata.json", 'w'))
    
    # Only activate if test_accuracy passes threshold
    test_accuracy_threshold = 0.65
    if test_accuracy >= test_accuracy_threshold:
        # Update pointer to active version
        os.symlink(model_path, "/opt/teen/ml/churn-models/model_current.pkl")
        logger.info(f"✅ Activated {version} (test_acc={test_accuracy:.2%})")
        return version
    else:
        logger.warn(f"⚠️ Model {version} rejected (test_acc={test_accuracy:.2%} < {test_accuracy_threshold:.2%})")
        return None

def rollback_model(previous_version):
    """Rollback to previous model version (1-click revert)."""
    previous_model_path = f"/opt/teen/ml/churn-models/{previous_version}/model.pkl"
    if os.path.exists(previous_model_path):
        os.symlink(previous_model_path, "/opt/teen/ml/churn-models/model_current.pkl")
        logger.info(f"✅ Rolled back to {previous_version}")
    else:
        logger.error(f"Previous model {previous_version} not found")
```

---

### P0 Deliverables

**By end of Week 2 (Staging Deployment):**
- ✅ All 6 code fixes implemented (min_sample_size, train/test split, async training, audit logging, indices, transactions)
- ✅ Unit tests for each fix (>80% code coverage for modified files)
- ✅ Integration tests validating profile quality improvements
- ✅ Staging deployment verified (profiles built, models trained, no crashes)

**By end of Week 3 (Production Validation):**
- ✅ Canary rollout: 5% of real players (24h monitoring)
- ✅ Full rollout: 100% players (24h monitoring)
- ✅ Regression testing: No increase in bot-related complaints
- ✅ Metrics baseline: Establish win-rate stability (target: ±2%)
- ✅ Rollback plan documented (1-click revert if issues)

### P0 Success Criteria

| Metric | Target | Validation |
|--------|--------|-----------|
| **All 6 code issues fixed** | 100% | Code review + tests passing |
| **Min sample size stabilization** | Profile variance ↓ 30% | Compare profiles pre/post in prod |
| **Train/test split validation** | test_accuracy > 0.65 | Holdout set measurement |
| **Async training performance** | /predict responds < 100ms always | Production latency monitoring |
| **Audit logging coverage** | 100% of profile changes logged | Admin panel audit view |
| **Zero production regressions** | No new issues in 48h prod monitoring | Metrics dashboard + error logs |
| **Win-rate stability** | Actual vs target within ±2% | hourly metrics collection |

### P0 Team Assignment (Parallel Execution)

| Role | Tasks | Effort | Timeline |
|------|-------|--------|----------|
| **Backend (2)** | min_sample_size, 5-tier system, win-rate model, audit logging | 8 days | Week 1-2 |
| **ML (2)** | train/test split, async training, synthetic data, model versioning | 6 days | Week 1-2 |
| **DevOps (2)** | indices, transactions, deployment pipeline, prod monitoring | 5 days | Week 1-2 |
| **Validation (Shared)** | Staging tests, canary rollout, 48h prod monitoring | 2 days | Week 2-3 |

**Total P0 effort:** 21 engineer-days (3 weeks calendar time with parallel work)

---

## PART 3: Phase 1 — Fairness & Observability (Weeks 3-4)

### Objective

Build real-time metrics to detect bot performance drift; implement A/B testing framework to validate fairness before rolling out changes.

### Components

#### **A. Metrics Dashboard (Backend + ML Team)**

**New Infrastructure:**
- Table: `bot_profile_metrics` (hourly granularity, rolling 24h)
- Cron job: Updates every hour with stats from last 24 hours
- Admin UI: Charts showing win-rate, drift, consistency, alerts

**Schema:**
```sql
CREATE TABLE bot_profile_metrics (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  profile_id UUID REFERENCES bot_profiles(id),
  game_type VARCHAR(50) NOT NULL,
  difficulty VARCHAR(20) NOT NULL,
  hour TIMESTAMP NOT NULL,  -- Hour bucket for aggregation
  
  -- Metrics
  game_count INT NOT NULL,
  avg_win_rate NUMERIC(4,3),  -- 0-1 scale
  win_rate_std NUMERIC(4,3),  -- Standard deviation
  percentile_rank INT,  -- vs real players in same game
  sample_size INT,  -- Number of players in profile
  
  -- Monitoring
  drift_from_target NUMERIC(4,3),  -- actual - target
  is_alert BOOLEAN DEFAULT false,  -- True if >±3% drift
  
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_bot_metrics_lookup 
ON bot_profile_metrics(game_type, difficulty, hour DESC);
```

**Cron Job (runs every hour):**
```sql
-- Hourly aggregation
INSERT INTO bot_profile_metrics 
(profile_id, game_type, difficulty, hour, game_count, avg_win_rate, win_rate_std, percentile_rank, sample_size, drift_from_target, is_alert)
SELECT 
  bp.id,
  bp.game_type,
  bp.difficulty,
  DATE_TRUNC('hour', NOW()),
  COUNT(*),
  AVG(CASE WHEN gp.prize_won > gp.entry_fee THEN 1.0 ELSE 0.0 END),
  STDDEV(CASE WHEN gp.prize_won > gp.entry_fee THEN 1.0 ELSE 0.0 END),
  PERCENT_RANK() OVER (PARTITION BY game_type ORDER BY avg_win_rate),
  COUNT(DISTINCT gp.user_id),
  AVG(CASE WHEN gp.prize_won > gp.entry_fee THEN 1.0 ELSE 0.0 END) - bp.win_rate_target,
  ABS(AVG(CASE WHEN gp.prize_won > gp.entry_fee THEN 1.0 ELSE 0.0 END) - bp.win_rate_target) > 0.03
FROM game_participants gp
JOIN game_rooms gr ON gr.id = gp.room_id
JOIN bot_profiles bp ON bp.game_type = gr.game_type AND bp.difficulty = gr.bot_difficulty
WHERE gp.is_bot = true
  AND gp.created_at > NOW() - INTERVAL '24 hours'
  AND gp.created_at <= NOW() - INTERVAL '1 hour'
GROUP BY bp.id, bp.game_type, bp.difficulty, bp.win_rate_target;
```

**Admin Dashboard UI:**
- Chart 1: Win-rate trend (24h, 7d, 30d)
- Chart 2: Drift from target (rolling average)
- Chart 3: Sample size per tier (data quality indicator)
- Chart 4: Volatility/consistency (daily variance)
- Alerts: Red icon if drift > ±3% for 3+ consecutive hours

#### **B. Drift Detection (DevOps + ML Team)**

**Alert Logic:**
```python
def check_drift_alerts():
    """Hourly check for win-rate drift; alert if threshold exceeded."""
    # Query last 3 hours of metrics
    recent_metrics = db.query("""
        SELECT game_type, difficulty, drift_from_target, hour
        FROM bot_profile_metrics
        WHERE created_at > NOW() - INTERVAL '3 hours'
        ORDER BY game_type, difficulty, hour DESC
    """)
    
    # Group by (game_type, difficulty)
    profiles = {}
    for metric in recent_metrics:
        key = (metric.game_type, metric.difficulty)
        if key not in profiles:
            profiles[key] = []
        profiles[key].append(metric.drift_from_target)
    
    # Check for 3+ consecutive hours of drift > ±3%
    alerts = []
    for (game_type, difficulty), drifts in profiles.items():
        if len(drifts) >= 3 and all(abs(d) > 0.03 for d in drifts):
            alerts.append({
                'game_type': game_type,
                'difficulty': difficulty,
                'drift': drifts[0],  # Latest
                'hours_exceeded': len(drifts),
                'severity': 'HIGH' if abs(drifts[0]) > 0.05 else 'MEDIUM'
            })
    
    # Send Slack notifications
    for alert in alerts:
        slack_notify(f"""
            🚨 Bot Performance Alert
            Game: {alert['game_type']} / {alert['difficulty']}
            Drift: {alert['drift']:+.1%} (target: ±2%)
            Duration: {alert['hours_exceeded']} hours
            Action: Check bot_profile_metrics table; consider rebuild
        """)
    
    return alerts
```

**Slack Integration:**
- Channel: #bot-alerts
- Notifications: Every 3+ hours of drift > ±3%
- Severity: MEDIUM (3-5% drift), HIGH (>5% drift)
- Action: Link to admin dashboard for manual investigation

#### **C. A/B Testing Framework (Backend Team)**

**Schema Extensions:**
```sql
-- Extend bot_profiles table
ALTER TABLE bot_profiles ADD COLUMN (
  is_experimental BOOLEAN DEFAULT false,
  bucket_id UUID,  -- Which A/B cohort
  created_version INTEGER DEFAULT 1,
  metrics_tracked BOOLEAN DEFAULT false
);

-- New table: a_b_experiment tracking
CREATE TABLE a_b_experiments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(200) NOT NULL UNIQUE,
  game_type VARCHAR(50),
  difficulty VARCHAR(20),
  control_profile_id UUID REFERENCES bot_profiles(id),
  experimental_profile_id UUID REFERENCES bot_profiles(id),
  
  traffic_allocation_pct INT DEFAULT 5,  -- 5% experimental, 95% control
  start_date TIMESTAMP,
  end_date TIMESTAMP,
  status VARCHAR(20),  -- 'active', 'completed', 'aborted'
  
  -- Results
  control_retention NUMERIC(4,3),
  control_avg_roi NUMERIC(10,2),
  experimental_retention NUMERIC(4,3),
  experimental_avg_roi NUMERIC(10,2),
  winner VARCHAR(20),  -- 'control', 'experimental', or 'tie'
  
  created_at TIMESTAMP DEFAULT NOW()
);
```

**Routing Logic (in Game-Gateway):**
```typescript
async assignBotProfile(game_type: string, player_id: string): Promise<BotProfile> {
  // Check if player is in active A/B experiment
  const experiment = await db.query(
    `SELECT * FROM a_b_experiments WHERE game_type = $1 AND status = 'active'`,
    [game_type]
  )
  
  if (experiment) {
    // Deterministic assignment: hash(player_id) % 100 < traffic_allocation_pct → experimental
    const hash = hashUserId(player_id) % 100
    const is_experimental = hash < experiment.traffic_allocation_pct
    
    const profile_id = is_experimental 
      ? experiment.experimental_profile_id 
      : experiment.control_profile_id
    
    return fetchProfile(profile_id)
  }
  
  // No active experiment; use standard profile
  return fetchProfile(game_type, difficulty)
}
```

**Metrics Collection:**
```sql
-- Track retention & ROI per experiment
SELECT 
  exp.name,
  CASE WHEN gp.is_bot THEN 'control' ELSE 'experimental' END as group,
  COUNT(DISTINCT gp.user_id) as players,
  COUNT(*) as games,
  AVG(CASE WHEN gp.prize_won > gp.entry_fee THEN 1.0 ELSE 0.0 END) as win_rate,
  AVG(EXTRACT(EPOCH FROM (gp.left_at - gp.joined_at)) / 60.0) as avg_game_duration_min
FROM game_participants gp
JOIN a_b_experiments exp ON exp.game_type = gp.game_type
WHERE exp.status = 'active'
  AND gp.created_at > exp.start_date
GROUP BY exp.name, group;
```

#### **D. Profile Versioning (Backend + ML Team)**

**Versioning Strategy:**
```
Current: Single bot_profiles table, in-place updates
New: Snapshot approach per rebuild
  bot_profiles_v1 (snapshot after rebuild #1)
  bot_profiles_v2 (snapshot after rebuild #2)
  bot_profiles_v3 (snapshot after rebuild #3)
  ... with active_version pointer
```

**Implementation:**
```typescript
async rebuildAndVersionProfiles() {
  // 1. Create new version
  const newVersion = version + 1
  const new_table = `bot_profiles_v${newVersion}`
  
  // 2. Copy current profiles to new version
  await db.query(`CREATE TABLE ${new_table} AS SELECT * FROM bot_profiles`)
  
  // 3. Compute percentiles & update new version
  const percentiles = computePercentiles(game_type)
  await db.query(`
    UPDATE ${new_table} 
    SET win_rate_target = $1, 
        fold_probability = $2, 
        call_probability = $3,
        raise_probability = $4
    WHERE game_type = $5 AND difficulty = $6
  `, [percentiles.target, percentiles.fold, ...])
  
  // 4. Update active version pointer
  await db.query(`
    UPDATE bot_learning_config 
    SET active_profile_version = $1
    WHERE key = 'active_profile_version'
  `, [newVersion])
  
  logger.info(`✅ Profiles version bumped: ${version} → ${newVersion}`)
  
  // 5. Cleanup old versions (keep last 5)
  const old_versions = version - 5
  if (old_versions > 0) {
    await db.query(`DROP TABLE IF EXISTS bot_profiles_v${old_versions}`)
  }
}

// Rollback: 1-click revert to previous version
async rollbackProfiles() {
  const current_version = await getActiveProfileVersion()
  const previous_version = current_version - 1
  
  await db.query(`
    UPDATE bot_learning_config 
    SET active_profile_version = $1
    WHERE key = 'active_profile_version'
  `, [previous_version])
  
  logger.info(`✅ Rolled back profiles: ${current_version} → ${previous_version}`)
}
```

---

### P1 Deliverables

**By end of Week 4:**
- ✅ Metrics dashboard live in admin panel (real-time charts, 24h/7d/30d trends)
- ✅ Drift detection cron job + Slack alerts on >±3% drift
- ✅ A/B testing framework ready (5% experimental routing, metrics tracking)
- ✅ Profile versioning with instant rollback capability
- ✅ Win-rate baseline established (first week of metrics data collected)
- ✅ Alert thresholds tuned (target: <10% false positive rate on alerts)

### P1 Success Criteria

| Metric | Target | Validation |
|--------|--------|-----------|
| **Metrics update frequency** | Hourly | bot_profile_metrics table updates every 60 min |
| **Drift detection latency** | <10 min | Alert fired within 10 min of drift threshold hit |
| **Dashboard accuracy** | ±0.5% | Compare with manual query results |
| **A/B routing correctness** | 95%+ traffic allocation accuracy | Verify 5% experimental vs 95% control in logs |
| **Rollback speed** | <2 min | Time to switch active_profile_version |
| **False positive rate** | <10% | Drift alerts that don't reflect real issues |

### P1 Team Assignment (Parallel)

| Role | Tasks | Effort | Timeline |
|------|-------|--------|----------|
| **Backend (2)** | Metrics API endpoints, A/B routing logic, profile versioning, rollback | 7 days | Week 3-4 |
| **ML (2)** | Metrics calculation, drift detection algorithm, A/B analysis | 5 days | Week 3-4 |
| **DevOps (2)** | bot_profile_metrics table, cron scheduling, Slack integration, dashboard setup | 6 days | Week 3-4 |

**Total P1 effort:** 18 engineer-days (2 weeks calendar time with parallel work)

---

## PART 4: Phase 2 — Adaptive Features & Anomaly Detection (Weeks 5-6)

### Objective

Improve player experience via personalized bot difficulty; detect potential cheating/collusion; speed up profile adaptation from daily to 6-hourly.

### Components

#### **A. Personalized Difficulty Per Player (Backend + ML)**

**Concept:** Assign bot tier based on player skill, not fixed "medium"

**Implementation:**
```sql
-- Add skill_percentile to game_participants
ALTER TABLE game_participants ADD COLUMN (
  skill_percentile INT,  -- 0-100, computed nightly
  assigned_bot_difficulty VARCHAR(20)  -- 'easy', 'medium', 'hard', etc.
);

-- Nightly computation (after rebuild)
WITH player_stats AS (
  SELECT 
    user_id,
    COUNT(*) as games_played,
    SUM(CASE WHEN prize_won > entry_fee THEN 1 ELSE 0 END) as wins,
    AVG(CASE WHEN prize_won > entry_fee THEN 1.0 ELSE 0.0 END) as win_rate,
    PERCENT_RANK() OVER (ORDER BY AVG(CASE WHEN prize_won > entry_fee THEN 1.0 ELSE 0.0 END))
      * 100 as skill_percentile
  FROM game_participants
  WHERE game_type = 'teen_patti'
    AND is_bot = false
    AND created_at > NOW() - INTERVAL '30 days'
  GROUP BY user_id
  HAVING COUNT(*) >= 5  -- Minimum 5 games for valid percentile
)
UPDATE game_participants gp
SET 
  skill_percentile = ps.skill_percentile,
  assigned_bot_difficulty = CASE 
    WHEN ps.skill_percentile < 30 THEN 'hard'
    WHEN ps.skill_percentile < 50 THEN 'medium-hard'
    WHEN ps.skill_percentile < 70 THEN 'medium'
    WHEN ps.skill_percentile < 90 THEN 'easy'
    ELSE 'ultra-easy'
  END
FROM player_stats ps
WHERE gp.user_id = ps.user_id;
```

**Routing Logic (Game-Gateway):**
```typescript
async assignBotForPlayer(player_id: string, game_type: string): Promise<string> {
  // Fetch player's skill percentile
  const player = await db.query(
    `SELECT skill_percentile FROM game_participants WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [player_id]
  )
  
  if (!player || player.skill_percentile === null) {
    return 'medium'  // Default for new players
  }
  
  // Map skill percentile to difficulty
  const difficulty = player.skill_percentile < 30 ? 'hard'
                   : player.skill_percentile < 50 ? 'medium-hard'
                   : player.skill_percentile < 70 ? 'medium'
                   : player.skill_percentile < 90 ? 'easy'
                   : 'ultra-easy'
  
  // Feature flag: Enable personalization for 5% players (canary)
  if (isInPersonalizationCohort(player_id)) {
    return difficulty
  }
  
  return 'medium'  // Control group
}
```

**Feature Flag:**
```typescript
function isInPersonalizationCohort(player_id: string): boolean {
  // Deterministic: hash(player_id) % 100 < 5 → in personalization group
  const feature_enabled = await db.query(
    `SELECT value FROM feature_flags WHERE name = 'personalized_bot_difficulty'`
  )
  
  if (!feature_enabled.value) return false
  
  const hash = hashPlayerId(player_id) % 100
  return hash < 5  // 5% of players
}
```

**Metrics Tracking:**
```sql
-- Compare retention: personalized vs control
SELECT 
  CASE WHEN skill_percentile IS NOT NULL THEN 'personalized' ELSE 'control' END as cohort,
  COUNT(DISTINCT user_id) as players,
  COUNT(DISTINCT gp.user_id FILTER (WHERE next_game_within_7d)) as returning_7d,
  COUNT(*) FILTER (WHERE next_game_within_7d) / COUNT(*) as retention_7d,
  AVG(CASE WHEN prize_won > entry_fee THEN 1.0 ELSE 0.0 END) as avg_win_rate
FROM game_participants gp
WHERE created_at > NOW() - INTERVAL '30 days'
GROUP BY cohort;
```

#### **B. Adversarial Player Detection (ML + DevOps)**

**Concept:** Flag potential cheaters (players beating hard bots too frequently)

**Detection Logic:**
```sql
-- Query: Players with unusually high win rate vs hard bots
WITH hard_bot_games AS (
  SELECT 
    gp.user_id,
    COUNT(*) as hard_bot_games,
    SUM(CASE WHEN gp.prize_won > gp.entry_fee THEN 1 ELSE 0 END) as hard_bot_wins,
    SUM(CASE WHEN gp.prize_won > gp.entry_fee THEN 1 ELSE 0 END)::float / COUNT(*) as hard_bot_win_rate
  FROM game_participants gp
  JOIN bot_profiles bp ON bp.game_type = gp.game_type AND bp.difficulty = gp.bot_difficulty
  WHERE bp.difficulty = 'hard'
    AND gp.is_bot = false
    AND gp.created_at > NOW() - INTERVAL '7 days'
  GROUP BY gp.user_id
  HAVING COUNT(*) >= 10  -- Minimum 10 games vs hard bots
)
SELECT * FROM hard_bot_games
WHERE hard_bot_win_rate > 0.80  -- Win rate > 80% vs hard bots
ORDER BY hard_bot_win_rate DESC;
```

**Flagging Pipeline:**
```python
def detect_anomalous_players():
    """Hourly check for players with anomalously high win rates."""
    query = """
    SELECT user_id, hard_bot_win_rate, hard_bot_games
    FROM hard_bot_games_view
    WHERE hard_bot_win_rate > 0.80
    """
    
    anomalous = db.query(query)
    
    for player in anomalous:
        # Check if already flagged recently
        existing_flag = db.query(
            `SELECT * FROM anomalous_players WHERE user_id = $1 AND last_flagged_at > NOW() - INTERVAL '24 hours'`,
            [player.user_id]
        )
        
        if not existing_flag:
            # Insert/update flag
            db.query(f"""
                INSERT INTO anomalous_players (user_id, risk_level, last_flagged_at)
                VALUES ($1, $2, NOW())
                ON CONFLICT(user_id) DO UPDATE
                SET last_flagged_at = NOW()
            """, [player.user_id, 'HIGH'])
            
            # Alert admin
            slack_notify(f"""
                🚨 Anomalous Player Detected
                User: {player.user_id}
                Hard Bot Win Rate: {player.hard_bot_win_rate:.1%}
                Games vs Hard Bot: {player.hard_bot_games}
                Action: Review player account for bot abuse / collusion
            """)
```

**Schema:**
```sql
CREATE TABLE anomalous_players (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL UNIQUE,
  risk_level VARCHAR(20),  -- 'LOW', 'MEDIUM', 'HIGH'
  win_rate_vs_hard NUMERIC(4,3),
  games_vs_hard INT,
  last_flagged_at TIMESTAMP,
  investigation_status VARCHAR(20) DEFAULT 'pending',  -- 'pending', 'false_positive', 'confirmed_abuse'
  notes TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);
```

#### **C. 6-Hourly Profile Rebuild (DevOps + ML)**

**Current:** Nightly @ 2 AM (24h rebuild cycle)

**New:** Every 6 hours (2 AM, 8 AM, 2 PM, 8 PM)

**Scheduler:**
```yaml
# ecosystem.config.js
apps: [
  {
    name: 'teen-bot-learning-service',
    script: 'dist/index.js',
    instances: 1,
    exec_mode: 'cluster',
    env: {
      REBUILD_CRON: '0 2,8,14,20 * * *',  # 6-hourly
      REBUILD_LOOKBACK_DAYS: 7  # Smaller window for faster rebuild
    }
  }
]
```

**Benefit:**
- Profiles adapt 4x faster to player meta shifts
- Reduces "stale bot" complaints mid-week
- Cost: 4% additional CPU (2% baseline → 6%)

---

### P2 Deliverables

**By end of Week 6:**
- ✅ skill_percentile computed for all active players (nightly)
- ✅ Personalized difficulty routing live (5% canary cohort)
- ✅ Anomalous player detection live (hourly flagging)
- ✅ 6-hourly profile rebuild scheduler active
- ✅ Retention metrics tracked (comparing personalized vs control)
- ✅ Cheating alerts sent to admin team

### P2 Success Criteria

| Metric | Target | Validation |
|--------|--------|-----------|
| **Personalized difficulty adoption** | 5% canary | Traffic split verified in logs |
| **Retention lift (personalized)** | +3-5% vs control | 30-day retention comparison |
| **Skill percentile accuracy** | ±5 percentile points | Compare ranking vs manual review |
| **Anomaly detection false-positive rate** | <15% | Admin review of flagged players |
| **6-hourly rebuild latency** | <10 min | Time from start to completion |
| **Rebuild frequency impact** | <5% CPU increase | Monitor baseline vs 6-hourly |

### P2 Team Assignment

| Role | Tasks | Effort | Timeline |
|------|-------|--------|----------|
| **Backend (2)** | skill_percentile calculation, difficulty routing, feature flag | 5 days | Week 5-6 |
| **ML (2)** | Anomaly detection model, risk scoring, hourly pipeline | 4 days | Week 5-6 |
| **DevOps (2)** | 6-hourly scheduler, anomalous_players table, monitoring | 4 days | Week 5-6 |

**Total P2 effort:** 13 engineer-days (2 weeks calendar time with parallel work)

---

## PART 5: Phase 3 — Scaling Infrastructure (Week 6+)

### Objective

Design (not full implementation) horizontal scaling for 5K+ concurrent games; evaluate real-time streaming alternatives.

### Components (Design Phase)

#### **A. Horizontal Scaling (Load Balancer + Multiple Gateway Instances)**

**Current Architecture:**
```
Single Game-Gateway (1 instance)
  └─ 500-800 concurrent connections
  └─ CPU peaks at 100% around 800 connections
```

**Proposed Architecture:**
```
Load Balancer (nginx)
  ├─ Game-Gateway-1 (1000 concurrent)
  ├─ Game-Gateway-2 (1000 concurrent)
  ├─ Game-Gateway-3 (1000 concurrent)
  └─ Game-Gateway-4 (1000 concurrent)
     └─ 4000+ total concurrent connections
     └─ Redis Pub/Sub for cross-instance profile invalidation
     └─ PostgreSQL connection pooling (PgBouncer)
```

**Implementation:**
- Deploy 4 Game-Gateway instances (currently 1)
- Add nginx load balancer (round-robin or least-connections)
- Configure Redis Pub/Sub for profile cache invalidation
- Use PgBouncer for connection pooling (20 → 80 connections)
- Cost: +$2.4K/year for extra VPS instances

#### **B. Real-Time Streaming (Optional, for DAU > 5K)**

**Current:** Nightly batch rebuild (24h+ lag)

**Proposed:** Real-time action stream aggregation (1-2h lag)

**Architecture:**
```
Game Room (real-time)
  └─ Redis Stream: game:${type}:actions:24h
       ├─ fold events
       ├─ call events
       ├─ raise events
       └─ decision_delay_ms
         ↓ (every hour)
Aggregation Service
  └─ Compute fold/call/raise ratios
  └─ Merge with historical percentiles
  └─ Update profiles in-place
         ↓
Redis Cache
  └─ Invalidate via Pub/Sub
  └─ Game-Gateway fetches latest
```

**Cost:** +15% Redis memory, +50% CPU for aggregation

**Breakeven:** When DAU > 5K and player meta shifts frequently

---

## PART 6: Testing & Validation Strategy

### Unit Tests (Each Phase)

**P0:** Min sample size, train/test split, model versioning
```
- bot_min_sample_size_validation.test.ts
- churn_model_train_test_split.test.py
- profile_audit_logging.test.ts
```

**P1:** Metrics calculation, drift detection, A/B routing
```
- bot_metrics_calculation.test.ts
- drift_detection_alerts.test.py
- a_b_experiment_routing.test.ts
```

**P2:** Skill percentile, anomaly detection, rebuild scheduler
```
- skill_percentile_accuracy.test.ts
- anomalous_player_detection.test.py
- rebuild_frequency_impact.test.ts
```

### Integration Tests

- End-to-end profile rebuild + deployment
- Canary rollout with traffic split
- Metrics dashboard populates correctly
- Alerts fire when thresholds exceeded

### Production Validation

**P0:** 48-hour monitoring (5% → 100% rollout)
- Win-rate stability check (±2% target)
- No increase in error rates
- Rollback plan tested

**P1:** 7-day metrics collection
- Baseline established for drift detection
- A/B experiment metrics tracked
- No false positive alerts

**P2:** 14-day retention comparison
- Personalized vs control cohort retention
- Anomaly detection accuracy
- Rebuild scheduler performance

---

## PART 7: Risk Mitigation & Rollback Plans

### P0 Risks

| Risk | Mitigation | Rollback |
|------|-----------|----------|
| **Model fails to train** | Async training prevents blocking; fallback to cached model | Use previous cached model |
| **Profile rebuild hangs** | Timeout at 15 min; restart if needed | Use previous version snapshot |
| **Win-rate drifts unexpectedly** | 48h prod monitoring catches issues | Revert commit immediately |
| **Audit logging performance impact** | Async writes; separate table | Disable logging if CPU spikes |

### P1 Risks

| Risk | Mitigation | Rollback |
|------|-----------|----------|
| **Metrics dashboard breaks** | Feature flag; falls back to manual queries | Disable dashboard UI |
| **Drift alerts overwhelm Slack** | Throttling; daily digest if >10 alerts | Disable Slack notifications |
| **A/B experiment bugs routing** | Dry-run on 0.1% traffic first | Set traffic_allocation to 0 |
| **Profile versioning causes latency** | Background snapshot; no blocking updates | Switch back to in-place updates |

### P2 Risks

| Risk | Mitigation | Rollback |
|------|-----------|----------|
| **Personalized difficulty breaks retention** | 5% canary; measure retention daily | Disable feature flag |
| **Anomaly detection false positives** | <15% FP rate threshold; manual review | Increase risk threshold |
| **6-hourly rebuild causes CPU spike** | Monitor 5% increase ceiling; reduce frequency if exceeded | Revert to nightly |

---

## PART 8: Success Metrics & Observability

### Key Performance Indicators (KPIs)

**Bot Fairness:**
- Win-rate stability: actual within ±2% of target (hourly check)
- Volatility: daily variance < 5%
- Sample size: ≥ 50 players per tier

**System Performance:**
- Profile fetch latency p99: < 100ms
- Redis cache hit rate: > 70%
- Model rebuild duration: < 10 minutes
- Drift detection latency: < 10 minutes

**Player Experience:**
- Retention (7d): Baseline + 3-5% from personalization
- "Game feels fair" rating: > 80% (survey)
- Complaint rate: ↓ 20% from current baseline

**Model Health:**
- Churn model precision: ≥ 0.70
- Churn model recall: ≥ 0.65
- Drift detection sensitivity: > 90% true positive rate

### Monitoring Dashboards

1. **Bot Performance Dashboard (Real-time)**
   - Win-rate by tier (24h/7d trends)
   - Drift alerts (active)
   - Sample sizes
   - Rebuild status

2. **Churn Model Dashboard (Daily)**
   - Model accuracy (train/test)
   - Prediction distribution
   - Model age (when last trained)

3. **Player Metrics Dashboard (Daily)**
   - Retention by cohort (personalized vs control)
   - Skill percentile distribution
   - Anomalous player count

4. **Infrastructure Dashboard (Real-time)**
   - CPU/memory usage per service
   - Database connections
   - Redis memory
   - API latencies

---

## PART 9: Timeline & Resource Plan

### Gantt Chart

```
Week 1-2:   [P0: Code Fixes ============]
              Backend: min_sample, 5-tier, win-rate model, audit
              ML: train/test, async training, synthetic data, versioning
              DevOps: indices, transactions, deployment

Week 2-3:   [P0 Production Validation ===]
              Canary rollout, 48h monitoring, regression testing

Week 3-4:   [P1: Metrics & Fairness =====]
              Backend: A/B routing, versioning
              ML: metrics calculation, drift detection
              DevOps: bot_profile_metrics, cron, Slack

Week 5-6:   [P2: Adaptive Features ======]
              Backend: skill_percentile, personalization
              ML: anomaly detection
              DevOps: 6-hourly scheduler, monitoring

Week 6+:    [P3: Scaling (Design Only) ==]
              Load balancer architecture
              Streaming evaluation (POC only if DAU > 5K)
```

### Resource Allocation

| Phase | Backend | ML | DevOps | Total |
|-------|---------|-----|--------|-------|
| **P0** | 8d | 6d | 5d | 19d |
| **P1** | 7d | 5d | 6d | 18d |
| **P2** | 5d | 4d | 4d | 13d |
| **P3** | 2d | 1d | 3d | 6d |
| **Total** | 22d | 16d | 18d | **56d** |

**Team capacity (6 people):** 42 days (6 weeks calendar) of parallel work

**Contingency:** +15% (~8 days) for testing, fixes, unforeseen issues

**Total Timeline:** 6-7 weeks

---

## PART 10: Approval & Next Steps

### Design Approval Checklist

- ✅ All 4 phases clearly scoped
- ✅ Team roles defined (backend, ML, DevOps)
- ✅ Success criteria measurable
- ✅ Risk mitigation plans in place
- ✅ Rollback procedures documented
- ✅ Timeline realistic (6-7 weeks)
- ✅ Resource requirements clear (6 people)

### Next Steps (Post-Approval)

1. **Invoke writing-plans skill** → Detailed implementation plan with task breakdown
2. **Create TaskCreate items** → 25-30 micro-tasks (<2h each)
3. **Execute sequentially** → Start Week 1 with P0 backend fixes
4. **Track progress** → TaskUpdate as each task completes
5. **Daily standups** → Coordinate between backend, ML, DevOps teams

---

## Appendix A: Terminology

| Term | Definition |
|------|-----------|
| **Min sample size** | Minimum number of real players required to build a valid difficulty tier |
| **Percentile** | Player's rank (0-100) within all players' win-rate distribution |
| **Drift** | Actual win-rate - Target win-rate (should be ±2% or better) |
| **Canary rollout** | Deploy to 5% of users first, verify no issues, then 100% |
| **A/B testing** | Compare two versions (control vs experimental) on subset of traffic |
| **Anomalous player** | Player with unusually high win rate vs hard bots (potential cheater) |
| **Feature flag** | Runtime toggle to enable/disable features without code deployment |
| **Profile versioning** | Snapshot profiles after each rebuild; enables rollback |
| **Async training** | Train model in background without blocking other operations |

---

## Appendix B: File Changes Summary

### New Files

```
services/bot-learning-service/src/audit-logger.ts
services/churn-ml-service/model-versioning.py
services/churn-ml-service/synthetic-data-generator.py
services/game-gateway/src/personalized-routing.ts
infra/db/migrations/XXX_bot_profile_metrics.sql
infra/db/migrations/XXX_add_profile_rebuild_index.sql
infra/db/migrations/XXX_anomalous_players.sql
infra/db/migrations/XXX_a_b_experiments.sql
docs/BOT_ML_MONITORING.md
```

### Modified Files

```
services/bot-learning-service/src/profile-builder.ts
services/bot-learning-service/src/index.ts
services/churn-ml-service/main.py
services/game-gateway/src/bot-profile.ts
ecosystem.config.js (rebuild schedule)
```

---

## Appendix C: Database Schema Summary

**New Tables:**
- `bot_profile_audit_log` — Admin changes to profiles
- `bot_profile_metrics` — Hourly win-rate tracking
- `a_b_experiments` — A/B test tracking
- `anomalous_players` — Flagged players for investigation
- `bot_profiles_v{N}` — Snapshot versions per rebuild

**Modified Tables:**
- `bot_profiles` — Add is_experimental, bucket_id, created_version
- `bot_learning_config` — Add active_profile_version pointer
- `game_participants` — Add skill_percentile, assigned_bot_difficulty

**New Indices:**
- `idx_game_participants_rebuild` — Profile rebuild query performance

---

## Document History

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2026-07-11 | Initial design; 4 phases, team roles, success criteria, rollback plans |

