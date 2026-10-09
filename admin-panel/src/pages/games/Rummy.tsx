import { useEffect, useState } from 'react'
import {
  Card, Form, Switch, InputNumber, Button, Table, Tag, Space, message,
  Typography, Row, Col, Select, Tabs, Statistic, Alert, Modal, Divider,
  Radio, Popconfirm, Tooltip, Badge
} from 'antd'
import {
  ReloadOutlined, SaveOutlined, PlayCircleOutlined, EyeOutlined,
  StopOutlined, UserOutlined, RobotOutlined, DollarOutlined,
  TrophyOutlined, FireOutlined, SettingOutlined, SafetyCertificateOutlined,
  ThunderboltOutlined, ClockCircleOutlined, LineChartOutlined, ExperimentOutlined
} from '@ant-design/icons'
import { adminApi } from '../../api/client'
import { tokens } from '../../theme/tokens'

// AI, ML & Analytics Components
import BotManagementPanel from '../../components/BotManagementPanel'
import GamePnlDashboard from '../../components/GamePnlDashboard'
import { BotTrainingConfigPanel } from '../../components/BotTrainingConfigPanel'
import { BotMetricsTable } from '../../components/BotMetricsTable'
import { BotTrainingAuditTrail } from '../../components/BotTrainingAuditTrail'
import { BotTrainingTrendChart } from '../../components/BotTrainingTrendChart'
import { MLTrainingPanel } from '../../components/MLTrainingPanel'
import { BotLearningSection } from '../../components/AI/BotLearningSection'

const { Text, Title, Paragraph } = Typography

export default function Rummy() {
  const [config, setConfig] = useState<any>(null)
  const [loadingConfig, setLoadingConfig] = useState(false)
  const [savingConfig, setSavingConfig] = useState(false)

  const [rooms, setRooms] = useState<any[]>([])
  const [loadingRooms, setLoadingRooms] = useState(false)
  const [statusFilter, setStatusFilter] = useState('active')

  const [selectedRoom, setSelectedRoom] = useState<any>(null)
  const [spectateModalOpen, setSpectateModalOpen] = useState(false)

  const [form] = Form.useForm()

  const loadConfig = () => {
    setLoadingConfig(true)
    adminApi.get('/game-configs')
      .then(r => {
        const rummyConf = r.data.find((c: any) => c.game_type === 'rummy')
        setConfig(rummyConf)
        if (rummyConf) {
          const rules = typeof rummyConf.special_rules === 'string'
            ? JSON.parse(rummyConf.special_rules)
            : (rummyConf.special_rules || {})
          form.setFieldsValue({
            is_active: rummyConf.is_active,
            rake_percent: rummyConf.rake_percent,
            bot_fill_enabled: rummyConf.bot_fill_enabled,
            bot_fill_delay_seconds: rummyConf.bot_fill_delay_seconds ?? 45,
            max_bot_ratio: rummyConf.max_bot_ratio ?? 0.75,
            bot_difficulty: rummyConf.bot_difficulty || 'medium',
            first_drop_points: rules.first_drop_points ?? 20,
            middle_drop_points: rules.middle_drop_points ?? 40,
            full_count_points: rules.full_count_points ?? 80,
            turn_timer_seconds: rules.turn_timer_seconds ?? 30,
          })
        }
      })
      .finally(() => setLoadingConfig(false))
  }

  const saveConfig = async (values: any) => {
    setSavingConfig(true)
    try {
      const payload = {
        is_active: Boolean(values.is_active),
        rake_percent: Number(values.rake_percent ?? 5),
        bot_fill_enabled: Boolean(values.bot_fill_enabled),
        bot_fill_delay_seconds: Number(values.bot_fill_delay_seconds ?? 15),
        max_bot_ratio: Number(values.max_bot_ratio ?? 0.75),
        bot_difficulty: values.bot_difficulty || 'medium',
        special_rules: {
          first_drop_points: Number(values.first_drop_points ?? 20),
          middle_drop_points: Number(values.middle_drop_points ?? 40),
          full_count_points: Number(values.full_count_points ?? 80),
          turn_timer_seconds: Number(values.turn_timer_seconds ?? 30),
        }
      }
      await adminApi.patch('/game-configs/rummy', payload)
      message.success('Rummy rules and game configuration saved!')
      loadConfig()
    } catch (e: any) {
      message.error(e.response?.data?.error || 'Failed to save configuration')
    } finally {
      setSavingConfig(false)
    }
  }

  const loadRooms = () => {
    setLoadingRooms(true)
    adminApi.get('/game-rooms', { params: { status: statusFilter } })
      .then(r => setRooms((r.data || []).filter((room: any) => room.game_type === 'rummy')))
      .finally(() => setLoadingRooms(false))
  }

  const handleTerminateRoom = async (roomId: string, refund: boolean) => {
    try {
      await adminApi.post(`/game-rooms/${roomId}/terminate`, { refund })
      message.success(`Room terminated ${refund ? 'with full refunds' : 'without refunds'}`)
      loadRooms()
    } catch (e: any) {
      message.error(e.response?.data?.error || 'Failed to terminate room')
    }
  }

  useEffect(() => {
    loadConfig()
  }, [])

  useEffect(() => {
    loadRooms()
  }, [statusFilter])

  // Aggregate Metrics
  const activeRooms = rooms.filter(r => r.status === 'active')
  const totalPlayersOnline = activeRooms.reduce((sum, r) => sum + (r.real_count || 0), 0)
  const totalBotsOnline = activeRooms.reduce((sum, r) => sum + (r.bot_count || 0), 0)
  const totalPotInPlay = activeRooms.reduce((sum, r) => sum + Number(r.pot_amount || 0), 0)

  return (
    <div style={{ padding: '0 8px 32px' }}>
      {/* Header Bar */}
      <Row justify="space-between" align="middle" style={{ marginBottom: 16 }}>
        <Col>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Title level={4} style={{ margin: 0, color: '#0F172A' }}>🃏 13-Card Indian Rummy Management Hub</Title>
            {config && (
              <Tag color={config.is_active ? 'green' : 'red'} style={{ fontWeight: 700 }}>
                {config.is_active ? '● LIVE & ACTIVE' : '○ DISABLED'}
              </Tag>
            )}
          </div>
          <Text type="secondary">Control 13-card Rummy tables, house rake %, AI bots, real-time analytics, bot training, and ML canary rollouts</Text>
        </Col>
        <Col>
          <Space>
            <Button icon={<ReloadOutlined />} onClick={() => { loadConfig(); loadRooms() }}>Refresh</Button>
          </Space>
        </Col>
      </Row>

      {/* Metrics Row */}
      <Row gutter={[12, 12]} style={{ marginBottom: 20 }}>
        <Col xs={12} sm={6} md={4}>
          <Card size="small" style={{ background: '#FFFFFF', borderRadius: 14, border: '1px solid #E2E8F0' }}>
            <Statistic title="Active Tables" value={activeRooms.length} prefix={<PlayCircleOutlined style={{ color: '#2563EB' }} />} />
          </Card>
        </Col>
        <Col xs={12} sm={6} md={4}>
          <Card size="small" style={{ background: '#FFFFFF', borderRadius: 14, border: '1px solid #E2E8F0' }}>
            <Statistic title="Real Players" value={totalPlayersOnline} prefix={<UserOutlined style={{ color: '#059669' }} />} />
          </Card>
        </Col>
        <Col xs={12} sm={6} md={4}>
          <Card size="small" style={{ background: '#FFFFFF', borderRadius: 14, border: '1px solid #E2E8F0' }}>
            <Statistic title="Active AI Bots" value={totalBotsOnline} prefix={<RobotOutlined style={{ color: '#7C3AED' }} />} />
          </Card>
        </Col>
        <Col xs={12} sm={6} md={4}>
          <Card size="small" style={{ background: '#FFFFFF', borderRadius: 14, border: '1px solid #E2E8F0' }}>
            <Statistic title="Live Pot in Play" value={totalPotInPlay} precision={2} prefix="₹ " valueStyle={{ color: '#D97706', fontWeight: 700 }} />
          </Card>
        </Col>
        <Col xs={12} sm={6} md={4}>
          <Card size="small" style={{ background: '#FFFFFF', borderRadius: 14, border: '1px solid #E2E8F0' }}>
            <Statistic title="House Rake Rate" value={config?.rake_percent ?? 5} suffix="%" valueStyle={{ color: '#059669', fontWeight: 700 }} />
          </Card>
        </Col>
        <Col xs={12} sm={6} md={4}>
          <Card size="small" style={{ background: '#FFFFFF', borderRadius: 14, border: '1px solid #E2E8F0' }}>
            <Statistic title="Turn Timeout" value={30} suffix="s" prefix={<ClockCircleOutlined style={{ color: '#0891B2' }} />} />
          </Card>
        </Col>
      </Row>

      {/* Main Suite Tabs (Tables, Bots, Analytics, Bot Training, ML Training) */}
      <Card bordered={false} style={{ background: '#FFFFFF', borderRadius: 18, border: '1px solid #E2E8F0' }}>
        <Tabs items={[
          {
            key: 'tables',
            label: <span><PlayCircleOutlined /> Live Tables ({rooms.length})</span>,
            children: (
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
                  <Space>
                    <Select value={statusFilter} onChange={setStatusFilter} style={{ width: 150 }}>
                      <Select.Option value="active">Active Tables</Select.Option>
                      <Select.Option value="waiting">Waiting Tables</Select.Option>
                      <Select.Option value="completed">Completed History</Select.Option>
                    </Select>
                    <Button icon={<ReloadOutlined />} onClick={loadRooms} loading={loadingRooms}>Reload Tables</Button>
                  </Space>
                </div>

                <Table
                  rowKey="id"
                  dataSource={rooms}
                  loading={loadingRooms}
                  pagination={{ pageSize: 10 }}
                  scroll={{ x: 'max-content' }}
                  size="small"
                  columns={[
                    {
                      title: 'Table ID',
                      dataIndex: 'id',
                      render: (id: string) => <Text strong style={{ color: '#0F172A' }}>{id.slice(0, 10)}...</Text>
                    },
                    {
                      title: 'Stake Fee (₹)',
                      dataIndex: 'entry_fee',
                      render: (v: any) => <Text strong style={{ color: '#D97706' }}>₹ {Number(v || 0).toFixed(2)}</Text>
                    },
                    {
                      title: 'Current Pot (₹)',
                      dataIndex: 'pot_amount',
                      render: (v: any) => <Text strong style={{ color: '#059669' }}>₹ {Number(v || 0).toFixed(2)}</Text>
                    },
                    {
                      title: 'Players (Real / Bot)',
                      key: 'players',
                      render: (_: any, r: any) => (
                        <Space>
                          <Tag color="green"><UserOutlined /> {r.real_count || 0}</Tag>
                          <Tag color="purple"><RobotOutlined /> {r.bot_count || 0}</Tag>
                          <Text type="secondary">({r.player_count || 0}/4 seated)</Text>
                        </Space>
                      )
                    },
                    {
                      title: 'Status',
                      dataIndex: 'status',
                      render: (s: string) => (
                        <Tag color={s === 'active' ? 'blue' : s === 'completed' ? 'green' : 'orange'}>
                          {s?.toUpperCase()}
                        </Tag>
                      )
                    },
                    {
                      title: 'Started At',
                      dataIndex: 'started_at',
                      render: (d: string) => d ? new Date(d).toLocaleTimeString() : 'Waiting'
                    },
                    {
                      title: 'Actions',
                      render: (_: any, r: any) => (
                        <Space>
                          <Button
                            size="small"
                            icon={<EyeOutlined />}
                            onClick={() => { setSelectedRoom(r); setSpectateModalOpen(true) }}
                          >
                            Inspect
                          </Button>
                          {r.status === 'active' && (
                            <Popconfirm
                              title="Terminate Table?"
                              description="Terminate this game immediately and refund active player stakes."
                              onConfirm={() => handleTerminateRoom(r.id, true)}
                            >
                              <Button size="small" danger icon={<StopOutlined />}>
                                Terminate & Refund
                              </Button>
                            </Popconfirm>
                          )}
                        </Space>
                      )
                    }
                  ]}
                />
              </div>
            )
          },
          {
            key: 'rules',
            label: <span><SettingOutlined /> Game Rules & Economics</span>,
            children: (
              <div style={{ maxWidth: 760 }}>
                <Form form={form} layout="vertical" onFinish={saveConfig}>
                  <Card title="⚙️ Core Game Controls" size="small" style={{ marginBottom: 16, background: '#F8FAFC', border: '1px solid #E2E8F0' }}>
                    <Row gutter={16}>
                      <Col span={12}>
                        <Form.Item name="is_active" label="Game Active on App" valuePropName="checked">
                          <Switch checkedChildren="LIVE" unCheckedChildren="DISABLED" />
                        </Form.Item>
                      </Col>
                      <Col span={12}>
                        <Form.Item name="rake_percent" label="House Commission Rake (%)" rules={[{ required: true }]}>
                          <InputNumber min={0} max={25} step={0.5} suffix="%" style={{ width: '100%' }} />
                        </Form.Item>
                      </Col>
                    </Row>
                    <Row gutter={16}>
                      <Col span={12}>
                        <Form.Item name="turn_timer_seconds" label="Turn Action Timer (seconds)" rules={[{ required: true }]}>
                          <InputNumber min={10} max={90} suffix="seconds" style={{ width: '100%' }} />
                        </Form.Item>
                      </Col>
                    </Row>
                  </Card>

                  <Card title="🃏 Drop Penalty Points Rules" size="small" style={{ marginBottom: 16, background: '#F8FAFC', border: '1px solid #E2E8F0' }}>
                    <Row gutter={16}>
                      <Col span={8}>
                        <Form.Item name="first_drop_points" label="First Drop Penalty">
                          <InputNumber min={10} max={50} suffix="pts" style={{ width: '100%' }} />
                        </Form.Item>
                      </Col>
                      <Col span={8}>
                        <Form.Item name="middle_drop_points" label="Middle Drop Penalty">
                          <InputNumber min={20} max={60} suffix="pts" style={{ width: '100%' }} />
                        </Form.Item>
                      </Col>
                      <Col span={8}>
                        <Form.Item name="full_count_points" label="Full Count Penalty">
                          <InputNumber min={40} max={100} suffix="pts" style={{ width: '100%' }} />
                        </Form.Item>
                      </Col>
                    </Row>
                  </Card>

                  <Card title="🤖 AI Matchmaking Bot Automation" size="small" style={{ marginBottom: 16, background: '#F8FAFC', border: '1px solid #E2E8F0' }}>
                    <Row gutter={16}>
                      <Col span={12}>
                        <Form.Item name="bot_fill_enabled" label="Auto-Fill Tables with AI Bots" valuePropName="checked">
                          <Switch checkedChildren="ENABLED" unCheckedChildren="DISABLED" />
                        </Form.Item>
                      </Col>
                      <Col span={12}>
                        <Form.Item name="bot_fill_delay_seconds" label="Bot Fill Delay (seconds)">
                          <InputNumber min={5} max={180} suffix="seconds" style={{ width: '100%' }} />
                        </Form.Item>
                      </Col>
                    </Row>
                    <Row gutter={16}>
                      <Col span={12}>
                        <Form.Item name="max_bot_ratio" label="Max Bot Ratio (0.0 to 1.0)">
                          <InputNumber min={0.1} max={1.0} step={0.05} style={{ width: '100%' }} />
                        </Form.Item>
                      </Col>
                      <Col span={12}>
                        <Form.Item name="bot_difficulty" label="AI Bot Intelligence Level">
                          <Select options={[
                            { value: 'easy', label: '🟢 Easy / Casual' },
                            { value: 'medium', label: '🟡 Medium / Standard' },
                            { value: 'hard', label: '🔴 Hard / Pro Evaluator' },
                          ]} />
                        </Form.Item>
                      </Col>
                    </Row>
                  </Card>

                  <Button type="primary" htmlType="submit" size="large" icon={<SaveOutlined />} loading={savingConfig} block>
                    Save Rummy Configuration
                  </Button>
                </Form>
              </div>
            )
          },
          {
            key: 'bots',
            label: <span><RobotOutlined /> Bots</span>,
            children: <BotManagementPanel gameType="rummy" />
          },
          {
            key: 'analytics',
            label: <span><LineChartOutlined /> Analytics & PnL</span>,
            children: <GamePnlDashboard gameType="rummy" />
          },
          {
            key: 'bot-training',
            label: <span><TrophyOutlined /> Bot Training</span>,
            children: (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                <Alert
                  type="info"
                  showIcon
                  message="Rummy AI Bot Coordination & DDAS Training"
                  description="Rummy bot coordination steers winner selection based on lifetime and vs-real-player win rates. Drop probabilities, open draw preferences, and declare speed factors adapt dynamically based on table stakes."
                />
                <BotTrainingConfigPanel gameType="rummy" />
                <BotTrainingTrendChart gameType="rummy" />
                <BotMetricsTable gameType="rummy" />
                <BotTrainingAuditTrail gameType="rummy" />
                <BotLearningSection gameType="rummy" />
              </div>
            )
          },
          {
            key: 'ml-training',
            label: <span><ExperimentOutlined /> ML Training</span>,
            children: <MLTrainingPanel gameType="rummy" />
          }
        ]} />
      </Card>

      {/* Modal: Spectate Table */}
      <Modal
        title="🔍 Rummy Table Inspector"
        open={spectateModalOpen}
        onCancel={() => setSpectateModalOpen(false)}
        footer={[
          <Button key="close" onClick={() => setSpectateModalOpen(false)}>Close</Button>,
          selectedRoom?.status === 'active' && (
            <Button
              key="term"
              danger
              icon={<StopOutlined />}
              onClick={() => { handleTerminateRoom(selectedRoom.id, true); setSpectateModalOpen(false) }}
            >
              Emergency Refund & Close
            </Button>
          )
        ]}
      >
        {selectedRoom && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <Card size="small" style={{ background: '#F8FAFC', border: '1px solid #E2E8F0' }}>
              <Row gutter={16}>
                <Col span={12}><Statistic title="Room ID" value={selectedRoom.id.slice(0, 14)} valueStyle={{ fontSize: 14 }} /></Col>
                <Col span={12}><Statistic title="Entry Stake" value={selectedRoom.entry_fee} prefix="₹ " precision={2} /></Col>
                <Col span={12}><Statistic title="Pot Amount" value={selectedRoom.pot_amount} prefix="₹ " precision={2} valueStyle={{ color: '#059669' }} /></Col>
                <Col span={12}><Statistic title="Status" value={selectedRoom.status?.toUpperCase()} valueStyle={{ fontSize: 15 }} /></Col>
              </Row>
            </Card>
            <div>
              <Text strong>Game Engine & Socket Route:</Text>
              <div><Text code>Microservice: teen-rummy (Port 4004) · Engine: TS 13-Card Backtracking Evaluator</Text></div>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
