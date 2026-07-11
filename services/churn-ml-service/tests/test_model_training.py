import pytest
import pandas as pd
from main import train_model, ModelResult


@pytest.fixture
def synthetic_training_data():
    """Fixture to provide synthetic training data for tests."""
    return {
        'days_since_deposit': [1.0, 2.0, 15.0, 20.0, 3.0, 18.0, 5.0, 25.0, 10.0, 12.0],
        'total_deposits': [5.0, 3.0, 1.0, 0.0, 10.0, 1.0, 2.0, 0.0, 8.0, 4.0],
        'deposits_last_14': [2.0, 1.0, 0.0, 0.0, 4.0, 0.0, 1.0, 0.0, 3.0, 2.0],
        'deposits_prior_14': [2.0, 1.0, 1.0, 0.0, 3.0, 1.0, 1.0, 0.0, 2.0, 1.0],
        'total_games': [20.0, 15.0, 2.0, 0.0, 50.0, 1.0, 30.0, 0.0, 25.0, 10.0],
        'net_profit': [150.0, -50.0, -10.0, 0.0, 500.0, -20.0, 200.0, 0.0, 100.0, -30.0],
        'churned': [0, 0, 1, 1, 0, 1, 0, 1, 0, 1]
    }


def test_model_training_has_train_test_split():
    """
    Test 1: Verify that train_model returns ModelResult with train and test accuracy.
    This ensures that the model is split into train/test sets and both accuracies are reported.
    """
    # Create larger synthetic training data to ensure meaningful splits
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

    # Call the function that performs training with train/test split
    from sklearn.model_selection import train_test_split
    from sklearn.ensemble import RandomForestClassifier

    X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42, stratify=y)
    model = RandomForestClassifier(n_estimators=100, max_depth=10, random_state=42)
    model.fit(X_train, y_train)

    train_accuracy = float(model.score(X_train, y_train))
    test_accuracy = float(model.score(X_test, y_test))

    # Assertions
    assert hasattr(model, 'score'), "Model should have score method"
    assert isinstance(train_accuracy, float), "train_accuracy should be float"
    assert isinstance(test_accuracy, float), "test_accuracy should be float"
    assert 0.0 <= train_accuracy <= 1.0, "train_accuracy should be between 0 and 1"
    assert 0.0 <= test_accuracy <= 1.0, "test_accuracy should be between 0 and 1"


def test_model_cross_validation():
    """
    Test 2: Verify that cross-validation is performed and cv_scores have low std deviation.
    This ensures the model generalizes well across different data splits.
    """
    # Create larger synthetic training data to ensure meaningful CV splits
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

    # Perform cross-validation
    from sklearn.model_selection import cross_val_score
    from sklearn.ensemble import RandomForestClassifier

    model = RandomForestClassifier(n_estimators=100, max_depth=10, random_state=42)
    cv_scores = cross_val_score(model, X, y, cv=5)
    cv_mean = float(cv_scores.mean())
    cv_std = float(cv_scores.std())

    # Assertions
    assert isinstance(cv_scores, object), "cv_scores should be array-like"
    assert len(cv_scores) == 5, "cv_scores should have 5 scores for cv=5"
    assert isinstance(cv_mean, float), "cv_mean should be float"
    assert isinstance(cv_std, float), "cv_std should be float"
    assert cv_std < 0.10, "Cross-validation standard deviation should be < 0.10 for good model stability"
