import { useEffect, useState } from 'react'
import { Table, Tag, Button, Space, message, Popconfirm, Select, Statistic, Row, Col, Card } from 'antd'
import { CheckOutlined, CloseOutlined } from '@ant-design/icons'
import { adminApi } from '../api/client'

export default function Finance() {
  const [withdrawals, setWithdrawals] = useState([])
  const [stats, setStats] = useState<any>({})
  const [loading, setLoading] = useState(false)
  const [statusFilter, setStatusFilter] = useState('created')

  const fetchWithdrawals = async () => {
    setLoading(true)
    try {
      const res = await adminApi.get('/finance/withdrawals', { params: { status: statusFilter } })
      setWithdrawals(res.data)
    } finally { setLoading(false) }
  }

  useEffect(() => {
    fetchWithdrawals()
    adminApi.get('/finance/stats').then(r => setStats(r.data)).catch(() => {})
  }, [statusFilter])

  const updateWithdrawal = async (id: string, status: 'paid' | 'refunded') => {
    await adminApi.patch(`/finance/withdrawals/${id}`, { status })
    message.success(`Withdrawal ${status === 'paid' ? 'approved' : 'rejected'}`)
    fetchWithdrawals()
  }

  const columns = [
    { title: 'User', dataIndex: 'username' },
    { title: 'Amount (₹)', dataIndex: 'amount', render: (v: number) => `₹${parseFloat(v as any).toFixed(2)}` },
    { title: 'UPI / Bank', key: 'payment', render: (r: any) => r.metadata?.upi_id || r.metadata?.bank_account || '-' },
    { title: 'Requested', dataIndex: 'created_at', render: (d: string) => new Date(d).toLocaleString() },
    { title: 'Status', dataIndex: 'status', render: (s: string) => (
      <Tag color={{ created: 'orange', paid: 'green', failed: 'red', refunded: 'purple' }[s] || 'default'}>{s}</Tag>
    )},
    {
      title: 'Actions', render: (r: any) => r.status === 'created' ? (
        <Space>
          <Popconfirm title="Approve this withdrawal?" onConfirm={() => updateWithdrawal(r.id, 'paid')}>
            <Button size="small" type="primary" icon={<CheckOutlined />}>Approve</Button>
          </Popconfirm>
          <Popconfirm title="Reject this withdrawal?" onConfirm={() => updateWithdrawal(r.id, 'refunded')}>
            <Button size="small" danger icon={<CloseOutlined />}>Reject</Button>
          </Popconfirm>
        </Space>
      ) : '-'
    },
  ]

  return (
    <div>
      <Row gutter={16} style={{ marginBottom: 24 }}>
        <Col span={6}><Card><Statistic title="Revenue Today (₹)" value={stats.revenue_today || 0} precision={2} /></Card></Col>
        <Col span={6}><Card><Statistic title="Revenue This Month (₹)" value={stats.revenue_month || 0} precision={2} /></Card></Col>
        <Col span={6}><Card><Statistic title="Total Deposits Today (₹)" value={stats.deposits_today || 0} precision={2} /></Card></Col>
        <Col span={6}><Card><Statistic title="Total Withdrawn Today (₹)" value={stats.withdrawals_today || 0} precision={2} /></Card></Col>
      </Row>

      <Space style={{ marginBottom: 16 }}>
        <Select value={statusFilter} onChange={setStatusFilter} style={{ width: 160 }}>
          <Select.Option value="created">Pending</Select.Option>
          <Select.Option value="paid">Approved</Select.Option>
          <Select.Option value="refunded">Rejected</Select.Option>
        </Select>
      </Space>

      <Table dataSource={withdrawals} columns={columns} rowKey="id" loading={loading} size="small" />
    </div>
  )
}
