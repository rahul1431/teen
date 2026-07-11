import { Table, Tag, Button, Space, Popconfirm, Badge, Typography, Tooltip } from 'antd'
import { LinkOutlined, CheckOutlined, PauseOutlined, EyeOutlined, SafeOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'

const { Text } = Typography

interface PlayerAnomaly {
  id: string
  player_id: string
  username?: string
  anomaly_type: 'win_rate_spike' | 'session_change' | 'bet_aggression' | 'churn_risk' | 'game_frequency'
  confidence: number
  timestamp: string
  status: 'new' | 'responded' | 'overridden'
  details?: any
  support_tickets?: number
}

interface AnomaliesTableProps {
  data: PlayerAnomaly[]
  loading?: boolean
  onPause: (playerId: string) => void
  onReview: (anomalyId: string) => void
  onWhitelist: (playerId: string) => void
  onViewProfile: (playerId: string) => void
  pagination?: any
  onChange?: any
}

const anomalyTypeColors: Record<string, string> = {
  win_rate_spike: 'red',
  session_change: 'orange',
  bet_aggression: 'volcano',
  churn_risk: 'purple',
  game_frequency: 'blue',
}

const statusColors: Record<string, string> = {
  new: 'blue',
  responded: 'green',
  overridden: 'default',
}

export function AnomaliesTable({
  data,
  loading = false,
  onPause,
  onReview,
  onWhitelist,
  onViewProfile,
  pagination,
  onChange,
}: AnomaliesTableProps) {
  const navigate = useNavigate()

  const handlePause = (playerId: string) => onPause(playerId)
  const handleReview = (anomalyId: string) => onReview(anomalyId)
  const handleWhitelist = (playerId: string) => onWhitelist(playerId)
  const handleViewProfile = (playerId: string) => onViewProfile(playerId)
  const handleNavigate = (playerId: string) => navigate(`/admin/users?id=${playerId}`)

  const columns = [
    {
      title: 'Player ID',
      dataIndex: 'player_id',
      key: 'player_id',
      width: 120,
      render: (id: string) => (
        <Tooltip title="Go to player profile">
          <Button
            type="link"
            size="small"
            icon={<LinkOutlined />}
            onClick={() => handleViewProfile(id)}
          >
            {id.slice(0, 8)}...
          </Button>
        </Tooltip>
      ),
    },
    {
      title: 'Username',
      dataIndex: 'username',
      key: 'username',
      width: 140,
      render: (v: string) => v || '—',
    },
    {
      title: 'Anomaly Type',
      dataIndex: 'anomaly_type',
      key: 'anomaly_type',
      width: 160,
      render: (type: string) => (
        <Tag color={anomalyTypeColors[type] || 'default'}>
          {type.replace(/_/g, ' ').toUpperCase()}
        </Tag>
      ),
    },
    {
      title: 'Confidence %',
      dataIndex: 'confidence',
      key: 'confidence',
      width: 120,
      sorter: (a: PlayerAnomaly, b: PlayerAnomaly) => a.confidence - b.confidence,
      render: (conf: number) => (
        <Tooltip title={`${conf.toFixed(2)}%`}>
          <Badge
            count={`${Math.round(conf)}%`}
            style={{
              backgroundColor: conf > 80 ? '#ff4d4f' : conf > 60 ? '#fa8c16' : '#1890ff',
              fontSize: 11,
              padding: '0 4px',
            }}
          />
        </Tooltip>
      ),
    },
    {
      title: 'Timestamp',
      dataIndex: 'timestamp',
      key: 'timestamp',
      width: 160,
      sorter: (a: PlayerAnomaly, b: PlayerAnomaly) =>
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
      render: (ts: string) => {
        const date = new Date(ts)
        return (
          <Tooltip title={date.toLocaleString()}>
            <Text type="secondary" style={{ fontSize: 11 }}>
              {date.toLocaleTimeString()}
            </Text>
          </Tooltip>
        )
      },
    },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      width: 110,
      filters: [
        { text: 'New', value: 'new' },
        { text: 'Responded', value: 'responded' },
        { text: 'Overridden', value: 'overridden' },
      ],
      onFilter: (value: any, record: PlayerAnomaly) => record.status === value,
      render: (status: string) => <Tag color={statusColors[status] || 'default'}>{status.toUpperCase()}</Tag>,
    },
    {
      title: 'Support Tickets',
      dataIndex: 'support_tickets',
      key: 'support_tickets',
      width: 130,
      render: (count: number) => (count && count > 0 ? <Badge count={count} style={{ backgroundColor: '#722ed1' }} /> : '—'),
    },
    {
      title: 'Actions',
      key: 'actions',
      width: 240,
      fixed: 'right' as const,
      render: (_text: any, record: PlayerAnomaly) => (
        <Space size="small" wrap>
          <Tooltip title="Pause this player">
            <Popconfirm
              title="Pause player?"
              description="This player will be auto-paused from games."
              okText="Pause"
              okType="danger"
              onConfirm={() => handlePause(record.player_id)}
            >
              <Button size="small" type="primary" danger icon={<PauseOutlined />}>
                Pause
              </Button>
            </Popconfirm>
          </Tooltip>

          <Tooltip title="Mark as reviewed">
            <Button
              size="small"
              type="default"
              icon={<CheckOutlined />}
              onClick={() => handleReview(record.id)}
            >
              Review
            </Button>
          </Tooltip>

          <Tooltip title="Whitelist player">
            <Popconfirm
              title="Whitelist player?"
              description="This player will be added to the whitelist."
              okText="Whitelist"
              onConfirm={() => handleWhitelist(record.player_id)}
            >
              <Button size="small" icon={<SafeOutlined />}>
                Whitelist
              </Button>
            </Popconfirm>
          </Tooltip>

          <Tooltip title="View full profile">
            <Button
              size="small"
              type="text"
              icon={<EyeOutlined />}
              onClick={() => handleNavigate(record.player_id)}
            >
              Profile
            </Button>
          </Tooltip>
        </Space>
      ),
    },
  ]

  return (
    <Table
      dataSource={data}
      columns={columns}
      rowKey="id"
      loading={loading}
      pagination={pagination}
      onChange={onChange}
      scroll={{ x: 1200 }}
      size="small"
      style={{ marginTop: 16 }}
    />
  )
}
