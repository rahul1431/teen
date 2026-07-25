import { useEffect, useState } from 'react'
import {
  Card, Table, Input, InputNumber, Button, Select, Switch, Typography, Space,
  message, Tag, Modal, Form, Tabs, Popconfirm,
} from 'antd'
import { PlusOutlined, TrophyOutlined, ReloadOutlined } from '@ant-design/icons'
import { useAuthStore } from '../store/auth'

const { Title, Text } = Typography

interface Mission {
  id: string
  title: string
  description: string | null
  emoji: string
  category: 'weekly' | 'monthly' | 'one_time'
  metric_type: 'deposit_amount' | 'referral_count' | 'game_played' | 'telegram_join' | 'manual_proof'
  game_type: string | null
  min_stake: number | null
  target_value: number
  reward_amount: number
  reward_wallet_type: 'real' | 'bonus'
  max_completions_per_period: number | null
  verification_type: 'auto' | 'telegram_bot' | 'manual_review'
  is_active: boolean
  sort_order: number
}

const METRIC_LABELS: Record<Mission['metric_type'], string> = {
  deposit_amount: 'Deposit Amount (₹)',
  referral_count: 'Referral Count',
  game_played: 'Games Played',
  telegram_join: 'Telegram Group Join',
  manual_proof: 'Manual Proof (Review Queue)',
}

function MissionConfigTab() {
  const { token } = useAuthStore()
  const [missions, setMissions] = useState<Mission[]>([])
  const [loading, setLoading] = useState(true)
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<Mission | null>(null)
  const [form] = Form.useForm()

  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }

  const fetchMissions = async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/admin/missions', { headers })
      setMissions(await res.json())
    } catch {
      message.error('Failed to load missions')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchMissions() }, [])

  const openCreate = () => {
    setEditing(null)
    form.resetFields()
    form.setFieldsValue({ emoji: '🎯', reward_wallet_type: 'bonus', max_completions_per_period: 1, is_active: true, sort_order: 0 })
    setModalOpen(true)
  }

  const openEdit = (m: Mission) => {
    setEditing(m)
    form.setFieldsValue(m)
    setModalOpen(true)
  }

  const save = async () => {
    const values = await form.validateFields()
    const url = editing ? `/api/admin/missions/${editing.id}` : '/api/admin/missions'
    const method = editing ? 'PUT' : 'POST'
    const res = await fetch(url, { method, headers, body: JSON.stringify(values) })
    if (!res.ok) return message.error('Save failed')
    message.success(editing ? 'Mission updated' : 'Mission created')
    setModalOpen(false)
    fetchMissions()
  }

  const deactivate = async (id: string) => {
    const res = await fetch(`/api/admin/missions/${id}`, { method: 'DELETE', headers })
    if (!res.ok) return message.error('Failed to deactivate')
    message.success('Mission deactivated')
    fetchMissions()
  }

  const columns = [
    { title: 'Emoji', dataIndex: 'emoji', width: 60 },
    { title: 'Title', dataIndex: 'title' },
    { title: 'Category', dataIndex: 'category', render: (v: string) => <Tag color={v === 'weekly' ? 'blue' : v === 'monthly' ? 'purple' : 'gold'}>{v}</Tag> },
    { title: 'Metric', dataIndex: 'metric_type', render: (v: Mission['metric_type']) => METRIC_LABELS[v] },
    { title: 'Target', dataIndex: 'target_value' },
    { title: 'Reward', dataIndex: 'reward_amount', render: (v: number, row: Mission) => `₹${v} (${row.reward_wallet_type})` },
    { title: 'Max/Period', dataIndex: 'max_completions_per_period', render: (v: number | null) => v ?? 'Unlimited' },
    { title: 'Verification', dataIndex: 'verification_type' },
    { title: 'Active', dataIndex: 'is_active', render: (v: boolean) => <Tag color={v ? 'green' : 'default'}>{v ? 'Active' : 'Inactive'}</Tag> },
    {
      title: '', width: 160,
      render: (_: any, row: Mission) => (
        <Space>
          <Button size="small" onClick={() => openEdit(row)}>Edit</Button>
          {row.is_active && (
            <Popconfirm title="Deactivate this mission?" onConfirm={() => deactivate(row.id)}>
              <Button size="small" danger>Deactivate</Button>
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ]

  return (
    <Card
      style={{ background: '#161b22', border: '1px solid #30363d' }}
      title={<Space><TrophyOutlined style={{ color: '#d4af37' }} /><Text style={{ color: '#fff' }}>Missions ({missions.length})</Text></Space>}
      extra={
        <Space>
          <Button icon={<ReloadOutlined />} onClick={fetchMissions}>Refresh</Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate} style={{ background: '#d4af37', borderColor: '#d4af37', color: '#000', fontWeight: 700 }}>
            New Mission
          </Button>
        </Space>
      }
    >
      <Table dataSource={missions} columns={columns} rowKey="id" loading={loading} pagination={false} scroll={{ x: 'max-content' }} size="small" />

      <Modal title={editing ? 'Edit Mission' : 'New Mission'} open={modalOpen} onCancel={() => setModalOpen(false)} onOk={save} okText="Save" destroyOnClose>
        <Form form={form} layout="vertical">
          <Form.Item name="title" label="Title" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="description" label="Description"><Input.TextArea rows={2} /></Form.Item>
          <Form.Item name="emoji" label="Emoji" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="category" label="Category" rules={[{ required: true }]}>
            <Select options={[{ value: 'weekly', label: 'Weekly' }, { value: 'monthly', label: 'Monthly' }, { value: 'one_time', label: 'One-time' }]} />
          </Form.Item>
          <Form.Item name="metric_type" label="Metric" rules={[{ required: true }]}>
            <Select options={Object.entries(METRIC_LABELS).map(([value, label]) => ({ value, label }))} />
          </Form.Item>
          <Form.Item name="game_type" label="Game Type (only for Games Played)">
            <Select allowClear options={[{ value: 'teen_patti', label: 'Teen Patti' }, { value: 'ludo', label: 'Ludo' }]} />
          </Form.Item>
          <Form.Item name="min_stake" label="Min Stake (only for Games Played)"><InputNumber min={0} style={{ width: '100%' }} /></Form.Item>
          <Form.Item name="target_value" label="Target Value" rules={[{ required: true }]}><InputNumber min={0.01} style={{ width: '100%' }} /></Form.Item>
          <Form.Item name="reward_amount" label="Reward Amount (₹)" rules={[{ required: true }]}><InputNumber min={0.01} style={{ width: '100%' }} /></Form.Item>
          <Form.Item name="reward_wallet_type" label="Reward Wallet" rules={[{ required: true }]}>
            <Select options={[{ value: 'bonus', label: '🎁 Bonus' }, { value: 'real', label: '💵 Real' }]} />
          </Form.Item>
          <Form.Item name="max_completions_per_period" label="Max Completions Per Period (blank = unlimited)">
            <InputNumber min={1} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="verification_type" label="Verification" rules={[{ required: true }]}>
            <Select options={[{ value: 'auto', label: 'Automatic' }, { value: 'telegram_bot', label: 'Telegram Bot' }, { value: 'manual_review', label: 'Manual Review' }]} />
          </Form.Item>
          <Form.Item name="sort_order" label="Sort Order"><InputNumber style={{ width: '100%' }} /></Form.Item>
          <Form.Item name="is_active" label="Active" valuePropName="checked"><Switch /></Form.Item>
        </Form>
      </Modal>
    </Card>
  )
}

interface Submission {
  id: string
  user_id: string
  username: string
  mission_id: string
  mission_title: string
  period_key: string
  reward_amount: number
  proof_url: string | null
  created_at: string
}

interface Stats {
  today: { completions: number; distributed: number }
  all_time: { completions: number; distributed: number }
  pending_review: number
}

function ReviewQueueTab() {
  const { token } = useAuthStore()
  const [submissions, setSubmissions] = useState<Submission[]>([])
  const [stats, setStats] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)
  const [rejectTarget, setRejectTarget] = useState<Submission | null>(null)
  const [rejectReason, setRejectReason] = useState('')

  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }

  const fetchAll = async () => {
    setLoading(true)
    try {
      const [subsRes, statsRes] = await Promise.all([
        fetch('/api/admin/missions/review-queue', { headers }),
        fetch('/api/admin/missions/stats', { headers }),
      ])
      setSubmissions(await subsRes.json())
      setStats(await statsRes.json())
    } catch {
      message.error('Failed to load review queue')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchAll() }, [])

  const approve = async (id: string) => {
    const res = await fetch(`/api/admin/missions/review-queue/${id}/approve`, { method: 'POST', headers })
    if (!res.ok) return message.error('Approve failed')
    message.success('Approved — wallet credited')
    fetchAll()
  }

  const reject = async () => {
    if (!rejectTarget || !rejectReason.trim()) return message.warning('Enter a rejection reason')
    const res = await fetch(`/api/admin/missions/review-queue/${rejectTarget.id}/reject`, {
      method: 'POST', headers, body: JSON.stringify({ reason: rejectReason }),
    })
    if (!res.ok) return message.error('Reject failed')
    message.success('Rejected')
    setRejectTarget(null)
    setRejectReason('')
    fetchAll()
  }

  const columns = [
    { title: 'User', dataIndex: 'username' },
    { title: 'Mission', dataIndex: 'mission_title' },
    { title: 'Period', dataIndex: 'period_key' },
    { title: 'Reward', dataIndex: 'reward_amount', render: (v: number) => `₹${v}` },
    { title: 'Proof', dataIndex: 'proof_url', render: (v: string | null) => v ? <a href={v} target="_blank" rel="noreferrer">View</a> : '—' },
    { title: 'Submitted', dataIndex: 'created_at', render: (v: string) => new Date(v).toLocaleString() },
    {
      title: '', width: 180,
      render: (_: any, row: Submission) => (
        <Space>
          <Button size="small" type="primary" onClick={() => approve(row.id)} style={{ background: '#00c853', borderColor: '#00c853' }}>Approve</Button>
          <Button size="small" danger onClick={() => setRejectTarget(row)}>Reject</Button>
        </Space>
      ),
    },
  ]

  return (
    <>
      {stats && (
        <Space style={{ marginBottom: 16 }} size="large">
          <Text style={{ color: '#8b949e' }}>Today: <Text style={{ color: '#00c853' }}>{stats.today.completions} completions, ₹{stats.today.distributed}</Text></Text>
          <Text style={{ color: '#8b949e' }}>All-time: <Text style={{ color: '#d4af37' }}>{stats.all_time.completions} completions, ₹{stats.all_time.distributed}</Text></Text>
          <Tag color="orange">{stats.pending_review} pending review</Tag>
        </Space>
      )}
      <Table dataSource={submissions} columns={columns} rowKey="id" loading={loading} pagination={false} scroll={{ x: 'max-content' }} size="small" />
      <Modal title="Reject Submission" open={!!rejectTarget} onCancel={() => setRejectTarget(null)} onOk={reject} okText="Reject" okButtonProps={{ danger: true }}>
        <Input.TextArea rows={3} placeholder="Reason for rejection" value={rejectReason} onChange={e => setRejectReason(e.target.value)} />
      </Modal>
    </>
  )
}

export default function Missions() {
  return (
    <div style={{ padding: 24, background: '#0d1117', minHeight: '100vh' }}>
      <Title level={3} style={{ color: '#fff' }}><TrophyOutlined style={{ color: '#d4af37', marginRight: 10 }} />Missions</Title>
      <Text style={{ color: '#8b949e', display: 'block', marginBottom: 24 }}>Configure player missions and review manual submissions</Text>
      <Tabs
        items={[
          { key: 'config', label: 'Mission Config', children: <MissionConfigTab /> },
          { key: 'review', label: 'Review Queue', children: <ReviewQueueTab /> },
        ]}
      />
    </div>
  )
}
