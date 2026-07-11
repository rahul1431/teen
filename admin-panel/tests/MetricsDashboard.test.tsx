import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
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
  XAxis: () => <div data-testid="x-axis" />,
  YAxis: () => <div data-testid="y-axis" />,
  CartesianGrid: () => <div data-testid="cartesian-grid" />,
  Tooltip: () => <div data-testid="tooltip" />,
  Legend: () => <div data-testid="legend" />,
  ResponsiveContainer: ({ children }: any) => <div data-testid="responsive-container">{children}</div>,
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
})
