import { useState } from 'react'
import { Form, Input, Button, Card, Typography, message, Alert } from 'antd'
import { UserOutlined, LockOutlined, SafetyOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import axios from 'axios'
import { useAuthStore } from '../store/auth'

const BASE = import.meta.env.VITE_API_BASE_URL || ''

export default function Login() {
  const [loading, setLoading] = useState(false)
  const [needs2fa, setNeeds2fa] = useState(false)
  const [backendUnreachable, setBackendUnreachable] = useState(false)
  const { setAuth } = useAuthStore()
  const navigate = useNavigate()

  const onFinish = async (values: { username: string; password: string; totp_code?: string }) => {
    setLoading(true); setBackendUnreachable(false)
    try {
      const res = await axios.post(`${BASE}/api/admin/auth/login`, values)
      setAuth(res.data.token, res.data.admin)
      message.success('Login successful')
      navigate('/admin')
    } catch (err: any) {
      // If we never reached the backend (CORS, 404 HTML, no server, etc.) the
      // axios error has no `response.data.error`. Surface that clearly instead
      // of misleading "invalid credentials".
      if (!err.response || typeof err.response.data !== 'object') {
        setBackendUnreachable(true)
        message.error('Cannot reach admin-service backend')
      } else if (err.response.data.require_2fa) {
        setNeeds2fa(true)
        message.info('Enter your 2FA code')
      } else {
        message.error(err.response.data.error || 'Invalid credentials')
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh', background: '#0d1117' }}>
      <Card style={{ width: 420, borderRadius: 12, boxShadow: '0 8px 32px rgba(0,0,0,0.5)' }}>
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <Typography.Title level={2} style={{ margin: 0 }}>🃏 Admin Panel</Typography.Title>
          <Typography.Text type="secondary">MyOnlineJoker Gaming Platform</Typography.Text>
        </div>

        {backendUnreachable && (
          <Alert
            type="warning"
            showIcon
            style={{ marginBottom: 16 }}
            message="Backend not reachable"
            description={
              <span>
                The admin-service at <code>{BASE || '(relative /api/admin)'}</code> didn't respond.
                If this is the GitHub Pages preview, login needs a deployed backend or local dev server.
                See <code>PROGRESS.md</code> §How to log in.
              </span>
            }
          />
        )}

        <Form onFinish={onFinish} layout="vertical" size="large">
          <Form.Item name="username" rules={[{ required: true }]}>
            <Input prefix={<UserOutlined />} placeholder="Username" disabled={needs2fa} />
          </Form.Item>
          <Form.Item name="password" rules={[{ required: true }]}>
            <Input.Password prefix={<LockOutlined />} placeholder="Password" disabled={needs2fa} />
          </Form.Item>
          {needs2fa && (
            <Form.Item name="totp_code" rules={[{ required: true, len: 6, message: '6-digit code from your authenticator' }]}>
              <Input prefix={<SafetyOutlined />} placeholder="6-digit 2FA code" autoFocus />
            </Form.Item>
          )}
          <Form.Item>
            <Button type="primary" htmlType="submit" block loading={loading} style={{ background: '#d4af37' }}>
              {needs2fa ? 'Verify & Sign In' : 'Sign In'}
            </Button>
          </Form.Item>
        </Form>

        <Typography.Paragraph type="secondary" style={{ fontSize: 11, textAlign: 'center', marginBottom: 0 }}>
          Seed credentials: <code>superadmin</code> / <code>Admin@123456</code> · change after first login
        </Typography.Paragraph>
      </Card>
    </div>
  )
}
