import { useEffect, useState } from 'react'
import { Row, Col, Card, Statistic, Table, Tag, Typography, Badge } from 'antd'
import { UserOutlined, DollarOutlined, PlayCircleOutlined, WarningOutlined } from '@ant-design/icons'
import { adminApi } from '../api/client'

// ---- Custom SVG Charting Component ----
function SVGLineChart({ data, width = 400, height = 180, strokeColor = '#52c41a', fillColor = 'rgba(82, 196, 26, 0.05)', valueKey = 'ggr' }: { data: any[], width?: number, height?: number, strokeColor?: string, fillColor?: string, valueKey?: string }) {
  if (!data || data.length === 0) return <div style={{ height, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>No data available</div>;

  const values = data.map(d => parseFloat(d[valueKey] || 0));
  const maxVal = Math.max(...values, 100);
  const minVal = Math.min(...values, 0);
  const range = maxVal - minVal;

  const points = data.map((d, idx) => {
    const x = (idx / (data.length - 1 || 1)) * (width - 60) + 40;
    const val = parseFloat(d[valueKey] || 0);
    const y = height - 25 - ((val - minVal) / range) * (height - 45);
    return { x, y, label: d.day ? new Date(d.day).toLocaleDateString(undefined, {month: 'short', day: 'numeric'}) : '', val };
  });

  const pathD = points.reduce((acc, p, idx) => {
    return acc + (idx === 0 ? `M ${p.x} ${p.y}` : ` L ${p.x} ${p.y}`);
  }, '');

  const areaD = pathD ? `${pathD} L ${points[points.length - 1].x} ${height - 25} L ${points[0].x} ${height - 25} Z` : '';

  return (
    <svg viewBox={`0 0 ${width} ${height}`} width="100%" height={height} style={{ overflow: 'visible' }}>
      {/* Grid lines */}
      {[0, 0.5, 1].map((ratio, idx) => {
        const y = 20 + ratio * (height - 45);
        const val = maxVal - ratio * range;
        return (
          <g key={idx}>
            <line x1="40" y1={y} x2={width - 20} y2={y} stroke="#f0f0f0" strokeDasharray="4 4" />
            <text x="35" y={y + 4} textAnchor="end" fontSize="10" fill="#999">₹{val.toFixed(0)}</text>
          </g>
        );
      })}

      {/* Area fill */}
      {areaD && <path d={areaD} fill={fillColor} />}
      {/* Line path */}
      {pathD && <path d={pathD} fill="none" stroke={strokeColor} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />}

      {/* Points and Tooltips */}
      {points.map((p, idx) => (
        <g key={idx}>
          <circle cx={p.x} cy={p.y} r="3.5" fill={strokeColor} stroke="#fff" strokeWidth="1.5" />
          <title>{`${p.label}\n₹${p.val.toFixed(2)}`}</title>
        </g>
      ))}

      {/* X Axis Labels */}
      {points.filter((_, idx) => data.length < 8 || idx % Math.ceil(data.length / 4) === 0).map((p, idx) => (
        <text key={idx} x={p.x} y={height - 5} textAnchor="middle" fontSize="10" fill="#999">
          {p.label}
        </text>
      ))}
    </svg>
  );
}

export default function Dashboard() {
  const [stats, setStats] = useState<any>({})
  const [recentGames, setRecentGames] = useState([])
  const [reconciliationData, setReconciliationData] = useState<any>(null)

  useEffect(() => {
    adminApi.get('/dashboard/stats').then(r => setStats(r.data)).catch(() => {})
    adminApi.get('/dashboard/recent-games').then(r => setRecentGames(r.data)).catch(() => {})
    adminApi.get('/finance/reconciliation', { params: { days: 7 } }).then(r => setReconciliationData(r.data)).catch(() => {})
    
    const interval = setInterval(() => {
      adminApi.get('/dashboard/stats').then(r => setStats(r.data)).catch(() => {})
    }, 10000)
    return () => clearInterval(interval)
  }, [])

  const gameColumns = [
    { title: 'Room ID', dataIndex: 'id', key: 'id', render: (id: string) => id.slice(0, 8) + '...' },
    { title: 'Game', dataIndex: 'game_type', key: 'game_type', render: (t: string) => <Tag color="blue">{t.replace('_', ' ').toUpperCase()}</Tag> },
    { title: 'Players', dataIndex: 'player_count', key: 'player_count' },
    { title: 'Pot (₹)', dataIndex: 'pot_amount', key: 'pot_amount', render: (v: number) => `₹${parseFloat(v as any).toFixed(2)}` },
    { title: 'Status', dataIndex: 'status', key: 'status', render: (s: string) => (
      <Badge status={s === 'active' ? 'processing' : s === 'completed' ? 'success' : 'default'} text={s} />
    )},
    { title: 'Started', dataIndex: 'started_at', key: 'started_at', render: (d: string) => d ? new Date(d).toLocaleTimeString() : '-' },
  ]

  return (
    <div>
      <Typography.Title level={3} style={{ marginBottom: 24 }}>Dashboard</Typography.Title>

      <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
        <Col xs={24} sm={12} xl={6}>
          <Card>
            <Statistic title="Active Users Now" value={stats.active_users || 0} prefix={<UserOutlined />} valueStyle={{ color: '#52c41a' }} />
          </Card>
        </Col>
        <Col xs={24} sm={12} xl={6}>
          <Card>
            <Statistic title="Active Game Rooms" value={stats.active_rooms || 0} prefix={<PlayCircleOutlined />} valueStyle={{ color: '#1677ff' }} />
          </Card>
        </Col>
        <Col xs={24} sm={12} xl={6}>
          <Card>
            <Statistic title="Revenue Today (₹)" value={stats.revenue_today || 0} prefix={<DollarOutlined />} precision={2} valueStyle={{ color: '#d4af37' }} />
          </Card>
        </Col>
        <Col xs={24} sm={12} xl={6}>
          <Card>
            <Statistic title="Fraud Alerts" value={stats.fraud_alerts || 0} prefix={<WarningOutlined />} valueStyle={{ color: stats.fraud_alerts > 0 ? '#ff4d4f' : '#52c41a' }} />
          </Card>
        </Col>
      </Row>

      <Row gutter={[16, 16]}>
        <Col xs={24} xl={8}>
          <Card title="New Registrations Today" size="small">
            <Statistic value={stats.new_users_today || 0} suffix="users" />
          </Card>
        </Col>
        <Col xs={24} xl={8}>
          <Card title="Pending Withdrawals" size="small">
            <Statistic value={stats.pending_withdrawals || 0} suffix="requests" valueStyle={{ color: stats.pending_withdrawals > 0 ? '#fa8c16' : undefined }} />
          </Card>
        </Col>
        <Col xs={24} xl={8}>
          <Card title="Pending Deposits (to approve)" size="small">
            <Statistic value={stats.pending_deposits || 0} suffix="requests" valueStyle={{ color: stats.pending_deposits > 0 ? '#fa8c16' : undefined }} />
          </Card>
        </Col>
      </Row>

      <Row gutter={[24, 24]} style={{ marginTop: 24 }}>
        <Col xs={24} lg={16}>
          <Card title="Recent Game Rooms" style={{ borderRadius: 12 }}>
            <Table
              dataSource={recentGames}
              columns={gameColumns}
              rowKey="id"
              pagination={{ pageSize: 10 }}
              size="small"
              scroll={{ x: 'max-content' }}
            />
          </Card>
        </Col>
        <Col xs={24} lg={8}>
          <Card title="Weekly Revenue GGR Trend (₹)" style={{ height: '100%', borderRadius: 12 }}>
            <div style={{ padding: '16px 8px' }}>
              {reconciliationData ? (
                <SVGLineChart data={reconciliationData.ggr} strokeColor="#d4af37" fillColor="rgba(212, 175, 55, 0.05)" />
              ) : (
                <div style={{ height: 180, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>Loading trend...</div>
              )}
            </div>
          </Card>
        </Col>
      </Row>
    </div>
  )
}
