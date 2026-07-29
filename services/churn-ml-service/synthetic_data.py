import os
import logging
import numpy as np
import pandas as pd
import psycopg2
from typing import Dict, Tuple, Any, List

logger = logging.getLogger("churn-ml-service")

DATABASE_URL = os.getenv("DATABASE_URL")


def get_db_connection():
    """Get PostgreSQL database connection"""
    return psycopg2.connect(DATABASE_URL)


def get_empirical_distribution() -> Dict[str, Any]:
    """
    Query real user percentiles from database to derive empirical distribution parameters.
    Returns dictionary with distribution parameters for each feature.
    Falls back to reasonable defaults if insufficient data.
    """
    try:
        conn = get_db_connection()
        query = """
        SELECT
          COALESCE(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (NOW() - MAX(wt.created_at))) / 86400), 15.0) as p50_days,
          COALESCE(PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (NOW() - MAX(wt.created_at))) / 86400), 30.0) as p75_days,
          COALESCE(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (NOW() - MAX(wt.created_at))) / 86400), 60.0) as p95_days,
          COALESCE(AVG(COUNT(wt.id)::float), 3.0) as avg_deposits,
          COALESCE(STDDEV(COUNT(wt.id)::float), 2.0) as stddev_deposits,
          COALESCE(AVG(gp.total_profit), 50.0) as avg_profit,
          COALESCE(STDDEV(gp.total_profit), 150.0) as stddev_profit,
          COALESCE(AVG(gp.games_played), 15.0) as avg_games
        FROM users u
        LEFT JOIN wallet_transactions wt ON wt.user_id = u.id AND wt.type = 'deposit' AND wt.status = 'completed'
        LEFT JOIN (
          SELECT
            user_id,
            COUNT(id) as games_played,
            SUM(prize_won - COALESCE(entry_fee_deducted, 0)) as total_profit
          FROM game_participants
          GROUP BY user_id
        ) gp ON gp.user_id = u.id
        WHERE u.is_bot = false AND u.status = 'active'
        GROUP BY u.id
        """

        cursor = conn.cursor()
        cursor.execute(query)
        result = cursor.fetchone()
        conn.close()

        if result:
            return {
                "p50_days_since_deposit": max(float(result[0]) if result[0] else 15.0, 0.1),
                "p75_days_since_deposit": max(float(result[1]) if result[1] else 30.0, 0.1),
                "p95_days_since_deposit": max(float(result[2]) if result[2] else 60.0, 0.1),
                "mean_deposits": max(float(result[3]) if result[3] else 3.0, 0.1),
                "stddev_deposits": max(float(result[4]) if result[4] else 2.0, 0.1),
                "mean_profit": float(result[5]) if result[5] else 50.0,
                "stddev_profit": max(float(result[6]) if result[6] else 150.0, 1.0),
                "mean_games": max(float(result[7]) if result[7] else 15.0, 0.1),
            }
    except Exception as e:
        logger.warning(f"Failed to query empirical distribution from DB: {e}. Using defaults.")

    # Default empirical distribution based on typical user behavior
    return {
        "p50_days_since_deposit": 15.0,
        "p75_days_since_deposit": 30.0,
        "p95_days_since_deposit": 60.0,
        "mean_deposits": 3.0,
        "stddev_deposits": 2.0,
        "mean_profit": 50.0,
        "stddev_profit": 150.0,
        "mean_games": 15.0,
    }


def generate_synthetic_training_data(n_samples: int) -> pd.DataFrame:
    """
    Generate realistic synthetic training data using numpy distributions.
    Distributions based on empirical analysis of typical user behavior:
    - days_since_deposit: Log-normal (most recent, long tail to very old)
    - total_deposits: Poisson (count data)
    - deposits_last_14: Binomial from total_deposits
    - deposits_prior_14: Binomial from remainder
    - total_games: Poisson (count data)
    - net_profit: Normal (can be negative)
    - churned: Binary, based on days_since_deposit and deposit activity
    """
    empirical = get_empirical_distribution()

    np.random.seed(42)  # For reproducibility in tests

    # Generate days_since_deposit using log-normal distribution
    # Using median and percentile info to parameterize log-normal
    median_days = empirical["p50_days_since_deposit"]
    # For log-normal, median = exp(mu), so mu = ln(median)
    mu_days = np.log(median_days)
    sigma_days = 0.8  # Controls the spread, reasonable for time-based data
    days_since_deposit = np.random.lognormal(mu_days, sigma_days, n_samples)
    days_since_deposit = np.clip(days_since_deposit, 0.1, 365)  # Cap at 1 year

    # Generate total_deposits using Poisson distribution
    mean_deposits = empirical["mean_deposits"]
    total_deposits = np.random.poisson(mean_deposits, n_samples).astype(float)

    # Generate deposits in last 14 days (binomial: subset of total_deposits)
    # Probability of a deposit being recent decreases with days_since_deposit
    deposit_probability = np.exp(-days_since_deposit / 30)  # Exponential decay
    deposit_probability = np.clip(deposit_probability, 0, 1)
    deposits_last_14 = np.random.binomial(
        total_deposits.astype(int),
        deposit_probability,
        n_samples
    ).astype(float)

    # Generate deposits in prior 14 days (what's left from total - last_14)
    max_prior = (total_deposits - deposits_last_14).astype(int)
    deposits_prior_14 = np.minimum(
        np.random.poisson(empirical["mean_deposits"] * 0.3, n_samples),
        max_prior
    ).astype(float)

    # Generate total_games using Poisson, correlated with deposit activity
    base_games = empirical["mean_games"]
    game_intensity = 0.5 + (deposits_last_14 / (total_deposits + 1)) * 0.5  # More recent activity = more games
    total_games = np.random.poisson(base_games * game_intensity, n_samples).astype(float)

    # Generate net_profit using normal distribution
    # Can be negative (losses) or positive (wins)
    mean_profit = empirical["mean_profit"]
    stddev_profit = empirical["stddev_profit"]
    net_profit = np.random.normal(mean_profit, stddev_profit, n_samples)

    # Generate churned label
    # A user is churned if: no deposits in last 14 days AND days_since_deposit > 14
    churned = (
        (deposits_last_14 == 0) &
        (days_since_deposit > 14)
    ).astype(int)
    # Add some probabilistic churn for edge cases
    churn_probability = np.minimum(days_since_deposit / 30, 1.0)
    churned = np.where(
        np.random.random(n_samples) < churn_probability * 0.3,
        1,
        churned
    )

    # Create DataFrame
    data = pd.DataFrame({
        'days_since_deposit': days_since_deposit,
        'total_deposits': total_deposits,
        'deposits_last_14': deposits_last_14,
        'deposits_prior_14': deposits_prior_14,
        'total_games': total_games,
        'net_profit': net_profit,
        'churned': churned
    })

    return data


def validate_synthetic_data(data: pd.DataFrame) -> Tuple[bool, List[str]]:
    """
    Validate synthetic data for:
    - No NaN or Inf values
    - Reasonable ranges for each feature
    - Logical constraints between features

    Returns:
        Tuple[bool, List[str]]: (is_valid, error_messages)
    """
    errors = []

    # Check for NaN and Inf
    if data.isnull().any().any():
        errors.append("Data contains NaN values")

    if np.isinf(data.select_dtypes(include=[np.number])).any().any():
        errors.append("Data contains Inf values")

    # Check days_since_deposit
    if not (data['days_since_deposit'] >= 0).all():
        errors.append("days_since_deposit contains negative values")
    if not (data['days_since_deposit'] <= 365).all():
        errors.append("days_since_deposit exceeds reasonable bounds (365 days)")

    # Check deposit counts
    if not (data['total_deposits'] >= 0).all():
        errors.append("total_deposits contains negative values")

    if not (data['deposits_last_14'] >= 0).all():
        errors.append("deposits_last_14 contains negative values")

    if not (data['deposits_prior_14'] >= 0).all():
        errors.append("deposits_prior_14 contains negative values")

    # Check that period deposits don't exceed total
    if not (data['deposits_last_14'] <= data['total_deposits']).all():
        errors.append("deposits_last_14 exceeds total_deposits")

    if not (data['deposits_prior_14'] <= data['total_deposits']).all():
        errors.append("deposits_prior_14 exceeds total_deposits")

    # Check total_games
    if not (data['total_games'] >= 0).all():
        errors.append("total_games contains negative values")

    # Check churned is binary
    if not set(data['churned'].unique()).issubset({0, 1}):
        errors.append("churned values are not binary (0 or 1)")

    is_valid = len(errors) == 0
    return is_valid, errors
