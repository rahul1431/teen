"""
Test suite for A/B Experiment Statistical Analysis (Task 16)
Tests for confidence intervals, significance testing, sample size estimation, and recommendations.
"""

import pytest
import sys
import os
from typing import List

# Add parent/src directory to path for imports
src_path = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'src'))
if src_path not in sys.path:
    sys.path.insert(0, src_path)

from experiment_analyzer import (
    ExperimentAnalyzer,
    ExperimentMetrics,
    ConfidenceInterval,
    StatisticalResult,
    ExperimentAnalysisResult
)


class TestConfidenceIntervals:
    """Test Case 1: Confidence Interval Calculations"""

    def test_binomial_ci_normal_case(self):
        """Should calculate binomial confidence interval correctly for normal sample size."""
        analyzer = ExperimentAnalyzer()

        # Simulate: 75 out of 100 retained
        ci = analyzer.calculate_binomial_confidence_interval(
            successes=75,
            trials=100,
            confidence=0.95
        )

        assert isinstance(ci, ConfidenceInterval)
        assert ci.point_estimate == 0.75
        assert ci.lower < ci.point_estimate < ci.upper
        assert ci.lower >= 0.0 and ci.upper <= 1.0
        assert abs(ci.upper - ci.lower) < 0.2  # CI should be reasonably tight

    def test_binomial_ci_edge_cases(self):
        """Should handle edge cases: zero successes, all successes."""
        analyzer = ExperimentAnalyzer()

        # All failures
        ci_zero = analyzer.calculate_binomial_confidence_interval(0, 100, 0.95)
        assert ci_zero.point_estimate == 0.0
        assert ci_zero.lower >= 0.0
        assert ci_zero.upper > 0.0  # Should still have upper bound

        # All successes
        ci_all = analyzer.calculate_binomial_confidence_interval(100, 100, 0.95)
        assert ci_all.point_estimate == 1.0
        assert ci_all.lower < 1.0  # Should still have lower bound
        assert ci_all.upper <= 1.0

    def test_binomial_ci_small_samples(self):
        """Should handle small sample sizes using Wilson score interval."""
        analyzer = ExperimentAnalyzer()

        # Only 10 samples, 8 successes
        ci = analyzer.calculate_binomial_confidence_interval(8, 10, 0.95)
        assert ci.point_estimate == 0.8
        # Wilson score interval for small samples gives reasonable bounds
        assert ci.lower > 0.3  # Should be reasonably shifted
        assert ci.upper < 1.0
        assert ci.lower < ci.point_estimate < ci.upper

    def test_continuous_ci_t_distribution(self):
        """Should calculate continuous confidence interval using t-distribution."""
        analyzer = ExperimentAnalyzer()

        # ROI values: average = 100, some variance
        roi_values = [95.0, 98.0, 102.0, 105.0, 99.0, 101.0, 97.0, 103.0, 100.0, 104.0]
        ci = analyzer.calculate_continuous_confidence_interval(roi_values, 0.95)

        assert isinstance(ci, ConfidenceInterval)
        assert ci.point_estimate == pytest.approx(100.4, abs=0.5)  # Mean of values
        assert ci.lower < ci.point_estimate < ci.upper
        assert ci.lower > 95.0  # Reasonable bounds
        assert ci.upper < 106.0

    def test_continuous_ci_empty_values(self):
        """Should handle empty value list."""
        analyzer = ExperimentAnalyzer()

        ci = analyzer.calculate_continuous_confidence_interval([], 0.95)
        assert ci.point_estimate == 0.0
        assert ci.lower == 0.0
        assert ci.upper == 0.0


class TestStatisticalSignificance:
    """Test Case 2: Statistical Significance Detection"""

    def test_chi_square_significant_difference(self):
        """Should detect significant difference when p < 0.05."""
        analyzer = ExperimentAnalyzer()

        # Control: 60/200 retained (30%), Experimental: 90/200 retained (45%)
        # Large difference should be significant
        result = analyzer.chi_square_test(
            control_successes=60,
            control_trials=200,
            experimental_successes=90,
            experimental_trials=200
        )

        assert isinstance(result, StatisticalResult)
        assert result.is_significant == True
        assert result.p_value < 0.05
        assert result.effect_size is not None
        assert result.effect_size > 0  # Cramér's V > 0

    def test_chi_square_no_significant_difference(self):
        """Should not detect significant difference when p >= 0.05."""
        analyzer = ExperimentAnalyzer()

        # Control: 100/200 (50%), Experimental: 102/200 (51%)
        # Small difference should NOT be significant
        result = analyzer.chi_square_test(
            control_successes=100,
            control_trials=200,
            experimental_successes=102,
            experimental_trials=200
        )

        assert result.is_significant == False
        assert result.p_value >= 0.05

    def test_chi_square_fisher_exact_small_samples(self):
        """Should use Fisher's exact test for small samples."""
        analyzer = ExperimentAnalyzer()

        # Very small sample: 3/10 vs 7/10
        result = analyzer.chi_square_test(
            control_successes=3,
            control_trials=10,
            experimental_successes=7,
            experimental_trials=10
        )

        # Should use Fisher's exact test (cells < 5)
        assert result.test_name == "Fisher's Exact Test"
        assert 0 <= result.p_value <= 1

    def test_t_test_significant_roi_difference(self):
        """Should detect significant difference in continuous metric (ROI)."""
        analyzer = ExperimentAnalyzer()

        # Control: ROI around 100, Experimental: ROI around 120
        control_roi = [98.0, 99.0, 101.0, 102.0, 100.0, 98.5, 101.5, 99.5, 100.5, 101.0]
        experimental_roi = [118.0, 120.0, 122.0, 119.0, 121.0, 120.5, 118.5, 122.5, 119.5, 121.0]

        result = analyzer.t_test_for_continuous(control_roi, experimental_roi)

        assert result.is_significant == True
        assert result.p_value < 0.05
        assert result.effect_size is not None
        assert abs(result.effect_size) > 0.5  # Large effect size (Cohen's d)

    def test_t_test_no_significant_difference(self):
        """Should not detect significant difference for similar continuous metrics."""
        analyzer = ExperimentAnalyzer()

        # Both groups have similar ROI
        control_roi = [100.0, 101.0, 99.0, 102.0, 98.0, 101.0, 100.0, 99.5, 100.5, 101.5]
        experimental_roi = [100.5, 101.5, 98.5, 102.5, 97.5, 100.5, 100.5, 99.0, 101.0, 102.0]

        result = analyzer.t_test_for_continuous(control_roi, experimental_roi)

        assert result.is_significant == False
        assert result.p_value >= 0.05


class TestSampleSizeEstimation:
    """Test Case 3: Sample Size Estimation for 80% Power"""

    def test_sample_size_baseline_retention(self):
        """Should estimate sample size for proportion test."""
        analyzer = ExperimentAnalyzer()

        # 40% baseline retention, want to detect 5% improvement
        estimate = analyzer.estimate_sample_size_for_proportion(
            baseline_rate=0.40,
            minimum_detectable_effect=0.05,
            power=0.80,
            alpha=0.05
        )

        assert estimate.required_sample_size > 0
        assert estimate.power == 0.80
        assert estimate.alpha == 0.05
        assert estimate.effect_size == 0.05
        # For 40% baseline and 5% MDE, rough estimate is ~1570 per group
        assert 1000 < estimate.required_sample_size < 2000

    def test_sample_size_smaller_mde(self):
        """Should require larger sample for smaller MDE."""
        analyzer = ExperimentAnalyzer()

        estimate_large = analyzer.estimate_sample_size_for_proportion(0.50, 0.10, 0.80, 0.05)
        estimate_small = analyzer.estimate_sample_size_for_proportion(0.50, 0.05, 0.80, 0.05)

        assert estimate_small.required_sample_size > estimate_large.required_sample_size

    def test_sample_size_higher_power(self):
        """Should require larger sample for higher power."""
        analyzer = ExperimentAnalyzer()

        estimate_80 = analyzer.estimate_sample_size_for_proportion(0.50, 0.10, 0.80, 0.05)
        estimate_90 = analyzer.estimate_sample_size_for_proportion(0.50, 0.10, 0.90, 0.05)

        assert estimate_90.required_sample_size > estimate_80.required_sample_size

    def test_sample_size_description(self):
        """Should provide meaningful description."""
        analyzer = ExperimentAnalyzer()

        estimate = analyzer.estimate_sample_size_for_proportion(0.50, 0.10, 0.80, 0.05)
        assert "samples per group" in estimate.description
        assert "80" in estimate.description  # Should mention 80% power


class TestInsufficientData:
    """Test Case 4: Handling Insufficient Data"""

    def test_analyze_insufficient_control_sample(self):
        """Should recommend insufficient data when control sample < 30."""
        analyzer = ExperimentAnalyzer()

        control = ExperimentMetrics(
            sample_size=10,  # Too small
            success_count=7,
            success_rate=0.7
        )
        experimental = ExperimentMetrics(
            sample_size=100,
            success_count=75,
            success_rate=0.75
        )

        result = analyzer.analyze_experiment(control, experimental, metric_type="retention")

        assert result.winner == "inconclusive"
        assert "Insufficient data" in result.recommendation

    def test_analyze_insufficient_experimental_sample(self):
        """Should recommend insufficient data when experimental sample < 30."""
        analyzer = ExperimentAnalyzer()

        control = ExperimentMetrics(
            sample_size=100,
            success_count=60,
            success_rate=0.6
        )
        experimental = ExperimentMetrics(
            sample_size=10,  # Too small
            success_count=8,
            success_rate=0.8
        )

        result = analyzer.analyze_experiment(control, experimental, metric_type="retention")

        assert result.winner == "inconclusive"
        assert "Insufficient data" in result.recommendation

    def test_analyze_both_insufficient(self):
        """Should handle both samples being too small."""
        analyzer = ExperimentAnalyzer()

        control = ExperimentMetrics(sample_size=5, success_count=3, success_rate=0.6)
        experimental = ExperimentMetrics(sample_size=5, success_count=4, success_rate=0.8)

        result = analyzer.analyze_experiment(control, experimental, metric_type="retention")

        assert result.winner == "inconclusive"
        assert "Insufficient data" in result.recommendation

    def test_analyze_sufficient_minimum_samples(self):
        """Should NOT flag as insufficient when at minimum threshold (30)."""
        analyzer = ExperimentAnalyzer()

        control = ExperimentMetrics(
            sample_size=30,
            success_count=15,
            success_rate=0.5
        )
        experimental = ExperimentMetrics(
            sample_size=30,
            success_count=18,
            success_rate=0.6
        )

        result = analyzer.analyze_experiment(control, experimental, metric_type="retention")

        # Should NOT be marked as insufficient data
        assert result.winner != "inconclusive" or not "Insufficient data" in result.recommendation


class TestWinnerRecommendation:
    """Test Case 5: Winner Recommendation Logic"""

    def test_control_wins_significant(self):
        """Should recommend 'Control wins' when control has higher rate and p < 0.05."""
        analyzer = ExperimentAnalyzer()

        control = ExperimentMetrics(
            sample_size=500,
            success_count=300,  # 60%
            success_rate=0.60
        )
        experimental = ExperimentMetrics(
            sample_size=500,
            success_count=200,  # 40%
            success_rate=0.40
        )

        result = analyzer.analyze_experiment(control, experimental, metric_type="retention")

        assert result.winner == "control"
        assert "Control wins" in result.recommendation
        assert result.significance_test.is_significant == True

    def test_experimental_wins_significant(self):
        """Should recommend 'Experimental wins' when experimental has higher rate and p < 0.05."""
        analyzer = ExperimentAnalyzer()

        control = ExperimentMetrics(
            sample_size=500,
            success_count=200,  # 40%
            success_rate=0.40
        )
        experimental = ExperimentMetrics(
            sample_size=500,
            success_count=300,  # 60%
            success_rate=0.60
        )

        result = analyzer.analyze_experiment(control, experimental, metric_type="retention")

        assert result.winner == "experimental"
        assert "Experimental wins" in result.recommendation
        assert result.significance_test.is_significant == True

    def test_no_winner_not_significant(self):
        """Should mark 'inconclusive' when difference is not statistically significant."""
        analyzer = ExperimentAnalyzer()

        control = ExperimentMetrics(
            sample_size=500,
            success_count=250,  # 50%
            success_rate=0.50
        )
        experimental = ExperimentMetrics(
            sample_size=500,
            success_count=260,  # 52%
            success_rate=0.52
        )

        result = analyzer.analyze_experiment(control, experimental, metric_type="retention")

        # With such similar rates, should not be significant
        assert result.significance_test.is_significant == False
        assert result.winner == "inconclusive"
        assert "no clear winner" in result.recommendation.lower()

    def test_continuous_metric_winner(self):
        """Should determine winner for continuous metrics (ROI)."""
        analyzer = ExperimentAnalyzer()

        # Control ROI: ~100, Experimental ROI: ~120
        control_roi = [98.0, 99.0, 101.0, 102.0, 100.0, 98.5, 101.5, 99.5, 100.5, 101.0] * 5
        experimental_roi = [118.0, 120.0, 122.0, 119.0, 121.0, 120.5, 118.5, 122.5, 119.5, 121.0] * 5

        control = ExperimentMetrics(
            sample_size=len(control_roi),
            success_count=50,  # Not used for continuous
            success_rate=0.0,
            mean=100.0,
            std=1.5
        )
        experimental = ExperimentMetrics(
            sample_size=len(experimental_roi),
            success_count=50,  # Not used for continuous
            success_rate=0.0,
            mean=120.0,
            std=1.5
        )

        result = analyzer.analyze_experiment(
            control,
            experimental,
            metric_type="roi",
            control_values=control_roi,
            experimental_values=experimental_roi
        )

        assert result.winner == "experimental"
        assert "Experimental wins" in result.recommendation

    def test_result_contains_all_fields(self):
        """Should return complete result with all required fields."""
        analyzer = ExperimentAnalyzer()

        control = ExperimentMetrics(
            sample_size=100,
            success_count=60,
            success_rate=0.6
        )
        experimental = ExperimentMetrics(
            sample_size=100,
            success_count=70,
            success_rate=0.7
        )

        result = analyzer.analyze_experiment(control, experimental, metric_type="retention")

        assert isinstance(result, ExperimentAnalysisResult)
        assert result.control_ci is not None
        assert result.experimental_ci is not None
        assert result.significance_test is not None
        assert result.sample_size_estimate is not None
        assert result.recommendation is not None
        assert result.winner is not None
        assert result.details is not None
        assert "control_sample_size" in result.details
        assert "experimental_sample_size" in result.details
        assert "p_value" in result.details


class TestIntegration:
    """Integration tests across multiple components."""

    def test_full_experiment_analysis_workflow(self):
        """Should perform full analysis workflow end-to-end."""
        analyzer = ExperimentAnalyzer()

        # Simulate large experiment with clear winner
        control = ExperimentMetrics(
            sample_size=1000,
            success_count=400,  # 40% retention
            success_rate=0.40
        )
        experimental = ExperimentMetrics(
            sample_size=1000,
            success_count=500,  # 50% retention
            success_rate=0.50
        )

        result = analyzer.analyze_experiment(control, experimental, metric_type="retention")

        # Verify all components work together
        assert result.control_ci.point_estimate == 0.40
        assert result.experimental_ci.point_estimate == 0.50
        assert result.significance_test.is_significant == True
        assert result.winner == "experimental"
        assert result.sample_size_estimate.required_sample_size > 0
        assert len(result.details) > 5

    def test_different_confidence_levels(self):
        """Should respect different confidence levels in calculation."""
        analyzer = ExperimentAnalyzer()

        ci_95 = analyzer.calculate_binomial_confidence_interval(75, 100, 0.95)
        ci_99 = analyzer.calculate_binomial_confidence_interval(75, 100, 0.99)

        # Higher confidence should have wider interval
        interval_95 = ci_95.upper - ci_95.lower
        interval_99 = ci_99.upper - ci_99.lower

        assert interval_99 > interval_95
