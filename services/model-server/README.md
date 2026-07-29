# Model Server - Real-time ML Model Serving Infrastructure

A FastAPI service for serving ML model predictions with advanced features including batch inference, model versioning, automatic rollback, and real-time monitoring.

## Features

### Core Capabilities
- **Batch Inference**: Process 100+ players in <50ms
- **Model Caching**: Load trained models from disk on startup
- **Model Versioning**: Support multiple model versions with active pointer
- **Automatic Rollback**: Revert to previous version if error rate exceeds threshold
- **Performance Monitoring**: Track latency (p50, p99), accuracy, and error rates

### API Endpoints
- `POST /predict/batch` - Serve batch predictions for multiple players
- `GET /models` - List available model versions
- `POST /models/activate/{version}` - Switch to a different model version
- `POST /models/rollback` - Rollback to previous model version
- `GET /health` - Health check with model status
- `GET /metrics` - Performance and accuracy metrics

## Architecture

### ModelServer Class
Core server implementation with:
- **Model Management**: Load, activate, and rollback model versions
- **Batch Prediction**: High-performance inference with latency tracking
- **Metrics Collection**: Real-time performance metrics
- **Error Handling**: Automatic rollback on high error rates

### Directory Structure
```
models/
├── model_v1234567890/
│   ├── model.pkl          # Pickled model
│   └── metadata.json      # Version metadata
├── model_v1234567891/
│   ├── model.pkl
│   └── metadata.json
└── active/                # Symlink to active version
    ├── model.pkl
    └── metadata.json
```

## Usage

### Installation
```bash
pip install -r requirements.txt
```

### Running the Server
```bash
python -m uvicorn src.model_server:app --host 0.0.0.0 --port 8001
```

### Example API Calls

#### Batch Prediction
```bash
curl -X POST http://localhost:8001/predict/batch \
  -H "Content-Type: application/json" \
  -d '{
    "predictions": [
      {
        "player_id": "player_1",
        "game_type": "texas_holdem",
        "features": [0.1, 0.2, 0.3]
      },
      {
        "player_id": "player_2",
        "game_type": "poker",
        "features": [0.4, 0.5, 0.6]
      }
    ]
  }'
```

#### List Models
```bash
curl http://localhost:8001/models
```

#### Activate Model
```bash
curl -X POST http://localhost:8001/models/activate/model_v1234567891
```

#### Health Check
```bash
curl http://localhost:8001/health
```

#### Get Metrics
```bash
curl http://localhost:8001/metrics
```

## Model Format

Models should be sklearn-compatible with:
- `predict(X)` - Return class predictions
- `predict_proba(X)` - Return class probabilities (for confidence scores)

## Configuration

### Model Directory
By default, models are stored in `services/model-server/models/`. Override with:
```python
server = ModelServer(models_dir="/custom/path")
```

### Auto-rollback Threshold
Default error rate threshold is 5%. Check with:
```python
server.check_error_rate_and_rollback(threshold=5.0)
```

## Testing

Run tests with pytest:
```bash
pytest tests/test_model_server.py -v
```

Test coverage includes:
1. Batch prediction performance (<50ms for 100 players)
2. Model accuracy tracking
3. Model versioning and activation
4. Automatic rollback on high error rates
5. Health and metrics endpoints
6. Latency percentile tracking (p50, p99)

## Performance Characteristics

- **Batch Prediction**: <50ms for 100 players (typical)
- **Model Load Time**: <1s at startup
- **Memory**: ~200-500MB per model (depending on size)
- **Latency Tracking**: Maintains last 10,000 samples
- **Accuracy Tracking**: Maintains last 1,000 samples

## Monitoring

### Health Status
- `status`: "healthy" or "degraded"
- `model_loaded`: Boolean indicating if model is ready
- `model_version`: Currently active model version
- `error_rate_percent`: Current prediction error rate
- `total_predictions`: Cumulative predictions served

### Metrics
- `total_predictions`: Count of all predictions
- `error_rate`: Current error rate percentage
- `latency_metrics`: p50, p99, mean, min, max in milliseconds
- `accuracy`: Current accuracy if tracked
- `model_version`: Active model version

## Error Handling

The server automatically:
1. Tracks error rate across predictions
2. Monitors latency for performance degradation
3. Can rollback to previous version if error rate exceeds threshold
4. Provides detailed error responses with HTTP status codes

## Production Deployment

1. Store models in persistent storage (not temporary directories)
2. Configure monitoring to alert on:
   - Error rate > 5%
   - p99 latency > 100ms
   - Model not loaded
3. Set up automatic health checks to `/health` endpoint
4. Configure CI/CD to validate new model versions before deployment

## Future Enhancements

- Model A/B testing
- Gradual rollout (canary deployment)
- Model performance comparison
- Feature importance tracking
- Real-time model evaluation against ground truth
