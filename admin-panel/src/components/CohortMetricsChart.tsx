import { useEffect, useState } from 'react'
import {
  Card,
  Tabs,
  Empty,
  Row,
  Col,
  Statistic,
  Table,
  Progress,
  Space,
  Tag,
  Typography,
  Select,
} from 'antd'
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts'
import dayjs from 'dayjs'
import { adminApi } from '../api/client'

interface CohortMetrics {
  cohort_id: string
  win_rate: number
  volatility: number
  churn_rate: number
  player_count: number
  target_win_rate?: number
  drift_status?: string
  win_rate_band_min?: number
  win_rate_band_max?: number
  severity?: string
}

interface DifficultyAdoptionData {
  date: string
  adoption_24h: number
  adoption_7d: number
  adoption_30d: number
}

interface AnomalyTrendData {
  date: string
  total_detected: number
  auto_paused: number
  admin_override: number
}

const COHORTS = ['All', 'Casual', 'Aggressive', 'Grind', 'Risky']
const COHORT_COLORS: Record<string, string> = {
  Casual: '#1677ff',
  Aggressive: '#ff7a45',
  Grind: '#52c41a',
  Risky: '#faad14',
  All: '#722ed1',
}

export function CohortMetricsChart() {
  const [selectedCohort, setSelectedCohort] = useState<string>('All')
  const [cohorts, setCohorts] = useState<CohortMetrics[]>([])
  const [adoptionData, setAdoptionData] = useState<DifficultyAdoptionData[]>([])
  const [anomalyData, setAnomalyData] = useState<AnomalyTrendData[]>([])
  const [loading, setLoading] = useState(false)
  const [timeRange, setTimeRange] = useState<'24h' | '7d' | '30d'>('24h')

  // Fetch cohort metrics
  const fetchCohortData = async () => {
    setLoading(true)
    try {
      const [cohortsRes, adoptionRes, anomaliesRes] = await Promise.all([
        adminApi.get('/metrics/cohorts'),
        adminApi.get('/metrics/difficulty-adoption'),
        adminApi.get('/metrics/anomalies/trend'),
      ])

      setCohorts(cohortsRes.data.cohorts || [])
      setAdoptionData(adoptionRes.data.adoption || [])
      setAnomalyData(anomaliesRes.data.anomalies || [])
    } catch (err) {
      console.error('Failed to fetch cohort metrics:', err)
    } finally {
      setLoading(false)
    }
  }

  // Initial load and 5-minute refresh
  useEffect(() => {
    fetchCohortData()
    const interval = setInterval(fetchCohortData, 5 * 60 * 1000)
    return () => clearInterval(interval)
  }, [])

  // Get selected cohort data
  const selectedCohortData = cohorts.find((c) => c.cohort_id === selectedCohort)

  // Format adoption data for chart
  const formattedAdoptionData = adoptionData.map((item) => ({
    ...item,
    date: dayjs(item.date).format('MMM DD'),
    adoption_24h_pct: (item.adoption_24h * 100).toFixed(1),
    adoption_7d_pct: (item.adoption_7d * 100).toFixed(1),
    adoption_30d_pct: (item.adoption_30d * 100).toFixed(1),
  }))

  // Format anomaly data for chart
  const formattedAnomalyData = anomalyData.map((item) => ({
    ...item,
    date: dayjs(item.date).format('MMM DD'),
  }))

  // Calculate player segmentation
  const totalPlayers = cohorts.reduce((sum, c) => sum + c.player_count, 0)
  const segmentation = cohorts.map((c) => ({
    name: c.cohort_id,
    percentage: ((c.player_count / totalPlayers) * 100).toFixed(1),
    count: c.player_count,
  }))

  // Fairness metrics table columns
  const fairnessColumns = [
    {
      title: 'Cohort',
      dataIndex: 'cohort_id',
      key: 'cohort_id',
      render: (text: string) => <strong>{text}</strong>,
    },
    {
      title: 'Win Rate',
      dataIndex: 'win_rate',
      key: 'win_rate',
      render: (rate: number) => `${(rate * 100).toFixed(2)}%`,
    },
    {
      title: 'Target',
      dataIndex: 'target_win_rate',
      key: 'target_win_rate',
      render: (target: number) => target ? `${(target * 100).toFixed(2)}%` : 'N/A',
    },
    {
      title: 'Stability (±Band)',
      dataIndex: 'win_rate_band_min',
      key: 'stability',
      render: (_: any, record: CohortMetrics) => {
        if (!record.win_rate_band_min || !record.win_rate_band_max) return 'N/A'
        return `${(record.win_rate_band_min * 100).toFixed(2)}% - ${(record.win_rate_band_max * 100).toFixed(2)}%`
      },
    },
    {
      title: 'Drift Status',
      dataIndex: 'drift_status',
      key: 'drift_status',
      render: (status: string) => {
        let color = 'default'
        if (status === 'STABLE') color = 'green'
        else if (status === 'WARNING') color = 'orange'
        else if (status === 'CRITICAL') color = 'red'
        return <Tag color={color}>{status}</Tag>
      },
    },
    {
      title: 'Volatility',
      dataIndex: 'volatility',
      key: 'volatility',
      render: (vol: number) => (vol * 100).toFixed(2) + '%',
    },
    {
      title: 'Severity',
      dataIndex: 'severity',
      key: 'severity',
      render: (sev: string) => {
        let color = 'default'
        if (sev === 'HIGH') color = 'red'
        else if (sev === 'MEDIUM') color = 'orange'
        else if (sev === 'LOW') color = 'green'
        return <Tag color={color}>{sev || 'LOW'}</Tag>
      },
    },
  ]

  return (
    <div style={{ marginBottom: 24 }}>
      {/* Cohort Selection Tabs */}
      <Card style={{ marginBottom: 24, borderRadius: 12 }}>
        <Row gutter={[16, 16]} align="middle">
          <Col xs={24} sm={12}>
            <Typography.Text strong>Select Cohort</Typography.Text>
            <Select
              value={selectedCohort}
              onChange={setSelectedCohort}
              style={{ width: '100%', marginTop: 8 }}
              options={COHORTS.map((cohort) => ({
                label: cohort,
                value: cohort,
              }))}
            />
          </Col>
          <Col xs={24} sm={12}>
            <Typography.Text strong>Time Range</Typography.Text>
            <Select
              value={timeRange}
              onChange={(val) => setTimeRange(val as '24h' | '7d' | '30d')}
              style={{ width: '100%', marginTop: 8 }}
              options={[
                { label: '24 Hours', value: '24h' },
                { label: '7 Days', value: '7d' },
                { label: '30 Days', value: '30d' },
              ]}
            />
          </Col>
        </Row>
      </Card>

      {/* Cohort-Specific Stats */}
      {selectedCohortData && (
        <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
          <Col xs={24} sm={12} lg={6}>
            <Card>
              <Statistic
                title="Win Rate"
                value={(selectedCohortData.win_rate * 100).toFixed(2)}
                suffix="%"
                valueStyle={{
                  color: selectedCohortData.win_rate > 0.5 ? '#ff7a45' : '#52c41a',
                }}
              />
            </Card>
          </Col>
          <Col xs={24} sm={12} lg={6}>
            <Card>
              <Statistic
                title="Player Count"
                value={selectedCohortData.player_count}
                valueStyle={{ color: '#1677ff' }}
              />
            </Card>
          </Col>
          <Col xs={24} sm={12} lg={6}>
            <Card>
              <Statistic
                title="Volatility"
                value={(selectedCohortData.volatility * 100).toFixed(2)}
                suffix="%"
                valueStyle={{ color: '#faad14' }}
              />
            </Card>
          </Col>
          <Col xs={24} sm={12} lg={6}>
            <Card>
              <Statistic
                title="Churn Rate"
                value={(selectedCohortData.churn_rate * 100).toFixed(2)}
                suffix="%"
                valueStyle={{ color: '#ff4d4f' }}
              />
            </Card>
          </Col>
        </Row>
      )}

      {/* Tabs for different visualizations */}
      <Tabs
        items={[
          {
            key: 'fairness',
            label: 'Fairness Metrics',
            children: (
              <Card style={{ marginTop: 16, borderRadius: 12 }}>
                {cohorts.length > 0 ? (
                  <Table
                    columns={fairnessColumns}
                    dataSource={cohorts.map((c, idx) => ({ ...c, key: idx }))}
                    pagination={{ pageSize: 10 }}
                    size="small"
                    loading={loading}
                  />
                ) : (
                  <Empty description="No fairness data available" />
                )}
              </Card>
            ),
          },
          {
            key: 'adoption',
            label: 'Difficulty Adoption',
            children: (
              <Card style={{ marginTop: 16, borderRadius: 12 }}>
                {formattedAdoptionData.length > 0 ? (
                  <ResponsiveContainer width="100%" height={400}>
                    <LineChart data={formattedAdoptionData}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="date" tick={{ fontSize: 12 }} />
                      <YAxis
                        label={{
                          value: 'Adoption Rate (%)',
                          angle: -90,
                          position: 'insideLeft',
                        }}
                        tick={{ fontSize: 12 }}
                        domain={[0, 100]}
                      />
                      <Tooltip
                        formatter={(value: any) => (
                          typeof value === 'number' ? `${(value * 100).toFixed(1)}%` : value
                        )}
                      />
                      <Legend />
                      <Line
                        type="monotone"
                        dataKey="adoption_24h"
                        stroke="#1677ff"
                        strokeWidth={2}
                        name="24h Adoption"
                        isAnimationActive={false}
                      />
                      <Line
                        type="monotone"
                        dataKey="adoption_7d"
                        stroke="#52c41a"
                        strokeWidth={2}
                        name="7d Adoption"
                        isAnimationActive={false}
                      />
                      <Line
                        type="monotone"
                        dataKey="adoption_30d"
                        stroke="#faad14"
                        strokeWidth={2}
                        name="30d Adoption"
                        isAnimationActive={false}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                ) : (
                  <Empty description="No adoption data available" />
                )}
              </Card>
            ),
          },
          {
            key: 'anomalies',
            label: 'Anomaly Trends',
            children: (
              <Card style={{ marginTop: 16, borderRadius: 12 }}>
                {formattedAnomalyData.length > 0 ? (
                  <ResponsiveContainer width="100%" height={400}>
                    <BarChart data={formattedAnomalyData}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="date" tick={{ fontSize: 12 }} />
                      <YAxis
                        label={{
                          value: 'Count',
                          angle: -90,
                          position: 'insideLeft',
                        }}
                        tick={{ fontSize: 12 }}
                      />
                      <Tooltip />
                      <Legend />
                      <Bar
                        dataKey="total_detected"
                        fill="#1677ff"
                        name="Total Detected"
                      />
                      <Bar
                        dataKey="auto_paused"
                        fill="#52c41a"
                        name="Auto Paused"
                      />
                      <Bar
                        dataKey="admin_override"
                        fill="#ff7a45"
                        name="Admin Override"
                      />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <Empty description="No anomaly data available" />
                )}
              </Card>
            ),
          },
          {
            key: 'segmentation',
            label: 'Player Segmentation',
            children: (
              <Card style={{ marginTop: 16, borderRadius: 12 }}>
                <Row gutter={[16, 16]}>
                  {segmentation.map((seg) => (
                    <Col xs={24} sm={12} lg={6} key={seg.name}>
                      <Card
                        style={{
                          backgroundColor: '#fafafa',
                          borderLeft: `4px solid ${COHORT_COLORS[seg.name]}`,
                        }}
                      >
                        <div style={{ marginBottom: 12 }}>
                          <strong>{seg.name}</strong>
                        </div>
                        <div style={{ marginBottom: 12 }}>
                          <div
                            style={{
                              fontSize: '24px',
                              fontWeight: 'bold',
                              color: COHORT_COLORS[seg.name],
                            }}
                          >
                            {seg.percentage}%
                          </div>
                          <div style={{ fontSize: '12px', color: '#999' }}>
                            {seg.count.toLocaleString()} players
                          </div>
                        </div>
                        <Progress
                          percent={parseFloat(seg.percentage)}
                          strokeColor={COHORT_COLORS[seg.name]}
                          showInfo={false}
                        />
                      </Card>
                    </Col>
                  ))}
                </Row>
              </Card>
            ),
          },
        ]}
      />
    </div>
  )
}
