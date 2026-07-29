import { useState, useEffect, useCallback } from 'react'
import { Table, Tag, Card, Row, Col, Statistic, Button, Tooltip, Typography } from 'antd'
import { ReloadOutlined, SafetyOutlined } from '@ant-design/icons'
import { adminApi } from '../../api/client'

const { Text } = Typography

interface WatchdogRefund {
  user_id: string
  username: string
  is_bot: boolean
  amount: number
}

interface WatchdogEvent {
  id: string
  room_id: string
  game_type: string
  action: string
  refunds: WatchdogRefund[]
  total_refunded: string
  created_at: string
}

interface WatchdogStats {
  total_reaped: number
  total_refunded: string
  reaped_24h: number
  refunded_24h: string
  active_rooms: number
}

// Game Watchdog: the gateway sweeps every 5 min and reaps rooms idle 15+ min,
// refunding unconsumed entry fees. This tab shows what it did and when.
export function WatchdogTab() {
  const [events, setEvents] = useState<WatchdogEvent[]>([])
  const [stats, setStats] = useState<WatchdogStats | null>(null)
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await adminApi.get('/watchdog/events')
      setEvents(res.data.events)
      setStats(res.data.stats)
    } catch { /* keep last data on transient errors */ }
    finally { setLoading(false) }
  }, [])

  useEffect(() => {
    load()
    const t = setInterval(load, 60_000)
    window.addEventListener('aiDashboardRefresh', load)
    return () => {
      clearInterval(t)
      window.removeEventListener('aiDashboardRefresh', load)
    }
  }, [load])

  const columns = [
    {
      title: 'Time',
      dataIndex: 'created_at',
      width: 170,
      render: (v: string) => new Date(v).toLocaleString(),
    },
    {
      title: 'Game',
      dataIndex: 'game_type',
      width: 110,
      render: (g: string) => <Tag color="blue">{g.replace('_', ' ')}</Tag>,
    },
    {
      title: 'Room',
      dataIndex: 'room_id',
      width: 120,
      render: (id: string) => <Text code>{id.slice(0, 8)}</Text>,
    },
    {
      title: 'Action',
      dataIndex: 'action',
      width: 130,
      render: (action: string) =>
        action === 'reconciled_stranded_consume'
          ? <Tag color="orange">RECONCILED</Tag>
          : <Tag color="purple">REAPED</Tag>,
    },
    {
      title: 'Details',
      dataIndex: 'refunds',
      render: (refunds: WatchdogRefund[], row: WatchdogEvent) => {
        const isReconcile = row.action === 'reconciled_stranded_consume'
        return refunds.length === 0 ? (
          <Text type="secondary">{isReconcile ? 'nothing stranded' : 'nothing to refund'}</Text>
        ) : (
          refunds.map(r => (
            <Tooltip key={r.user_id} title={r.user_id}>
              <Tag color={r.is_bot ? 'default' : (isReconcile ? 'orange' : 'green')}>
                {r.username}{r.is_bot ? ' 🤖' : ''} ₹{r.amount}
              </Tag>
            </Tooltip>
          ))
        )
      },
    },
    {
      title: 'Total Amount',
      dataIndex: 'total_refunded',
      width: 130,
      render: (v: string, row: WatchdogEvent) => (
        <Text strong style={{ color: '#d4af37' }}>
          {row.action === 'reconciled_stranded_consume' ? 'collected ' : 'refunded '}
          ₹{parseFloat(v).toFixed(2)}
        </Text>
      ),
    },
  ]

  return (
    <div>
      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={5}>
          <Card size="small">
            <Statistic title="Active Rooms Now" value={stats?.active_rooms ?? 0}
              prefix={<SafetyOutlined />} />
          </Card>
        </Col>
        <Col span={5}>
          <Card size="small">
            <Statistic title="Reaped (24h)" value={stats?.reaped_24h ?? 0} />
          </Card>
        </Col>
        <Col span={5}>
          <Card size="small">
            <Statistic title="Refunded (24h)" value={parseFloat(stats?.refunded_24h ?? '0')}
              precision={2} prefix="₹" />
          </Card>
        </Col>
        <Col span={5}>
          <Card size="small">
            <Statistic title="Reaped (All Time)" value={stats?.total_reaped ?? 0} />
          </Card>
        </Col>
        <Col span={4}>
          <Card size="small">
            <Statistic title="Refunded (Total)" value={parseFloat(stats?.total_refunded ?? '0')}
              precision={2} prefix="₹" />
          </Card>
        </Col>
      </Row>

      <Card
        size="small"
        title="Watchdog Events — idle rooms reaped (refunded & cancelled) and completed-room stranded locks reconciled (collected), both every 5 min"
        extra={<Button size="small" icon={<ReloadOutlined />} onClick={load} loading={loading} />}
      >
        <Table
          dataSource={events}
          columns={columns}
          rowKey="id"
          size="small"
          loading={loading}
          pagination={{ pageSize: 15 }}
          locale={{ emptyText: 'No games reaped yet — everything is finishing cleanly 🎉' }}
        />
      </Card>
    </div>
  )
}
