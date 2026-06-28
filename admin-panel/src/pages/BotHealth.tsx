import { useEffect, useState, useCallback } from 'react'
import { Row, Col, Card, Statistic, Table, Tag, Typography, Select, Progress, Badge, Alert } from 'antd'
import { RobotOutlined, TrophyOutlined, SwapOutlined } from '@ant-design/icons'
import { adminApi } from '../api/client'

const { Title, Text } = Typography

function DonutChart({ slices, size = 120 }: { slices: { label: string; value: number; color: string }[]; size?: number }) {
  const total = slices.reduce((s, sl) => s + sl.value, 0) || 1
  const r = size / 2 - 10
  const cx = size / 2; const cy = size / 2

  let angle = -Math.PI / 2
  const paths = slices.map(sl => {
    const frac = sl.value / total
    const startAngle = angle
    angle += frac * 2 * Math.PI
    const endAngle = angle
    const x1 = cx + r * Math.cos(startAngle); const y1 = cy + r * Math.sin(startAngle)
    const x2 = cx + r * Math.cos(endAngle);   const y2 = cy + r * Math.sin(endAngle)
    const large = frac > 0.5 ? 1 : 0
    return { ...sl, d: `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} Z` }
  })

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ flexShrink: 0 }}>
        {paths.map((p, i) => <path key={i} d={p.d} fill={p.color}><title>{p.label}: {p.value}</title></path>)}
        <circle cx={cx} cy={cy} r={r * 0.55} fill="white" />
        <text x={cx} y={cy + 4} textAnchor="middle" fontSize={11} fontWeight="bold" fill="#333">{total}</text>
      </svg>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {slices.map((sl, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
            <div style={{ width: 10, height: 10, borderRadius: 2, background: sl.color, flexShrink: 0 }} />
            <span style={{ color: '#555' }}>{sl.label}</span>
            <span style={{ fontWeight: 600 }}>{sl.value}</span>
            <span style={{ color: '#999' }}>({((sl.value / total) * 100).toFixed(0)}%)</span>
          </div>
        ))}
      </div>
    </div>
  )
}

type GameFilter = 'all' | 'teen_patti' | 'ludo'

export default function BotHealth() {
  const [stats, setStats] = useState<any>(null)
  const [gameFilter, setGameFilter] = useState<GameFilter>('all')
  const [loading, setLoading] = useState(true)

  const fetchStats = useCallback(async () => {
    setLoading(true)
    try {
      const params = gameFilter === 'all' ? '' : `&game_type=${gameFilter}`
      const res = await adminApi.get(`/bot-stats?hours=24${params}`)
      setStats(res.data?.data || res.data)
    } catch {
      setStats(null)
    } finally {
      setLoading(false)
    }
  }, [gameFilter])

  useEffect(() => { fetchStats() }, [fetchStats])
  useEffect(() => {
    const t = setInterval(fetchStats, 30000)
    return () => clearInterval(t)
  }, [fetchStats])

  const dist = stats?.actionDistribution || {}
  const actionSlices = [
    { label: 'Call', value: dist.call || 0, color: '#52c41a' },
    { label: 'Fold', value: dist.fold || 0, color: '#ff4d4f' },
    { label: 'Capture', value: dist.capture || 0, color: '#1677ff' },
    { label: 'Advance', value: dist.advance || 0, color: '#fa8c16' },
    { label: 'No Move', value: dist.no_move || 0, color: '#d9d9d9' },
  ].filter(s => s.value > 0)

  const winRatePct = parseFloat(stats?.winRate || '0%')
  const winRateNum = isNaN(winRatePct) ? parseFloat(stats?.winRate) : winRatePct
  const winPct = typeof winRateNum === 'number' && !isNaN(winRateNum) ? winRateNum : 0

  const recentColumns = [
    { title: 'Room', dataIndex: 'room_id', key: 'room_id',
      render: (v: string) => v ? <Text code>{String(v).slice(0, 8)}</Text> : '-' },
    { title: 'Game', dataIndex: 'game_type', key: 'game_type',
      render: (t: string) => <Tag color="blue">{(t || '').replace('_', ' ')}</Tag> },
    { title: 'Action', dataIndex: 'action_taken', key: 'action_taken',
      render: (a: string) => {
        const colors: Record<string, string> = { call: 'green', fold: 'red', capture: 'blue', advance: 'orange', no_move: 'default' }
        return <Tag color={colors[a] || 'default'}>{a}</Tag>
      },
    },
    { title: 'Outcome', dataIndex: 'outcome', key: 'outcome',
      render: (o: string) => o ? (
        <Badge status={o === 'win' ? 'success' : 'error'} text={o} />
      ) : <Text type="secondary">pending</Text>,
    },
    { title: 'P&L (₹)', dataIndex: 'profit_loss', key: 'profit_loss',
      render: (v: number) => {
        if (v == null) return '-'
        const n = parseFloat(v as any)
        return <Text style={{ color: n >= 0 ? '#52c41a' : '#ff4d4f' }}>{n >= 0 ? '+' : ''}₹{n.toFixed(2)}</Text>
      },
    },
    { title: 'Context', dataIndex: 'decision_context', key: 'decision_context',
      render: (ctx: any) => {
        if (!ctx) return '-'
        const c = typeof ctx === 'string' ? JSON.parse(ctx) : ctx
        return (
          <Text type="secondary" style={{ fontSize: 11 }}>
            {c.dice ? `🎲 ${c.dice}` : ''}
            {c.pot ? ` pot=₹${c.pot}` : ''}
            {c.round != null ? ` r${c.round}` : ''}
          </Text>
        )
      },
    },
    { title: 'Time', dataIndex: 'created_at', key: 'created_at',
      render: (d: string) => d ? new Date(d).toLocaleTimeString() : '-' },
  ]

  const isHealthy = winPct >= 40 && winPct <= 60

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <Title level={3} style={{ margin: 0 }}>
          <RobotOutlined style={{ marginRight: 8 }} />
          Bot Health Dashboard
        </Title>
        <Select
          value={gameFilter}
          onChange={v => setGameFilter(v as GameFilter)}
          style={{ width: 160 }}
          options={[
            { value: 'all', label: 'All Games' },
            { value: 'teen_patti', label: '🃏 Teen Patti' },
            { value: 'ludo', label: '🎲 Ludo' },
          ]}
        />
      </div>

      {!loading && !stats && (
        <Alert
          message="No bot data available yet"
          description="Bot decisions will appear here after games are played with bots."
          type="info"
          showIcon
          style={{ marginBottom: 24 }}
        />
      )}

      {/* KPI row */}
      <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
        <Col xs={24} sm={12} xl={6}>
          <Card>
            <Statistic
              title="Total Decisions (24h)"
              value={stats?.totalDecisions || 0}
              prefix={<SwapOutlined />}
              valueStyle={{ color: '#1677ff' }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} xl={6}>
          <Card>
            <div style={{ marginBottom: 4 }}>
              <Text type="secondary">Win Rate</Text>
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
              <Title level={3} style={{ margin: 0, color: isHealthy ? '#52c41a' : '#ff4d4f' }}>
                {stats?.winRate || '—'}
              </Title>
              <Text type="secondary" style={{ fontSize: 11 }}>target: 48–52%</Text>
            </div>
            <Progress
              percent={winPct}
              strokeColor={isHealthy ? '#52c41a' : '#ff4d4f'}
              trailColor="#f0f0f0"
              showInfo={false}
              style={{ marginTop: 8 }}
            />
            <Text style={{ fontSize: 11, color: isHealthy ? '#52c41a' : '#ff4d4f' }}>
              {isHealthy ? '✓ Within target range' : '⚠ Outside target range'}
            </Text>
          </Card>
        </Col>
        <Col xs={24} sm={12} xl={6}>
          <Card>
            <Statistic
              title="Rooms Played (24h)"
              value={stats?.roomsPlayed || 0}
              prefix={<TrophyOutlined />}
              valueStyle={{ color: '#722ed1' }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} xl={6}>
          <Card>
            <Statistic
              title="Avg P&L per Decision (₹)"
              value={parseFloat(stats?.avgProfitLoss || '0')}
              precision={2}
              prefix="₹"
              valueStyle={{ color: parseFloat(stats?.avgProfitLoss || '0') >= 0 ? '#52c41a' : '#ff4d4f' }}
            />
          </Card>
        </Col>
      </Row>

      <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
        {/* Decision Distribution */}
        <Col xs={24} lg={10}>
          <Card title="Action Distribution (24h)">
            {actionSlices.length > 0 ? (
              <DonutChart slices={actionSlices} size={160} />
            ) : (
              <Text type="secondary">No data yet</Text>
            )}
            <div style={{ marginTop: 16, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              {[
                { label: 'Call', key: 'call', color: '#52c41a', desc: 'Teen Patti: stay in hand' },
                { label: 'Fold', key: 'fold', color: '#ff4d4f', desc: 'Teen Patti: forfeit hand' },
                { label: 'Capture', key: 'capture', color: '#1677ff', desc: 'Ludo: send opponent back' },
                { label: 'Advance', key: 'advance', color: '#fa8c16', desc: 'Ludo: move forward' },
              ].map(item => (
                <div key={item.key} style={{ padding: 8, border: `1px solid ${item.color}22`, borderRadius: 6, background: `${item.color}08` }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <Text style={{ color: item.color, fontWeight: 600 }}>{item.label}</Text>
                    <Text strong>{dist[item.key] || 0}</Text>
                  </div>
                  <Text type="secondary" style={{ fontSize: 10 }}>{item.desc}</Text>
                </div>
              ))}
            </div>
          </Card>
        </Col>

        {/* Health Status */}
        <Col xs={24} lg={14}>
          <Card title="Health Assessment">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {[
                {
                  label: 'Win Rate Balance',
                  status: isHealthy ? 'success' : 'error',
                  detail: isHealthy
                    ? `${stats?.winRate || '—'} is within the 48–52% fair range`
                    : `${stats?.winRate || '—'} is outside target — review bot strategy`,
                },
                {
                  label: 'Decision Volume',
                  status: (stats?.totalDecisions || 0) > 10 ? 'success' : 'warning',
                  detail: (stats?.totalDecisions || 0) > 10
                    ? `${stats?.totalDecisions} decisions recorded (sufficient training data)`
                    : 'Low decision count — need more bot games for meaningful stats',
                },
                {
                  label: 'P&L Neutrality',
                  status: Math.abs(parseFloat(stats?.avgProfitLoss || '0')) < 10 ? 'success' : 'warning',
                  detail: `Avg P&L: ₹${parseFloat(stats?.avgProfitLoss || '0').toFixed(2)} per decision`,
                },
                {
                  label: 'Data Pipeline',
                  status: (stats?.totalDecisions || 0) > 0 ? 'success' : 'default',
                  detail: (stats?.totalDecisions || 0) > 0
                    ? 'bot_decision_logs table receiving data correctly'
                    : 'No data in bot_decision_logs — check bot integration',
                },
              ].map((item, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '10px 12px', background: '#fafafa', borderRadius: 8 }}>
                  <Badge status={item.status as any} />
                  <div>
                    <Text strong>{item.label}</Text>
                    <br />
                    <Text type="secondary" style={{ fontSize: 12 }}>{item.detail}</Text>
                  </div>
                </div>
              ))}
            </div>

            <div style={{ marginTop: 16, padding: 12, background: '#f6ffed', border: '1px solid #b7eb8f', borderRadius: 8 }}>
              <Text strong style={{ color: '#389e0d' }}>Phase 3 Readiness</Text>
              <br />
              <Text style={{ fontSize: 12 }}>
                Bot decision logs are accumulating. Once 10,000+ decisions are recorded, the Phase 3
                bot learning loop (decision tree retraining) can be activated.
                Current: <Text strong>{stats?.totalDecisions || 0}</Text> / 10,000 decisions.
              </Text>
              <Progress
                percent={Math.min(100, Math.round(((stats?.totalDecisions || 0) / 10000) * 100))}
                size="small"
                strokeColor="#52c41a"
                style={{ marginTop: 8 }}
              />
            </div>
          </Card>
        </Col>
      </Row>

      {/* Recent Decisions Table */}
      <Card title="Recent Bot Decisions (Last 24h)">
        <Table
          dataSource={stats?.recentDecisions || []}
          columns={recentColumns}
          rowKey={(r: any) => r.id || Math.random()}
          size="small"
          pagination={{ pageSize: 15 }}
          loading={loading}
        />
      </Card>
    </div>
  )
}
