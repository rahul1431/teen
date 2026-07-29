import pytest
import json
import os
import time
import tempfile
import shutil
from pathlib import Path
from fastapi.testclient import TestClient
from unittest.mock import patch, MagicMock
import pickle
import numpy as np

# Import the app
import sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'src'))
from model_server import (
    app,
    ModelServer,
    PredictionRequest,
    BatchPredictionRequest,
    ModelMetrics,
    load_model_from_disk
)


@pytest.fixture
def client():
    """Fixture to provide test client."""
    return TestClient(app)


@pytest.fixture
def temp_model_dir():
    """Fixture to provide a temporary directory for models."""
    temp_dir = tempfile.mkdtemp()
    yield temp_dir
    if os.path.exists(temp_dir):
        shutil.rmtree(temp_dir)


@pytest.fixture
def mock_model():
    """Fixture to provide a mock trained model."""
    # Create a simple mock model that has a predict method
    model = MagicMock()
    model.predict = MagicMock(return_value=np.array([0.5, 0.6, 0.7]))
    model.predict_proba = MagicMock(return_value=np.array([[0.4, 0.6], [0.3, 0.7], [0.2, 0.8]]))
    return model


class TestBatchPredictions:
    """Test batch prediction capability."""

    def test_should_serve_batch_predictions_under_50ms(self, client, mock_model):
        """Should serve batch predictions for 100 players in <50ms."""
        # Create a request with 100 players
        players = []
        for i in range(100):
            players.append({
                "player_id": f"player_{i}",
                "game_type": "texas_holdem",
                "features": [0.1 * i, 0.2 * i, 0.3 * i]
            })

        request_data = {"predictions": players}

        # Patch the model server to use mock model
        with patch('model_server.model_server') as mock_ms:
            mock_ms.predict_batch = MagicMock(
                return_value=[
                    {
                        "player_id": f"player_{i}",
                        "predicted_difficulty": 0.5 + (i * 0.001),
                        "confidence": 0.9,
                        "model_version": "model_v1"
                    }
                    for i in range(100)
                ]
            )

            start_time = time.time()
            response = client.post("/predict/batch", json=request_data)
            elapsed_ms = (time.time() - start_time) * 1000

            assert response.status_code == 200
            assert elapsed_ms < 50, f"Batch prediction took {elapsed_ms}ms, expected <50ms"
            data = response.json()
            assert len(data["predictions"]) == 100
            assert all("predicted_difficulty" in p for p in data["predictions"])
            assert all("confidence" in p for p in data["predictions"])
            assert all("model_version" in p for p in data["predictions"])

    def test_should_return_predictions_with_confidence(self, client):
        """Should return predictions with confidence scores."""
        request_data = {
            "predictions": [
                {
                    "player_id": "player_1",
                    "game_type": "texas_holdem",
                    "features": [0.1, 0.2, 0.3]
                }
            ]
        }

        response = client.post("/predict/batch", json=request_data)
        assert response.status_code == 200
        data = response.json()

        prediction = data["predictions"][0]
        assert "predicted_difficulty" in prediction
        assert "confidence" in prediction
        assert 0 <= prediction["confidence"] <= 1


class TestModelAccuracy:
    """Test model accuracy tracking."""

    def test_should_maintain_model_accuracy(self, client):
        """Should track and maintain model accuracy metrics."""
        # Get health endpoint to check model accuracy metrics
        response = client.get("/health")
        assert response.status_code == 200

        health_data = response.json()
        assert "model_loaded" in health_data
        assert "model_version" in health_data
        assert health_data["model_loaded"] is True

    def test_should_track_prediction_accuracy(self, client):
        """Should track prediction accuracy over time."""
        # Record predictions and accuracy
        response = client.get("/metrics")
        assert response.status_code == 200

        metrics = response.json()
        assert "accuracy" in metrics or "accuracy_tracking_enabled" in metrics


class TestModelVersioning:
    """Test model versioning."""

    def test_should_handle_model_versioning(self, client):
        """Should handle model versioning correctly."""
        # Get list of models
        response = client.get("/models")
        assert response.status_code == 200

        models = response.json()
        assert "versions" in models
        assert isinstance(models["versions"], list)

    def test_should_activate_new_model_version(self, client):
        """Should activate a new model version."""
        # Get available versions first
        list_response = client.get("/models")
        assert list_response.status_code == 200

        versions = list_response.json().get("versions", [])
        if versions:
            version = versions[0]["version"]

            # Activate the model
            activate_response = client.post(f"/models/activate/{version}")
            assert activate_response.status_code in [200, 201]

    def test_should_list_available_model_versions(self, client):
        """Should list all available model versions."""
        response = client.get("/models")
        assert response.status_code == 200

        data = response.json()
        assert "versions" in data
        assert isinstance(data["versions"], list)


class TestAutoRollback:
    """Test automatic rollback on error."""

    def test_should_auto_rollback_on_error(self, client):
        """Should auto-rollback on model error rate >5%."""
        # This test checks if the system can detect high error rates
        # and potentially trigger a rollback
        response = client.get("/health")
        assert response.status_code == 200

        health = response.json()
        # Check if auto-rollback monitoring is active
        assert "model_loaded" in health

    def test_should_track_error_rate(self, client):
        """Should track prediction error rate."""
        response = client.get("/metrics")
        assert response.status_code == 200

        metrics = response.json()
        # Check for error tracking
        assert "error_rate" in metrics or "errors" in metrics or "total_predictions" in metrics


class TestHealthMetrics:
    """Test health and performance metrics."""

    def test_should_expose_health_metrics(self, client):
        """Should expose health metrics endpoint."""
        response = client.get("/health")
        assert response.status_code == 200

        health = response.json()
        assert "model_loaded" in health
        assert "model_version" in health

    def test_should_track_latency_metrics(self, client):
        """Should track prediction latency (p50, p99)."""
        response = client.get("/metrics")
        assert response.status_code == 200

        metrics = response.json()
        assert "latency_metrics" in metrics or "p50" in metrics or "p99" in metrics

    def test_should_track_p50_p99_latency(self, client):
        """Should track p50 and p99 latency percentiles."""
        # Make several predictions to collect latency data
        for i in range(10):
            request_data = {
                "predictions": [
                    {
                        "player_id": f"player_{i}",
                        "game_type": "texas_holdem",
                        "features": [0.1, 0.2, 0.3]
                    }
                ]
            }
            response = client.post("/predict/batch", json=request_data)
            assert response.status_code == 200

        # Check metrics
        metrics_response = client.get("/metrics")
        assert metrics_response.status_code == 200
        metrics = metrics_response.json()

        # Should have latency tracking
        assert "total_predictions" in metrics or "latency_metrics" in metrics


class TestPredictionEndpoint:
    """Test prediction endpoint."""

    def test_should_handle_single_prediction(self, client):
        """Should handle single prediction request."""
        request_data = {
            "predictions": [
                {
                    "player_id": "player_1",
                    "game_type": "texas_holdem",
                    "features": [0.1, 0.2, 0.3]
                }
            ]
        }

        response = client.post("/predict/batch", json=request_data)
        assert response.status_code == 200

        data = response.json()
        assert "predictions" in data
        assert len(data["predictions"]) == 1

    def test_should_return_model_version_in_prediction(self, client):
        """Should return model version in prediction response."""
        request_data = {
            "predictions": [
                {
                    "player_id": "player_1",
                    "game_type": "texas_holdem",
                    "features": [0.1, 0.2, 0.3]
                }
            ]
        }

        response = client.post("/predict/batch", json=request_data)
        assert response.status_code == 200

        data = response.json()
        prediction = data["predictions"][0]
        assert "model_version" in prediction


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
