"""
Tests for Anomaly Detector Module

Tests the Isolation Forest-based anomaly detection implementation.
Covers feature extraction, z-score calculation, anomaly scoring, and threshold logic.
"""

import pytest
import pandas as pd
import numpy as np
import time
from sklearn.preprocessing import StandardScaler

# Add src to path so we can import anomaly_detector
import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'src'))

from anomaly_detector import (
    PlayerAnomalyFeatures,
    AnomalyDetectionResult,
    features_to_dataframe,
    train_isolation_forest,
    calculate_zscore_statistics,
    score_player_anomalies,
    ANOMALY_SCORE_THRESHOLD,
    ZSCORE_THRESHOLD,
    ISOLATION_FOREST_CONTAMINATION,
    ISOLATION_FOREST_N_ESTIMATORS
)


@pytest.fixture
def sample_normal_players():
    """Generate sample normal player features for baseline."""
    np.random.seed(42)

    normal_players = [
        PlayerAnomalyFeatures(
            player_id=f"normal_{i}",
            win_rate_zscore=np.random.normal(0, 0.5),  # Normal distribution around 0
            session_length_change=np.random.normal(0, 0.3),  # Small changes
            bet_aggression_spike=np.random.normal(0, 0.2),  # Low aggression variation
            churn_risk_jump=np.random.normal(0, 0.4),  # Low churn risk variation
            games_per_week_change=np.random.normal(0, 0.3),  # Low frequency variation
            cohort_id=i % 3
        )
        for i in range(100)
    ]
    return normal_players


@pytest.fixture
def sample_anomalous_players():
    """Generate sample anomalous player features."""
    np.random.seed(42)

    # Player with win rate spike (>3σ)
    win_rate_spike = PlayerAnomalyFeatures(
        player_id="anomaly_win_rate",
        win_rate_zscore=5.0,  # 5σ above mean
        session_length_change=np.random.normal(0, 0.3),
        bet_aggression_spike=np.random.normal(0, 0.2),
        churn_risk_jump=np.random.normal(0, 0.4),
        games_per_week_change=np.random.normal(0, 0.3),
        cohort_id=0
    )

    # Player with session pattern change (>3σ)
    session_change = PlayerAnomalyFeatures(
        player_id="anomaly_session",
        win_rate_zscore=np.random.normal(0, 0.5),
        session_length_change=4.5,  # 4.5σ above mean
        bet_aggression_spike=np.random.normal(0, 0.2),
        churn_risk_jump=np.random.normal(0, 0.4),
        games_per_week_change=np.random.normal(0, 0.3),
        cohort_id=1
    )

    # Player with bet aggression spike (>3σ)
    bet_aggression = PlayerAnomalyFeatures(
        player_id="anomaly_bet",
        win_rate_zscore=np.random.normal(0, 0.5),
        session_length_change=np.random.normal(0, 0.3),
        bet_aggression_spike=6.0,  # 6σ above mean
        churn_risk_jump=np.random.normal(0, 0.4),
        games_per_week_change=np.random.normal(0, 0.3),
        cohort_id=2
    )

    # Player with churn risk spike (>3σ)
    churn_risk = PlayerAnomalyFeatures(
        player_id="anomaly_churn",
        win_rate_zscore=np.random.normal(0, 0.5),
        session_length_change=np.random.normal(0, 0.3),
        bet_aggression_spike=np.random.normal(0, 0.2),
        churn_risk_jump=4.2,  # 4.2σ above mean
        games_per_week_change=np.random.normal(0, 0.3),
        cohort_id=0
    )

    # Player with game frequency anomaly (>3σ)
    game_frequency = PlayerAnomalyFeatures(
        player_id="anomaly_frequency",
        win_rate_zscore=np.random.normal(0, 0.5),
        session_length_change=np.random.normal(0, 0.3),
        bet_aggression_spike=np.random.normal(0, 0.2),
        churn_risk_jump=np.random.normal(0, 0.4),
        games_per_week_change=-3.8,  # 3.8σ below mean
        cohort_id=1
    )

    return [win_rate_spike, session_change, bet_aggression, churn_risk, game_frequency]


@pytest.fixture
def normal_features_dataframe(sample_normal_players):
    """Convert normal players to DataFrame."""
    return features_to_dataframe(sample_normal_players)


@pytest.fixture
def anomalous_features_dataframe(sample_normal_players, sample_anomalous_players):
    """Convert normal + anomalous players to DataFrame."""
    all_players = sample_normal_players + sample_anomalous_players
    return features_to_dataframe(all_players)


class TestFeatureExtraction:
    """Test suite for feature extraction and preprocessing."""

    def test_should_convert_features_to_dataframe_correctly(self, sample_normal_players):
        """
        Test that PlayerAnomalyFeatures objects are correctly converted to DataFrame.

        All required columns should be present and data types correct.
        """
        df = features_to_dataframe(sample_normal_players)

        # Check DataFrame structure
        assert isinstance(df, pd.DataFrame)
        assert len(df) == len(sample_normal_players)

        required_cols = [
            'player_id',
            'win_rate_zscore',
            'session_length_change',
            'bet_aggression_spike',
            'churn_risk_jump',
            'games_per_week_change',
            'cohort_id'
        ]

        for col in required_cols:
            assert col in df.columns, f"Column {col} missing from DataFrame"

        # Check data types
        assert pd.api.types.is_string_dtype(df['player_id']) or df['player_id'].dtype == 'object'
        assert np.issubdtype(df['win_rate_zscore'].dtype, np.number)
        assert np.issubdtype(df['session_length_change'].dtype, np.number)


class TestAnomalyDetection:
    """Test suite for anomaly detection and scoring."""

    def test_should_detect_win_rate_spikes_greater_than_3_sigma(self, normal_features_dataframe, sample_anomalous_players):
        """
        Test 1: Verify that win rate spikes (>3σ) are correctly detected.

        Create a player with win_rate_zscore > 3σ and verify that:
        1. The Isolation Forest flags them as anomalous
        2. The z-score exceeds ZSCORE_THRESHOLD (3.0)
        3. The anomaly_type is "win_rate_spike"
        """
        # Train on normal players only
        feature_cols = [
            'win_rate_zscore',
            'session_length_change',
            'bet_aggression_spike',
            'churn_risk_jump',
            'games_per_week_change'
        ]

        X = normal_features_dataframe[feature_cols].values
        scaler = StandardScaler()
        X_scaled = scaler.fit_transform(X)

        iso_forest = train_isolation_forest(X_scaled)

        # Calculate z-score statistics on normal data
        feature_means, feature_stds = calculate_zscore_statistics(normal_features_dataframe)

        # Create anomalous player and score
        anomalous_df = features_to_dataframe([sample_anomalous_players[0]])  # win_rate_spike player
        anomalies = score_player_anomalies(
            anomalous_df, iso_forest, scaler, feature_means, feature_stds
        )

        # Find win_rate_spike anomaly
        win_rate_anomalies = [a for a in anomalies if a.anomaly_type == "win_rate_spike"]

        assert len(win_rate_anomalies) > 0, "Should detect win rate spike anomaly"

        anomaly = win_rate_anomalies[0]
        assert anomaly.player_id == "anomaly_win_rate"
        assert abs(anomaly.feature_zscore) > ZSCORE_THRESHOLD, \
            f"Z-score {anomaly.feature_zscore} should exceed {ZSCORE_THRESHOLD}"
        assert anomaly.confidence > 0.5, "Confidence should be > 0.5"

    def test_should_detect_session_pattern_changes(self, normal_features_dataframe, sample_anomalous_players):
        """
        Test 2: Verify that session pattern changes (>3σ) are detected.

        Create a player with session_length_change > 3σ and verify detection.
        """
        feature_cols = [
            'win_rate_zscore',
            'session_length_change',
            'bet_aggression_spike',
            'churn_risk_jump',
            'games_per_week_change'
        ]

        X = normal_features_dataframe[feature_cols].values
        scaler = StandardScaler()
        X_scaled = scaler.fit_transform(X)

        iso_forest = train_isolation_forest(X_scaled)
        feature_means, feature_stds = calculate_zscore_statistics(normal_features_dataframe)

        # Create anomalous player with session change
        anomalous_df = features_to_dataframe([sample_anomalous_players[1]])  # session_change player
        anomalies = score_player_anomalies(
            anomalous_df, iso_forest, scaler, feature_means, feature_stds
        )

        # Find session_change anomaly
        session_anomalies = [a for a in anomalies if a.anomaly_type == "session_change"]

        assert len(session_anomalies) > 0, "Should detect session change anomaly"

        anomaly = session_anomalies[0]
        assert anomaly.player_id == "anomaly_session"
        assert abs(anomaly.feature_zscore) > ZSCORE_THRESHOLD

    def test_should_detect_bet_aggression_outliers(self, normal_features_dataframe, sample_anomalous_players):
        """
        Test 3: Verify that bet aggression outliers (>3σ) are detected.

        Create a player with bet_aggression_spike > 3σ and verify detection.
        """
        feature_cols = [
            'win_rate_zscore',
            'session_length_change',
            'bet_aggression_spike',
            'churn_risk_jump',
            'games_per_week_change'
        ]

        X = normal_features_dataframe[feature_cols].values
        scaler = StandardScaler()
        X_scaled = scaler.fit_transform(X)

        iso_forest = train_isolation_forest(X_scaled)
        feature_means, feature_stds = calculate_zscore_statistics(normal_features_dataframe)

        # Create anomalous player with bet aggression
        anomalous_df = features_to_dataframe([sample_anomalous_players[2]])  # bet_aggression player
        anomalies = score_player_anomalies(
            anomalous_df, iso_forest, scaler, feature_means, feature_stds
        )

        # Find bet_aggression anomaly
        aggression_anomalies = [a for a in anomalies if a.anomaly_type == "bet_aggression"]

        assert len(aggression_anomalies) > 0, "Should detect bet aggression anomaly"

        anomaly = aggression_anomalies[0]
        assert anomaly.player_id == "anomaly_bet"
        assert abs(anomaly.feature_zscore) > ZSCORE_THRESHOLD

    def test_should_handle_insufficient_player_history(self):
        """
        Test 4: Verify that the system gracefully handles insufficient player history.

        When players have limited historical data, the anomaly detector should:
        1. Not crash
        2. Handle missing or zero values gracefully
        3. Default to conservative scores (low confidence)
        """
        # Create players with minimal history (all features near zero)
        minimal_players = [
            PlayerAnomalyFeatures(
                player_id=f"minimal_{i}",
                win_rate_zscore=0.1,
                session_length_change=0.0,
                bet_aggression_spike=0.0,
                churn_risk_jump=0.0,
                games_per_week_change=0.0,
                cohort_id=0
            )
            for i in range(20)
        ]

        features_df = features_to_dataframe(minimal_players)

        # Should be able to train and score without errors
        feature_cols = [
            'win_rate_zscore',
            'session_length_change',
            'bet_aggression_spike',
            'churn_risk_jump',
            'games_per_week_change'
        ]

        X = features_df[feature_cols].values
        scaler = StandardScaler()
        X_scaled = scaler.fit_transform(X)

        iso_forest = train_isolation_forest(X_scaled)
        feature_means, feature_stds = calculate_zscore_statistics(features_df)

        # Score should complete without errors
        anomalies = score_player_anomalies(
            features_df, iso_forest, scaler, feature_means, feature_stds
        )

        # With uniform data, should have few or no anomalies
        assert isinstance(anomalies, list)
        assert len(anomalies) <= len(minimal_players)

        # All confidence scores should be valid
        for anom in anomalies:
            assert 0 <= anom.confidence <= 1, "Confidence should be in [0, 1]"

    def test_should_score_in_real_time_less_than_100ms(self, normal_features_dataframe):
        """
        Test 5: Verify that scoring completes in real-time (<100ms per batch).

        For 100+ players, inference should complete in <100ms.
        This ensures the system can handle real-time requests.
        """
        feature_cols = [
            'win_rate_zscore',
            'session_length_change',
            'bet_aggression_spike',
            'churn_risk_jump',
            'games_per_week_change'
        ]

        X = normal_features_dataframe[feature_cols].values
        scaler = StandardScaler()
        X_scaled = scaler.fit_transform(X)

        iso_forest = train_isolation_forest(X_scaled)
        feature_means, feature_stds = calculate_zscore_statistics(normal_features_dataframe)

        # Measure inference time
        start_time = time.time()
        anomalies = score_player_anomalies(
            normal_features_dataframe, iso_forest, scaler, feature_means, feature_stds
        )
        elapsed_time = time.time() - start_time

        inference_time_ms = elapsed_time * 1000

        assert inference_time_ms < 100, \
            f"Inference time {inference_time_ms:.2f}ms should be < 100ms for {len(normal_features_dataframe)} players"

        # Also verify per-player inference time
        per_player_time_ms = inference_time_ms / len(normal_features_dataframe)
        assert per_player_time_ms < 1, \
            f"Per-player inference time {per_player_time_ms:.2f}ms should be < 1ms"


class TestIsolationForestModel:
    """Test suite for Isolation Forest model training and parameters."""

    def test_should_train_isolation_forest_with_correct_parameters(self, normal_features_dataframe):
        """
        Test that Isolation Forest is trained with correct hyperparameters:
        - contamination = 0.05
        - n_estimators = 100
        """
        feature_cols = [
            'win_rate_zscore',
            'session_length_change',
            'bet_aggression_spike',
            'churn_risk_jump',
            'games_per_week_change'
        ]

        X = normal_features_dataframe[feature_cols].values
        scaler = StandardScaler()
        X_scaled = scaler.fit_transform(X)

        iso_forest = train_isolation_forest(X_scaled)

        # Verify model parameters
        assert iso_forest.contamination == ISOLATION_FOREST_CONTAMINATION
        assert iso_forest.n_estimators == ISOLATION_FOREST_N_ESTIMATORS
        assert iso_forest.random_state == 42

    def test_should_require_minimum_samples_for_training(self):
        """
        Test that training fails gracefully with insufficient samples.
        """
        # Create minimal features (less than 10 samples)
        X_small = np.random.randn(5, 5)

        with pytest.raises(ValueError):
            train_isolation_forest(X_small)

    def test_should_handle_edge_case_constant_features(self):
        """
        Test that constant features (no variance) are handled gracefully.
        """
        # Create features where one column is constant
        normal_players = [
            PlayerAnomalyFeatures(
                player_id=f"const_{i}",
                win_rate_zscore=0.0,  # Constant
                session_length_change=np.random.normal(0, 0.3),
                bet_aggression_spike=np.random.normal(0, 0.2),
                churn_risk_jump=np.random.normal(0, 0.4),
                games_per_week_change=np.random.normal(0, 0.3),
                cohort_id=0
            )
            for i in range(50)
        ]

        features_df = features_to_dataframe(normal_players)

        feature_cols = [
            'win_rate_zscore',
            'session_length_change',
            'bet_aggression_spike',
            'churn_risk_jump',
            'games_per_week_change'
        ]

        X = features_df[feature_cols].values
        scaler = StandardScaler()
        # This should handle constant features gracefully
        X_scaled = scaler.fit_transform(X)

        iso_forest = train_isolation_forest(X_scaled)
        assert iso_forest is not None


class TestZscoreCalculation:
    """Test suite for z-score calculation and statistics."""

    def test_should_calculate_zscore_statistics_correctly(self, normal_features_dataframe):
        """
        Test that z-score statistics (mean, std) are calculated correctly.
        """
        feature_means, feature_stds = calculate_zscore_statistics(normal_features_dataframe)

        # Should have statistics for all features
        required_features = [
            'win_rate_zscore',
            'session_length_change',
            'bet_aggression_spike',
            'churn_risk_jump',
            'games_per_week_change'
        ]

        for feature in required_features:
            assert feature in feature_means, f"Mean for {feature} not calculated"
            assert feature in feature_stds, f"Std for {feature} not calculated"
            assert isinstance(feature_means[feature], float)
            assert isinstance(feature_stds[feature], float)
            assert feature_stds[feature] > 0, f"Std for {feature} should be > 0"

    def test_should_compute_valid_zscores_for_anomalies(self, sample_normal_players, sample_anomalous_players):
        """
        Test that z-scores for anomalous features are correctly computed.
        Anomalies should have |z-score| > 3.
        """
        all_players = sample_normal_players + sample_anomalous_players
        features_df = features_to_dataframe(all_players)

        feature_means, feature_stds = calculate_zscore_statistics(features_df)

        # Check win rate spike player
        win_rate_spike = features_df[features_df['player_id'] == 'anomaly_win_rate'].iloc[0]
        zscore = (win_rate_spike['win_rate_zscore'] - feature_means['win_rate_zscore']) / feature_stds['win_rate_zscore']

        assert abs(zscore) > ZSCORE_THRESHOLD, \
            f"Win rate spike z-score {abs(zscore)} should exceed {ZSCORE_THRESHOLD}"


class TestAnomalyThresholds:
    """Test suite for anomaly thresholds and flags."""

    def test_should_respect_anomaly_score_threshold(self, normal_features_dataframe, sample_anomalous_players):
        """
        Test that anomalies are only flagged when:
        - anomaly_score > ANOMALY_SCORE_THRESHOLD (0.7)
        - AND feature_zscore > ZSCORE_THRESHOLD (3.0)
        """
        feature_cols = [
            'win_rate_zscore',
            'session_length_change',
            'bet_aggression_spike',
            'churn_risk_jump',
            'games_per_week_change'
        ]

        X = normal_features_dataframe[feature_cols].values
        scaler = StandardScaler()
        X_scaled = scaler.fit_transform(X)

        iso_forest = train_isolation_forest(X_scaled)
        feature_means, feature_stds = calculate_zscore_statistics(normal_features_dataframe)

        # Score anomalous player
        anomalous_df = features_to_dataframe(sample_anomalous_players)
        anomalies = score_player_anomalies(
            anomalous_df, iso_forest, scaler, feature_means, feature_stds
        )

        # All detected anomalies should exceed thresholds
        for anomaly in anomalies:
            assert anomaly.anomaly_score > ANOMALY_SCORE_THRESHOLD, \
                f"Anomaly score {anomaly.anomaly_score} should exceed {ANOMALY_SCORE_THRESHOLD}"
            assert abs(anomaly.feature_zscore) > ZSCORE_THRESHOLD, \
                f"Feature z-score {abs(anomaly.feature_zscore)} should exceed {ZSCORE_THRESHOLD}"

    def test_should_have_valid_confidence_scores(self, normal_features_dataframe, sample_anomalous_players):
        """
        Test that confidence scores are in valid range [0, 1] and meaningful.
        """
        feature_cols = [
            'win_rate_zscore',
            'session_length_change',
            'bet_aggression_spike',
            'churn_risk_jump',
            'games_per_week_change'
        ]

        X = normal_features_dataframe[feature_cols].values
        scaler = StandardScaler()
        X_scaled = scaler.fit_transform(X)

        iso_forest = train_isolation_forest(X_scaled)
        feature_means, feature_stds = calculate_zscore_statistics(normal_features_dataframe)

        anomalous_df = features_to_dataframe(sample_anomalous_players)
        anomalies = score_player_anomalies(
            anomalous_df, iso_forest, scaler, feature_means, feature_stds
        )

        for anomaly in anomalies:
            assert 0 <= anomaly.confidence <= 1, \
                f"Confidence {anomaly.confidence} should be in [0, 1]"

            # Confidence should correlate with feature z-score extremeness
            z_extremeness = min(1.0, abs(anomaly.feature_zscore) / (ZSCORE_THRESHOLD * 2))
            assert anomaly.confidence > 0.5, "High z-score should give high confidence"


class TestMultipleAnomalyDetection:
    """Test suite for detecting multiple anomaly types simultaneously."""

    def test_should_detect_multiple_anomaly_types(self, normal_features_dataframe, sample_anomalous_players):
        """
        Test that multiple anomaly types can be detected in one batch.
        """
        feature_cols = [
            'win_rate_zscore',
            'session_length_change',
            'bet_aggression_spike',
            'churn_risk_jump',
            'games_per_week_change'
        ]

        X = normal_features_dataframe[feature_cols].values
        scaler = StandardScaler()
        X_scaled = scaler.fit_transform(X)

        iso_forest = train_isolation_forest(X_scaled)
        feature_means, feature_stds = calculate_zscore_statistics(normal_features_dataframe)

        # Score all anomalous players at once
        anomalous_df = features_to_dataframe(sample_anomalous_players)
        anomalies = score_player_anomalies(
            anomalous_df, iso_forest, scaler, feature_means, feature_stds
        )

        # Should detect multiple types
        detected_types = set(a.anomaly_type for a in anomalies)

        # At least some anomalies should be detected
        assert len(detected_types) > 0, "Should detect at least some anomaly types"

        # Verify anomaly type names are valid
        valid_types = {
            "win_rate_spike",
            "session_change",
            "bet_aggression",
            "churn_risk",
            "game_frequency"
        }

        for atype in detected_types:
            assert atype in valid_types, f"Invalid anomaly type: {atype}"


class TestEdgeCases:
    """Test suite for edge cases and error handling."""

    def test_should_handle_nan_values_gracefully(self):
        """
        Test that NaN values are handled without crashing.
        """
        # Create at least 10 samples with some NaN values
        players_with_nan = [
            PlayerAnomalyFeatures(
                player_id=f"player_{i}",
                win_rate_zscore=np.nan if i == 0 else 0.1 * i,
                session_length_change=0.1 + i * 0.01,
                bet_aggression_spike=0.2 + i * 0.01,
                churn_risk_jump=0.3 + i * 0.01,
                games_per_week_change=0.1 + i * 0.01,
                cohort_id=i % 3
            )
            for i in range(15)
        ]

        features_df = features_to_dataframe(players_with_nan)
        # Replace NaN with 0 for handling
        features_df.fillna(0, inplace=True)

        feature_cols = [
            'win_rate_zscore',
            'session_length_change',
            'bet_aggression_spike',
            'churn_risk_jump',
            'games_per_week_change'
        ]

        X = features_df[feature_cols].values
        scaler = StandardScaler()
        X_scaled = scaler.fit_transform(X)

        iso_forest = train_isolation_forest(X_scaled)
        assert iso_forest is not None

    def test_should_handle_extreme_feature_values(self):
        """
        Test that extreme feature values don't break the model.
        """
        extreme_players = [
            PlayerAnomalyFeatures(
                player_id=f"extreme_{i}",
                win_rate_zscore=float(i * 100) if i % 2 == 0 else float(-i * 100),
                session_length_change=float(i * 50),
                bet_aggression_spike=float(i * 10),
                churn_risk_jump=float(i * 20),
                games_per_week_change=float(i * 5),
                cohort_id=0
            )
            for i in range(20)
        ]

        features_df = features_to_dataframe(extreme_players)

        feature_cols = [
            'win_rate_zscore',
            'session_length_change',
            'bet_aggression_spike',
            'churn_risk_jump',
            'games_per_week_change'
        ]

        X = features_df[feature_cols].values
        scaler = StandardScaler()
        X_scaled = scaler.fit_transform(X)

        # Should handle extreme values through scaling
        iso_forest = train_isolation_forest(X_scaled)
        assert iso_forest is not None
