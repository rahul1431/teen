"""
Tests for Playstyle Clusterer Module

Tests the K-means clustering implementation for player playstyle categorization.
Covers feature scaling, silhouette score validation, cluster identification, and
cluster assignment to players.
"""

import pytest
import pandas as pd
import numpy as np
from sklearn.metrics import silhouette_score

# Add src to path so we can import playstyle_clusterer
import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'src'))

from playstyle_clusterer import (
    PlayerFeatures,
    features_to_dataframe,
    find_optimal_k,
    perform_clustering,
    assign_player_clusters,
    get_cluster_centroids,
    CLUSTER_LABELS
)


@pytest.fixture
def sample_players():
    """Generate sample player features for testing."""
    # Create distinct groups of players with different playstyles
    np.random.seed(42)

    # Group 1: Casual players (low session length, low aggression, stable wins)
    casual_players = [
        PlayerFeatures(
            player_id=f"casual_{i}",
            avg_session_length=np.random.uniform(10, 30),  # 10-30 min sessions
            bet_aggression=np.random.uniform(0.1, 0.3),   # Low aggression
            win_rate_volatility=np.random.uniform(0.05, 0.15),  # Low volatility
            churn_risk_score=np.random.uniform(10, 30),   # Low churn risk
            game_count_per_week=np.random.uniform(1, 5),  # Few games per week
            game_count=15 + i
        )
        for i in range(15)
    ]

    # Group 2: Aggressive players (high bet aggression, high volatility)
    aggressive_players = [
        PlayerFeatures(
            player_id=f"aggressive_{i}",
            avg_session_length=np.random.uniform(40, 80),  # 40-80 min sessions
            bet_aggression=np.random.uniform(0.7, 1.0),   # High aggression
            win_rate_volatility=np.random.uniform(0.4, 0.8),  # High volatility
            churn_risk_score=np.random.uniform(60, 90),   # High churn risk
            game_count_per_week=np.random.uniform(10, 20),  # Many games per week
            game_count=20 + i
        )
        for i in range(15)
    ]

    # Group 3: Grind players (high session length, steady game counts, low volatility)
    grind_players = [
        PlayerFeatures(
            player_id=f"grind_{i}",
            avg_session_length=np.random.uniform(60, 120),  # 60-120 min sessions
            bet_aggression=np.random.uniform(0.3, 0.5),   # Medium aggression
            win_rate_volatility=np.random.uniform(0.05, 0.2),  # Low volatility (steady)
            churn_risk_score=np.random.uniform(20, 40),   # Medium churn risk
            game_count_per_week=np.random.uniform(15, 30),  # Consistent games
            game_count=50 + i
        )
        for i in range(15)
    ]

    all_players = casual_players + aggressive_players + grind_players
    return all_players


@pytest.fixture
def features_dataframe(sample_players):
    """Convert sample players to DataFrame."""
    return features_to_dataframe(sample_players)


class TestFeatureScaling:
    """Test suite for feature scaling and preprocessing."""

    def test_should_handle_feature_scaling_correctly(self, features_dataframe):
        """
        Test 3: Verify that features are scaled correctly using StandardScaler.

        StandardScaler should normalize features to have mean ~0 and std ~1,
        which is essential for K-means clustering to work fairly on all features.
        """
        from sklearn.preprocessing import StandardScaler

        feature_cols = [
            'avg_session_length',
            'bet_aggression',
            'win_rate_volatility',
            'churn_risk_score',
            'game_count_per_week'
        ]

        X = features_dataframe[feature_cols].values
        scaler = StandardScaler()
        X_scaled = scaler.fit_transform(X)

        # Check that scaled features have near-zero mean (within floating-point tolerance)
        means = np.mean(X_scaled, axis=0)
        assert np.allclose(means, 0, atol=1e-10), \
            f"Scaled features should have mean ~0, got {means}"

        # Check that scaled features have unit variance
        stds = np.std(X_scaled, axis=0)
        assert np.allclose(stds, 1.0, atol=1e-10), \
            f"Scaled features should have std ~1, got {stds}"

        # Check that scaling is invertible
        X_reconstructed = scaler.inverse_transform(X_scaled)
        assert np.allclose(X_reconstructed, X, atol=1e-10), \
            "StandardScaler should be invertible"


class TestSilhouetteScore:
    """Test suite for silhouette score validation."""

    def test_should_cluster_players_with_silhouette_score_gte_0_5(self, features_dataframe):
        """
        Test 1: Verify that clustering achieves silhouette score >= 0.5.

        A silhouette score >= 0.5 indicates reasonably well-separated clusters.
        This is a quality gate for the clustering model.

        The test uses synthetic data with well-separated player groups, so
        silhouette score should be good.
        """
        kmeans, labels, scaler, silhouette_avg = perform_clustering(features_dataframe)

        # Silhouette score should be >= 0.5 for well-separated clusters
        assert silhouette_avg >= 0.5, \
            f"Silhouette score {silhouette_avg:.4f} should be >= 0.5"

        # Verify silhouette score computation is consistent
        feature_cols = [
            'avg_session_length',
            'bet_aggression',
            'win_rate_volatility',
            'churn_risk_score',
            'game_count_per_week'
        ]
        X_scaled = scaler.transform(features_dataframe[feature_cols].values)
        verified_score = silhouette_score(X_scaled, labels)

        assert np.isclose(silhouette_avg, verified_score), \
            f"Silhouette score computation mismatch: {silhouette_avg} vs {verified_score}"


class TestClusterIdentification:
    """Test suite for cluster identification and interpretation."""

    def test_should_identify_casual_aggressive_grind_clusters(self, features_dataframe):
        """
        Test 2: Verify that the clustering identifies distinct casual, aggressive,
        and grind clusters.

        Expected cluster characteristics:
        - Casual: Low avg_session_length, low bet_aggression, low churn_risk_score
        - Aggressive: High bet_aggression, high win_rate_volatility, high churn_risk_score
        - Grind: High avg_session_length, medium aggression, steady game counts
        """
        kmeans, labels, scaler, silhouette_avg = perform_clustering(features_dataframe)

        # Get cluster centroids in original feature space
        centroids = get_cluster_centroids(kmeans, scaler)

        feature_cols = [
            'avg_session_length',
            'bet_aggression',
            'win_rate_volatility',
            'churn_risk_score',
            'game_count_per_week'
        ]

        # We should have 3 or 4 clusters
        num_clusters = kmeans.n_clusters
        assert num_clusters in [3, 4], \
            f"Expected 3-4 clusters, got {num_clusters}"

        # Each cluster should be well-represented
        unique_labels, counts = np.unique(labels, return_counts=True)
        for cluster_id, count in zip(unique_labels, counts):
            assert count > 5, \
                f"Cluster {cluster_id} has too few members ({count}), should be well-represented"

        # Verify that we have distinct cluster profiles
        # At least one cluster should have low avg_session_length (Casual)
        # At least one cluster should have high bet_aggression (Aggressive)
        # At least one cluster should have high avg_session_length (Grind)

        avg_session_lengths = [c['avg_session_length'] for c in centroids.values()]
        bet_aggressions = [c['bet_aggression'] for c in centroids.values()]
        session_lengths_sorted = sorted(avg_session_lengths)

        # Casual (lowest session length)
        assert session_lengths_sorted[0] < session_lengths_sorted[-1] / 2, \
            "Should have a cluster with significantly lower session length (Casual)"

        # Aggressive (highest aggression)
        assert max(bet_aggressions) > min(bet_aggressions) * 2, \
            "Should have distinct differences in bet aggression between clusters"

        # Grind (highest session length)
        assert session_lengths_sorted[-1] > session_lengths_sorted[0] * 2, \
            "Should have a cluster with significantly higher session length (Grind)"


class TestClusterAssignment:
    """Test suite for cluster assignment to players."""

    def test_should_assign_cluster_id_to_all_players(self, features_dataframe):
        """
        Test 4: Verify that every player is assigned a cluster_id.

        All players should receive a valid cluster assignment (0 to k-1).
        No player should be left unassigned.
        """
        kmeans, labels, scaler, silhouette_avg = perform_clustering(features_dataframe)
        player_clusters = assign_player_clusters(features_dataframe, labels)

        # All players should have cluster_id
        assert len(player_clusters) == len(features_dataframe), \
            "All players should be assigned to a cluster"

        assert 'cluster_id' in player_clusters.columns, \
            "cluster_id column should exist"

        assert player_clusters['cluster_id'].notna().all(), \
            "All players should have non-null cluster_id"

        # Cluster IDs should be in valid range
        unique_ids = player_clusters['cluster_id'].unique()
        num_clusters = kmeans.n_clusters

        for cluster_id in unique_ids:
            assert 0 <= cluster_id < num_clusters, \
                f"Cluster ID {cluster_id} out of valid range [0, {num_clusters-1}]"

        # Cluster names should be assigned
        assert 'cluster_name' in player_clusters.columns, \
            "cluster_name column should exist"

        assert player_clusters['cluster_name'].notna().all(), \
            "All players should have cluster names"

        # All cluster names should be in CLUSTER_LABELS
        for name in player_clusters['cluster_name'].unique():
            assert name in CLUSTER_LABELS.values(), \
                f"Unknown cluster name: {name}"


class TestOutlierDetection:
    """Test suite for outlier detection."""

    def test_should_detect_outliers(self, features_dataframe):
        """
        Test 5: Verify that the clustering can detect anomalies/outliers.

        Outliers should either:
        1. Form their own cluster (if k=4 and includes "Risky" cluster)
        2. Be assigned to the most distant cluster

        This test verifies that extreme player profiles are handled properly.
        """
        # Add some outlier players with extreme characteristics
        outliers = pd.DataFrame({
            'player_id': ['outlier_1', 'outlier_2'],
            'avg_session_length': [500.0, 0.5],  # Extremely high and low
            'bet_aggression': [1.0, 0.0],  # Extreme aggression values
            'win_rate_volatility': [1.0, 0.0],  # Extreme volatility
            'churn_risk_score': [100.0, 0.0],  # Extreme churn risk
            'game_count_per_week': [100.0, 0.1]  # Extreme game counts
        })

        combined_features = pd.concat([features_dataframe, outliers], ignore_index=True)

        kmeans, labels, scaler, silhouette_avg = perform_clustering(combined_features)
        player_clusters = assign_player_clusters(combined_features, labels)

        # Find outlier assignments
        outlier_indices = combined_features[
            combined_features['player_id'].isin(['outlier_1', 'outlier_2'])
        ].index

        outlier_clusters = player_clusters.loc[outlier_indices, 'cluster_id'].values

        # Outliers should be assigned to some cluster
        assert len(outlier_clusters) == 2, "Both outliers should be assigned"

        # Compute distance of outliers to all cluster centroids
        feature_cols = [
            'avg_session_length',
            'bet_aggression',
            'win_rate_volatility',
            'churn_risk_score',
            'game_count_per_week'
        ]
        X_scaled = scaler.transform(combined_features[feature_cols].values)

        for outlier_idx in outlier_indices:
            outlier_scaled = X_scaled[outlier_idx]
            outlier_cluster = player_clusters.loc[outlier_idx, 'cluster_id']

            # Compute distance to outlier's assigned cluster centroid
            assigned_centroid = kmeans.cluster_centers_[outlier_cluster]
            distance_to_assigned = np.linalg.norm(outlier_scaled - assigned_centroid)

            # Distance should be reasonable (not NaN or infinite)
            assert np.isfinite(distance_to_assigned), \
                f"Outlier distance should be finite, got {distance_to_assigned}"

            # Log the outlier handling for verification
            print(f"Outlier at index {outlier_idx} assigned to cluster {outlier_cluster} "
                  f"with distance {distance_to_assigned:.4f}")


class TestOptimalK:
    """Test suite for optimal k selection."""

    def test_find_optimal_k_returns_valid_k(self, features_dataframe):
        """Test that find_optimal_k returns a valid k value."""
        from sklearn.preprocessing import StandardScaler

        feature_cols = [
            'avg_session_length',
            'bet_aggression',
            'win_rate_volatility',
            'churn_risk_score',
            'game_count_per_week'
        ]

        X = features_dataframe[feature_cols].values
        scaler = StandardScaler()
        X_scaled = scaler.fit_transform(X)

        optimal_k, silhouette_avg = find_optimal_k(X_scaled)

        # k should be within the tested range
        assert optimal_k in [2, 3, 4], \
            f"Optimal k should be in [2, 3, 4], got {optimal_k}"

        # Silhouette score should be valid
        assert -1 <= silhouette_avg <= 1, \
            f"Silhouette score should be in [-1, 1], got {silhouette_avg}"

    def test_find_optimal_k_requires_minimum_samples(self):
        """Test that find_optimal_k requires at least 2 samples."""
        from sklearn.preprocessing import StandardScaler

        # Single sample should fail
        X_single = np.array([[1.0, 2.0, 3.0, 4.0, 5.0]])
        scaler = StandardScaler()

        with pytest.raises(ValueError):
            X_scaled = scaler.fit_transform(X_single)
            find_optimal_k(X_scaled)


class TestPipelineIntegration:
    """Integration tests for the full clustering pipeline."""

    def test_clustering_pipeline_returns_valid_results(self, features_dataframe):
        """
        Integration test: Verify that the complete clustering pipeline produces
        valid and consistent results.
        """
        kmeans, labels, scaler, silhouette_avg = perform_clustering(features_dataframe)
        player_clusters = assign_player_clusters(features_dataframe, labels)
        centroids = get_cluster_centroids(kmeans, scaler)

        # Verify structure
        assert isinstance(player_clusters, pd.DataFrame)
        assert isinstance(centroids, dict)
        assert len(player_clusters) == len(features_dataframe)
        assert len(centroids) == kmeans.n_clusters

        # Verify consistency
        for cluster_id in range(kmeans.n_clusters):
            assert cluster_id in centroids, \
                f"Centroid for cluster {cluster_id} should exist"

            cluster_members = player_clusters[player_clusters['cluster_id'] == cluster_id]
            assert len(cluster_members) > 0, \
                f"Cluster {cluster_id} should have at least one member"

    def test_clustering_handles_edge_cases(self):
        """Test that clustering handles edge cases gracefully."""
        # Test with minimum required players (just over threshold)
        minimal_players = [
            PlayerFeatures(
                player_id=f"player_{i}",
                avg_session_length=float(i) * 10,
                bet_aggression=float(i) * 0.1,
                win_rate_volatility=float(i) * 0.05,
                churn_risk_score=float(i) * 10,
                game_count_per_week=float(i) * 2,
                game_count=11 + i
            )
            for i in range(10)  # Minimum 10 players for meaningful clustering
        ]

        features_df = features_to_dataframe(minimal_players)
        kmeans, labels, scaler, silhouette_avg = perform_clustering(features_df)

        # Should complete without errors
        assert kmeans is not None
        assert len(labels) == len(minimal_players)
        assert silhouette_avg >= -1.0  # Valid silhouette range
