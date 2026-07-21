import { useEffect, useState } from 'react'
import {
  Card, Form, Input, Button, Table, Tag, Badge, Space, Modal, InputNumber,
  Select, Popconfirm, message, Tooltip, Avatar
} from 'antd'
import {
  UserAddOutlined, DeleteOutlined, UnlockOutlined, LockOutlined,
  InfoCircleOutlined, WalletOutlined
} from '@ant-design/icons'
import { adminApi } from '../api/client'

// "Play Style" has no backing gameplay concept — it's a decorative,
// deterministic hash of the bot's id, kept as-is. "Skill Level" used to be
// derived the same fake way; it's now the real bot_difficulty column.
const PERSONALITIES = ['Aggressive (Bluffer)', 'Conservative (Tight)', 'Balanced (Adaptive)']
const getBotPersonality = (botId: string) => {
  let hash = 0
  for (let i = 0; i < botId.length; i++) {
    hash = botId.charCodeAt(i) + ((hash << 5) - hash)
  }
  const pIdx = Math.abs(hash) % PERSONALITIES.length
  return PERSONALITIES[pIdx]
}

const GAME_OPTIONS = [
  { value: 'teen_patti', label: 'Teen Patti' },
  { value: 'ludo', label: 'Ludo' },
]

const DIFFICULTY_OPTIONS = [
  { value: 'easy', label: 'Easy' },
  { value: 'medium', label: 'Medium' },
  { value: 'hard', label: 'Hard' },
]

export default function BotManagementPanel({ gameType }: { gameType?: string }) {
  const [bots, setBots] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [pageSize] = useState(10)
  const [search, setSearch] = useState('')

  const [createOpen, setCreateOpen] = useState(false)
  const [form] = Form.useForm()

  const [creditOpen, setCreditOpen] = useState(false)
  const [selectedBot, setSelectedBot] = useState<any>(null)
  const [creditForm] = Form.useForm()

  const loadBots = () => {
    setLoading(true)
    adminApi.get(`/users`, {
      params: {
        page,
        limit: pageSize,
        search,
        is_bot: 'true',
        ...(gameType ? { game_type: gameType } : {}),
      }
    })
      .then(r => {
        setBots(r.data.users || [])
        setTotal(r.data.total || 0)
      })
      .catch(() => message.error('Failed to load bots'))
      .finally(() => setLoading(false))
  }

  const creditBot = async (values: any) => {
    try {
      await adminApi.post(`/users/${selectedBot.id}/credit`, {
        amount: values.amount,
        description: values.description || 'Bot allotment by admin'
      })
      message.success(`Allotted ₹${values.amount} to ${selectedBot.username}`)
      setCreditOpen(false)
      creditForm.resetFields()
      loadBots()
    } catch (e: any) {
      message.error(e?.response?.data?.error || 'Failed to allot money')
    }
  }

  const createBot = async (values: any) => {
    try {
      await adminApi.post('/bots', { ...values, preferred_game_type: values.preferred_game_type || gameType })
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

  const updateBot = async (id: string, fields: { preferred_game_type?: string; bot_difficulty?: string | null }) => {
    try {
      await adminApi.patch(`/bots/${id}`, fields)
      message.success('Bot updated')
      loadBots()
    } catch (e: any) {
      message.error(e?.response?.data?.error || 'Failed to update bot')
    }
  }

  useEffect(() => { loadBots() }, [page, search, gameType])

  return (
    <>
      <Card
        title={
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
            <span>🤖 Simulation Bot List</span>
            <Space>
              <Input.Search
                placeholder="Search username or phone..."
                allowClear
                onSearch={(v) => { setSearch(v); setPage(1) }}
                onChange={(e) => { if (!e.target.value) { setSearch(''); setPage(1) } }}
                style={{ width: 280 }}
              />
              <Button
                type="primary"
                icon={<UserAddOutlined />}
                onClick={() => setCreateOpen(true)}
                style={{ background: '#d4af37', borderColor: '#d4af37' }}
              >
                Add New Bot
              </Button>
            </Space>
          </div>
        }
        style={{ boxShadow: '0 4px 12px rgba(0,0,0,0.05)', borderRadius: 12 }}
      >
        <Table
          rowKey="id"
          dataSource={bots}
          loading={loading}
          scroll={{ x: 'max-content' }}
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
              title: 'Play Style',
              key: 'style',
              render: (_, r) => {
                const personality = getBotPersonality(r.id)
                const color = personality.startsWith('Aggressive') ? 'volcano' : personality.startsWith('Conservative') ? 'blue' : 'green'
                return <Tag color={color}>{personality}</Tag>
              }
            },
            {
              title: 'Game',
              key: 'game',
              render: (_, r) => (
                <Select
                  size="small"
                  value={r.preferred_game_type}
                  style={{ width: 140 }}
                  onChange={(v) => updateBot(r.id, { preferred_game_type: v })}
                  options={GAME_OPTIONS}
                />
              )
            },
            {
              title: 'Skill Level',
              key: 'skill',
              render: (_, r) => (
                <Select
                  size="small"
                  value={r.bot_difficulty ?? null}
                  style={{ width: 170 }}
                  placeholder="Default (game-wide)"
                  allowClear
                  onChange={(v) => updateBot(r.id, { bot_difficulty: v ?? null })}
                  options={DIFFICULTY_OPTIONS}
                />
              )
            },
            {
              title: 'Real Balance',
              dataIndex: 'real_balance',
              render: (v) => {
                const balance = Number(v || 0)
                let statusTag = null
                if (balance < 50) {
                  statusTag = <Tag color="red" style={{ marginLeft: 8 }}>CRITICAL</Tag>
                } else if (balance < 500) {
                  statusTag = <Tag color="orange" style={{ marginLeft: 8 }}>LOW</Tag>
                }
                return (
                  <span>
                    <span style={{ color: '#52c41a', fontWeight: 'bold' }}>₹{balance.toLocaleString()}</span>
                    {statusTag}
                  </span>
                )
              }
            },
            {
              title: 'Gameplay P&L',
              dataIndex: 'pnl',
              render: (v) => {
                const pnl = Number(v || 0)
                const color = pnl > 0 ? '#52c41a' : pnl < 0 ? '#f5222d' : '#888'
                const prefix = pnl > 0 ? '+' : ''
                return <span style={{ color, fontWeight: 'bold' }}>{prefix}₹{pnl.toLocaleString()}</span>
              }
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
                  <Tooltip title="Credit Wallet / Allot Money">
                    <Button
                      icon={<WalletOutlined />}
                      onClick={() => {
                        setSelectedBot(r)
                        setCreditOpen(true)
                      }}
                      shape="circle"
                      size="small"
                      style={{ color: '#52c41a', borderColor: '#52c41a' }}
                    />
                  </Tooltip>
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

      {/* Add Bot Modal */}
      <Modal
        open={createOpen}
        title="🤖 Create New Simulation Bot"
        onCancel={() => setCreateOpen(false)}
        onOk={() => form.submit()}
        okText="Create Bot"
        okButtonProps={{ style: { background: '#d4af37', borderColor: '#d4af37' } }}
      >
        <Form form={form} layout="vertical" onFinish={createBot} initialValues={{ preferred_game_type: gameType }}>
          <Form.Item
            name="username"
            label="Bot Username"
            rules={[{ required: true, message: 'Please enter a unique username' }]}
          >
            <Input placeholder="e.g. LaserJoker, AlphaPlayer" />
          </Form.Item>
          <Form.Item
            name="preferred_game_type"
            label="Game"
            rules={[{ required: true, message: 'Select which game this bot belongs to' }]}
          >
            <Select placeholder="Select a game" options={GAME_OPTIONS} />
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

      {/* Credit Bot Wallet Modal */}
      <Modal
        open={creditOpen}
        title={selectedBot ? `💸 Allot Balance to Bot: ${selectedBot.username}` : '💸 Allot Balance to Bot'}
        onCancel={() => {
          setCreditOpen(false)
          creditForm.resetFields()
        }}
        onOk={() => creditForm.submit()}
        okText="Allot Balance"
        okButtonProps={{ style: { background: '#52c41a', borderColor: '#52c41a' } }}
      >
        <Form form={creditForm} layout="vertical" onFinish={creditBot}>
          <Form.Item
            name="amount"
            label="Amount (₹)"
            rules={[{ required: true, message: 'Please enter amount to allot' }]}
          >
            <InputNumber min={1} style={{ width: '100%' }} placeholder="e.g. 500" />
          </Form.Item>
          <Form.Item
            name="description"
            label="Description / Reason"
            initialValue="Manual bot balance top-up"
          >
            <Input placeholder="e.g. Budget replenishment" />
          </Form.Item>
        </Form>
      </Modal>
    </>
  )
}
