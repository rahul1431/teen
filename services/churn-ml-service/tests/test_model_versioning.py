import pytest
import os
import json
import pickle
import tempfile
import pandas as pd
from pathlib import Path
from sklearn.ensemble import RandomForestClassifier
from sklearn.model_selection import train_test_split, cross_val_score
import sys
from unittest.mock import MagicMock

# Add parent directory to path for imports
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from model_versioning import (
    save_model_versioned,
    activate_model,
    rollback_model,
    list_model_versions,
    cleanup_old_versions,
)


@pytest.fixture
def temp_models_dir():
    """Create a temporary directory for models."""
    with tempfile.TemporaryDirectory() as tmpdir:
        yield tmpdir


@pytest.fixture
def trained_model_result():
    """Create a mock trained model result with good accuracy."""
    # Create synthetic training data
    data = {
        'days_since_deposit': [1.0, 2.0, 15.0, 20.0, 3.0, 18.0, 5.0, 25.0, 10.0, 12.0,
                               4.0, 8.0, 22.0, 7.0, 14.0, 30.0, 2.0, 16.0, 9.0, 11.0,
                               6.0, 19.0, 13.0, 24.0, 17.0],
        'total_deposits': [5.0, 3.0, 1.0, 0.0, 10.0, 1.0, 2.0, 0.0, 8.0, 4.0,
                           6.0, 2.0, 0.0, 5.0, 3.0, 0.0, 7.0, 1.0, 4.0, 2.0,
                           3.0, 0.0, 6.0, 1.0, 5.0],
        'deposits_last_14': [2.0, 1.0, 0.0, 0.0, 4.0, 0.0, 1.0, 0.0, 3.0, 2.0,
                             2.0, 1.0, 0.0, 2.0, 1.0, 0.0, 3.0, 0.0, 2.0, 1.0,
                             1.0, 0.0, 2.0, 0.0, 2.0],
        'deposits_prior_14': [2.0, 1.0, 1.0, 0.0, 3.0, 1.0, 1.0, 0.0, 2.0, 1.0,
                              2.0, 1.0, 0.0, 2.0, 1.0, 0.0, 2.0, 1.0, 1.0, 1.0,
                              1.0, 0.0, 2.0, 1.0, 2.0],
        'total_games': [20.0, 15.0, 2.0, 0.0, 50.0, 1.0, 30.0, 0.0, 25.0, 10.0,
                        22.0, 18.0, 1.0, 25.0, 12.0, 0.0, 28.0, 5.0, 20.0, 15.0,
                        24.0, 3.0, 30.0, 2.0, 20.0],
        'net_profit': [150.0, -50.0, -10.0, 0.0, 500.0, -20.0, 200.0, 0.0, 100.0, -30.0,
                       180.0, -40.0, -5.0, 120.0, 50.0, 0.0, 220.0, -15.0, 90.0, -20.0,
                       160.0, 10.0, 240.0, -10.0, 140.0],
        'churned': [0, 0, 1, 1, 0, 1, 0, 1, 0, 1,
                    0, 0, 1, 0, 1, 1, 0, 1, 0, 0,
                    0, 1, 0, 1, 0]
    }
    df = pd.DataFrame(data)
    X = df[['days_since_deposit', 'total_deposits', 'deposits_last_14', 'deposits_prior_14', 'total_games', 'net_profit']]
    y = df['churned']

    # Train model with train/test split and cross-validation
    X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42, stratify=y)
    model = RandomForestClassifier(n_estimators=100, max_depth=10, random_state=42)
    model.fit(X_train, y_train)

    # Compute metrics
    train_accuracy = float(model.score(X_train, y_train))
    test_accuracy = float(model.score(X_test, y_test))
    cv_scores = cross_val_score(model, X, y, cv=5)
    cv_mean = float(cv_scores.mean())
    cv_std = float(cv_scores.std())

    # Create mock result object
    result = MagicMock()
    result.model = model
    result.train_accuracy = train_accuracy
    result.test_accuracy = test_accuracy
    result.cv_scores = cv_scores
    result.cv_mean = cv_mean
    result.cv_std = cv_std

    return result


@pytest.fixture
def low_accuracy_model_result():
    """Create a mock model with low accuracy (< 0.65)."""
    result = MagicMock()
    result.model = RandomForestClassifier()
    result.train_accuracy = 0.60
    result.test_accuracy = 0.55  # Below threshold
    result.cv_scores = [0.55, 0.56, 0.54, 0.55, 0.56]
    result.cv_mean = 0.552
    result.cv_std = 0.008

    return result


def test_save_model_versioned(temp_models_dir, trained_model_result, monkeypatch):
    """
    Test 1: test_save_model_versioned
    Verify that a model is saved with version directory, model.pkl, and metadata.json
    """
    # Mock the models directory
    monkeypatch.setattr("model_versioning.MODELS_DIR", temp_models_dir)

    # Save the model
    version = save_model_versioned(
        model=trained_model_result.model,
        train_acc=trained_model_result.train_accuracy,
        test_acc=trained_model_result.test_accuracy,
        cv_mean=trained_model_result.cv_mean,
        cv_std=trained_model_result.cv_std
    )

    # Verify version is not None
    assert version is not None, "save_model_versioned should return a version"

    # Verify version directory exists
    version_dir = os.path.join(temp_models_dir, version)
    assert os.path.isdir(version_dir), f"Version directory {version_dir} should exist"

    # Verify model.pkl exists
    model_path = os.path.join(version_dir, "model.pkl")
    assert os.path.isfile(model_path), f"model.pkl should exist at {model_path}"

    # Verify metadata.json exists
    metadata_path = os.path.join(version_dir, "metadata.json")
    assert os.path.isfile(metadata_path), f"metadata.json should exist at {metadata_path}"

    # Verify metadata contents
    with open(metadata_path, 'r') as f:
        metadata = json.load(f)

    assert metadata['train_accuracy'] == trained_model_result.train_accuracy
    assert metadata['test_accuracy'] == trained_model_result.test_accuracy
    assert metadata['cv_mean'] == trained_model_result.cv_mean
    assert metadata['cv_std'] == trained_model_result.cv_std
    assert 'timestamp' in metadata


def test_model_rejected_if_test_accuracy_low(temp_models_dir, low_accuracy_model_result, monkeypatch):
    """
    Test 2: test_model_rejected_if_test_accuracy_low
    Verify that a model with test_accuracy < 0.65 is rejected and not saved
    """
    # Mock the models directory
    monkeypatch.setattr("model_versioning.MODELS_DIR", temp_models_dir)

    # Try to save model with low accuracy - should raise ValueError
    with pytest.raises(ValueError) as exc_info:
        save_model_versioned(
            model=low_accuracy_model_result.model,
            train_acc=low_accuracy_model_result.train_accuracy,
            test_acc=low_accuracy_model_result.test_accuracy,
            cv_mean=low_accuracy_model_result.cv_mean,
            cv_std=low_accuracy_model_result.cv_std
        )

    # Verify the error message
    assert "test_accuracy" in str(exc_info.value).lower()
    assert "0.65" in str(exc_info.value)

    # Verify no files were created
    assert len(os.listdir(temp_models_dir)) == 0, "No model should be saved for low accuracy"


def test_activate_model(temp_models_dir, trained_model_result, monkeypatch):
    """
    Test 3: test_activate_model
    Verify that activate_model creates a symlink to the active model
    """
    # Mock the models directory
    monkeypatch.setattr("model_versioning.MODELS_DIR", temp_models_dir)

    # Save a model first
    version = save_model_versioned(
        model=trained_model_result.model,
        train_acc=trained_model_result.train_accuracy,
        test_acc=trained_model_result.test_accuracy,
        cv_mean=trained_model_result.cv_mean,
        cv_std=trained_model_result.cv_std
    )

    # Activate the model
    activate_model(version)

    # Verify the active model symlink exists
    active_link = os.path.join(temp_models_dir, "active")
    assert os.path.islink(active_link) or os.path.isdir(active_link), f"Active link should exist at {active_link}"

    # Verify the active link points to the correct version
    if os.path.islink(active_link):
        target = os.readlink(active_link)
        assert version in target, f"Active link should point to {version}"


def test_rollback_model(temp_models_dir, trained_model_result, monkeypatch):
    """
    Test 4: test_rollback_model
    Verify that rollback_model reverts to a previous version
    """
    # Mock the models directory
    monkeypatch.setattr("model_versioning.MODELS_DIR", temp_models_dir)

    # Save and activate first model
    version1 = save_model_versioned(
        model=trained_model_result.model,
        train_acc=trained_model_result.train_accuracy,
        test_acc=trained_model_result.test_accuracy,
        cv_mean=trained_model_result.cv_mean,
        cv_std=trained_model_result.cv_std
    )
    activate_model(version1)

    # Modify the model slightly and save as version 2
    import time
    time.sleep(0.1)  # Ensure different timestamp

    version2 = save_model_versioned(
        model=trained_model_result.model,
        train_acc=0.75,
        test_acc=0.72,
        cv_mean=0.73,
        cv_std=0.02
    )
    activate_model(version2)

    # Verify version2 is active
    active_link = os.path.join(temp_models_dir, "active")
    if os.path.islink(active_link):
        target = os.readlink(active_link)
        assert version2 in target

    # Rollback to version1
    rollback_model(version1)

    # Verify version1 is now active
    if os.path.islink(active_link):
        target = os.readlink(active_link)
        assert version1 in target, f"Active link should point to {version1} after rollback"


def test_list_model_versions(temp_models_dir, trained_model_result, monkeypatch):
    """
    Test listing model versions
    """
    # Mock the models directory
    monkeypatch.setattr("model_versioning.MODELS_DIR", temp_models_dir)

    # Save multiple models
    version1 = save_model_versioned(
        model=trained_model_result.model,
        train_acc=trained_model_result.train_accuracy,
        test_acc=trained_model_result.test_accuracy,
        cv_mean=trained_model_result.cv_mean,
        cv_std=trained_model_result.cv_std
    )

    import time
    time.sleep(0.1)

    version2 = save_model_versioned(
        model=trained_model_result.model,
        train_acc=0.75,
        test_acc=0.72,
        cv_mean=0.73,
        cv_std=0.02
    )

    # List versions
    versions = list_model_versions()

    # Verify both versions are in the list
    assert len(versions) >= 2, "Should have at least 2 versions"
    version_names = [v['version'] for v in versions]
    assert version1 in version_names
    assert version2 in version_names


def test_cleanup_old_versions(temp_models_dir, trained_model_result, monkeypatch):
    """
    Test cleanup of old versions
    """
    # Mock the models directory
    monkeypatch.setattr("model_versioning.MODELS_DIR", temp_models_dir)

    # Save multiple models
    versions = []
    for i in range(7):
        version = save_model_versioned(
            model=trained_model_result.model,
            train_acc=0.65 + (i * 0.01),
            test_acc=0.66 + (i * 0.01),
            cv_mean=0.65 + (i * 0.01),
            cv_std=0.02
        )
        versions.append(version)
        import time
        time.sleep(0.05)

    # Cleanup keeping only 5 versions
    cleanup_old_versions(keep_count=5)

    # Verify that only 5 versions remain
    remaining_versions = list_model_versions(limit=10)
    assert len(remaining_versions) <= 5, "Should have at most 5 versions after cleanup"
