import { useState, useEffect, useCallback } from 'react'
import { Table, Tag, Card, Row, Col, Statistic, Button, Tooltip, Typography, message, Alert, Space } from 'antd'
import { ReloadOutlined, SafetyOutlined, ThunderboltOutlined, CheckCircleOutlined, ClockCircleOutlined } from '@ant-design/icons'
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

interface ActiveRoom {
  id: string
  game_type: string
  status: string
  max_players: number
  current_players: number
  created_at: string
  age_seconds: number
  player_count: number
}

export function WatchdogTab() {
  const [events, setEvents] = useState<WatchdogEvent[]>([])
  const [stats, setStats] = useState<WatchdogStats | null>(null)
  const [activeRooms, setActiveRooms] = useState<ActiveRoom[]>([])
  const [loading, setLoading] = useState(false)
  const [sweeping, setSweeping] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [eventsRes, roomsRes] = await Promise.allSettled([
        adminApi.get('/watchdog/events'),
        adminApi.get('/watchdog/active-rooms'),
      ])
      if (eventsRes.status === 'fulfilled') {
        setEvents(eventsRes.value.data?.events ?? [])
        setStats(eventsRes.value.data?.stats ?? null)
      }
      if (roomsRes.status === 'fulfilled') {
        setActiveRooms(roomsRes.value.data?.rooms ?? [])
      }
    } catch { /* keep last data on transient errors */ }
    finally { setLoading(false) }
  }, [])

  const triggerSweep = async () => {
    setSweeping(true)
    try {
      const res = await adminApi.post('/watchdog/sweep')
      if (res.data?.success) {
        message.success(res.data.message || 'Watchdog sweep executed successfully')
        load()
      } else {
        message.warning(res.data?.error || 'Sweep finished with warnings')
      }
    } catch (err: any) {
      message.error(err.response?.data?.error || 'Failed to trigger watchdog sweep')
    } finally {
      setSweeping(false)
    }
  }

  useEffect(() => {
    load()
    const t = setInterval(load, 30_000)
    window.addEventListener('aiDashboardRefresh', load)
    return () => {
      clearInterval(t)
      window.removeEventListener('aiDashboardRefresh', load)
    }
  }, [load])

  const eventColumns = [
    {
      title: 'Time',
      dataIndex: 'created_at',
      width: 170,
      render: (v: string) => new Date(v).toLocaleString(),
    },
    {
      title: 'Game',
      dataIndex: 'game_type',
      width: 120,
      render: (g: string) => <Tag color="blue">{g.replace('_', ' ').toUpperCase()}</Tag>,
    },
    {
      title: 'Room ID',
      dataIndex: 'room_id',
      width: 130,
      render: (id: string) => <Text code>{id ? id.slice(0, 8) : '—'}</Text>,
    },
    {
      title: 'Action',
      dataIndex: 'action',
      width: 140,
      render: (action: string) =>
        action === 'reconciled_stranded_consume'
          ? <Tag color="orange">RECONCILED</Tag>
          : <Tag color="purple">REAPED</Tag>,
    },
    {
      title: 'Details / Refunds',
      dataIndex: 'refunds',
      render: (refunds: WatchdogRefund[], row: WatchdogEvent) => {
        const isReconcile = row.action === 'reconciled_stranded_consume'
        const list = Array.isArray(refunds) ? refunds : []
        return list.length === 0 ? (
          <Text type="secondary">{isReconcile ? 'nothing stranded' : 'nothing to refund'}</Text>
        ) : (
          list.map(r => (
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
          ₹{parseFloat(v || '0').toFixed(2)}
        </Text>
      ),
    },
  ]

  const roomColumns = [
    {
      title: 'Room ID',
      dataIndex: 'id',
      width: 130,
      render: (id: string) => <Text code>{id ? id.slice(0, 8) : '—'}</Text>,
    },
    {
      title: 'Game',
      dataIndex: 'game_type',
      width: 130,
      render: (g: string) => <Tag color="cyan">{g ? g.replace('_', ' ').toUpperCase() : 'GAME'}</Tag>,
    },
    {
      title: 'Status',
      dataIndex: 'status',
      width: 100,
      render: (s: string) => <Tag color={s === 'active' ? 'green' : 'gold'}>{s.toUpperCase()}</Tag>,
    },
    {
      title: 'Players',
      dataIndex: 'player_count',
      width: 100,
      render: (v: number, r: ActiveRoom) => `${r.current_players || v || 0} / ${r.max_players || 4}`,
    },
    {
      title: 'Age',
      dataIndex: 'age_seconds',
      width: 120,
      render: (s: number) => {
        const mins = Math.floor((s || 0) / 60)
        return `${mins}m ${(s || 0) % 60}s`
      },
    },
    {
      title: 'Watchdog State',
      dataIndex: 'age_seconds',
      width: 150,
      render: (s: number) => {
        const mins = Math.floor((s || 0) / 60)
        if (mins >= 15) return <Tag color="error">Idle ({mins}m) - Due for Reap</Tag>
        if (mins >= 10) return <Tag color="warning">Aging ({mins}m)</Tag>
        return <Tag color="success"><CheckCircleOutlined /> Active ({mins}m)</Tag>
      },
    },
  ]

  return (
    <div>
      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col span={5}>
          <Card size="small">
            <Statistic title="Active Rooms Now" value={stats?.active_rooms ?? activeRooms.length}
              prefix={<SafetyOutlined />} valueStyle={{ color: '#1890ff' }} />
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

      <Alert
        message="Watchdog Self-Healing Daemon Active"
        description={
          <div>
            Daemon automatically monitors live rooms across all games. Idle rooms older than 15 minutes with no player actions are automatically reaped and player entry fees are safely unlocked back to their wallets. Completed games with uncollected settlements are auto-reconciled every 5 minutes.
          </div>
        }
        type="info"
        showIcon
        icon={<SafetyOutlined />}
        action={
          <Space>
            <Button
              type="primary"
              icon={<ThunderboltOutlined />}
              onClick={triggerSweep}
              loading={sweeping}
              style={{ background: '#722ed1', borderColor: '#722ed1' }}
            >
              Trigger Manual Sweep Now
            </Button>
            <Button icon={<ReloadOutlined />} onClick={load} loading={loading}>
              Refresh
            </Button>
          </Space>
        }
        style={{ marginBottom: 16 }}
      />

      <Card
        size="small"
        title={<span><ClockCircleOutlined /> Currently Monitored Active Game Rooms ({activeRooms.length})</span>}
        style={{ marginBottom: 16 }}
      >
        <Table<ActiveRoom>
          dataSource={activeRooms}
          columns={roomColumns}
          rowKey="id"
          size="small"
          loading={loading}
          pagination={{ pageSize: 5 }}
          locale={{ emptyText: 'No active game rooms running right now' }}
        />
      </Card>

      <Card
        size="small"
        title="Watchdog Audit Log — Idle rooms reaped & completed rooms reconciled"
      >
        <Table<WatchdogEvent>
          dataSource={events}
          columns={eventColumns}
          rowKey="id"
          size="small"
          loading={loading}
          pagination={{ pageSize: 10 }}
          locale={{ emptyText: 'No games reaped yet — games are running and finishing cleanly' }}
        />
      </Card>
    </div>
  )
}
