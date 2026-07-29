import { useEffect, useState } from 'react'
import { Card, Row, Col, DatePicker, Table, Tag, Statistic } from 'antd'
import dayjs, { Dayjs } from 'dayjs'
import { adminApi } from '../api/client'

const { RangePicker } = DatePicker

// Matches the palette already used throughout this admin panel
// (see Dashboard.tsx's stat cards) -- there is no shared theme/tokens
// module on this branch to import instead.
const COLOR_SUCCESS = '#52c41a'
const COLOR_ERROR = '#ff4d4f'
const COLOR_GOLD = '#d4af37'

// Small standalone line chart -- deliberately not shared with
// Dashboard.tsx's SVGLineChart. That file lives on a separate,
// unmerged branch lineage (the admin-panel visual redesign); importing
// from it here would require deploying this branch's Dashboard.tsx,
// which would silently revert the redesign already live in production.
function TrendLineChart({ data, valueKey, strokeColor }: { data: any[]; valueKey: string; strokeColor: string }) {
  const width = 600
  const height = 180
  if (!data || data.length === 0) {
    return <div style={{ height, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>No data available</div>
  }
  const values = data.map((d) => parseFloat(d[valueKey] || 0))
  const maxVal = Math.max(...values, 1)
  const minVal = Math.min(...values, 0)
  const range = maxVal - minVal || 1

  const points = data.map((d, idx) => {
    const x = (idx / (data.length - 1 || 1)) * (width - 60) + 40
    const val = parseFloat(d[valueKey] || 0)
    const y = height - 25 - ((val - minVal) / range) * (height - 45)
    const label = d.date ? new Date(d.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : ''
    return { x, y, label, val }
  })

  const pathD = points.reduce((acc, p, idx) => acc + (idx === 0 ? `M ${p.x} ${p.y}` : ` L ${p.x} ${p.y}`), '')

  return (
    <svg viewBox={`0 0 ${width} ${height}`} width="100%" height={height} style={{ overflow: 'visible' }}>
      <path d={pathD} fill="none" stroke={strokeColor} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      {points.map((p, idx) => (
        <g key={idx}>
          <circle cx={p.x} cy={p.y} r="3.5" fill={strokeColor} stroke="#fff" strokeWidth="1.5" />
          <title>{`${p.label}\n₹${p.val.toFixed(2)}`}</title>
        </g>
      ))}
      {points.filter((_, idx) => data.length < 8 || idx % Math.ceil(data.length / 4) === 0).map((p, idx) => (
        <text key={idx} x={p.x} y={height - 5} textAnchor="middle" fontSize="10" fill="#999">{p.label}</text>
      ))}
    </svg>
  )
}

export default function GamePnlDashboard({ gameType }: { gameType: string }) {
  const [range, setRange] = useState<[Dayjs, Dayjs]>([dayjs().subtract(7, 'day'), dayjs()])
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(false)
  const [page, setPage] = useState(1)
  const pageSize = 10

  const load = () => {
    setLoading(true)
    adminApi.get(`/games/${gameType}/pnl-dashboard`, {
      params: {
        from: range[0].toISOString(),
        to: range[1].toISOString(),
        page,
        limit: pageSize,
      },
    })
      .then((r) => setData(r.data))
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [gameType, range, page])

  if (!data) return <Card loading={loading} />

  return (
    <div>
      <RangePicker
        value={range}
        onChange={(v) => { if (v && v[0] && v[1]) { setRange([v[0], v[1]]); setPage(1) } }}
        style={{ marginBottom: 16 }}
      />
      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={24} sm={8}>
          <Card>
            <Statistic title="House Net Rake" value={data.summary.net_rake} precision={2} prefix="₹"
              valueStyle={{ color: data.summary.net_rake >= 0 ? COLOR_SUCCESS : COLOR_ERROR }} />
          </Card>
        </Col>
        <Col xs={24} sm={8}>
          <Card>
            <Statistic title="Real Users PnL" value={data.breakdown.real.net_pnl} precision={2} prefix="₹"
              valueStyle={{ color: data.breakdown.real.net_pnl >= 0 ? COLOR_SUCCESS : COLOR_ERROR }} />
          </Card>
        </Col>
        <Col xs={24} sm={8}>
          <Card>
            <Statistic title="Bot PnL" value={data.breakdown.bot.net_pnl} precision={2} prefix="₹"
              valueStyle={{ color: data.breakdown.bot.net_pnl >= 0 ? COLOR_SUCCESS : COLOR_ERROR }} />
          </Card>
        </Col>
      </Row>

      <Card title="Daily Trend (Rake)" style={{ marginBottom: 16 }}>
        <TrendLineChart data={data.daily_trend} valueKey="rake" strokeColor={COLOR_GOLD} />
      </Card>

      <Card title="Bot Bankroll ROI (All-Time)" style={{ marginBottom: 16 }}>
        <Row gutter={16}>
          <Col span={6}><Statistic title="Invested" value={data.bot_roi.total_invested} precision={2} prefix="₹" /></Col>
          <Col span={6}><Statistic title="Current Balance" value={data.bot_roi.current_balance} precision={2} prefix="₹" /></Col>
          <Col span={6}><Statistic title="Realized PnL" value={data.bot_roi.net_realized_pnl} precision={2} prefix="₹"
            valueStyle={{ color: data.bot_roi.net_realized_pnl >= 0 ? COLOR_SUCCESS : COLOR_ERROR }} /></Col>
          <Col span={6}><Statistic title="ROI %" value={data.bot_roi.roi_pct} precision={1} suffix="%"
            valueStyle={{ color: data.bot_roi.roi_pct >= 0 ? COLOR_SUCCESS : COLOR_ERROR }} /></Col>
        </Row>
      </Card>

      <Card title="Leaderboard (Top Winners/Losers)" style={{ marginBottom: 16 }}>
        <Table
          rowKey="user_id"
          dataSource={data.leaderboard}
          pagination={false}
          size="small"
          columns={[
            { title: 'Username', dataIndex: 'username' },
            { title: 'Type', dataIndex: 'is_bot', render: (v: boolean) => <Tag color={v ? 'orange' : 'blue'}>{v ? 'BOT' : 'REAL'}</Tag> },
            { title: 'Games', dataIndex: 'games_played' },
            {
              title: 'Net PnL', dataIndex: 'net_pnl',
              render: (v: number) => <span style={{ color: v >= 0 ? COLOR_SUCCESS : COLOR_ERROR, fontWeight: 'bold' }}>₹{v.toLocaleString()}</span>,
            },
          ]}
        />
      </Card>

      <Card title="Game History">
        <Table
          rowKey="room_id"
          dataSource={data.history.rows}
          loading={loading}
          size="small"
          pagination={{ current: page, pageSize, total: data.history.total, onChange: setPage, showSizeChanger: false }}
          columns={[
            { title: 'Room', dataIndex: 'room_id', render: (v: string) => v.slice(0, 8) + '...' },
            { title: 'Started', dataIndex: 'started_at', render: (v: string) => new Date(v).toLocaleString() },
            { title: 'Players', dataIndex: 'players' },
            { title: 'Pot (₹)', dataIndex: 'pot_amount', render: (v: number) => `₹${parseFloat(v as any).toFixed(2)}` },
            { title: 'Rake (₹)', dataIndex: 'platform_fee_collected', render: (v: number) => `₹${parseFloat(v as any).toFixed(2)}` },
          ]}
        />
      </Card>
    </div>
  )
}
