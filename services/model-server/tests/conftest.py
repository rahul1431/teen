"""Pytest configuration and fixtures."""

import pytest
import os
import sys
import tempfile
import shutil
import json
import pickle
import numpy as np
from pathlib import Path

# Add src directory to path for imports
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'src'))

from model_server import ModelServer, app


# Simple model class for testing that can be pickled
class SimpleModel:
    """Simple model for testing purposes."""

    def predict(self, X):
        """Return random predictions."""
        if isinstance(X, list):
            X = np.array(X)
        return np.random.rand(len(X))

    def predict_proba(self, X):
        """Return random class probabilities."""
        if isinstance(X, list):
            X = np.array(X)
        proba = np.column_stack([
            np.random.rand(len(X)),
            np.random.rand(len(X))
        ])
        # Normalize to sum to 1
        proba = proba / proba.sum(axis=1, keepdims=True)
        return proba


@pytest.fixture(scope="session")
def temp_models_dir():
    """Create a temporary models directory for the entire test session."""
    temp_dir = tempfile.mkdtemp()
    yield temp_dir
    if os.path.exists(temp_dir):
        shutil.rmtree(temp_dir)


@pytest.fixture(autouse=True)
def setup_model_server(temp_models_dir):
    """Set up model server with a test model for each test."""
    # Create a test model
    model = SimpleModel()

    # Create a model version directory
    version = "model_v1234567890"
    version_dir = os.path.join(temp_models_dir, version)
    os.makedirs(version_dir, exist_ok=True)

    # Save the model
    model_path = os.path.join(version_dir, "model.pkl")
    with open(model_path, "wb") as f:
        pickle.dump(model, f)

    # Save metadata
    metadata = {
        "version": version,
        "timestamp": 1234567890,
        "accuracy": 0.85,
        "error_rate": 0.02,
        "created_at": "2024-01-01T00:00:00"
    }
    metadata_path = os.path.join(version_dir, "metadata.json")
    with open(metadata_path, "w") as f:
        json.dump(metadata, f)

    # Create active link
    active_link = os.path.join(temp_models_dir, "active")
    try:
        if os.path.exists(active_link):
            if os.path.islink(active_link):
                os.unlink(active_link)
            else:
                shutil.rmtree(active_link)
        os.symlink(version_dir, active_link, target_is_directory=True)
    except OSError:
        # Windows fallback
        if os.path.exists(active_link):
            shutil.rmtree(active_link)
        shutil.copytree(version_dir, active_link)

    # Reinitialize the global model server with this temp dir
    import model_server
    model_server.model_server = ModelServer(models_dir=temp_models_dir)

    yield

    # Cleanup
    if os.path.exists(temp_models_dir):
        try:
            shutil.rmtree(temp_models_dir)
        except Exception:
            pass
