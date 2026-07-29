import os
import pickle
import json
import logging
import shutil
from typing import Optional, List, Dict, Any
from datetime import datetime
from pathlib import Path

logger = logging.getLogger("churn-ml-service")

# Base directory for storing versioned models
MODELS_DIR = os.path.join(os.path.dirname(__file__), "models")


def _ensure_models_dir():
    """Ensure models directory exists."""
    os.makedirs(MODELS_DIR, exist_ok=True)


def save_model_versioned(
    model: Any,
    train_acc: float,
    test_acc: float,
    cv_mean: float,
    cv_std: float
) -> Optional[str]:
    """
    Save a model in a versioned directory with metadata.

    Args:
        model: The trained sklearn model
        train_acc: Training accuracy
        test_acc: Test accuracy
        cv_mean: Cross-validation mean score
        cv_std: Cross-validation standard deviation

    Returns:
        Version string (e.g., "model_v1234567890.123") if successful and test_acc >= 0.65
        Raises ValueError if test_acc < 0.65

    Raises:
        ValueError: If test_accuracy < 0.65 (quality gate check)
    """
    # Quality gate: reject if test_accuracy < 0.65
    if test_acc < 0.65:
        raise ValueError(
            f"Model quality gate failed: test_accuracy ({test_acc:.4f}) < 0.65 threshold"
        )

    _ensure_models_dir()

    # Create version directory with timestamp
    timestamp = datetime.now().timestamp()
    version = f"model_v{timestamp}"
    version_dir = os.path.join(MODELS_DIR, version)

    # Create the version directory
    os.makedirs(version_dir, exist_ok=True)

    try:
        # Save model
        model_path = os.path.join(version_dir, "model.pkl")
        with open(model_path, "wb") as f:
            pickle.dump(model, f)

        # Save metadata
        metadata = {
            "version": version,
            "timestamp": timestamp,
            "train_accuracy": train_acc,
            "test_accuracy": test_acc,
            "cv_mean": cv_mean,
            "cv_std": cv_std,
            "created_at": datetime.now().isoformat()
        }

        metadata_path = os.path.join(version_dir, "metadata.json")
        with open(metadata_path, "w") as f:
            json.dump(metadata, f, indent=2)

        logger.info(
            f"Model saved: version={version}, train_acc={train_acc:.4f}, "
            f"test_acc={test_acc:.4f}, cv_mean={cv_mean:.4f}, cv_std={cv_std:.4f}"
        )

        return version

    except Exception as e:
        # Clean up on failure
        if os.path.exists(version_dir):
            shutil.rmtree(version_dir)
        logger.error(f"Failed to save model version {version}: {e}")
        raise


def activate_model(version: str) -> None:
    """
    Activate a model by creating a symlink to the versioned directory.

    Args:
        version: Version string (e.g., "model_v1234567890.123")

    Raises:
        FileNotFoundError: If version directory does not exist
    """
    _ensure_models_dir()

    version_dir = os.path.join(MODELS_DIR, version)

    if not os.path.isdir(version_dir):
        raise FileNotFoundError(f"Model version {version} not found at {version_dir}")

    active_link = os.path.join(MODELS_DIR, "active")

    try:
        # Remove existing active link/directory if it exists
        if os.path.lexists(active_link):
            try:
                if os.path.islink(active_link):
                    os.unlink(active_link)
                else:
                    shutil.rmtree(active_link)
            except OSError as e:
                # On Windows, sometimes symlinks report as directories
                # Try unlinking first, then fallback to rmtree
                try:
                    os.unlink(active_link)
                except OSError:
                    shutil.rmtree(active_link, ignore_errors=True)

        # Create new symlink
        try:
            os.symlink(version_dir, active_link, target_is_directory=True)
        except OSError as e:
            # On Windows, if symlink creation fails (e.g., due to permissions),
            # try creating a junction using subprocess
            if os.name == 'nt':
                try:
                    import subprocess
                    # Try mklink on Windows
                    subprocess.run(
                        ["mklink", "/J", active_link, version_dir],
                        shell=True,
                        check=True,
                        capture_output=True
                    )
                except Exception as junction_error:
                    logger.warning(f"Failed to create junction link: {junction_error}")
                    # Last fallback: just create a copy of model files
                    if os.path.exists(active_link):
                        shutil.rmtree(active_link)
                    shutil.copytree(version_dir, active_link)
            else:
                raise

        logger.info(f"Model activated: version={version}")

    except Exception as e:
        logger.error(f"Failed to activate model version {version}: {e}")
        raise


def rollback_model(version: str) -> None:
    """
    Rollback to a previous model version by updating the active symlink.

    Args:
        version: Version string to rollback to

    Raises:
        FileNotFoundError: If version directory does not exist
    """
    activate_model(version)
    logger.info(f"Model rolled back to version: {version}")


def list_model_versions(limit: int = 10) -> List[Dict[str, Any]]:
    """
    List available model versions sorted by creation time (newest first).

    Args:
        limit: Maximum number of versions to return

    Returns:
        List of dicts with version metadata
    """
    _ensure_models_dir()

    versions = []

    # Iterate through all directories in MODELS_DIR
    try:
        for item in os.listdir(MODELS_DIR):
            if item == "active" or not item.startswith("model_v"):
                continue

            version_dir = os.path.join(MODELS_DIR, item)
            if not os.path.isdir(version_dir):
                continue

            # Read metadata
            metadata_path = os.path.join(version_dir, "metadata.json")
            if os.path.isfile(metadata_path):
                try:
                    with open(metadata_path, "r") as f:
                        metadata = json.load(f)
                    versions.append(metadata)
                except Exception as e:
                    logger.warning(f"Failed to read metadata for {item}: {e}")

    except Exception as e:
        logger.error(f"Failed to list model versions: {e}")

    # Sort by timestamp (descending - newest first)
    versions.sort(key=lambda x: x.get("timestamp", 0), reverse=True)

    return versions[:limit]


def cleanup_old_versions(keep_count: int = 5) -> None:
    """
    Delete old model versions, keeping only the most recent ones.

    Args:
        keep_count: Number of recent versions to keep
    """
    _ensure_models_dir()

    try:
        versions = list_model_versions(limit=None)

        # If we have more versions than we want to keep, delete the oldest ones
        if len(versions) > keep_count:
            versions_to_delete = versions[keep_count:]

            for version_info in versions_to_delete:
                version = version_info["version"]
                version_dir = os.path.join(MODELS_DIR, version)

                if os.path.isdir(version_dir):
                    try:
                        shutil.rmtree(version_dir)
                        logger.info(f"Deleted old model version: {version}")
                    except Exception as e:
                        logger.error(f"Failed to delete model version {version}: {e}")

    except Exception as e:
        logger.error(f"Failed to cleanup old versions: {e}")


def get_active_model_path() -> Optional[str]:
    """
    Get the path to the currently active model.

    Returns:
        Path to active model.pkl if it exists, None otherwise
    """
    _ensure_models_dir()

    active_link = os.path.join(MODELS_DIR, "active")

    if os.path.islink(active_link) or os.path.isdir(active_link):
        model_path = os.path.join(active_link, "model.pkl")
        if os.path.isfile(model_path):
            return model_path

    return None


def get_active_model_metadata() -> Optional[Dict[str, Any]]:
    """
    Get the metadata of the currently active model.

    Returns:
        Metadata dict if available, None otherwise
    """
    _ensure_models_dir()

    active_link = os.path.join(MODELS_DIR, "active")

    if os.path.islink(active_link) or os.path.isdir(active_link):
        metadata_path = os.path.join(active_link, "metadata.json")
        if os.path.isfile(metadata_path):
            try:
                with open(metadata_path, "r") as f:
                    return json.load(f)
            except Exception as e:
                logger.error(f"Failed to read active model metadata: {e}")

    return None
