import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Card, Button, Spin, Tag, Space, Modal, InputNumber, Input, message } from 'antd'
import { ArrowLeftOutlined, KeyOutlined, CopyOutlined } from '@ant-design/icons'
import { adminApi } from '../api/client'
import { tokens } from '../theme/tokens'
import { UserDetailTabs } from './Users'

export default function UserDetailPage() {
  const { userId } = useParams<{ userId: string }>()
  const navigate = useNavigate()
  const [user, setUser] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [walletModal, setWalletModal] = useState<'credit' | 'debit' | null>(null)
  const [walletAmount, setWalletAmount] = useState<number>(0)
  const [walletNote, setWalletNote] = useState('')
  const [resetPwOpen, setResetPwOpen] = useState(false)
  const [resetPwValue, setResetPwValue] = useState('')

  const fetchUser = async () => {
    if (!userId) return
    setLoading(true)
    try {
      const res = await adminApi.get('/users', { params: { id: userId, is_bot: false } })
      const u = (res.data.users ?? [])[0]
      if (u) {
        setUser(u)
      } else {
        message.error('User not found')
      }
    } catch (e: any) {
      message.error(e?.response?.data?.error || 'Failed to load user profile')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchUser()
  }, [userId])

  const adjustWallet = async () => {
    if (!user || walletAmount <= 0) return
    try {
      await adminApi.post(`/users/${user.id}/${walletModal}`, {
        amount: walletAmount,
        description: walletNote || undefined,
      })
      message.success(`₹${walletAmount} ${walletModal === 'credit' ? 'credited' : 'debited'}`)
      setWalletModal(null)
      setWalletAmount(0)
      setWalletNote('')
      fetchUser()
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

  const doResetPassword = async () => {
    if (!user || resetPwValue.length < 6) {
      message.warning('Password must be at least 6 characters')
      return
    }
    try {
      await adminApi.post(`/users/${user.id}/reset-password`, { password: resetPwValue })
      message.success(`Password reset for ${user.username}`)
      setResetPwOpen(false)
    } catch (e: any) {
      message.error(e.response?.data?.error || 'Failed to reset password')
    }
  }

  if (loading) {
    return (
      <div style={{ padding: 60, textAlign: 'center' }}>
        <Spin size="large" tip="Loading Player Data..." />
      </div>
    )
  }

  if (!user) {
    return (
      <Card style={{ textAlign: 'center', margin: 40 }}>
        <h2>User Not Found</h2>
        <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/admin/users')}>Back to Players List</Button>
      </Card>
    )
  }

  return (
    <div style={{ paddingBottom: 40 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <Space size="middle">
          <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/admin/users')}>Back</Button>
          <h2 style={{ margin: 0, fontWeight: 800, color: tokens.color.textPrimary }}>
            Player View: {user.username} <Tag color={user.status === 'active' ? 'green' : 'red'} style={{ marginLeft: 8 }}>{user.status.toUpperCase()}</Tag>
          </h2>
        </Space>
        <Tag color="gold" style={{ fontSize: 13, padding: '4px 10px' }}>Phone: +91 {user.phone}</Tag>
      </div>

      <Card style={{ borderRadius: 12, boxShadow: '0 4px 16px rgba(0,0,0,0.06)' }}>
        <UserDetailTabs
          user={user}
          onCredit={() => { setWalletModal('credit'); setWalletAmount(0); setWalletNote('') }}
          onDebit={() => { setWalletModal('debit'); setWalletAmount(0); setWalletNote('') }}
          onResetPassword={() => { generateTempPassword(); setResetPwOpen(true) }}
          onChanged={fetchUser}
        />
      </Card>

      <Modal
        title={`${walletModal === 'credit' ? 'Credit' : 'Debit'} Wallet — ${user?.username}`}
        open={!!walletModal} onOk={adjustWallet} onCancel={() => setWalletModal(null)}
        okButtonProps={{ danger: walletModal === 'debit', disabled: walletAmount <= 0 }}>
        <p style={{ marginBottom: 8 }}>Amount (₹):</p>
        <InputNumber min={1} max={100000} value={walletAmount} onChange={(v) => setWalletAmount(v || 0)} style={{ width: '100%' }} />
        <p style={{ margin: '12px 0 8px' }}>Reason / note (audit-logged):</p>
        <Input.TextArea rows={2} value={walletNote} onChange={(e) => setWalletNote(e.target.value)}
          placeholder={walletModal === 'credit' ? 'e.g. compensation for failed deposit' : 'e.g. reversed fraudulent win'} />
      </Modal>

      <Modal
        title={`Reset Password — ${user?.username}`}
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
          A temporary password is generated below. Share it with the user through a secure channel.
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
