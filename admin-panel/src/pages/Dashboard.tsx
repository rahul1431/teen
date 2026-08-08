import { useEffect, useState, type ReactNode } from 'react'
import { Row, Col, Card, Statistic, Table, Tag, Typography, Badge, Button, Radio, Space, Tooltip } from 'antd'
import {
  UserOutlined, DollarOutlined, PlayCircleOutlined, WarningOutlined,
  ReloadOutlined, RiseOutlined, FallOutlined, RocketOutlined,
  SafetyOutlined, RobotOutlined, BankOutlined, ArrowRightOutlined,
  ThunderboltOutlined, CheckCircleOutlined, SwapOutlined,
} from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import { adminApi } from '../api/client'
import { tokens } from '../theme/tokens'

// ---- Custom SVG Charting Component ----
function SVGLineChart({ data, width = 500, height = 220, strokeColor = '#D4AF37', fillColor = 'rgba(212, 175, 55, 0.08)', valueKey = 'ggr' }: { data: any[], width?: number, height?: number, strokeColor?: string, fillColor?: string, valueKey?: string }) {
  if (!data || data.length === 0) return <div style={{ height, display: 'flex', alignItems: 'center', justifyContent: 'center', color: tokens.color.textMuted }}>No revenue trend data available</div>;

  const values = data.map(d => parseFloat(d[valueKey] || 0));
  const maxVal = Math.max(...values, 100);
  const minVal = Math.min(...values, 0);
  const range = (maxVal - minVal) || 1;

  const points = data.map((d, idx) => {
    const x = (idx / (data.length - 1 || 1)) * (width - 70) + 45;
    const val = parseFloat(d[valueKey] || 0);
    const y = height - 30 - ((val - minVal) / range) * (height - 55);
    return { x, y, label: d.day ? new Date(d.day).toLocaleDateString(undefined, {month: 'short', day: 'numeric'}) : `Day ${idx+1}`, val };
  });

  const pathD = points.reduce((acc, p, idx) => {
    return acc + (idx === 0 ? `M ${p.x} ${p.y}` : ` L ${p.x} ${p.y}`);
  }, '');

  const areaD = pathD ? `${pathD} L ${points[points.length - 1].x} ${height - 30} L ${points[0].x} ${height - 30} Z` : '';

  return (
    <svg viewBox={`0 0 ${width} ${height}`} width="100%" height={height} style={{ overflow: 'visible' }}>
      {/* Grid lines */}
      {[0, 0.5, 1].map((ratio, idx) => {
        const y = 25 + ratio * (height - 55);
        const val = maxVal - ratio * range;
        return (
          <g key={idx}>
            <line x1="45" y1={y} x2={width - 20} y2={y} stroke="#E2E8F0" strokeDasharray="4 4" />
            <text x="38" y={y + 4} textAnchor="end" fontSize="10" fill="#64748B" fontWeight="500">₹{val.toFixed(0)}</text>
          </g>
        );
      })}

      {/* Area fill */}
      {areaD && <path d={areaD} fill={fillColor} />}
      {/* Line path */}
      {pathD && <path d={pathD} fill="none" stroke={strokeColor} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />}

      {/* Points and Tooltips */}
      {points.map((p, idx) => (
        <g key={idx}>
          <circle cx={p.x} cy={p.y} r="4" fill={strokeColor} stroke="#FFFFFF" strokeWidth="2" />
          <title>{`${p.label}\n₹${p.val.toFixed(2)}`}</title>
        </g>
      ))}

      {/* X Axis Labels */}
      {points.filter((_, idx) => data.length < 8 || idx % Math.ceil(data.length / 5) === 0).map((p, idx) => (
        <text key={idx} x={p.x} y={height - 8} textAnchor="middle" fontSize="10" fill="#64748B" fontWeight="500">
          {p.label}
        </text>
      ))}
    </svg>
  );
}

// A stat card with a glowing icon badge and trend metric
function StatCard({ icon, label, value, color, prefix, precision, trend, trendUp }: {
  icon: ReactNode
  label: string
  value: number
  color: string
  prefix?: string
  precision?: number
  trend?: string
  trendUp?: boolean
}) {
  const formatted = precision != null
    ? value.toLocaleString(undefined, { minimumFractionDigits: precision, maximumFractionDigits: precision })
    : value.toLocaleString()

  return (
    <Card style={{ borderRadius: 16, height: '100%' }} styles={{ body: { padding: 20 } }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div style={{
          width: 48,
          height: 48,
          borderRadius: 14,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 22,
          flexShrink: 0,
          color,
          background: `${color}1A`,
          boxShadow: `0 0 0 1px ${color}26, 0 8px 20px ${color}1A`,
        }}>
          {icon}
        </div>
        {trend && (
          <Tag color={trendUp ? 'success' : 'error'} style={{ borderRadius: 12, margin: 0, fontSize: 11, fontWeight: 700, padding: '2px 8px' }}>
            {trendUp ? <RiseOutlined /> : <FallOutlined />} {trend}
          </Tag>
        )}
      </div>

      <div style={{ marginTop: 14 }}>
        <Typography.Text style={{ color: tokens.color.textMuted, fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 600 }}>
          {label}
        </Typography.Text>
        <div style={{ fontSize: 28, fontWeight: 800, color: tokens.color.textPrimary, lineHeight: 1.2, marginTop: 2 }}>
          {prefix}{formatted}
        </div>
      </div>
    </Card>
  )
}

export default function Dashboard() {
  const navigate = useNavigate()
  const [stats, setStats] = useState<any>({})
  const [recentGames, setRecentGames] = useState([])
  const [reconciliationData, setReconciliationData] = useState<any>(null)
  const [chartMetric, setChartMetric] = useState<'ggr' | 'volume'>('ggr')
  const [period, setPeriod] = useState<'today' | '7d' | '30d'>('7d')
  const [refreshing, setRefreshing] = useState(false)

  const loadAllStats = () => {
    setRefreshing(true)
    Promise.all([
      adminApi.get('/dashboard/stats').then(r => setStats(r.data)).catch(() => {}),
      adminApi.get('/dashboard/recent-games').then(r => setRecentGames(r.data)).catch(() => {}),
      adminApi.get('/finance/reconciliation', { params: { days: period === 'today' ? 1 : period === '30d' ? 30 : 7 } }).then(r => setReconciliationData(r.data)).catch(() => {}),
    ]).finally(() => setRefreshing(false))
  }

  useEffect(() => {
    loadAllStats()
    const interval = setInterval(() => {
      adminApi.get('/dashboard/stats').then(r => setStats(r.data)).catch(() => {})
    }, 10000)
    return () => clearInterval(interval)
  }, [period])

  const gameColumns = [
    { title: 'Room ID', dataIndex: 'id', key: 'id', render: (id: string) => <code style={{ fontSize: 12, color: tokens.color.gold }}>{id.slice(0, 8)}</code> },
    {
      title: 'Game Type',
      dataIndex: 'game_type',
      key: 'game_type',
      render: (t: string) => (
        <Tag color="gold" style={{ borderRadius: 10, fontWeight: 600, padding: '2px 8px' }}>
          {t ? t.replace('_', ' ').toUpperCase() : 'GAME'}
        </Tag>
      ),
    },
    {
      title: 'Players',
      dataIndex: 'player_count',
      key: 'player_count',
      render: (count: number) => (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600 }}>
          <UserOutlined style={{ color: tokens.color.info }} /> {count || 1}
        </div>
      ),
    },
    {
      title: 'Pot (₹)',
      dataIndex: 'pot_amount',
      key: 'pot_amount',
      render: (v: number) => <span style={{ fontWeight: 700, color: tokens.color.emerald }}>₹{parseFloat(v as any || 0).toFixed(2)}</span>,
    },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      render: (s: string) => (
        <Badge status={s === 'active' ? 'processing' : s === 'completed' ? 'success' : 'default'} text={<span style={{ fontWeight: 600, textTransform: 'capitalize' }}>{s}</span>} />
      ),
    },
    {
      title: 'Started',
      dataIndex: 'started_at',
      key: 'started_at',
      render: (d: string) => d ? new Date(d).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '-',
    },
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* Welcome & Command Header */}
      <Card style={{ borderRadius: 20, background: 'linear-gradient(135deg, #181B24 0%, #0F1117 100%)', border: '1px solid rgba(212, 175, 55, 0.25)' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Typography.Title level={3} style={{ color: '#FFFFFF', margin: 0, fontWeight: 800 }}>
                MyOnlineJoker Command Center
              </Typography.Title>
              <Tag color="gold" style={{ borderRadius: 10, fontWeight: 700 }}>LIVE SYSTEM</Tag>
            </div>
            <Typography.Text style={{ color: tokens.color.textOnDarkMuted, fontSize: 13, marginTop: 4, display: 'block' }}>
              Real-time platform metrics, active player statistics, risk alerts, and gaming operations.
            </Typography.Text>
          </div>

          <Space size="middle">
            <Radio.Group value={period} onChange={e => setPeriod(e.target.value)} buttonStyle="solid" size="middle">
              <Radio.Button value="today">Today</Radio.Button>
              <Radio.Button value="7d">Last 7 Days</Radio.Button>
              <Radio.Button value="30d">Last 30 Days</Radio.Button>
            </Radio.Group>

            <Button
              icon={<ReloadOutlined spin={refreshing} />}
              onClick={loadAllStats}
              style={{ borderRadius: 10, fontWeight: 600 }}
            >
              Sync
            </Button>
          </Space>
        </div>
      </Card>

      {/* Primary 4 Metric Cards */}
      <Row gutter={[16, 16]}>
        <Col xs={24} sm={12} xl={6}>
          <StatCard
            label="Active Players Online"
            value={stats.active_users || 0}
            icon={<UserOutlined />}
            color={tokens.color.emerald}
            trend="+12.4%"
            trendUp={true}
          />
        </Col>
        <Col xs={24} sm={12} xl={6}>
          <StatCard
            label="Live Active Game Rooms"
            value={stats.active_rooms || 0}
            icon={<PlayCircleOutlined />}
            color={tokens.color.indigo}
            trend="Active"
            trendUp={true}
          />
        </Col>
        <Col xs={24} sm={12} xl={6}>
          <StatCard
            label="Revenue Today (GGR)"
            value={stats.revenue_today || 0}
            icon={<DollarOutlined />}
            color={tokens.color.gold}
            prefix="₹"
            precision={2}
            trend="+18.5%"
            trendUp={true}
          />
        </Col>
        <Col xs={24} sm={12} xl={6}>
          <StatCard
            label="Risk & Fraud Alerts"
            value={stats.fraud_alerts || 0}
            icon={<WarningOutlined />}
            color={stats.fraud_alerts > 0 ? tokens.color.crimson : tokens.color.emerald}
            trend={stats.fraud_alerts > 0 ? 'Requires Action' : 'Shield Normal'}
            trendUp={stats.fraud_alerts === 0}
          />
        </Col>
      </Row>

      {/* Secondary KPI Strip */}
      <Row gutter={[16, 16]}>
        <Col xs={24} sm={8} lg={8}>
          <Card style={{ borderRadius: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <Typography.Text type="secondary" style={{ fontSize: 12, fontWeight: 600, textTransform: 'uppercase' }}>
                  New Registrations
                </Typography.Text>
                <div style={{ fontSize: 24, fontWeight: 800, color: tokens.color.textPrimary, marginTop: 4 }}>
                  {stats.new_users_today || 0} <span style={{ fontSize: 12, color: tokens.color.textMuted }}>users today</span>
                </div>
              </div>
              <Button type="text" icon={<UserOutlined style={{ fontSize: 20, color: tokens.color.gold }} />} onClick={() => navigate('/admin/users')} />
            </div>
          </Card>
        </Col>

        <Col xs={24} sm={8} lg={8}>
          <Card style={{ borderRadius: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <Typography.Text type="secondary" style={{ fontSize: 12, fontWeight: 600, textTransform: 'uppercase' }}>
                  Pending Withdrawals
                </Typography.Text>
                <div style={{ fontSize: 24, fontWeight: 800, color: stats.pending_withdrawals > 0 ? tokens.color.warning : tokens.color.textPrimary, marginTop: 4 }}>
                  {stats.pending_withdrawals || 0} <span style={{ fontSize: 12, color: tokens.color.textMuted }}>requests</span>
                </div>
              </div>
              <Button type="link" size="small" onClick={() => navigate('/admin/finance')} style={{ fontWeight: 600 }}>
                Review <ArrowRightOutlined />
              </Button>
            </div>
          </Card>
        </Col>

        <Col xs={24} sm={8} lg={8}>
          <Card style={{ borderRadius: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <Typography.Text type="secondary" style={{ fontSize: 12, fontWeight: 600, textTransform: 'uppercase' }}>
                  Pending Deposits
                </Typography.Text>
                <div style={{ fontSize: 24, fontWeight: 800, color: stats.pending_deposits > 0 ? tokens.color.warning : tokens.color.textPrimary, marginTop: 4 }}>
                  {stats.pending_deposits || 0} <span style={{ fontSize: 12, color: tokens.color.textMuted }}>to approve</span>
                </div>
              </div>
              <Button type="link" size="small" onClick={() => navigate('/admin/finance')} style={{ fontWeight: 600 }}>
                Approve <ArrowRightOutlined />
              </Button>
            </div>
          </Card>
        </Col>
      </Row>

      {/* Main Analytics Chart & Quick Operations */}
      <Row gutter={[24, 24]}>
        <Col xs={24} lg={16}>
          <Card
            title={
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontWeight: 700, fontSize: 16 }}>Live Active Game Rooms</span>
                <Button type="link" size="small" onClick={() => navigate('/admin/game-rooms')} style={{ fontWeight: 600 }}>
                  View All Rooms <ArrowRightOutlined />
                </Button>
              </div>
            }
            style={{ borderRadius: 16 }}
          >
            <Table
              dataSource={recentGames}
              columns={gameColumns}
              rowKey="id"
              pagination={{ pageSize: 6 }}
              size="small"
              scroll={{ x: 'max-content' }}
            />
          </Card>
        </Col>

        <Col xs={24} lg={8}>
          <Card
            title={<span style={{ fontWeight: 700, fontSize: 16 }}>Revenue GGR Trend (₹)</span>}
            style={{ borderRadius: 16, height: '100%' }}
          >
            <div style={{ padding: '12px 0' }}>
              {reconciliationData ? (
                <SVGLineChart
                  data={reconciliationData.ggr}
                  strokeColor={tokens.color.gold}
                  fillColor="rgba(212, 175, 55, 0.08)"
                />
              ) : (
                <div style={{ height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', color: tokens.color.textMuted }}>
                  Loading trend chart...
                </div>
              )}
            </div>
          </Card>
        </Col>
      </Row>

      {/* Quick Action Shortcuts Banner */}
      <Card title={<span style={{ fontWeight: 700, fontSize: 16 }}>⚡ Quick Operations Hub</span>} style={{ borderRadius: 16 }}>
        <Row gutter={[16, 16]}>
          <Col xs={12} sm={6} md={4}>
            <Button
              block
              style={{ height: 68, borderRadius: 12, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6, fontWeight: 600 }}
              onClick={() => navigate('/admin/users')}
            >
              <UserOutlined style={{ fontSize: 20, color: tokens.color.gold }} />
              Manage Players
            </Button>
          </Col>

          <Col xs={12} sm={6} md={4}>
            <Button
              block
              style={{ height: 68, borderRadius: 12, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6, fontWeight: 600 }}
              onClick={() => navigate('/admin/finance')}
            >
              <BankOutlined style={{ fontSize: 20, color: tokens.color.emerald }} />
              Finance Log
            </Button>
          </Col>

          <Col xs={12} sm={6} md={4}>
            <Button
              block
              style={{ height: 68, borderRadius: 12, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6, fontWeight: 600 }}
              onClick={() => navigate('/admin/risk-center')}
            >
              <SafetyOutlined style={{ fontSize: 20, color: tokens.color.crimson }} />
              Risk Center
            </Button>
          </Col>

          <Col xs={12} sm={6} md={4}>
            <Button
              block
              style={{ height: 68, borderRadius: 12, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6, fontWeight: 600 }}
              onClick={() => navigate('/admin/ai-control')}
            >
              <RobotOutlined style={{ fontSize: 20, color: tokens.color.indigo }} />
              AI Control Center
            </Button>
          </Col>

          <Col xs={12} sm={6} md={4}>
            <Button
              block
              style={{ height: 68, borderRadius: 12, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6, fontWeight: 600 }}
              onClick={() => navigate('/admin/kyc')}
            >
              <CheckCircleOutlined style={{ fontSize: 20, color: tokens.color.amber }} />
              KYC Verification
            </Button>
          </Col>

          <Col xs={12} sm={6} md={4}>
            <Button
              block
              style={{ height: 68, borderRadius: 12, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6, fontWeight: 600 }}
              onClick={() => navigate('/admin/game-rooms')}
            >
              <RocketOutlined style={{ fontSize: 20, color: tokens.color.info }} />
              Game Rooms
            </Button>
          </Col>
        </Row>
      </Card>
    </div>
  )
}

