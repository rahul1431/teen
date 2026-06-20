import { useEffect, useState } from 'react'
import { Table, Input, Select, Button, Tag, Space, Modal, Descriptions, InputNumber, message, Popconfirm, Form } from 'antd'
import { SearchOutlined, StopOutlined, CheckCircleOutlined, DollarOutlined } from '@ant-design/icons'
import { adminApi } from '../api/client'

export default function Users() {
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(false)
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [selectedUser, setSelectedUser] = useState<any>(null)
  const [creditModalOpen, setCreditModalOpen] = useState(false)
  const [creditAmount, setCreditAmount] = useState(0)

  const fetchUsers = async (p = page) => {
    setLoading(true)
    try {
      const res = await adminApi.get('/users', { params: { page: p, limit: 20, search, status: statusFilter, is_bot: false } })
      setUsers(res.data.users)
      setTotal(res.data.total)
    } finally { setLoading(false) }
  }

  useEffect(() => { fetchUsers() }, [page, search, statusFilter])

  const updateStatus = async (userId: string, status: string) => {
    await adminApi.patch(`/users/${userId}/status`, { status })
    message.success(`User ${status}`)
    fetchUsers()
  }

  const creditWallet = async () => {
    await adminApi.post(`/users/${selectedUser.id}/credit`, { amount: creditAmount })
    message.success(`₹${creditAmount} credited`)
    setCreditModalOpen(false)
    fetchUsers()
  }

  const columns = [
    { title: 'Username', dataIndex: 'username', key: 'username' },
    { title: 'Phone', dataIndex: 'phone', key: 'phone' },
    { title: 'Balance (₹)', key: 'balance', render: (r: any) => `₹${parseFloat(r.real_balance || 0).toFixed(2)}` },
    { title: 'KYC', dataIndex: 'kyc_status', key: 'kyc_status', render: (s: string) => (
      <Tag color={{ pending: 'default', under_review: 'orange', approved: 'green', rejected: 'red' }[s] || 'default'}>{s}</Tag>
    )},
    { title: 'Status', dataIndex: 'status', key: 'status', render: (s: string) => (
      <Tag color={{ active: 'green', suspended: 'orange', banned: 'red' }[s] || 'default'}>{s}</Tag>
    )},
    { title: 'Joined', dataIndex: 'created_at', key: 'created_at', render: (d: string) => new Date(d).toLocaleDateString() },
    {
      title: 'Actions', key: 'actions',
      render: (r: any) => (
        <Space>
          <Button size="small" onClick={() => setSelectedUser(r)}>View</Button>
          {r.status === 'active' ? (
            <Popconfirm title="Suspend this user?" onConfirm={() => updateStatus(r.id, 'suspended')}>
              <Button size="small" danger icon={<StopOutlined />}>Suspend</Button>
            </Popconfirm>
          ) : (
            <Popconfirm title="Activate this user?" onConfirm={() => updateStatus(r.id, 'active')}>
              <Button size="small" icon={<CheckCircleOutlined />}>Activate</Button>
            </Popconfirm>
          )}
          <Button size="small" icon={<DollarOutlined />} onClick={() => { setSelectedUser(r); setCreditModalOpen(true) }}>
            Credit
          </Button>
        </Space>
      )
    },
  ]

  return (
    <div>
      <Space style={{ marginBottom: 16 }}>
        <Input.Search placeholder="Search username / phone" onSearch={setSearch} style={{ width: 250 }} enterButton={<SearchOutlined />} />
        <Select placeholder="Status" allowClear style={{ width: 140 }} onChange={setStatusFilter}>
          <Select.Option value="active">Active</Select.Option>
          <Select.Option value="suspended">Suspended</Select.Option>
          <Select.Option value="banned">Banned</Select.Option>
        </Select>
      </Space>

      <Table
        dataSource={users}
        columns={columns}
        rowKey="id"
        loading={loading}
        pagination={{ total, pageSize: 20, current: page, onChange: setPage }}
        size="small"
      />

      <Modal title="User Details" open={!!selectedUser && !creditModalOpen} onCancel={() => setSelectedUser(null)} footer={null} width={600}>
        {selectedUser && (
          <Descriptions bordered column={2} size="small">
            <Descriptions.Item label="ID">{selectedUser.id}</Descriptions.Item>
            <Descriptions.Item label="Username">{selectedUser.username}</Descriptions.Item>
            <Descriptions.Item label="Phone">{selectedUser.phone}</Descriptions.Item>
            <Descriptions.Item label="Email">{selectedUser.email || '-'}</Descriptions.Item>
            <Descriptions.Item label="Real Balance">₹{parseFloat(selectedUser.real_balance || 0).toFixed(2)}</Descriptions.Item>
            <Descriptions.Item label="Bonus Balance">₹{parseFloat(selectedUser.bonus_balance || 0).toFixed(2)}</Descriptions.Item>
            <Descriptions.Item label="KYC Status">{selectedUser.kyc_status}</Descriptions.Item>
            <Descriptions.Item label="Status">{selectedUser.status}</Descriptions.Item>
            <Descriptions.Item label="Referral Code">{selectedUser.referral_code}</Descriptions.Item>
            <Descriptions.Item label="Joined">{new Date(selectedUser.created_at).toLocaleString()}</Descriptions.Item>
          </Descriptions>
        )}
      </Modal>

      <Modal title={`Credit Wallet — ${selectedUser?.username}`} open={creditModalOpen} onOk={creditWallet} onCancel={() => setCreditModalOpen(false)}>
        <p>Amount to credit (₹):</p>
        <InputNumber min={1} max={100000} value={creditAmount} onChange={v => setCreditAmount(v || 0)} style={{ width: '100%' }} />
      </Modal>
    </div>
  )
}
