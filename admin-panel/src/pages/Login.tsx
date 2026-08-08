import { useState } from 'react'
import { App, Form, Input, Button, Card, Typography, Alert, Tag } from 'antd'
import { UserOutlined, LockOutlined, SafetyOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import axios from 'axios'
import { useAuthStore } from '../store/auth'
import { tokens } from '../theme/tokens'

const BASE = import.meta.env.VITE_API_BASE_URL || ''

export default function Login() {
  const { message } = App.useApp()
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
      message.success('Login successful — Welcome to Admin Console')
      navigate('/admin')
    } catch (err: any) {
      if (!err.response || typeof err.response.data !== 'object') {
        setBackendUnreachable(true)
        message.error('Cannot reach admin-service backend')
      } else if (err.response.data.require_2fa) {
        setNeeds2fa(true)
        message.info('Authenticator 2FA Code required')
      } else {
        message.error(err.response.data.error || 'Invalid credentials')
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      minHeight: '100vh',
      background: 'radial-gradient(1000px 600px at 50% 20%, #1a1610 0%, #0c0e12 100%)',
      padding: 16,
      position: 'relative',
      overflow: 'hidden',
    }}>
      {/* Background Glow Accents */}
      <div style={{
        position: 'absolute',
        width: 400,
        height: 400,
        borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(212, 175, 55, 0.12) 0%, rgba(0,0,0,0) 70%)',
        top: '15%',
        left: '50%',
        transform: 'translateX(-50%)',
        pointerEvents: 'none',
      }} />

      <Card style={{
        width: 440,
        borderRadius: 20,
        background: 'rgba(21, 25, 34, 0.85)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        border: '1px solid rgba(212, 175, 55, 0.25)',
        boxShadow: '0 20px 50px rgba(0, 0, 0, 0.6), 0 0 30px rgba(212, 175, 55, 0.1)',
      }}>
        {/* Crest & Title */}
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <div style={{
            width: 64,
            height: 64,
            borderRadius: 18,
            background: tokens.gradient.goldButton,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 32,
            boxShadow: tokens.shadow.gold,
            marginBottom: 16,
          }}>
            🃏
          </div>
          <Typography.Title level={2} style={{ margin: 0, color: tokens.color.gold, fontWeight: 800, letterSpacing: -0.5 }}>
            MyOnlineJoker
          </Typography.Title>
          <Typography.Text style={{ color: tokens.color.textOnDarkMuted, fontSize: 13, display: 'block', marginTop: 4 }}>
            Control Center & Gaming Management
          </Typography.Text>

          <Tag color="success" style={{ marginTop: 12, borderRadius: 12, padding: '2px 10px', fontSize: 11, border: '1px solid rgba(16, 185, 129, 0.3)', background: 'rgba(16, 185, 129, 0.1)' }}>
            🟢 Backend: {BASE || 'game.myonlinejoker.com'}
          </Tag>
        </div>

        {backendUnreachable && (
          <Alert
            type="warning"
            showIcon
            style={{ marginBottom: 20, borderRadius: 12, background: 'rgba(245, 158, 11, 0.12)', border: '1px solid rgba(245, 158, 11, 0.3)' }}
            message={<span style={{ color: '#FCD34D', fontWeight: 600 }}>Backend Connection Issue</span>}
            description={
              <span style={{ color: '#FDE68A', fontSize: 12 }}>
                Could not connect to <code>{BASE || '/api/admin'}</code>. Please check your network or backend service.
              </span>
            }
          />
        )}

        <Form onFinish={onFinish} layout="vertical" size="large">
          <Form.Item name="username" rules={[{ required: true, message: 'Username is required' }]}>
            <Input
              prefix={<UserOutlined style={{ color: tokens.color.gold }} />}
              placeholder="Admin Username"
              disabled={needs2fa}
              style={{
                borderRadius: 12,
                background: 'rgba(15, 18, 26, 0.7)',
                border: '1px solid rgba(226, 232, 240, 0.2)',
                color: '#FFFFFF',
              }}
            />
          </Form.Item>

          <Form.Item name="password" rules={[{ required: true, message: 'Password is required' }]}>
            <Input.Password
              prefix={<LockOutlined style={{ color: tokens.color.gold }} />}
              placeholder="Password"
              disabled={needs2fa}
              style={{
                borderRadius: 12,
                background: 'rgba(15, 18, 26, 0.7)',
                border: '1px solid rgba(226, 232, 240, 0.2)',
                color: '#FFFFFF',
              }}
            />
          </Form.Item>

          {needs2fa && (
            <Form.Item name="totp_code" rules={[{ required: true, len: 6, message: 'Enter 6-digit code' }]}>
              <Input
                prefix={<SafetyOutlined style={{ color: tokens.color.emerald }} />}
                placeholder="6-digit Authenticator Code"
                autoFocus
                style={{
                  borderRadius: 12,
                  background: 'rgba(16, 185, 129, 0.1)',
                  border: '1px solid #10B981',
                  color: '#FFFFFF',
                  fontWeight: 700,
                  letterSpacing: 4,
                  textAlign: 'center',
                }}
              />
            </Form.Item>
          )}

          <Form.Item style={{ marginBottom: 0, marginTop: 24 }}>
            <Button
              type="primary"
              htmlType="submit"
              block
              loading={loading}
              style={{
                height: 46,
                borderRadius: 12,
                background: tokens.gradient.goldButton,
                color: '#000000',
                fontWeight: 700,
                fontSize: 15,
                border: 0,
                boxShadow: tokens.shadow.gold,
              }}
            >
              {needs2fa ? 'Verify 2FA & Sign In' : 'Sign In to Admin Console'}
            </Button>
          </Form.Item>
        </Form>
      </Card>
    </div>
  )
}

