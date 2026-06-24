import { useEffect, useState } from 'react'
import {
  Card, Form, Input, Button, Table, Tag, Badge, Space, Modal, InputNumber,
  Row, Col, Switch, Select, Popconfirm, message, Typography, Tooltip, Avatar
} from 'antd'
import {
  ReloadOutlined, UserAddOutlined, DeleteOutlined, RobotOutlined,
  UnlockOutlined, LockOutlined, InfoCircleOutlined
} from '@ant-design/icons'
import { adminApi } from '../api/client'

const { Text } = Typography

export default function Bots() {
  const [bots, setBots] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [pageSize] = useState(10)
  const [search, setSearch] = useState('')
  
  // Game configs (for bot settings)
  const [configs, setConfigs] = useState<any[]>([])
  const [loadingConfigs, setLoadingConfigs] = useState(false)
  const [savingConfig, setSavingConfig] = useState<string | null>(null)

  // Modals
  const [createOpen, setCreateOpen] = useState(false)
  const [form] = Form.useForm()

  const loadBots = () => {
    setLoading(true)
    adminApi.get(`/users`, {
      params: {
        page,
        limit: pageSize,
        search,
        is_bot: 'true'
      }
    })
      .then(r => {
        setBots(r.data.users || [])
        setTotal(r.data.total || 0)
      })
      .catch(() => message.error('Failed to load bots'))
      .finally(() => setLoading(false))
  }

  const loadConfigs = () => {
    setLoadingConfigs(true)
    adminApi.get('/game-configs')
      .then(r => {
        setConfigs(r.data || [])
      })
      .catch(() => message.error('Failed to load game configurations'))
      .finally(() => setLoadingConfigs(false))
  }

  const createBot = async (values: any) => {
    try {
      await adminApi.post('/bots', values)
      message.success('New bot created successfully!')
      setCreateOpen(false)
      form.resetFields()
      loadBots()
    } catch (e: any) {
      message.error(e?.response?.data?.error || 'Failed to create bot')
    }
  }

  const deleteBot = async (id: string) => {
    try {
      await adminApi.delete(`/bots/${id}`)
      message.success('Bot deleted successfully!')
      loadBots()
    } catch (e: any) {
      message.error(e?.response?.data?.error || 'Failed to delete bot')
    }
  }

  const toggleBotStatus = async (id: string, currentStatus: string) => {
    const nextStatus = currentStatus === 'active' ? 'suspended' : 'active'
    try {
      await adminApi.patch(`/users/${id}/status`, { status: nextStatus })
      message.success(`Bot status updated to ${nextStatus}`)
      loadBots()
    } catch (e: any) {
      message.error(e?.response?.data?.error || 'Failed to update status')
    }
  }

  const saveGameConfig = async (gameType: string, values: any) => {
    setSavingConfig(gameType)
    try {
      await adminApi.patch(`/game-configs/${gameType}`, values)
      message.success(`${gameType.toUpperCase()} bot configuration updated!`)
      loadConfigs()
    } catch {
      message.error('Failed to save game configuration')
    } finally {
      setSavingConfig(null)
    }
  }

  useEffect(() => {
    loadBots()
  }, [page, search])

  useEffect(() => {
    loadConfigs()
  }, [])

  return (
    <div style={{ padding: '12px 0' }}>
      <Row gutter={[24, 24]} align="middle" style={{ marginBottom: 24 }}>
        <Col span={12}>
          <h2 style={{ color: '#d4af37', margin: 0, display: 'flex', alignItems: 'center', gap: 12 }}>
            <RobotOutlined /> Bot Management System
          </h2>
        </Col>
        <Col span={12} style={{ textAlign: 'right' }}>
          <Space>
            <Button
              type="primary"
              icon={<UserAddOutlined />}
              onClick={() => setCreateOpen(true)}
              style={{ background: '#d4af37', borderColor: '#d4af37' }}
            >
              Add New Bot
            </Button>
            <Button icon={<ReloadOutlined />} onClick={() => { loadBots(); loadConfigs() }}>
              Refresh All
            </Button>
          </Space>
        </Col>
      </Row>

      <Row gutter={[24, 24]}>
        {/* Left Column: Game Bot Configuration Panels */}
        <Col xs={24} xl={8}>
          <Card
            title="🎮 Bot In-Game Simulation Rules"
            loading={loadingConfigs}
            style={{ marginBottom: 24, boxShadow: '0 4px 12px rgba(0,0,0,0.05)', borderRadius: 12 }}
          >
            <div style={{ maxHeight: 'calc(100vh - 250px)', overflowY: 'auto', paddingRight: 4 }}>
              {configs.filter(c => ['teen_patti', 'ludo', 'aviator'].includes(c.game_type)).map((config) => (
                <div key={config.game_type} style={{ marginBottom: 24, paddingBottom: 20, borderBottom: '1px solid #f0f0f0' }}>
                  <Typography.Title level={5} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ color: '#d4af37' }}>
                      {config.game_type === 'teen_patti' ? '🃏 Teen Patti' : config.game_type === 'ludo' ? '🎲 Ludo' : '✈️ Aviator'}
                    </span>
                    <Tag color={config.is_active ? 'green' : 'red'}>{config.is_active ? 'Active' : 'Disabled'}</Tag>
                  </Typography.Title>
                  
                  <Form
                    layout="vertical"
                    size="small"
                    initialValues={{
                      is_active: config.is_active,
                      bot_fill_enabled: config.bot_fill_enabled,
                      bot_fill_delay_seconds: config.bot_fill_delay_seconds,
                      max_bot_ratio: config.max_bot_ratio,
                      bot_difficulty: config.bot_difficulty
                    }}
                    onFinish={(values) => saveGameConfig(config.game_type, {
                      ...values,
                      rake_percent: config.rake_percent,
                      special_rules: config.special_rules
                    })}
                  >
                    <Row gutter={12}>
                      <Col span={12}>
                        <Form.Item name="bot_fill_enabled" label="Auto Fill Room" valuePropName="checked">
                          <Switch checkedChildren="ON" unCheckedChildren="OFF" />
                        </Form.Item>
                      </Col>
                      <Col span={12}>
                        <Form.Item name="bot_difficulty" label="Bot Skill Level">
                          <Select options={[
                            { value: 'easy', label: 'Easy' },
                            { value: 'medium', label: 'Medium' },
                            { value: 'hard', label: 'Hard' }
                          ]} />
                        </Form.Item>
                      </Col>
                    </Row>

                    <Row gutter={12}>
                      <Col span={12}>
                        <Form.Item name="bot_fill_delay_seconds" label="Join Delay (s)">
                          <InputNumber min={2} max={120} style={{ width: '100%' }} />
                        </Form.Item>
                      </Col>
                      <Col span={12}>
                        <Form.Item name="max_bot_ratio" label="Max Bot Ratio">
                          <InputNumber min={0} max={1} step={0.1} style={{ width: '100%' }} />
                        </Form.Item>
                      </Col>
                    </Row>
                    
                    <Form.Item style={{ margin: 0 }}>
                      <Button
                        type="primary"
                        htmlType="submit"
                        block
                        loading={savingConfig === config.game_type}
                        style={{ background: '#111', borderColor: '#111' }}
                      >
                        Save Settings
                      </Button>
                    </Form.Item>
                  </Form>
                </div>
              ))}
            </div>
          </Card>
        </Col>

        {/* Right Column: Bot Users Table */}
        <Col xs={24} xl={16}>
          <Card
            title={
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                <span>🤖 Simulation Bot List</span>
                <Input.Search
                  placeholder="Search username or phone..."
                  allowClear
                  onSearch={(v) => { setSearch(v); setPage(1) }}
                  onChange={(e) => { if (!e.target.value) { setSearch(''); setPage(1) } }}
                  style={{ width: 280 }}
                />
              </div>
            }
            style={{ boxShadow: '0 4px 12px rgba(0,0,0,0.05)', borderRadius: 12 }}
          >
            <Table
              rowKey="id"
              dataSource={bots}
              loading={loading}
              pagination={{
                current: page,
                pageSize,
                total,
                onChange: (p) => setPage(p),
                showSizeChanger: false
              }}
              size="middle"
              columns={[
                {
                  title: 'Avatar',
                  key: 'avatar',
                  render: (_, r) => (
                    <Badge dot status={r.status === 'active' ? 'success' : 'default'}>
                      <Avatar style={{ backgroundColor: '#d4af37' }}>{r.username[0]?.toUpperCase()}</Avatar>
                    </Badge>
                  )
                },
                {
                  title: 'Username',
                  dataIndex: 'username',
                  render: (v) => <span style={{ fontWeight: 'bold' }}>{v}</span>
                },
                {
                  title: 'Dummy Phone',
                  dataIndex: 'phone'
                },
                {
                  title: 'Real Balance',
                  dataIndex: 'real_balance',
                  render: (v) => <span style={{ color: '#52c41a', fontWeight: 'bold' }}>₹{Number(v || 0).toLocaleString()}</span>
                },
                {
                  title: 'Created At',
                  dataIndex: 'created_at',
                  render: (v) => new Date(v).toLocaleDateString()
                },
                {
                  title: 'Status',
                  dataIndex: 'status',
                  render: (s) => (
                    <Tag color={s === 'active' ? 'green' : 'red'}>
                      {s.toUpperCase()}
                    </Tag>
                  )
                },
                {
                  title: 'Actions',
                  key: 'actions',
                  render: (_, r) => (
                    <Space size="middle">
                      <Tooltip title={r.status === 'active' ? 'Suspend Bot' : 'Activate Bot'}>
                        <Button
                          icon={r.status === 'active' ? <LockOutlined /> : <UnlockOutlined />}
                          onClick={() => toggleBotStatus(r.id, r.status)}
                          shape="circle"
                          size="small"
                        />
                      </Tooltip>
                      <Popconfirm
                        title="Delete Bot"
                        description="Are you sure you want to permanently delete this bot and its wallet?"
                        onConfirm={() => deleteBot(r.id)}
                        okText="Yes"
                        cancelText="No"
                        okButtonProps={{ danger: true }}
                      >
                        <Tooltip title="Delete Bot Permanently">
                          <Button
                            danger
                            icon={<DeleteOutlined />}
                            shape="circle"
                            size="small"
                          />
                        </Tooltip>
                      </Popconfirm>
                    </Space>
                  )
                }
              ]}
            />
          </Card>
        </Col>
      </Row>

      {/* Add Bot Modal */}
      <Modal
        open={createOpen}
        title="🤖 Create New Simulation Bot"
        onCancel={() => setCreateOpen(false)}
        onOk={() => form.submit()}
        okText="Create Bot"
        okButtonProps={{ style: { background: '#d4af37', borderColor: '#d4af37' } }}
      >
        <Form form={form} layout="vertical" onFinish={createBot}>
          <Form.Item
            name="username"
            label="Bot Username"
            rules={[{ required: true, message: 'Please enter a unique username' }]}
          >
            <Input placeholder="e.g. LaserJoker, AlphaPlayer" />
          </Form.Item>
          <Form.Item
            name="phone"
            label="Dummy Phone Number (Optional)"
            rules={[{ pattern: /^[0-9]{10}$/, message: 'Must be exactly 10 digits' }]}
            tooltip={{ title: 'Leave blank to generate a random mock phone number', icon: <InfoCircleOutlined /> }}
          >
            <Input placeholder="e.g. 9991234567" maxLength={10} />
          </Form.Item>
          <Form.Item
            name="initial_balance"
            label="Initial Wallet Balance (₹)"
            initialValue={10000}
            rules={[{ required: true, message: 'Please enter initial balance' }]}
          >
            <InputNumber min={0} style={{ width: '100%' }} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}
