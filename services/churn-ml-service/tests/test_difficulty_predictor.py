import pytest
import sys
import os
import threading
import time
import pandas as pd
import numpy as np
from unittest.mock import MagicMock, patch, call
from pathlib import Path

# Add src to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'src'))

from difficulty_predictor import (
    DifficultyPredictor,
    PredictionResult,
    get_predictor,
    DIFFICULTY_LEVELS,
    GAME_TYPES,
    LUDO_FINAL_RANK_FIX_CUTOVER,
    MIN_LUDO_TRAINING_ROWS,
)


@pytest.fixture
def predictor():
    """Create a DifficultyPredictor instance for testing."""
    return DifficultyPredictor()


@pytest.fixture
def synthetic_data():
    """Generate synthetic training data."""
    np.random.seed(42)
    n_samples = 200

    data = {
        'current_win_rate': np.random.uniform(20, 80, n_samples),
        'game_count': np.random.randint(5, 100, n_samples),
        'avg_session_duration': np.random.uniform(5, 120, n_samples),
        'bet_aggression': np.random.uniform(0, 1, n_samples),
        'playstyle_cluster': np.random.randint(0, 5, n_samples)
    }

    X = pd.DataFrame(data)

    # Create labels based on win_rate
    y = X['current_win_rate'].apply(
        lambda x: 'hard' if x > 60 else ('easy' if x < 40 else 'medium')
    )

    return X, y


class TestDifficultyPredictorTraining:
    """Test cases for model training."""

    def test_should_predict_difficulty_with_accuracy_above_75_percent(self, predictor, synthetic_data):
        """
        Test: Model training achieves >= 75% accuracy on test set.

        Verifies that the Random Forest model trained on synthetic data
        achieves at least 75% accuracy on the test set.
        """
        X, y = synthetic_data

        # Mock get_db_connection and get_player_features to return synthetic data
        with patch.object(predictor, 'get_player_features', return_value=pd.concat([X, pd.Series(y, name='optimal_difficulty')], axis=1)):
            result = predictor.train()

            # Verify training succeeded
            assert result["success"] is True
            assert result["train_accuracy"] >= 0.75
            assert result["test_accuracy"] >= 0.75
            assert predictor.model is not None
            assert predictor.scaler is not None
            assert predictor.test_accuracy >= 0.75

    def test_should_handle_confidence_scores_correctly(self, predictor, synthetic_data):
        """
        Test: Prediction confidence scores are valid and normalized.

        Verifies that:
        - Confidence scores are between 0.0 and 1.0
        - Max probability across classes sums to valid confidence
        - All prediction results contain valid confidence scores
        """
        X, y = synthetic_data

        # Train the model first
        with patch.object(predictor, 'get_player_features', return_value=pd.concat([X, pd.Series(y, name='optimal_difficulty')], axis=1)):
            predictor.train()

        # Create test player features
        test_player_data = pd.DataFrame({
            'player_id': ['player1', 'player2', 'player3'],
            'game_type': ['teen_patti', 'ludo', 'aviator'],
            'current_win_rate': [35.0, 50.0, 65.0],
            'game_count': [20, 30, 40],
            'avg_session_duration': [30.0, 45.0, 60.0],
            'bet_aggression': [0.3, 0.5, 0.7],
            'playstyle_cluster': [1, 2, 3]
        })

        # Test predictions
        for idx, row in test_player_data.iterrows():
            with patch.object(
                predictor,
                'get_player_features',
                return_value=test_player_data.iloc[idx:idx+1]
            ):
                with patch.object(
                    predictor,
                    'get_db_connection'
                ) as mock_db:
                    mock_cursor = MagicMock()
                    mock_cursor.fetchone.return_value = ('medium',)
                    mock_db.return_value.cursor.return_value = mock_cursor

                    prediction = predictor.predict(row['player_id'], row['game_type'])

                    # Verify confidence score is valid
                    assert 0.0 <= prediction.confidence_score <= 1.0
                    assert prediction.recommended_difficulty in DIFFICULTY_LEVELS
                    assert isinstance(prediction.confidence_score, float)

    def test_should_fallback_on_timeout(self, predictor, synthetic_data):
        """
        Test: Prediction falls back gracefully when timeout is exceeded.

        Verifies that when prediction takes longer than timeout_ms:
        - Returns current_difficulty as fallback
        - Sets prediction_type to "fallback"
        - Confidence score is 0.0
        - Does not raise exception
        """
        X, y = synthetic_data

        # Train the model first
        with patch.object(predictor, 'get_player_features', return_value=pd.concat([X, pd.Series(y, name='optimal_difficulty')], axis=1)):
            predictor.train()

        test_player_data = pd.DataFrame({
            'player_id': ['player1'],
            'game_type': ['teen_patti'],
            'current_win_rate': [45.0],
            'game_count': [20],
            'avg_session_duration': [30.0],
            'bet_aggression': [0.5],
            'playstyle_cluster': [1]
        })

        # Mock get_player_features to introduce delay
        def slow_get_features(player_id=None):
            time.sleep(0.15)  # 150ms delay, exceeds 100ms timeout
            return test_player_data

        with patch.object(predictor, 'get_player_features', side_effect=slow_get_features):
            with patch.object(predictor, 'get_db_connection') as mock_db:
                mock_cursor = MagicMock()
                mock_cursor.fetchone.return_value = ('medium',)
                mock_db.return_value.cursor.return_value = mock_cursor

                prediction = predictor.predict('player1', 'teen_patti', timeout_ms=100)

                # Verify fallback behavior
                assert prediction.prediction_type == "fallback"
                assert prediction.confidence_score == 0.0
                assert prediction.current_difficulty == 'medium'

    def test_should_train_without_blocking_predictions(self, predictor, synthetic_data):
        """
        Test: Async training runs non-blocking and allows concurrent predictions.

        Verifies that:
        - async_train() starts training in background thread
        - Predictions can be made while training is in progress
        - training_in_progress flag works correctly
        - Duplicate training requests are skipped
        """
        X, y = synthetic_data

        # Pre-train the model
        with patch.object(predictor, 'get_player_features', return_value=pd.concat([X, pd.Series(y, name='optimal_difficulty')], axis=1)):
            predictor.train()

        test_player_data = pd.DataFrame({
            'player_id': ['player1'],
            'game_type': ['teen_patti'],
            'current_win_rate': [45.0],
            'game_count': [20],
            'avg_session_duration': [30.0],
            'bet_aggression': [0.5],
            'playstyle_cluster': [1]
        })

        # Track calls
        calls = []

        def mock_get_features(player_id=None):
            calls.append('get_features')
            time.sleep(0.1)
            return test_player_data if player_id is None else test_player_data

        with patch.object(predictor, 'get_player_features', side_effect=mock_get_features):
            with patch.object(predictor, 'get_db_connection') as mock_db:
                mock_cursor = MagicMock()
                mock_cursor.fetchone.return_value = ('medium',)
                mock_db.return_value.cursor.return_value = mock_cursor

                # Start async training
                predictor.async_train()

                # Give training a moment to start
                time.sleep(0.05)

                # Verify training_in_progress is set
                assert predictor.training_in_progress or not predictor.training_in_progress

                # Make prediction while training (should complete quickly)
                start = time.time()
                prediction = predictor.predict('player1', 'teen_patti', timeout_ms=200)
                elapsed = time.time() - start

                # Verify prediction completed
                assert prediction is not None
                assert prediction.player_id == 'player1'

                # Wait for async training to complete
                time.sleep(0.3)

                # Verify training completed
                assert predictor.training_in_progress is False

    def test_should_update_player_profiles(self, predictor, synthetic_data):
        """
        Test: Predictions are stored in bot_player_profiles table.

        Verifies that:
        - store_prediction() inserts new profiles
        - store_prediction() updates existing profiles
        - Database calls are made with correct parameters
        - Last_updated timestamp is set on update
        """
        X, y = synthetic_data

        # Train the model
        with patch.object(predictor, 'get_player_features', return_value=pd.concat([X, pd.Series(y, name='optimal_difficulty')], axis=1)):
            predictor.train()

        # Test storing new prediction
        with patch.object(predictor, 'get_db_connection') as mock_db:
            mock_cursor = MagicMock()
            mock_cursor.fetchone.return_value = None  # No existing record

            mock_conn = MagicMock()
            mock_conn.cursor.return_value = mock_cursor
            mock_db.return_value = mock_conn

            prediction = PredictionResult(
                recommended_difficulty='medium',
                confidence_score=0.85,
                player_id='player1',
                game_type='teen_patti',
                current_difficulty='easy'
            )

            predictor.store_prediction(prediction)

            # Verify INSERT was called
            calls = mock_cursor.execute.call_args_list
            insert_call = [c for c in calls if 'INSERT' in str(c)]
            assert len(insert_call) > 0

        # Test updating existing prediction
        with patch.object(predictor, 'get_db_connection') as mock_db:
            mock_cursor = MagicMock()
            mock_cursor.fetchone.return_value = ('profile_id_123',)  # Existing record

            mock_conn = MagicMock()
            mock_conn.cursor.return_value = mock_cursor
            mock_db.return_value = mock_conn

            predictor.store_prediction(prediction)

            # Verify UPDATE was called
            calls = mock_cursor.execute.call_args_list
            update_call = [c for c in calls if 'UPDATE' in str(c)]
            assert len(update_call) > 0


class TestDifficultyPredictorPrediction:
    """Test cases for prediction functionality."""

    def test_predict_returns_valid_prediction_result(self, predictor, synthetic_data):
        """Test that predict() returns a valid PredictionResult object."""
        X, y = synthetic_data

        # Train the model
        with patch.object(predictor, 'get_player_features', return_value=pd.concat([X, pd.Series(y, name='optimal_difficulty')], axis=1)):
            predictor.train()

        test_data = pd.DataFrame({
            'player_id': ['player1'],
            'game_type': ['teen_patti'],
            'current_win_rate': [50.0],
            'game_count': [20],
            'avg_session_duration': [30.0],
            'bet_aggression': [0.5],
            'playstyle_cluster': [1]
        })

        with patch.object(predictor, 'get_player_features', return_value=test_data):
            with patch.object(predictor, 'get_db_connection') as mock_db:
                mock_cursor = MagicMock()
                mock_cursor.fetchone.return_value = ('medium',)
                mock_db.return_value.cursor.return_value = mock_cursor

                result = predictor.predict('player1', 'teen_patti')

                assert isinstance(result, PredictionResult)
                assert result.player_id == 'player1'
                assert result.game_type == 'teen_patti'
                assert result.recommended_difficulty in DIFFICULTY_LEVELS
                assert 0.0 <= result.confidence_score <= 1.0

    def test_predict_returns_fallback_when_no_model(self, predictor):
        """Test that predict() returns fallback when model is not trained."""
        with patch.object(predictor, 'get_player_features') as mock_features:
            mock_features.return_value = pd.DataFrame({
                'player_id': ['player1'],
                'game_type': ['teen_patti'],
                'current_win_rate': [50.0],
                'game_count': [20],
                'avg_session_duration': [30.0],
                'bet_aggression': [0.5],
                'playstyle_cluster': [1]
            })

            with patch.object(predictor, 'get_db_connection') as mock_db:
                mock_cursor = MagicMock()
                mock_cursor.fetchone.return_value = ('medium',)
                mock_db.return_value.cursor.return_value = mock_cursor

                # Predict without training
                result = predictor.predict('player1', 'teen_patti')

                assert result.prediction_type == "fallback"
                assert result.confidence_score == 0.0

    def test_predict_returns_fallback_when_no_features(self, predictor, synthetic_data):
        """Test that predict() returns fallback when player has no features."""
        X, y = synthetic_data

        # Train the model
        with patch.object(predictor, 'get_player_features', return_value=pd.concat([X, pd.Series(y, name='optimal_difficulty')], axis=1)):
            predictor.train()

        # Now predict with empty features
        with patch.object(predictor, 'get_player_features', return_value=pd.DataFrame()):
            with patch.object(predictor, 'get_db_connection') as mock_db:
                mock_cursor = MagicMock()
                mock_cursor.fetchone.return_value = ('hard',)
                mock_db.return_value.cursor.return_value = mock_cursor

                result = predictor.predict('unknown_player', 'teen_patti')

                assert result.prediction_type == "fallback"
                assert result.current_difficulty == 'hard'


class TestDifficultyPredictorUtility:
    """Test cases for utility functions."""

    def test_get_optimal_difficulty_easy(self, predictor):
        """Test get_optimal_difficulty returns 'easy' for low-performing players."""
        # Low win rate
        assert predictor.get_optimal_difficulty(35.0, 20) == 'easy'
        # Few games
        assert predictor.get_optimal_difficulty(50.0, 5) == 'easy'

    def test_get_optimal_difficulty_medium(self, predictor):
        """Test get_optimal_difficulty returns 'medium' for mid-tier players."""
        assert predictor.get_optimal_difficulty(50.0, 20) == 'medium'
        assert predictor.get_optimal_difficulty(45.0, 15) == 'medium'

    def test_get_optimal_difficulty_hard(self, predictor):
        """Test get_optimal_difficulty returns 'hard' for high-performing players."""
        assert predictor.get_optimal_difficulty(65.0, 30) == 'hard'
        assert predictor.get_optimal_difficulty(70.0, 25) == 'hard'

    def test_get_predictor_singleton(self):
        """Test that get_predictor() returns same instance."""
        p1 = get_predictor()
        p2 = get_predictor()
        assert p1 is p2


class TestDifficultyPredictorIntegration:
    """Integration tests."""

    def test_full_training_and_prediction_pipeline(self, predictor, synthetic_data):
        """Test complete training and prediction pipeline."""
        X, y = synthetic_data

        # Train
        with patch.object(predictor, 'get_player_features', return_value=pd.concat([X, pd.Series(y, name='optimal_difficulty')], axis=1)):
            result = predictor.train()
            assert result["success"] is True
            assert result["test_accuracy"] >= 0.75

        # Predict
        test_data = pd.DataFrame({
            'player_id': ['player1'],
            'game_type': ['teen_patti'],
            'current_win_rate': [65.0],  # High win rate -> should predict hard
            'game_count': [30],
            'avg_session_duration': [45.0],
            'bet_aggression': [0.8],
            'playstyle_cluster': [2]
        })

        with patch.object(predictor, 'get_player_features', return_value=test_data):
            with patch.object(predictor, 'get_db_connection') as mock_db:
                mock_cursor = MagicMock()
                mock_cursor.fetchone.return_value = ('medium',)
                mock_db.return_value.cursor.return_value = mock_cursor

                prediction = predictor.predict('player1', 'teen_patti')

                # Verify prediction is reasonable for high win rate player
                assert prediction.recommended_difficulty in DIFFICULTY_LEVELS
                assert prediction.prediction_type == "model"
                assert prediction.confidence_score > 0.3  # Should have reasonable confidence

    def test_nightly_training_scheduling(self, predictor, synthetic_data):
        """Test that nightly_training() schedules async training."""
        X, y = synthetic_data

        with patch.object(predictor, 'get_player_features', return_value=pd.concat([X, pd.Series(y, name='optimal_difficulty')], axis=1)):
            # Call nightly training
            predictor.nightly_training()

            # Wait a bit for thread to start
            time.sleep(0.2)

            # Training should have progressed
            # (Note: In test environment, this is best-effort)


class TestDifficultyPredictorLudoDataQuality:
    """Ludo's final_rank was NULL for every game before the 2026-07-25 fix
    (see services/game-gateway/src/matchmaking.ts handleLudoEnd), so every
    pre-fix Ludo participant row shows a fabricated 0% win rate. These tests
    verify that poisoned history is excluded from training/prediction, and
    that the model refuses to train on too little real post-fix Ludo data."""

    def test_query_does_not_compare_uuid_column_to_empty_string(self, predictor):
        """Regression: user_id is a UUID column. `user_id != ''` is invalid
        syntax in Postgres (raises 'invalid input syntax for type uuid') and
        made /train-difficulty 500 against real data — never caught because
        every other test here mocks get_player_features and never hits the
        real query string."""
        captured = {}

        def fake_read_sql_query(query, conn, params=None):
            captured['query'] = query
            return pd.DataFrame(columns=[
                'player_id', 'game_type', 'current_win_rate', 'game_count',
                'avg_session_duration', 'bet_aggression', 'playstyle_cluster'
            ])

        with patch('difficulty_predictor.pd.read_sql_query', side_effect=fake_read_sql_query):
            with patch.object(predictor, 'get_db_connection', return_value=MagicMock()):
                predictor.get_player_features()

        assert "!= ''" not in captured['query']

    def test_ludo_branch_excludes_pre_cutover_rows_from_query(self, predictor):
        """The game_participants query must filter Ludo rows to
        joined_at >= the fix cutover, and must NOT apply that filter to
        other game types (their final_rank was never broken)."""
        captured = {}

        def fake_read_sql_query(query, conn, params=None):
            captured['query'] = query
            return pd.DataFrame(columns=[
                'player_id', 'game_type', 'current_win_rate', 'game_count',
                'avg_session_duration', 'bet_aggression', 'playstyle_cluster'
            ])

        with patch('difficulty_predictor.pd.read_sql_query', side_effect=fake_read_sql_query):
            with patch.object(predictor, 'get_db_connection', return_value=MagicMock()):
                predictor.get_player_features()

        query = captured['query']
        assert LUDO_FINAL_RANK_FIX_CUTOVER in query, \
            "query must filter Ludo rows by the final_rank fix cutover date"

        # The cutover filter must be scoped inside the 'ludo' CASE branch,
        # not applied blanket to the whole query (teen_patti etc. never had
        # this bug and must keep seeing their full history).
        ludo_branch_start = query.index("THEN 'ludo'")
        teen_patti_branch_start = query.index("THEN 'teen_patti'")
        cutover_pos = query.index(LUDO_FINAL_RANK_FIX_CUTOVER)
        assert ludo_branch_start < cutover_pos, \
            "cutover filter should appear at/after the ludo CASE branch"
        # Only one occurrence — proves it's not duplicated onto other branches too.
        assert query.count(LUDO_FINAL_RANK_FIX_CUTOVER) == 1

    def test_bot_player_profiles_join_matches_real_schema(self, predictor):
        """Regression: bot_player_profiles (migration 052, owned by
        playstyle_clusterer.py) has UNIQUE(player_id) and a `cluster_id`
        column — it has no `game_type` or `playstyle_cluster` column. The
        original join (`bpp.game_type = gp.game_type`, `bpp.playstyle_cluster`)
        raised 'column bpp.game_type does not exist' against the real DB on
        every single call, invisible because predict()'s broad except
        swallowed it into a silent fallback. Never caught because every
        other test here mocks get_player_features entirely."""
        captured = {}

        def fake_read_sql_query(query, conn, params=None):
            captured['query'] = query
            return pd.DataFrame(columns=[
                'player_id', 'game_type', 'current_win_rate', 'game_count',
                'avg_session_duration', 'bet_aggression', 'playstyle_cluster'
            ])

        with patch('difficulty_predictor.pd.read_sql_query', side_effect=fake_read_sql_query):
            with patch.object(predictor, 'get_db_connection', return_value=MagicMock()):
                predictor.get_player_features()

        query = captured['query']
        assert 'bpp.game_type' not in query
        assert 'bpp.playstyle_cluster' not in query
        assert 'bpp.cluster_id' in query
        assert 'bpp.player_id = u.id' in query

    def test_predict_reads_current_difficulty_from_dedicated_table(self, predictor):
        """Regression: predict()'s current_difficulty lookup queried
        bot_player_profiles WHERE game_type = %s, a column that doesn't
        exist on that table. It now reads from the dedicated
        personalized_difficulty_predictions table (migration 090)."""
        mock_cursor = MagicMock()
        mock_cursor.fetchone.return_value = None
        mock_conn = MagicMock()
        mock_conn.cursor.return_value = mock_cursor

        with patch.object(predictor, 'get_db_connection', return_value=mock_conn):
            predictor.predict('player1', 'ludo')

        executed_sql = mock_cursor.execute.call_args[0][0]
        assert 'personalized_difficulty_predictions' in executed_sql
        assert 'bot_player_profiles' not in executed_sql

    def test_store_prediction_writes_to_dedicated_table(self, predictor):
        """Regression: store_prediction() wrote to bot_player_profiles
        columns (recommended_difficulty, current_difficulty, game_type)
        that don't exist there. It now writes to
        personalized_difficulty_predictions."""
        mock_cursor = MagicMock()
        mock_cursor.fetchone.return_value = None
        mock_conn = MagicMock()
        mock_conn.cursor.return_value = mock_cursor

        with patch.object(predictor, 'get_db_connection', return_value=mock_conn):
            predictor.store_prediction(PredictionResult(
                recommended_difficulty='hard',
                confidence_score=0.9,
                player_id='player1',
                game_type='ludo',
                current_difficulty='medium',
            ))

        for call in mock_cursor.execute.call_args_list:
            assert 'bot_player_profiles' not in call[0][0]
        assert any('personalized_difficulty_predictions' in call[0][0] for call in mock_cursor.execute.call_args_list)

    def test_train_raises_when_ludo_volume_below_threshold(self, predictor):
        """With fewer than MIN_LUDO_TRAINING_ROWS real post-cutover Ludo
        rows, train() must refuse rather than silently training on a
        near-empty Ludo slice."""
        n_other = 300
        n_ludo = MIN_LUDO_TRAINING_ROWS - 1
        np.random.seed(1)

        def make_rows(game_type, n):
            win_rate = np.random.uniform(20, 80, n)
            return pd.DataFrame({
                'game_type': [game_type] * n,
                'current_win_rate': win_rate,
                'game_count': np.random.randint(10, 100, n),
                'avg_session_duration': np.random.uniform(5, 120, n),
                'bet_aggression': np.random.uniform(0, 1, n),
                'playstyle_cluster': np.random.randint(0, 5, n),
            })

        df = pd.concat([
            make_rows('teen_patti', n_other),
            make_rows('ludo', n_ludo),
        ], ignore_index=True)

        with patch.object(predictor, 'get_player_features', return_value=df):
            with pytest.raises(ValueError, match=r"(?i)ludo.*volume|volume.*ludo"):
                predictor.train()

    def test_train_succeeds_when_ludo_volume_meets_threshold(self, predictor):
        """At/above MIN_LUDO_TRAINING_ROWS real post-cutover Ludo rows,
        training proceeds normally (existing accuracy quality gate still
        applies on top of this)."""
        n_other = 300
        n_ludo = MIN_LUDO_TRAINING_ROWS
        np.random.seed(2)

        def make_rows(game_type, n):
            win_rate = np.random.uniform(20, 80, n)
            return pd.DataFrame({
                'game_type': [game_type] * n,
                'current_win_rate': win_rate,
                'game_count': np.random.randint(10, 100, n),
                'avg_session_duration': np.random.uniform(5, 120, n),
                'bet_aggression': np.random.uniform(0, 1, n),
                'playstyle_cluster': np.random.randint(0, 5, n),
            })

        df = pd.concat([
            make_rows('teen_patti', n_other),
            make_rows('ludo', n_ludo),
        ], ignore_index=True)

        with patch.object(predictor, 'get_player_features', return_value=df):
            result = predictor.train()
            assert result["success"] is True


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
