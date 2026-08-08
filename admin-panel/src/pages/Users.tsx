import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  Table, Input, Select, Button, Tag, Space, Modal, Descriptions, InputNumber,
  message, Popconfirm, Tabs, List, Empty, Form, Checkbox, Tooltip, Row, Col, Card, Typography,
} from 'antd'
import {
  SearchOutlined, StopOutlined, CheckCircleOutlined, DollarOutlined,
  MinusCircleOutlined, FlagOutlined, KeyOutlined, CopyOutlined,
  ExportOutlined, SendOutlined, EyeOutlined, DownloadOutlined,
  ReloadOutlined, PictureOutlined,
} from '@ant-design/icons'
import { adminApi } from '../api/client'
import { tokens } from '../theme/tokens'

type User = {
  id: string; username: string; phone: string; email?: string;
  real_balance?: string; bonus_balance?: string; status: string; kyc_status: string;
  referral_code?: string; created_at: string;
}

export default function Users() {
  const [searchParams, setSearchParams] = useSearchParams()
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
  const [resetPwOpen, setResetPwOpen] = useState(false)
  const [resetPwValue, setResetPwValue] = useState('')

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

  // Deep-link from Risk Center etc: /admin/users?id=<userId> opens that user's
  // detail modal directly instead of landing on the generic paginated list.
  useEffect(() => {
    const deepLinkId = searchParams.get('id')
    if (!deepLinkId) return
    adminApi.get('/users', { params: { id: deepLinkId, is_bot: false } }).then(res => {
      const user = (res.data.users ?? [])[0]
      if (user) setSelectedUser(user)
      else message.error('User not found')
    }).finally(() => {
      const next = new URLSearchParams(searchParams)
      next.delete('id')
      setSearchParams(next, { replace: true })
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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

  const generateTempPassword = () => {
    const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'
    let pw = ''
    for (let i = 0; i < 10; i++) pw += chars[Math.floor(Math.random() * chars.length)]
    setResetPwValue(pw)
  }

  const openResetPassword = () => {
    generateTempPassword()
    setResetPwOpen(true)
  }

  const doResetPassword = async () => {
    if (!selectedUser || resetPwValue.length < 6) {
      message.warning('Password must be at least 6 characters'); return
    }
    try {
      await adminApi.post(`/users/${selectedUser.id}/reset-password`, { password: resetPwValue })
      message.success(`Password reset for ${selectedUser.username} — share it with them securely`)
      setResetPwOpen(false)
    } catch (e: any) {
      message.error(e.response?.data?.error || 'Failed to reset password')
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
        <Space wrap>
          <Button size="small" onClick={() => setSelectedUser(r)}>View</Button>
          <Button
            size="small"
            icon={<ExportOutlined />}
            href={`/admin/users/view/${r.id}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            Open in New Tab
          </Button>
          <Tooltip title="Reset Password">
            <Button
              size="small"
              icon={<KeyOutlined />}
              onClick={() => {
                setSelectedUser(r)
                generateTempPassword()
                setResetPwOpen(true)
              }}
            />
          </Tooltip>
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
      {/* Top KPI Strip */}
      <Row gutter={[16, 16]} style={{ marginBottom: 20 }}>
        <Col xs={12} sm={6}>
          <Card size="small" style={{ borderRadius: 12 }}>
            <Typography.Text type="secondary" style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase' }}>
              Total Registered
            </Typography.Text>
            <div style={{ fontSize: 22, fontWeight: 800, color: tokens.color.textPrimary, marginTop: 2 }}>
              {total.toLocaleString()}
            </div>
          </Card>
        </Col>

        <Col xs={12} sm={6}>
          <Card size="small" style={{ borderRadius: 12 }}>
            <Typography.Text type="secondary" style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase' }}>
              Filtered Count
            </Typography.Text>
            <div style={{ fontSize: 22, fontWeight: 800, color: tokens.color.gold, marginTop: 2 }}>
              {users.length}
            </div>
          </Card>
        </Col>

        <Col xs={12} sm={6}>
          <Card size="small" style={{ borderRadius: 12 }}>
            <Typography.Text type="secondary" style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase' }}>
              Active Filter Status
            </Typography.Text>
            <div style={{ fontSize: 16, fontWeight: 700, color: tokens.color.emerald, marginTop: 4 }}>
              {statusFilter ? statusFilter.toUpperCase() : 'ALL PLAYERS'}
            </div>
          </Card>
        </Col>

        <Col xs={12} sm={6}>
          <Card size="small" style={{ borderRadius: 12 }}>
            <Typography.Text type="secondary" style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase' }}>
              Page
            </Typography.Text>
            <div style={{ fontSize: 22, fontWeight: 800, color: tokens.color.info, marginTop: 2 }}>
              {page}
            </div>
          </Card>
        </Col>
      </Row>

      <Space style={{ marginBottom: 16, width: '100%', justifyContent: 'space-between' }} wrap>
        <Space wrap>
          <Input.Search
            placeholder="Search username or phone..."
            onSearch={setSearch}
            style={{ width: 280, borderRadius: 10 }}
            enterButton={<SearchOutlined />}
            allowClear
          />
          <Select
            placeholder="Status Filter"
            allowClear
            style={{ width: 160 }}
            onChange={(v) => setStatusFilter(v || '')}
          >
            <Select.Option value="active">Active</Select.Option>
            <Select.Option value="suspended">Suspended</Select.Option>
            <Select.Option value="banned">Banned</Select.Option>
          </Select>
        </Space>

        <Button
          icon={<SearchOutlined />}
          onClick={() => fetchUsers()}
          style={{ borderRadius: 10, fontWeight: 600 }}
        >
          Refresh List
        </Button>
      </Space>

      <Table dataSource={users} columns={columns as any} rowKey="id" loading={loading}
        pagination={{ total, pageSize: 20, current: page, onChange: setPage }} size="small" scroll={{ x: 'max-content' }} />

      <Modal title={selectedUser ? `User — ${selectedUser.username}` : ''} open={!!selectedUser && !walletModal}
        onCancel={() => setSelectedUser(null)} footer={null} width={880} destroyOnHidden>
        {selectedUser && (
          <UserDetailTabs
            user={selectedUser}
            onCredit={() => { setWalletModal('credit'); setWalletAmount(0); setWalletNote('') }}
            onDebit={() => { setWalletModal('debit'); setWalletAmount(0); setWalletNote('') }}
            onResetPassword={openResetPassword}
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

      <Modal
        title={`Reset Password — ${selectedUser?.username}`}
        open={resetPwOpen}
        onCancel={() => setResetPwOpen(false)}
        footer={[
          <Button key="close" onClick={() => setResetPwOpen(false)}>Close</Button>,
          <Button key="reset" type="primary" danger disabled={resetPwValue.length < 6} onClick={doResetPassword}>
            Reset Password
          </Button>,
        ]}
      >
        <p style={{ marginBottom: 8, color: '#666' }}>
          A temporary password is generated below. Share it with the user through a secure
          channel — they should change it after logging in.
        </p>
        <Space.Compact style={{ width: '100%' }}>
          <Input value={resetPwValue} onChange={(e) => setResetPwValue(e.target.value)} />
          <Button icon={<KeyOutlined />} onClick={generateTempPassword}>Generate</Button>
          <Button icon={<CopyOutlined />} onClick={() => { navigator.clipboard.writeText(resetPwValue); message.success('Copied') }} />
        </Space.Compact>
      </Modal>
    </div>
  )
}

// ---- Tabbed user detail ----
export function UserDetailTabs({ user, onCredit, onDebit, onResetPassword, onChanged }: {
  user: User; onCredit: () => void; onDebit: () => void; onResetPassword: () => void; onChanged: () => void;
}) {
  return (
    <Tabs
      defaultActiveKey="profile"
      items={[
        { key: 'profile', label: 'Profile', children: <ProfileTab user={user} onCredit={onCredit} onDebit={onDebit} onResetPassword={onResetPassword} /> },
        { key: 'transactions', label: 'Transactions', children: <TransactionsTab userId={user.id} /> },
        { key: 'kyc', label: 'KYC', children: <KycTab user={user} onChanged={onChanged} /> },
        { key: 'games', label: 'Game History', children: <GamesTab userId={user.id} /> },
        { key: 'notes', label: 'Notes', children: <NotesTab userId={user.id} /> },
        { key: 'audit', label: 'Audit Log', children: <AuditTab userId={user.id} /> },
        { key: 'contacts', label: 'Contacts', children: <ContactsTab userId={user.id} /> },
        { key: 'gallery', label: 'Gallery', children: <GalleryTab userId={user.id} /> },
      ]}
    />
  )
}

function ProfileTab({ user, onCredit, onDebit, onResetPassword }: {
  user: User; onCredit: () => void; onDebit: () => void; onResetPassword: () => void;
}) {
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
        <Button icon={<KeyOutlined />} onClick={onResetPassword}>Reset Password</Button>
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
    <Table dataSource={rows} rowKey="id" loading={loading} size="small" pagination={{ pageSize: 10 }} scroll={{ x: 'max-content' }}
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
    <Table dataSource={rows} rowKey="id" loading={loading} size="small" pagination={{ pageSize: 10 }} scroll={{ x: 'max-content' }}
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

function ContactsTab({ userId }: { userId: string }) {
  const [contacts, setContacts] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([])
  const [pushing, setPushing] = useState(false)

  const fetchContacts = async () => {
    setLoading(true)
    try {
      const res = await adminApi.get(`/users/${userId}/contacts`)
      setContacts(res.data || [])
    } catch (e: any) {
      message.error('Failed to load user contacts')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchContacts()
  }, [userId])

  const handlePushLeads = async (keys?: React.Key[]) => {
    setPushing(true)
    try {
      const res = await adminApi.post(`/users/${userId}/contacts/push-leads`, {
        contact_ids: keys ? keys.map(k => Number(k)) : undefined,
      })
      message.success(res.data.message || 'Contacts pushed to Lead Manager successfully!')
      setSelectedRowKeys([])
      fetchContacts()
    } catch (e: any) {
      message.error(e.response?.data?.error || 'Failed to push contacts to Lead Manager')
    } finally {
      setPushing(false)
    }
  }

  const filtered = contacts.filter(c => {
    if (!search.trim()) return true
    const q = search.toLowerCase()
    return (c.name || '').toLowerCase().includes(q) || (c.phone || '').toLowerCase().includes(q) || (c.email || '').toLowerCase().includes(q)
  })

  const pushedCount = contacts.filter(c => c.is_pushed).length

  return (
    <div>
      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={12} sm={8}>
          <Card size="small" style={{ borderRadius: 8, background: '#fafafa' }}>
            <Typography.Text type="secondary" style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase' }}>
              Synced Contacts
            </Typography.Text>
            <div style={{ fontSize: 20, fontWeight: 800, color: tokens.color.textPrimary }}>{contacts.length}</div>
          </Card>
        </Col>
        <Col xs={12} sm={8}>
          <Card size="small" style={{ borderRadius: 8, background: '#f6ffed', borderColor: '#b7eb8f' }}>
            <Typography.Text type="secondary" style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase' }}>
              Pushed to Lead Manager
            </Typography.Text>
            <div style={{ fontSize: 20, fontWeight: 800, color: tokens.color.emerald }}>{pushedCount}</div>
          </Card>
        </Col>
        <Col xs={24} sm={8}>
          <Card size="small" style={{ borderRadius: 8, background: '#e6f7ff', borderColor: '#91d5ff' }}>
            <Typography.Text type="secondary" style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase' }}>
              Available to Push
            </Typography.Text>
            <div style={{ fontSize: 20, fontWeight: 800, color: tokens.color.info }}>{contacts.length - pushedCount}</div>
          </Card>
        </Col>
      </Row>

      <Space style={{ marginBottom: 16, width: '100%', justifyContent: 'space-between' }} wrap>
        <Input.Search
          placeholder="Search contact name or phone..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ width: 260 }}
          allowClear
        />

        <Space wrap>
          <Button
            icon={<ReloadOutlined />}
            onClick={fetchContacts}
            loading={loading}
          >
            Refresh
          </Button>
          {selectedRowKeys.length > 0 && (
            <Button
              type="primary"
              icon={<SendOutlined />}
              onClick={() => handlePushLeads(selectedRowKeys)}
              loading={pushing}
            >
              Push Selected ({selectedRowKeys.length}) to Leads
            </Button>
          )}
          <Button
            type="primary"
            style={{ background: tokens.color.gold, borderColor: tokens.color.gold }}
            icon={<SendOutlined />}
            onClick={() => handlePushLeads()}
            loading={pushing}
            disabled={contacts.length === 0}
          >
            Push All ({contacts.length}) to Lead Manager
          </Button>
        </Space>
      </Space>

      <Table
        dataSource={filtered}
        rowKey="id"
        loading={loading}
        size="small"
        pagination={{ pageSize: 10 }}
        scroll={{ x: 'max-content' }}
        rowSelection={{
          selectedRowKeys,
          onChange: setSelectedRowKeys,
        }}
        columns={[
          { title: 'Contact Name', dataIndex: 'name', render: (n: string) => <span style={{ fontWeight: 600 }}>{n || 'Unknown'}</span> },
          { title: 'Phone Number', dataIndex: 'phone', render: (p: string) => <Tag color="blue">{p}</Tag> },
          { title: 'Email', dataIndex: 'email', render: (e: string) => e || '-' },
          { title: 'Synced At', dataIndex: 'synced_at', render: (d: string) => d ? new Date(d).toLocaleString() : '-' },
          {
            title: 'Lead Status',
            dataIndex: 'is_pushed',
            render: (pushed: boolean) => (
              <Tag color={pushed ? 'green' : 'default'}>
                {pushed ? 'In Lead Manager' : 'Not Pushed'}
              </Tag>
            )
          },
          {
            title: 'Action',
            key: 'action',
            render: (r: any) => (
              <Button
                size="small"
                icon={<SendOutlined />}
                disabled={r.is_pushed}
                onClick={() => handlePushLeads([r.id])}
              >
                {r.is_pushed ? 'Pushed' : 'Push to Leads'}
              </Button>
            )
          }
        ]}
      />
    </div>
  )
}

function GalleryTab({ userId }: { userId: string }) {
  const [items, setItems] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [viewMode, setViewMode] = useState<'grid' | 'table'>('grid')
  const [previewItem, setPreviewItem] = useState<any | null>(null)

  const fetchGallery = async () => {
    setLoading(true)
    try {
      const res = await adminApi.get(`/users/${userId}/gallery`)
      setItems(res.data || [])
    } catch (e: any) {
      message.error('Failed to load user gallery photos')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchGallery()
  }, [userId])

  const formatSize = (bytes: number) => {
    if (!bytes) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
  }

  const totalSize = items.reduce((acc, it) => acc + Number(it.file_size || 0), 0)

  return (
    <div>
      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={12} sm={12}>
          <Card size="small" style={{ borderRadius: 8, background: '#fafafa' }}>
            <Typography.Text type="secondary" style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase' }}>
              Synced Photos / Media
            </Typography.Text>
            <div style={{ fontSize: 20, fontWeight: 800, color: tokens.color.textPrimary }}>{items.length}</div>
          </Card>
        </Col>
        <Col xs={12} sm={12}>
          <Card size="small" style={{ borderRadius: 8, background: '#f0f5ff', borderColor: '#adc6ff' }}>
            <Typography.Text type="secondary" style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase' }}>
              Total Storage Used
            </Typography.Text>
            <div style={{ fontSize: 20, fontWeight: 800, color: tokens.color.info }}>{formatSize(totalSize)}</div>
          </Card>
        </Col>
      </Row>

      <Space style={{ marginBottom: 16, width: '100%', justifyContent: 'space-between' }} wrap>
        <Space wrap>
          <Button
            type={viewMode === 'grid' ? 'primary' : 'default'}
            onClick={() => setViewMode('grid')}
          >
            Grid Layout
          </Button>
          <Button
            type={viewMode === 'table' ? 'primary' : 'default'}
            onClick={() => setViewMode('table')}
          >
            Table Layout
          </Button>
        </Space>
        <Button icon={<ReloadOutlined />} onClick={fetchGallery} loading={loading}>
          Refresh Gallery
        </Button>
      </Space>

      {loading ? (
        <Empty description="Loading Gallery Data..." />
      ) : items.length === 0 ? (
        <Empty description="No synced gallery photos or media items found for this user" />
      ) : viewMode === 'grid' ? (
        <Row gutter={[16, 16]}>
          {items.map((item) => (
            <Col xs={24} sm={12} md={8} key={item.id}>
              <Card
                hoverable
                size="small"
                style={{ borderRadius: 10, overflow: 'hidden' }}
                cover={
                  item.file_url ? (
                    <img
                      alt={item.file_name}
                      src={item.file_url}
                      style={{ height: 160, objectFit: 'cover' }}
                      onClick={() => setPreviewItem(item)}
                    />
                  ) : (
                    <div style={{ height: 160, background: '#f5f5f5', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <PictureOutlined style={{ fontSize: 40, color: '#ccc' }} />
                    </div>
                  )
                }
                actions={[
                  <Button key="prev" type="text" size="small" icon={<EyeOutlined />} onClick={() => setPreviewItem(item)}>Preview</Button>,
                  item.file_url ? (
                    <a key="dl" href={item.file_url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12 }}>
                      <DownloadOutlined /> Download
                    </a>
                  ) : null
                ].filter(Boolean) as any}
              >
                <Card.Meta
                  title={<span style={{ fontSize: 13 }} title={item.file_name}>{item.file_name}</span>}
                  description={
                    <div style={{ fontSize: 11 }}>
                      <div>Size: {formatSize(item.file_size)}</div>
                      <div>Synced: {new Date(item.synced_at).toLocaleDateString()}</div>
                    </div>
                  }
                />
              </Card>
            </Col>
          ))}
        </Row>
      ) : (
        <Table
          dataSource={items}
          rowKey="id"
          size="small"
          pagination={{ pageSize: 10 }}
          columns={[
            { title: 'File Name', dataIndex: 'file_name', render: (n: string) => <span style={{ fontWeight: 600 }}>{n}</span> },
            { title: 'Size', dataIndex: 'file_size', render: (s: number) => formatSize(s) },
            { title: 'MIME Type', dataIndex: 'mime_type', render: (m: string) => <Tag>{m || 'image/jpeg'}</Tag> },
            { title: 'Synced At', dataIndex: 'synced_at', render: (d: string) => new Date(d).toLocaleString() },
            {
              title: 'Actions',
              key: 'actions',
              render: (r: any) => (
                <Space>
                  <Button size="small" icon={<EyeOutlined />} onClick={() => setPreviewItem(r)}>View</Button>
                  {r.file_url && (
                    <Button size="small" icon={<DownloadOutlined />} href={r.file_url} target="_blank">Download</Button>
                  )}
                </Space>
              )
            }
          ]}
        />
      )}

      <Modal
        title={previewItem?.file_name || 'Gallery Item Preview'}
        open={!!previewItem}
        onCancel={() => setPreviewItem(null)}
        footer={[
          <Button key="close" onClick={() => setPreviewItem(null)}>Close</Button>,
          previewItem?.file_url ? (
            <Button key="dl" type="primary" icon={<DownloadOutlined />} href={previewItem.file_url} target="_blank">
              Open Original
            </Button>
          ) : null
        ]}
      >
        {previewItem && (
          <div style={{ textAlign: 'center' }}>
            {previewItem.file_url ? (
              <img src={previewItem.file_url} alt={previewItem.file_name} style={{ maxWidth: '100%', maxHeight: 400, borderRadius: 8, objectFit: 'contain' }} />
            ) : (
              <div style={{ padding: 40, background: '#f5f5f5', borderRadius: 8 }}>
                <PictureOutlined style={{ fontSize: 60, color: '#999' }} />
                <p>No direct image preview available</p>
              </div>
            )}
            <Descriptions bordered size="small" column={1} style={{ marginTop: 16 }}>
              <Descriptions.Item label="File Name">{previewItem.file_name}</Descriptions.Item>
              <Descriptions.Item label="Size">{formatSize(previewItem.file_size)}</Descriptions.Item>
              <Descriptions.Item label="Type">{previewItem.mime_type || 'image/jpeg'}</Descriptions.Item>
              <Descriptions.Item label="Synced Date">{new Date(previewItem.synced_at).toLocaleString()}</Descriptions.Item>
            </Descriptions>
          </div>
        )}
      </Modal>
    </div>
  )
}
