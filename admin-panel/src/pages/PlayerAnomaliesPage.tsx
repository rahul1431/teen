import { useEffect, useState, useCallback } from 'react'
import { Card, Row, Col, Select, Slider, DatePicker, Button, Space, Statistic, message, Typography, Tabs, Drawer, Empty, Grid } from 'antd'
import { FilterOutlined, ReloadOutlined, DownloadOutlined } from '@ant-design/icons'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import dayjs from 'dayjs'
import { adminApi } from '../api/client'
import { AnomaliesTable } from '../components/AnomaliesTable'

const { RangePicker } = DatePicker
const { Text } = Typography

interface PlayerAnomaly {
  id: string
  player_id: string
  username?: string
  anomaly_type: 'win_rate_spike' | 'session_change' | 'bet_aggression' | 'churn_risk' | 'game_frequency'
  confidence: number
  timestamp: string
  status: 'new' | 'responded' | 'overridden'
  details?: any
  support_tickets?: number
}

interface AnomalyStats {
  total_detected_today: number
  total_detected_7d: number
  total_detected_30d: number
  auto_paused_count: number
  override_rate_pct: number
}

interface TrendDataPoint {
  date: string
  count: number
  win_rate_spike?: number
  session_change?: number
  bet_aggression?: number
  churn_risk?: number
  game_frequency?: number
}

export default function PlayerAnomaliesPage() {
  const screens = Grid.useBreakpoint()
  const isMobile = !screens.md
  const [anomalies, setAnomalies] = useState<PlayerAnomaly[]>([])
  const [loading, setLoading] = useState(false)
  const [stats, setStats] = useState<AnomalyStats | null>(null)
  const [trendData, setTrendData] = useState<TrendDataPoint[]>([])

  // Filters
  const [anomalyTypeFilter, setAnomalyTypeFilter] = useState<string[]>([])
  const [confidenceRange, setConfidenceRange] = useState<[number, number]>([50, 100])
  const [dateRange, setDateRange] = useState<[dayjs.Dayjs, dayjs.Dayjs] | null>(null)
  const [trendDays, setTrendDays] = useState<'24h' | '7d' | '30d'>('7d')

  // Pagination
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [total, setTotal] = useState(0)

  // WebSocket / polling
  const [lastRefresh, setLastRefresh] = useState<string>(new Date().toLocaleTimeString())

  // Drawer for selected anomaly details
  const [selectedAnomaly, setSelectedAnomaly] = useState<PlayerAnomaly | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [supportTickets, setSupportTickets] = useState<any[]>([])

  // Fetch anomalies with filters
  const fetchAnomalies = useCallback(async (p = 1) => {
    setLoading(true)
    try {
      const params: any = {
        page: p,
        limit: pageSize,
        confidence_min: confidenceRange[0],
        confidence_max: confidenceRange[1],
      }

      if (anomalyTypeFilter.length > 0) {
        params.anomaly_types = anomalyTypeFilter.join(',')
      }

      if (dateRange) {
        params.start_date = dateRange[0].toISOString()
        params.end_date = dateRange[1].toISOString()
      }

      const response = await adminApi.get('/player-anomalies', { params })
      setAnomalies(response.data.data || [])
      setTotal(response.data.total || 0)
      setPage(p)
    } catch (err: any) {
      message.error(err.response?.data?.error || 'Failed to fetch anomalies')
    } finally {
      setLoading(false)
    }
  }, [confidenceRange, anomalyTypeFilter, dateRange, pageSize])

  // Fetch stats cards
  const fetchStats = useCallback(async () => {
    try {
      const response = await adminApi.get('/player-anomalies/stats')
      setStats(response.data.data || null)
    } catch (err: any) {
      console.error('Failed to fetch stats:', err)
    }
  }, [])

  // Fetch trend data
  const fetchTrend = useCallback(async () => {
    try {
      const response = await adminApi.get('/player-anomalies/trend', { params: { days: trendDays === '24h' ? 1 : trendDays === '7d' ? 7 : 30 } })
      setTrendData(response.data.data || [])
    } catch (err: any) {
      console.error('Failed to fetch trend:', err)
    }
  }, [trendDays])

  // Fetch support tickets for selected anomaly
  const fetchSupportTickets = useCallback(async (playerId: string) => {
    try {
      const response = await adminApi.get(`/player/${playerId}/support-tickets`, { params: { priority: 'high', limit: 10 } })
      setSupportTickets(response.data.data || [])
    } catch (err: any) {
      console.error('Failed to fetch support tickets:', err)
    }
  }, [])

  // Initial load and polling
  useEffect(() => {
    fetchAnomalies(1)
    fetchStats()
    fetchTrend()

    // Poll every 30 seconds for real-time updates
    const interval = setInterval(() => {
      fetchAnomalies(page)
      fetchStats()
      fetchTrend()
      setLastRefresh(new Date().toLocaleTimeString())
    }, 30000)

    return () => clearInterval(interval)
  }, [fetchAnomalies, fetchStats, fetchTrend, page])

  // Re-fetch when filters change
  useEffect(() => {
    setPage(1)
    fetchAnomalies(1)
  }, [anomalyTypeFilter, confidenceRange, dateRange])

  // Quick actions
  const handlePause = async (playerId: string) => {
    try {
      await adminApi.patch(`/users/${playerId}/status`, { status: 'paused_anomaly' })
      message.success('Player paused successfully')
      fetchAnomalies(page)
    } catch (err: any) {
      message.error(err.response?.data?.error || 'Failed to pause player')
    }
  }

  const handleReview = async (anomalyId: string) => {
    try {
      await adminApi.post(`/player-anomalies/${anomalyId}/review`)
      message.success('Marked as reviewed')
      fetchAnomalies(page)
    } catch (err: any) {
      message.error(err.response?.data?.error || 'Failed to review anomaly')
    }
  }

  const handleWhitelist = async (playerId: string) => {
    try {
      await adminApi.post(`/player/${playerId}/whitelist`)
      message.success('Player whitelisted')
      fetchAnomalies(page)
    } catch (err: any) {
      message.error(err.response?.data?.error || 'Failed to whitelist player')
    }
  }

  const handleViewProfile = async (playerId: string) => {
    setSelectedAnomaly(anomalies.find(a => a.player_id === playerId) || null)
    await fetchSupportTickets(playerId)
    setDrawerOpen(true)
  }

  const handleTableChange = (pagination: any, _filters: any, _sorter: any) => {
    fetchAnomalies(pagination.current)
  }

  return (
    <div style={{ padding: 0 }}>
      <Typography.Title level={3} style={{ marginBottom: 24 }}>Player Anomalies Dashboard</Typography.Title>

      {/* Stats Cards */}
      {stats && (
        <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
          <Col xs={24} sm={12} lg={6}>
            <Card>
              <Statistic
                title="Detected Today"
                value={stats.total_detected_today}
                suffix="alerts"
                valueStyle={{ color: '#1890ff' }}
              />
            </Card>
          </Col>
          <Col xs={24} sm={12} lg={6}>
            <Card>
              <Statistic
                title="Detected 7d"
                value={stats.total_detected_7d}
                suffix="alerts"
                valueStyle={{ color: '#faad14' }}
              />
            </Card>
          </Col>
          <Col xs={24} sm={12} lg={6}>
            <Card>
              <Statistic
                title="Auto-Paused"
                value={stats.auto_paused_count}
                valueStyle={{ color: '#ff4d4f' }}
              />
            </Card>
          </Col>
          <Col xs={24} sm={12} lg={6}>
            <Card>
              <Statistic
                title="Override Rate"
                value={stats.override_rate_pct}
                suffix="%"
                valueStyle={{ color: '#52c41a' }}
              />
            </Card>
          </Col>
        </Row>
      )}

      {/* Filters Card */}
      <Card style={{ marginBottom: 24 }} title={<><FilterOutlined /> Filters</>}>
        <Row gutter={[16, 16]}>
          <Col xs={24} sm={12} md={6}>
            <div style={{ fontSize: 12, marginBottom: 8, fontWeight: 500 }}>Anomaly Type</div>
            <Select
              mode="multiple"
              placeholder="All types"
              value={anomalyTypeFilter}
              onChange={setAnomalyTypeFilter}
              options={[
                { label: 'Win Rate Spike', value: 'win_rate_spike' },
                { label: 'Session Change', value: 'session_change' },
                { label: 'Bet Aggression', value: 'bet_aggression' },
                { label: 'Churn Risk', value: 'churn_risk' },
                { label: 'Game Frequency', value: 'game_frequency' },
              ]}
              style={{ width: '100%' }}
            />
          </Col>

          <Col xs={24} sm={12} md={6}>
            <div style={{ fontSize: 12, marginBottom: 8, fontWeight: 500 }}>Confidence Range</div>
            <Slider
              range
              min={50}
              max={100}
              value={confidenceRange}
              onChange={(value) => setConfidenceRange(value as [number, number])}
              marks={{ 50: '50%', 100: '100%' }}
            />
            <Text type="secondary" style={{ fontSize: 11 }}>
              {confidenceRange[0]}% - {confidenceRange[1]}%
            </Text>
          </Col>

          <Col xs={24} sm={12} md={6}>
            <div style={{ fontSize: 12, marginBottom: 8, fontWeight: 500 }}>Date Range</div>
            <RangePicker
              value={dateRange}
              onChange={(dates) => setDateRange(dates as any)}
              style={{ width: '100%' }}
            />
          </Col>

          <Col xs={24} sm={12} md={6}>
            <div style={{ fontSize: 12, marginBottom: 8, fontWeight: 500 }}>&nbsp;</div>
            <Button
              type="primary"
              icon={<ReloadOutlined />}
              onClick={() => {
                setAnomalyTypeFilter([])
                setConfidenceRange([50, 100])
                setDateRange(null)
                fetchAnomalies(1)
              }}
              style={{ width: '100%' }}
            >
              Reset Filters
            </Button>
          </Col>
        </Row>
      </Card>

      {/* Trend Chart */}
      {trendData.length > 0 && (
        <Card style={{ marginBottom: 24 }} title="Anomaly Trend">
          <Space style={{ marginBottom: 12 }}>
            <Select
              value={trendDays}
              onChange={setTrendDays}
              options={[
                { label: '24h', value: '24h' },
                { label: '7d', value: '7d' },
                { label: '30d', value: '30d' },
              ]}
              style={{ width: 100 }}
            />
            <Text type="secondary" style={{ fontSize: 11 }}>Last refresh: {lastRefresh}</Text>
          </Space>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={trendData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" />
              <YAxis />
              <Tooltip />
              <Legend />
              <Line type="monotone" dataKey="count" stroke="#1890ff" name="Total Anomalies" />
              <Line type="monotone" dataKey="win_rate_spike" stroke="#ff4d4f" name="Win Rate Spike" />
              <Line type="monotone" dataKey="session_change" stroke="#faad14" name="Session Change" />
              <Line type="monotone" dataKey="bet_aggression" stroke="#ff7a45" name="Bet Aggression" />
            </LineChart>
          </ResponsiveContainer>
        </Card>
      )}

      {/* Active Anomalies Table */}
      <Card title={`Active Anomalies (${total})`}>
        {anomalies.length > 0 ? (
          <AnomaliesTable
            data={anomalies}
            loading={loading}
            onPause={handlePause}
            onReview={handleReview}
            onWhitelist={handleWhitelist}
            onViewProfile={handleViewProfile}
            pagination={{
              current: page,
              pageSize: pageSize,
              total: total,
              showSizeChanger: true,
              pageSizeOptions: ['10', '20', '50', '100'],
            }}
            onChange={handleTableChange}
          />
        ) : (
          <Empty description="No anomalies detected" style={{ padding: 40 }} />
        )}
      </Card>

      {/* Player Profile Drawer */}
      <Drawer
        title={`Player: ${selectedAnomaly?.username || selectedAnomaly?.player_id}`}
        placement="right"
        onClose={() => setDrawerOpen(false)}
        open={drawerOpen}
        width={isMobile ? '100%' : 400}
      >
        {selectedAnomaly && (
          <Tabs
            items={[
              {
                key: 'details',
                label: 'Anomaly Details',
                children: (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                    <div>
                      <Text strong>Type:</Text>
                      <div>{selectedAnomaly.anomaly_type.replace(/_/g, ' ').toUpperCase()}</div>
                    </div>
                    <div>
                      <Text strong>Confidence:</Text>
                      <div>{selectedAnomaly.confidence.toFixed(2)}%</div>
                    </div>
                    <div>
                      <Text strong>Detected:</Text>
                      <div>{new Date(selectedAnomaly.timestamp).toLocaleString()}</div>
                    </div>
                    <div>
                      <Text strong>Status:</Text>
                      <div>{selectedAnomaly.status.toUpperCase()}</div>
                    </div>
                    {selectedAnomaly.details && (
                      <div>
                        <Text strong>Details:</Text>
                        <div style={{ marginTop: 8, padding: 8, backgroundColor: '#f5f5f5', borderRadius: 4, fontSize: 12 }}>
                          {JSON.stringify(selectedAnomaly.details, null, 2)}
                        </div>
                      </div>
                    )}
                  </div>
                ),
              },
              {
                key: 'tickets',
                label: `Support Tickets (${supportTickets.length})`,
                children: supportTickets.length > 0 ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    {supportTickets.map((ticket: any) => (
                      <Card key={ticket.id} size="small" style={{ borderLeft: '4px solid #1890ff' }}>
                        <div style={{ fontSize: 12 }}>
                          <Text strong>{ticket.subject}</Text>
                          <div style={{ color: '#666', marginTop: 4 }}>{ticket.message?.slice(0, 100)}...</div>
                          <div style={{ color: '#999', fontSize: 11, marginTop: 4 }}>
                            {new Date(ticket.created_at).toLocaleString()}
                          </div>
                        </div>
                      </Card>
                    ))}
                  </div>
                ) : (
                  <Empty description="No support tickets" />
                ),
              },
            ]}
          />
        )}
      </Drawer>
    </div>
  )
}
