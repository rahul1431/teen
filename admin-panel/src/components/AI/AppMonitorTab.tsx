// admin-panel/src/components/AI/AppMonitorTab.tsx
import { useState, useEffect, useCallback } from 'react'
import {
  Card, Row, Col, Statistic, Table, Tag, Select, Spin, Badge, Radio, Typography
} from 'antd'
import {
  BugOutlined, ApiOutlined, MobileOutlined, WifiOutlined
} from '@ant-design/icons'
import { adminApi } from '../../api/client'

const { Text } = Typography

interface MonitorStats {
  active_sessions: number
  errors_last_5min: number
  api_error_rate_pct: number
  avg_api_latency_ms: number
  ws_disconnect_last_1h: number
  sessions_today: number
}

interface ErrorGroup {
  error_message: string
  screen: string | null
  count: number
  affected_users: number
  first_seen: string
  last_seen: string
}

interface ApiEndpoint {
  endpoint: string
  method: string
  total_calls: number
  error_count: number
  error_rate_pct: number
  avg_ms: number
  p95_ms: number
}

interface ScreenFunnel {
  screen: string
  visit_count: number
  avg_duration_s: number
  unique_users: number
}

interface Session {
  session_id: string
  user_id: string | null
  platform: string
  app_version: string
  started_at: string
  ended_at: string | null
  last_seen_at: string
  event_count: number
  status: 'active' | 'ended'
}

// SVG bar chart — follows Dashboard.tsx custom SVG pattern
function SVGBarChart({
  data,
  height = 160,
}: {
  data: { label: string; value: number; secondary?: string }[]
  height?: number
}) {
  if (!data || data.length === 0) {
    return (
      <div style={{ height, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#999' }}>
        No screen data yet
      </div>
    )
  }
  const maxVal = Math.max(...data.map(d => d.value), 1)
  const width = 560
  const barSpacing = width / data.length
  const barW = Math.min(36, barSpacing - 6)

  return (
    <svg viewBox={`0 0 ${width} ${height}`} width="100%" height={height} style={{ overflow: 'visible' }}>
      {data.map((d, i) => {
        const barH = Math.max(2, (d.value / maxVal) * (height - 40))
        const x = i * barSpacing + (barSpacing - barW) / 2
        const y = height - 24 - barH
        return (
          <g key={i}>
            <rect x={x} y={y} width={barW} height={barH} fill="#1890ff" rx={3} opacity={0.75} />
            <text x={x + barW / 2} y={height - 8} textAnchor="middle" fontSize="9" fill="#666">
              {d.label.split('/').pop() || d.label}
            </text>
            {d.secondary && (
              <text x={x + barW / 2} y={y - 4} textAnchor="middle" fontSize="9" fill="#aaa">
                {d.secondary}
              </text>
            )}
            <title>{`${d.label}\nVisits: ${d.value}\n${d.secondary ?? ''}`}</title>
          </g>
        )
      })}
    </svg>
  )
}

export function AppMonitorTab() {
  const [stats, setStats] = useState<MonitorStats | null>(null)
  const [errors, setErrors] = useState<ErrorGroup[]>([])
  const [apiHealth, setApiHealth] = useState<ApiEndpoint[]>([])
  const [funnel, setFunnel] = useState<ScreenFunnel[]>([])
  const [sessions, setSessions] = useState<Session[]>([])
  const [loading, setLoading] = useState(true)
  const [errorHours, setErrorHours] = useState(24)
  const [apiHours, setApiHours] = useState(1)

  const load = useCallback(async () => {
    try {
      const [statsRes, errorsRes, apiRes, funnelRes, sessionsRes] = await Promise.allSettled([
        adminApi.get('/monitor/stats'),
        adminApi.get('/monitor/errors', { params: { hours: errorHours, limit: 50 } }),
        adminApi.get('/monitor/api-health', { params: { hours: apiHours } }),
        adminApi.get('/monitor/screen-funnel', { params: { hours: 24 } }),
        adminApi.get('/monitor/sessions', { params: { limit: 10, offset: 0 } }),
      ])
      if (statsRes.status === 'fulfilled') setStats(statsRes.value.data?.data ?? null)
      if (errorsRes.status === 'fulfilled') setErrors(errorsRes.value.data?.data ?? [])
      if (apiRes.status === 'fulfilled') setApiHealth(apiRes.value.data?.data ?? [])
      if (funnelRes.status === 'fulfilled') setFunnel(funnelRes.value.data?.data ?? [])
      if (sessionsRes.status === 'fulfilled') setSessions(sessionsRes.value.data?.data ?? [])
    } finally {
      setLoading(false)
    }
  }, [errorHours, apiHours])

  useEffect(() => {
    load()
    const interval = setInterval(load, 30_000)
    return () => clearInterval(interval)
  }, [load])

  const errorRowColor = (count: number) => {
    if (count > 10) return '#fff1f0'
    if (count > 3) return '#fff7e6'
    return undefined
  }

  const apiRateColor = (rate: number): string => {
    if (rate > 5) return 'red'
    if (rate > 1) return 'orange'
    return 'green'
  }

  return (
    <Spin spinning={loading && !stats}>
      {/* ── Section 1: Stats bar ── */}
      <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
        {[
          { title: 'Active Sessions', value: stats?.active_sessions ?? 0, icon: <MobileOutlined />, color: '#52c41a' },
          { title: 'Errors (5 min)', value: stats?.errors_last_5min ?? 0, icon: <BugOutlined />, color: stats?.errors_last_5min ? '#ff4d4f' : '#52c41a' },
          { title: 'Avg API Latency', value: `${stats?.avg_api_latency_ms ?? 0}ms`, icon: <ApiOutlined />, color: '#1890ff' },
          { title: 'API Error Rate', value: `${stats?.api_error_rate_pct ?? 0}%`, icon: <ApiOutlined />, color: (stats?.api_error_rate_pct ?? 0) > 5 ? '#ff4d4f' : '#52c41a' },
          { title: 'WS Disconnects (1h)', value: stats?.ws_disconnect_last_1h ?? 0, icon: <WifiOutlined />, color: '#faad14' },
          { title: 'Sessions Today', value: stats?.sessions_today ?? 0, icon: <MobileOutlined />, color: '#722ed1' },
        ].map((s, i) => (
          <Col span={4} key={i}>
            <Card size="small" style={{ textAlign: 'center' }}>
              <Statistic
                title={<span style={{ fontSize: 12 }}>{s.title}</span>}
                value={s.value}
                valueStyle={{ color: s.color, fontSize: 20 }}
                prefix={s.icon}
              />
            </Card>
          </Col>
        ))}
      </Row>

      {/* ── Section 2: Error Feed + API Health ── */}
      <Row gutter={16} style={{ marginBottom: 24 }}>
        <Col span={12}>
          <Card
            size="small"
            title={<span><BugOutlined /> Error Feed</span>}
            extra={
              <Select size="small" value={errorHours} onChange={setErrorHours} style={{ width: 90 }}>
                <Select.Option value={1}>Last 1h</Select.Option>
                <Select.Option value={24}>Last 24h</Select.Option>
                <Select.Option value={168}>Last 7d</Select.Option>
              </Select>
            }
          >
            <Table<ErrorGroup>
              dataSource={errors}
              rowKey={(r) => `${r.screen ?? 'null'}-${(r.error_message ?? '').substring(0, 50)}`}
              size="small"
              pagination={{ pageSize: 8, size: 'small' }}
              rowClassName={r => errorRowColor(r.count) ? 'error-row' : ''}
              onRow={r => ({ style: { background: errorRowColor(r.count) } })}
              columns={[
                {
                  title: 'Screen',
                  dataIndex: 'screen',
                  width: 100,
                  render: v => <Tag>{v ?? 'unknown'}</Tag>,
                },
                {
                  title: 'Error',
                  dataIndex: 'error_message',
                  ellipsis: true,
                  render: v => <Text style={{ fontSize: 11 }}>{v}</Text>,
                },
                { title: 'Count', dataIndex: 'count', width: 60, sorter: (a, b) => a.count - b.count },
                { title: 'Users', dataIndex: 'affected_users', width: 55 },
                {
                  title: 'Last Seen',
                  dataIndex: 'last_seen',
                  width: 120,
                  render: (v: string) => new Date(v).toLocaleString(),
                },
              ]}
            />
          </Card>
        </Col>

        <Col span={12}>
          <Card
            size="small"
            title={<span><ApiOutlined /> API Health</span>}
            extra={
              <Radio.Group size="small" value={apiHours} onChange={e => setApiHours(e.target.value)} buttonStyle="solid">
                <Radio.Button value={1}>1h</Radio.Button>
                <Radio.Button value={6}>6h</Radio.Button>
                <Radio.Button value={24}>24h</Radio.Button>
              </Radio.Group>
            }
          >
            <Table<ApiEndpoint>
              dataSource={apiHealth}
              rowKey={(r, i) => `${r.endpoint}-${i}`}
              size="small"
              pagination={{ pageSize: 8, size: 'small' }}
              columns={[
                {
                  title: 'Endpoint',
                  dataIndex: 'endpoint',
                  ellipsis: true,
                  render: (v, r) => <span><Tag color="blue" style={{ fontSize: 10 }}>{r.method}</Tag>{v}</span>,
                },
                { title: 'Calls', dataIndex: 'total_calls', width: 60 },
                {
                  title: 'Err%',
                  dataIndex: 'error_rate_pct',
                  width: 60,
                  render: v => <Tag color={apiRateColor(v)}>{v}%</Tag>,
                },
                { title: 'Avg ms', dataIndex: 'avg_ms', width: 65 },
                { title: 'P95 ms', dataIndex: 'p95_ms', width: 65 },
              ]}
            />
          </Card>
        </Col>
      </Row>

      {/* ── Section 3: Screen Funnel ── */}
      <Card
        size="small"
        title="Screen Funnel (last 24h)"
        style={{ marginBottom: 24 }}
      >
        <SVGBarChart
          data={funnel.map(f => ({
            label: f.screen,
            value: f.visit_count,
            secondary: `${f.avg_duration_s}s avg`,
          }))}
        />
      </Card>

      {/* ── Section 4: Recent Sessions ── */}
      <Card size="small" title={<span><MobileOutlined /> Recent Sessions</span>}>
        <Table<Session>
          dataSource={sessions}
          rowKey="session_id"
          size="small"
          pagination={{ pageSize: 10, size: 'small' }}
          columns={[
            {
              title: 'Platform',
              dataIndex: 'platform',
              width: 90,
              render: v => <Tag color={v === 'android' ? 'green' : 'blue'}>{v}</Tag>,
            },
            { title: 'Version', dataIndex: 'app_version', width: 75 },
            {
              title: 'Started',
              dataIndex: 'started_at',
              render: v => new Date(v).toLocaleString(),
            },
            {
              title: 'Events',
              dataIndex: 'event_count',
              width: 65,
            },
            {
              title: 'Status',
              dataIndex: 'status',
              width: 80,
              render: v => (
                <Badge
                  status={v === 'active' ? 'processing' : 'default'}
                  text={v}
                />
              ),
            },
          ]}
        />
      </Card>
    </Spin>
  )
}
