import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Card, Table, Tabs, Statistic, Row, Col, Button, Modal, Form, InputNumber,
  Input, message, Typography, Select, Tag, Popconfirm, Space, Divider,
  Tooltip, Alert, QRCode, Radio, Progress
} from 'antd'
import {
  UserOutlined, DollarOutlined, TrophyOutlined, TeamOutlined,
  PlusOutlined, ReloadOutlined, SettingOutlined, KeyOutlined,
  CheckCircleOutlined, CloseCircleOutlined, WalletOutlined,
  GlobalOutlined, BranchesOutlined, HistoryOutlined, CopyOutlined,
  ShareAltOutlined, QrcodeOutlined, LogoutOutlined, LockOutlined,
  PhoneOutlined, AimOutlined, DesktopOutlined, TabletOutlined, MobileOutlined,
  ThunderboltOutlined, WhatsAppOutlined, SendOutlined
} from '@ant-design/icons'
import dayjs from 'dayjs'
import { adminApi } from '../api/client'
import { useAuthStore } from '../store/auth'
import { tokens } from '../theme/tokens'

const { Title, Text, Paragraph } = Typography

export const SUPPORTED_GAMES = [
  { key: 'teen_patti', label: 'Teen Patti', icon: '🎴', color: '#faad14' },
  { key: 'rummy', label: 'Rummy', icon: '🃏', color: '#1890ff' },
  { key: 'ludo', label: 'Ludo', icon: '🎲', color: '#52c41a' },
  { key: 'aviator', label: 'Aviator', icon: '🚀', color: '#f5222d' },
  { key: 'matka', label: 'Satta Matka', icon: '🎯', color: '#722ed1' },
  { key: 'lottery', label: 'Lottery', icon: '🎟️', color: '#eb2f96' },
  { key: 'cricket', label: 'Cricket Betting', icon: '🏏', color: '#13c2c2' },
]

export default function AgentPortal() {
  const [me, setMe] = useState<any>(null)
  const [players, setPlayers] = useState<any[]>([])
  const [ledger, setLedger] = useState<any[]>([])
  const [payouts, setPayouts] = useState<any[]>([])
  const [referrals, setReferrals] = useState<{ rows: any[]; totals: any }>({ rows: [], totals: { clicks: 0, signups: 0, conversion_rate: 0 } })
  const [channels, setChannels] = useState<any[]>([])
  const [liveCommission, setLiveCommission] = useState<{ today: any; players: any[] }>({
    today: { direct_commission: 0, override_commission: 0, total_commission: 0, game_breakdown: {} },
    players: [],
  })
  const [loading, setLoading] = useState(false)

  // Modals
  const [payoutModalOpen, setPayoutModalOpen] = useState(false)
  const [subAgentModalOpen, setSubAgentModalOpen] = useState(false)
  const [passwordModalOpen, setPasswordModalOpen] = useState(false)
  const [qrModalOpen, setQrModalOpen] = useState(false)

  // Player search filter
  const [playerSearch, setPlayerSearch] = useState('')

  // Forms
  const [payoutForm] = Form.useForm()
  const [subAgentForm] = Form.useForm()
  const [channelForm] = Form.useForm()
  const [passwordForm] = Form.useForm()

  const navigate = useNavigate()
  const logout = useAuthStore(s => s.logout)

  const load = async () => {
    setLoading(true)
    try {
      const [meRes, playersRes, ledgerRes, payoutsRes, referralsRes, channelsRes, liveCommissionRes] = await Promise.all([
        adminApi.get('/agent-portal/me'),
        adminApi.get('/agent-portal/players').catch(() => ({ data: [] })),
        adminApi.get('/agent-portal/ledger').catch(() => ({ data: [] })),
        adminApi.get('/agent-portal/payouts').catch(() => ({ data: [] })),
        adminApi.get('/agent-portal/referrals').catch(() => ({ data: { rows: [], totals: {} } })),
        adminApi.get('/agent-portal/channels').catch(() => ({ data: [] })),
        adminApi.get('/agent-portal/commission/live').catch(() => ({ data: { today: {}, players: [] } })),
      ])
      setMe(meRes.data)
      setPlayers(playersRes.data || [])
      setLedger(ledgerRes.data || [])
      setPayouts(payoutsRes.data || [])
      setReferrals(referralsRes.data || { rows: [], totals: {} })
      setChannels(channelsRes.data || [])
      setLiveCommission(liveCommissionRes.data || { today: {}, players: [] })
    } catch (e: any) {
      message.error(e.response?.data?.error || 'Failed to load agent profile')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const handleRequestPayout = async (values: any) => {
    if (!values.bank_account?.trim() && !values.upi_id?.trim()) {
      message.error('Please enter a Bank Account or a UPI ID to receive the payout')
      return
    }
    try {
      await adminApi.post('/agent-portal/payout', values)
      message.success('Payout request submitted successfully! Processed within 24 hours.')
      setPayoutModalOpen(false)
      payoutForm.resetFields()
      load()
    } catch (e: any) {
      message.error(e.response?.data?.error || 'Failed to request payout')
    }
  }

  const handleCreateSubAgent = async (values: any) => {
    try {
      const game_commissions: Record<string, number> = {}
      for (const g of SUPPORTED_GAMES) {
        if (values[`rate_${g.key}`] !== undefined) {
          game_commissions[g.key] = Number(values[`rate_${g.key}`])
        }
      }
      await adminApi.post('/agent-portal/sub-agents', {
        username: values.username,
        password: values.password,
        display_name: values.display_name,
        phone: values.phone,
        commission_rate: values.commission_rate,
        game_commissions,
      })
      message.success('Sub-Agent created successfully!')
      setSubAgentModalOpen(false)
      subAgentForm.resetFields()
      load()
    } catch (e: any) {
      message.error(e.response?.data?.error || 'Failed to create sub-agent')
    }
  }

  const handleChangePassword = async (values: any) => {
    try {
      await adminApi.post('/agent-portal/change-password', values)
      message.success('Password changed successfully!')
      setPasswordModalOpen(false)
      passwordForm.resetFields()
    } catch (e: any) {
      message.error(e.response?.data?.error || 'Failed to change password')
    }
  }

  const addChannel = async (values: any) => {
    try {
      await adminApi.post('/agent-portal/channels', values)
      message.success('Channel submitted for review')
      channelForm.resetFields()
      load()
    } catch (e: any) {
      message.error(e.response?.data?.error || 'Failed to add channel')
    }
  }

  const deleteChannel = async (id: string) => {
    try {
      await adminApi.delete(`/agent-portal/channels/${id}`)
      message.success('Channel removed')
      load()
    } catch (e: any) {
      message.error('Failed to remove channel')
    }
  }

  if (!me) {
    return (
      <div style={{ padding: 60, textAlign: 'center', color: tokens.color.gold }}>
        Loading agent partner dashboard...
      </div>
    )
  }

  const referralUrl = `https://game.myonlinejoker.com/?ref=${me.agent.referral_code}`
  const gameCommissions = typeof me.agent.game_commissions === 'string' ? JSON.parse(me.agent.game_commissions) : (me.agent.game_commissions || {})

  const filteredPlayers = players.filter(p =>
    p.username.toLowerCase().includes(playerSearch.toLowerCase()) ||
    (p.phone && p.phone.includes(playerSearch))
  )

  const copyReferralLink = () => {
    navigator.clipboard.writeText(referralUrl)
    message.success('Referral link copied to clipboard!')
  }

  const shareWhatsApp = () => {
    window.open(`https://api.whatsapp.com/send?text=${encodeURIComponent(`Join MyOnlineJoker and win real cash! Register here: ${referralUrl}`)}`, '_blank')
  }

  return (
    <div className="agent-portal-root" style={{ minHeight: '100vh', background: '#F8FAFC', color: '#0F172A', padding: '16px 12px 90px' }}>
      <style>{`
        .agent-portal-root {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
        }
        @media (max-width: 768px) {
          .agent-portal-root {
            padding: 10px 8px 95px !important;
          }
          .agent-header-card .ant-card-body {
            padding: 14px 12px !important;
          }
          .agent-stats-card .ant-card-body {
            padding: 12px 10px !important;
          }
          .agent-tabs-card .ant-card-body {
            padding: 12px 8px !important;
          }
          .agent-stat-val {
            font-size: 17px !important;
          }
          .mobile-full-btn {
            width: 100% !important;
            margin-bottom: 8px !important;
          }
        }
        .ant-tabs-nav-wrap {
          overflow-x: auto !important;
          -webkit-overflow-scrolling: touch;
        }
        .mobile-bottom-dock {
          position: fixed;
          bottom: 0;
          left: 0;
          right: 0;
          background: rgba(255, 255, 255, 0.96);
          backdrop-filter: blur(14px);
          border-top: 1px solid #E2E8F0;
          padding: 8px 12px;
          display: flex;
          gap: 8px;
          z-index: 1000;
          box-shadow: 0 -4px 20px rgba(0, 0, 0, 0.08);
        }
        @media (min-width: 769px) {
          .mobile-bottom-dock {
            display: none !important;
          }
        }
      `}</style>

      <div style={{ maxWidth: 1180, margin: '0 auto' }}>

        {/* Top Bar Header */}
        <Card bordered={false} className="agent-header-card" style={{ background: '#FFFFFF', borderRadius: 18, marginBottom: 16, border: '1px solid #E2E8F0', boxShadow: '0 4px 18px rgba(15, 23, 42, 0.04)' }}>
          <Row justify="space-between" align="middle" gutter={[12, 12]}>
            <Col xs={24} md={14}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{
                  width: 48,
                  height: 48,
                  minWidth: 48,
                  borderRadius: 14,
                  background: tokens.gradient.goldButton,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 24,
                  boxShadow: tokens.shadow.gold,
                  color: '#FFFFFF',
                }}>
                  👥
                </div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <Title level={4} style={{ color: '#0F172A', margin: 0, fontWeight: 800, fontSize: 18 }}>
                      {me.agent.display_name}
                    </Title>
                    <Tag color="gold" style={{ borderRadius: 8, fontWeight: 700, margin: 0 }}>
                      {me.agent.parent_agent_id ? 'SUB-AGENT' : 'MASTER AGENT'}
                    </Tag>
                  </div>
                  <Text style={{ color: '#64748B', fontSize: 12, display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    @{me.agent.username} {me.agent.phone ? `· ${me.agent.phone}` : ''} · Code: <Text strong style={{ color: '#D97706' }}>{me.agent.referral_code}</Text>
                  </Text>
                </div>
              </div>
            </Col>
            <Col xs={24} md={10} style={{ textAlign: 'right' }}>
              <Space wrap size="small">
                <Button size="small" icon={<QrcodeOutlined />} onClick={() => setQrModalOpen(true)}>
                  QR Code
                </Button>
                <Button size="small" icon={<KeyOutlined />} onClick={() => setPasswordModalOpen(true)}>
                  Password
                </Button>
                <Button size="small" icon={<ReloadOutlined />} onClick={load} loading={loading}>
                  Refresh
                </Button>
                <Button size="small" danger icon={<LogoutOutlined />} onClick={() => { logout(); navigate('/admin/agent/login') }}>
                  Logout
                </Button>
              </Space>
            </Col>
          </Row>
        </Card>

        {/* Referral Link Action Banner */}
        <Card bordered={false} style={{ background: '#FEF3C7', borderRadius: 16, marginBottom: 16, border: '1px dashed #F59E0B' }}>
          <Row justify="space-between" align="middle" gutter={[12, 10]}>
            <Col xs={24} md={15}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                <ShareAltOutlined style={{ color: '#D97706', fontSize: 20, marginTop: 2 }} />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <Text strong style={{ color: '#92400E', fontSize: 13, display: 'block' }}>Your Player Referral Link</Text>
                  <div style={{ marginTop: 2 }}>
                    <Text style={{ color: '#B45309', fontSize: 12, wordBreak: 'break-all', fontWeight: 600 }}>
                      {referralUrl}
                    </Text>
                  </div>
                </div>
              </div>
            </Col>
            <Col xs={24} md={9}>
              <Space wrap size="small" style={{ width: '100%', justifyContent: 'flex-end' }}>
                <Button
                  size="middle"
                  icon={<CopyOutlined />}
                  onClick={copyReferralLink}
                  style={{ fontWeight: 600 }}
                >
                  Copy Link
                </Button>
                <Button
                  size="middle"
                  type="primary"
                  icon={<WhatsAppOutlined />}
                  style={{ background: '#059669', borderColor: '#059669', color: '#FFFFFF', fontWeight: 700 }}
                  onClick={shareWhatsApp}
                >
                  WhatsApp
                </Button>
                <Button
                  size="middle"
                  type="primary"
                  icon={<SendOutlined />}
                  style={{ background: '#2563EB', borderColor: '#2563EB', fontWeight: 700 }}
                  onClick={() => window.open(`https://t.me/share/url?url=${encodeURIComponent(referralUrl)}&text=${encodeURIComponent('Join MyOnlineJoker and win real cash!')}`, '_blank')}
                >
                  Telegram
                </Button>
              </Space>
            </Col>
          </Row>
        </Card>

        {/* Metrics Grid */}
        <Row gutter={[10, 10]} style={{ marginBottom: 16 }}>
          <Col xs={12} sm={8} md={4}>
            <Card bordered={false} className="agent-stats-card" style={{ background: '#FFFFFF', borderRadius: 14, border: '1px solid #E2E8F0' }}>
              <Statistic
                title={<span style={{ color: '#64748B', fontSize: 11 }}>Available Balance</span>}
                value={me.wallet.balance}
                precision={2}
                prefix={<WalletOutlined style={{ color: '#059669' }} />}
                suffix="₹"
                valueStyle={{ color: '#059669', fontWeight: 800, fontSize: 18 }}
                className="agent-stat-val"
              />
            </Card>
          </Col>
          <Col xs={12} sm={8} md={4}>
            <Card bordered={false} className="agent-stats-card" style={{ background: '#FFFFFF', borderRadius: 14, border: '1px solid #E2E8F0' }}>
              <Statistic
                title={<span style={{ color: '#64748B', fontSize: 11 }}>Today Live Est.</span>}
                value={liveCommission.today?.total_commission || 0}
                precision={2}
                prefix={<ThunderboltOutlined style={{ color: '#D97706' }} />}
                suffix="₹"
                valueStyle={{ color: '#D97706', fontWeight: 800, fontSize: 18 }}
                className="agent-stat-val"
              />
            </Card>
          </Col>
          <Col xs={12} sm={8} md={4}>
            <Card bordered={false} className="agent-stats-card" style={{ background: '#FFFFFF', borderRadius: 14, border: '1px solid #E2E8F0' }}>
              <Statistic
                title={<span style={{ color: '#64748B', fontSize: 11 }}>Total Earned</span>}
                value={me.wallet.total_earned}
                precision={2}
                prefix={<TrophyOutlined style={{ color: '#2563EB' }} />}
                suffix="₹"
                valueStyle={{ color: '#2563EB', fontWeight: 700, fontSize: 18 }}
                className="agent-stat-val"
              />
            </Card>
          </Col>
          <Col xs={12} sm={8} md={4}>
            <Card bordered={false} className="agent-stats-card" style={{ background: '#FFFFFF', borderRadius: 14, border: '1px solid #E2E8F0' }}>
              <Statistic
                title={<span style={{ color: '#64748B', fontSize: 11 }}>Pending Payout</span>}
                value={me.wallet.locked_balance}
                precision={2}
                prefix={<HistoryOutlined style={{ color: '#7C3AED' }} />}
                suffix="₹"
                valueStyle={{ color: '#7C3AED', fontWeight: 700, fontSize: 18 }}
                className="agent-stat-val"
              />
            </Card>
          </Col>
          <Col xs={12} sm={8} md={4}>
            <Card bordered={false} className="agent-stats-card" style={{ background: '#FFFFFF', borderRadius: 14, border: '1px solid #E2E8F0' }}>
              <Statistic
                title={<span style={{ color: '#64748B', fontSize: 11 }}>Referred Players</span>}
                value={me.player_count || players.length}
                prefix={<UserOutlined style={{ color: '#0891B2' }} />}
                valueStyle={{ fontWeight: 700, fontSize: 18 }}
                className="agent-stat-val"
              />
            </Card>
          </Col>
          <Col xs={12} sm={8} md={4}>
            <Card bordered={false} className="agent-stats-card" style={{ background: '#FFFFFF', borderRadius: 14, border: '1px solid #E2E8F0' }}>
              <Statistic
                title={<span style={{ color: '#64748B', fontSize: 11 }}>Sub-Agents</span>}
                value={me.sub_agents?.length || 0}
                prefix={<BranchesOutlined style={{ color: '#E11D48' }} />}
                valueStyle={{ fontWeight: 700, fontSize: 18 }}
                className="agent-stat-val"
              />
            </Card>
          </Col>
        </Row>

        {/* Assigned Commission Rates */}
        <Card title={<span style={{ color: '#0F172A', fontSize: 14 }}>🎮 Assigned Game Commission Rates</span>} bordered={false} style={{ background: '#FFFFFF', borderRadius: 16, marginBottom: 16, border: '1px solid #E2E8F0' }}>
          <Row gutter={[8, 8]}>
            <Col xs={12} sm={6} md={3}>
              <Card size="small" style={{ background: '#F8FAFC', textAlign: 'center', borderRadius: 10, border: '1px solid #E2E8F0' }}>
                <Text type="secondary" style={{ fontSize: 10, display: 'block' }}>Default Rate</Text>
                <div style={{ fontSize: 16, fontWeight: 800, color: '#D97706', marginTop: 2 }}>{me.agent.commission_rate}%</div>
              </Card>
            </Col>
            {SUPPORTED_GAMES.map(g => {
              const rate = gameCommissions[g.key] ?? me.agent.commission_rate
              return (
                <Col xs={12} sm={6} md={3} key={g.key}>
                  <Card size="small" style={{ background: '#F8FAFC', textAlign: 'center', borderRadius: 10, border: '1px solid #E2E8F0' }}>
                    <Text style={{ fontSize: 10, display: 'block', color: '#334155' }}>{g.icon} {g.label}</Text>
                    <div style={{ fontSize: 16, fontWeight: 800, color: g.color, marginTop: 2 }}>{rate}%</div>
                  </Card>
                </Col>
              )
            })}
          </Row>
        </Card>

        {/* Action Buttons */}
        <div style={{ marginBottom: 16, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <Button
            type="primary"
            size="large"
            icon={<WalletOutlined />}
            style={{ background: tokens.gradient.goldButton, border: 0, color: '#000000', fontWeight: 700, borderRadius: 12, flex: 1, minWidth: 200 }}
            onClick={() => { payoutForm.resetFields(); setPayoutModalOpen(true) }}
          >
            Request Payout / Withdrawal (₹)
          </Button>

          {!me.agent.parent_agent_id && (
            <Button
              type="default"
              size="large"
              icon={<PlusOutlined />}
              style={{ borderRadius: 12, fontWeight: 600, flex: 1, minWidth: 160 }}
              onClick={() => { subAgentForm.resetFields(); setSubAgentModalOpen(true) }}
            >
              + Create Sub-Agent
            </Button>
          )}
        </div>

        {/* Main Tabs */}
        <Card bordered={false} className="agent-tabs-card" style={{ background: '#FFFFFF', borderRadius: 18, border: '1px solid #E2E8F0' }}>
          <Tabs items={[
            {
              key: 'players',
              label: <span><UserOutlined /> Players ({players.length})</span>,
              children: (
                <div>
                  <Input
                    placeholder="Search player username or mobile..."
                    value={playerSearch}
                    onChange={e => setPlayerSearch(e.target.value)}
                    style={{ maxWidth: 360, marginBottom: 16, borderRadius: 10 }}
                    allowClear
                  />
                  <Table
                    rowKey="username"
                    dataSource={filteredPlayers}
                    pagination={{ pageSize: 10 }}
                    scroll={{ x: 'max-content' }}
                    size="small"
                    columns={[
                      {
                        title: 'Player',
                        render: (_: any, r: any) => (
                          <div>
                            <Text strong style={{ color: '#0F172A' }}>{r.username}</Text>
                            <div><Text type="secondary" style={{ fontSize: 11 }}>{r.phone || 'Direct'}</Text></div>
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
                        render: (v: any) => <Text strong style={{ color: '#D97706' }}>₹ {Number(v || 0).toFixed(2)}</Text>
                      },
                      {
                        title: 'Net GGR (₹)',
                        dataIndex: 'net_house_win',
                        render: (v: any) => (
                          <Text strong style={{ color: Number(v) >= 0 ? '#059669' : '#E11D48' }}>
                            ₹ {Number(v || 0).toFixed(2)}
                          </Text>
                        )
                      },
                      {
                        title: 'Joined',
                        dataIndex: 'created_at',
                        render: (t: string) => dayjs(t).format('DD MMM YYYY')
                      },
                      {
                        title: 'Last Active',
                        dataIndex: 'last_active',
                        render: (t: string) => t ? dayjs(t).format('DD MMM hh:mm A') : <Text type="secondary">-</Text>
                      }
                    ]}
                  />
                </div>
              )
            },
            {
              key: 'sub_agents',
              label: <span><BranchesOutlined /> Sub-Agents ({me.sub_agents?.length || 0})</span>,
              children: (
                <div>
                  <Table
                    rowKey="id"
                    dataSource={me.sub_agents || []}
                    pagination={{ pageSize: 10 }}
                    scroll={{ x: 'max-content' }}
                    size="small"
                    columns={[
                      {
                        title: 'Sub-Agent',
                        render: (_: any, r: any) => (
                          <div>
                            <Text strong style={{ color: '#0F172A' }}>{r.display_name}</Text>
                            <div><Text type="secondary">@{r.username} {r.phone ? `· ${r.phone}` : ''}</Text></div>
                          </div>
                        )
                      },
                      {
                        title: 'Their Rate',
                        dataIndex: 'commission_rate',
                        render: (r: any) => <Tag color="orange">{r}%</Tag>
                      },
                      {
                        title: 'Your Override',
                        render: (_: any, r: any) => {
                          const diff = Math.max(0, me.agent.commission_rate - Number(r.commission_rate))
                          return <Tag color="green">+{diff.toFixed(1)}%</Tag>
                        }
                      },
                      {
                        title: 'Players',
                        dataIndex: 'player_count',
                        render: (c: number) => `${c || 0}`
                      },
                      {
                        title: 'Balance (₹)',
                        dataIndex: 'balance',
                        render: (v: any) => `₹ ${Number(v || 0).toFixed(2)}`
                      },
                      {
                        title: 'Joined',
                        dataIndex: 'created_at',
                        render: (t: string) => dayjs(t).format('DD MMM YYYY')
                      }
                    ]}
                  />
                </div>
              )
            },
            {
              key: 'ledger',
              label: <span><TrophyOutlined /> Ledger</span>,
              children: (
                <div>
                  <Card size="small" style={{ background: '#F8FAFC', borderRadius: 14, marginBottom: 16, border: '1px solid #E2E8F0' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, flexWrap: 'wrap', gap: 8 }}>
                      <div>
                        <Text strong style={{ color: '#0F172A', fontSize: 14 }}>⚡ Today's Live Estimated Commission (IST)</Text>
                        <div><Text type="secondary" style={{ fontSize: 11 }}>Settles into your available balance at 00:00 IST.</Text></div>
                      </div>
                      <Tag color="cyan" style={{ fontSize: 12, padding: '2px 8px' }}>
                        Est: ₹ {Number(liveCommission.today?.total_commission || 0).toFixed(2)}
                      </Tag>
                    </div>

                    <Row gutter={10}>
                      <Col xs={8}>
                        <Statistic title={<span style={{ color: '#64748B', fontSize: 11 }}>Direct</span>} value={liveCommission.today?.direct_commission || 0} precision={2} prefix="₹ " valueStyle={{ fontSize: 14 }} />
                      </Col>
                      <Col xs={8}>
                        <Statistic title={<span style={{ color: '#64748B', fontSize: 11 }}>Override</span>} value={liveCommission.today?.override_commission || 0} precision={2} prefix="₹ " valueStyle={{ fontSize: 14 }} />
                      </Col>
                      <Col xs={8}>
                        <Statistic title={<span style={{ color: '#64748B', fontSize: 11 }}>Total</span>} value={liveCommission.today?.total_commission || 0} precision={2} prefix="₹ " valueStyle={{ color: '#059669', fontWeight: 800, fontSize: 15 }} />
                      </Col>
                    </Row>
                  </Card>

                  <Table
                    rowKey="id"
                    dataSource={ledger}
                    pagination={{ pageSize: 10 }}
                    scroll={{ x: 'max-content' }}
                    size="small"
                    columns={[
                      {
                        title: 'Date',
                        dataIndex: 'date',
                        render: (d: string) => dayjs(d).format('DD MMM YYYY')
                      },
                      {
                        title: 'Direct (₹)',
                        dataIndex: 'direct_commission',
                        render: (v: any) => `₹ ${Number(v || 0).toFixed(2)}`
                      },
                      {
                        title: 'Override (₹)',
                        dataIndex: 'override_commission',
                        render: (v: any) => `₹ ${Number(v || 0).toFixed(2)}`
                      },
                      {
                        title: 'Total (₹)',
                        dataIndex: 'total_commission',
                        render: (v: any) => <Text strong style={{ color: '#059669' }}>₹ {Number(v || 0).toFixed(2)}</Text>
                      },
                      {
                        title: 'Status',
                        dataIndex: 'status',
                        render: (st: string) => <Tag color={st === 'settled' ? 'green' : 'red'}>{st?.toUpperCase()}</Tag>
                      }
                    ]}
                  />
                </div>
              )
            },
            {
              key: 'payouts',
              label: <span><HistoryOutlined /> Payouts</span>,
              children: (
                <div>
                  <Table
                    rowKey="id"
                    dataSource={payouts}
                    pagination={{ pageSize: 10 }}
                    scroll={{ x: 'max-content' }}
                    size="small"
                    columns={[
                      {
                        title: 'Requested',
                        dataIndex: 'requested_at',
                        render: (t: string) => dayjs(t).format('DD MMM YYYY')
                      },
                      {
                        title: 'Amount (₹)',
                        dataIndex: 'amount',
                        render: (v: any) => <Text strong style={{ color: '#faad14', fontSize: 14 }}>₹ {Number(v).toFixed(2)}</Text>
                      },
                      {
                        title: 'Payment Details / UPI',
                        dataIndex: 'metadata',
                        render: (m: any) => {
                          const data = typeof m === 'string' ? JSON.parse(m) : (m || {})
                          return (
                            <div>
                              {data.upi_id && <div><Tag color="cyan">UPI: {data.upi_id}</Tag></div>}
                              {data.bank_account && <div><Text type="secondary" style={{ fontSize: 11 }}>A/C: {data.bank_account} ({data.ifsc})</Text></div>}
                            </div>
                          )
                        }
                      },
                      {
                        title: 'Status',
                        dataIndex: 'status',
                        render: (st: string) => (
                          <Tag color={st === 'paid' ? 'green' : st === 'rejected' ? 'red' : 'gold'}>
                            {st?.toUpperCase()}
                          </Tag>
                        )
                      },
                      {
                        title: 'Reference',
                        dataIndex: 'reference',
                        render: (ref: string) => ref ? <Text code>{ref}</Text> : <Text type="secondary">Pending</Text>
                      }
                    ]}
                  />
                </div>
              )
            },
            {
              key: 'referrals',
              label: <span><AimOutlined /> Funnel Analytics</span>,
              children: <AgentFunnelAnalyticsView />,
            },
            {
              key: 'channels',
              label: <span><ShareAltOutlined /> Channels</span>,
              children: (
                <div>
                  <Form form={channelForm} layout="vertical" onFinish={addChannel} style={{ marginBottom: 16 }}>
                    <Row gutter={10}>
                      <Col xs={24} sm={8}>
                        <Form.Item name="platform" label="Platform" rules={[{ required: true }]} initialValue="telegram">
                          <Select options={[
                            { value: 'telegram', label: 'Telegram' },
                            { value: 'whatsapp', label: 'WhatsApp' },
                            { value: 'youtube', label: 'YouTube' },
                            { value: 'instagram', label: 'Instagram' },
                            { value: 'other', label: 'Other' },
                          ]} />
                        </Form.Item>
                      </Col>
                      <Col xs={24} sm={8}>
                        <Form.Item name="label" label="Channel Name" rules={[{ required: true, message: 'Label required' }]}>
                          <Input placeholder="e.g. VIP Telegram Group" />
                        </Form.Item>
                      </Col>
                      <Col xs={24} sm={8}>
                        <Form.Item name="url" label="Channel URL" rules={[{ required: true, message: 'URL required' }]}>
                          <Input placeholder="https://t.me/..." />
                        </Form.Item>
                      </Col>
                    </Row>
                    <Button type="primary" htmlType="submit" block>Submit Channel</Button>
                  </Form>

                  <Table
                    rowKey="id"
                    dataSource={channels}
                    scroll={{ x: 'max-content' }}
                    size="small"
                    columns={[
                      { title: 'Platform', dataIndex: 'platform', render: (v: string) => <Tag color="blue">{v?.toUpperCase()}</Tag> },
                      { title: 'Label', dataIndex: 'label' },
                      { title: 'URL', dataIndex: 'url', render: (v: string) => <a href={v} target="_blank" rel="noreferrer">{v}</a> },
                      {
                        title: 'Status',
                        dataIndex: 'status',
                        render: (v: string, r: any) => (
                          <Tag color={v === 'approved' ? 'green' : v === 'rejected' ? 'red' : 'gold'}>{v?.toUpperCase()}</Tag>
                        )
                      },
                      {
                        title: 'Action',
                        render: (_: any, r: any) => (
                          <Popconfirm title="Remove channel?" onConfirm={() => deleteChannel(r.id)}>
                            <Button danger size="small">Delete</Button>
                          </Popconfirm>
                        )
                      }
                    ]}
                  />
                </div>
              )
            }
          ]} />
        </Card>

        {/* Modal: Request Payout */}
        <Modal
          title="Request Commission Payout (₹)"
          open={payoutModalOpen}
          onCancel={() => setPayoutModalOpen(false)}
          footer={null}
          width="92%"
          style={{ maxWidth: 480 }}
        >
          <Alert
            type="info"
            message={`Available Balance: ₹${me.wallet.balance.toFixed(2)}`}
            description="Minimum payout is ₹100. Payouts are dispatched via IMPS / UPI within 24 hours."
            style={{ marginBottom: 16 }}
          />
          <Form form={payoutForm} layout="vertical" onFinish={handleRequestPayout}>
            <Form.Item name="amount" label="Withdrawal Amount (₹)" rules={[{ required: true }]}>
              <InputNumber min={100} max={me.wallet.balance} style={{ width: '100%' }} prefix="₹ " />
            </Form.Item>

            <Divider orientation="left" style={{ fontSize: 13 }}>Bank Transfer</Divider>
            <Form.Item name="account_holder" label="Account Holder Name">
              <Input placeholder="Full Name on Bank Account" />
            </Form.Item>
            <Row gutter={10}>
              <Col xs={14}>
                <Form.Item name="bank_account" label="Bank Account">
                  <Input placeholder="1234567890" />
                </Form.Item>
              </Col>
              <Col xs={10}>
                <Form.Item name="ifsc" label="IFSC Code">
                  <Input placeholder="HDFC0001234" />
                </Form.Item>
              </Col>
            </Row>

            <Divider orientation="left" style={{ fontSize: 13 }}>OR Instant UPI</Divider>
            <Form.Item name="upi_id" label="UPI ID (VPA)">
              <Input placeholder="username@upi or 9876543210@paytm" />
            </Form.Item>

            <Button type="primary" htmlType="submit" block size="large" style={{ background: tokens.gradient.goldButton, border: 0, color: '#000000', fontWeight: 700, marginTop: 8 }}>
              Submit Payout Request
            </Button>
          </Form>
        </Modal>

        {/* Modal: Create Sub-Agent */}
        <Modal
          title="Onboard New Sub-Agent"
          open={subAgentModalOpen}
          onCancel={() => setSubAgentModalOpen(false)}
          footer={null}
          width="92%"
          style={{ maxWidth: 520 }}
        >
          <Alert
            type="info"
            message="Sub-Agent Override Commission"
            description={`Set their rate up to ${me.agent.commission_rate}%. You earn the difference (spread) on all their players!`}
            style={{ marginBottom: 16 }}
          />
          <Form form={subAgentForm} layout="vertical" onFinish={handleCreateSubAgent}>
            <Row gutter={10}>
              <Col xs={12}>
                <Form.Item name="username" label="Login ID" rules={[{ required: true }]}>
                  <Input placeholder="sub_agent" />
                </Form.Item>
              </Col>
              <Col xs={12}>
                <Form.Item name="password" label="Password" rules={[{ required: true, min: 6 }]}>
                  <Input.Password placeholder="••••••••" />
                </Form.Item>
              </Col>
            </Row>
            <Row gutter={10}>
              <Col xs={12}>
                <Form.Item name="display_name" label="Display Name" rules={[{ required: true }]}>
                  <Input placeholder="John Doe" />
                </Form.Item>
              </Col>
              <Col xs={12}>
                <Form.Item name="phone" label="Mobile">
                  <Input placeholder="+91 9876543210" />
                </Form.Item>
              </Col>
            </Row>

            <Form.Item
              name="commission_rate"
              label={`Base Rate (%) (Max: ${me.agent.commission_rate}%)`}
              rules={[{ required: true }]}
              initialValue={Math.max(1, me.agent.commission_rate - 2)}
            >
              <InputNumber min={0.5} max={me.agent.commission_rate} step={0.5} style={{ width: '100%' }} suffix="%" />
            </Form.Item>

            <Button type="primary" htmlType="submit" block size="large" style={{ marginTop: 12 }}>
              Create Sub-Agent
            </Button>
          </Form>
        </Modal>

        {/* Modal: Change Password */}
        <Modal
          title="Change Password"
          open={passwordModalOpen}
          onCancel={() => setPasswordModalOpen(false)}
          footer={null}
          width="92%"
          style={{ maxWidth: 420 }}
        >
          <Form form={passwordForm} layout="vertical" onFinish={handleChangePassword}>
            <Form.Item name="current_password" label="Current Password" rules={[{ required: true }]}>
              <Input.Password placeholder="Current password" />
            </Form.Item>
            <Form.Item name="new_password" label="New Password (min 6 chars)" rules={[{ required: true, min: 6 }]}>
              <Input.Password placeholder="New secure password" />
            </Form.Item>
            <Button type="primary" htmlType="submit" block>
              Update Password
            </Button>
          </Form>
        </Modal>

        {/* Modal: QR Code */}
        <Modal
          title="Referral QR Code"
          open={qrModalOpen}
          onCancel={() => setQrModalOpen(false)}
          footer={null}
          width="92%"
          style={{ maxWidth: 360, textAlign: 'center' }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '12px 0' }}>
            <div style={{ background: '#FFFFFF', padding: 12, borderRadius: 12, border: '1px solid #E2E8F0' }}>
              <QRCode value={referralUrl} size={180} color="#000000" bordered={false} />
            </div>
            <Text strong style={{ marginTop: 14, fontSize: 14, color: '#0F172A' }}>Scan to Register with Code: {me.agent.referral_code}</Text>
            <Text type="secondary" style={{ fontSize: 11, marginTop: 4 }}>Save or share this QR code on posters & WhatsApp stories.</Text>
          </div>
        </Modal>

      </div>

      {/* Floating Mobile Bottom Dock for instant 1-tap actions */}
      <div className="mobile-bottom-dock">
        <Button
          type="primary"
          icon={<WhatsAppOutlined />}
          style={{ flex: 1, background: '#059669', borderColor: '#059669', fontWeight: 700, height: 42, borderRadius: 10 }}
          onClick={shareWhatsApp}
        >
          WhatsApp
        </Button>
        <Button
          icon={<CopyOutlined />}
          style={{ flex: 1, fontWeight: 600, height: 42, borderRadius: 10 }}
          onClick={copyReferralLink}
        >
          Copy Link
        </Button>
        <Button
          type="primary"
          icon={<WalletOutlined />}
          style={{ flex: 1, background: tokens.gradient.goldButton, border: 0, color: '#000000', fontWeight: 700, height: 42, borderRadius: 10 }}
          onClick={() => { payoutForm.resetFields(); setPayoutModalOpen(true) }}
        >
          Payout
        </Button>
      </div>
    </div>
  )
}

// -------------------------------------------------------------
// Component: Agent Affiliate Funnel & Conversion Intelligence
// -------------------------------------------------------------
function AgentFunnelAnalyticsView() {
  const [days, setDays] = useState<number>(30)
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(false)

  const loadData = () => {
    setLoading(true)
    adminApi.get('/agent-portal/referrals', { params: { days } })
      .then(r => setData(r.data))
      .catch(e => message.error('Failed to load funnel analytics'))
      .finally(() => setLoading(false))
  }

  useEffect(() => { loadData() }, [days])

  if (!data) return <div style={{ padding: 30, textAlign: 'center' }}>Loading funnel analytics...</div>

  const s = data.summary || {}
  const stages: any[] = data.stages || []
  const maxCount = Math.max(...stages.map(st => st.count), 1)
  const stageColors = ['#2563EB', '#0891B2', '#059669', '#D97706', '#7C3AED']

  return (
    <div>
      {/* Timeframe & Action Bar */}
      <Row justify="space-between" align="middle" gutter={[10, 10]} style={{ marginBottom: 16 }}>
        <Col xs={24} sm={14}>
          <Text strong style={{ color: '#0F172A', fontSize: 15 }}>Affiliate Conversion Funnel</Text>
          <div><Text type="secondary" style={{ fontSize: 11 }}>Track clicks, signups, deposits, and player wagering velocity.</Text></div>
        </Col>
        <Col xs={24} sm={10} style={{ textAlign: 'right' }}>
          <Space wrap size="small">
            <Radio.Group value={days} onChange={(e: any) => setDays(e.target.value)} buttonStyle="solid" size="small">
              <Radio.Button value={7}>7D</Radio.Button>
              <Radio.Button value={30}>30D</Radio.Button>
              <Radio.Button value={90}>90D</Radio.Button>
            </Radio.Group>
            <Button size="small" icon={<ReloadOutlined />} onClick={loadData} loading={loading}>Reload</Button>
          </Space>
        </Col>
      </Row>

      {/* Top High-Level Metrics */}
      <Row gutter={[10, 10]} style={{ marginBottom: 16 }}>
        <Col xs={12} sm={8} md={4}>
          <Card size="small" style={{ background: '#FFFFFF', borderRadius: 12, border: '1px solid #E2E8F0' }}>
            <Statistic title={<span style={{ fontSize: 11 }}>Clicks / Visits</span>} value={s.total_clicks} prefix={<GlobalOutlined style={{ color: '#2563EB' }} />} valueStyle={{ fontSize: 16 }} />
          </Card>
        </Col>
        <Col xs={12} sm={8} md={4}>
          <Card size="small" style={{ background: '#FFFFFF', borderRadius: 12, border: '1px solid #E2E8F0' }}>
            <Statistic title={<span style={{ fontSize: 11 }}>Signups</span>} value={s.signups} prefix={<UserOutlined style={{ color: '#0891B2' }} />} valueStyle={{ fontSize: 16 }} />
          </Card>
        </Col>
        <Col xs={12} sm={8} md={4}>
          <Card size="small" style={{ background: '#FFFFFF', borderRadius: 12, border: '1px solid #E2E8F0' }}>
            <Statistic title={<span style={{ fontSize: 11 }}>FTD Deposits</span>} value={s.ftds} prefix={<DollarOutlined style={{ color: '#059669' }} />} valueStyle={{ fontSize: 16 }} />
          </Card>
        </Col>
        <Col xs={12} sm={8} md={4}>
          <Card size="small" style={{ background: '#FFFFFF', borderRadius: 12, border: '1px solid #E2E8F0' }}>
            <Statistic title={<span style={{ fontSize: 11 }}>FTD Volume</span>} value={s.total_ftd_amount} precision={2} prefix="₹ " valueStyle={{ color: '#059669', fontWeight: 700, fontSize: 15 }} />
          </Card>
        </Col>
        <Col xs={12} sm={8} md={4}>
          <Card size="small" style={{ background: '#FFFFFF', borderRadius: 12, border: '1px solid #E2E8F0' }}>
            <Statistic title={<span style={{ fontSize: 11 }}>Player Turnover</span>} value={s.total_turnover} precision={2} prefix="₹ " valueStyle={{ color: '#D97706', fontWeight: 700, fontSize: 15 }} />
          </Card>
        </Col>
        <Col xs={12} sm={8} md={4}>
          <Card size="small" style={{ background: '#FFFFFF', borderRadius: 12, border: '1px solid #E2E8F0' }}>
            <Statistic title={<span style={{ fontSize: 11 }}>Conversion %</span>} value={s.overall_conversion_rate} precision={2} suffix="%" valueStyle={{ color: '#7C3AED', fontWeight: 800, fontSize: 16 }} />
          </Card>
        </Col>
      </Row>

      {/* Visual Multi-Stage Conversion Flow */}
      <Card title={<span style={{ fontSize: 14 }}>🪜 5-Stage Conversion Funnel</span>} style={{ background: '#FFFFFF', borderRadius: 16, marginBottom: 16, border: '1px solid #E2E8F0' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {stages.map((st, idx) => {
            const widthPct = Math.max(10, Math.round((st.count / maxCount) * 100))
            const color = stageColors[idx % stageColors.length]
            return (
              <div key={st.key} style={{ background: '#F8FAFC', borderRadius: 12, padding: '10px 14px', border: '1px solid #E2E8F0' }}>
                <Row justify="space-between" align="middle" gutter={[8, 4]} style={{ marginBottom: 4 }}>
                  <Col>
                    <Space size="small">
                      <span style={{ fontSize: 16 }}>{st.icon}</span>
                      <Text strong style={{ color: '#0F172A', fontSize: 13 }}>{st.label}</Text>
                    </Space>
                  </Col>
                  <Col>
                    <Space size="middle" wrap>
                      <div>
                        <Text type="secondary" style={{ fontSize: 11 }}>Count: </Text>
                        <Text strong style={{ fontSize: 14, color }}>{st.count.toLocaleString()}</Text>
                      </div>
                      {idx > 0 && (
                        <Tag color={st.conversion_from_prev >= 40 ? 'green' : st.conversion_from_prev >= 20 ? 'orange' : 'red'} style={{ fontWeight: 700, margin: 0, fontSize: 11 }}>
                          {st.conversion_from_prev}% step
                        </Tag>
                      )}
                    </Space>
                  </Col>
                </Row>
                <Progress
                  percent={widthPct}
                  strokeColor={color}
                  trailColor="#E2E8F0"
                  showInfo={false}
                  strokeWidth={8}
                  style={{ margin: 0 }}
                />
              </div>
            )
          })}
        </div>
      </Card>

      {/* Traffic Sources & Device Split */}
      <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
        <Col xs={24} md={16}>
          <Card title={<span style={{ fontSize: 14 }}>🌐 Sources Attribution</span>} style={{ background: '#FFFFFF', borderRadius: 16, border: '1px solid #E2E8F0' }}>
            <Table
              rowKey="source"
              dataSource={data.sources || []}
              pagination={false}
              scroll={{ x: 'max-content' }}
              size="small"
              columns={[
                {
                  title: 'Source',
                  dataIndex: 'source',
                  render: (s: string) => <Text strong style={{ color: '#0F172A' }}>{s}</Text>
                },
                {
                  title: 'Clicks',
                  dataIndex: 'clicks',
                  render: (v: number) => v.toLocaleString()
                },
                {
                  title: 'Signups',
                  dataIndex: 'signups',
                  render: (v: number) => v.toLocaleString()
                },
                {
                  title: 'Conv %',
                  dataIndex: 'conv_rate',
                  render: (r: number) => <Tag color={r >= 30 ? 'green' : 'blue'}>{r}%</Tag>
                },
                {
                  title: 'FTDs',
                  dataIndex: 'ftds',
                  render: (v: number) => v.toLocaleString()
                },
                {
                  title: 'Turnover (₹)',
                  dataIndex: 'turnover',
                  render: (v: number) => <Text strong style={{ color: '#D97706' }}>₹ {Number(v).toFixed(2)}</Text>
                }
              ]}
            />
          </Card>
        </Col>

        <Col xs={24} md={8}>
          <Card title={<span style={{ fontSize: 14 }}>📱 Device Breakdown</span>} style={{ background: '#FFFFFF', borderRadius: 16, border: '1px solid #E2E8F0' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {(data.devices || []).map((d: any) => (
                <div key={d.device_type} style={{ background: '#F8FAFC', padding: 10, borderRadius: 10, border: '1px solid #E2E8F0' }}>
                  <Row justify="space-between" align="middle">
                    <Col>
                      <Space>
                        {d.device_type === 'desktop' ? <DesktopOutlined style={{ color: '#2563EB', fontSize: 18 }} /> : d.device_type === 'tablet' ? <TabletOutlined style={{ color: '#7C3AED', fontSize: 18 }} /> : <MobileOutlined style={{ color: '#059669', fontSize: 18 }} />}
                        <Text strong style={{ textTransform: 'capitalize', color: '#0F172A', fontSize: 13 }}>{d.device_type}</Text>
                      </Space>
                    </Col>
                    <Col>
                      <Text strong style={{ fontSize: 14 }}>{d.count.toLocaleString()} clicks</Text>
                    </Col>
                  </Row>
                </div>
              ))}
            </div>
          </Card>
        </Col>
      </Row>

      {/* Daily Activity Series */}
      <Card title={<span style={{ fontSize: 14 }}>📅 Daily Conversion Velocity</span>} style={{ background: '#FFFFFF', borderRadius: 16, border: '1px solid #E2E8F0' }}>
        <Table
          rowKey="date"
          dataSource={data.daily_series || []}
          pagination={{ pageSize: 8 }}
          scroll={{ x: 'max-content' }}
          size="small"
          columns={[
            {
              title: 'Date',
              dataIndex: 'date',
              render: (d: string) => dayjs(d).format('DD MMM YYYY')
            },
            {
              title: 'Clicks',
              dataIndex: 'clicks',
              render: (v: number) => v.toLocaleString()
            },
            {
              title: 'Signups',
              dataIndex: 'signups',
              render: (v: number) => v.toLocaleString()
            },
            {
              title: 'FTDs',
              dataIndex: 'ftds',
              render: (v: number) => v.toLocaleString()
            },
            {
              title: 'Turnover (₹)',
              dataIndex: 'turnover',
              render: (v: number) => <Text strong style={{ color: '#D97706' }}>₹ {Number(v || 0).toFixed(2)}</Text>
            }
          ]}
        />
      </Card>
    </div>
  )
}
