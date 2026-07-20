import { useEffect, useState } from 'react'
import { Table, Button, Modal, Form, Input, InputNumber, Select, Tag, Tabs, message, Popconfirm } from 'antd'
import { adminApi } from '../api/client'

interface Agent {
  id: string
  username: string
  display_name: string
  phone: string | null
  status: 'active' | 'suspended'
  parent_agent_id: string | null
  commission_rate: number
  referral_code: string
  balance: number
  total_earned: number
  player_count: number
  created_at: string
}

export default function Agents() {
  const [agents, setAgents] = useState<Agent[]>([])
  const [loading, setLoading] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [form] = Form.useForm()
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null)
  const [payouts, setPayouts] = useState<any[]>([])

  const load = async () => {
    setLoading(true)
    try {
      const res = await adminApi.get('/agents')
      setAgents(res.data)
    } finally {
      setLoading(false)
    }
  }

  const loadPayouts = async () => {
    const res = await adminApi.get('/agent-payouts', { params: { status: 'created' } })
    setPayouts(res.data)
  }

  useEffect(() => { load(); loadPayouts() }, [])

  const createAgent = async (values: any) => {
    try {
      await adminApi.post('/agents', values)
      message.success('Agent created')
      setModalOpen(false)
      form.resetFields()
      load()
    } catch (e: any) {
      message.error(e.response?.data?.error || 'Failed to create agent')
    }
  }

  const toggleStatus = async (agent: Agent) => {
    const next = agent.status === 'active' ? 'suspended' : 'active'
    try {
      await adminApi.patch(`/agents/${agent.id}`, { status: next })
      message.success(`Agent ${next}`)
      load()
    } catch (e: any) {
      message.error(e.response?.data?.error || 'Failed to update agent status')
    }
  }

  const decidePayout = async (id: string, status: 'paid' | 'rejected') => {
    const reference = status === 'paid' ? window.prompt('Bank/UPI reference (optional):') || undefined : undefined
    try {
      await adminApi.patch(`/agent-payouts/${id}`, { status, reference })
      message.success(`Payout ${status}`)
      loadPayouts()
      load()
    } catch (e: any) {
      message.error(e.response?.data?.error || 'Failed to update payout')
    }
  }

  const columns = [
    { title: 'Agent', dataIndex: 'display_name', render: (v: string, r: Agent) => `${v} (@${r.username})` },
    { title: 'Parent', dataIndex: 'parent_agent_id', render: (id: string | null) => id ? (agents.find(a => a.id === id)?.display_name || id) : '— (Master)' },
    { title: 'Rate', dataIndex: 'commission_rate', render: (v: number) => `${v}%` },
    { title: 'Players', dataIndex: 'player_count' },
    { title: 'Balance', dataIndex: 'balance', render: (v: number) => `₹${v.toFixed(2)}` },
    { title: 'Total Earned', dataIndex: 'total_earned', render: (v: number) => `₹${v.toFixed(2)}` },
    { title: 'Referral Code', dataIndex: 'referral_code' },
    { title: 'Status', dataIndex: 'status', render: (v: string) => <Tag color={v === 'active' ? 'green' : 'red'}>{v}</Tag> },
    {
      title: 'Actions', render: (_: any, r: Agent) => (
        <>
          <Button size="small" onClick={() => setSelectedAgent(r)}>View</Button>{' '}
          <Popconfirm title={`${r.status === 'active' ? 'Suspend' : 'Reactivate'} this agent?`} onConfirm={() => toggleStatus(r)}>
            <Button size="small" danger={r.status === 'active'}>{r.status === 'active' ? 'Suspend' : 'Reactivate'}</Button>
          </Popconfirm>
        </>
      ),
    },
  ]

  return (
    <div>
      <Tabs
        items={[
          {
            key: 'agents',
            label: 'Agents',
            children: (
              <>
                <Button type="primary" onClick={() => setModalOpen(true)} style={{ marginBottom: 16 }}>New Agent</Button>
                <Table rowKey="id" columns={columns} dataSource={agents} loading={loading} />
              </>
            ),
          },
          {
            key: 'payouts',
            label: `Pending Payouts (${payouts.length})`,
            children: (
              <Table
                rowKey="id"
                dataSource={payouts}
                columns={[
                  { title: 'Agent', dataIndex: 'display_name' },
                  { title: 'Amount', dataIndex: 'amount', render: (v: number) => `₹${v.toFixed(2)}` },
                  { title: 'Requested', dataIndex: 'requested_at', render: (v: string) => new Date(v).toLocaleString() },
                  { title: 'Details', dataIndex: 'metadata', render: (v: any) => v?.bank_account || v?.upi_id || '—' },
                  {
                    title: 'Actions', render: (_: any, r: any) => (
                      <>
                        <Popconfirm title="Approve this payout?" onConfirm={() => decidePayout(r.id, 'paid')}>
                          <Button size="small" type="primary">Approve</Button>
                        </Popconfirm>{' '}
                        <Popconfirm title="Reject this payout?" onConfirm={() => decidePayout(r.id, 'rejected')}>
                          <Button size="small" danger>Reject</Button>
                        </Popconfirm>
                      </>
                    ),
                  },
                ]}
              />
            ),
          },
        ]}
      />

      <Modal title="New Agent" open={modalOpen} onCancel={() => setModalOpen(false)} onOk={() => form.submit()}>
        <Form form={form} layout="vertical" onFinish={createAgent}>
          <Form.Item name="username" label="Username" rules={[{ required: true, min: 3 }]}><Input /></Form.Item>
          <Form.Item name="password" label="Password" rules={[{ required: true, min: 6 }]}><Input.Password /></Form.Item>
          <Form.Item name="display_name" label="Display Name" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="phone" label="Phone"><Input /></Form.Item>
          <Form.Item name="commission_rate" label="Commission Rate (%)" rules={[{ required: true }]}>
            <InputNumber min={0} max={100} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="parent_agent_id" label="Parent Agent (leave empty for Master Agent)">
            <Select allowClear options={agents.filter(a => a.parent_agent_id === null).map(a => ({ value: a.id, label: `${a.display_name} (${a.commission_rate}%)` }))} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal title={selectedAgent?.display_name} open={!!selectedAgent} onCancel={() => setSelectedAgent(null)} footer={null} width={700}>
        {selectedAgent && <AgentDetail agent={selectedAgent} />}
      </Modal>
    </div>
  )
}

function AgentDetail({ agent }: { agent: Agent }) {
  const [players, setPlayers] = useState<any[]>([])
  const [ledger, setLedger] = useState<any[]>([])

  useEffect(() => {
    adminApi.get(`/agents/${agent.id}/players`).then(r => setPlayers(r.data))
    adminApi.get(`/agents/${agent.id}/ledger`).then(r => setLedger(r.data))
  }, [agent.id])

  const voidEntry = async (ledgerId: string) => {
    await adminApi.post(`/agents/${agent.id}/ledger/${ledgerId}/void`)
    message.success('Voided')
    adminApi.get(`/agents/${agent.id}/ledger`).then(r => setLedger(r.data))
  }

  return (
    <Tabs
      items={[
        {
          key: 'players', label: `Players (${players.length})`,
          children: <Table rowKey="id" size="small" dataSource={players} columns={[
            { title: 'Username', dataIndex: 'username' },
            { title: 'Joined', dataIndex: 'created_at', render: (v: string) => new Date(v).toLocaleDateString() },
            { title: 'Last Active', dataIndex: 'last_active', render: (v: string | null) => v ? new Date(v).toLocaleDateString() : '—' },
          ]} />,
        },
        {
          key: 'ledger', label: 'Commission History',
          children: <Table rowKey="id" size="small" dataSource={ledger} columns={[
            { title: 'Date', dataIndex: 'date' },
            { title: 'Direct', dataIndex: 'direct_commission', render: (v: number) => `₹${v.toFixed(2)}` },
            { title: 'Override', dataIndex: 'override_commission', render: (v: number) => `₹${v.toFixed(2)}` },
            { title: 'Total', dataIndex: 'total_commission', render: (v: number) => `₹${v.toFixed(2)}` },
            { title: 'Status', dataIndex: 'status', render: (v: string) => <Tag color={v === 'voided' ? 'red' : 'green'}>{v}</Tag> },
            {
              title: 'Actions', render: (_: any, r: any) => r.status === 'settled' ? (
                <Popconfirm title="Void this day's commission?" onConfirm={() => voidEntry(r.id)}>
                  <Button size="small" danger>Void</Button>
                </Popconfirm>
              ) : null,
            },
          ]} />,
        },
      ]}
    />
  )
}
