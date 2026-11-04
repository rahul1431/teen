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
  Statistic,
  message,
  Typography,
} from 'antd'
import {
  DeploymentUnitOutlined,
  UsergroupAddOutlined,
  ReloadOutlined,
  CheckCircleOutlined,
} from '@ant-design/icons'
import { adminApi } from '../../api/client'

interface BehavioralClone {
  id: string
  game_type: string
  tier: string
  top_percentile_cutoff: number
  players_analyzed: number
  elite_player_ids: string[]
  decisions_extracted: number
  extracted_action_distribution: any
  cloned_weights: any
  is_active: boolean
  created_at: string
}

export function BotBehavioralCloningTab() {
  const [selectedGame, setSelectedGame] = useState<'teen_patti' | 'ludo' | 'rummy'>('teen_patti')
  const [topPercentile, setTopPercentile] = useState<number>(5)
  const [loading, setLoading] = useState<boolean>(false)
  const [cloning, setCloning] = useState<boolean>(false)
  const [clones, setClones] = useState<BehavioralClone[]>([])
  const [lastCloned, setLastCloned] = useState<any | null>(null)

  const fetchClones = useCallback(async () => {
    setLoading(true)
    try {
      const res = await adminApi.get(`bots/behavioral-clones?game_type=${selectedGame}`)
      if (res.data.success) {
        setClones(res.data.data)
      }
    } catch (err: any) {
      message.error(err.response?.data?.error || 'Failed to fetch behavioral clones')
    } finally {
      setLoading(false)
    }
  }, [selectedGame])

  useEffect(() => {
    fetchClones()
  }, [fetchClones])

  const triggerCloning = async () => {
    setCloning(true)
    try {
      const res = await adminApi.post('bots/clone-elite-humans', {
        game_type: selectedGame,
        topPercentile,
      })
      if (res.data.success) {
        setLastCloned(res.data.data)
        message.success(`Behavioral Cloning Complete: ${res.data.data.playersAnalyzed} players analyzed, ${res.data.data.decisionsExtracted} decisions cloned!`)
        fetchClones()
      }
    } catch (err: any) {
      message.error(err.response?.data?.error || 'Failed to clone elite players')
    } finally {
      setCloning(false)
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
      title: 'Tier',
      dataIndex: 'tier',
      key: 'tier',
      render: (v: string) => <Tag color={v === 'hard' ? 'red' : 'green'}>{v.toUpperCase()}</Tag>,
    },
    {
      title: 'Elite Cutoff',
      dataIndex: 'top_percentile_cutoff',
      key: 'top_percentile_cutoff',
      render: (v: number) => `Top ${v}% Winners`,
    },
    {
      title: 'Players Analyzed',
      dataIndex: 'players_analyzed',
      key: 'players_analyzed',
      render: (v: number) => <strong>{v} humans</strong>,
    },
    {
      title: 'Decisions Mined',
      dataIndex: 'decisions_extracted',
      key: 'decisions_extracted',
      render: (v: number) => v.toLocaleString(),
    },
    {
      title: 'Cloned Weights / Profile',
      key: 'cloned_weights',
      render: (_: any, record: BehavioralClone) => {
        const w = record.cloned_weights || {}
        if (record.game_type === 'teen_patti') {
          return (
            <span style={{ fontSize: 12 }}>
              Fold: {((w.fold_probability ?? 0) * 100).toFixed(1)}% | Call: {((w.call_probability ?? 0) * 100).toFixed(1)}% | Raise: {((w.raise_probability ?? 0) * 100).toFixed(1)}%
            </span>
          )
        }
        if (record.game_type === 'ludo') {
          return (
            <span style={{ fontSize: 12 }}>
              Capture: {((w.capture_probability ?? 0) * 100).toFixed(1)}% | Safe Play: {((w.safe_play_probability ?? 0) * 100).toFixed(1)}%
            </span>
          )
        }
        return (
          <span style={{ fontSize: 12 }}>
            Drop: {((w.drop_probability ?? 0) * 100).toFixed(1)}% | Open Draw: {((w.open_draw_probability ?? 0) * 100).toFixed(1)}%
          </span>
        )
      },
    },
    {
      title: 'Status',
      dataIndex: 'is_active',
      key: 'is_active',
      render: (v: boolean) =>
        v ? (
          <Tag color="green" icon={<CheckCircleOutlined />}>
            ACTIVE
          </Tag>
        ) : (
          <Tag color="default">STALE</Tag>
        ),
    },
    {
      title: 'Trained At',
      dataIndex: 'created_at',
      key: 'created_at',
      render: (v: string) => new Date(v).toLocaleString(),
    },
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Control Card */}
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
            <Space size={16} wrap>
              <div>
                <span style={{ fontSize: 12, color: '#94a3b8', display: 'block', marginBottom: 4 }}>
                  Select Game Engine
                </span>
                <Select
                  value={selectedGame}
                  onChange={(v) => setSelectedGame(v)}
                  style={{ width: 180 }}
                  options={[
                    { label: '🃏 Teen Patti', value: 'teen_patti' },
                    { label: '🎲 Ludo', value: 'ludo' },
                    { label: '🎴 Indian Rummy', value: 'rummy' },
                  ]}
                />
              </div>

              <div>
                <span style={{ fontSize: 12, color: '#94a3b8', display: 'block', marginBottom: 4 }}>
                  Human Elite Winner Cutoff
                </span>
                <Select
                  value={topPercentile}
                  onChange={(v) => setTopPercentile(v)}
                  style={{ width: 150 }}
                  options={[
                    { label: 'Top 1% Sharks', value: 1 },
                    { label: 'Top 5% Elite', value: 5 },
                    { label: 'Top 10% Winners', value: 10 },
                  ]}
                />
              </div>
            </Space>
          </Col>

          <Col xs={24} md={12} style={{ textAlign: 'right' }}>
            <Space>
              <Button icon={<ReloadOutlined />} onClick={fetchClones} loading={loading}>
                Refresh
              </Button>
              <Button
                type="primary"
                icon={<UsergroupAddOutlined />}
                loading={cloning}
                onClick={triggerCloning}
                style={{
                  background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                  border: 'none',
                  fontWeight: 700,
                  height: 40,
                  padding: '0 24px',
                  borderRadius: 8,
                }}
              >
                CLONE TOP {topPercentile}% HUMANS
              </Button>
            </Space>
          </Col>
        </Row>

        {lastCloned && (
          <div
            style={{
              marginTop: 20,
              padding: 16,
              background: 'rgba(16, 185, 129, 0.1)',
              border: '1px solid rgba(16, 185, 129, 0.3)',
              borderRadius: 8,
            }}
          >
            <Typography.Text strong style={{ color: '#34d399' }}>
              🧬 Latest Behavioral Clone Result ({selectedGame.toUpperCase()}):
            </Typography.Text>
            <Row gutter={[16, 16]} style={{ marginTop: 12 }}>
              <Col span={6}>
                <Statistic
                  title={<span style={{ color: '#94a3b8' }}>Elite Humans Mined</span>}
                  value={lastCloned.playersAnalyzed}
                  valueStyle={{ color: '#fff' }}
                />
              </Col>
              <Col span={6}>
                <Statistic
                  title={<span style={{ color: '#94a3b8' }}>Decisions Extracted</span>}
                  value={lastCloned.decisionsExtracted}
                  valueStyle={{ color: '#10b981' }}
                />
              </Col>
              <Col span={6}>
                <Statistic
                  title={<span style={{ color: '#94a3b8' }}>Shark Priors Applied</span>}
                  value={lastCloned.fallbackUsed ? 'Fallback Shark' : 'Dirichlet Mined'}
                  valueStyle={{ color: '#f59e0b', fontSize: 16 }}
                />
              </Col>
            </Row>
          </div>
        )}
      </Card>

      {/* Audit Table */}
      <Card
        title={
          <span style={{ color: '#fff', fontWeight: 600 }}>
            <DeploymentUnitOutlined style={{ color: '#10b981', marginRight: 8 }} />
            Behavioral Clones &amp; Mined Shark Profiles
          </span>
        }
        style={{
          background: '#0f172a',
          border: '1px solid rgba(255, 255, 255, 0.08)',
          borderRadius: 12,
        }}
      >
        <Table
          dataSource={clones}
          columns={columns}
          rowKey="id"
          loading={loading}
          pagination={{ pageSize: 10 }}
        />
      </Card>
    </div>
  )
}

