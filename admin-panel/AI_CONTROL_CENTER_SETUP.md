# AI Control Center Setup Guide

This document explains how to integrate the AI Control Center into the admin panel.

## Components Created

### 1. Pages
- **AIControlCenter.tsx** - Main dashboard with 3 tabs
  - Location: `src/pages/AIControlCenter.tsx`
  - Exports 3 child components
  - Phase status and navigation

### 2. Components (AI subfolder)
- **AIPromptConsole.tsx** - Natural language query interface
  - Chat interface for querying platform data
  - Example queries for users
  - LocalStorage history persistence
  - Posts to `/api/admin/ml/query`

- **MLConfigPanel.tsx** - Parameter tuning interface
  - Fraud detection thresholds
  - Churn model weights
  - Bot settings (difficulty, win rate cap)
  - RTP optimizer configuration
  - Posts to `/api/admin/ml/config`

- **WorkflowDashboard.tsx** - Real-time monitoring
  - Model training progress (left panel)
  - Active ML jobs (center panel)
  - System health metrics (right panel)
  - Prediction/alert feed (bottom)
  - Fetches from `/api/admin/ml/metrics` (5s refresh)

### 3. Backend Routes
- **ml-routes.ts** - Admin service routes
  - Location: `services/admin-service/src/ml-routes.ts`
  - POST `/api/admin/ml/query` - Handle natural language queries
  - POST `/api/admin/ml/config` - Update ML configuration
  - GET `/api/admin/ml/metrics` - Real-time metrics

## Integration Steps

### Step 1: Add Routes to Admin Panel Navigation

Edit `admin-panel/src/pages/Layout.tsx` (or your routing file):

```typescript
import { AIControlCenter } from './AIControlCenter'

const menuItems = [
  {
    key: 'dashboard',
    label: 'Dashboard',
    icon: <DashboardOutlined />,
  },
  // ... other menu items
  {
    key: 'ai-control',
    label: 'AI Control Center',
    icon: <BrainOutlined />,
    onClick: () => navigate('/admin/ai-control'),
  },
]

const routes = [
  {
    path: '/admin/dashboard',
    element: <Dashboard />,
  },
  // ... other routes
  {
    path: '/admin/ai-control',
    element: <AIControlCenter />,
  },
]
```

### Step 2: Add Backend Routes to Admin Service

Edit `services/admin-service/src/index.ts`:

```typescript
import { registerMLRoutes } from './ml-routes'

// In your Fastify setup:
async function start() {
  const app = fastify()
  
  // ... existing routes ...
  
  // Register ML routes
  await registerMLRoutes(app, redis, pool)
  
  // ... start server
}
```

### Step 3: Update Database Schema (Optional)

If you want to store ML configuration persistently:

```sql
-- Add to infra/db/migrations/013_ml_config.sql
CREATE TABLE IF NOT EXISTS admin_config (
  key VARCHAR(100) PRIMARY KEY,
  value JSONB NOT NULL,
  updated_by UUID REFERENCES admin_users(id),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_admin_config_updated ON admin_config(updated_at);
```

### Step 4: Install Dependencies (if needed)

The AI Control Center uses existing dependencies:
- Ant Design components (already in admin-panel)
- React hooks (already in admin-panel)
- axios for HTTP calls (already in admin-panel)

No new dependencies needed!

## API Contracts

### POST /api/admin/ml/query

**Request:**
```json
{
  "query": "analyze churn for stake=100 users"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "query": "analyze churn for stake=100 users",
    "answer": "24% of users at risk. Top players: user_123 (89%), user_456 (76%)...",
    "confidence": 0.85,
    "executionTime": 234
  }
}
```

### POST /api/admin/ml/config

**Request:**
```json
{
  "fraudDetection": {
    "coLocationThreshold": 3,
    "winRateAnomalyThreshold": 95,
    "velocityLimitHours": 1,
    "referralChainDepth": 2,
    "enabled": true
  },
  "churnPrediction": {
    "daysSinceLastPlayWeight": 0.6,
    "avgLossStreakWeight": 0.3,
    "bonusBalanceWeight": 0.1,
    "retrainFrequency": "daily",
    "enabled": true
  },
  "botSettings": {
    "maxWinRate": 50,
    "difficulty": "medium",
    "decisionTreeDepth": 8,
    "aggressionLevel": 5,
    "enabled": true
  },
  "rtpOptimizer": {
    "minRakePercent": 3.5,
    "maxRakePercent": 7.0,
    "testDuration": 24,
    "confidenceThreshold": 0.95,
    "enabled": true
  }
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "message": "Configuration updated",
    "config": { ... }
  }
}
```

### GET /api/admin/ml/metrics

**Response:**
```json
{
  "success": true,
  "data": {
    "timestamp": "2026-06-28T12:34:56Z",
    "models": [
      {
        "name": "churn_model",
        "status": "completed",
        "accuracy": 0.82,
        "lastRetrain": "2026-06-28T11:34:56Z"
      }
    ],
    "jobs": [
      {
        "id": "1",
        "name": "Fraud scoring",
        "status": "running",
        "progress": 65,
        "processed": 3421,
        "total": 5234,
        "latency": 12.5
      }
    ],
    "predictions": [
      {
        "id": "1",
        "type": "churn",
        "target": "user_12345",
        "score": 0.72,
        "confidence": 0.89,
        "timestamp": "2026-06-28T12:34:56Z",
        "action": "Send bonus to retain"
      }
    ],
    "system": {
      "cpu": 45,
      "memory": 62,
      "latency_p50": 85,
      "latency_p95": 234,
      "model_speed": 45.2
    }
  }
}
```

## Feature Overview

### Tab 1: AI Prompt Console
- Chat-like interface for querying platform data
- Example queries for users to try
- Query history persisted in localStorage
- Supports:
  - Churn analysis ("analyze churn for stake=100")
  - Fraud investigation ("fraud alert: show evidence for player X")
  - Bot performance ("explain bot decision for player_id=xyz")
  - Revenue insights ("what is our GGR today")
  - Model comparison ("compare churn model accuracy week-over-week")

### Tab 2: ML Configuration Panel
- Fraud Detection Rules:
  - Co-location threshold (3+ accounts on same device)
  - Win-rate anomaly threshold (95%+)
  - Velocity limits (₹10k in X hours)
  - Referral chain depth

- Churn Prediction:
  - Feature weights (days since last play, loss streak, bonus)
  - Retrain frequency (daily, weekly, monthly)
  - Enable/disable toggle

- Bot Settings:
  - Max win rate cap (fair: 48-52%)
  - Difficulty level (easy, medium, hard)
  - Decision tree depth
  - Aggression level (1-10)

- RTP Optimizer:
  - Rake % bounds (min/max)
  - A/B test duration
  - Confidence threshold
  - Enable/disable toggle

### Tab 3: Real-Time Workflow Dashboard
- **Training Progress Panel**: Model status, accuracy, ETA
- **Active Jobs Panel**: Running ML jobs with progress bars
- **System Health Panel**: CPU, memory, latency metrics
- **Prediction Feeds**: 
  - Churn risk alerts
  - Fraud detection alerts
  - Bot decision stream

## Testing

### Local Testing

1. Add menu item to admin panel
2. Navigate to AI Control Center
3. Test each tab:

**Prompt Console:**
```bash
# In browser console
# Try: "analyze churn for stake=100 users"
```

**Config Panel:**
- Adjust sliders (fraud thresholds, bot difficulty)
- Click "Save Configuration"
- Check network tab: POST /api/admin/ml/config

**Workflow Dashboard:**
- Should show mock models, jobs, predictions
- Check network tab: GET /api/admin/ml/metrics (5s refresh)
- Click "Refresh" button to manually trigger

### Production Integration

1. Connect `/api/admin/ml/query` to actual ML service
   - Currently returns mock responses
   - Update `ml-routes.ts` `handleQuery()` function

2. Connect `/api/admin/ml/config` to ML training pipeline
   - Currently stores in Redis + PostgreSQL
   - Publish config changes to `ml:config:change` Pub/Sub channel

3. Connect `/api/admin/ml/metrics` to monitoring service
   - Currently returns mock metrics
   - Fetch from Redis `ml:metrics:latest` key

## Next Steps

1. **Week 1-2**: Fraud Detection Service connects to these endpoints
2. **Week 4-6**: Analytics Service populates /metrics endpoint
3. **Week 7+**: ML Service implements `handleQuery()` with real NLP

---

**Files Created**:
- `src/pages/AIControlCenter.tsx` - Main page (155 lines)
- `src/components/AI/AIPromptConsole.tsx` - Prompt interface (189 lines)
- `src/components/AI/MLConfigPanel.tsx` - Configuration panel (350 lines)
- `src/components/AI/WorkflowDashboard.tsx` - Monitoring dashboard (290 lines)
- `src/components/AI/index.ts` - Export helpers (3 lines)
- `services/admin-service/src/ml-routes.ts` - Backend routes (340 lines)

**Total**: ~1,320 lines of UI + backend code

**Status**: Ready for integration ✅
