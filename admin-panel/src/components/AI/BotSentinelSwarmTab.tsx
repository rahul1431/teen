import { useState, useEffect, useCallback } from 'react'
import {
  Card,
  Table,
  Button,
  Tag,
  Space,
  Select,
  Row,
  Col,
  message,
  Typography,
  Popconfirm,
  Badge,
} from 'antd'
import {
  SafetyOutlined,
  WarningOutlined,
  ReloadOutlined,
  StopOutlined,
  CheckCircleOutlined,
} from '@ant-design/icons'
import { adminApi } from '../../api/client'

interface CollusionAlert {
  id: string
  game_type: string
  room_id: string | null
  player_a_id: string
  player_b_id: string
  player_a_username: string | null
  player_a_phone: string | null
  player_b_username: string | null
  player_b_phone: string | null
  collusion_score: number
  shared_hands_count: number
  passive_checkdown_rate: number
  whipsaw_count: number
  evidence: any
  status: string
  created_at: string
}

export function BotSentinelSwarmTab() {
  const [selectedGame, setSelectedGame] = useState<string>('all')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [loading, setLoading] = useState<boolean>(false)
  const [alerts, setAlerts] = useState<CollusionAlert[]>([])

  const fetchAlerts = useCallback(async () => {
    setLoading(true)
    try {
      let url = 'bots/sentinel/alerts?'
      if (selectedGame !== 'all') url += `game_type=${selectedGame}&`
      if (statusFilter !== 'all') url += `status=${statusFilter}&`
      const res = await adminApi.get(url)
      if (res.data.success) {
        setAlerts(res.data.data)
      }
    } catch (err: any) {
      message.error(err.response?.data?.error || 'Failed to fetch sentinel alerts')
    } finally {
      setLoading(false)
    }
  }, [selectedGame, statusFilter])

  useEffect(() => {
    fetchAlerts()
  }, [fetchAlerts])

  const updateStatus = async (alert_id: string, status: string) => {
    try {
      const res = await adminApi.post('bots/sentinel/update-status', {
        alert_id,
        status,
      })
      if (res.data.success) {
        message.success(`Alert marked as ${status.toUpperCase()}`)
        fetchAlerts()
      }
    } catch (err: any) {
      message.error(err.response?.data?.error || 'Failed to update alert')
    }
  }

  const columns = [
    {
      title: 'Game',
      dataIndex: 'game_type',
      key: 'game_type',
      render: (v: string) => (
        <Tag color={v === 'teen_patti' ? 'orange' : v === 'ludo' ? 'magenta' : 'blue'}>
          {v.toUpperCase()}
        </Tag>
      ),
    },
    {
      title: 'Syndicate Pair (Player A vs Player B)',
      key: 'players',
      render: (_: any, r: CollusionAlert) => (
        <div>
          <div>
            <strong>A:</strong> {r.player_a_username || r.player_a_phone || r.player_a_id.substring(0, 8)}
          </div>
          <div>
            <strong>B:</strong> {r.player_b_username || r.player_b_phone || r.player_b_id.substring(0, 8)}
          </div>
        </div>
      ),
    },
    {
      title: 'Collusion Score',
      dataIndex: 'collusion_score',
      key: 'collusion_score',
      render: (v: number) => {
        const val = Number(v)
        let color = '#10b981'
        if (val >= 0.75) color = '#ef4444'
        else if (val >= 0.6) color = '#f59e0b'
        return (
          <Tag color={color} style={{ fontWeight: 800, fontSize: 13, padding: '2px 8px' }}>
            {(val * 100).toFixed(1)}% RISK
          </Tag>
        )
      },
    },
    {
      title: 'Shared Hands',
      dataIndex: 'shared_hands_count',
      key: 'shared_hands_count',
      render: (v: number) => <span>{v} hands</span>,
    },
    {
      title: 'Soft Checkdown %',
      dataIndex: 'passive_checkdown_rate',
      key: 'passive_checkdown_rate',
      render: (v: number) => <span>{v}%</span>,
    },
    {
      title: 'Whipsaws',
      dataIndex: 'whipsaw_count',
      key: 'whipsaw_count',
      render: (v: number) => (
        <Badge
          count={v}
          style={{ backgroundColor: v > 0 ? '#ef4444' : '#64748b' }}
        />
      ),
    },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      render: (v: string) => {
        let color = 'gold'
        if (v === 'quarantined') color = 'magenta'
        if (v === 'banned') color = 'red'
        if (v === 'dismissed') color = 'default'
        return <Tag color={color}>{v.toUpperCase()}</Tag>
      },
    },
    {
      title: 'Actions',
      key: 'actions',
      render: (_: any, r: CollusionAlert) => (
        <Space size="small">
          {r.status !== 'quarantined' && (
            <Popconfirm
              title="Quarantine Matchmaking?"
              description="Players will never be placed on the same table again."
              onConfirm={() => updateStatus(r.id, 'quarantined')}
            >
              <Button size="small" type="primary" danger icon={<StopOutlined />}>
                Quarantine
              </Button>
            </Popconfirm>
          )}

          {r.status !== 'dismissed' && (
            <Button size="small" onClick={() => updateStatus(r.id, 'dismissed')}>
              Dismiss
            </Button>
          )}
        </Space>
      ),
    },
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <Card
        style={{
          background: '#0f172a',
          border: '1px solid rgba(255, 255, 255, 0.08)',
          borderRadius: 12,
          color: '#fff',
        }}
      >
        <Row justify="space-between" align="middle" gutter={[16, 16]}>
          <Col xs={24} md={14}>
            <Space size={16} wrap>
              <div>
                <span style={{ fontSize: 12, color: '#94a3b8', display: 'block', marginBottom: 4 }}>
                  Filter by Game
                </span>
                <Select
                  value={selectedGame}
                  onChange={(v) => setSelectedGame(v)}
                  style={{ width: 160 }}
                  options={[
                    { label: 'All Games', value: 'all' },
                    { label: '🃏 Teen Patti', value: 'teen_patti' },
                    { label: '🎲 Ludo', value: 'ludo' },
                    { label: '🎴 Rummy', value: 'rummy' },
                  ]}
                />
              </div>

              <div>
                <span style={{ fontSize: 12, color: '#94a3b8', display: 'block', marginBottom: 4 }}>
                  Filter Status
                </span>
                <Select
                  value={statusFilter}
                  onChange={(v) => setStatusFilter(v)}
                  style={{ width: 140 }}
                  options={[
                    { label: 'All Alerts', value: 'all' },
                    { label: 'Flagged', value: 'flagged' },
                    { label: 'Quarantined', value: 'quarantined' },
                    { label: 'Dismissed', value: 'dismissed' },
                  ]}
                />
              </div>
            </Space>
          </Col>

          <Col xs={24} md={10} style={{ textAlign: 'right' }}>
            <Button icon={<ReloadOutlined />} onClick={fetchAlerts} loading={loading}>
              Refresh Alerts
            </Button>
          </Col>
        </Row>
      </Card>

      <Card
        title={
          <span style={{ color: '#fff', fontWeight: 600 }}>
            <SafetyOutlined style={{ color: '#ef4444', marginRight: 8 }} />
            Anti-Collusion Sentinel Swarm (Soft-Play &amp; Whipsaw Detection)
          </span>
        }
        style={{
          background: '#0f172a',
          border: '1px solid rgba(255, 255, 255, 0.08)',
          borderRadius: 12,
        }}
      >
        <Table
          dataSource={alerts}
          columns={columns}
          rowKey="id"
          loading={loading}
          pagination={{ pageSize: 10 }}
        />
      </Card>
    </div>
  )
}

