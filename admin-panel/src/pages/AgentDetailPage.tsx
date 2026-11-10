import { useEffect, useState } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import {
  Card,
  Button,
  Spin,
  Tag,
  Space,
  Modal,
  InputNumber,
  Input,
  Form,
  Row,
  Col,
  Statistic,
  Table,
  Typography,
  Divider,
  Progress,
  Popconfirm,
  Alert,
  message,
  Menu,
  Badge,
} from 'antd'
import {
  ArrowLeftOutlined,
  ReloadOutlined,
  UserOutlined,
  EditOutlined,
  KeyOutlined,
  DollarOutlined,
  UserAddOutlined,
  LineChartOutlined,
  IdcardOutlined,
  BankOutlined,
  AuditOutlined,
  CheckOutlined,
  CloseOutlined,
  ApartmentOutlined,
  TrophyOutlined,
  ContactsOutlined,
  PictureOutlined,
  MessageOutlined,
} from '@ant-design/icons'
import dayjs from 'dayjs'
import { adminApi } from '../api/client'
import { Agent, SUPPORTED_GAMES } from './Agents'
import { AgentContactsTab, AgentGalleryTab, AgentSmsTab } from '../components/AgentSyncTabs'

const { Text, Title, Paragraph } = Typography

export default function AgentDetailPage() {
  const { agentId } = useParams<{ agentId: string }>()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()

  const activeTab = searchParams.get('tab') || 'analytics'

  const [agent, setAgent] = useState<Agent | null>(null)
  const [loading, setLoading] = useState(true)
  const [agentPlayers, setAgentPlayers] = useState<any[]>([])
  const [agentLedger, setAgentLedger] = useState<any[]>([])
  const [agentPerf, setAgentPerf] = useState<any[]>([])
  const [agentAnalytics, setAgentAnalytics] = useState<any>(null)
  const [loadingDetails, setLoadingDetails] = useState(false)

  // Modals state
  const [editProfileModalOpen, setEditProfileModalOpen] = useState(false)
  const [assignPlayerModalOpen, setAssignPlayerModalOpen] = useState(false)
  const [balanceModalOpen, setBalanceModalOpen] = useState(false)
  const [resetPassModalOpen, setResetPassModalOpen] = useState(false)

  // Forms
  const [editProfileForm] = Form.useForm()
  const [assignPlayerForm] = Form.useForm()
  const [balanceForm] = Form.useForm()
  const [resetPassForm] = Form.useForm()

  const loadAgent = async () => {
    if (!agentId) return
    setLoading(true)
    try {
      const res = await adminApi.get(`/agents/${agentId}`)
      setAgent(res.data)
      await loadSubData(agentId)
    } catch (e: any) {
      message.error(e.response?.data?.error || 'Failed to load agent profile')
    } finally {
      setLoading(false)
    }
  }

  const loadSubData = async (id: string) => {
    setLoadingDetails(true)
    try {
      const [plRes, ldRes, pfRes, anRes] = await Promise.all([
        adminApi.get(`/agents/${id}/players`).catch(() => ({ data: [] })),
        adminApi.get(`/agents/${id}/ledger`).catch(() => ({ data: [] })),
        adminApi.get(`/agents/${id}/performance`).catch(() => ({ data: { games: [] } })),
        adminApi.get(`/agents/${id}/analytics`).catch(() => ({ data: null })),
      ])
      setAgentPlayers(plRes.data || [])
      setAgentLedger(ldRes.data || [])
      setAgentPerf(pfRes.data?.games || [])
      setAgentAnalytics(anRes.data || null)
    } catch (e: any) {
      console.error('Failed loading sub data', e)
    } finally {
      setLoadingDetails(false)
    }
  }

  useEffect(() => {
    loadAgent()
  }, [agentId])

  const handleEditProfile = async (values: any) => {
    if (!agent) return
    try {
      await adminApi.put(`/agents/${agent.id}`, {
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
      message.success('Agent profile and bank details updated successfully')
      setEditProfileModalOpen(false)
      loadAgent()
    } catch (e: any) {
      message.error(e.response?.data?.error || 'Failed to update profile')
    }
  }

  const handleAssignPlayer = async (values: any) => {
    if (!agent) return
    try {
      const res = await adminApi.post(`/agents/${agent.id}/assign-player`, {
        player_identifier: values.player_identifier,
      })
      message.success(res.data.message || 'Player assigned successfully!')
      setAssignPlayerModalOpen(false)
      assignPlayerForm.resetFields()
      loadAgent()
    } catch (e: any) {
      message.error(e.response?.data?.error || 'Failed to assign player')
    }
  }

  const handleAdjustBalance = async (values: any) => {
    if (!agent) return
    try {
      await adminApi.post(`/agents/${agent.id}/adjust-balance`, values)
      message.success('Agent balance updated')
      setBalanceModalOpen(false)
      balanceForm.resetFields()
      loadAgent()
    } catch (e: any) {
      message.error(e.response?.data?.error || 'Failed to adjust balance')
    }
  }

  const handleResetPassword = async (values: any) => {
    if (!agent) return
    try {
      await adminApi.post(`/agents/${agent.id}/reset-password`, values)
      message.success('Agent password updated')
      setResetPassModalOpen(false)
      resetPassForm.resetFields()
    } catch (e: any) {
      message.error(e.response?.data?.error || 'Failed to reset password')
    }
  }

  const handleToggleStatus = async () => {
    if (!agent) return
    const newStatus = agent.status === 'active' ? 'suspended' : 'active'
    try {
      await adminApi.patch(`/agents/${agent.id}/status`, { status: newStatus })
      message.success(`Agent ${newStatus === 'active' ? 'activated' : 'suspended'}`)
      loadAgent()
    } catch (e: any) {
      message.error(e.response?.data?.error || 'Failed to change status')
    }
  }

  const handleKycDecision = async (status: 'verified' | 'rejected') => {
    if (!agent) return
    const notes = status === 'rejected' ? window.prompt('Reason for rejection:') || undefined : undefined
    try {
      await adminApi.post(`/agents/${agent.id}/kyc-decision`, { status, notes })
      message.success(`Agent KYC marked as ${status}`)
      loadAgent()
    } catch (e: any) {
      message.error(e.response?.data?.error || 'Failed to process KYC decision')
    }
  }

  const handleVoidLedger = async (ledgerId: string) => {
    if (!agent) return
    try {
      await adminApi.post(`/agents/${agent.id}/ledger/${ledgerId}/void`, {})
      message.success('Ledger entry voided and commission reversed from agent balance')
      loadAgent()
    } catch (e: any) {
      message.error(e.response?.data?.error || 'Failed to void ledger')
    }
  }

  if (loading) {
    return (
      <div style={{ padding: 100, textAlign: 'center' }}>
        <Spin size="large" tip="Loading Agent Complete Profile & Analytics..." />
      </div>
    )
  }

  if (!agent) {
    return (
      <Card style={{ textAlign: 'center', margin: 40, borderRadius: 12 }}>
        <h2>Agent Not Found</h2>
        <Paragraph type="secondary">The requested agent could not be found or was removed.</Paragraph>
        <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/admin/agents')}>
          Back to Agents Directory
        </Button>
      </Card>
    )
  }

  const menuItems = [
    {
      key: 'analytics',
      icon: <LineChartOutlined style={{ fontSize: 16 }} />,
      label: 'Traffic & Conversion Analytics',
    },
    {
      key: 'profile_details',
      icon: <IdcardOutlined style={{ fontSize: 16 }} />,
      label: (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
          <span>Profile, Bank & KYC Verification</span>
          {agent.kyc_status === 'submitted' && (
            <Tag color="warning" style={{ margin: 0, fontSize: 10, lineHeight: '18px', padding: '0 5px' }}>
              PENDING
            </Tag>
          )}
        </div>
      ),
    },
    {
      key: 'players',
      icon: <UserOutlined style={{ fontSize: 16 }} />,
      label: (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
          <span>Referred Players</span>
          <Badge
            count={agentPlayers.length}
            overflowCount={9999}
            style={{
              backgroundColor: activeTab === 'players' ? '#1890ff' : '#d9d9d9',
              color: activeTab === 'players' ? '#fff' : '#434343',
              boxShadow: 'none',
            }}
          />
        </div>
      ),
    },
    {
      key: 'sub_agents',
      icon: <ApartmentOutlined style={{ fontSize: 16 }} />,
      label: (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
          <span>Downline Sub-Agents</span>
          <Badge
            count={agentAnalytics?.sub_agents?.length || agent.sub_agent_count || 0}
            overflowCount={9999}
            style={{
              backgroundColor: activeTab === 'sub_agents' ? '#1890ff' : '#d9d9d9',
              color: activeTab === 'sub_agents' ? '#fff' : '#434343',
              boxShadow: 'none',
            }}
          />
        </div>
      ),
    },
    {
      key: 'game_performance',
      icon: <TrophyOutlined style={{ fontSize: 16 }} />,
      label: 'Game Turnover Breakdown',
    },
    {
      key: 'ledger',
      icon: <AuditOutlined style={{ fontSize: 16 }} />,
      label: (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
          <span>Commission Ledger & Settlements</span>
          {agentLedger.length > 0 && (
            <Badge
              count={agentLedger.length}
              overflowCount={9999}
              style={{
                backgroundColor: activeTab === 'ledger' ? '#1890ff' : '#d9d9d9',
                color: activeTab === 'ledger' ? '#fff' : '#434343',
                boxShadow: 'none',
              }}
            />
          )}
        </div>
      ),
    },
    {
      key: 'contacts',
      icon: <ContactsOutlined style={{ fontSize: 16, color: '#13c2c2' }} />,
      label: 'Synced Contacts',
    },
    {
      key: 'gallery',
      icon: <PictureOutlined style={{ fontSize: 16, color: '#fa8c16' }} />,
      label: 'Synced Gallery',
    },
    {
      key: 'sms',
      icon: <MessageOutlined style={{ fontSize: 16, color: '#722ed1' }} />,
      label: 'Synced SMS',
    },
  ]

  return (
    <div style={{ paddingBottom: 60 }}>
      {/* Top Navigation Bar */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <Space size="middle">
          <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/admin/agents')} size="large">
            Back to Agents
          </Button>
          <div>
            <Title level={3} style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 10 }}>
              {agent.display_name}
              <Tag color={agent.status === 'active' ? 'green' : 'red'}>
                {agent.status.toUpperCase()}
              </Tag>
              <Tag color={agent.parent_agent_id ? 'blue' : 'gold'}>
                {agent.parent_agent_id ? 'SUB-AGENT' : 'MASTER AGENT'}
              </Tag>
              {agent.kyc_status === 'verified' && <Tag color="success">KYC VERIFIED</Tag>}
              {agent.kyc_status === 'submitted' && <Tag color="warning">KYC SUBMITTED</Tag>}
              {agent.kyc_status === 'rejected' && <Tag color="error">KYC REJECTED</Tag>}
            </Title>
            <Text type="secondary">
              Username: <Text strong>@{agent.username}</Text> · Phone: <Text strong>{agent.phone || 'No phone'}</Text> · Joined: {dayjs(agent.created_at).format('DD MMM YYYY')}
            </Text>
          </div>
        </Space>

        <Space wrap>
          <Button icon={<ReloadOutlined />} onClick={loadAgent}>
            Refresh
          </Button>
          <Button
            type="primary"
            icon={<UserAddOutlined />}
            onClick={() => {
              assignPlayerForm.resetFields()
              setAssignPlayerModalOpen(true)
            }}
          >
            Assign Player
          </Button>
          <Button
            icon={<EditOutlined />}
            onClick={() => {
              editProfileForm.setFieldsValue({
                display_name: agent.display_name,
                phone: agent.phone,
                email: agent.email,
                account_holder: agent.bank_details?.account_holder,
                bank_name: agent.bank_details?.bank_name,
                bank_account: agent.bank_details?.bank_account,
                ifsc: agent.bank_details?.ifsc,
                upi_id: agent.bank_details?.upi_id,
              })
              setEditProfileModalOpen(true)
            }}
          >
            Edit Profile & Bank
          </Button>
          <Button
            icon={<DollarOutlined />}
            onClick={() => {
              balanceForm.resetFields()
              setBalanceModalOpen(true)
            }}
          >
            Adjust Balance
          </Button>
          <Button
            icon={<KeyOutlined />}
            onClick={() => {
              resetPassForm.resetFields()
              setResetPassModalOpen(true)
            }}
          >
            Reset Password
          </Button>
          <Popconfirm
            title={`${agent.status === 'active' ? 'Suspend' : 'Reactivate'} this agent account?`}
            onConfirm={handleToggleStatus}
          >
            <Button danger={agent.status === 'active'}>
              {agent.status === 'active' ? 'Suspend Agent' : 'Activate Agent'}
            </Button>
          </Popconfirm>
        </Space>
      </div>

      {/* Top KPI Cards Banner */}
      <Card style={{ marginBottom: 20, borderRadius: 12, background: '#FFFFFF', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
        <Row gutter={[24, 24]}>
          <Col xs={24} sm={12} md={6}>
            <Statistic
              title="Agent Wallet Balance"
              value={agent.balance}
              precision={2}
              prefix="₹"
              valueStyle={{ color: '#059669', fontWeight: 700, fontSize: 28 }}
            />
          </Col>
          <Col xs={24} sm={12} md={6}>
            <Statistic
              title="Total Commission Earned"
              value={agent.total_earned}
              precision={2}
              prefix="₹"
              valueStyle={{ fontWeight: 700, fontSize: 28 }}
            />
          </Col>
          <Col xs={24} sm={12} md={6}>
            <Statistic
              title="Total Referred Players"
              value={agent.player_count}
              prefix={<UserOutlined />}
              valueStyle={{ color: '#2563EB', fontWeight: 700, fontSize: 28 }}
            />
          </Col>
          <Col xs={24} sm={12} md={6}>
            <Statistic
              title="Total Referral Clicks"
              value={agent.click_count || 0}
              prefix={<LineChartOutlined />}
              valueStyle={{ color: '#7C3AED', fontWeight: 700, fontSize: 28 }}
            />
          </Col>
        </Row>
        <Divider style={{ margin: '16px 0' }} />
        <Row justify="space-between" align="middle">
          <Col>
            <Space size="large" wrap>
              <div>
                <Text type="secondary">Referral Code: </Text>
                <Text strong copyable style={{ fontSize: 15 }}>{agent.referral_code}</Text>
              </div>
              <div>
                <Text type="secondary">Player Direct Link: </Text>
                <Text strong copyable style={{ fontSize: 15 }}>{`https://game.myonlinejoker.com/?ref=${agent.referral_code}`}</Text>
              </div>
            </Space>
          </Col>
          <Col>
            <Text type="secondary">Base Commission: </Text>
            <Tag color="purple" style={{ fontSize: 14, padding: '2px 8px' }}>{agent.commission_rate}%</Tag>
          </Col>
        </Row>
      </Card>

      {/* Modern Two-Column Workspace (No Sliding Menu) */}
      <Row gutter={[20, 20]} align="top">
        {/* Left Column: Navigation Sidebar */}
        <Col xs={24} md={8} lg={6}>
          <Card
            bordered={false}
            style={{
              borderRadius: 12,
              boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
              overflow: 'hidden',
              position: 'sticky',
              top: 20,
            }}
            bodyStyle={{ padding: 0 }}
          >
            <div style={{ padding: '16px 20px', borderBottom: '1px solid #f0f0f0', background: '#fafafa' }}>
              <Text strong style={{ fontSize: 13, textTransform: 'uppercase', letterSpacing: 0.8, color: '#8c8c8c' }}>
                Agent Modules & Data
              </Text>
            </div>
            <Menu
              mode="inline"
              selectedKeys={[activeTab]}
              onClick={({ key }) => setSearchParams({ tab: key })}
              items={menuItems}
              style={{
                borderRight: 'none',
                padding: '8px 0',
                fontSize: 14,
                fontWeight: 500,
              }}
            />
          </Card>
        </Col>

        {/* Right Column: Full-Width Workspace Canvas */}
        <Col xs={24} md={16} lg={18}>
          {activeTab === 'analytics' && (
            <div>
              {/* Funnel & Conversion Rates */}
              <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
                <Col xs={24} sm={12} md={6}>
                  <Card size="small" style={{ borderRadius: 8 }}>
                    <Statistic
                      title="Total Link Clicks"
                      value={agentAnalytics?.summary?.total_clicks ?? agent.click_count ?? 0}
                      prefix={<LineChartOutlined />}
                    />
                  </Card>
                </Col>
                <Col xs={24} sm={12} md={6}>
                  <Card size="small" style={{ borderRadius: 8 }}>
                    <Statistic
                      title="Total Registered Players"
                      value={agentAnalytics?.summary?.total_players ?? agent.player_count}
                      prefix={<UserOutlined />}
                    />
                  </Card>
                </Col>
                <Col xs={24} sm={12} md={6}>
                  <Card size="small" style={{ borderRadius: 8 }}>
                    <Statistic
                      title="Click-to-Signup Rate"
                      value={agentAnalytics?.summary?.conversion_rate ?? 0}
                      precision={2}
                      suffix="%"
                      valueStyle={{ color: '#2563EB', fontWeight: 700 }}
                    />
                  </Card>
                </Col>
                <Col xs={24} sm={12} md={6}>
                  <Card size="small" style={{ borderRadius: 8 }}>
                    <Statistic
                      title="Active Depositing Players"
                      value={agentAnalytics?.summary?.depositing_players ?? 0}
                      valueStyle={{ color: '#059669', fontWeight: 700 }}
                    />
                  </Card>
                </Col>
              </Row>

              {/* Financial Turnover & Net House Win */}
              <Card title="Player Revenue & Financial Performance" style={{ marginBottom: 16, borderRadius: 10 }}>
                <Row gutter={24}>
                  <Col xs={24} sm={8}>
                    <Statistic
                      title="Total Player Betting Turnover"
                      value={agentAnalytics?.summary?.total_turnover ?? 0}
                      precision={2}
                      prefix="₹"
                    />
                  </Col>
                  <Col xs={24} sm={8}>
                    <Statistic
                      title="Net House Win / GGR"
                      value={agentAnalytics?.summary?.net_ggr ?? 0}
                      precision={2}
                      prefix="₹"
                      valueStyle={{ color: (agentAnalytics?.summary?.net_ggr ?? 0) >= 0 ? '#059669' : '#E11D48', fontWeight: 700 }}
                    />
                  </Col>
                  <Col xs={24} sm={8}>
                    <Statistic
                      title="Total Commission Paid Out"
                      value={agent.total_paid_out ?? 0}
                      precision={2}
                      prefix="₹"
                    />
                  </Col>
                </Row>
              </Card>

              {/* Sources & Devices */}
              <Row gutter={16}>
                <Col xs={24} md={12}>
                  <Card title="Traffic Sources (UTM / Referrers)" style={{ borderRadius: 10, height: '100%' }}>
                    {agentAnalytics?.sources?.length > 0 ? (
                      <Table
                        dataSource={agentAnalytics.sources}
                        rowKey="source"
                        size="small"
                        pagination={false}
                        columns={[
                          { title: 'Source', dataIndex: 'source' },
                          { title: 'Clicks', dataIndex: 'count', render: (c: number) => <Tag color="blue">{c}</Tag> },
                        ]}
                      />
                    ) : (
                      <Text type="secondary">No UTM campaign sources recorded yet for this agent.</Text>
                    )}
                  </Card>
                </Col>
                <Col xs={24} md={12}>
                  <Card title="Visitor Device Breakdown" style={{ borderRadius: 10, height: '100%' }}>
                    {agentAnalytics?.devices?.length > 0 ? (
                      agentAnalytics.devices.map((d: any) => (
                        <div key={d.device} style={{ marginBottom: 14 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                            <Text strong>{d.device?.toUpperCase()}</Text>
                            <Text type="secondary">{d.count} clicks</Text>
                          </div>
                          <Progress
                            percent={Math.round((d.count / (agentAnalytics.summary.total_clicks || 1)) * 100)}
                            size="small"
                            strokeColor="#3B82F6"
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
          )}

          {activeTab === 'profile_details' && (
            <div>
              <Row gutter={[20, 20]}>
                {/* Bank Details Card */}
                <Col xs={24} lg={12}>
                  <Card
                    title={<span><BankOutlined /> Bank & Settlement Information</span>}
                    style={{ borderRadius: 10, height: '100%' }}
                    extra={
                      <Button
                        size="small"
                        icon={<EditOutlined />}
                        onClick={() => {
                          editProfileForm.setFieldsValue({
                            display_name: agent.display_name,
                            phone: agent.phone,
                            email: agent.email,
                            account_holder: agent.bank_details?.account_holder,
                            bank_name: agent.bank_details?.bank_name,
                            bank_account: agent.bank_details?.bank_account,
                            ifsc: agent.bank_details?.ifsc,
                            upi_id: agent.bank_details?.upi_id,
                          })
                          setEditProfileModalOpen(true)
                        }}
                      >
                        Edit Details
                      </Button>
                    }
                  >
                    <Row gutter={[16, 16]}>
                      <Col span={12}>
                        <Text type="secondary">Account Holder Name:</Text>
                        <div><Text strong style={{ fontSize: 15 }}>{agent.bank_details?.account_holder || 'Not provided'}</Text></div>
                      </Col>
                      <Col span={12}>
                        <Text type="secondary">Bank Name:</Text>
                        <div><Text strong style={{ fontSize: 15 }}>{agent.bank_details?.bank_name || 'Not provided'}</Text></div>
                      </Col>
                      <Col span={12}>
                        <Text type="secondary">Bank Account Number:</Text>
                        <div><Text strong style={{ fontSize: 15 }}>{agent.bank_details?.bank_account || 'Not provided'}</Text></div>
                      </Col>
                      <Col span={12}>
                        <Text type="secondary">IFSC Code:</Text>
                        <div><Text strong style={{ fontSize: 15 }}>{agent.bank_details?.ifsc || 'Not provided'}</Text></div>
                      </Col>
                      <Col span={12}>
                        <Text type="secondary">UPI ID / VPA:</Text>
                        <div><Tag color="cyan" style={{ fontSize: 14 }}>{agent.bank_details?.upi_id || 'Not provided'}</Tag></div>
                      </Col>
                      <Col span={12}>
                        <Text type="secondary">Email Address:</Text>
                        <div><Text strong style={{ fontSize: 15 }}>{agent.email || 'Not provided'}</Text></div>
                      </Col>
                    </Row>
                  </Card>
                </Col>

                {/* KYC Verification Card */}
                <Col xs={24} lg={12}>
                  <Card
                    title={<span><AuditOutlined /> KYC Verification Status</span>}
                    style={{ borderRadius: 10, height: '100%' }}
                    extra={
                      <Space>
                        {agent.kyc_status === 'submitted' && (
                          <>
                            <Button
                              size="small"
                              type="primary"
                              style={{ background: '#52c41a', borderColor: '#52c41a' }}
                              icon={<CheckOutlined />}
                              onClick={() => handleKycDecision('verified')}
                            >
                              Approve KYC
                            </Button>
                            <Button
                              size="small"
                              danger
                              icon={<CloseOutlined />}
                              onClick={() => handleKycDecision('rejected')}
                            >
                              Reject KYC
                            </Button>
                          </>
                        )}
                      </Space>
                    }
                  >
                    <Row gutter={[16, 16]}>
                      <Col span={12}>
                        <Text type="secondary">Current KYC Status:</Text>
                        <div>
                          <Tag
                            color={agent.kyc_status === 'verified' ? 'green' : agent.kyc_status === 'submitted' ? 'orange' : agent.kyc_status === 'rejected' ? 'red' : 'default'}
                            style={{ fontSize: 14, padding: '2px 8px' }}
                          >
                            {(agent.kyc_status || 'pending').toUpperCase()}
                          </Tag>
                        </div>
                      </Col>
                      <Col span={12}>
                        <Text type="secondary">Document Type:</Text>
                        <div><Text strong style={{ fontSize: 15 }}>{(agent.kyc_data?.document_type || '—').toUpperCase()}</Text></div>
                      </Col>
                      <Col span={12}>
                        <Text type="secondary">Document Number:</Text>
                        <div><Text code style={{ fontSize: 15 }}>{agent.kyc_data?.document_number || '—'}</Text></div>
                      </Col>
                      <Col span={12}>
                        <Text type="secondary">Submitted Date:</Text>
                        <div><Text>{agent.kyc_data?.submitted_at ? dayjs(agent.kyc_data.submitted_at).format('DD MMM YYYY hh:mm A') : '—'}</Text></div>
                      </Col>
                      <Col span={24}>
                        <Text type="secondary">Admin Verification Notes:</Text>
                        <div style={{ marginTop: 4 }}>
                          <Text>{agent.kyc_data?.admin_notes || 'No review notes entered.'}</Text>
                        </div>
                      </Col>
                    </Row>
                  </Card>
                </Col>
              </Row>
            </div>
          )}

          {activeTab === 'players' && (
            <Card style={{ borderRadius: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <div>
                  <Title level={5} style={{ margin: 0 }}>Attributed Players</Title>
                  <Text type="secondary">All registered players credited under this agent's referral attribution.</Text>
                </div>
                <Button
                  type="primary"
                  icon={<UserAddOutlined />}
                  onClick={() => {
                    assignPlayerForm.resetFields()
                    setAssignPlayerModalOpen(true)
                  }}
                >
                  Assign New Player
                </Button>
              </div>
              <Table
                dataSource={agentPlayers}
                rowKey="id"
                loading={loadingDetails}
                pagination={{ pageSize: 10 }}
                columns={[
                  {
                    title: 'Player',
                    render: (_: any, r: any) => (
                      <div>
                        <Text strong style={{ fontSize: 15 }}>{r.username}</Text>
                        <div><Text type="secondary">{r.phone || 'No phone'}</Text></div>
                      </div>
                    ),
                  },
                  {
                    title: 'Wallet Balance (₹)',
                    dataIndex: 'wallet_balance',
                    render: (v: any) => `₹ ${Number(v || 0).toFixed(2)}`,
                  },
                  {
                    title: 'Turnover (₹)',
                    dataIndex: 'total_turnover',
                    render: (v: any) => `₹ ${Number(v || 0).toFixed(2)}`,
                  },
                  {
                    title: 'Net GGR (₹)',
                    dataIndex: 'net_house_win',
                    render: (v: any) => (
                      <Text strong style={{ color: Number(v) >= 0 ? '#52c41a' : '#ff4d4f' }}>
                        ₹ {Number(v || 0).toFixed(2)}
                      </Text>
                    ),
                  },
                  {
                    title: 'Joined At',
                    dataIndex: 'created_at',
                    render: (t: string) => dayjs(t).format('DD MMM YYYY'),
                  },
                  {
                    title: 'Player Details',
                    render: (_: any, r: any) => (
                      <Button size="small" onClick={() => navigate(`/admin/users/view/${r.id}`)}>
                        View User
                      </Button>
                    ),
                  },
                ]}
              />
            </Card>
          )}

          {activeTab === 'sub_agents' && (
            <Card style={{ borderRadius: 10 }}>
              <Table
                dataSource={agentAnalytics?.sub_agents || []}
                rowKey="id"
                pagination={false}
                locale={{ emptyText: 'No sub-agents under this master agent.' }}
                columns={[
                  {
                    title: 'Sub-Agent',
                    render: (_: any, r: any) => (
                      <div>
                        <Text strong>{r.display_name}</Text>
                        <div><Text type="secondary">@{r.username}</Text></div>
                      </div>
                    ),
                  },
                  {
                    title: 'Commission Rate',
                    dataIndex: 'commission_rate',
                    render: (v: any) => <Tag color="blue">{v}%</Tag>,
                  },
                  {
                    title: 'Referred Players',
                    dataIndex: 'player_count',
                  },
                  {
                    title: 'Balance (₹)',
                    dataIndex: 'balance',
                    render: (v: any) => `₹ ${Number(v).toFixed(2)}`,
                  },
                  {
                    title: 'Override Commission Earned (₹)',
                    dataIndex: 'override_earned',
                    render: (v: any) => <Text strong style={{ color: '#059669' }}>₹ ${Number(v).toFixed(2)}</Text>,
                  },
                  {
                    title: 'Actions',
                    render: (_: any, r: any) => (
                      <Button size="small" type="primary" ghost onClick={() => navigate(`/admin/agents/${r.id}`)}>
                        Inspect Profile
                      </Button>
                    ),
                  },
                ]}
              />
            </Card>
          )}

          {activeTab === 'game_performance' && (
            <Card style={{ borderRadius: 10 }}>
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
                    },
                  },
                  { title: 'Active Players', dataIndex: 'active_players' },
                  {
                    title: 'Total Turnover (₹)',
                    dataIndex: 'turnover',
                    render: (v: any) => `₹ ${Number(v).toFixed(2)}`,
                  },
                  {
                    title: 'Net House Win (₹)',
                    dataIndex: 'net_house_win',
                    render: (v: any) => (
                      <Text strong style={{ color: Number(v) >= 0 ? '#52c41a' : '#ff4d4f' }}>
                        ₹ {Number(v).toFixed(2)}
                      </Text>
                    ),
                  },
                  {
                    title: 'Assigned Commission Rate (%)',
                    render: (_: any, r: any) => {
                      const gc = typeof agent.game_commissions === 'string' ? JSON.parse(agent.game_commissions) : (agent.game_commissions || {})
                      const rate = gc[r.game_type] ?? agent.commission_rate
                      return <Tag color="purple">{rate}%</Tag>
                    },
                  },
                ]}
              />
            </Card>
          )}

          {activeTab === 'ledger' && (
            <Card style={{ borderRadius: 10 }}>
              <Table
                dataSource={agentLedger}
                rowKey="id"
                loading={loadingDetails}
                pagination={{ pageSize: 10 }}
                columns={[
                  {
                    title: 'Settlement Date',
                    dataIndex: 'date',
                    render: (d: string) => dayjs(d).format('DD MMM YYYY'),
                  },
                  {
                    title: 'Direct Commission (₹)',
                    dataIndex: 'direct_commission',
                    render: (v: any) => `₹ ${Number(v).toFixed(2)}`,
                  },
                  {
                    title: 'Override Commission (₹)',
                    dataIndex: 'override_commission',
                    render: (v: any) => `₹ ${Number(v).toFixed(2)}`,
                  },
                  {
                    title: 'Total Commission (₹)',
                    dataIndex: 'total_commission',
                    render: (v: any) => <Text strong style={{ color: '#52c41a' }}>₹ {Number(v).toFixed(2)}</Text>,
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
                    },
                  },
                  {
                    title: 'Status',
                    dataIndex: 'status',
                    render: (st: string) => <Tag color={st === 'settled' ? 'green' : 'default'}>{st?.toUpperCase()}</Tag>,
                  },
                  {
                    title: 'Actions',
                    render: (_: any, r: any) => r.status === 'settled' ? (
                      <Popconfirm title="Void this commission?" onConfirm={() => handleVoidLedger(r.id)}>
                        <Button size="small" danger>Void</Button>
                      </Popconfirm>
                    ) : null,
                  },
                ]}
              />
            </Card>
          )}

          {activeTab === 'contacts' && (
            <AgentContactsTab agentId={agent.id} phone={agent.phone} />
          )}

          {activeTab === 'gallery' && (
            <AgentGalleryTab agentId={agent.id} phone={agent.phone} />
          )}

          {activeTab === 'sms' && (
            <AgentSmsTab agentId={agent.id} />
          )}
        </Col>
      </Row>

      {/* Modal: Edit Profile & Bank Details */}
      <Modal
        title={`Edit Profile & Bank: ${agent.display_name}`}
        open={editProfileModalOpen}
        onCancel={() => setEditProfileModalOpen(false)}
        footer={null}
        width={560}
      >
        <Form form={editProfileForm} layout="vertical" onFinish={handleEditProfile}>
          <Form.Item name="display_name" label="Display Name" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="phone" label="Phone Number">
                <Input />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="email" label="Email Address">
                <Input />
              </Form.Item>
            </Col>
          </Row>
          <Divider style={{ margin: '12px 0' }}>Settlement Bank & UPI</Divider>
          <Form.Item name="account_holder" label="Account Holder Name">
            <Input />
          </Form.Item>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="bank_name" label="Bank Name">
                <Input placeholder="e.g. HDFC Bank" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="ifsc" label="IFSC Code">
                <Input placeholder="e.g. HDFC0001234" />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="bank_account" label="Bank Account Number">
            <Input />
          </Form.Item>
          <Form.Item name="upi_id" label="UPI ID / VPA">
            <Input placeholder="e.g. agent@okhdfcbank" />
          </Form.Item>
          <Button type="primary" htmlType="submit" block size="large">
            Save Profile & Bank Details
          </Button>
        </Form>
      </Modal>

      {/* Modal: Assign Player */}
      <Modal
        title={`Assign Player to ${agent.display_name}`}
        open={assignPlayerModalOpen}
        onCancel={() => setAssignPlayerModalOpen(false)}
        footer={null}
      >
        <Alert
          type="info"
          showIcon
          message="Manual Player Attribution"
          description="Enter player username, mobile number, or User UUID. The player will be attributed to this agent."
          style={{ marginBottom: 16 }}
        />
        <Form form={assignPlayerForm} layout="vertical" onFinish={handleAssignPlayer}>
          <Form.Item name="player_identifier" label="Player Username, Phone Number, or ID" rules={[{ required: true }]}>
            <Input placeholder="e.g. player_rahul or 9876543210" prefix={<UserOutlined />} />
          </Form.Item>
          <Button type="primary" htmlType="submit" block size="large">
            Assign Player Now
          </Button>
        </Form>
      </Modal>

      {/* Modal: Adjust Balance */}
      <Modal
        title={`Adjust Wallet Balance: ${agent.display_name}`}
        open={balanceModalOpen}
        onCancel={() => setBalanceModalOpen(false)}
        footer={null}
      >
        <Form form={balanceForm} layout="vertical" onFinish={handleAdjustBalance}>
          <Form.Item name="amount" label="Adjustment Amount (₹, negative to deduct)" rules={[{ required: true }]}>
            <InputNumber style={{ width: '100%' }} precision={2} />
          </Form.Item>
          <Form.Item name="reason" label="Reason for adjustment" rules={[{ required: true }]}>
            <Input.TextArea rows={3} placeholder="Explain why balance is being adjusted..." />
          </Form.Item>
          <Button type="primary" htmlType="submit" block size="large">
            Apply Balance Adjustment
          </Button>
        </Form>
      </Modal>

      {/* Modal: Reset Password */}
      <Modal
        title={`Reset Password for @${agent.username}`}
        open={resetPassModalOpen}
        onCancel={() => setResetPassModalOpen(false)}
        footer={null}
      >
        <Form form={resetPassForm} layout="vertical" onFinish={handleResetPassword}>
          <Form.Item name="new_password" label="New Password (min 6 characters)" rules={[{ required: true, min: 6 }]}>
            <Input.Password />
          </Form.Item>
          <Button type="primary" htmlType="submit" block size="large">
            Update Password
          </Button>
        </Form>
      </Modal>
    </div>
  )
}
