import { useEffect, useState } from 'react'
import {
  Card, Tabs, Table, Tag, Button, Modal, Form, Input, Space, message, Popconfirm,
  Row, Col, Statistic, Tooltip, InputNumber, Select
} from 'antd'
import {
  LineChartOutlined, GlobalOutlined, ShareAltOutlined, CopyOutlined,
  PlusOutlined, DeleteOutlined, SaveOutlined, InfoCircleOutlined, MessageOutlined
} from '@ant-design/icons'
import { adminApi } from '../api/client'

interface Campaign {
  id: string
  name: string
  description?: string
  utm_source: string
  utm_medium?: string
  utm_campaign?: string
  clicks: number
  signups: number
  deposits: number
  total_deposit_amount: number
  is_active: boolean
  created_at: string
}

interface Referrer {
  referrer_id: string
  referrer_username: string
  referrer_phone: string
  total_referred: number
  qualified_referred: number
  rewards_earned: number
}

function CampaignsTab() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [loading, setLoading] = useState(false)
  const [creating, setCreating] = useState(false)
  const [form] = Form.useForm()

  const load = () => {
    setLoading(true)
    adminApi.get('/marketing/campaigns')
      .then(r => setCampaigns(r.data))
      .catch(() => message.error('Failed to load campaigns'))
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  const save = async () => {
    const v = await form.validateFields()
    try {
      await adminApi.post('/marketing/campaigns', v)
      message.success('Campaign created successfully')
      setCreating(false)
      form.resetFields()
      load()
    } catch (e: any) {
      message.error(e.response?.data?.error || 'Failed to create campaign')
    }
  }

  const remove = async (id: string) => {
    try {
      await adminApi.delete(`/marketing/campaigns/${id}`)
      message.success('Campaign deleted')
      load()
    } catch (e: any) {
      message.error('Failed to delete campaign')
    }
  }

  const copyLink = (r: Campaign) => {
    const baseUrl = window.location.origin
    const utmMedium = r.utm_medium ? `&utm_medium=${encodeURIComponent(r.utm_medium)}` : ''
    const utmCampaign = r.utm_campaign ? `&utm_campaign=${encodeURIComponent(r.utm_campaign)}` : ''
    const link = `${baseUrl}/?utm_source=${encodeURIComponent(r.utm_source)}${utmMedium}${utmCampaign}`
    navigator.clipboard.writeText(link)
    message.success('Tracking URL copied to clipboard!')
  }

  // Summary Metrics
  const totalClicks = campaigns.reduce((acc, c) => acc + c.clicks, 0)
  const totalSignups = campaigns.reduce((acc, c) => acc + c.signups, 0)
  const totalDeposits = campaigns.reduce((acc, c) => acc + c.deposits, 0)
  const totalRev = campaigns.reduce((acc, c) => acc + c.total_deposit_amount, 0)
  const avgConv = totalClicks > 0 ? ((totalSignups / totalClicks) * 100).toFixed(1) : '0.0'

  const columns = [
    { title: 'Campaign Name', dataIndex: 'name', fontWeight: 'bold' },
    {
      title: 'UTM Tracking Tags',
      render: (_: any, r: Campaign) => (
        <Space direction="vertical" size={2}>
          <Tag color="blue">source: {r.utm_source}</Tag>
          {r.utm_medium && <Tag color="cyan">medium: {r.utm_medium}</Tag>}
          {r.utm_campaign && <Tag color="purple">campaign: {r.utm_campaign}</Tag>}
        </Space>
      )
    },
    { title: 'Clicks', dataIndex: 'clicks', sorter: (a: Campaign, b: Campaign) => a.clicks - b.clicks },
    { title: 'Signups', dataIndex: 'signups', sorter: (a: Campaign, b: Campaign) => a.signups - b.signups },
    { title: 'Deposits', dataIndex: 'deposits', sorter: (a: Campaign, b: Campaign) => a.deposits - b.deposits },
    {
      title: 'Conversion Rate',
      render: (_: any, r: Campaign) => {
        const rate = r.clicks > 0 ? ((r.signups / r.clicks) * 100).toFixed(1) : '0.0'
        return <span>{rate}%</span>
      }
    },
    {
      title: 'Total Revenue',
      dataIndex: 'total_deposit_amount',
      render: (v: number) => `₹${Number(v).toLocaleString()}`,
      sorter: (a: Campaign, b: Campaign) => a.total_deposit_amount - b.total_deposit_amount
    },
    {
      title: 'Actions',
      render: (_: any, r: Campaign) => (
        <Space size="small">
          <Tooltip title="Copy Tracking Link">
            <Button size="small" icon={<CopyOutlined />} onClick={() => copyLink(r)}>Link</Button>
          </Tooltip>
          <Popconfirm title="Delete campaign?" onConfirm={() => remove(r.id)}>
            <Button size="small" type="text" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      )
    }
  ]

  return (
    <>
      <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
        <Col xs={12} sm={8} md={4}>
          <Card bordered={false} style={{ background: '#f6ffed' }}>
            <Statistic title="Total Clicks" value={totalClicks} valueStyle={{ color: '#389e0d' }} />
          </Card>
        </Col>
        <Col xs={12} sm={8} md={4}>
          <Card bordered={false} style={{ background: '#e6f4ff' }}>
            <Statistic title="Signups" value={totalSignups} valueStyle={{ color: '#096dd9' }} />
          </Card>
        </Col>
        <Col xs={12} sm={8} md={4}>
          <Card bordered={false} style={{ background: '#f9f0ff' }}>
            <Statistic title="Deposits" value={totalDeposits} valueStyle={{ color: '#531dab' }} />
          </Card>
        </Col>
        <Col xs={12} sm={8} md={4}>
          <Card bordered={false} style={{ background: '#fff7e6' }}>
            <Statistic title="Conversion Rate" value={`${avgConv}%`} valueStyle={{ color: '#d46b08' }} />
          </Card>
        </Col>
        <Col xs={24} sm={16} md={8}>
          <Card bordered={false} style={{ background: '#fff0f6' }}>
            <Statistic title="Total Revenue Generated" value={totalRev} prefix="₹" valueStyle={{ color: '#c41d7f', fontWeight: 'bold' }} />
          </Card>
        </Col>
      </Row>

      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <span style={{ fontSize: 16, fontWeight: 600 }}>Tracking Links & Channels</span>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => { setCreating(true); form.resetFields() }}>
          New Campaign Link
        </Button>
      </div>

      <Table dataSource={campaigns} columns={columns} rowKey="id" loading={loading} size="small" pagination={{ pageSize: 10 }} scroll={{ x: 'max-content' }} />

      <Modal
        open={creating}
        onCancel={() => setCreating(false)}
        onOk={save}
        title="Create Marketing Tracking URL"
        okText="Create Campaign"
        width={500}
      >
        <Form form={form} layout="vertical">
          <Form.Item name="name" label="Campaign Name" rules={[{ required: true, message: 'Please input campaign name' }]}>
            <Input placeholder="e.g. Facebook In-App Ad June" />
          </Form.Item>
          <Form.Item name="description" label="Description">
            <Input.TextArea placeholder="Details about where this URL is placed" rows={2} />
          </Form.Item>
          <Form.Item name="utm_source" label="UTM Source (utm_source)" rules={[{ required: true, message: 'Please input utm_source' }]}>
            <Input placeholder="e.g. facebook, google, telegram" />
          </Form.Item>
          <Space style={{ width: '100%' }}>
            <Form.Item name="utm_medium" label="UTM Medium (utm_medium)" style={{ minWidth: 220 }}>
              <Input placeholder="e.g. cpc, banner, bio" />
            </Form.Item>
            <Form.Item name="utm_campaign" label="UTM Campaign (utm_campaign)" style={{ minWidth: 220 }}>
              <Input placeholder="e.g. launch_promo" />
            </Form.Item>
          </Space>
        </Form>
      </Modal>
    </>
  )
}

function ReferralsTab() {
  const [referrers, setReferrers] = useState<Referrer[]>([])
  const [loading, setLoading] = useState(false)

  const load = () => {
    setLoading(true)
    adminApi.get('/marketing/referrals')
      .then(r => setReferrers(r.data))
      .catch(() => message.error('Failed to load referral data'))
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  const totalReferrals = referrers.reduce((acc, r) => acc + r.total_referred, 0)
  const totalRewards = referrers.reduce((acc, r) => acc + r.rewards_earned, 0)

  const columns = [
    { title: 'Referrer User ID', dataIndex: 'referrer_id', render: (v: string) => <Tag>{v.substring(0, 8)}...</Tag> },
    { title: 'Username', dataIndex: 'referrer_username', fontWeight: 'bold' },
    { title: 'Phone Number', dataIndex: 'referrer_phone' },
    { title: 'Total Referred Signups', dataIndex: 'total_referred', sorter: (a: Referrer, b: Referrer) => a.total_referred - b.total_referred },
    { title: 'Qualified Referrals', dataIndex: 'qualified_referred', sorter: (a: Referrer, b: Referrer) => a.qualified_referred - b.qualified_referred },
    {
      title: 'Total Rewards Earned',
      dataIndex: 'rewards_earned',
      render: (v: number) => `₹${Number(v).toLocaleString()}`,
      sorter: (a: Referrer, b: Referrer) => a.rewards_earned - b.rewards_earned
    }
  ]

  return (
    <>
      <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
        <Col xs={12} md={6}>
          <Card bordered={false} style={{ background: '#e6f4ff' }}>
            <Statistic title="Total Referred Accounts" value={totalReferrals} valueStyle={{ color: '#096dd9' }} />
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card bordered={false} style={{ background: '#fff0f6' }}>
            <Statistic title="Referral Rewards Distributed" value={totalRewards} prefix="₹" valueStyle={{ color: '#c41d7f', fontWeight: 'bold' }} />
          </Card>
        </Col>
      </Row>

      <div style={{ marginBottom: 16 }}>
        <span style={{ fontSize: 16, fontWeight: 600 }}>Top Referrers & Affiliates Leaderboard</span>
      </div>

      <Table dataSource={referrers} columns={columns} rowKey="referrer_id" loading={loading} size="small" pagination={{ pageSize: 15 }} scroll={{ x: 'max-content' }} />
    </>
  )
}

function GlobalSeoTab() {
  const [form] = Form.useForm()
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    adminApi.get('/seo/settings')
      .then(r => form.setFieldsValue(r.data))
      .catch(() => message.error('Failed to load SEO settings'))
  }, [])

  const save = async () => {
    const v = await form.validateFields()
    setSaving(true)
    try {
      await adminApi.post('/seo/settings', v)
      message.success('Global SEO and Marketing Settings saved')
    } catch {
      message.error('Failed to save SEO settings')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card bordered={false} style={{ maxWidth: 850, margin: '0 auto' }}>
      <Form form={form} layout="vertical" onFinish={save}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
          <span style={{ fontSize: 16, fontWeight: 600 }}>Website Search Engine Optimisation (SEO)</span>
          <Button type="primary" icon={<SaveOutlined />} htmlType="submit" loading={saving}>
            Save SEO Config
          </Button>
        </div>

        <Form.Item name="global_title" label="Global Site Title (meta title)" rules={[{ required: true }]}>
          <Input placeholder="Enter default title for homepage" />
        </Form.Item>

        <Form.Item name="global_description" label="Global Site Description (meta description)" rules={[{ required: true }]}>
          <Input.TextArea placeholder="Enter default page description" rows={3} />
        </Form.Item>

        <Form.Item name="global_keywords" label="Global Keywords (meta keywords)">
          <Input placeholder="e.g. teen patti, online betting, real money games" />
        </Form.Item>

        <Row gutter={16}>
          <Col span={12}>
            <Form.Item
              name="google_analytics_id"
              label={<span>Google Analytics ID <Tooltip title="Google Analytics 4 Measurement ID starting with G-"><InfoCircleOutlined /></Tooltip></span>}
            >
              <Input placeholder="G-XXXXXXXXXX" />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item
              name="facebook_pixel_id"
              label={<span>Facebook Pixel ID <Tooltip title="Meta/Facebook Pixel tracking ID"><InfoCircleOutlined /></Tooltip></span>}
            >
              <Input placeholder="e.g. 1234567890" />
            </Form.Item>
          </Col>
        </Row>

        <Form.Item
          name="robots_txt"
          label={<span>robots.txt Config <Tooltip title="Search engine crawler directives"><InfoCircleOutlined /></Tooltip></span>}
          rules={[{ required: true }]}
        >
          <Input.TextArea rows={4} style={{ fontFamily: 'monospace' }} />
        </Form.Item>

        <Form.Item
          name="custom_header_html"
          label={<span>Custom Header Script Tags <Tooltip title="Analytics scripts, SEO verification meta tags, custom widgets injected directly in HTML <head>"><InfoCircleOutlined /></Tooltip></span>}
        >
          <Input.TextArea rows={4} placeholder="<script>...</script>" style={{ fontFamily: 'monospace' }} />
        </Form.Item>
      </Form>
    </Card>
  )
}

interface AgentChannel {
  id: string
  agent_id: string
  agent_display_name: string
  platform: string
  label: string
  url: string
  status: string
  rejection_reason?: string
  created_at: string
}

function AgentChannelsTab() {
  const [channels, setChannels] = useState<AgentChannel[]>([])
  const [loading, setLoading] = useState(false)
  const [statusFilter, setStatusFilter] = useState<string | undefined>('pending')
  const [rejecting, setRejecting] = useState<AgentChannel | null>(null)
  const [reason, setReason] = useState('')

  const load = () => {
    setLoading(true)
    adminApi.get('/agent-channels', { params: statusFilter ? { status: statusFilter } : {} })
      .then(r => setChannels(r.data))
      .catch(() => message.error('Failed to load channels'))
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() /* eslint-disable-next-line */ }, [statusFilter])

  const approve = async (id: string) => {
    try {
      await adminApi.patch(`/agent-channels/${id}`, { status: 'approved' })
      message.success('Channel approved')
      load()
    } catch (e: any) {
      message.error(e.response?.data?.error || 'Failed to approve')
    }
  }

  const reject = async () => {
    if (!reason.trim()) { message.warning('Rejection reason required'); return }
    try {
      await adminApi.patch(`/agent-channels/${rejecting!.id}`, { status: 'rejected', rejection_reason: reason })
      message.success('Channel rejected')
      setRejecting(null)
      setReason('')
      load()
    } catch (e: any) {
      message.error(e.response?.data?.error || 'Failed to reject')
    }
  }

  return (
    <>
      <Space style={{ marginBottom: 16 }}>
        <Select value={statusFilter} onChange={setStatusFilter} style={{ width: 160 }} allowClear placeholder="All statuses">
          <Select.Option value="pending">Pending</Select.Option>
          <Select.Option value="approved">Approved</Select.Option>
          <Select.Option value="rejected">Rejected</Select.Option>
        </Select>
      </Space>
      <Table rowKey="id" dataSource={channels} loading={loading} columns={[
        { title: 'Agent', dataIndex: 'agent_display_name' },
        { title: 'Platform', dataIndex: 'platform', render: (v: string) => v.charAt(0).toUpperCase() + v.slice(1) },
        { title: 'Label', dataIndex: 'label' },
        { title: 'URL', dataIndex: 'url', render: (v: string) => <a href={v} target="_blank" rel="noreferrer">{v}</a> },
        { title: 'Status', dataIndex: 'status', render: (v: string) => (
          <Tag color={v === 'approved' ? 'green' : v === 'rejected' ? 'red' : 'orange'}>{v.toUpperCase()}</Tag>
        )},
        { title: 'Submitted', dataIndex: 'created_at', render: (d: string) => new Date(d).toLocaleString() },
        {
          title: 'Actions', render: (r: AgentChannel) => r.status === 'pending' ? (
            <Space>
              <Button size="small" type="primary" onClick={() => approve(r.id)}>Approve</Button>
              <Button size="small" danger onClick={() => setRejecting(r)}>Reject</Button>
            </Space>
          ) : null,
        },
      ]} />
      <Modal title="Reject Channel" open={!!rejecting} onCancel={() => { setRejecting(null); setReason('') }} onOk={reject}>
        <p>Reason for rejection (required):</p>
        <Input.TextArea rows={3} value={reason} onChange={e => setReason(e.target.value)} placeholder="e.g. Not an official group, suspicious link" />
      </Modal>
    </>
  )
}

export default function Marketing() {
  return (
    <Card title="SEO & Marketing System">
      <Tabs defaultActiveKey="campaigns" items={[
        { key: 'campaigns', label: <><ShareAltOutlined /> UTM Tracking Links</>, children: <CampaignsTab /> },
        { key: 'referrals', label: <><LineChartOutlined /> Referral Analytics</>, children: <ReferralsTab /> },
        { key: 'agent_channels', label: <><MessageOutlined /> Agent Channels</>, children: <AgentChannelsTab /> },
        { key: 'seo', label: <><GlobalOutlined /> Global SEO Settings</>, children: <GlobalSeoTab /> }
      ]} />
    </Card>
  )
}
