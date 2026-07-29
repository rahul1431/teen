import { useState, useEffect } from 'react'
import { Table, Tag, Button, Card, Row, Col, Statistic, Form, InputNumber, Space, message, Tooltip, Radio } from 'antd'
import { ReloadOutlined, BellOutlined } from '@ant-design/icons'
import { adminApi } from '../../api/client'

interface ChurnUser {
  id: string
  username: string
  phone: string
  score: number
  risk_level: 'low' | 'medium' | 'high'
  days_since_deposit: number | null
  last_deposit_at: string | null
  action_taken: string | null
  action_taken_at: string | null
}

interface ChurnStats {
  total_at_risk: number
  by_level: {
    low: number
    medium: number
    high: number
  }
  bonuses_sent_today: number
  notifications_sent_today: number
}

interface ChurnConfig {
  low_threshold_days: number
  medium_threshold_days: number
  high_threshold_days: number
  high_bonus_amount: number
  action_cooldown_days: number
  grace_period_days: number
}

const RISK_COLORS: Record<string, string> = { low: 'gold', medium: 'orange', high: 'red' }

export function ChurnTab() {
  const [users, setUsers] = useState<ChurnUser[]>([])
  const [stats, setStats] = useState<ChurnStats | null>(null)
  const [config, setConfig] = useState<ChurnConfig | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [riskFilter, setRiskFilter] = useState<string | undefined>(undefined)
  const [form] = Form.useForm()

  useEffect(() => {
    loadAll()
    window.addEventListener('aiDashboardRefresh', loadAll)
    return () => window.removeEventListener('aiDashboardRefresh', loadAll)
  }, [])
  useEffect(() => { loadUsers() }, [riskFilter])

  const loadAll = async () => {
    await Promise.all([loadUsers(), loadStats(), loadConfig()])
  }

  const loadUsers = async () => {
    setLoading(true)
    try {
      const params = riskFilter ? { risk_level: riskFilter } : {}
      const res = await adminApi.get('/churn/users', { params })
      if (res.data.success) setUsers(res.data.data.users)
    } catch { message.error('Failed to load at-risk users') }
    finally { setLoading(false) }
  }

  const loadStats = async () => {
    try {
      const res = await adminApi.get('/churn/stats')
      if (res.data.success) setStats(res.data.data)
    } catch { /* silent */ }
  }

  const loadConfig = async () => {
    try {
      const res = await adminApi.get('/churn/config')
      if (res.data.success) {
        setConfig(res.data.data)
        form.setFieldsValue(res.data.data)
      }
    } catch { /* silent */ }
  }

  const saveConfig = async (values: ChurnConfig) => {
    setSaving(true)
    try {
      const updates: Record<string, string> = {}
      for (const [k, v] of Object.entries(values)) updates[k] = String(v)
      await adminApi.patch('/churn/config', updates)
      message.success('Config saved')
    } catch { message.error('Failed to save config') }
    finally { setSaving(false) }
  }

  const reEngage = async (userId: string, sendBonus: boolean) => {
    try {
      await adminApi.post(`/churn/re-engage/${userId}`, {
        send_bonus: sendBonus,
        send_notification: true,
      })
      message.success(sendBonus ? 'Bonus + notification sent' : 'Notification sent')
      await loadAll()
    } catch { message.error('Failed to re-engage user') }
  }

  const columns = [
    { title: 'Username', dataIndex: 'username', key: 'username' },
    { title: 'Phone', dataIndex: 'phone', key: 'phone' },
    {
      title: 'Risk',
      dataIndex: 'risk_level',
      key: 'risk_level',
      render: (level: string) => <Tag color={RISK_COLORS[level] ?? 'default'}>{level?.toUpperCase()}</Tag>,
    },
    {
      title: 'Score',
      dataIndex: 'score',
      key: 'score',
      sorter: (a: ChurnUser, b: ChurnUser) => a.score - b.score,
      render: (v: number) => Math.round(v),
    },
    {
      title: 'Days Since Deposit',
      dataIndex: 'days_since_deposit',
      key: 'days_since_deposit',
      render: (v: number | null) => v != null ? `${Math.round(v)}d` : '—',
    },
    {
      title: 'Last Deposit',
      dataIndex: 'last_deposit_at',
      key: 'last_deposit_at',
      render: (v: string | null) =>
        v ? new Date(v).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'N/A',
    },
    {
      title: 'Last Action',
      dataIndex: 'action_taken',
      key: 'action_taken',
      render: (v: string | null, rec: ChurnUser) =>
        v ? <Tooltip title={rec.action_taken_at ? new Date(rec.action_taken_at).toLocaleString() : ''}><Tag>{v}</Tag></Tooltip> : '—',
    },
    {
      title: 'Re-Engage',
      key: 'actions',
      render: (_: unknown, rec: ChurnUser) => (
        <Space>
          <Button size="small" icon={<BellOutlined />} onClick={() => reEngage(rec.id, false)}>Notify</Button>
          <Button size="small" type="primary" onClick={() => reEngage(rec.id, true)}>Bonus + Notify</Button>
        </Space>
      ),
    },
  ]

  return (
    <div>
      {/* Stats Bar */}
      <Row gutter={16} style={{ marginBottom: 24 }}>
        <Col span={4}>
          <Card><Statistic title="Total At-Risk" value={stats?.total_at_risk ?? 0} /></Card>
        </Col>
        <Col span={4}>
          <Card><Statistic title="Low Risk" value={stats?.by_level?.low ?? 0} valueStyle={{ color: '#d4b106' }} /></Card>
        </Col>
        <Col span={4}>
          <Card><Statistic title="Medium Risk" value={stats?.by_level?.medium ?? 0} valueStyle={{ color: '#d46b08' }} /></Card>
        </Col>
        <Col span={4}>
          <Card><Statistic title="High Risk" value={stats?.by_level?.high ?? 0} valueStyle={{ color: '#cf1322' }} /></Card>
        </Col>
        <Col span={4}>
          <Card><Statistic title="Bonuses Sent Today" value={stats?.bonuses_sent_today ?? 0} /></Card>
        </Col>
        <Col span={4}>
          <Card><Statistic title="Notifications Sent Today" value={stats?.notifications_sent_today ?? 0} /></Card>
        </Col>
      </Row>

      <Row gutter={16}>
        {/* At-Risk Users Table */}
        <Col span={16}>
          <Card
            title="At-Risk Users"
            extra={<Button icon={<ReloadOutlined />} onClick={loadAll}>Refresh</Button>}
          >
            <div style={{ marginBottom: 12 }}>
              <Radio.Group
                value={riskFilter ?? 'all'}
                onChange={e => setRiskFilter(e.target.value === 'all' ? undefined : e.target.value)}
                buttonStyle="solid"
              >
                <Radio.Button value="all">All</Radio.Button>
                <Radio.Button value="low">Low</Radio.Button>
                <Radio.Button value="medium">Medium</Radio.Button>
                <Radio.Button value="high">High</Radio.Button>
              </Radio.Group>
            </div>
            <Table
              dataSource={users}
              columns={columns}
              rowKey="id"
              loading={loading}
              size="small"
              pagination={{ pageSize: 20 }}
            />
          </Card>
        </Col>

        {/* Config Panel */}
        <Col span={8}>
          <Card title="Threshold Config">
            {config && (
              <Form form={form} layout="vertical" onFinish={saveConfig} initialValues={config}>
                <Form.Item label="Low risk after (days)" name="low_threshold_days">
                  <InputNumber min={1} max={30} style={{ width: '100%' }} />
                </Form.Item>
                <Form.Item label="Medium risk after (days)" name="medium_threshold_days">
                  <InputNumber min={2} max={60} style={{ width: '100%' }} />
                </Form.Item>
                <Form.Item label="High risk after (days)" name="high_threshold_days">
                  <InputNumber min={3} max={90} style={{ width: '100%' }} />
                </Form.Item>
                <Form.Item label="High-risk bonus (₹)" name="high_bonus_amount">
                  <InputNumber min={0} max={1000} style={{ width: '100%' }} />
                </Form.Item>
                <Form.Item label="Cooldown between actions (days)" name="action_cooldown_days">
                  <InputNumber min={1} max={30} style={{ width: '100%' }} />
                </Form.Item>
                <Form.Item label="New-account grace period (days)" name="grace_period_days">
                  <InputNumber min={1} max={14} style={{ width: '100%' }} />
                </Form.Item>
                <Button type="primary" htmlType="submit" loading={saving} block>Save Config</Button>
              </Form>
            )}
          </Card>
        </Col>
      </Row>
    </div>
  )
}
