import pytest
import sys
import os
from unittest.mock import patch, MagicMock

# Add parent directory to path so we can import synthetic_data
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pandas as pd
import numpy as np

# Mock psycopg2 before importing synthetic_data
sys.modules['psycopg2'] = MagicMock()

from synthetic_data import (
    generate_synthetic_training_data,
    validate_synthetic_data,
    get_empirical_distribution
)


class TestSyntheticDataGeneration:
    """Test synthetic data generation functionality"""

    def test_synthetic_data_generation(self):
        """Verify synthetic data generation produces correct shape and no NaN values"""
        n_samples = 100
        data = generate_synthetic_training_data(n_samples)

        # Should return a DataFrame
        assert isinstance(data, pd.DataFrame)

        # Should have correct number of rows
        assert len(data) == n_samples

        # Should have all required columns
        required_columns = [
            'days_since_deposit',
            'total_deposits',
            'deposits_last_14',
            'deposits_prior_14',
            'total_games',
            'net_profit',
            'churned'
        ]
        for col in required_columns:
            assert col in data.columns, f"Missing column: {col}"

        # Should have no NaN values
        assert not data.isnull().any().any(), "Synthetic data contains NaN values"

    def test_synthetic_data_ranges(self):
        """Verify feature ranges are reasonable and realistic"""
        n_samples = 200
        data = generate_synthetic_training_data(n_samples)

        # Days since deposit should be positive
        assert (data['days_since_deposit'] >= 0).all(), "days_since_deposit has negative values"

        # Total deposits should be non-negative integers
        assert (data['total_deposits'] >= 0).all(), "total_deposits has negative values"
        assert data['total_deposits'].dtype in [np.int32, np.int64, float], "total_deposits wrong dtype"

        # Deposits in periods should be <= total deposits
        assert (data['deposits_last_14'] <= data['total_deposits']).all(), \
            "deposits_last_14 exceeds total_deposits"
        assert (data['deposits_prior_14'] <= data['total_deposits']).all(), \
            "deposits_prior_14 exceeds total_deposits"

        # Total games should be non-negative integers
        assert (data['total_games'] >= 0).all(), "total_games has negative values"

        # Net profit can be negative or positive
        # Just check it's a reasonable number (not Inf or huge outliers)
        assert np.isfinite(data['net_profit']).all(), "net_profit contains Inf or NaN"

        # Churned should be binary (0 or 1)
        assert set(data['churned'].unique()).issubset({0, 1}), "churned not binary"

    def test_synthetic_data_validation_accepts_valid_data(self):
        """Test that validation accepts valid synthetic data"""
        data = generate_synthetic_training_data(50)

        # Should validate successfully
        is_valid, errors = validate_synthetic_data(data)
        assert is_valid, f"Valid data failed validation: {errors}"
        assert errors == [], f"Valid data has errors: {errors}"

    def test_synthetic_data_validation_rejects_nan(self):
        """Test that validation rejects data with NaN values"""
        data = generate_synthetic_training_data(50)

        # Introduce NaN
        data.loc[0, 'net_profit'] = np.nan

        # Should reject
        is_valid, errors = validate_synthetic_data(data)
        assert not is_valid, "Validation should reject data with NaN"
        assert len(errors) > 0, "Should have error messages"


class TestEmpiricalDistribution:
    """Test empirical distribution querying"""

    def test_get_empirical_distribution_returns_dict(self):
        """Verify get_empirical_distribution returns a dictionary"""
        result = get_empirical_distribution()

        assert isinstance(result, dict), "Should return a dictionary"
        # Should have keys for each feature's distribution parameters
        assert len(result) > 0, "Distribution dict should not be empty"


class TestIntegration:
    """Integration tests"""

    def test_full_workflow(self):
        """Test the full workflow: get empirical distribution, generate data, validate"""
        # Get empirical distribution
        empirical = get_empirical_distribution()
        assert isinstance(empirical, dict)

        # Generate synthetic data
        n_samples = 50
        data = generate_synthetic_training_data(n_samples)
        assert len(data) == n_samples

        # Validate synthetic data
        is_valid, errors = validate_synthetic_data(data)
        assert is_valid, f"Generated data failed validation: {errors}"

        # Verify data can be used for training (has all expected columns)
        feature_cols = [
            'days_since_deposit',
            'total_deposits',
            'deposits_last_14',
            'deposits_prior_14',
            'total_games',
            'net_profit'
        ]
        for col in feature_cols:
            assert col in data.columns
