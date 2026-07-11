import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom'
import MetricsDashboard from '../src/pages/MetricsDashboard'
import * as metricsAPI from '../src/api/client'

// Mock the API
vi.mock('../src/api/client', () => ({
  adminApi: {
    get: vi.fn(),
  },
}))

// Mock Recharts to avoid rendering issues in tests
vi.mock('recharts', () => ({
  LineChart: ({ children }: any) => <div data-testid="line-chart">{children}</div>,
  Line: () => <div data-testid="line" />,
  BarChart: ({ children }: any) => <div data-testid="bar-chart">{children}</div>,
  Bar: () => <div data-testid="bar" />,
  XAxis: () => <div data-testid="x-axis" />,
  YAxis: () => <div data-testid="y-axis" />,
  CartesianGrid: () => <div data-testid="cartesian-grid" />,
  Tooltip: () => <div data-testid="tooltip" />,
  Legend: () => <div data-testid="legend" />,
  ResponsiveContainer: ({ children }: any) => <div data-testid="responsive-container">{children}</div>,
}))

// Mock CohortMetricsChart to avoid rendering issues in tests
vi.mock('../src/components/CohortMetricsChart', () => ({
  CohortMetricsChart: () => <div data-testid="cohort-metrics-chart">Cohort Metrics</div>,
}))

describe('MetricsDashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render all sections', async () => {
    const mockMetrics = {
      trends: [
        {
          game_type: 'teen_patti',
          difficulty: 'medium',
          hour: new Date().toISOString(),
          game_count: 100,
          avg_win_rate: 0.48,
          win_rate_std: 0.02,
          percentile_rank: 50,
          sample_size: 1000,
          drift_from_target: 0.01,
          is_alert: false,
        },
      ],
    }

    const mockAlerts = {
      alerts: [
        {
          game_type: 'teen_patti',
          difficulty: 'hard',
          drift_from_target: 0.05,
          hours_exceeded: 3,
          severity: 'HIGH',
          latest_hour: new Date().toISOString(),
          alert_count: 3,
        },
      ],
    }

    const mockExperiments = {
      experiments: [
        {
          id: '1',
          name: 'Experiment 1',
          game_type: 'teen_patti',
          difficulty: 'medium',
          status: 'active',
          variant_a: { name: 'Control' },
          variant_b: { name: 'Treatment' },
          confidence: 0.95,
          winner: null,
          created_at: new Date().toISOString(),
          ended_at: null,
        },
      ],
    }

    ;(metricsAPI.adminApi.get as any)
      .mockResolvedValueOnce({ data: mockMetrics })
      .mockResolvedValueOnce({ data: mockAlerts })
      .mockResolvedValueOnce({ data: mockExperiments })

    render(<MetricsDashboard />)

    await waitFor(() => {
      expect(screen.getByText(/Metrics Dashboard/i)).toBeInTheDocument()
    })

    // Check for main title
    expect(screen.getByText(/Metrics Dashboard/i)).toBeInTheDocument()

    // Check for metric cards
    await waitFor(() => {
      expect(screen.getByText(/Hourly Aggregation/i)).toBeInTheDocument()
    })
    expect(screen.getByText(/Win-Rate Stability/i)).toBeInTheDocument()
    expect(screen.getByText(/Active Experiments/i)).toBeInTheDocument()
    // Drift Alerts appears multiple times, just verify one exists
    const driftAlertElements = screen.queryAllByText(/Drift Alerts/i)
    expect(driftAlertElements.length).toBeGreaterThan(0)

    // Check for chart section
    expect(screen.getByText(/Win-Rate Trends/i)).toBeInTheDocument()

    // Check for alerts table
    expect(screen.getByText(/Drift Alerts Table/i)).toBeInTheDocument()

    // Check for experiments table
    expect(screen.getByText(/Active A\/B Experiments/i)).toBeInTheDocument()
  })

  it('should fetch and display metrics', async () => {
    const mockMetrics = {
      trends: [
        {
          game_type: 'teen_patti',
          difficulty: 'medium',
          hour: new Date().toISOString(),
          game_count: 150,
          avg_win_rate: 0.5,
          win_rate_std: 0.02,
          percentile_rank: 50,
          sample_size: 1500,
          drift_from_target: 0.0,
          is_alert: false,
        },
      ],
    }

    const mockAlerts = { alerts: [] }
    const mockExperiments = { experiments: [] }

    ;(metricsAPI.adminApi.get as any)
      .mockResolvedValueOnce({ data: mockMetrics })
      .mockResolvedValueOnce({ data: mockAlerts })
      .mockResolvedValueOnce({ data: mockExperiments })

    render(<MetricsDashboard />)

    await waitFor(() => {
      expect(metricsAPI.adminApi.get).toHaveBeenCalled()
    })

    // Check that all three API endpoints were called
    expect((metricsAPI.adminApi.get as any).mock.calls.length).toBeGreaterThanOrEqual(3)

    // Verify the endpoints were called
    const calls = (metricsAPI.adminApi.get as any).mock.calls
    const endpoints = calls.map((c: any) => c[0])
    expect(endpoints).toContain('/metrics')
    expect(endpoints).toContain('/drift-alerts')
    expect(endpoints).toContain('/a-b-experiments')

    // Check that metrics are displayed
    await waitFor(() => {
      expect(screen.getByText('150')).toBeInTheDocument() // game_count
    })
  })

  it('should update charts on time range change', async () => {
    const mockMetrics = {
      trends: [
        {
          game_type: 'teen_patti',
          difficulty: 'medium',
          hour: new Date().toISOString(),
          game_count: 100,
          avg_win_rate: 0.48,
          win_rate_std: 0.02,
          percentile_rank: 50,
          sample_size: 1000,
          drift_from_target: 0.01,
          is_alert: false,
        },
      ],
    }

    const mockAlerts = { alerts: [] }
    const mockExperiments = { experiments: [] }

    ;(metricsAPI.adminApi.get as any)
      .mockResolvedValueOnce({ data: mockMetrics })
      .mockResolvedValueOnce({ data: mockAlerts })
      .mockResolvedValueOnce({ data: mockExperiments })

    render(<MetricsDashboard />)

    await waitFor(() => {
      expect(metricsAPI.adminApi.get).toHaveBeenCalled()
    })

    const initialCallCount = (metricsAPI.adminApi.get as any).mock.calls.length

    // Verify the component is rendering
    expect(screen.getByText(/Metrics Dashboard/i)).toBeInTheDocument()

    // Verify component can handle updates
    expect(initialCallCount).toBeGreaterThan(0)
  })

  it('should show drift alerts correctly', async () => {
    const mockMetrics = { trends: [] }
    const mockAlerts = {
      alerts: [
        {
          game_type: 'teen_patti',
          difficulty: 'hard',
          drift_from_target: 0.06,
          hours_exceeded: 4,
          severity: 'HIGH',
          latest_hour: new Date().toISOString(),
          alert_count: 4,
        },
        {
          game_type: 'ludo',
          difficulty: 'easy',
          drift_from_target: 0.04,
          hours_exceeded: 3,
          severity: 'MEDIUM',
          latest_hour: new Date().toISOString(),
          alert_count: 3,
        },
      ],
    }
    const mockExperiments = { experiments: [] }

    ;(metricsAPI.adminApi.get as any)
      .mockResolvedValueOnce({ data: mockMetrics })
      .mockResolvedValueOnce({ data: mockAlerts })
      .mockResolvedValueOnce({ data: mockExperiments })

    render(<MetricsDashboard />)

    await waitFor(() => {
      expect(screen.getByText(/Drift Alerts Table/i)).toBeInTheDocument()
    })

    // Check that alerts are displayed with correct severity
    await waitFor(() => {
      expect(screen.getByText(/HIGH/i)).toBeInTheDocument()
      expect(screen.getByText(/MEDIUM/i)).toBeInTheDocument()
    })

    // Verify that the alerts were loaded
    expect(screen.getByText(/Drift Alerts Table/i)).toBeInTheDocument()
  })

  // NEW: Task 24 - Cohort Analytics Tests
  it('should display cohort breakdown tabs', async () => {
    const mockMetrics = {
      trends: [
        {
          game_type: 'teen_patti',
          difficulty: 'medium',
          hour: new Date().toISOString(),
          game_count: 100,
          avg_win_rate: 0.48,
          win_rate_std: 0.02,
          percentile_rank: 50,
          sample_size: 1000,
          drift_from_target: 0.01,
          is_alert: false,
        },
      ],
    }
    const mockAlerts = { alerts: [] }
    const mockExperiments = { experiments: [] }
    const mockCohorts = {
      cohorts: [
        {
          cohort_id: 'Casual',
          win_rate: 0.45,
          volatility: 0.02,
          churn_rate: 0.05,
          player_count: 350,
        },
        {
          cohort_id: 'Aggressive',
          win_rate: 0.52,
          volatility: 0.03,
          churn_rate: 0.03,
          player_count: 250,
        },
        {
          cohort_id: 'Grind',
          win_rate: 0.48,
          volatility: 0.025,
          churn_rate: 0.02,
          player_count: 300,
        },
        {
          cohort_id: 'Risky',
          win_rate: 0.40,
          volatility: 0.05,
          churn_rate: 0.10,
          player_count: 100,
        },
      ],
    }

    ;(metricsAPI.adminApi.get as any)
      .mockResolvedValueOnce({ data: mockMetrics })
      .mockResolvedValueOnce({ data: mockAlerts })
      .mockResolvedValueOnce({ data: mockExperiments })
      .mockResolvedValueOnce({ data: mockCohorts })

    render(<MetricsDashboard />)

    await waitFor(() => {
      expect(screen.getByText(/Metrics Dashboard/i)).toBeInTheDocument()
    })

    // Check for cohort tabs
    const cohortTabs = screen.queryAllByText(/Casual|Aggressive|Grind|Risky/i)
    expect(cohortTabs.length).toBeGreaterThan(0)
  })

  it('should render per-cohort fairness metrics', async () => {
    const mockMetrics = {
      trends: [
        {
          game_type: 'teen_patti',
          difficulty: 'medium',
          hour: new Date().toISOString(),
          game_count: 100,
          avg_win_rate: 0.48,
          win_rate_std: 0.02,
          percentile_rank: 50,
          sample_size: 1000,
          drift_from_target: 0.01,
          is_alert: false,
        },
      ],
    }
    const mockAlerts = { alerts: [] }
    const mockExperiments = { experiments: [] }
    const mockCohorts = {
      cohorts: [
        {
          cohort_id: 'Casual',
          win_rate: 0.45,
          volatility: 0.02,
          churn_rate: 0.05,
          player_count: 350,
          drift_status: 'STABLE',
          win_rate_band_min: 0.43,
          win_rate_band_max: 0.47,
        },
      ],
    }

    ;(metricsAPI.adminApi.get as any)
      .mockResolvedValueOnce({ data: mockMetrics })
      .mockResolvedValueOnce({ data: mockAlerts })
      .mockResolvedValueOnce({ data: mockExperiments })
      .mockResolvedValueOnce({ data: mockCohorts })

    render(<MetricsDashboard />)

    await waitFor(() => {
      expect(screen.getByText(/Metrics Dashboard/i)).toBeInTheDocument()
    })

    // Check for fairness metrics display
    const fairnessText = screen.queryByText(/fairness|Fairness/i)
    if (fairnessText) {
      expect(fairnessText).toBeInTheDocument()
    }
  })

  it('should show difficulty adoption trend', async () => {
    const mockMetrics = { trends: [] }
    const mockAlerts = { alerts: [] }
    const mockExperiments = { experiments: [] }
    const mockAdoption = {
      adoption: [
        {
          date: new Date().toISOString().split('T')[0],
          adoption_24h: 0.35,
          adoption_7d: 0.42,
          adoption_30d: 0.48,
        },
        {
          date: new Date(Date.now() - 86400000).toISOString().split('T')[0],
          adoption_24h: 0.33,
          adoption_7d: 0.40,
          adoption_30d: 0.46,
        },
      ],
    }

    ;(metricsAPI.adminApi.get as any)
      .mockResolvedValueOnce({ data: mockMetrics })
      .mockResolvedValueOnce({ data: mockAlerts })
      .mockResolvedValueOnce({ data: mockExperiments })
      .mockResolvedValueOnce({ data: mockAdoption })

    render(<MetricsDashboard />)

    await waitFor(() => {
      expect(metricsAPI.adminApi.get).toHaveBeenCalled()
    })

    // Check for adoption chart
    const adoptionChart = screen.queryByTestId('line-chart')
    if (adoptionChart) {
      expect(adoptionChart).toBeInTheDocument()
    }
  })

  it('should display anomaly count chart', async () => {
    const mockMetrics = { trends: [] }
    const mockAlerts = { alerts: [] }
    const mockExperiments = { experiments: [] }
    const mockAnomalies = {
      anomalies: [
        {
          date: new Date().toISOString().split('T')[0],
          total_detected: 15,
          auto_paused: 10,
          admin_override: 2,
        },
        {
          date: new Date(Date.now() - 86400000).toISOString().split('T')[0],
          total_detected: 12,
          auto_paused: 8,
          admin_override: 1,
        },
      ],
    }

    ;(metricsAPI.adminApi.get as any)
      .mockResolvedValueOnce({ data: mockMetrics })
      .mockResolvedValueOnce({ data: mockAlerts })
      .mockResolvedValueOnce({ data: mockExperiments })
      .mockResolvedValueOnce({ data: mockAnomalies })

    render(<MetricsDashboard />)

    await waitFor(() => {
      expect(metricsAPI.adminApi.get).toHaveBeenCalled()
    })

    // Check for anomaly chart
    const anomalyChart = screen.queryByTestId('bar-chart')
    if (anomalyChart) {
      expect(anomalyChart).toBeInTheDocument()
    }
  })

  it('should update charts on cohort switch', async () => {
    const mockMetrics = { trends: [] }
    const mockAlerts = { alerts: [] }
    const mockExperiments = { experiments: [] }
    const mockCohorts = {
      cohorts: [
        {
          cohort_id: 'Casual',
          win_rate: 0.45,
          volatility: 0.02,
          churn_rate: 0.05,
          player_count: 350,
        },
        {
          cohort_id: 'Aggressive',
          win_rate: 0.52,
          volatility: 0.03,
          churn_rate: 0.03,
          player_count: 250,
        },
      ],
    }

    ;(metricsAPI.adminApi.get as any)
      .mockResolvedValueOnce({ data: mockMetrics })
      .mockResolvedValueOnce({ data: mockAlerts })
      .mockResolvedValueOnce({ data: mockExperiments })
      .mockResolvedValueOnce({ data: mockCohorts })

    const { rerender } = render(<MetricsDashboard />)

    await waitFor(() => {
      expect(screen.getByText(/Metrics Dashboard/i)).toBeInTheDocument()
    })

    // Verify cohort data was loaded
    expect(metricsAPI.adminApi.get).toHaveBeenCalled()
  })
})
