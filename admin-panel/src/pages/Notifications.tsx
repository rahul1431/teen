import { useState } from 'react'
import { Form, Input, Button, Select, Card, message, Radio, Tabs } from 'antd'
import { SendOutlined } from '@ant-design/icons'
import { adminApi } from '../api/client'
import { NotificationHistoryTab } from '../components/NotificationHistoryTab'
import { NotificationAnalyticsTab } from '../components/NotificationAnalyticsTab'

function SendTab() {
  const [loading, setLoading] = useState(false)
  const [form] = Form.useForm()
  const [target, setTarget] = useState<'all' | 'user'>('all')

  const onSend = async (values: any) => {
    setLoading(true)
    try {
      if (target === 'all') {
        await adminApi.post('/notifications/broadcast', { title: values.title, body: values.body, type: values.type || 'broadcast' })
        message.success('Broadcast sent to all users!')
      } else {
        await adminApi.post('/notifications/send', { user_id: values.user_id, title: values.title, body: values.body, type: values.type || 'general' })
        message.success('Notification sent!')
      }
      form.resetFields()
    } catch {
      message.error('Failed to send notification')
    } finally { setLoading(false) }
  }

  return (
    <Card title="Send Push Notification" style={{ maxWidth: 600 }}>
      <Form form={form} layout="vertical" onFinish={onSend}>
        <Form.Item label="Send To">
          <Radio.Group value={target} onChange={e => setTarget(e.target.value)}>
            <Radio.Button value="all">All Users</Radio.Button>
            <Radio.Button value="user">Specific User</Radio.Button>
          </Radio.Group>
        </Form.Item>

        {target === 'user' && (
          <Form.Item name="user_id" label="User ID" rules={[{ required: true }]}>
            <Input placeholder="Paste user UUID" />
          </Form.Item>
        )}

        <Form.Item name="type" label="Type" initialValue="general">
          <Select>
            <Select.Option value="general">General</Select.Option>
            <Select.Option value="promotion">Promotion</Select.Option>
            <Select.Option value="game_result">Game Result</Select.Option>
            <Select.Option value="wallet">Wallet Update</Select.Option>
          </Select>
        </Form.Item>

        <Form.Item name="title" label="Title" rules={[{ required: true, max: 100 }]}>
          <Input placeholder="Notification title" />
        </Form.Item>

        <Form.Item name="body" label="Message" rules={[{ required: true, max: 300 }]}>
          <Input.TextArea rows={3} placeholder="Notification body" />
        </Form.Item>

        <Form.Item>
          <Button type="primary" htmlType="submit" icon={<SendOutlined />} loading={loading} block>
            {target === 'all' ? 'Broadcast to All Users' : 'Send Notification'}
          </Button>
        </Form.Item>
      </Form>
    </Card>
  )
}

export default function Notifications() {
  return (
    <div style={{ padding: 24 }}>
      <Tabs
        items={[
          { key: 'send', label: 'Send', children: <SendTab /> },
          { key: 'history', label: 'History', children: <NotificationHistoryTab /> },
          { key: 'analytics', label: 'Analytics', children: <NotificationAnalyticsTab /> },
        ]}
      />
    </div>
  )
}
