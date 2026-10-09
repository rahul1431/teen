import { useEffect, useState } from 'react'
import {
  Table, Button, Modal, Form, Input, InputNumber, Select, Tag, Tabs, message, Popconfirm,
  Card, Row, Col, Statistic, Space, Drawer, Typography, Divider, Slider, Alert, Tree, DatePicker
} from 'antd'
import {
  UserOutlined, DollarOutlined, TrophyOutlined, TeamOutlined,
  PlusOutlined, ReloadOutlined, SettingOutlined, KeyOutlined,
  CheckCircleOutlined, CloseCircleOutlined, PlayCircleOutlined,
  WalletOutlined, GlobalOutlined, BranchesOutlined, HistoryOutlined
} from '@ant-design/icons'
import dayjs from 'dayjs'
import { adminApi } from '../api/client'

const { Text, Title } = Typography

export const SUPPORTED_GAMES = [
  { key: 'teen_patti', label: 'Teen Patti', icon: '🎴', defaultRate: 5.0 },
  { key: 'rummy', label: 'Rummy', icon: '🃏', defaultRate: 5.0 },
  { key: 'ludo', label: 'Ludo', icon: '🎲', defaultRate: 6.0 },
  { key: 'aviator', label: 'Aviator', icon: '🚀', defaultRate: 4.0 },
  { key: 'matka', label: 'Satta Matka', icon: '🎯', defaultRate: 7.5 },
  { key: 'lottery', label: 'Lottery', icon: '🎟️', defaultRate: 10.0 },
  { key: 'cricket', label: 'Cricket Betting', icon: '🏏', defaultRate: 5.0 },
]

export interface Agent {
  id: string
  username: string
  display_name: string
  phone: string | null
  status: 'active' | 'suspended'
  parent_agent_id: string | null
  commission_rate: number
  game_commissions?: Record<string, number>
  referral_code: string
  balance: number
  locked_balance?: number
  total_earned: number
  total_paid_out?: number
  player_count: number
  sub_agent_count?: number
  created_at: string
}

export default function Agents() {
  const [agents, setAgents] = useState<Agent[]>([])
  const [loading, setLoading] = useState(false)
  const [payouts, setPayouts] = useState<any[]>([])
  const [channels, setChannels] = useState<any[]>([])

  // Modals & Drawers state
  const [createModalOpen, setCreateModalOpen] = useState(false)
  const [gameRatesModalOpen, setGameRatesModalOpen] = useState(false)
  const [balanceModalOpen, setBalanceModalOpen] = useState(false)
  const [resetPassModalOpen, setResetPassModalOpen] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [settlementModalOpen, setSettlementModalOpen] = useState(false)

  // Selected agent state
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null)
  const [agentPlayers, setAgentPlayers] = useState<any[]>([])
  const [agentLedger, setAgentLedger] = useState<any[]>([])
  const [agentPerf, setAgentPerf] = useState<any[]>([])
  const [loadingDetails, setLoadingDetails] = useState(false)

  // Forms
  const [createForm] = Form.useForm()
  const [gameRatesForm] = Form.useForm()
  const [balanceForm] = Form.useForm()
  const [resetPassForm] = Form.useForm()
  const [settlementForm] = Form.useForm()

  const load = async () => {
    setLoading(true)
    try {
      const [aRes, pRes, cRes] = await Promise.all([
        adminApi.get('/agents'),
        adminApi.get('/agent-payouts').catch(() => ({ data: [] })),
        adminApi.get('/agent-channels').catch(() => ({ data: [] })),
      ])
      setAgents(aRes.data || [])
      setPayouts(pRes.data || [])
      setChannels(cRes.data || [])
    } catch (e: any) {
      message.error(e.response?.data?.error || 'Failed to load agent data')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const loadAgentDetails = async (agent: Agent) => {
    setSelectedAgent(agent)
    setDrawerOpen(true)
    setLoadingDetails(true)
    try {
      const [plRes, ldRes, pfRes] = await Promise.all([
        adminApi.get(`/agents/${agent.id}/players`).catch(() => ({ data: [] })),
        adminApi.get(`/agents/${agent.id}/ledger`).catch(() => ({ data: [] })),
        adminApi.get(`/agents/${agent.id}/performance`).catch(() => ({ data: { games: [] } })),
      ])
      setAgentPlayers(plRes.data || [])
      setAgentLedger(ldRes.data || [])
      setAgentPerf(pfRes.data?.games || [])
    } finally {
      setLoadingDetails(false)
    }
  }

  // Action Handlers
  const handleCreateAgent = async (values: any) => {
    try {
      const game_commissions: Record<string, number> = {}
      for (const g of SUPPORTED_GAMES) {
        if (values[`rate_${g.key}`] !== undefined) {
          game_commissions[g.key] = Number(values[`rate_${g.key}`])
        }
      }
      await adminApi.post('/agents', {
        username: values.username,
        password: values.password,
        display_name: values.display_name,
        phone: values.phone,
        parent_agent_id: values.parent_agent_id || null,
        commission_rate: values.commission_rate ?? 5,
        game_commissions,
      })
      message.success('Agent created successfully!')
      setCreateModalOpen(false)
      createForm.resetFields()
      load()
    } catch (e: any) {
      message.error(e.response?.data?.error || 'Failed to create agent')
    }
  }

  const handleSaveGameRates = async (values: any) => {
    if (!selectedAgent) return
    try {
      const game_commissions: Record<string, number> = {}
      for (const g of SUPPORTED_GAMES) {
        if (values[`rate_${g.key}`] !== undefined) {
          game_commissions[g.key] = Number(values[`rate_${g.key}`])
        }
      }
      await adminApi.patch(`/agents/${selectedAgent.id}`, {
        commission_rate: values.commission_rate,
        game_commissions,
      })
      message.success(`Game commission rates updated for ${selectedAgent.display_name}!`)
      setGameRatesModalOpen(false)
      load()
    } catch (e: any) {
      message.error(e.response?.data?.error || 'Failed to update game rates')
    }
  }

  const handleBalanceAdjust = async (values: any) => {
    if (!selectedAgent) return
    try {
      const amt = values.adjust_type === 'debit' ? -Math.abs(values.amount) : Math.abs(values.amount)
      await adminApi.post(`/agents/${selectedAgent.id}/balance-adjust`, {
        amount: amt,
        reason: values.reason,
      })
      message.success('Agent wallet balance adjusted!')
      setBalanceModalOpen(false)
      balanceForm.resetFields()
      load()
    } catch (e: any) {
      message.error(e.response?.data?.error || 'Failed to adjust balance')
    }
  }

  const handleResetPassword = async (values: any) => {
    if (!selectedAgent) return
    try {
      await adminApi.post(`/agents/${selectedAgent.id}/reset-password`, {
        new_password: values.new_password,
      })
      message.success(`Password reset for ${selectedAgent.display_name}!`)
      setResetPassModalOpen(false)
      resetPassForm.resetFields()
    } catch (e: any) {
      message.error(e.response?.data?.error || 'Failed to reset password')
    }
  }

  const handleToggleStatus = async (agent: Agent) => {
    const next = agent.status === 'active' ? 'suspended' : 'active'
    try {
      await adminApi.patch(`/agents/${agent.id}`, { status: next })
      message.success(`Agent status changed to ${next}`)
      load()
    } catch (e: any) {
      message.error(e.response?.data?.error || 'Failed to update status')
    }
  }

  const handleDecidePayout = async (id: string, status: 'paid' | 'rejected') => {
    const reference = status === 'paid' ? window.prompt('Bank / UPI Reference ID:') || undefined : undefined
    try {
      await adminApi.patch(`/agent-payouts/${id}`, { status, reference })
      message.success(`Payout ${status}`)
      load()
    } catch (e: any) {
      message.error(e.response?.data?.error || 'Failed to process payout')
    }
  }

  const handleDecideChannel = async (id: string, status: 'approved' | 'rejected') => {
    const rejection_reason = status === 'rejected' ? window.prompt('Rejection reason:') || 'Invalid channel URL' : undefined
    try {
      await adminApi.patch(`/agent-channels/${id}`, { status, rejection_reason })
      message.success(`Channel ${status}`)
      load()
    } catch (e: any) {
      message.error(e.response?.data?.error || 'Failed to update channel')
    }
  }

  const handleTriggerSettlement = async (values: any) => {
    try {
      await adminApi.post('/agents/trigger-settlement', { date: values.date.format('YYYY-MM-DD') })
      message.success(`Settlement triggered for ${values.date.format('YYYY-MM-DD')}!`)
      setSettlementModalOpen(false)
      load()
    } catch (e: any) {
      message.error(e.response?.data?.error || 'Failed to trigger settlement')
    }
  }

  const handleVoidLedger = async (agentId: string, ledgerId: string) => {
    try {
      await adminApi.post(`/agents/${agentId}/ledger/${ledgerId}/void`, {})
      message.success('Ledger entry voided and commission reversed from agent balance')
      if (selectedAgent) loadAgentDetails(selectedAgent)
      load()
    } catch (e: any) {
      message.error(e.response?.data?.error || 'Failed to void ledger entry')
    }
  }

  // Hierarchy Tree Builder
  const buildHierarchyTree = (list: Agent[]) => {
    const map = new Map<string, any>()
    list.forEach(a => map.set(a.id, {
      title: (
        <span>
          <Text strong>{a.display_name}</Text> <Text type="secondary">(@{a.username})</Text>
          <Tag color="gold" style={{ marginLeft: 8 }}>{a.commission_rate}% default</Tag>
          <Tag color="green">₹{a.balance.toFixed(2)}</Tag>
          <Tag color="blue">{a.player_count} players</Tag>
        </span>
      ),
      key: a.id,
      children: [],
      raw: a,
    }))

    const tree: any[] = []
    list.forEach(a => {
      if (a.parent_agent_id && map.has(a.parent_agent_id)) {
        map.get(a.parent_agent_id).children.push(map.get(a.id))
      } else {
        tree.push(map.get(a.id))
      }
    })
    return tree
  }

  // Metric aggregates
  const totalBalance = agents.reduce((acc, a) => acc + (a.balance || 0), 0)
  const totalEarned = agents.reduce((acc, a) => acc + (a.total_earned || 0), 0)
  const totalPlayers = agents.reduce((acc, a) => acc + (a.player_count || 0), 0)
  const pendingPayoutsAmount = payouts.filter(p => p.status === 'created').reduce((acc, p) => acc + (Number(p.amount) || 0), 0)

  return (
    <div style={{ padding: '0 8px 24px' }}>
      {/* Header Bar */}
      <Row justify="space-between" align="middle" style={{ marginBottom: 16 }}>
        <Col>
          <Title level={4} style={{ margin: 0 }}>👥 Agent Commission & Affiliate Management</Title>
          <Text type="secondary">Manage agents, sub-agents hierarchy, individual game commission rates, and payouts</Text>
        </Col>
        <Col>
          <Space>
            <Button icon={<PlayCircleOutlined />} onClick={() => setSettlementModalOpen(true)}>Manual Settlement</Button>
            <Button icon={<ReloadOutlined />} onClick={load} loading={loading}>Refresh</Button>
            <Button type="primary" icon={<PlusOutlined />} onClick={() => {
              createForm.resetFields()
              setCreateModalOpen(true)
            }}>Create Agent</Button>
          </Space>
        </Col>
      </Row>

      {/* Metrics Row */}
      <Row gutter={[16, 16]} style={{ marginBottom: 20 }}>
        <Col xs={12} sm={6} md={4}>
          <Card size="small" style={{ background: '#FFFFFF', borderRadius: 14, border: '1px solid #E2E8F0' }}>
            <Statistic title="Total Agents" value={agents.length} prefix={<TeamOutlined style={{ color: '#2563EB' }} />} />
          </Card>
        </Col>
        <Col xs={12} sm={6} md={4}>
          <Card size="small" style={{ background: '#FFFFFF', borderRadius: 14, border: '1px solid #E2E8F0' }}>
            <Statistic title="Active Players" value={totalPlayers} prefix={<UserOutlined style={{ color: '#059669' }} />} />
          </Card>
        </Col>
        <Col xs={12} sm={6} md={4}>
          <Card size="small" style={{ background: '#FFFFFF', borderRadius: 14, border: '1px solid #E2E8F0' }}>
            <Statistic title="Agent Balances" value={totalBalance} precision={2} prefix={<WalletOutlined style={{ color: '#D97706' }} />} suffix="₹" valueStyle={{ color: '#059669', fontWeight: 700 }} />
          </Card>
        </Col>
        <Col xs={12} sm={6} md={4}>
          <Card size="small" style={{ background: '#FFFFFF', borderRadius: 14, border: '1px solid #E2E8F0' }}>
            <Statistic title="Total Paid Out" value={totalEarned} precision={2} prefix={<DollarOutlined style={{ color: '#7C3AED' }} />} suffix="₹" />
          </Card>
        </Col>
        <Col xs={12} sm={6} md={4}>
          <Card size="small" style={{ background: '#FFFFFF', borderRadius: 14, border: '1px solid #E2E8F0' }}>
            <Statistic title="Pending Payouts" value={pendingPayoutsAmount} precision={2} valueStyle={{ color: pendingPayoutsAmount > 0 ? '#E11D48' : undefined }} prefix={<HistoryOutlined />} suffix="₹" />
          </Card>
        </Col>
        <Col xs={12} sm={6} md={4}>
          <Card size="small" style={{ background: '#FFFFFF', borderRadius: 14, border: '1px solid #E2E8F0' }}>
            <Statistic title="Channels Review" value={channels.filter(c => c.status === 'pending').length} prefix={<GlobalOutlined style={{ color: '#0891B2' }} />} />
          </Card>
        </Col>
      </Row>

      {/* Main Tabs */}
      <Card bordered={false}>
        <Tabs items={[
          {
            key: 'directory',
            label: <span><TeamOutlined /> Agents Directory ({agents.length})</span>,
            children: (
              <Table
                dataSource={agents}
                rowKey="id"
                loading={loading}
                pagination={{ pageSize: 15 }}
                columns={[
                  {
                    title: 'Agent',
                    render: (_: any, r: Agent) => (
                      <div>
                        <Text strong>{r.display_name}</Text>
                        <div><Text type="secondary">@{r.username} {r.phone ? `· ${r.phone}` : ''}</Text></div>
                        <Tag color="cyan">Code: {r.referral_code}</Tag>
                      </div>
                    )
                  },
                  {
                    title: 'Tier / Parent',
                    render: (_: any, r: Agent) => {
                      if (!r.parent_agent_id) return <Tag color="gold">👑 Master Agent</Tag>
                      const p = agents.find(a => a.id === r.parent_agent_id)
                      return (
                        <div>
                          <Tag color="blue">Sub-Agent</Tag>
                          <div><Text type="secondary">Parent: {p?.display_name || r.parent_agent_id.slice(0, 8)}</Text></div>
                        </div>
                      )
                    }
                  },
                  {
                    title: 'Default Rate',
                    dataIndex: 'commission_rate',
                    render: (v: number) => <Tag color="orange" style={{ fontWeight: 'bold' }}>{Number(v).toFixed(1)}%</Tag>
                  },
                  {
                    title: 'Game Rates',
                    render: (_: any, r: Agent) => {
                      const gc = typeof r.game_commissions === 'string' ? JSON.parse(r.game_commissions) : (r.game_commissions || {})
                      const count = Object.keys(gc).length
                      return (
                        <Space wrap>
                          {count > 0 ? (
                            SUPPORTED_GAMES.map(g => gc[g.key] !== undefined ? (
                              <Tag key={g.key} color="purple" style={{ fontSize: 11 }}>
                                {g.icon} {g.label}: {gc[g.key]}%
                              </Tag>
                            ) : null)
                          ) : (
                            <Text type="secondary">Uses {r.commission_rate}% for all</Text>
                          )}
                        </Space>
                      )
                    }
                  },
                  {
                    title: 'Network',
                    render: (_: any, r: Agent) => (
                      <div>
                        <div><Text strong>{r.player_count}</Text> <Text type="secondary">players</Text></div>
                        {r.sub_agent_count ? <div><Text type="secondary">{r.sub_agent_count} sub-agents</Text></div> : null}
                      </div>
                    )
                  },
                  {
                    title: 'Balance (₹)',
                    dataIndex: 'balance',
                    render: (v: number) => <Text strong style={{ color: '#52c41a' }}>₹ {Number(v).toFixed(2)}</Text>
                  },
                  {
                    title: 'Total Earned',
                    dataIndex: 'total_earned',
                    render: (v: number) => `₹ ${Number(v).toFixed(2)}`
                  },
                  {
                    title: 'Status',
                    dataIndex: 'status',
                    render: (st: string) => <Tag color={st === 'active' ? 'green' : 'red'}>{st?.toUpperCase()}</Tag>
                  },
                  {
                    title: 'Actions',
                    render: (_: any, r: Agent) => (
                      <Space wrap>
                        <Button size="small" type="primary" ghost onClick={() => loadAgentDetails(r)}>
                          Dashboard
                        </Button>
                        <Button size="small" icon={<SettingOutlined />} onClick={() => {
                          setSelectedAgent(r)
                          const gc = typeof r.game_commissions === 'string' ? JSON.parse(r.game_commissions) : (r.game_commissions || {})
                          const initVals: any = { commission_rate: r.commission_rate }
                          for (const g of SUPPORTED_GAMES) {
                            initVals[`rate_${g.key}`] = gc[g.key] ?? r.commission_rate
                          }
                          gameRatesForm.setFieldsValue(initVals)
                          setGameRatesModalOpen(true)
                        }}>
                          Game Rates
                        </Button>
                        <Button size="small" icon={<DollarOutlined />} onClick={() => {
                          setSelectedAgent(r)
                          balanceForm.resetFields()
                          setBalanceModalOpen(true)
                        }}>
                          Adjust ₹
                        </Button>
                        <Button size="small" icon={<KeyOutlined />} onClick={() => {
                          setSelectedAgent(r)
                          resetPassForm.resetFields()
                          setResetPassModalOpen(true)
                        }} />
                        <Popconfirm title={`${r.status === 'active' ? 'Suspend' : 'Reactivate'} this agent?`} onConfirm={() => handleToggleStatus(r)}>
                          <Button size="small" danger={r.status === 'active'}>
                            {r.status === 'active' ? 'Suspend' : 'Activate'}
                          </Button>
                        </Popconfirm>
                      </Space>
                    )
                  }
                ]}
              />
            )
          },
          {
            key: 'hierarchy',
            label: <span><BranchesOutlined /> Hierarchy Tree</span>,
            children: (
              <Card title="Agent Downline Tree (Master -> Sub-Agents Overrides)">
                <Tree
                  showLine
                  defaultExpandAll
                  treeData={buildHierarchyTree(agents)}
                />
              </Card>
            )
          },
          {
            key: 'payouts',
            label: <span><HistoryOutlined /> Payout Requests ({payouts.filter(p => p.status === 'created').length})</span>,
            children: (
              <Table
                dataSource={payouts}
                rowKey="id"
                pagination={{ pageSize: 10 }}
                columns={[
                  {
                    title: 'Agent',
                    render: (_: any, r: any) => (
                      <div>
                        <Text strong>{r.display_name}</Text>
                        <div><Text type="secondary">@{r.username} {r.phone ? `· ${r.phone}` : ''}</Text></div>
                      </div>
                    )
                  },
                  {
                    title: 'Amount (₹)',
                    dataIndex: 'amount',
                    render: (v: any) => <Text strong style={{ color: '#faad14', fontSize: 15 }}>₹ {Number(v).toFixed(2)}</Text>
                  },
                  {
                    title: 'Payment Details / UPI',
                    dataIndex: 'metadata',
                    render: (m: any) => {
                      const data = typeof m === 'string' ? JSON.parse(m) : (m || {})
                      return (
                        <div>
                          {data.upi_id && <div><Tag color="cyan">UPI: {data.upi_id}</Tag></div>}
                          {data.bank_account && <div><Text type="secondary">A/C: {data.bank_account} (IFSC: {data.ifsc})</Text></div>}
                          {data.account_holder && <div><Text type="secondary">Name: {data.account_holder}</Text></div>}
                        </div>
                      )
                    }
                  },
                  {
                    title: 'Requested At',
                    dataIndex: 'requested_at',
                    render: (t: string) => dayjs(t).format('DD/MM/YY hh:mm A')
                  },
                  {
                    title: 'Status',
                    dataIndex: 'status',
                    render: (st: string, r: any) => (
                      <div>
                        <Tag color={st === 'paid' ? 'green' : st === 'rejected' ? 'red' : 'gold'}>{st?.toUpperCase()}</Tag>
                        {r.reference && <div><Text type="secondary" style={{ fontSize: 11 }}>Ref: {r.reference}</Text></div>}
                      </div>
                    )
                  },
                  {
                    title: 'Actions',
                    render: (_: any, r: any) => r.status === 'created' ? (
                      <Space>
                        <Button size="small" type="primary" icon={<CheckCircleOutlined />} onClick={() => handleDecidePayout(r.id, 'paid')}>
                          Approve & Pay
                        </Button>
                        <Button size="small" danger icon={<CloseCircleOutlined />} onClick={() => handleDecidePayout(r.id, 'rejected')}>
                          Reject
                        </Button>
                      </Space>
                    ) : null
                  }
                ]}
              />
            )
          },
          {
            key: 'channels',
            label: <span><GlobalOutlined /> Marketing Channels</span>,
            children: (
              <Table
                dataSource={channels}
                rowKey="id"
                pagination={{ pageSize: 10 }}
                columns={[
                  { title: 'Agent', dataIndex: 'agent_display_name' },
                  { title: 'Platform', dataIndex: 'platform', render: (p: string) => <Tag color="blue">{p?.toUpperCase()}</Tag> },
                  { title: 'Label', dataIndex: 'label' },
                  {
                    title: 'URL',
                    dataIndex: 'url',
                    render: (url: string) => <a href={url} target="_blank" rel="noreferrer">{url}</a>
                  },
                  {
                    title: 'Status',
                    dataIndex: 'status',
                    render: (st: string) => <Tag color={st === 'approved' ? 'green' : st === 'rejected' ? 'red' : 'gold'}>{st?.toUpperCase()}</Tag>
                  },
                  {
                    title: 'Actions',
                    render: (_: any, r: any) => r.status === 'pending' ? (
                      <Space>
                        <Button size="small" type="primary" onClick={() => handleDecideChannel(r.id, 'approved')}>Approve</Button>
                        <Button size="small" danger onClick={() => handleDecideChannel(r.id, 'rejected')}>Reject</Button>
                      </Space>
                    ) : null
                  }
                ]}
              />
            )
          }
        ]} />
      </Card>

      {/* Modal: Create Agent */}
      <Modal title="Create New Agent" open={createModalOpen} onCancel={() => setCreateModalOpen(false)} footer={null} width={650}>
        <Form form={createForm} layout="vertical" onFinish={handleCreateAgent}>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="username" label="Username (Login ID)" rules={[{ required: true }]}>
                <Input placeholder="agent_username" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="password" label="Password" rules={[{ required: true, min: 6 }]}>
                <Input.Password placeholder="••••••••" />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="display_name" label="Full Name / Display Name" rules={[{ required: true }]}>
                <Input placeholder="John Doe" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="phone" label="Phone Number">
                <Input placeholder="+91 9876543210" />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="parent_agent_id" label="Parent Agent (Leave empty for Master Agent)">
            <Select placeholder="Select parent agent or leave empty for top-level" allowClear>
              {agents.map(a => (
                <Select.Option key={a.id} value={a.id}>{a.display_name} (@{a.username}) - {a.commission_rate}% default</Select.Option>
              ))}
            </Select>
          </Form.Item>

          <Divider orientation="left">🎮 Individual Game Commission Rates (%)</Divider>
          <Form.Item name="commission_rate" label="Default Commission Rate (%)" initialValue={5.0} rules={[{ required: true }]}>
            <InputNumber min={0} max={100} step={0.5} style={{ width: '100%' }} />
          </Form.Item>
          <Row gutter={[16, 8]}>
            {SUPPORTED_GAMES.map(g => (
              <Col span={12} key={g.key}>
                <Form.Item name={`rate_${g.key}`} label={`${g.icon} ${g.label} Rate (%)`} initialValue={g.defaultRate}>
                  <InputNumber min={0} max={100} step={0.5} style={{ width: '100%' }} />
                </Form.Item>
              </Col>
            ))}
          </Row>

          <Button type="primary" htmlType="submit" block size="large" style={{ marginTop: 12 }}>Create Agent & Generate Referral Code</Button>
        </Form>
      </Modal>

      {/* Modal: Edit Per-Game Rates */}
      <Modal title={`Assign Game Commission Rates: ${selectedAgent?.display_name}`} open={gameRatesModalOpen} onCancel={() => setGameRatesModalOpen(false)} footer={null} width={600}>
        <Alert
          type="info"
          showIcon
          message="Per-Game Commission Assignment"
          description="You can set custom commission percentage rates for each individual game. When players play that game, the agent earns this exact percentage from their net turnover / house win."
          style={{ marginBottom: 16 }}
        />
        <Form form={gameRatesForm} layout="vertical" onFinish={handleSaveGameRates}>
          <Form.Item name="commission_rate" label="Default / Fallback Commission Rate (%)" rules={[{ required: true }]}>
            <InputNumber min={0} max={100} step={0.5} style={{ width: '100%' }} />
          </Form.Item>
          <Divider orientation="left">Individual Game Rates</Divider>
          {SUPPORTED_GAMES.map(g => (
            <Form.Item key={g.key} name={`rate_${g.key}`} label={`${g.icon} ${g.label} Rate (%)`}>
              <Row gutter={16} align="middle">
                <Col span={16}>
                  <Slider min={0} max={50} step={0.5} />
                </Col>
                <Col span={8}>
                  <InputNumber min={0} max={100} step={0.5} style={{ width: '100%' }} suffix="%" />
                </Col>
              </Row>
            </Form.Item>
          ))}
          <Button type="primary" htmlType="submit" block size="large">Save Game Rates</Button>
        </Form>
      </Modal>

      {/* Modal: Balance Adjustment */}
      <Modal title={`Adjust Wallet Balance: ${selectedAgent?.display_name}`} open={balanceModalOpen} onCancel={() => setBalanceModalOpen(false)} footer={null}>
        <Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
          Current Wallet Balance: <Text strong style={{ color: '#52c41a' }}>₹ {selectedAgent?.balance.toFixed(2)}</Text>
        </Text>
        <Form form={balanceForm} layout="vertical" onFinish={handleBalanceAdjust}>
          <Form.Item name="adjust_type" label="Action" initialValue="credit" rules={[{ required: true }]}>
            <Select>
              <Select.Option value="credit">Credit / Add Funds (+ ₹)</Select.Option>
              <Select.Option value="debit">Debit / Deduct Funds (- ₹)</Select.Option>
            </Select>
          </Form.Item>
          <Form.Item name="amount" label="Amount (₹)" rules={[{ required: true, min: 1 }]}>
            <InputNumber min={1} style={{ width: '100%' }} prefix="₹ " />
          </Form.Item>
          <Form.Item name="reason" label="Reason for adjustment (Mandatory for audit log)" rules={[{ required: true, min: 3 }]}>
            <Input.TextArea rows={3} placeholder="e.g. Offline cash settlement / incentive bonus" />
          </Form.Item>
          <Button type="primary" htmlType="submit" block>Confirm Balance Adjustment</Button>
        </Form>
      </Modal>

      {/* Modal: Reset Password */}
      <Modal title={`Reset Password: ${selectedAgent?.display_name}`} open={resetPassModalOpen} onCancel={() => setResetPassModalOpen(false)} footer={null}>
        <Form form={resetPassForm} layout="vertical" onFinish={handleResetPassword}>
          <Form.Item name="new_password" label="New Password" rules={[{ required: true, min: 6 }]}>
            <Input.Password placeholder="Enter new password (min 6 characters)" />
          </Form.Item>
          <Button type="primary" htmlType="submit" block>Reset Password</Button>
        </Form>
      </Modal>

      {/* Modal: Trigger Settlement */}
      <Modal title="Run Daily Commission Settlement" open={settlementModalOpen} onCancel={() => setSettlementModalOpen(false)} footer={null}>
        <Alert
          type="warning"
          message="Computes player net turnover and distributes direct & override commissions into agent wallets."
          style={{ marginBottom: 16 }}
        />
        <Form form={settlementForm} layout="vertical" onFinish={handleTriggerSettlement}>
          <Form.Item name="date" label="Settlement Date (IST)" initialValue={dayjs().subtract(1, 'day')} rules={[{ required: true }]}>
            <DatePicker style={{ width: '100%' }} />
          </Form.Item>
          <Button type="primary" htmlType="submit" block>Execute Settlement</Button>
        </Form>
      </Modal>

      {/* Drawer: Detailed Agent Performance & Player List */}
      <Drawer
        title={<span><TeamOutlined /> Agent Performance: {selectedAgent?.display_name} (@{selectedAgent?.username})</span>}
        width={750}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
      >
        {selectedAgent && (
          <div>
            <Row gutter={16} style={{ marginBottom: 20 }}>
              <Col span={6}>
                <Statistic title="Balance" value={selectedAgent.balance} precision={2} prefix="₹" />
              </Col>
              <Col span={6}>
                <Statistic title="Total Earned" value={selectedAgent.total_earned} precision={2} prefix="₹" />
              </Col>
              <Col span={6}>
                <Statistic title="Players" value={selectedAgent.player_count} />
              </Col>
              <Col span={6}>
                <Statistic title="Referral Code" value={selectedAgent.referral_code} />
              </Col>
            </Row>

            <Tabs items={[
              {
                key: 'game_performance',
                label: 'Game Turnover Breakdown',
                children: (
                  <Table
                    dataSource={agentPerf}
                    rowKey="game_type"
                    loading={loadingDetails}
                    pagination={false}
                    columns={[
                      {
                        title: 'Game',
                        dataIndex: 'game_type',
                        render: (g: string) => {
                          const info = SUPPORTED_GAMES.find(sg => sg.key === g)
                          return <Text strong>{info ? `${info.icon} ${info.label}` : g.toUpperCase()}</Text>
                        }
                      },
                      { title: 'Active Players', dataIndex: 'active_players' },
                      {
                        title: 'Total Turnover (₹)',
                        dataIndex: 'turnover',
                        render: (v: any) => `₹ ${Number(v).toFixed(2)}`
                      },
                      {
                        title: 'Net House Win (₹)',
                        dataIndex: 'net_house_win',
                        render: (v: any) => (
                          <Text strong style={{ color: Number(v) >= 0 ? '#52c41a' : '#ff4d4f' }}>
                            ₹ {Number(v).toFixed(2)}
                          </Text>
                        )
                      },
                      {
                        title: 'Assigned Rate (%)',
                        render: (_: any, r: any) => {
                          const gc = typeof selectedAgent.game_commissions === 'string' ? JSON.parse(selectedAgent.game_commissions) : (selectedAgent.game_commissions || {})
                          const rate = gc[r.game_type] ?? selectedAgent.commission_rate
                          return <Tag color="purple">{rate}%</Tag>
                        }
                      }
                    ]}
                  />
                )
              },
              {
                key: 'players',
                label: `Referred Players (${agentPlayers.length})`,
                children: (
                  <Table
                    dataSource={agentPlayers}
                    rowKey="id"
                    loading={loadingDetails}
                    pagination={{ pageSize: 8 }}
                    columns={[
                      {
                        title: 'Player',
                        render: (_: any, r: any) => (
                          <div>
                            <Text strong>{r.username}</Text>
                            <div><Text type="secondary">{r.phone || 'No phone'}</Text></div>
                          </div>
                        )
                      },
                      {
                        title: 'Wallet (₹)',
                        dataIndex: 'wallet_balance',
                        render: (v: any) => `₹ ${Number(v || 0).toFixed(2)}`
                      },
                      {
                        title: 'Turnover (₹)',
                        dataIndex: 'total_turnover',
                        render: (v: any) => `₹ ${Number(v || 0).toFixed(2)}`
                      },
                      {
                        title: 'Net GGR (₹)',
                        dataIndex: 'net_house_win',
                        render: (v: any) => (
                          <Text strong style={{ color: Number(v) >= 0 ? '#52c41a' : '#ff4d4f' }}>
                            ₹ {Number(v || 0).toFixed(2)}
                          </Text>
                        )
                      },
                      {
                        title: 'Joined At',
                        dataIndex: 'created_at',
                        render: (t: string) => dayjs(t).format('DD/MM/YY')
                      }
                    ]}
                  />
                )
              },
              {
                key: 'ledger',
                label: 'Commission Ledger',
                children: (
                  <Table
                    dataSource={agentLedger}
                    rowKey="id"
                    loading={loadingDetails}
                    pagination={{ pageSize: 8 }}
                    columns={[
                      {
                        title: 'Date',
                        dataIndex: 'date',
                        render: (d: string) => dayjs(d).format('DD MMM YYYY')
                      },
                      {
                        title: 'Direct (₹)',
                        dataIndex: 'direct_commission',
                        render: (v: any) => `₹ ${Number(v).toFixed(2)}`
                      },
                      {
                        title: 'Override (₹)',
                        dataIndex: 'override_commission',
                        render: (v: any) => `₹ ${Number(v).toFixed(2)}`
                      },
                      {
                        title: 'Total (₹)',
                        dataIndex: 'total_commission',
                        render: (v: any) => <Text strong style={{ color: '#52c41a' }}>₹ {Number(v).toFixed(2)}</Text>
                      },
                      {
                        title: 'Game Breakdown',
                        dataIndex: 'game_breakdown',
                        render: (gb: any) => {
                          const parsed = typeof gb === 'string' ? JSON.parse(gb) : (gb || {})
                          const entries = Object.entries(parsed)
                          if (!entries.length) return <Text type="secondary">-</Text>
                          return (
                            <Space wrap>
                              {entries.map(([game, data]: any) => (
                                <Tag key={game} color="blue">
                                  {game}: ₹{Number(data.total).toFixed(2)}
                                </Tag>
                              ))}
                            </Space>
                          )
                        }
                      },
                      {
                        title: 'Status',
                        dataIndex: 'status',
                        render: (st: string) => <Tag color={st === 'settled' ? 'green' : 'default'}>{st?.toUpperCase()}</Tag>
                      },
                      {
                        title: 'Actions',
                        render: (_: any, r: any) => r.status === 'settled' ? (
                          <Popconfirm title="Void this commission?" onConfirm={() => handleVoidLedger(selectedAgent.id, r.id)}>
                            <Button size="small" danger>Void</Button>
                          </Popconfirm>
                        ) : null
                      }
                    ]}
                  />
                )
              }
            ]} />
          </div>
        )}
      </Drawer>
    </div>
  )
}
