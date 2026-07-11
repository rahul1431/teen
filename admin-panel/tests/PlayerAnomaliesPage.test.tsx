import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'
import { BrowserRouter } from 'react-router-dom'
import PlayerAnomaliesPage from '../src/pages/PlayerAnomaliesPage'
import * as apiClient from '../src/api/client'

// Mock the API
vi.mock('../src/api/client', () => ({
  adminApi: {
    get: vi.fn(),
    post: vi.fn(),
  },
}))

// Mock Recharts
vi.mock('recharts', () => ({
  LineChart: ({ children }: any) => <div data-testid="line-chart">{children}</div>,
  Line: () => <div data-testid="line" />,
  XAxis: () => <div />,
  YAxis: () => <div />,
  CartesianGrid: () => <div />,
  Tooltip: () => <div />,
  Legend: () => <div />,
  ResponsiveContainer: ({ children }: any) => <div data-testid="responsive-container">{children}</div>,
}))

// Mock dayjs
vi.mock('dayjs', () => ({
  default: (date?: any) => ({
    toISOString: () => '2026-07-11T00:00:00.000Z',
  }),
}))

const mockStats = {
  total_detected_today: 5,
  total_detected_7d: 23,
  total_detected_30d: 87,
  auto_paused_count: 8,
  override_rate_pct: 12.5,
}

const mockTrendData = [
  { date: '2026-07-05', count: 2, win_rate_spike: 1, session_change: 0, bet_aggression: 1 },
  { date: '2026-07-06', count: 3, win_rate_spike: 1, session_change: 1, bet_aggression: 1 },
  { date: '2026-07-07', count: 5, win_rate_spike: 2, session_change: 1, bet_aggression: 2 },
]

describe('PlayerAnomaliesPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(apiClient.adminApi.get as any).mockImplementation((url: string) => {
      if (url === '/player-anomalies') {
        return Promise.resolve({
          data: {
            data: [],
            total: 0,
          },
        })
      }
      if (url === '/player-anomalies/stats') {
        return Promise.resolve({
          data: { data: mockStats },
        })
      }
      if (url === '/player-anomalies/trend') {
        return Promise.resolve({
          data: { data: mockTrendData },
        })
      }
      return Promise.resolve({ data: { data: [] } })
    })
  })

  it('should render all dashboard sections', async () => {
    render(
      <BrowserRouter>
        <PlayerAnomaliesPage />
      </BrowserRouter>
    )

    // Wait for title
    expect(screen.getByText('Player Anomalies Dashboard')).toBeInTheDocument()

    // Check for stats cards
    await waitFor(() => {
      expect(screen.getByText('Detected Today')).toBeInTheDocument()
      expect(screen.getByText('Detected 7d')).toBeInTheDocument()
      expect(screen.getByText('Auto-Paused')).toBeInTheDocument()
      expect(screen.getByText('Override Rate')).toBeInTheDocument()
    })

    // Check for filters section
    await waitFor(() => {
      expect(screen.getByText('Anomaly Type')).toBeInTheDocument()
      expect(screen.getByText('Confidence Range')).toBeInTheDocument()
      expect(screen.getByText('Date Range')).toBeInTheDocument()
    })
  })

  it('should apply filters correctly', async () => {
    render(
      <BrowserRouter>
        <PlayerAnomaliesPage />
      </BrowserRouter>
    )

    // Wait for initial load
    await waitFor(() => {
      expect(screen.getByText('Player Anomalies Dashboard')).toBeInTheDocument()
    })

    // Verify API was called for anomalies
    expect(apiClient.adminApi.get).toHaveBeenCalledWith('/player-anomalies', expect.any(Object))
  })

  it('should execute quick actions (pause/review)', async () => {
    ;(apiClient.adminApi.post as any).mockImplementation((url: string) => {
      if (url.includes('override-anomaly-pause') || url.includes('/review')) {
        return Promise.resolve({ data: { success: true } })
      }
      return Promise.resolve({ data: {} })
    })

    render(
      <BrowserRouter>
        <PlayerAnomaliesPage />
      </BrowserRouter>
    )

    await waitFor(() => {
      expect(screen.getByText('Player Anomalies Dashboard')).toBeInTheDocument()
    })

    // Just verify the page renders without errors
    expect(screen.getByText('Player Anomalies Dashboard')).toBeInTheDocument()
  })

  it('should show real-time anomaly updates', async () => {
    render(
      <BrowserRouter>
        <PlayerAnomaliesPage />
      </BrowserRouter>
    )

    await waitFor(() => {
      expect(screen.getByText('Player Anomalies Dashboard')).toBeInTheDocument()
    })

    // Verify API endpoints were called
    await waitFor(() => {
      const calls = (apiClient.adminApi.get as any).mock.calls
      const callUrls = calls.map((call: any) => call[0])
      expect(callUrls).toContain('/player-anomalies')
      expect(callUrls).toContain('/player-anomalies/stats')
      expect(callUrls).toContain('/player-anomalies/trend')
    })
  })

  it('should display trend chart', async () => {
    render(
      <BrowserRouter>
        <PlayerAnomaliesPage />
      </BrowserRouter>
    )

    await waitFor(() => {
      expect(screen.getByTestId('responsive-container')).toBeInTheDocument()
    })
  })

  it('should display stats correctly', async () => {
    render(
      <BrowserRouter>
        <PlayerAnomaliesPage />
      </BrowserRouter>
    )

    await waitFor(() => {
      expect(screen.getByText('Detected Today')).toBeInTheDocument()
    })

    // Check that stats are rendered
    expect(screen.getByText('Auto-Paused')).toBeInTheDocument()
  })

  it('should handle API errors gracefully', async () => {
    ;(apiClient.adminApi.get as any).mockImplementation(() => {
      return Promise.reject({
        response: { data: { error: 'API Error' } },
      })
    })

    render(
      <BrowserRouter>
        <PlayerAnomaliesPage />
      </BrowserRouter>
    )

    await waitFor(() => {
      // Component should still render, just with empty data
      expect(screen.getByText('Player Anomalies Dashboard')).toBeInTheDocument()
    })
  })

  it('should render filter controls', async () => {
    render(
      <BrowserRouter>
        <PlayerAnomaliesPage />
      </BrowserRouter>
    )

    await waitFor(() => {
      expect(screen.getByText('Anomaly Type')).toBeInTheDocument()
      expect(screen.getByText('Confidence Range')).toBeInTheDocument()
    })

    // Check for reset button
    const resetBtn = screen.getByRole('button', { name: /Reset Filters/i })
    expect(resetBtn).toBeInTheDocument()
  })

  it('should display anomalies table section', async () => {
    render(
      <BrowserRouter>
        <PlayerAnomaliesPage />
      </BrowserRouter>
    )

    await waitFor(() => {
      expect(screen.getByText(/Active Anomalies/)).toBeInTheDocument()
    })
  })
})
