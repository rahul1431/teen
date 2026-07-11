"""
Task 16: A/B Experiment Statistical Analysis
Implements statistical testing for A/B experiments including confidence intervals,
significance testing, and sample size estimation.
"""

import math
from typing import Dict, List, Tuple, Optional
from dataclasses import dataclass
from scipy import stats
import numpy as np


@dataclass
class ExperimentMetrics:
    """Container for experiment metrics."""
    sample_size: int
    success_count: int
    success_rate: float
    mean: Optional[float] = None
    std: Optional[float] = None


@dataclass
class ConfidenceInterval:
    """Confidence interval result."""
    lower: float
    upper: float
    point_estimate: float
    confidence_level: float = 0.95


@dataclass
class StatisticalResult:
    """Result of statistical test."""
    p_value: float
    is_significant: bool
    test_name: str
    effect_size: Optional[float] = None


@dataclass
class SampleSizeEstimate:
    """Sample size estimation result."""
    required_sample_size: int
    power: float
    effect_size: float
    alpha: float
    description: str


@dataclass
class ExperimentAnalysisResult:
    """Complete experiment analysis result."""
    control_ci: ConfidenceInterval
    experimental_ci: ConfidenceInterval
    significance_test: StatisticalResult
    sample_size_estimate: SampleSizeEstimate
    recommendation: str
    winner: Optional[str]
    details: Dict


class ExperimentAnalyzer:
    """Performs statistical analysis on A/B experiment data."""

    CONFIDENCE_LEVEL = 0.95
    ALPHA = 0.05  # For p < 0.05 significance
    MIN_SAMPLES_FOR_ANALYSIS = 30
    POWER = 0.80  # 80% power for sample size estimation

    @staticmethod
    def calculate_binomial_confidence_interval(
        successes: int,
        trials: int,
        confidence: float = 0.95
    ) -> ConfidenceInterval:
        """
        Calculate confidence interval for binary outcome using Wilson score method.
        Robust for small sample sizes and extreme proportions.
        """
        if trials == 0:
            return ConfidenceInterval(
                lower=0.0,
                upper=1.0,
                point_estimate=0.0,
                confidence_level=confidence
            )

        p_hat = successes / trials
        z = stats.norm.ppf((1 + confidence) / 2)
        denominator = 1 + z**2 / trials

        centre_adjusted_p = (p_hat + z**2 / (2 * trials)) / denominator
        adjusted_std = math.sqrt(
            (p_hat * (1 - p_hat) / trials + z**2 / (4 * trials**2)) / denominator
        )

        lower = centre_adjusted_p - z * adjusted_std
        upper = centre_adjusted_p + z * adjusted_std

        return ConfidenceInterval(
            lower=max(0.0, lower),
            upper=min(1.0, upper),
            point_estimate=p_hat,
            confidence_level=confidence
        )

    @staticmethod
    def calculate_continuous_confidence_interval(
        values: List[float],
        confidence: float = 0.95
    ) -> ConfidenceInterval:
        """
        Calculate confidence interval for continuous metrics (ROI) using t-test.
        Uses Student's t-distribution for sample data.
        """
        if len(values) == 0:
            return ConfidenceInterval(
                lower=0.0,
                upper=0.0,
                point_estimate=0.0,
                confidence_level=confidence
            )

        values_array = np.array(values)
        mean = float(np.mean(values_array))
        std_error = float(stats.sem(values_array))

        # Use t-distribution (appropriate for sample data)
        df = len(values) - 1
        t_score = stats.t.ppf((1 + confidence) / 2, df)

        margin_of_error = t_score * std_error

        return ConfidenceInterval(
            lower=mean - margin_of_error,
            upper=mean + margin_of_error,
            point_estimate=mean,
            confidence_level=confidence
        )

    @staticmethod
    def chi_square_test(
        control_successes: int,
        control_trials: int,
        experimental_successes: int,
        experimental_trials: int
    ) -> StatisticalResult:
        """
        Perform chi-square test for independence between group and outcome.
        Tests if retention/win rates differ significantly between variants.
        """
        # Contingency table
        # Format: [control_success, control_failure], [experimental_success, experimental_failure]
        contingency_table = np.array([
            [control_successes, control_trials - control_successes],
            [experimental_successes, experimental_trials - experimental_successes]
        ])

        # Check for sufficient sample size
        if np.any(contingency_table < 5):
            # Use Fisher's exact test for small samples (but only for 2x2 tables)
            odds_ratio, p_value = stats.fisher_exact(contingency_table)
            return StatisticalResult(
                p_value=p_value,
                is_significant=p_value < ExperimentAnalyzer.ALPHA,
                test_name="Fisher's Exact Test",
                effect_size=None
            )

        chi2, p_value, dof, expected = stats.chi2_contingency(contingency_table)

        # Calculate Cramér's V as effect size
        n = np.sum(contingency_table)
        cramers_v = math.sqrt(chi2 / (n * (min(contingency_table.shape) - 1)))

        return StatisticalResult(
            p_value=p_value,
            is_significant=p_value < ExperimentAnalyzer.ALPHA,
            test_name="Chi-Square Test",
            effect_size=cramers_v
        )

    @staticmethod
    def t_test_for_continuous(
        control_values: List[float],
        experimental_values: List[float]
    ) -> StatisticalResult:
        """
        Perform independent samples t-test for continuous metrics (ROI).
        Tests if mean ROI differs significantly between variants.
        """
        if len(control_values) < 2 or len(experimental_values) < 2:
            return StatisticalResult(
                p_value=1.0,
                is_significant=False,
                test_name="Welch's t-test",
                effect_size=None
            )

        t_stat, p_value = stats.ttest_ind(
            control_values,
            experimental_values,
            equal_var=False  # Welch's t-test (does not assume equal variances)
        )

        # Calculate Cohen's d as effect size
        control_mean = np.mean(control_values)
        experimental_mean = np.mean(experimental_values)
        control_std = np.std(control_values, ddof=1)
        experimental_std = np.std(experimental_values, ddof=1)

        pooled_std = math.sqrt(
            ((len(control_values) - 1) * control_std**2 +
             (len(experimental_values) - 1) * experimental_std**2) /
            (len(control_values) + len(experimental_values) - 2)
        )

        cohens_d = (experimental_mean - control_mean) / pooled_std if pooled_std > 0 else 0

        return StatisticalResult(
            p_value=p_value,
            is_significant=p_value < ExperimentAnalyzer.ALPHA,
            test_name="Welch's t-test",
            effect_size=cohens_d
        )

    @staticmethod
    def estimate_sample_size_for_proportion(
        baseline_rate: float,
        minimum_detectable_effect: float = 0.05,
        power: float = 0.80,
        alpha: float = 0.05
    ) -> SampleSizeEstimate:
        """
        Estimate sample size needed per group to detect minimum effect.
        Uses two-tailed test for proportions (retention, win rate).

        Args:
            baseline_rate: Control group success rate (0-1)
            minimum_detectable_effect: Smallest difference we want to detect
            power: Statistical power (default 0.80 = 80%)
            alpha: Significance level (default 0.05)

        Returns:
            Sample size per group needed to achieve desired power
        """
        # Using Fleiss formula for two-tailed test
        z_alpha = stats.norm.ppf(1 - alpha / 2)
        z_beta = stats.norm.ppf(power)

        p1 = baseline_rate
        p2 = baseline_rate + minimum_detectable_effect
        p_avg = (p1 + p2) / 2

        numerator = (z_alpha * math.sqrt(2 * p_avg * (1 - p_avg)) +
                     z_beta * math.sqrt(p1 * (1 - p1) + p2 * (1 - p2)))**2
        denominator = (p2 - p1)**2

        required_per_group = int(math.ceil(numerator / denominator))

        return SampleSizeEstimate(
            required_sample_size=required_per_group,
            power=power,
            effect_size=minimum_detectable_effect,
            alpha=alpha,
            description=f"Need {required_per_group} samples per group to detect {minimum_detectable_effect*100:.1f}% difference at {power*100:.0f}% power"
        )

    @classmethod
    def analyze_experiment(
        cls,
        control_metrics: ExperimentMetrics,
        experimental_metrics: ExperimentMetrics,
        metric_type: str = "retention",
        experimental_values: Optional[List[float]] = None,
        control_values: Optional[List[float]] = None
    ) -> ExperimentAnalysisResult:
        """
        Perform comprehensive statistical analysis of A/B experiment.

        Args:
            control_metrics: Metrics for control group
            experimental_metrics: Metrics for experimental group
            metric_type: Type of metric ('retention' for binary, 'roi' for continuous)
            experimental_values: Individual values for experimental group (for continuous metrics)
            control_values: Individual values for control group (for continuous metrics)

        Returns:
            Complete analysis result with recommendation
        """
        details = {
            "control_sample_size": control_metrics.sample_size,
            "experimental_sample_size": experimental_metrics.sample_size,
            "metric_type": metric_type
        }

        # Check minimum sample size
        min_samples = cls.MIN_SAMPLES_FOR_ANALYSIS
        insufficient_data = (
            control_metrics.sample_size < min_samples or
            experimental_metrics.sample_size < min_samples
        )

        if metric_type == "retention":
            # Binary outcome analysis
            control_ci = cls.calculate_binomial_confidence_interval(
                control_metrics.success_count,
                control_metrics.sample_size,
                cls.CONFIDENCE_LEVEL
            )

            experimental_ci = cls.calculate_binomial_confidence_interval(
                experimental_metrics.success_count,
                experimental_metrics.sample_size,
                cls.CONFIDENCE_LEVEL
            )

            # Significance test
            significance_test = cls.chi_square_test(
                control_metrics.success_count,
                control_metrics.sample_size,
                experimental_metrics.success_count,
                experimental_metrics.sample_size
            )

            # Sample size estimation
            baseline_rate = control_metrics.success_rate
            experimental_rate = experimental_metrics.success_rate
            mde = abs(experimental_rate - baseline_rate) if baseline_rate > 0 else 0.05
            mde = max(mde, 0.05)  # Minimum detectable effect of 5%

            sample_size_estimate = cls.estimate_sample_size_for_proportion(
                baseline_rate,
                mde,
                cls.POWER,
                cls.ALPHA
            )

        else:  # continuous metric (ROI)
            # Continuous outcome analysis
            if control_values is None or experimental_values is None:
                control_values = control_values or [control_metrics.mean] * max(1, control_metrics.sample_size)
                experimental_values = experimental_values or [experimental_metrics.mean] * max(1, experimental_metrics.sample_size)

            control_ci = cls.calculate_continuous_confidence_interval(
                control_values,
                cls.CONFIDENCE_LEVEL
            )

            experimental_ci = cls.calculate_continuous_confidence_interval(
                experimental_values,
                cls.CONFIDENCE_LEVEL
            )

            # Significance test
            significance_test = cls.t_test_for_continuous(
                control_values,
                experimental_values
            )

            # Sample size for continuous: use baseline std and effect size
            control_std = np.std(control_values, ddof=1) if len(control_values) > 1 else 1.0
            baseline_mean = float(np.mean(control_values))
            effect_size = 0.5  # Medium effect size (Cohen's d)

            # For continuous: n = (2 * (Z_alpha + Z_beta)^2 * sigma^2) / delta^2
            z_alpha = stats.norm.ppf(1 - cls.ALPHA / 2)
            z_beta = stats.norm.ppf(cls.POWER)
            required_per_group = int(math.ceil(
                2 * ((z_alpha + z_beta) * control_std / effect_size)**2
            ))

            sample_size_estimate = SampleSizeEstimate(
                required_sample_size=required_per_group,
                power=cls.POWER,
                effect_size=effect_size,
                alpha=cls.ALPHA,
                description=f"Need {required_per_group} samples per group for medium effect size at {cls.POWER*100:.0f}% power"
            )

        details["control_ci_lower"] = float(control_ci.lower)
        details["control_ci_upper"] = float(control_ci.upper)
        details["experimental_ci_lower"] = float(experimental_ci.lower)
        details["experimental_ci_upper"] = float(experimental_ci.upper)
        details["p_value"] = float(significance_test.p_value)
        details["test_name"] = significance_test.test_name
        details["effect_size"] = float(significance_test.effect_size) if significance_test.effect_size is not None else None

        # Determine winner and recommendation
        winner = None
        if insufficient_data:
            recommendation = "Insufficient data"
            winner = "inconclusive"
        elif not significance_test.is_significant:
            recommendation = "Insufficient statistical power - No clear winner"
            winner = "inconclusive"
        elif experimental_ci.point_estimate > control_ci.point_estimate:
            recommendation = "Experimental wins"
            winner = "experimental"
        else:
            recommendation = "Control wins"
            winner = "control"

        return ExperimentAnalysisResult(
            control_ci=control_ci,
            experimental_ci=experimental_ci,
            significance_test=significance_test,
            sample_size_estimate=sample_size_estimate,
            recommendation=recommendation,
            winner=winner,
            details=details
        )


class ExperimentDatabaseIntegration:
    """Handles database operations for experiment tracking and results storage."""

    @staticmethod
    def log_player_assignment(
        player_id: str,
        experiment_id: str,
        variant: str,
        db_connection
    ) -> bool:
        """Log player's experiment assignment."""
        try:
            cursor = db_connection.cursor()
            cursor.execute("""
                INSERT INTO experiment_assignments
                (player_id, experiment_id, variant, assigned_at)
                VALUES (%s, %s, %s, NOW())
                ON CONFLICT (player_id, experiment_id) DO NOTHING
            """, (player_id, experiment_id, variant))
            db_connection.commit()
            return True
        except Exception as e:
            print(f"Error logging player assignment: {e}")
            return False

    @staticmethod
    def update_player_outcome(
        player_id: str,
        experiment_id: str,
        retention_status: Optional[str],
        roi: Optional[float],
        win_rate: Optional[float],
        games_played: int,
        db_connection
    ) -> bool:
        """Update player outcome for an experiment."""
        try:
            cursor = db_connection.cursor()
            cursor.execute("""
                UPDATE experiment_assignments
                SET
                    retention_status = %s,
                    roi = %s,
                    win_rate = %s,
                    games_played = %s,
                    last_activity_at = NOW()
                WHERE player_id = %s AND experiment_id = %s
            """, (retention_status, roi, win_rate, games_played, player_id, experiment_id))
            db_connection.commit()
            return True
        except Exception as e:
            print(f"Error updating player outcome: {e}")
            return False

    @staticmethod
    def store_experiment_results(
        experiment_id: str,
        analysis_result: ExperimentAnalysisResult,
        db_connection
    ) -> bool:
        """Store analysis results in a_b_experiments table."""
        try:
            cursor = db_connection.cursor()

            # Prepare control and experimental metrics
            control_retention = analysis_result.control_ci.point_estimate if analysis_result.details.get("metric_type") == "retention" else None
            control_avg_roi = analysis_result.control_ci.point_estimate if analysis_result.details.get("metric_type") == "roi" else None
            experimental_retention = analysis_result.experimental_ci.point_estimate if analysis_result.details.get("metric_type") == "retention" else None
            experimental_avg_roi = analysis_result.experimental_ci.point_estimate if analysis_result.details.get("metric_type") == "roi" else None

            cursor.execute("""
                UPDATE a_b_experiments
                SET
                    control_retention = %s,
                    control_avg_roi = %s,
                    experimental_retention = %s,
                    experimental_avg_roi = %s,
                    winner = %s
                WHERE id = %s
            """, (
                control_retention,
                control_avg_roi,
                experimental_retention,
                experimental_avg_roi,
                analysis_result.winner,
                experiment_id
            ))
            db_connection.commit()
            return True
        except Exception as e:
            print(f"Error storing experiment results: {e}")
            return False

    @staticmethod
    def fetch_experiment_data(
        experiment_id: str,
        db_connection
    ) -> Tuple[ExperimentMetrics, ExperimentMetrics]:
        """Fetch experiment data for analysis."""
        try:
            cursor = db_connection.cursor()

            # Fetch control group metrics
            cursor.execute("""
                SELECT
                    COUNT(*) as sample_size,
                    SUM(CASE WHEN retention_status = 'retained' THEN 1 ELSE 0 END) as success_count,
                    AVG(roi) as avg_roi,
                    STDDEV(roi) as stddev_roi
                FROM experiment_assignments
                WHERE experiment_id = %s AND variant = 'control'
            """, (experiment_id,))

            control_row = cursor.fetchone()
            control_sample = control_row[0] or 0
            control_successes = control_row[1] or 0
            control_metrics = ExperimentMetrics(
                sample_size=int(control_sample),
                success_count=int(control_successes),
                success_rate=control_successes / control_sample if control_sample > 0 else 0,
                mean=float(control_row[2]) if control_row[2] is not None else 0,
                std=float(control_row[3]) if control_row[3] is not None else 0
            )

            # Fetch experimental group metrics
            cursor.execute("""
                SELECT
                    COUNT(*) as sample_size,
                    SUM(CASE WHEN retention_status = 'retained' THEN 1 ELSE 0 END) as success_count,
                    AVG(roi) as avg_roi,
                    STDDEV(roi) as stddev_roi
                FROM experiment_assignments
                WHERE experiment_id = %s AND variant = 'experimental'
            """, (experiment_id,))

            experimental_row = cursor.fetchone()
            experimental_sample = experimental_row[0] or 0
            experimental_successes = experimental_row[1] or 0
            experimental_metrics = ExperimentMetrics(
                sample_size=int(experimental_sample),
                success_count=int(experimental_successes),
                success_rate=experimental_successes / experimental_sample if experimental_sample > 0 else 0,
                mean=float(experimental_row[2]) if experimental_row[2] is not None else 0,
                std=float(experimental_row[3]) if experimental_row[3] is not None else 0
            )

            return control_metrics, experimental_metrics
        except Exception as e:
            print(f"Error fetching experiment data: {e}")
            return ExperimentMetrics(0, 0, 0), ExperimentMetrics(0, 0, 0)
