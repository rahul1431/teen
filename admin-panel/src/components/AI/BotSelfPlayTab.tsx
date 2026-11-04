import { useState, useEffect, useCallback } from 'react'
import {
  Card,
  Table,
  Button,
  Tag,
  Space,
  Select,
  InputNumber,
  Row,
  Col,
  Statistic,
  message,
  Typography,
  Divider,
} from 'antd'
import {
  ThunderboltOutlined,
  PlayCircleOutlined,
  ReloadOutlined,
  TrophyOutlined,
  FireOutlined,
  AppstoreOutlined,
  CheckCircleOutlined,
} from '@ant-design/icons'
import { adminApi } from '../../api/client'

interface SelfPlayRun {
  id: string
  game_type: string
  games_simulated: number
  duration_ms: number
  trigger_source: string
  results_summary: any
  calibrated_profiles: any
  applied: boolean
  created_at: string
}

export function BotSelfPlayTab() {
  const [selectedGame, setSelectedGame] = useState<'teen_patti' | 'ludo' | 'rummy'>('teen_patti')
  const [episodes, setEpisodes] = useState<number>(100)
  const [loading, setLoading] = useState<boolean>(false)
  const [running, setRunning] = useState<boolean>(false)
  const [runs, setRuns] = useState<SelfPlayRun[]>([])
  const [lastResult, setLastResult] = useState<any | null>(null)

  const fetchRuns = useCallback(async () => {
    setLoading(true)
    try {
      const res = await adminApi.get(`bots/self-play/runs?game_type=${selectedGame}`)
      if (res.data.success) {
        setRuns(res.data.data)
      }
    } catch (err: any) {
      message.error(err.response?.data?.error || 'Failed to fetch self-play runs')
    } finally {
      setLoading(false)
    }
  }, [selectedGame])

  useEffect(() => {
    fetchRuns()
  }, [fetchRuns])

  const triggerSelfPlay = async () => {
    setRunning(true)
    try {
      const res = await adminApi.post('bots/self-play/run', {
        game_type: selectedGame,
        episodes,
      })
      if (res.data.success) {
        setLastResult(res.data.data)
        message.success(`Self-Play Batch Complete: ${res.data.data.gamesSimulated} games simulated in ${res.data.data.durationMs}ms!`)
        fetchRuns()
      }
    } catch (err: any) {
      message.error(err.response?.data?.error || 'Failed to trigger self-play')
    } finally {
      setRunning(false)
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
      title: 'Episodes',
      dataIndex: 'games_simulated',
      key: 'games_simulated',
      render: (v: number) => <strong>{v.toLocaleString()}</strong>,
    },
    {
      title: 'Duration',
      dataIndex: 'duration_ms',
      key: 'duration_ms',
      render: (v: number) => `${v}ms`,
    },
    {
      title: 'Trigger Source',
      dataIndex: 'trigger_source',
      key: 'trigger_source',
      render: (v: string) => <Tag color="cyan">{v}</Tag>,
    },
    {
      title: 'Bluff / Key Metrics',
      key: 'metrics',
      render: (_: any, record: SelfPlayRun) => {
        const s = record.results_summary || {}
        if (record.game_type === 'teen_patti') {
          return (
            <span>
              Bluff: <strong>{s.bluffSuccessRate ?? 0}%</strong> ({s.bluffsSucceeded ?? 0}/{s.bluffsAttempted ?? 0}) | Avg Pot: ₹{s.avgPotPerHand ?? 0}
            </span>
          )
        }
        if (record.game_type === 'ludo') {
          return (
            <span>
              Avg Rolls: <strong>{s.avgRollsPerGame ?? 0}</strong> | Captures: {s.totalCaptures ?? 0}
            </span>
          )
        }
        return (
          <span>
            Declare Rate: <strong>{s.declareRatePct ?? 0}%</strong> | Drops: {s.totalDrops ?? 0}
          </span>
        )
      },
    },
    {
      title: 'Policy Applied',
      dataIndex: 'applied',
      key: 'applied',
      render: (v: boolean) =>
        v ? (
          <Tag color="green" icon={<CheckCircleOutlined />}>
            ACTIVE
          </Tag>
        ) : (
          <Tag color="default">ARCHIVED</Tag>
        ),
    },
    {
      title: 'Timestamp',
      dataIndex: 'created_at',
      key: 'created_at',
      render: (v: string) => new Date(v).toLocaleString(),
    },
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Simulation Control Card */}
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
                  Batch Simulation Episodes
                </span>
                <Select
                  value={episodes}
                  onChange={(v) => setEpisodes(v)}
                  style={{ width: 140 }}
                  options={[
                    { label: '50 Games', value: 50 },
                    { label: '100 Games', value: 100 },
                    { label: '250 Games', value: 250 },
                    { label: '500 Games', value: 500 },
                    { label: '1,000 Games', value: 1000 },
                  ]}
                />
              </div>
            </Space>
          </Col>

          <Col xs={24} md={12} style={{ textAlign: 'right' }}>
            <Space>
              <Button icon={<ReloadOutlined />} onClick={fetchRuns} loading={loading}>
                Refresh
              </Button>
              <Button
                type="primary"
                icon={<PlayCircleOutlined />}
                loading={running}
                onClick={triggerSelfPlay}
                style={{
                  background: 'linear-gradient(135deg, #ec4899 0%, #8b5cf6 100%)',
                  border: 'none',
                  fontWeight: 700,
                  height: 40,
                  padding: '0 24px',
                  borderRadius: 8,
                }}
              >
                RUN SELF-PLAY BATCH
              </Button>
            </Space>
          </Col>
        </Row>

        {lastResult && (
          <div
            style={{
              marginTop: 20,
              padding: 16,
              background: 'rgba(236, 72, 153, 0.1)',
              border: '1px solid rgba(236, 72, 153, 0.3)',
              borderRadius: 8,
            }}
          >
            <Typography.Text strong style={{ color: '#f472b6' }}>
              ⚡ Latest Batch Results ({selectedGame.toUpperCase()}):
            </Typography.Text>
            <Row gutter={[16, 16]} style={{ marginTop: 12 }}>
              <Col span={6}>
                <Statistic
                  title={<span style={{ color: '#94a3b8' }}>Simulated Hands</span>}
                  value={lastResult.gamesSimulated}
                  valueStyle={{ color: '#fff' }}
                />
              </Col>
              <Col span={6}>
                <Statistic
                  title={<span style={{ color: '#94a3b8' }}>Duration</span>}
                  value={`${lastResult.durationMs}ms`}
                  valueStyle={{ color: '#10b981' }}
                />
              </Col>
              {lastResult.bluffSuccessRate !== undefined && (
                <Col span={6}>
                  <Statistic
                    title={<span style={{ color: '#94a3b8' }}>Bluff Success</span>}
                    value={`${lastResult.bluffSuccessRate}%`}
                    valueStyle={{ color: '#f59e0b' }}
                  />
                </Col>
              )}
              {lastResult.avgPotPerHand !== undefined && (
                <Col span={6}>
                  <Statistic
                    title={<span style={{ color: '#94a3b8' }}>Avg Pot</span>}
                    value={`₹${lastResult.avgPotPerHand}`}
                    valueStyle={{ color: '#38bdf8' }}
                  />
                </Col>
              )}
              {lastResult.declareRatePct !== undefined && (
                <Col span={6}>
                  <Statistic
                    title={<span style={{ color: '#94a3b8' }}>Declare Rate</span>}
                    value={`${lastResult.declareRatePct}%`}
                    valueStyle={{ color: '#10b981' }}
                  />
                </Col>
              )}
            </Row>
          </div>
        )}
      </Card>

      {/* History Table */}
      <Card
        title={
          <span style={{ color: '#fff', fontWeight: 600 }}>
            <ThunderboltOutlined style={{ color: '#ec4899', marginRight: 8 }} />
            Autonomous Self-Play Training Audit Trail
          </span>
        }
        style={{
          background: '#0f172a',
          border: '1px solid rgba(255, 255, 255, 0.08)',
          borderRadius: 12,
        }}
      >
        <Table
          dataSource={runs}
          columns={columns}
          rowKey="id"
          loading={loading}
          pagination={{ pageSize: 10 }}
        />
      </Card>
    </div>
  )
}

