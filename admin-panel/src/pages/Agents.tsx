import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Table, Button, Modal, Form, Input, InputNumber, Select, Tag, Tabs, message, Popconfirm,
  Card, Row, Col, Statistic, Space, Drawer, Typography, Divider, Slider, Alert, Tree, DatePicker,
  Progress, Avatar, Tooltip, Badge
} from 'antd'
import {
  UserOutlined, DollarOutlined, TrophyOutlined, TeamOutlined,
  PlusOutlined, ReloadOutlined, SettingOutlined, KeyOutlined,
  CheckCircleOutlined, CloseCircleOutlined, PlayCircleOutlined,
  WalletOutlined, GlobalOutlined, BranchesOutlined, HistoryOutlined,
  LineChartOutlined, AuditOutlined, SafetyCertificateOutlined,
  UserAddOutlined, MobileOutlined, CopyOutlined, ShareAltOutlined,
  EyeOutlined, EditOutlined, SearchOutlined, CheckOutlined,
  CloseOutlined, BankOutlined, IdcardOutlined, ThunderboltOutlined
} from '@ant-design/icons'
import dayjs from 'dayjs'
import { adminApi } from '../api/client'

const { Text, Title, Paragraph } = Typography

export const SUPPORTED_GAMES = [
  { key: 'teen_patti', label: 'Teen Patti', icon: '🎴', defaultRate: 5.0 },
  { key: 'rummy', label: 'Rummy', icon: '🃏', defaultRate: 5.0 },
  { key: 'ludo', label: 'Ludo', icon: '🎲', defaultRate: 6.0 },
  { key: 'aviator', label: 'Aviator', icon: '🚀', defaultRate: 4.0 },
  { key: 'matka', label: 'Satta Matka', icon: '🎯', defaultRate: 7.5 },
  { key: 'lottery', label: 'Lottery', icon: '🎟️', defaultRate: 10.0 },
  { key: 'cricket', label: 'Sports Betting', icon: '🏆', defaultRate: 5.0 },
  { key: 'color_prediction', label: 'Color Prediction', icon: '🎨', defaultRate: 5.0 },
]

export interface Agent {
  id: string
  username: string
  display_name: string
  phone: string | null
  email?: string | null
  avatar_url?: string | null
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
  click_count?: number
  bank_details?: {
    account_holder?: string
    bank_name?: string
    bank_account?: string
    ifsc?: string
    upi_id?: string
  }
  kyc_status?: 'pending' | 'submitted' | 'verified' | 'rejected'
  kyc_data?: {
    document_type?: string
    document_number?: string
    document_front?: string
    document_back?: string
    submitted_at?: string
    reviewed_by?: string
    reviewed_at?: string
    admin_notes?: string
  }
  created_at: string
}

export default function Agents() {
  const navigate = useNavigate()
  const [agents, setAgents] = useState<Agent[]>([])
  const [loading, setLoading] = useState(false)
  const [payouts, setPayouts] = useState<any[]>([])
  const [channels, setChannels] = useState<any[]>([])
  const [searchText, setSearchText] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('all')

  // Modals & Drawers state
  const [createModalOpen, setCreateModalOpen] = useState(false)
  const [editProfileModalOpen, setEditProfileModalOpen] = useState(false)
  const [gameRatesModalOpen, setGameRatesModalOpen] = useState(false)
  const [balanceModalOpen, setBalanceModalOpen] = useState(false)
  const [resetPassModalOpen, setResetPassModalOpen] = useState(false)
  const [assignPlayerModalOpen, setAssignPlayerModalOpen] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [settlementModalOpen, setSettlementModalOpen] = useState(false)

  // Selected agent state
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null)
  const [agentPlayers, setAgentPlayers] = useState<any[]>([])
  const [agentLedger, setAgentLedger] = useState<any[]>([])
  const [agentPerf, setAgentPerf] = useState<any[]>([])
  const [agentAnalytics, setAgentAnalytics] = useState<any>(null)
  const [loadingDetails, setLoadingDetails] = useState(false)

  // Forms
  const [createForm] = Form.useForm()
  const [editProfileForm] = Form.useForm()
  const [gameRatesForm] = Form.useForm()
  const [balanceForm] = Form.useForm()
  const [resetPassForm] = Form.useForm()
  const [assignPlayerForm] = Form.useForm()
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
      const [plRes, ldRes, pfRes, anRes] = await Promise.all([
        adminApi.get(`/agents/${agent.id}/players`).catch(() => ({ data: [] })),
        adminApi.get(`/agents/${agent.id}/ledger`).catch(() => ({ data: [] })),
        adminApi.get(`/agents/${agent.id}/performance`).catch(() => ({ data: { games: [] } })),
        adminApi.get(`/agents/${agent.id}/analytics`).catch(() => ({ data: null })),
      ])
      setAgentPlayers(plRes.data || [])
      setAgentLedger(ldRes.data || [])
      setAgentPerf(pfRes.data?.games || [])
      setAgentAnalytics(anRes.data)
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

  const handleUpdateProfile = async (values: any) => {
    if (!selectedAgent) return
    try {
      await adminApi.patch(`/agents/${selectedAgent.id}`, {
        display_name: values.display_name,
        phone: values.phone || null,
        email: values.email || null,
        bank_details: {
          account_holder: values.account_holder,
          bank_name: values.bank_name,
          bank_account: values.bank_account,
          ifsc: values.ifsc,
          upi_id: values.upi_id,
        },
      })
      message.success('Agent profile updated successfully!')
      setEditProfileModalOpen(false)
      // Update local state
      const updated = {
        ...selectedAgent,
        display_name: values.display_name,
        phone: values.phone,
        email: values.email,
        bank_details: {
          account_holder: values.account_holder,
          bank_name: values.bank_name,
          bank_account: values.bank_account,
          ifsc: values.ifsc,
          upi_id: values.upi_id,
        }
      }
      setSelectedAgent(updated)
      load()
    } catch (e: any) {
      message.error(e.response?.data?.error || 'Failed to update agent profile')
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
      if (drawerOpen) loadAgentDetails(selectedAgent)
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
      if (selectedAgent?.id === agent.id) {
        setSelectedAgent({ ...selectedAgent, status: next })
      }
    } catch (e: any) {
      message.error(e.response?.data?.error || 'Failed to update status')
    }
  }

  const handleKycDecision = async (agentId: string, status: 'verified' | 'rejected') => {
    let notes: string | undefined = undefined
    if (status === 'rejected') {
      const promptRes = window.prompt('Enter rejection reason for agent:')
      if (promptRes === null) return
      notes = promptRes.trim() || 'Documents blurry or invalid'
    }
    try {
      await adminApi.post(`/agents/${agentId}/kyc-decision`, { status, notes })
      message.success(`Agent KYC marked as ${status.toUpperCase()}!`)
      load()
      if (selectedAgent && selectedAgent.id === agentId) {
        setSelectedAgent({ ...selectedAgent, kyc_status: status })
      }
    } catch (e: any) {
      message.error(e.response?.data?.error || 'Failed to process KYC decision')
    }
  }

  const handleAssignPlayer = async (values: any) => {
    if (!selectedAgent) return
    try {
      const res = await adminApi.post(`/agents/${selectedAgent.id}/assign-player`, {
        player_identifier: values.player_identifier,
      })
      message.success(res.data.message || 'Player assigned to agent successfully!')
      setAssignPlayerModalOpen(false)
      assignPlayerForm.resetFields()
      load()
      loadAgentDetails(selectedAgent)
    } catch (e: any) {
      message.error(e.response?.data?.error || 'Failed to assign player')
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
          {a.kyc_status === 'verified' ? <Tag color="success">KYC ✅</Tag> : null}
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

  // Filtered agents
  const filteredAgents = agents.filter(a => {
    const matchesSearch = !searchText ||
      a.username.toLowerCase().includes(searchText.toLowerCase()) ||
      a.display_name.toLowerCase().includes(searchText.toLowerCase()) ||
      a.referral_code.toLowerCase().includes(searchText.toLowerCase()) ||
      (a.phone && a.phone.includes(searchText))

    const matchesStatus = statusFilter === 'all' ||
      (statusFilter === 'active' && a.status === 'active') ||
      (statusFilter === 'suspended' && a.status === 'suspended') ||
      (statusFilter === 'kyc_pending' && (a.kyc_status === 'submitted' || a.kyc_status === 'pending')) ||
      (statusFilter === 'master' && !a.parent_agent_id) ||
      (statusFilter === 'sub' && a.parent_agent_id)

    return matchesSearch && matchesStatus
  })

  // Metric aggregates
  const totalBalance = agents.reduce((acc, a) => acc + (a.balance || 0), 0)
  const totalEarned = agents.reduce((acc, a) => acc + (a.total_earned || 0), 0)
  const totalPlayers = agents.reduce((acc, a) => acc + (a.player_count || 0), 0)
  const totalClicks = agents.reduce((acc, a) => acc + (a.click_count || 0), 0)
  const pendingPayoutsAmount = payouts.filter(p => p.status === 'created').reduce((acc, p) => acc + (Number(p.amount) || 0), 0)
  const pendingKycCount = agents.filter(a => a.kyc_status === 'submitted').length

  const agentApkDownloadUrl = `${window.location.origin}/downloads/agent-partner-release.apk`

  return (
    <div style={{ padding: '0 8px 24px' }}>
      {/* Header Bar */}
      <Row justify="space-between" align="middle" style={{ marginBottom: 16 }}>
        <Col>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Title level={4} style={{ margin: 0 }}>👥 Agent Partner & Affiliate Network</Title>
            <Tag color="gold" style={{ fontWeight: 700 }}>Top Level System</Tag>
          </div>
          <Text type="secondary">Manage agents, sub-agents hierarchy, individual game commission rates, KYC, and performance analytics</Text>
        </Col>
        <Col>
          <Space wrap>
            <Button
              type="default"
              icon={<MobileOutlined style={{ color: '#d4af37' }} />}
              onClick={() => {
                navigator.clipboard.writeText(agentApkDownloadUrl)
                message.success('Agent App APK URL copied to clipboard!')
              }}
            >
              Copy Agent APK Link
            </Button>
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
        <Col xs={12} sm={6} md={3}>
          <Card size="small" style={{ background: '#FFFFFF', borderRadius: 14, border: '1px solid #E2E8F0' }}>
            <Statistic title="Total Agents" value={agents.length} prefix={<TeamOutlined style={{ color: '#2563EB' }} />} />
          </Card>
        </Col>
        <Col xs={12} sm={6} md={3}>
          <Card size="small" style={{ background: '#FFFFFF', borderRadius: 14, border: '1px solid #E2E8F0' }}>
            <Statistic title="Referred Players" value={totalPlayers} prefix={<UserOutlined style={{ color: '#059669' }} />} />
          </Card>
        </Col>
        <Col xs={12} sm={6} md={3}>
          <Card size="small" style={{ background: '#FFFFFF', borderRadius: 14, border: '1px solid #E2E8F0' }}>
            <Statistic title="Link Clicks" value={totalClicks} prefix={<LineChartOutlined style={{ color: '#7C3AED' }} />} />
          </Card>
        </Col>
        <Col xs={12} sm={6} md={4}>
          <Card size="small" style={{ background: '#FFFFFF', borderRadius: 14, border: '1px solid #E2E8F0' }}>
            <Statistic title="Agent Balances" value={totalBalance} precision={2} prefix={<WalletOutlined style={{ color: '#D97706' }} />} suffix="₹" valueStyle={{ color: '#059669', fontWeight: 700 }} />
          </Card>
        </Col>
        <Col xs={12} sm={6} md={4}>
          <Card size="small" style={{ background: '#FFFFFF', borderRadius: 14, border: '1px solid #E2E8F0' }}>
            <Statistic title="Total Paid Out" value={totalEarned} precision={2} prefix={<DollarOutlined style={{ color: '#0284C7' }} />} suffix="₹" />
          </Card>
        </Col>
        <Col xs={12} sm={6} md={3}>
          <Card size="small" style={{ background: '#FFFFFF', borderRadius: 14, border: '1px solid #E2E8F0' }}>
            <Statistic
              title="KYC Pending"
              value={pendingKycCount}
              valueStyle={{ color: pendingKycCount > 0 ? '#D97706' : undefined, fontWeight: 700 }}
              prefix={<AuditOutlined />}
            />
          </Card>
        </Col>
        <Col xs={12} sm={6} md={4}>
          <Card size="small" style={{ background: '#FFFFFF', borderRadius: 14, border: '1px solid #E2E8F0' }}>
            <Statistic
              title="Pending Payouts"
              value={pendingPayoutsAmount}
              precision={2}
              valueStyle={{ color: pendingPayoutsAmount > 0 ? '#E11D48' : undefined }}
              prefix={<HistoryOutlined />}
              suffix="₹"
            />
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
              <div>
                {/* Search & Filter Bar */}
                <Row gutter={[12, 12]} style={{ marginBottom: 16 }} align="middle">
                  <Col xs={24} md={10}>
                    <Input
                      placeholder="Search by Agent name, username, phone, or code..."
                      prefix={<SearchOutlined />}
                      value={searchText}
                      onChange={e => setSearchText(e.target.value)}
                      allowClear
                    />
                  </Col>
                  <Col xs={24} md={14} style={{ textAlign: 'right' }}>
                    <Space wrap>
                      <Select value={statusFilter} onChange={setStatusFilter} style={{ width: 170 }}>
                        <Select.Option value="all">All Agents</Select.Option>
                        <Select.Option value="active">Active Only</Select.Option>
                        <Select.Option value="suspended">Suspended Only</Select.Option>
                        <Select.Option value="master">Master Agents Only</Select.Option>
                        <Select.Option value="sub">Sub-Agents Only</Select.Option>
                        <Select.Option value="kyc_pending">KYC Pending / Review</Select.Option>
                      </Select>
                    </Space>
                  </Col>
                </Row>

                <Table
                  dataSource={filteredAgents}
                  rowKey="id"
                  loading={loading}
                  pagination={{ pageSize: 12 }}
                  columns={[
                    {
                      title: 'Agent Profile',
                      render: (_: any, r: Agent) => (
                        <div
                          style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}
                          onClick={() => navigate(`/admin/agents/${r.id}`)}
                        >
                          <Avatar style={{ backgroundColor: r.status === 'active' ? '#1890ff' : '#ff4d4f' }}>
                            {r.display_name?.charAt(0)?.toUpperCase() || 'A'}
                          </Avatar>
                          <div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <Text strong style={{ fontSize: 14 }}>{r.display_name}</Text>
                              {r.status === 'suspended' && <Tag color="error">SUSPENDED</Tag>}
                            </div>
                            <div>
                              <Text type="secondary" style={{ fontSize: 12 }}>
                                @{r.username} {r.phone ? `· ${r.phone}` : ''}
                              </Text>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
                              <Tag color="cyan" style={{ margin: 0, fontSize: 11 }}>Code: {r.referral_code}</Tag>
                              {r.kyc_status === 'verified' && <Tag color="success" style={{ margin: 0, fontSize: 10 }}>KYC ✅</Tag>}
                              {r.kyc_status === 'submitted' && <Tag color="warning" style={{ margin: 0, fontSize: 10 }}>KYC Review ⏳</Tag>}
                            </div>
                          </div>
                        </div>
                      )
                    },
                    {
                      title: 'Role & Parent',
                      render: (_: any, r: Agent) => {
                        if (!r.parent_agent_id) return <Tag color="gold" style={{ fontWeight: 700 }}>👑 Master Agent</Tag>
                        const p = agents.find(a => a.id === r.parent_agent_id)
                        return (
                          <div>
                            <Tag color="blue">Sub-Agent</Tag>
                            <div><Text type="secondary" style={{ fontSize: 11 }}>Parent: {p?.display_name || r.parent_agent_id.slice(0, 8)}</Text></div>
                          </div>
                        )
                      }
                    },
                    {
                      title: 'Traffic & Players',
                      render: (_: any, r: Agent) => (
                        <div>
                          <div><Text strong>{r.player_count}</Text> <Text type="secondary">players</Text></div>
                          <div><Text type="secondary" style={{ fontSize: 11 }}>{r.click_count || 0} link clicks</Text></div>
                          {r.sub_agent_count ? <div><Text type="secondary" style={{ fontSize: 11 }}>{r.sub_agent_count} downlines</Text></div> : null}
                        </div>
                      )
                    },
                    {
                      title: 'Default Rate',
                      dataIndex: 'commission_rate',
                      render: (v: number) => <Tag color="orange" style={{ fontWeight: 700 }}>{Number(v).toFixed(1)}%</Tag>
                    },
                    {
                      title: 'Game Rates',
                      render: (_: any, r: Agent) => {
                        const gc = typeof r.game_commissions === 'string' ? JSON.parse(r.game_commissions) : (r.game_commissions || {})
                        const count = Object.keys(gc).length
                        return (
                          <Space wrap>
                            {count > 0 ? (
                              SUPPORTED_GAMES.slice(0, 3).map(g => gc[g.key] !== undefined ? (
                                <Tag key={g.key} color="purple" style={{ fontSize: 10 }}>
                                  {g.icon} {gc[g.key]}%
                                </Tag>
                              ) : null)
                            ) : (
                              <Text type="secondary" style={{ fontSize: 11 }}>{r.commission_rate}% uniform</Text>
                            )}
                            {count > 3 && <Tag color="default" style={{ fontSize: 10 }}>+{count - 3} games</Tag>}
                          </Space>
                        )
                      }
                    },
                    {
                      title: 'Balance & Earned',
                      render: (_: any, r: Agent) => (
                        <div>
                          <div><Text strong style={{ color: '#059669', fontSize: 13 }}>₹ {Number(r.balance).toFixed(2)}</Text></div>
                          <div><Text type="secondary" style={{ fontSize: 11 }}>Earned: ₹{Number(r.total_earned).toFixed(2)}</Text></div>
                        </div>
                      )
                    },
                    {
                      title: 'Actions',
                      render: (_: any, r: Agent) => (
                        <Space wrap size="small">
                          <Button size="small" type="primary" icon={<EyeOutlined />} onClick={() => navigate(`/admin/agents/${r.id}`)}>
                            Full Profile
                          </Button>
                          <Button size="small" icon={<UserAddOutlined />} onClick={() => {
                            setSelectedAgent(r)
                            assignPlayerForm.resetFields()
                            setAssignPlayerModalOpen(true)
                          }}>
                            Assign Player
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
                            Rates
                          </Button>
                          <Button size="small" icon={<DollarOutlined />} onClick={() => {
                            setSelectedAgent(r)
                            balanceForm.resetFields()
                            setBalanceModalOpen(true)
                          }}>
                            Adjust ₹
                          </Button>
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
              </div>
            )
          },
          {
            key: 'kyc_approvals',
            label: (
              <span>
                <AuditOutlined /> KYC Verification Queue {pendingKycCount > 0 ? <Badge count={pendingKycCount} size="small" style={{ marginLeft: 4 }} /> : null}
              </span>
            ),
            children: (
              <Table
                dataSource={agents.filter(a => a.kyc_status === 'submitted' || a.kyc_status === 'verified')}
                rowKey="id"
                pagination={{ pageSize: 10 }}
                columns={[
                  {
                    title: 'Agent',
                    render: (_: any, r: Agent) => (
                      <div>
                        <Text strong>{r.display_name}</Text>
                        <div><Text type="secondary">@{r.username} · {r.phone || 'No phone'}</Text></div>
                        <Tag color="cyan">Code: {r.referral_code}</Tag>
                      </div>
                    )
                  },
                  {
                    title: 'Document Type',
                    render: (_: any, r: Agent) => (
                      <Tag color="blue">{(r.kyc_data?.document_type || 'ID Proof').toUpperCase()}</Tag>
                    )
                  },
                  {
                    title: 'Document Number',
                    render: (_: any, r: Agent) => <Text code>{r.kyc_data?.document_number || '—'}</Text>
                  },
                  {
                    title: 'Submitted At',
                    render: (_: any, r: Agent) => (
                      r.kyc_data?.submitted_at ? dayjs(r.kyc_data.submitted_at).format('DD MMM YYYY hh:mm A') : '—'
                    )
                  },
                  {
                    title: 'Status',
                    render: (_: any, r: Agent) => {
                      const st = r.kyc_status || 'pending'
                      return (
                        <Tag color={st === 'verified' ? 'green' : st === 'submitted' ? 'orange' : st === 'rejected' ? 'red' : 'default'}>
                          {st.toUpperCase()}
                        </Tag>
                      )
                    }
                  },
                  {
                    title: 'Actions',
                    render: (_: any, r: Agent) => (
                      <Space>
                        <Button size="small" type="primary" ghost icon={<EyeOutlined />} onClick={() => navigate(`/admin/agents/${r.id}`)}>
                          Inspect Full Profile
                        </Button>
                        {r.kyc_status === 'submitted' && (
                          <>
                            <Button size="small" type="primary" style={{ background: '#52c41a', borderColor: '#52c41a' }} icon={<CheckOutlined />} onClick={() => handleKycDecision(r.id, 'verified')}>
                              Approve
                            </Button>
                            <Button size="small" danger icon={<CloseOutlined />} onClick={() => handleKycDecision(r.id, 'rejected')}>
                              Reject
                            </Button>
                          </>
                        )}
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

      {/* Modal: Edit Agent Profile & Bank Details */}
      <Modal title={`Edit Profile: ${selectedAgent?.display_name}`} open={editProfileModalOpen} onCancel={() => setEditProfileModalOpen(false)} footer={null} width={620}>
        <Form form={editProfileForm} layout="vertical" onFinish={handleUpdateProfile}>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="display_name" label="Display Name" rules={[{ required: true }]}>
                <Input />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="phone" label="Phone Number">
                <Input />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="email" label="Email Address">
            <Input type="email" placeholder="agent@example.com" />
          </Form.Item>

          <Divider orientation="left">🏦 Bank & Settlement Details</Divider>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="account_holder" label="Account Holder Name">
                <Input placeholder="As per bank passbook" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="bank_name" label="Bank Name">
                <Input placeholder="e.g. HDFC / SBI" />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="bank_account" label="Account Number">
                <Input placeholder="Bank Account Number" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="ifsc" label="IFSC Code">
                <Input placeholder="e.g. HDFC0001234" />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="upi_id" label="UPI ID / VPA">
            <Input placeholder="e.g. mobile@upi" />
          </Form.Item>

          <Button type="primary" htmlType="submit" block size="large">Save Profile & Bank Details</Button>
        </Form>
      </Modal>

      {/* Modal: Assign Player to Agent */}
      <Modal title={`Assign Player to ${selectedAgent?.display_name}`} open={assignPlayerModalOpen} onCancel={() => setAssignPlayerModalOpen(false)} footer={null}>
        <Alert
          type="info"
          showIcon
          message="Manual Player Attribution"
          description="Enter the player's username, mobile number, or User UUID. The player will be linked to this agent, attributing all future turnover and commissions to them."
          style={{ marginBottom: 16 }}
        />
        <Form form={assignPlayerForm} layout="vertical" onFinish={handleAssignPlayer}>
          <Form.Item name="player_identifier" label="Player Username, Phone Number, or ID" rules={[{ required: true, message: 'Please enter player identifier' }]}>
            <Input placeholder="e.g. player_rahul or 9876543210" prefix={<UserOutlined />} />
          </Form.Item>
          <Button type="primary" htmlType="submit" block size="large">Assign Player Now</Button>
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

      {/* Drawer: Detailed Agent Complete Profile & Comprehensive Analytics */}
      <Drawer
        title={
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', paddingRight: 24 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <Avatar size="large" style={{ backgroundColor: selectedAgent?.status === 'active' ? '#1890ff' : '#ff4d4f' }}>
                {selectedAgent?.display_name?.charAt(0)?.toUpperCase() || 'A'}
              </Avatar>
              <div>
                <Text strong style={{ fontSize: 16 }}>{selectedAgent?.display_name}</Text>
                <div>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    @{selectedAgent?.username} · {selectedAgent?.phone || 'No phone'}
                  </Text>
                </div>
              </div>
            </div>
            <Space>
              <Button size="small" icon={<EditOutlined />} onClick={() => {
                if (!selectedAgent) return
                editProfileForm.setFieldsValue({
                  display_name: selectedAgent.display_name,
                  phone: selectedAgent.phone,
                  email: selectedAgent.email,
                  account_holder: selectedAgent.bank_details?.account_holder,
                  bank_name: selectedAgent.bank_details?.bank_name,
                  bank_account: selectedAgent.bank_details?.bank_account,
                  ifsc: selectedAgent.bank_details?.ifsc,
                  upi_id: selectedAgent.bank_details?.upi_id,
                })
                setEditProfileModalOpen(true)
              }}>
                Edit Profile
              </Button>
              <Button size="small" type="primary" icon={<UserAddOutlined />} onClick={() => {
                assignPlayerForm.resetFields()
                setAssignPlayerModalOpen(true)
              }}>
                Assign Player
              </Button>
            </Space>
          </div>
        }
        width={820}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
      >
        {selectedAgent && (
          <div>
            {/* Top Quick Stats Card */}
            <Card style={{ marginBottom: 16, background: '#F8FAFC', borderRadius: 12 }}>
              <Row gutter={16}>
                <Col span={6}>
                  <Statistic title="Wallet Balance" value={selectedAgent.balance} precision={2} prefix="₹" valueStyle={{ color: '#059669', fontWeight: 700 }} />
                </Col>
                <Col span={6}>
                  <Statistic title="Total Earned" value={selectedAgent.total_earned} precision={2} prefix="₹" />
                </Col>
                <Col span={6}>
                  <Statistic title="Referred Players" value={selectedAgent.player_count} prefix={<UserOutlined />} />
                </Col>
                <Col span={6}>
                  <Statistic title="Referral Clicks" value={selectedAgent.click_count || 0} prefix={<LineChartOutlined />} />
                </Col>
              </Row>
              <Divider style={{ margin: '12px 0' }} />
              <Row justify="space-between" align="middle">
                <Col>
                  <Text type="secondary">Referral Code: </Text>
                  <Text strong copyable>{selectedAgent.referral_code}</Text>
                  <Text type="secondary" style={{ marginLeft: 16 }}>Player Link: </Text>
                  <Text strong copyable>{`https://game.myonlinejoker.com/?ref=${selectedAgent.referral_code}`}</Text>
                </Col>
                <Col>
                  <Tag color={selectedAgent.status === 'active' ? 'green' : 'red'}>{selectedAgent.status.toUpperCase()}</Tag>
                  <Tag color={selectedAgent.parent_agent_id ? 'blue' : 'gold'}>
                    {selectedAgent.parent_agent_id ? 'SUB-AGENT' : 'MASTER AGENT'}
                  </Tag>
                  {selectedAgent.kyc_status === 'verified' && <Tag color="success">KYC VERIFIED</Tag>}
                  {selectedAgent.kyc_status === 'submitted' && <Tag color="warning">KYC SUBMITTED</Tag>}
                </Col>
              </Row>
            </Card>

            <Tabs items={[
              {
                key: 'analytics',
                label: <span><LineChartOutlined /> Traffic & Conversion Analytics</span>,
                children: (
                  <div>
                    {/* Funnel & Conversion Rates */}
                    <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
                      <Col span={6}>
                        <Card size="small">
                          <Statistic title="Total Clicks" value={agentAnalytics?.summary?.total_clicks ?? selectedAgent.click_count ?? 0} />
                        </Card>
                      </Col>
                      <Col span={6}>
                        <Card size="small">
                          <Statistic title="Total Signups" value={agentAnalytics?.summary?.total_players ?? selectedAgent.player_count} />
                        </Card>
                      </Col>
                      <Col span={6}>
                        <Card size="small">
                          <Statistic
                            title="Click-to-Signup Rate"
                            value={agentAnalytics?.summary?.conversion_rate ?? 0}
                            precision={2}
                            suffix="%"
                            valueStyle={{ color: '#2563EB', fontWeight: 700 }}
                          />
                        </Card>
                      </Col>
                      <Col span={6}>
                        <Card size="small">
                          <Statistic
                            title="Depositing Players"
                            value={agentAnalytics?.summary?.depositing_players ?? 0}
                            valueStyle={{ color: '#059669', fontWeight: 700 }}
                          />
                        </Card>
                      </Col>
                    </Row>

                    {/* Financial Performance */}
                    <Card title="Player Revenue & Financials" size="small" style={{ marginBottom: 16 }}>
                      <Row gutter={16}>
                        <Col span={8}>
                          <Statistic
                            title="Total Betting Turnover"
                            value={agentAnalytics?.summary?.total_turnover ?? 0}
                            precision={2}
                            prefix="₹"
                          />
                        </Col>
                        <Col span={8}>
                          <Statistic
                            title="Net House Win / GGR"
                            value={agentAnalytics?.summary?.net_ggr ?? 0}
                            precision={2}
                            prefix="₹"
                            valueStyle={{ color: (agentAnalytics?.summary?.net_ggr ?? 0) >= 0 ? '#059669' : '#E11D48' }}
                          />
                        </Col>
                        <Col span={8}>
                          <Statistic
                            title="Total Commission Paid"
                            value={selectedAgent.total_paid_out ?? 0}
                            precision={2}
                            prefix="₹"
                          />
                        </Col>
                      </Row>
                    </Card>

                    {/* Traffic Sources & Devices */}
                    <Row gutter={16} style={{ marginBottom: 16 }}>
                      <Col span={12}>
                        <Card title="Traffic Sources (UTM / Referrers)" size="small">
                          {agentAnalytics?.sources?.length > 0 ? (
                            <Table
                              dataSource={agentAnalytics.sources}
                              rowKey="source"
                              size="small"
                              pagination={false}
                              columns={[
                                { title: 'Source', dataIndex: 'source' },
                                { title: 'Clicks', dataIndex: 'count' },
                              ]}
                            />
                          ) : (
                            <Text type="secondary">No UTM campaign sources recorded yet.</Text>
                          )}
                        </Card>
                      </Col>
                      <Col span={12}>
                        <Card title="Device Types" size="small">
                          {agentAnalytics?.devices?.length > 0 ? (
                            agentAnalytics.devices.map((d: any) => (
                              <div key={d.device} style={{ marginBottom: 10 }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                                  <Text strong>{d.device?.toUpperCase()}</Text>
                                  <Text type="secondary">{d.count} clicks</Text>
                                </div>
                                <Progress
                                  percent={Math.round((d.count / (agentAnalytics.summary.total_clicks || 1)) * 100)}
                                  size="small"
                                />
                              </div>
                            ))
                          ) : (
                            <Text type="secondary">No device data available yet.</Text>
                          )}
                        </Card>
                      </Col>
                    </Row>
                  </div>
                )
              },
              {
                key: 'profile_details',
                label: <span><IdcardOutlined /> Profile & Bank Details</span>,
                children: (
                  <div>
                    {/* Bank & Settlement Card */}
                    <Card
                      title={<span><BankOutlined /> Bank & UPI Settlement Information</span>}
                      size="small"
                      style={{ marginBottom: 16 }}
                      extra={
                        <Button size="small" icon={<EditOutlined />} onClick={() => {
                          editProfileForm.setFieldsValue({
                            display_name: selectedAgent.display_name,
                            phone: selectedAgent.phone,
                            email: selectedAgent.email,
                            account_holder: selectedAgent.bank_details?.account_holder,
                            bank_name: selectedAgent.bank_details?.bank_name,
                            bank_account: selectedAgent.bank_details?.bank_account,
                            ifsc: selectedAgent.bank_details?.ifsc,
                            upi_id: selectedAgent.bank_details?.upi_id,
                          })
                          setEditProfileModalOpen(true)
                        }}>
                          Edit Bank Info
                        </Button>
                      }
                    >
                      <Row gutter={[16, 12]}>
                        <Col span={12}>
                          <Text type="secondary">Account Holder Name:</Text>
                          <div><Text strong>{selectedAgent.bank_details?.account_holder || 'Not provided'}</Text></div>
                        </Col>
                        <Col span={12}>
                          <Text type="secondary">Bank Name:</Text>
                          <div><Text strong>{selectedAgent.bank_details?.bank_name || 'Not provided'}</Text></div>
                        </Col>
                        <Col span={12}>
                          <Text type="secondary">Bank Account Number:</Text>
                          <div><Text strong>{selectedAgent.bank_details?.bank_account || 'Not provided'}</Text></div>
                        </Col>
                        <Col span={12}>
                          <Text type="secondary">IFSC Code:</Text>
                          <div><Text strong>{selectedAgent.bank_details?.ifsc || 'Not provided'}</Text></div>
                        </Col>
                        <Col span={12}>
                          <Text type="secondary">UPI ID / VPA:</Text>
                          <div><Tag color="cyan">{selectedAgent.bank_details?.upi_id || 'Not provided'}</Tag></div>
                        </Col>
                        <Col span={12}>
                          <Text type="secondary">Contact Email:</Text>
                          <div><Text strong>{selectedAgent.email || 'Not provided'}</Text></div>
                        </Col>
                      </Row>
                    </Card>

                    {/* KYC Verification Card */}
                    <Card
                      title={<span><AuditOutlined /> KYC Verification Status</span>}
                      size="small"
                      style={{ marginBottom: 16 }}
                      extra={
                        <Space>
                          {selectedAgent.kyc_status === 'submitted' && (
                            <>
                              <Button size="small" type="primary" style={{ background: '#52c41a', borderColor: '#52c41a' }} icon={<CheckOutlined />} onClick={() => handleKycDecision(selectedAgent.id, 'verified')}>
                                Approve KYC
                              </Button>
                              <Button size="small" danger icon={<CloseOutlined />} onClick={() => handleKycDecision(selectedAgent.id, 'rejected')}>
                                Reject KYC
                              </Button>
                            </>
                          )}
                        </Space>
                      }
                    >
                      <Row gutter={[16, 12]}>
                        <Col span={8}>
                          <Text type="secondary">KYC Status:</Text>
                          <div>
                            <Tag color={selectedAgent.kyc_status === 'verified' ? 'green' : selectedAgent.kyc_status === 'submitted' ? 'orange' : selectedAgent.kyc_status === 'rejected' ? 'red' : 'default'}>
                              {(selectedAgent.kyc_status || 'pending').toUpperCase()}
                            </Tag>
                          </div>
                        </Col>
                        <Col span={8}>
                          <Text type="secondary">Document Type:</Text>
                          <div><Text strong>{(selectedAgent.kyc_data?.document_type || '—').toUpperCase()}</Text></div>
                        </Col>
                        <Col span={8}>
                          <Text type="secondary">Document Number:</Text>
                          <div><Text code>{selectedAgent.kyc_data?.document_number || '—'}</Text></div>
                        </Col>
                        <Col span={12}>
                          <Text type="secondary">Submitted Date:</Text>
                          <div><Text>{selectedAgent.kyc_data?.submitted_at ? dayjs(selectedAgent.kyc_data.submitted_at).format('DD MMM YYYY hh:mm A') : '—'}</Text></div>
                        </Col>
                        <Col span={12}>
                          <Text type="secondary">Admin Review Notes:</Text>
                          <div><Text>{selectedAgent.kyc_data?.admin_notes || '—'}</Text></div>
                        </Col>
                      </Row>
                    </Card>

                    {/* Security Actions */}
                    <Card title="Security & Quick Controls" size="small">
                      <Space wrap>
                        <Button icon={<KeyOutlined />} onClick={() => {
                          resetPassForm.resetFields()
                          setResetPassModalOpen(true)
                        }}>
                          Reset Agent Password
                        </Button>
                        <Button icon={<DollarOutlined />} onClick={() => {
                          balanceForm.resetFields()
                          setBalanceModalOpen(true)
                        }}>
                          Adjust Wallet Balance
                        </Button>
                        <Popconfirm title={`${selectedAgent.status === 'active' ? 'Suspend' : 'Reactivate'} this agent?`} onConfirm={() => handleToggleStatus(selectedAgent)}>
                          <Button danger={selectedAgent.status === 'active'}>
                            {selectedAgent.status === 'active' ? 'Suspend Agent Account' : 'Reactivate Agent Account'}
                          </Button>
                        </Popconfirm>
                      </Space>
                    </Card>
                  </div>
                )
              },
              {
                key: 'players',
                label: `Referred Players (${agentPlayers.length})`,
                children: (
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
                      <Text type="secondary">All registered players credited under this agent's referral attribution.</Text>
                      <Button type="primary" size="small" icon={<UserAddOutlined />} onClick={() => {
                        assignPlayerForm.resetFields()
                        setAssignPlayerModalOpen(true)
                      }}>
                        Assign New Player
                      </Button>
                    </div>
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
                  </div>
                )
              },
              {
                key: 'sub_agents',
                label: `Downline Sub-Agents (${agentAnalytics?.sub_agents?.length || 0})`,
                children: (
                  <div>
                    <Table
                      dataSource={agentAnalytics?.sub_agents || []}
                      rowKey="id"
                      pagination={false}
                      locale={{ emptyText: 'No sub-agents under this agent.' }}
                      columns={[
                        {
                          title: 'Sub-Agent',
                          render: (_: any, r: any) => (
                            <div>
                              <Text strong>{r.display_name}</Text>
                              <div><Text type="secondary">@{r.username}</Text></div>
                            </div>
                          )
                        },
                        {
                          title: 'Sub-Agent Rate',
                          dataIndex: 'commission_rate',
                          render: (v: any) => <Tag color="blue">{v}%</Tag>
                        },
                        {
                          title: 'Players',
                          dataIndex: 'player_count'
                        },
                        {
                          title: 'Balance (₹)',
                          dataIndex: 'balance',
                          render: (v: any) => `₹ ${Number(v).toFixed(2)}`
                        },
                        {
                          title: 'Override Earned (₹)',
                          dataIndex: 'override_earned',
                          render: (v: any) => <Text strong style={{ color: '#059669' }}>₹ {Number(v).toFixed(2)}</Text>
                        }
                      ]}
                    />
                  </div>
                )
              },
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
