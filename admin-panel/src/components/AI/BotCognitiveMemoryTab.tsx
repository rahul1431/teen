import { useState, useEffect, useCallback } from 'react'
import {
  Card,
  Table,
  Button,
  Tag,
  Space,
  Input,
  Row,
  Col,
  message,
  Typography,
  Tooltip,
} from 'antd'
import {
  SearchOutlined,
  ReloadOutlined,
  FireOutlined,
  EyeOutlined,
  SmileOutlined,
  FrownOutlined,
} from '@ant-design/icons'
import { adminApi } from '../../api/client'

interface CognitiveMemory {
  id: string
  user_id: string
  username: string | null
  phone_number: string | null
  games_analyzed: number
  vpip_rate: number
  fold_to_raise_ratio: number
  bluff_call_tendency: number
  tilt_score: number
  consecutive_losses: number
  biggest_loss_recent: number
  rummy_discard_preference: any
  teen_patti_blind_ratio: number
  ludo_aggression_factor: number
  last_game_type: string | null
  last_action_at: string
}

export function BotCognitiveMemoryTab() {
  const [search, setSearch] = useState<string>('')
  const [loading, setLoading] = useState<boolean>(false)
  const [memories, setMemories] = useState<CognitiveMemory[]>([])

  const fetchMemories = useCallback(async () => {
    setLoading(true)
    try {
      let url = 'bots/cognitive-memories?'
      if (search.trim()) url += `search=${encodeURIComponent(search.trim())}&`
      const res = await adminApi.get(url)
      if (res.data.success) {
        setMemories(res.data.data)
      }
    } catch (err: any) {
      message.error(err.response?.data?.error || 'Failed to fetch cognitive memories')
    } finally {
      setLoading(false)
    }
  }, [search])

  useEffect(() => {
    fetchMemories()
  }, [fetchMemories])

  const columns = [
    {
      title: 'Human Player',
      key: 'player',
      render: (_: any, r: CognitiveMemory) => (
        <div>
          <strong style={{ color: '#38bdf8' }}>{r.username || r.phone_number || 'Anonymous'}</strong>
          <div style={{ fontSize: 11, color: '#64748b' }}>ID: {r.user_id.substring(0, 8)}...</div>
        </div>
      ),
    },
    {
      title: 'Games Observed',
      dataIndex: 'games_analyzed',
      key: 'games_analyzed',
      render: (v: number) => <span>{v} hands</span>,
    },
    {
      title: 'VPIP %',
      dataIndex: 'vpip_rate',
      key: 'vpip_rate',
      render: (v: number) => `${v}%`,
    },
    {
      title: 'Fold to Raise %',
      dataIndex: 'fold_to_raise_ratio',
      key: 'fold_to_raise_ratio',
      render: (v: number) => `${v}%`,
    },
    {
      title: 'Bluff Call %',
      dataIndex: 'bluff_call_tendency',
      key: 'bluff_call_tendency',
      render: (v: number) => `${v}%`,
    },
    {
      title: 'Tilt State',
      dataIndex: 'tilt_score',
      key: 'tilt_score',
      render: (v: number, r: CognitiveMemory) => {
        const val = Number(v)
        const isTilted = val > 1.6 || r.consecutive_losses >= 3
        return (
          <Tooltip title={isTilted ? 'Player is tilted or losing. Bots soften aggression to prevent churn.' : 'Calm, baseline state.'}>
            <Tag color={isTilted ? 'red' : 'green'} icon={isTilted ? <FrownOutlined /> : <SmileOutlined />}>
              {isTilted ? `TILTED (${val}x)` : `CALM (${val}x)`}
            </Tag>
          </Tooltip>
        )
      },
    },
    {
      title: 'Loss Streak',
      dataIndex: 'consecutive_losses',
      key: 'consecutive_losses',
      render: (v: number) => (
        <span style={{ color: v >= 3 ? '#ef4444' : '#94a3b8', fontWeight: v >= 3 ? 700 : 400 }}>
          {v} in a row
        </span>
      ),
    },
    {
      title: 'Bot Counter-Strategy',
      key: 'strategy',
      render: (_: any, r: CognitiveMemory) => {
        const val = Number(r.tilt_score)
        if (val > 1.6 || r.consecutive_losses >= 3) {
          return (
            <Tag color="cyan">
              🛡️ Retention Softening (Pacing)
            </Tag>
          )
        }
        if (Number(r.fold_to_raise_ratio) > 65) {
          return (
            <Tag color="orange">
              🔥 Exploit Over-Folding (Frequent Bluffs)
            </Tag>
          )
        }
        if (Number(r.bluff_call_tendency) > 65) {
          return (
            <Tag color="purple">
              🎯 Value-Bet Traps (Never Bluff)
            </Tag>
          )
        }
        return <Tag color="default">Standard GTO Balanced</Tag>
      },
    },
    {
      title: 'Last Observed',
      dataIndex: 'last_action_at',
      key: 'last_action_at',
      render: (v: string) => new Date(v).toLocaleString(),
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
          <Col xs={24} md={12}>
            <Input
              placeholder="Search player by username, phone number, or UUID..."
              prefix={<SearchOutlined />}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onPressEnter={fetchMemories}
              allowClear
              style={{ width: '100%', maxWidth: 420 }}
            />
          </Col>

          <Col xs={24} md={12} style={{ textAlign: 'right' }}>
            <Button icon={<ReloadOutlined />} onClick={fetchMemories} loading={loading}>
              Refresh Memories
            </Button>
          </Col>
        </Row>
      </Card>

      <Card
        title={
          <span style={{ color: '#fff', fontWeight: 600 }}>
            <EyeOutlined style={{ color: '#38bdf8', marginRight: 8 }} />
            Player Episodic Cognitive Memory &amp; Bot Counter-Strategy Profiles
          </span>
        }
        style={{
          background: '#0f172a',
          border: '1px solid rgba(255, 255, 255, 0.08)',
          borderRadius: 12,
        }}
      >
        <Table
          dataSource={memories}
          columns={columns}
          rowKey="id"
          loading={loading}
          pagination={{ pageSize: 10 }}
        />
      </Card>
    </div>
  )
}

