import { useEffect, useState } from 'react'
import { Card, Descriptions, Button, Input, Form, message, Tag, Alert, Steps, Space } from 'antd'
import { SafetyOutlined } from '@ant-design/icons'
import { adminApi } from '../api/client'

export default function Profile() {
  const [me, setMe] = useState<any>(null)
  const [setupData, setSetupData] = useState<{ qr_data_url: string; secret: string } | null>(null)
  const [verifyCode, setVerifyCode] = useState('')
  const [disableCode, setDisableCode] = useState('')

  const load = () => adminApi.get('/auth/me').then(r => setMe(r.data))
  useEffect(() => { load() }, [])

  const startSetup = async () => {
    const res = await adminApi.post('/auth/2fa/setup')
    setSetupData(res.data)
    setVerifyCode('')
  }

  const verify = async () => {
    try {
      await adminApi.post('/auth/2fa/verify', { code: verifyCode })
      message.success('2FA enabled — you will be asked for a code on next login')
      setSetupData(null); setVerifyCode('')
      load()
    } catch (e: any) {
      message.error(e.response?.data?.error || 'Verification failed')
    }
  }

  const disable = async () => {
    try {
      await adminApi.post('/auth/2fa/disable', { code: disableCode })
      message.success('2FA disabled')
      setDisableCode('')
      load()
    } catch (e: any) {
      message.error(e.response?.data?.error || 'Failed')
    }
  }

  const changePassword = async (values: any) => {
    try {
      await adminApi.post('/auth/change-password', values)
      message.success('Password changed')
    } catch (e: any) {
      message.error(e.response?.data?.error || 'Failed')
    }
  }

  if (!me) return null

  return (
    <Space direction="vertical" size="large" style={{ width: '100%' }}>
      <Card title="Profile">
        <Descriptions column={2} bordered size="small">
          <Descriptions.Item label="Username">{me.username}</Descriptions.Item>
          <Descriptions.Item label="Email">{me.email}</Descriptions.Item>
          <Descriptions.Item label="Role"><Tag color="gold">{me.role}</Tag></Descriptions.Item>
          <Descriptions.Item label="2FA">{me.totp_enabled ? <Tag color="green">Enabled</Tag> : <Tag>Disabled</Tag>}</Descriptions.Item>
          <Descriptions.Item label="Last Login">{me.last_login_at ? new Date(me.last_login_at).toLocaleString() : '—'}</Descriptions.Item>
          <Descriptions.Item label="Joined">{new Date(me.created_at).toLocaleDateString()}</Descriptions.Item>
        </Descriptions>
      </Card>

      <Card title={<><SafetyOutlined /> Two-Factor Authentication</>}>
        {me.totp_enabled ? (
          <>
            <Alert type="success" showIcon style={{ marginBottom: 12 }}
              message="2FA is active on your account. You'll be asked for a code from your authenticator app on every login." />
            <p>To disable, enter a current 6-digit code:</p>
            <Space>
              <Input value={disableCode} onChange={(e) => setDisableCode(e.target.value)} placeholder="6-digit code" style={{ width: 160 }} />
              <Button danger onClick={disable}>Disable 2FA</Button>
            </Space>
          </>
        ) : setupData ? (
          <Steps current={1} direction="vertical" size="small"
            items={[
              { title: 'Generate', description: 'Done — scan the QR or enter the secret manually.' },
              {
                title: 'Scan + Verify',
                description: <>
                  <p>Scan this QR with Google Authenticator, Authy, 1Password, etc:</p>
                  <img src={setupData.qr_data_url} alt="TOTP QR" style={{ border: '1px solid #eee', padding: 6 }} />
                  <p style={{ marginTop: 8 }}>Or enter this secret manually:</p>
                  <Input.TextArea readOnly value={setupData.secret} autoSize style={{ fontFamily: 'monospace', maxWidth: 320 }} />
                  <p style={{ marginTop: 8 }}>Then enter the current 6-digit code from your app:</p>
                  <Space>
                    <Input value={verifyCode} onChange={(e) => setVerifyCode(e.target.value)} placeholder="6-digit code" style={{ width: 160 }} />
                    <Button type="primary" onClick={verify}>Verify & Enable</Button>
                    <Button onClick={() => setSetupData(null)}>Cancel</Button>
                  </Space>
                </>
              },
              { title: 'Done', description: 'After verification, 2FA is required on every login.' },
            ]} />
        ) : (
          <>
            <Alert type="warning" showIcon style={{ marginBottom: 12 }}
              message="2FA is OFF" description="Strongly recommended for any admin who can move money." />
            <Button type="primary" icon={<SafetyOutlined />} onClick={startSetup}>Set up 2FA</Button>
          </>
        )}
      </Card>

      <Card title="Change Password">
        <Form layout="vertical" onFinish={changePassword} style={{ maxWidth: 400 }}>
          <Form.Item name="current_password" label="Current Password" rules={[{ required: true }]}>
            <Input.Password />
          </Form.Item>
          <Form.Item name="new_password" label="New Password (min 10 chars)" rules={[{ required: true, min: 10 }]}>
            <Input.Password />
          </Form.Item>
          <Button type="primary" htmlType="submit">Change Password</Button>
        </Form>
      </Card>
    </Space>
  )
}
