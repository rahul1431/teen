import { useEffect, useState } from 'react'
import { Row, Col, Card, Statistic, Table, Tag, Typography, Badge } from 'antd'
import { UserOutlined, DollarOutlined, PlayCircleOutlined, WarningOutlined } from '@ant-design/icons'
import { adminApi } from '../api/client'

export default function Dashboard() {
  const [stats, setStats] = useState<any>({})
  const [recentGames, setRecentGames] = useState([])

  useEffect(() => {
    adminApi.get('/dashboard/stats').then(r => setStats(r.data)).catch(() => {})
    adminApi.get('/dashboard/recent-games').then(r => setRecentGames(r.data)).catch(() => {})
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

      <Card title="Recent Game Rooms" style={{ marginTop: 24 }}>
        <Table
          dataSource={recentGames}
          columns={gameColumns}
          rowKey="id"
          pagination={{ pageSize: 10 }}
          size="small"
        />
      </Card>
    </div>
  )
}
