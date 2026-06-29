import { useEffect, useState } from 'react'
import {
  Table, Input, Select, Button, Tag, Space, Modal, Descriptions, InputNumber,
  message, Popconfirm, Tabs, List, Empty, Form, Checkbox, Tooltip,
} from 'antd'
import {
  SearchOutlined, StopOutlined, CheckCircleOutlined, DollarOutlined,
  MinusCircleOutlined, FlagOutlined,
} from '@ant-design/icons'
import { adminApi } from '../api/client'

type User = {
  id: string; username: string; phone: string; email?: string;
  real_balance?: string; bonus_balance?: string; status: string; kyc_status: string;
  referral_code?: string; created_at: string;
}

export default function Users() {
  const [users, setUsers] = useState<User[]>([])
  const [loading, setLoading] = useState(false)
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [selectedUser, setSelectedUser] = useState<User | null>(null)
  const [walletModal, setWalletModal] = useState<'credit' | 'debit' | null>(null)
  const [walletAmount, setWalletAmount] = useState<number>(0)
  const [walletNote, setWalletNote] = useState('')

  const fetchUsers = async (p = page) => {
    setLoading(true)
    try {
      const res = await adminApi.get('/users', {
        params: { page: p, limit: 20, search, status: statusFilter, is_bot: false },
      })
      setUsers(res.data.users ?? [])
      setTotal(res.data.total ?? 0)
    } catch (e: any) {
      message.error(e?.response?.data?.error || 'Failed to load users')
    } finally { setLoading(false) }
  }

  useEffect(() => { fetchUsers() /* eslint-disable-next-line */ }, [page, search, statusFilter])

  const updateStatus = async (userId: string, status: string) => {
    await adminApi.patch(`/users/${userId}/status`, { status })
    message.success(`User ${status}`)
    fetchUsers()
  }

  const adjustWallet = async () => {
    if (!selectedUser || walletAmount <= 0) return
    try {
      await adminApi.post(`/users/${selectedUser.id}/${walletModal}`, {
        amount: walletAmount,
        description: walletNote || undefined,
      })
      message.success(`₹${walletAmount} ${walletModal === 'credit' ? 'credited' : 'debited'}`)
      setWalletModal(null); setWalletAmount(0); setWalletNote('')
      fetchUsers()
    } catch (e: any) {
      message.error(e.response?.data?.error || 'Operation failed')
    }
  }

  const columns = [
    { title: 'Username', dataIndex: 'username' },
    { title: 'Phone', dataIndex: 'phone' },
    { title: 'Balance', key: 'balance', render: (r: User) => `₹${parseFloat(r.real_balance || '0').toFixed(2)}` },
    { title: 'KYC', dataIndex: 'kyc_status', render: (s: string) => (
      <Tag color={{ pending: 'default', under_review: 'orange', approved: 'green', rejected: 'red' }[s] || 'default'}>{s}</Tag>
    )},
    { title: 'Status', dataIndex: 'status', render: (s: string) => (
      <Tag color={{ active: 'green', suspended: 'orange', banned: 'red' }[s] || 'default'}>{s}</Tag>
    )},
    { title: 'Joined', dataIndex: 'created_at', render: (d: string) => new Date(d).toLocaleDateString() },
    {
      title: 'Actions', key: 'actions',
      render: (r: User) => (
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
        </Space>
      ),
    },
  ]

  return (
    <div>
      <Space style={{ marginBottom: 16 }}>
        <Input.Search placeholder="Search username / phone" onSearch={setSearch}
          style={{ width: 250 }} enterButton={<SearchOutlined />} />
        <Select placeholder="Status" allowClear style={{ width: 140 }} onChange={(v) => setStatusFilter(v || '')}>
          <Select.Option value="active">Active</Select.Option>
          <Select.Option value="suspended">Suspended</Select.Option>
          <Select.Option value="banned">Banned</Select.Option>
        </Select>
      </Space>

      <Table dataSource={users} columns={columns as any} rowKey="id" loading={loading}
        pagination={{ total, pageSize: 20, current: page, onChange: setPage }} size="small" />

      <Modal title={selectedUser ? `User — ${selectedUser.username}` : ''} open={!!selectedUser && !walletModal}
        onCancel={() => setSelectedUser(null)} footer={null} width={820} destroyOnClose>
        {selectedUser && (
          <UserDetail
            user={selectedUser}
            onCredit={() => { setWalletModal('credit'); setWalletAmount(0); setWalletNote('') }}
            onDebit={() => { setWalletModal('debit'); setWalletAmount(0); setWalletNote('') }}
            onChanged={fetchUsers}
          />
        )}
      </Modal>

      <Modal
        title={`${walletModal === 'credit' ? 'Credit' : 'Debit'} Wallet — ${selectedUser?.username}`}
        open={!!walletModal} onOk={adjustWallet} onCancel={() => setWalletModal(null)}
        okButtonProps={{ danger: walletModal === 'debit', disabled: walletAmount <= 0 }}>
        <p style={{ marginBottom: 8 }}>Amount (₹):</p>
        <InputNumber min={1} max={100000} value={walletAmount} onChange={(v) => setWalletAmount(v || 0)} style={{ width: '100%' }} />
        <p style={{ margin: '12px 0 8px' }}>Reason / note (audit-logged):</p>
        <Input.TextArea rows={2} value={walletNote} onChange={(e) => setWalletNote(e.target.value)}
          placeholder={walletModal === 'credit' ? 'e.g. compensation for failed deposit' : 'e.g. reversed fraudulent win'} />
      </Modal>
    </div>
  )
}

// ---- Tabbed user detail ----
function UserDetail({ user, onCredit, onDebit, onChanged }: {
  user: User; onCredit: () => void; onDebit: () => void; onChanged: () => void;
}) {
  return (
    <Tabs
      defaultActiveKey="profile"
      items={[
        { key: 'profile', label: 'Profile', children: <ProfileTab user={user} onCredit={onCredit} onDebit={onDebit} /> },
        { key: 'transactions', label: 'Transactions', children: <TransactionsTab userId={user.id} /> },
        { key: 'kyc', label: 'KYC', children: <KycTab user={user} onChanged={onChanged} /> },
        { key: 'games', label: 'Game History', children: <GamesTab userId={user.id} /> },
        { key: 'notes', label: 'Notes', children: <NotesTab userId={user.id} /> },
        { key: 'audit', label: 'Audit Log', children: <AuditTab userId={user.id} /> },
      ]}
    />
  )
}

function ProfileTab({ user, onCredit, onDebit }: { user: User; onCredit: () => void; onDebit: () => void }) {
  return (
    <>
      <Descriptions bordered column={2} size="small">
        <Descriptions.Item label="ID">{user.id}</Descriptions.Item>
        <Descriptions.Item label="Username">{user.username}</Descriptions.Item>
        <Descriptions.Item label="Phone">{user.phone}</Descriptions.Item>
        <Descriptions.Item label="Email">{user.email || '-'}</Descriptions.Item>
        <Descriptions.Item label="Real Balance">₹{parseFloat(user.real_balance || '0').toFixed(2)}</Descriptions.Item>
        <Descriptions.Item label="Bonus Balance">₹{parseFloat(user.bonus_balance || '0').toFixed(2)}</Descriptions.Item>
        <Descriptions.Item label="KYC">{user.kyc_status}</Descriptions.Item>
        <Descriptions.Item label="Status">{user.status}</Descriptions.Item>
        <Descriptions.Item label="Referral Code">{user.referral_code || '-'}</Descriptions.Item>
        <Descriptions.Item label="Joined">{new Date(user.created_at).toLocaleString()}</Descriptions.Item>
      </Descriptions>
      <Space style={{ marginTop: 16 }}>
        <Button icon={<DollarOutlined />} onClick={onCredit}>Credit Wallet</Button>
        <Button danger icon={<MinusCircleOutlined />} onClick={onDebit}>Debit Wallet</Button>
      </Space>
    </>
  )
}

function TransactionsTab({ userId }: { userId: string }) {
  const [rows, setRows] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    setLoading(true)
    adminApi.get(`/users/${userId}/transactions`).then(r => setRows(r.data)).finally(() => setLoading(false))
  }, [userId])
  return (
    <Table dataSource={rows} rowKey="id" loading={loading} size="small" pagination={{ pageSize: 10 }}
      columns={[
        { title: 'When', dataIndex: 'created_at', render: (d: string) => new Date(d).toLocaleString() },
        { title: 'Type', dataIndex: 'type', render: (t: string) => <Tag>{t}</Tag> },
        { title: 'Wallet', dataIndex: 'wallet_type' },
        { title: 'Amount (₹)', dataIndex: 'amount', align: 'right' as const, render: (a: string) => parseFloat(a).toFixed(2) },
        { title: 'Balance After', dataIndex: 'balance_after', align: 'right' as const, render: (a: string) => parseFloat(a).toFixed(2) },
        { title: 'Status', dataIndex: 'status', render: (s: string) => <Tag color={s === 'completed' ? 'green' : 'orange'}>{s}</Tag> },
        { title: 'Description', dataIndex: 'description', ellipsis: true },
      ]} />
  )
}

function KycTab({ user, onChanged }: { user: User; onChanged: () => void }) {
  const [docs, setDocs] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [reason, setReason] = useState('')

  const reload = () => {
    setLoading(true)
    adminApi.get(`/users/${user.id}/kyc`).then(r => setDocs(r.data)).finally(() => setLoading(false))
  }
  useEffect(reload, [user.id])

  const setKyc = async (status: string) => {
    if (status === 'rejected' && !reason.trim()) {
      message.warning('Rejection reason required')
      return
    }
    await adminApi.patch(`/users/${user.id}/kyc`, { status, reason: reason || undefined })
    message.success(`KYC ${status}`)
    setReason('')
    reload()
    onChanged()
  }

  return (
    <>
      <p>Current KYC status: <Tag color={user.kyc_status === 'approved' ? 'green' : user.kyc_status === 'rejected' ? 'red' : 'orange'}>{user.kyc_status}</Tag></p>
      {loading ? <Empty description="Loading…" /> : docs.length === 0 ? <Empty description="No KYC documents submitted yet" /> : (
        <List dataSource={docs} renderItem={(d: any) => (
          <List.Item>
            <List.Item.Meta
              title={`${d.doc_type?.toUpperCase() || 'UNKNOWN'} — ${d.doc_number || 'no number'}`}
              description={`Submitted ${new Date(d.created_at).toLocaleString()} · Status: ${d.status}${d.rejection_reason ? ` · Reason: ${d.rejection_reason}` : ''}`}
            />
            {d.verified_name && <Tooltip title="Verified name from provider"><Tag>{d.verified_name}</Tag></Tooltip>}
          </List.Item>
        )} />
      )}
      <div style={{ marginTop: 16 }}>
        <Input.TextArea rows={2} placeholder="Rejection reason (required if rejecting)"
          value={reason} onChange={(e) => setReason(e.target.value)} />
        <Space style={{ marginTop: 8 }}>
          <Button type="primary" onClick={() => setKyc('approved')}>Approve</Button>
          <Button onClick={() => setKyc('under_review')}>Under Review</Button>
          <Button danger onClick={() => setKyc('rejected')}>Reject</Button>
        </Space>
      </div>
    </>
  )
}

function GamesTab({ userId }: { userId: string }) {
  const [rows, setRows] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    setLoading(true)
    adminApi.get(`/users/${userId}/games`).then(r => setRows(r.data)).finally(() => setLoading(false))
  }, [userId])
  return (
    <Table dataSource={rows} rowKey="id" loading={loading} size="small" pagination={{ pageSize: 10 }}
      columns={[
        { title: 'When', dataIndex: 'started_at', render: (d: string) => d ? new Date(d).toLocaleString() : '-' },
        { title: 'Game', dataIndex: 'game_type', render: (t: string) => <Tag>{t}</Tag> },
        { title: 'Status', dataIndex: 'status' },
        { title: 'Entry (₹)', dataIndex: 'entry_fee', align: 'right' as const, render: (a: string) => parseFloat(a || '0').toFixed(2) },
        { title: 'Pot (₹)', dataIndex: 'pot_amount', align: 'right' as const, render: (a: string) => parseFloat(a || '0').toFixed(2) },
        { title: 'Won (₹)', dataIndex: 'prize_won', align: 'right' as const,
          render: (a: string) => {
            const v = parseFloat(a || '0')
            return <span style={{ color: v > 0 ? '#52c41a' : undefined, fontWeight: v > 0 ? 600 : undefined }}>{v.toFixed(2)}</span>
          } },
      ]} />
  )
}

function NotesTab({ userId }: { userId: string }) {
  const [notes, setNotes] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [text, setText] = useState('')
  const [flag, setFlag] = useState(false)

  const reload = () => {
    setLoading(true)
    adminApi.get(`/users/${userId}/notes`).then(r => setNotes(r.data)).finally(() => setLoading(false))
  }
  useEffect(reload, [userId])

  const add = async () => {
    if (!text.trim()) return
    await adminApi.post(`/users/${userId}/notes`, { note: text.trim(), is_flag: flag })
    setText(''); setFlag(false)
    message.success('Note added')
    reload()
  }

  return (
    <>
      <Form layout="vertical" onFinish={add}>
        <Form.Item>
          <Input.TextArea rows={3} value={text} onChange={(e) => setText(e.target.value)}
            placeholder="Internal note about this user (e.g. called support 2024-01-12 re: failed deposit)" />
        </Form.Item>
        <Space>
          <Checkbox checked={flag} onChange={(e) => setFlag(e.target.checked)}>
            <FlagOutlined style={{ color: '#fa8c16' }} /> Flag (high-priority — show to all admins)
          </Checkbox>
          <Button type="primary" htmlType="submit" disabled={!text.trim()}>Add note</Button>
        </Space>
      </Form>
      <List style={{ marginTop: 16 }} loading={loading} dataSource={notes} locale={{ emptyText: 'No notes yet' }}
        renderItem={(n: any) => (
          <List.Item>
            <List.Item.Meta
              title={<>
                {n.is_flag && <FlagOutlined style={{ color: '#fa8c16', marginRight: 6 }} />}
                {n.admin_username || 'admin'} <span style={{ color: '#999', fontWeight: 400 }}>· {new Date(n.created_at).toLocaleString()}</span>
              </>}
              description={n.note}
            />
          </List.Item>
        )} />
    </>
  )
}

function AuditTab({ userId }: { userId: string }) {
  const [rows, setRows] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    setLoading(true)
    adminApi.get(`/users/${userId}/audit`).then(r => setRows(r.data)).finally(() => setLoading(false))
  }, [userId])
  return (
    <List loading={loading} dataSource={rows} locale={{ emptyText: 'No admin actions logged for this user' }}
      renderItem={(a: any) => (
        <List.Item>
          <List.Item.Meta
            title={<><Tag>{a.action}</Tag> by {a.admin_username || 'admin'}</>}
            description={<>
              <span style={{ color: '#999' }}>{new Date(a.created_at).toLocaleString()}</span>
              {a.details && Object.keys(a.details).length > 0 && (
                <pre style={{ margin: '4px 0 0', fontSize: 11, background: '#fafafa', padding: 6, borderRadius: 4 }}>
                  {JSON.stringify(a.details, null, 2)}
                </pre>
              )}
            </>}
          />
        </List.Item>
      )} />
  )
}
