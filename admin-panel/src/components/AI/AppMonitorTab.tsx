// admin-panel/src/components/AI/AppMonitorTab.tsx
import { useState, useEffect, useCallback } from 'react'
import {
  Card, Row, Col, Statistic, Table, Tag, Select, Spin, Badge, Radio, Typography, Progress, Tooltip
} from 'antd'
import {
  BugOutlined, ApiOutlined, MobileOutlined, WifiOutlined, CloudServerOutlined, DatabaseOutlined
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

interface MonitorAlert {
  id: string
  kind: string
  severity: 'warning' | 'critical'
  message: string
  acknowledged: boolean
  created_at: string
}

interface Remediation {
  id: string
  target: string
  action: string
  result: 'fixed' | 'failed'
  details: { strikes?: number; error?: string }
  created_at: string
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

interface Pm2Process {
  name: string
  status: string
  memory_mb: number
  cpu_pct: number
  restarts: number
  uptime_ms: number
}

interface DockerContainer {
  name: string
  state: string
  health: string
}

interface ServerHealth {
  processes: Pm2Process[]
  system: {
    total_ram_mb: number
    used_ram_mb: number
    free_ram_mb: number
    load_avg_1m: number
    load_avg_5m: number
    cpu_count: number
  }
  docker: DockerContainer[]
  checked_at: string
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
  const [serverHealth, setServerHealth] = useState<ServerHealth | null>(null)
  const [uptime, setUptime] = useState<any>(null)
  const [alerts, setAlerts] = useState<MonitorAlert[]>([])
  const [remediations, setRemediations] = useState<Remediation[]>([])
  const [loading, setLoading] = useState(true)
  const [errorHours, setErrorHours] = useState(24)
  const [apiHours, setApiHours] = useState(1)

  const load = useCallback(async () => {
    try {
      const [statsRes, errorsRes, apiRes, funnelRes, sessionsRes, serverRes, uptimeRes, alertsRes, remediationsRes] = await Promise.allSettled([
        adminApi.get('/monitor/stats'),
        adminApi.get('/monitor/errors', { params: { hours: errorHours, limit: 50 } }),
        adminApi.get('/monitor/api-health', { params: { hours: apiHours } }),
        adminApi.get('/monitor/screen-funnel', { params: { hours: 24 } }),
        adminApi.get('/monitor/sessions', { params: { limit: 10, offset: 0 } }),
        adminApi.get('/monitor/server-health'),
        adminApi.get('/monitor/uptime'),
        adminApi.get('/monitor/alerts', { params: { limit: 30 } }),
        adminApi.get('/monitor/remediations', { params: { limit: 30 } }),
      ])
      if (statsRes.status === 'fulfilled') setStats(statsRes.value.data?.data ?? null)
      if (errorsRes.status === 'fulfilled') setErrors(errorsRes.value.data?.data ?? [])
      if (apiRes.status === 'fulfilled') setApiHealth(apiRes.value.data?.data ?? [])
      if (funnelRes.status === 'fulfilled') setFunnel(funnelRes.value.data?.data ?? [])
      if (sessionsRes.status === 'fulfilled') setSessions(sessionsRes.value.data?.data ?? [])
      if (serverRes.status === 'fulfilled') setServerHealth(serverRes.value.data?.data ?? null)
      if (uptimeRes.status === 'fulfilled') setUptime(uptimeRes.value.data?.data ?? null)
      if (alertsRes.status === 'fulfilled') setAlerts(alertsRes.value.data?.data ?? [])
      if (remediationsRes.status === 'fulfilled') setRemediations(remediationsRes.value.data?.data ?? [])
    } finally {
      setLoading(false)
    }
  }, [errorHours, apiHours])

  const ackAlert = async (id: string) => {
    try {
      await adminApi.post(`/monitor/alerts/${id}/ack`)
      setAlerts(a => a.map(al => al.id === id ? { ...al, acknowledged: true } : al))
    } catch { /* transient — next refresh corrects */ }
  }

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

  const openAlerts = alerts.filter(a => !a.acknowledged)

  return (
    <Spin spinning={loading && !stats}>
      {/* ── Alerts (raised by the app-monitor alert engine, 2-min sweeps) ── */}
      {openAlerts.length > 0 && (
        <Card
          size="small"
          title={<span style={{ fontWeight: 'bold' }}>🚨 Active Alerts ({openAlerts.length})</span>}
          style={{ marginBottom: 24, borderLeft: '4px solid #ff4d4f' }}
        >
          {openAlerts.map(a => (
            <div key={a.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0' }}>
              <div>
                <Tag color={a.severity === 'critical' ? 'red' : 'orange'}>{a.severity.toUpperCase()}</Tag>
                <Text strong>{a.message}</Text>
                <Text type="secondary" style={{ marginLeft: 8, fontSize: 11 }}>
                  {new Date(a.created_at).toLocaleString()}
                </Text>
              </div>
              <a onClick={() => ackAlert(a.id)} style={{ fontSize: 12 }}>Acknowledge</a>
            </div>
          ))}
        </Card>
      )}

      {/* ── Auto-Fix History (Level-1 self-healing remediator) ── */}
      {remediations.length > 0 && (
        <Card
          size="small"
          title={<span style={{ fontWeight: 'bold' }}>🔧 Auto-Fix History</span>}
          style={{ marginBottom: 24, borderLeft: '4px solid #722ed1' }}
        >
          <Table
            dataSource={remediations}
            rowKey="id"
            size="small"
            pagination={{ pageSize: 5 }}
            columns={[
              { title: 'Time', dataIndex: 'created_at', width: 170,
                render: (v: string) => new Date(v).toLocaleString() },
              { title: 'Service', dataIndex: 'target', width: 160,
                render: (t: string) => <Text code>{t}</Text> },
              { title: 'Action', dataIndex: 'action', width: 90,
                render: (a: string) => <Tag color="blue">{a.toUpperCase()}</Tag> },
              { title: 'Result', dataIndex: 'result', width: 90,
                render: (r: string) => <Tag color={r === 'fixed' ? 'green' : 'red'}>{r.toUpperCase()}</Tag> },
              { title: 'Details', dataIndex: 'details',
                render: (d: Remediation['details']) => (
                  <Text type="secondary" style={{ fontSize: 11 }}>
                    attempt {d?.strikes ?? 1}/3{d?.error ? ` — ${d.error.slice(0, 80)}` : ''}
                  </Text>
                ) },
            ]}
          />
        </Card>
      )}

      {/* ── Live Client-to-Server Connectivity Status ── */}
      {uptime && (
        <Card
          size="small"
          title={<span style={{ fontWeight: 'bold' }}>📡 Live Client-to-Server Connectivity (Uptime Bot)</span>}
          style={{ marginBottom: 24, borderLeft: '4px solid #52c41a' }}
          extra={<Text type="secondary" style={{ fontSize: 11 }}>Checked {new Date(uptime.timestamp).toLocaleTimeString()}</Text>}
        >
          <Row gutter={[16, 16]}>
            <Col span={6}>
              <Card size="small" type="inner" title="Databases">
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Text style={{ fontSize: 12 }}>PostgreSQL DB</Text>
                    <Tag color={uptime.database.up ? 'green' : 'red'} style={{ fontSize: 11 }}>
                      {uptime.database.up ? `ONLINE (${uptime.database.latency}ms)` : 'OFFLINE'}
                    </Tag>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Text style={{ fontSize: 12 }}>Redis Cache</Text>
                    <Tag color={uptime.redis.up ? 'green' : 'red'} style={{ fontSize: 11 }}>
                      {uptime.redis.up ? `ONLINE (${uptime.redis.latency}ms)` : 'OFFLINE'}
                    </Tag>
                  </div>
                </div>
              </Card>
            </Col>
            <Col span={10}>
              <Card size="small" type="inner" title="Public WebSocket Handshakes">
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Text style={{ fontSize: 12 }}>Game Gateway (wss://.../ws)</Text>
                    <Tag color={uptime.publicWebsockets.gateway.up ? 'green' : 'red'} style={{ fontSize: 11 }}>
                      {uptime.publicWebsockets.gateway.up ? `CONNECTED (${uptime.publicWebsockets.gateway.latency}ms)` : 'REFUSED/TIMEOUT'}
                    </Tag>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Text style={{ fontSize: 12 }}>Aviator Engine (wss://.../ws/aviator)</Text>
                    <Tag color={uptime.publicWebsockets.aviator.up ? 'green' : 'red'} style={{ fontSize: 11 }}>
                      {uptime.publicWebsockets.aviator.up ? `CONNECTED (${uptime.publicWebsockets.aviator.latency}ms)` : 'REFUSED/TIMEOUT'}
                    </Tag>
                  </div>
                </div>
              </Card>
            </Col>
            <Col span={8}>
              <Card size="small" type="inner" title="System TCP Diagnostics">
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {Object.keys(uptime.services).map(name => {
                    const svc = uptime.services[name];
                    return (
                      <Tooltip key={name} title={`Port ${svc.port}: ${svc.up ? 'Open' : 'Closed'}`}>
                        <Tag color={svc.up ? 'green' : 'red'} style={{ fontSize: 10, margin: '2px 0' }}>
                          {name.split(' ')[0]} ({svc.port})
                        </Tag>
                      </Tooltip>
                    );
                  })}
                </div>
              </Card>
            </Col>
          </Row>
        </Card>
      )}

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
      <Card size="small" title={<span><MobileOutlined /> Recent Sessions</span>} style={{ marginBottom: 24 }}>
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

      {/* ── Section 5: Server Health (PM2 + RAM + Docker) ── */}
      {serverHealth && (
        <>
          {/* System RAM + Load */}
          <Row gutter={16} style={{ marginBottom: 16 }}>
            <Col span={16}>
              <Card size="small" title={<span><CloudServerOutlined /> Server RAM</span>}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                  <div style={{ flex: 1 }}>
                    <Progress
                      percent={Math.round((serverHealth.system.used_ram_mb / serverHealth.system.total_ram_mb) * 100)}
                      strokeColor={
                        serverHealth.system.used_ram_mb / serverHealth.system.total_ram_mb > 0.85 ? '#ff4d4f'
                        : serverHealth.system.used_ram_mb / serverHealth.system.total_ram_mb > 0.70 ? '#faad14'
                        : '#52c41a'
                      }
                      format={() =>
                        `${serverHealth.system.used_ram_mb}MB / ${serverHealth.system.total_ram_mb}MB`
                      }
                    />
                  </div>
                  <Statistic
                    title="Load 1m"
                    value={serverHealth.system.load_avg_1m}
                    valueStyle={{ fontSize: 16, color: serverHealth.system.load_avg_1m > serverHealth.system.cpu_count ? '#ff4d4f' : '#52c41a' }}
                  />
                  <Statistic
                    title="Load 5m"
                    value={serverHealth.system.load_avg_5m}
                    valueStyle={{ fontSize: 16 }}
                  />
                  <Statistic
                    title="CPUs"
                    value={serverHealth.system.cpu_count}
                    valueStyle={{ fontSize: 16 }}
                  />
                </div>
              </Card>
            </Col>
            <Col span={8}>
              <Card size="small" title={<span><DatabaseOutlined /> Docker</span>}>
                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                  {serverHealth.docker.length === 0 && <Text type="secondary">No containers</Text>}
                  {serverHealth.docker.map(c => (
                    <Tooltip key={c.name} title={`State: ${c.state} | Health: ${c.health}`}>
                      <Tag color={c.state === 'running' && c.health !== 'unhealthy' ? 'green' : 'red'}>
                        {c.name.replace('teen_', '')}
                        {' '}
                        <Badge
                          status={c.state === 'running' ? (c.health === 'healthy' ? 'success' : 'warning') : 'error'}
                        />
                      </Tag>
                    </Tooltip>
                  ))}
                </div>
              </Card>
            </Col>
          </Row>

          {/* PM2 Process Table */}
          <Card
            size="small"
            title={<span><CloudServerOutlined /> PM2 Processes</span>}
            extra={<Text type="secondary" style={{ fontSize: 11 }}>Updated {new Date(serverHealth.checked_at).toLocaleTimeString()}</Text>}
          >
            <Table<Pm2Process>
              dataSource={serverHealth.processes}
              rowKey="name"
              size="small"
              pagination={false}
              rowClassName={r => r.status !== 'online' ? 'error-row' : ''}
              onRow={r => ({ style: { background: r.status !== 'online' ? '#fff1f0' : undefined } })}
              columns={[
                {
                  title: 'Service',
                  dataIndex: 'name',
                  render: v => <Text strong style={{ fontSize: 12 }}>{v}</Text>,
                },
                {
                  title: 'Status',
                  dataIndex: 'status',
                  width: 90,
                  render: v => (
                    <Badge
                      status={v === 'online' ? 'success' : 'error'}
                      text={<span style={{ fontSize: 11 }}>{v}</span>}
                    />
                  ),
                },
                {
                  title: 'RAM',
                  dataIndex: 'memory_mb',
                  width: 80,
                  sorter: (a, b) => a.memory_mb - b.memory_mb,
                  render: v => (
                    <Tag color={v > 300 ? 'red' : v > 150 ? 'orange' : 'default'} style={{ fontSize: 11 }}>
                      {v}MB
                    </Tag>
                  ),
                },
                {
                  title: 'CPU%',
                  dataIndex: 'cpu_pct',
                  width: 65,
                  sorter: (a, b) => a.cpu_pct - b.cpu_pct,
                  render: v => <Text style={{ fontSize: 11 }}>{v}%</Text>,
                },
                {
                  title: 'Restarts',
                  dataIndex: 'restarts',
                  width: 75,
                  sorter: (a, b) => a.restarts - b.restarts,
                  render: v => (
                    <Tag color={v > 20 ? 'red' : v > 5 ? 'orange' : 'default'} style={{ fontSize: 11 }}>
                      {v}
                    </Tag>
                  ),
                },
                {
                  title: 'Uptime',
                  dataIndex: 'uptime_ms',
                  width: 90,
                  render: (v: number) => {
                    if (!v) return '-'
                    const h = Math.floor(v / 3_600_000)
                    const m = Math.floor((v % 3_600_000) / 60_000)
                    return h > 0 ? `${h}h ${m}m` : `${m}m`
                  },
                },
              ]}
            />
          </Card>
        </>
      )}
    </Spin>
  )
}
