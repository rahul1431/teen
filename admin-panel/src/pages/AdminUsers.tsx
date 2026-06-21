import { useEffect, useState } from 'react'
import {
  Table, Button, Tag, Space, Modal, Form, Input, Select, Popconfirm, message, Alert, Empty,
} from 'antd'
import { PlusOutlined, KeyOutlined, StopOutlined, CheckCircleOutlined } from '@ant-design/icons'
import { adminApi } from '../api/client'
import { useAuthStore } from '../store/auth'

const ROLE_OPTIONS = [
  { value: 'readonly', label: 'Read-only — views only, no writes' },
  { value: 'support', label: 'Support — user notes, status changes, KYC review' },
  { value: 'finance', label: 'Finance — withdrawals, deposits, ledger, wallet adjust' },
  { value: 'superadmin', label: 'Superadmin — everything (use sparingly)' },
]

const ROLE_COLOR: Record<string, string> = {
  superadmin: 'red',
  finance: 'gold',
  support: 'blue',
  readonly: 'default',
}

export default function AdminUsers() {
  const { admin } = useAuthStore()
  const [rows, setRows] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [resetUser, setResetUser] = useState<any>(null)
  const [resetPassword, setResetPassword] = useState('')

  const load = async () => {
    setLoading(true)
    try { setRows((await adminApi.get('/admin-users')).data) }
    catch (e: any) { message.error(e.response?.data?.error || 'Failed to load') }
    finally { setLoading(false) }
  }
  useEffect(() => { load() }, [])

  const create = async (values: any) => {
    try {
      await adminApi.post('/admin-users', values)
      message.success(`Admin ${values.username} created`)
      setCreateOpen(false)
      load()
    } catch (e: any) {
      message.error(e.response?.data?.error || 'Failed to create')
    }
  }

  const setRole = async (id: string, role: string) => {
    await adminApi.patch(`/admin-users/${id}`, { role })
    message.success('Role updated')
    load()
  }

  const setActive = async (id: string, is_active: boolean) => {
    try {
      await adminApi.patch(`/admin-users/${id}`, { is_active })
      message.success(is_active ? 'Activated' : 'Deactivated')
      load()
    } catch (e: any) {
      message.error(e.response?.data?.error || 'Failed')
    }
  }

  const doReset = async () => {
    if (!resetUser || resetPassword.length < 10) {
      message.warning('Password must be at least 10 characters'); return
    }
    await adminApi.post(`/admin-users/${resetUser.id}/reset-password`, { password: resetPassword })
    message.success(`Password reset for ${resetUser.username}`)
    setResetUser(null); setResetPassword('')
  }

  if (admin?.role !== 'superadmin') {
    return <Alert type="warning" showIcon message="Superadmin access required to manage admin users" />
  }

  return (
    <>
      <Space style={{ marginBottom: 16 }}>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>
          Add Admin User
        </Button>
      </Space>
      <Table dataSource={rows} rowKey="id" loading={loading} size="small"
        locale={{ emptyText: <Empty description="No admin users" /> }}
        columns={[
          { title: 'Username', dataIndex: 'username' },
          { title: 'Email', dataIndex: 'email' },
          { title: 'Role', dataIndex: 'role',
            render: (r: string, row: any) => (
              <Select value={r} size="small" style={{ minWidth: 130 }}
                disabled={row.id === admin?.id}
                onChange={(v) => setRole(row.id, v)}>
                {ROLE_OPTIONS.map(o => <Select.Option key={o.value} value={o.value}>
                  <Tag color={ROLE_COLOR[o.value]} style={{ marginRight: 4 }}>{o.value}</Tag>
                </Select.Option>)}
              </Select>
            ) },
          { title: '2FA', dataIndex: 'totp_enabled',
            render: (v: boolean) => v ? <Tag color="green">enabled</Tag> : <Tag>off</Tag> },
          { title: 'Status', dataIndex: 'is_active',
            render: (v: boolean) => v ? <Tag color="green">active</Tag> : <Tag color="red">disabled</Tag> },
          { title: 'Last Login', dataIndex: 'last_login_at',
            render: (d: string) => d ? new Date(d).toLocaleString() : '—' },
          { title: 'Created By', dataIndex: 'created_by_username', render: (u: string) => u || 'seed' },
          {
            title: 'Actions',
            render: (r: any) => (
              <Space>
                <Button size="small" icon={<KeyOutlined />}
                  onClick={() => { setResetUser(r); setResetPassword('') }}>
                  Reset PW
                </Button>
                {r.id !== admin?.id && (r.is_active
                  ? <Popconfirm title={`Disable ${r.username}?`} onConfirm={() => setActive(r.id, false)}>
                      <Button size="small" danger icon={<StopOutlined />}>Disable</Button>
                    </Popconfirm>
                  : <Popconfirm title={`Re-enable ${r.username}?`} onConfirm={() => setActive(r.id, true)}>
                      <Button size="small" icon={<CheckCircleOutlined />}>Enable</Button>
                    </Popconfirm>)}
              </Space>
            )
          },
        ]} />

      <Modal title="Add Admin User" open={createOpen} onCancel={() => setCreateOpen(false)} footer={null} destroyOnClose>
        <Form layout="vertical" onFinish={create}>
          <Form.Item name="username" label="Username" rules={[{ required: true, min: 3, max: 50 }]}>
            <Input />
          </Form.Item>
          <Form.Item name="email" label="Email" rules={[{ required: true, type: 'email' }]}>
            <Input />
          </Form.Item>
          <Form.Item name="password" label="Initial Password" rules={[{ required: true, min: 10, message: 'At least 10 characters' }]}>
            <Input.Password />
          </Form.Item>
          <Form.Item name="role" label="Role" rules={[{ required: true }]} initialValue="support">
            <Select options={ROLE_OPTIONS} />
          </Form.Item>
          <Button type="primary" htmlType="submit" block>Create Admin</Button>
        </Form>
      </Modal>

      <Modal title={`Reset Password — ${resetUser?.username}`} open={!!resetUser}
        onCancel={() => { setResetUser(null); setResetPassword('') }} onOk={doReset}>
        <p>New password (min 10 chars). Share securely with the user; they should change it on first login.</p>
        <Input.Password value={resetPassword} onChange={(e) => setResetPassword(e.target.value)} />
      </Modal>
    </>
  )
}
