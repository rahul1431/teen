import { useEffect, useState } from 'react'
import { Row, Col, Card, Statistic, Table, Tag, Typography, Select, Button, Space, DatePicker, Tabs } from 'antd'
import { BarChartOutlined, AlertOutlined, ExperimentOutlined, LineChartOutlined, BgColorsOutlined } from '@ant-design/icons'
import dayjs, { Dayjs } from 'dayjs'
import { adminApi } from '../api/client'
import { MetricsCharts } from '../components/MetricsCharts'
import { CohortMetricsChart } from '../components/CohortMetricsChart'

interface MetricTrend {
  game_type: string
  difficulty: string
  hour?: string
  day?: string
  game_count: number
  avg_win_rate: number
  win_rate_std?: number
  percentile_rank?: number
  sample_size?: number
  drift_from_target: number
  is_alert: boolean
}

interface DriftAlert {
  game_type: string
  difficulty: string
  drift_from_target: number
  hours_exceeded: number
  severity: 'HIGH' | 'MEDIUM' | 'LOW'
  latest_hour: string
  alert_count: number
}

interface Experiment {
  id: string
  name: string
  game_type: string
  difficulty: string
  status: 'active' | 'completed' | 'paused'
  variant_a: any
  variant_b: any
  confidence: number
  winner: string | null
  created_at: string
  ended_at: string | null
}

export default function MetricsDashboard() {
  const [metrics, setMetrics] = useState<MetricTrend[]>([])
  const [alerts, setAlerts] = useState<DriftAlert[]>([])
  const [experiments, setExperiments] = useState<Experiment[]>([])
  const [loading, setLoading] = useState(true)
  const [gameType, setGameType] = useState<string | null>(null)
  const [timeRange, setTimeRange] = useState<'24h' | '7d' | '30d'>('24h')
  const [dateRange, setDateRange] = useState<[Dayjs, Dayjs] | null>(null)

  // Fetch metrics data
  const fetchMetrics = async () => {
    setLoading(true)
    try {
      const [metricsRes, alertsRes, experimentsRes] = await Promise.all([
        adminApi.get('/metrics'),
        adminApi.get('/drift-alerts'),
        adminApi.get('/a-b-experiments', { params: { status: 'active' } }),
      ])

      let metricsTrends = metricsRes.data.trends || []

      // Filter by game type if selected
      if (gameType) {
        metricsTrends = metricsTrends.filter((m: any) => m.game_type === gameType)
      }

      setMetrics(metricsTrends)
      setAlerts(alertsRes.data.alerts || [])
      setExperiments(experimentsRes.data.experiments || [])
    } catch (err) {
      console.error('Failed to fetch metrics:', err)
    } finally {
      setLoading(false)
    }
  }

  // Initial load and refresh every 5 minutes
  useEffect(() => {
    fetchMetrics()
    const interval = setInterval(fetchMetrics, 5 * 60 * 1000)
    return () => clearInterval(interval)
  }, [gameType])

  // Get unique game types for filter
  const gameTypes = Array.from(new Set(metrics.map((m) => m.game_type)))

  // Calculate metric cards
  const hourlyAgg = metrics.length > 0 ? metrics[0].game_count : 0
  const winRateStability =
    metrics.length > 0 ? (metrics[0].avg_win_rate * 100).toFixed(2) + '%' : 'N/A'
  const activeExperimentsCount = experiments.length
  const driftAlertsCount = alerts.length

  // Filter metrics by time range for display
  const getFilteredMetrics = () => {
    if (!metrics.length) return []

    // For now, just return all metrics
    // In a real scenario, you'd filter based on the selected date range
    return metrics.sort((a, b) => {
      const dateA = new Date(a.hour || a.day || 0).getTime()
      const dateB = new Date(b.hour || b.day || 0).getTime()
      return dateB - dateA
    })
  }

  const displayMetrics = getFilteredMetrics()

  // Table columns for alerts
  const alertColumns = [
    { title: 'Game Type', dataIndex: 'game_type', key: 'game_type', render: (t: string) => t.replace(/_/g, ' ').toUpperCase() },
    { title: 'Difficulty', dataIndex: 'difficulty', key: 'difficulty', render: (d: string) => d.charAt(0).toUpperCase() + d.slice(1) },
    {
      title: 'Drift (%)',
      dataIndex: 'drift_from_target',
      key: 'drift',
      render: (d: number) => (
        <span style={{ color: Math.abs(d) > 0.03 ? '#ff4d4f' : '#52c41a' }}>{(d * 100).toFixed(2)}%</span>
      ),
    },
    {
      title: 'Severity',
      dataIndex: 'severity',
      key: 'severity',
      render: (s: string) => {
        let color = 'default'
        if (s === 'HIGH') color = 'red'
        else if (s === 'MEDIUM') color = 'orange'
        else if (s === 'LOW') color = 'green'
        return <Tag color={color}>{s}</Tag>
      },
    },
    {
      title: 'Hours Exceeded',
      dataIndex: 'hours_exceeded',
      key: 'hours_exceeded',
      render: (h: number) => <span>{h}h</span>,
    },
  ]

  // Table columns for experiments
  const experimentColumns = [
    { title: 'Name', dataIndex: 'name', key: 'name' },
    { title: 'Game Type', dataIndex: 'game_type', key: 'game_type', render: (t: string) => t.replace(/_/g, ' ').toUpperCase() },
    { title: 'Difficulty', dataIndex: 'difficulty', key: 'difficulty', render: (d: string) => d.charAt(0).toUpperCase() + d.slice(1) },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      render: (s: string) => <Tag color={s === 'active' ? 'green' : s === 'paused' ? 'orange' : 'blue'}>{s}</Tag>,
    },
    {
      title: 'Confidence',
      dataIndex: 'confidence',
      key: 'confidence',
      render: (c: number) => (c * 100).toFixed(1) + '%',
    },
    {
      title: 'Created',
      dataIndex: 'created_at',
      key: 'created_at',
      render: (d: string) => dayjs(d).format('MMM DD HH:mm'),
    },
  ]

  return (
    <div>
      <Typography.Title level={3} style={{ marginBottom: 24 }}>
        Metrics Dashboard
      </Typography.Title>

      {/* Header: Filters and Controls */}
      <Card style={{ marginBottom: 24, borderRadius: 12 }}>
        <Row gutter={[16, 16]} align="middle">
          <Col xs={24} sm={12} md={8}>
            <div>
              <Typography.Text type="secondary">Game Type</Typography.Text>
              <Select
                placeholder="All Games"
                value={gameType}
                onChange={setGameType}
                allowClear
                style={{ width: '100%', marginTop: 8 }}
                options={[
                  { label: 'All Games', value: null },
                  ...gameTypes.map((gt) => ({
                    label: gt.replace(/_/g, ' ').toUpperCase(),
                    value: gt,
                  })),
                ]}
              />
            </div>
          </Col>
          <Col xs={24} sm={12} md={8}>
            <div>
              <Typography.Text type="secondary">Time Range</Typography.Text>
              <Select
                value={timeRange}
                onChange={(val) => setTimeRange(val as '24h' | '7d' | '30d')}
                style={{ width: '100%', marginTop: 8 }}
                options={[
                  { label: 'Last 24 Hours', value: '24h' },
                  { label: 'Last 7 Days', value: '7d' },
                  { label: 'Last 30 Days', value: '30d' },
                ]}
              />
            </div>
          </Col>
          <Col xs={24} sm={12} md={8}>
            <div>
              <Typography.Text type="secondary">Date Range</Typography.Text>
              <DatePicker.RangePicker
                value={dateRange}
                onChange={(range) => setDateRange(range as [Dayjs, Dayjs] | null)}
                style={{ width: '100%', marginTop: 8 }}
              />
            </div>
          </Col>
        </Row>
        <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
          <Col>
            <Button type="primary" onClick={fetchMetrics} loading={loading}>
              Refresh Data
            </Button>
          </Col>
        </Row>
      </Card>

      {/* Metric Cards */}
      <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Statistic
              title="Hourly Aggregation"
              value={hourlyAgg}
              prefix={<BarChartOutlined />}
              suffix="games"
              valueStyle={{ color: '#1677ff' }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Statistic
              title="Win-Rate Stability"
              value={winRateStability}
              prefix={<LineChartOutlined />}
              valueStyle={{ color: '#52c41a' }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Statistic
              title="Active Experiments"
              value={activeExperimentsCount}
              prefix={<ExperimentOutlined />}
              valueStyle={{ color: '#faad14' }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Statistic
              title="Drift Alerts"
              value={driftAlertsCount}
              prefix={<AlertOutlined />}
              valueStyle={{ color: driftAlertsCount > 0 ? '#ff4d4f' : '#52c41a' }}
            />
          </Card>
        </Col>
      </Row>

      {/* Win-Rate Trends Chart */}
      <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
        <Col xs={24}>
          <MetricsCharts data={displayMetrics} timeRange={timeRange} title="Win-Rate Trends" />
        </Col>
      </Row>

      {/* Cohort Analytics Section */}
      <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
        <Col xs={24}>
          <Card title={<><BgColorsOutlined /> Cohort Analytics & Anomaly Trends</>} style={{ borderRadius: 12 }}>
            <CohortMetricsChart />
          </Card>
        </Col>
      </Row>

      {/* Alerts and Experiments Tables */}
      <Row gutter={[16, 16]}>
        <Col xs={24} lg={12}>
          <Card title="Drift Alerts Table" style={{ borderRadius: 12 }}>
            <Table
              columns={alertColumns}
              dataSource={alerts.map((a, idx) => ({ ...a, key: idx }))}
              pagination={{ pageSize: 5 }}
              size="small"
              loading={loading}
            />
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card title="Active A/B Experiments" style={{ borderRadius: 12 }}>
            <Table
              columns={experimentColumns}
              dataSource={experiments.map((e, idx) => ({ ...e, key: idx }))}
              pagination={{ pageSize: 5 }}
              size="small"
              loading={loading}
            />
          </Card>
        </Col>
      </Row>
    </div>
  )
}
