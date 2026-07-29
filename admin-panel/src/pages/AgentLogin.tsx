import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Form, Input, Button, Card, message } from 'antd'
import { adminApi } from '../api/client'
import { useAuthStore } from '../store/auth'

export default function AgentLogin() {
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()
  const setAuth = useAuthStore(s => s.setAuth)

  const onFinish = async (values: { username: string; password: string }) => {
    setLoading(true)
    try {
      const res = await adminApi.post('/agent-portal/auth/login', values)
      setAuth(res.data.token, res.data.admin)
      navigate('/admin/agent')
    } catch (e: any) {
      message.error(e.response?.data?.error || 'Login failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh', background: '#0f0f0f' }}>
      <Card title="Agent Login" style={{ width: 360 }}>
        <Form layout="vertical" onFinish={onFinish}>
          <Form.Item name="username" label="Username" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="password" label="Password" rules={[{ required: true }]}><Input.Password /></Form.Item>
          <Button type="primary" htmlType="submit" loading={loading} block>Log In</Button>
        </Form>
      </Card>
    </div>
  )
}
