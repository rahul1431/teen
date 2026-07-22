import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Card, Table, Tabs, Statistic, Row, Col, Button, Modal, Form, InputNumber, Input, message } from 'antd'
import { adminApi } from '../api/client'
import { useAuthStore } from '../store/auth'

export default function AgentPortal() {
  const [me, setMe] = useState<any>(null)
  const [players, setPlayers] = useState<any[]>([])
  const [ledger, setLedger] = useState<any[]>([])
  const [payoutModalOpen, setPayoutModalOpen] = useState(false)
  const [form] = Form.useForm()
  const navigate = useNavigate()
  const logout = useAuthStore(s => s.logout)

  const load = async () => {
    const [meRes, playersRes, ledgerRes] = await Promise.all([
      adminApi.get('/agent-portal/me'),
      adminApi.get('/agent-portal/players'),
      adminApi.get('/agent-portal/ledger'),
    ])
    setMe(meRes.data)
    setPlayers(playersRes.data)
    setLedger(ledgerRes.data)
  }

  useEffect(() => { load() }, [])

  const requestPayout = async (values: any) => {
    if (!values.bank_account?.trim() && !values.upi_id?.trim()) {
      message.error('Enter a bank account or a UPI ID to receive the payout')
      return
    }
    try {
      await adminApi.post('/agent-portal/payout', values)
      message.success('Payout requested')
      setPayoutModalOpen(false)
      form.resetFields()
      load()
    } catch (e: any) {
      message.error(e.response?.data?.error || 'Failed to request payout')
    }
  }

  if (!me) return null

  return (
    <div style={{ padding: 24, maxWidth: 1000, margin: '0 auto' }}>
      <Row justify="space-between" align="middle" style={{ marginBottom: 16 }}>
        <Col><h2>{me.agent.display_name}'s Dashboard</h2></Col>
        <Col><Button onClick={() => { logout(); navigate('/admin/agent/login') }}>Log Out</Button></Col>
      </Row>

      <Row gutter={16} style={{ marginBottom: 24 }}>
        <Col span={6}><Card><Statistic title="Available Balance" value={me.wallet.balance} prefix="₹" precision={2} /></Card></Col>
        <Col span={6}><Card><Statistic title="Pending Payout" value={me.wallet.locked_balance} prefix="₹" precision={2} /></Card></Col>
        <Col span={6}><Card><Statistic title="Total Earned" value={me.wallet.total_earned} prefix="₹" precision={2} /></Card></Col>
        <Col span={6}><Card><Statistic title="Your Referral Code" value={me.agent.referral_code} /></Card></Col>
      </Row>

      <Button type="primary" onClick={() => setPayoutModalOpen(true)} style={{ marginBottom: 16 }}>Request Payout</Button>

      <Tabs
        items={[
          {
            key: 'players', label: `Your Players (${players.length})`,
            children: <Table rowKey="username" dataSource={players} columns={[
              { title: 'Username', dataIndex: 'username' },
              { title: 'Joined', dataIndex: 'created_at', render: (v: string) => new Date(v).toLocaleDateString() },
              { title: 'Last Active', dataIndex: 'last_active', render: (v: string | null) => v ? new Date(v).toLocaleDateString() : '—' },
            ]} />,
          },
          ...((me.sub_agents?.length ?? 0) > 0 ? [{
            key: 'sub_agents', label: `Your Sub-Agents (${me.sub_agents?.length ?? 0})`,
            children: <Table rowKey="id" dataSource={me.sub_agents ?? []} columns={[
              { title: 'Name', dataIndex: 'display_name' },
              { title: 'Their Rate', dataIndex: 'commission_rate', render: (v: number) => `${v}%` },
            ]} />,
          }] : []),
          {
            key: 'ledger', label: 'Commission History',
            children: <Table rowKey="date" dataSource={ledger} columns={[
              { title: 'Date', dataIndex: 'date' },
              { title: 'Direct', dataIndex: 'direct_commission', render: (v: number) => `₹${v.toFixed(2)}` },
              { title: 'Override', dataIndex: 'override_commission', render: (v: number) => `₹${v.toFixed(2)}` },
              { title: 'Total', dataIndex: 'total_commission', render: (v: number) => `₹${v.toFixed(2)}` },
            ]} />,
          },
        ]}
      />

      <Modal title="Request Payout" open={payoutModalOpen} onCancel={() => setPayoutModalOpen(false)} onOk={() => form.submit()}>
        <Form form={form} layout="vertical" onFinish={requestPayout}>
          <Form.Item name="amount" label={`Amount (available: ₹${me.wallet.balance.toFixed(2)})`} rules={[{ required: true }]}>
            <InputNumber min={100} max={me.wallet.balance} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="bank_account" label="Bank Account (or leave blank and fill UPI below)"><Input /></Form.Item>
          <Form.Item name="upi_id" label="UPI ID"><Input /></Form.Item>
        </Form>
      </Modal>
    </div>
  )
}
