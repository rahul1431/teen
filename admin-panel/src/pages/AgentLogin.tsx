import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Form, Input, Button, Card, Typography, Tag, Row, Col, Space, Alert } from 'antd'
import {
  UserOutlined, LockOutlined, TrophyOutlined, TeamOutlined,
  DollarOutlined, RocketOutlined, SafetyCertificateOutlined,
  CustomerServiceOutlined
} from '@ant-design/icons'
import { adminApi } from '../api/client'
import { useAuthStore } from '../store/auth'
import { tokens } from '../theme/tokens'

const { Title, Text } = Typography

export default function AgentLogin() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const navigate = useNavigate()
  const setAuth = useAuthStore(s => s.setAuth)

  const onFinish = async (values: { username: string; password: string }) => {
    setLoading(true)
    setError(null)
    try {
      const res = await adminApi.post('/agent-portal/auth/login', values)
      setAuth(res.data.token, res.data.admin)
      navigate('/admin/agent')
    } catch (e: any) {
      setError(e.response?.data?.error || 'Invalid credentials or suspended account')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'radial-gradient(1000px 600px at 50% 20%, #1c1810 0%, #0a0c10 100%)',
      padding: 16,
      position: 'relative',
      overflow: 'hidden',
    }}>
      {/* Background Glow */}
      <div style={{
        position: 'absolute',
        width: 500,
        height: 500,
        borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(212, 175, 55, 0.12) 0%, rgba(0,0,0,0) 70%)',
        top: '10%',
        left: '50%',
        transform: 'translateX(-50%)',
        pointerEvents: 'none',
      }} />

      <Card style={{
        maxWidth: 440,
        width: '100%',
        borderRadius: 24,
        background: 'rgba(21, 25, 34, 0.95)',
        backdropFilter: 'blur(20px)',
        border: '1px solid rgba(212, 175, 55, 0.3)',
        boxShadow: '0 25px 60px rgba(0, 0, 0, 0.7), 0 0 35px rgba(212, 175, 55, 0.12)',
      }}>
        {/* Header Branding */}
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <div style={{
            width: 64,
            height: 64,
            borderRadius: 20,
            background: tokens.gradient.goldButton,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 32,
            boxShadow: tokens.shadow.gold,
            marginBottom: 14,
          }}>
            👥
          </div>
          <Title level={2} style={{ margin: 0, color: tokens.color.gold, fontWeight: 800, letterSpacing: -0.5 }}>
            Agent Partner Portal
          </Title>
          <Text style={{ color: tokens.color.textOnDarkMuted, fontSize: 13, display: 'block', marginTop: 4 }}>
            MyOnlineJoker Affiliate & Master Agent Network
          </Text>

          <Tag color="gold" style={{ marginTop: 10, borderRadius: 12, padding: '2px 10px', fontSize: 11, border: '1px solid rgba(212, 175, 55, 0.3)' }}>
            ⚡ Instant Payouts · Up to 15% Game Commission
          </Tag>
        </div>

        {error && (
          <Alert
            type="error"
            showIcon
            message={error}
            style={{ marginBottom: 16, borderRadius: 10 }}
          />
        )}

        <Form layout="vertical" onFinish={onFinish} size="large">
          <Form.Item
            name="username"
            label={<span style={{ color: '#E2E8F0', fontWeight: 600 }}>Agent Username or Mobile</span>}
            rules={[{ required: true, message: 'Please enter your username or phone number' }]}
          >
            <Input
              prefix={<UserOutlined style={{ color: tokens.color.gold }} />}
              placeholder="e.g. agent_rahul or 9876543210"
              style={{ borderRadius: 12, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.15)', color: '#FFFFFF' }}
            />
          </Form.Item>

          <Form.Item
            name="password"
            label={<span style={{ color: '#E2E8F0', fontWeight: 600 }}>Password</span>}
            rules={[{ required: true, message: 'Please enter your password' }]}
          >
            <Input.Password
              prefix={<LockOutlined style={{ color: tokens.color.gold }} />}
              placeholder="••••••••"
              style={{ borderRadius: 12, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.15)', color: '#FFFFFF' }}
            />
          </Form.Item>

          <Button
            type="primary"
            htmlType="submit"
            loading={loading}
            block
            size="large"
            style={{
              height: 48,
              borderRadius: 12,
              fontWeight: 700,
              fontSize: 16,
              background: tokens.gradient.goldButton,
              border: 0,
              color: '#000000',
              boxShadow: tokens.shadow.gold,
              marginTop: 8,
            }}
          >
            Access Agent Dashboard
          </Button>
        </Form>

        {/* Benefits Grid */}
        <div style={{ marginTop: 24, padding: 14, background: 'rgba(0,0,0,0.3)', borderRadius: 14, border: '1px solid rgba(255,255,255,0.06)' }}>
          <Row gutter={[8, 8]}>
            <Col span={12}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <DollarOutlined style={{ color: '#52c41a', fontSize: 13 }} />
                <Text style={{ color: tokens.color.textOnDarkMuted, fontSize: 11 }}>Multi-Game Commission</Text>
              </div>
            </Col>
            <Col span={12}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <TeamOutlined style={{ color: '#1890ff', fontSize: 13 }} />
                <Text style={{ color: tokens.color.textOnDarkMuted, fontSize: 11 }}>Downline Sub-Agents</Text>
              </div>
            </Col>
            <Col span={12}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <RocketOutlined style={{ color: '#faad14', fontSize: 13 }} />
                <Text style={{ color: tokens.color.textOnDarkMuted, fontSize: 11 }}>Realtime Live Stats</Text>
              </div>
            </Col>
            <Col span={12}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <SafetyCertificateOutlined style={{ color: '#13c2c2', fontSize: 13 }} />
                <Text style={{ color: tokens.color.textOnDarkMuted, fontSize: 11 }}>Fast UPI / Bank Payouts</Text>
              </div>
            </Col>
          </Row>
        </div>

        {/* Footer Support */}
        <div style={{ textAlign: 'center', marginTop: 18 }}>
          <Text style={{ color: tokens.color.textOnDarkMuted, fontSize: 12 }}>
            Need help or forgot password? Contact <a href="https://t.me/" target="_blank" rel="noreferrer" style={{ color: tokens.color.gold }}>Super Admin Support</a>
          </Text>
        </div>
      </Card>
    </div>
  )
}
