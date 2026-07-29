import React, { useEffect, useState } from 'react'
import { Card, Form, Input, Button, message, Tabs, Typography, Switch } from 'antd'
import { SaveOutlined, ApiOutlined, MessageOutlined, CloudServerOutlined, SettingOutlined, BarChartOutlined } from '@ant-design/icons'
import { adminApi } from '../api/client'

const { Title, Paragraph } = Typography
const { TabPane } = Tabs

export default function WebsiteSettings() {
  const [form] = Form.useForm()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    loadSettings()
  }, [])

  const loadSettings = async () => {
    setLoading(true)
    try {
      const res = await adminApi.get('/settings')
      if (res.data.success) {
        // Parse booleans back if needed
        const data = { ...res.data.data }
        if (data.app_maintenance_mode === 'true') data.app_maintenance_mode = true
        if (data.app_maintenance_mode === 'false') data.app_maintenance_mode = false
        form.setFieldsValue(data)
      }
    } catch {
      message.error('Failed to load website settings')
    } finally {
      setLoading(false)
    }
  }

  const onSave = async (values: any) => {
    setSaving(true)
    try {
      // Stringify boolean switches before sending
      const payload = { ...values }
      if (payload.app_maintenance_mode !== undefined) {
        payload.app_maintenance_mode = String(payload.app_maintenance_mode)
      }

      // Filter out undefined fields to avoid overriding with undefined
      const cleanPayload: any = {}
      for (const [k, v] of Object.entries(payload)) {
        if (v !== undefined) cleanPayload[k] = v
      }

      await adminApi.patch('/settings', cleanPayload)
      message.success('Website settings updated successfully!')
    } catch {
      message.error('Failed to save settings')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div style={{ padding: 40, textAlign: 'center' }}>Loading settings...</div>

  return (
    <div style={{ maxWidth: 800, margin: '0 auto' }}>
      <Title level={2}>Website Settings</Title>
      <Paragraph type="secondary">
        Manage all global API keys, webhook URLs, and external service configurations used by the platform.
      </Paragraph>

      <Form 
        form={form} 
        layout="vertical" 
        onFinish={onSave}
      >
        <Tabs defaultActiveKey="fcm">
          
          <TabPane tab={<span><CloudServerOutlined /> Firebase Cloud Messaging</span>} key="fcm">
            <Card>
              <Form.Item name="fcm_server_key" label="FCM Server Key (Legacy)">
                <Input.Password placeholder="Paste legacy server key here" />
              </Form.Item>
              <Form.Item name="fcm_service_account" label="FCM Service Account JSON (v1 API)">
                <Input.TextArea rows={6} placeholder="Paste the raw JSON content of your service account file" />
              </Form.Item>
            </Card>
          </TabPane>

          <TabPane tab={<span><MessageOutlined /> SMS / OTP Services</span>} key="sms">
            <Card>
              <Form.Item name="otp_provider" label="Active OTP Provider" initialValue="firebase">
                <Input placeholder="e.g. twilio, firebase, mock" />
              </Form.Item>
              <Form.Item name="twilio_account_sid" label="Twilio Account SID">
                <Input.Password placeholder="ACXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX" />
              </Form.Item>
              <Form.Item name="twilio_auth_token" label="Twilio Auth Token">
                <Input.Password placeholder="Enter Auth Token" />
              </Form.Item>
              <Form.Item name="twilio_phone_number" label="Twilio Phone Number">
                <Input placeholder="+1234567890" />
              </Form.Item>
            </Card>
          </TabPane>

          <TabPane tab={<span><ApiOutlined /> External APIs</span>} key="apis">
            <Card>
              <Form.Item name="cricket_api_key" label="Cricket Live Score API Key (e.g., CricAPI)">
                <Input.Password placeholder="Enter your sports API key here" />
              </Form.Item>
              <Form.Item name="crypto_payment_key" label="Crypto Payment Gateway API Key">
                <Input.Password placeholder="Enter payment key" />
              </Form.Item>
              <Form.Item name="crypto_webhook_secret" label="Crypto Webhook Secret">
                <Input.Password placeholder="Enter webhook verification secret" />
              </Form.Item>
            </Card>
          </TabPane>

          <TabPane tab={<span><BarChartOutlined /> Analytics</span>} key="analytics">
            <Card>
              <Form.Item name="google_analytics_code" label="Google Analytics Measurement ID / Tracking Code">
                <Input placeholder="e.g. G-XXXXXXXXXX or UA-XXXXXXXX-X" />
              </Form.Item>
              <Form.Item name="firebase_flutter_analytics_code" label="Firebase Flutter Analytics Config / App ID">
                <Input placeholder="e.g. 1:XXXXXX:android:XXXXXX or configuration string" />
              </Form.Item>
            </Card>
          </TabPane>

          <TabPane tab={<span><SettingOutlined /> General Configuration</span>} key="general">
            <Card>
              <Form.Item name="app_maintenance_mode" label="Maintenance Mode" valuePropName="checked">
                <Switch checkedChildren="ON" unCheckedChildren="OFF" />
              </Form.Item>
              <Form.Item name="websocket_url" label="WebSocket URL">
                <Input placeholder="wss://game.myonlinejoker.com/ws" />
              </Form.Item>
              <Form.Item name="support_email" label="Support Contact Email">
                <Input placeholder="support@myonlinejoker.com" />
              </Form.Item>
              <Form.Item name="support_whatsapp" label="Support WhatsApp Number">
                <Input placeholder="+919876543210" />
              </Form.Item>
            </Card>
          </TabPane>

        </Tabs>

        <div style={{ marginTop: 24, textAlign: 'right' }}>
          <Button type="primary" htmlType="submit" size="large" icon={<SaveOutlined />} loading={saving}>
            Save All Settings
          </Button>
        </div>
      </Form>
    </div>
  )
}
