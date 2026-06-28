import { useEffect, useState, useCallback } from 'react'
import {
  Row, Col, Card, Statistic, Table, Tag, Typography, Select, Spin, Progress, Alert,
} from 'antd'
import {
  DollarOutlined, UserOutlined, PlayCircleOutlined, RiseOutlined, FallOutlined,
} from '@ant-design/icons'
import { adminApi } from '../api/client'

const { Title, Text } = Typography

// ── Minimal SVG chart components ──────────────────────────────────────────────

function BarChart({ data, valueKey, labelKey, color = '#1677ff' }: {
  data: any[]; valueKey: string; labelKey: string; color?: string
}) {
  if (!data.length) return <Text type="secondary">No data</Text>
  const max = Math.max(...data.map(d => parseFloat(d[valueKey] || 0)), 1)
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 120, padding: '8px 0' }}>
      {data.map((d, i) => {
        const val = parseFloat(d[valueKey] || 0)
        const pct = (val / max) * 100
        return (
          <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
            <Text style={{ fontSize: 10 }}>₹{val >= 1000 ? (val / 1000).toFixed(1) + 'K' : val.toFixed(0)}</Text>
            <div style={{ width: '100%', background: color, height: `${Math.max(pct, 4)}%`, borderRadius: 3, transition: 'height 0.3s' }} />
            <Text style={{ fontSize: 9, textAlign: 'center', color: '#888' }}>
              {String(d[labelKey] || '').slice(0, 6)}
            </Text>
          </div>
        )
      })}
    </div>
  )
}

function LineChart({ data, valueKey, labelKey, color = '#52c41a', height = 140 }: {
  data: any[]; valueKey: string; labelKey?: string; color?: string; height?: number
}) {
  if (data.length < 2) return <Text type="secondary">Insufficient data</Text>
  const vals = data.map(d => parseFloat(d[valueKey] || 0))
  const maxV = Math.max(...vals, 1)
  const minV = Math.min(...vals, 0)
  const range = maxV - minV || 1
  const W = 400; const H = height - 30

  const pts = vals.map((v, i) => ({
    x: (i / (vals.length - 1)) * (W - 60) + 40,
    y: H - 10 - ((v - minV) / range) * (H - 20),
    v,
    label: labelKey ? String(data[i][labelKey] || '').slice(5, 10) : String(i),
  }))
  const path = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ')
  const area = `${path} L ${pts[pts.length - 1].x} ${H} L ${pts[0].x} ${H} Z`

  return (
    <svg viewBox={`0 0 ${W} ${height}`} width="100%" height={height}>
      <path d={area} fill={`${color}18`} />
      <path d={path} fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" />
      {pts.filter((_, i) => i % Math.max(1, Math.floor(pts.length / 5)) === 0).map((p, i) => (
        <g key={i}>
          <circle cx={p.x} cy={p.y} r="3.5" fill={color} stroke="#fff" strokeWidth="1.5" />
          <text x={p.x} y={height - 4} textAnchor="middle" fontSize="9" fill="#999">{p.label}</text>
          <title>₹{p.v.toFixed(2)}</title>
        </g>
      ))}
    </svg>
  )
}

// ── Main Component ─────────────────────────────────────────────────────────────

export default function Analytics() {
  const [summary, setSummary] = useState<any>(null)
  const [ggr, setGgr] = useState<any[]>([])
  const [breakdown, setBreakdown] = useState<any[]>([])
  const [churn, setChurn] = useState<any[]>([])
  const [ggrDays, setGgrDays] = useState(7)
  const [loading, setLoading] = useState(true)

  const fetchAll = useCallback(async () => {
    setLoading(true)
    try {
      const [sumRes, ggrRes, brkRes, churnRes] = await Promise.all([
        adminApi.get('/analytics/summary').catch(() => ({ data: { data: {} } })),
        adminApi.get(`/analytics/ggr?days=${ggrDays}`).catch(() => ({ data: { data: [] } })),
        adminApi.get('/analytics/breakdown').catch(() => ({ data: { data: [] } })),
        adminApi.get('/analytics/churn?limit=20').catch(() => ({ data: { data: [] } })),
      ])
      setSummary(sumRes.data?.data || sumRes.data)
      setGgr((ggrRes.data?.data || []).filter((r: any) => !r.game_type || true))
      setBreakdown(brkRes.data?.data || [])
      setChurn(churnRes.data?.data || [])
    } finally {
      setLoading(false)
    }
  }, [ggrDays])

  useEffect(() => { fetchAll() }, [fetchAll])
  useEffect(() => {
    const t = setInterval(fetchAll, 30000)
    return () => clearInterval(t)
  }, [fetchAll])

  // Aggregate GGR by day (sum across game types)
  const ggrByDay = (() => {
    const map: Record<string, number> = {}
    for (const r of ggr) {
      const day = (r.day || '').slice(0, 10)
      map[day] = (map[day] || 0) + parseFloat(r.ggr || 0)
    }
    return Object.entries(map)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([day, ggr]) => ({ day, ggr }))
  })()

  const totalGGR = ggrByDay.reduce((s, r) => s + r.ggr, 0)

  const churnColumns = [
    { title: 'Player', dataIndex: 'username', key: 'username', render: (n: string) => <Text strong>{n}</Text> },
    { title: 'Last Played', dataIndex: 'last_played_at', key: 'last_played_at',
      render: (d: string) => d ? new Date(d).toLocaleDateString() : '-' },
    {
      title: 'Inactive Days',
      dataIndex: 'inactive_seconds',
      key: 'inactive_seconds',
      render: (s: number) => {
        const days = Math.floor(s / 86400)
        const color = days > 21 ? 'red' : days > 14 ? 'orange' : 'gold'
        return <Tag color={color}>{days}d idle</Tag>
      },
    },
    { title: 'Games Played', dataIndex: 'total_games', key: 'total_games' },
    { title: 'Total Won (₹)', dataIndex: 'total_prize_won', key: 'total_prize_won',
      render: (v: number) => `₹${parseFloat(v as any || 0).toFixed(2)}` },
    {
      title: 'Churn Risk',
      key: 'risk',
      render: (_: any, r: any) => {
        const days = Math.floor((r.inactive_seconds || 0) / 86400)
        const pct = Math.min(100, Math.round((days / 30) * 100))
        return <Progress percent={pct} size="small" strokeColor={pct > 70 ? '#ff4d4f' : '#fa8c16'} showInfo={false} />
      },
    },
  ]

  const breakdownColumns = [
    { title: 'Game', dataIndex: 'game_type', key: 'game_type',
      render: (t: string) => <Tag color="blue">{(t || 'unknown').replace('_', ' ').toUpperCase()}</Tag> },
    { title: 'Games', dataIndex: 'games', key: 'games' },
    { title: 'GGR (₹)', dataIndex: 'rake', key: 'rake',
      render: (v: number) => <Text strong style={{ color: '#d4af37' }}>₹{parseFloat(v as any || 0).toFixed(2)}</Text> },
    { title: 'Total Wagered (₹)', dataIndex: 'wagered', key: 'wagered',
      render: (v: number) => `₹${parseFloat(v as any || 0).toFixed(2)}` },
    { title: 'Unique Winners', dataIndex: 'unique_winners', key: 'unique_winners' },
    {
      title: 'Rake %',
      key: 'rake_pct',
      render: (_: any, r: any) => {
        const pct = r.wagered > 0 ? ((r.rake / r.wagered) * 100).toFixed(1) : '0'
        return `${pct}%`
      },
    },
  ]

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <Title level={3} style={{ margin: 0 }}>Analytics Dashboard</Title>
        {loading && <Spin size="small" />}
      </div>

      {/* Live Summary KPIs */}
      <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
        {[
          { title: 'GGR Today (₹)', value: summary?.ggr_today ?? 0, icon: <DollarOutlined />, color: '#d4af37', precision: 2 },
          { title: 'Active Players (1h)', value: summary?.active_players_1h ?? 0, icon: <UserOutlined />, color: '#52c41a' },
          { title: 'New Players Today', value: summary?.new_players_today ?? 0, icon: <RiseOutlined />, color: '#1677ff' },
          { title: 'DAU', value: summary?.dau ?? 0, icon: <PlayCircleOutlined />, color: '#722ed1' },
        ].map((item, i) => (
          <Col xs={24} sm={12} xl={6} key={i}>
            <Card>
              <Statistic
                title={item.title}
                value={item.value}
                prefix={item.icon}
                precision={item.precision}
                valueStyle={{ color: item.color }}
              />
            </Card>
          </Col>
        ))}
      </Row>

      <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
        {/* GGR Trend */}
        <Col xs={24} lg={14}>
          <Card
            title="Gross Gaming Revenue (GGR) Trend"
            extra={
              <Select
                value={ggrDays}
                onChange={setGgrDays}
                size="small"
                options={[{ value: 7, label: '7 days' }, { value: 14, label: '14 days' }, { value: 30, label: '30 days' }]}
              />
            }
          >
            <div style={{ marginBottom: 8 }}>
              <Text type="secondary">
                Total GGR ({ggrDays}d): </Text>
              <Text strong style={{ color: '#d4af37' }}>₹{totalGGR.toFixed(2)}</Text>
            </div>
            <LineChart data={ggrByDay} valueKey="ggr" labelKey="day" color="#d4af37" />
          </Card>
        </Col>

        {/* Game Breakdown */}
        <Col xs={24} lg={10}>
          <Card title="Game GGR Breakdown (Today)">
            {breakdown.length > 0 ? (
              <>
                <BarChart
                  data={breakdown}
                  valueKey="rake"
                  labelKey="game_type"
                  color="#1677ff"
                />
                <Table
                  dataSource={breakdown}
                  columns={breakdownColumns}
                  rowKey="game_type"
                  size="small"
                  pagination={false}
                  style={{ marginTop: 8 }}
                />
              </>
            ) : (
              <Alert message="No completed games today yet" type="info" showIcon />
            )}
          </Card>
        </Col>
      </Row>

      {/* Churn Risk */}
      <Card
        title={
          <span>
            <FallOutlined style={{ color: '#ff4d4f', marginRight: 8 }} />
            Churn Risk Players
            <Text type="secondary" style={{ fontSize: 12, marginLeft: 8 }}>
              Inactive ≥ 7 days — prioritize for retention campaigns
            </Text>
          </span>
        }
      >
        {churn.length === 0 ? (
          <Alert
            message="No at-risk players found — great retention!"
            type="success"
            showIcon
          />
        ) : (
          <Table
            dataSource={churn}
            columns={churnColumns}
            rowKey="id"
            size="small"
            pagination={{ pageSize: 10 }}
          />
        )}
      </Card>
    </div>
  )
}
