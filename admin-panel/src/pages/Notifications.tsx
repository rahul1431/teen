import { useEffect, useState } from 'react'
import { Form, Input, Button, Select, Card, message, Radio, Tabs, Switch, DatePicker, Space } from 'antd'
import { SendOutlined, SaveOutlined } from '@ant-design/icons'
import { adminApi } from '../api/client'
import { NotificationHistoryTab } from '../components/NotificationHistoryTab'
import { NotificationAnalyticsTab } from '../components/NotificationAnalyticsTab'

const ROUTE_OPTIONS = [
  { value: '/home', label: 'Home' },
  { value: '/games/ludo', label: 'Ludo' },
  { value: '/games/teen-patti', label: 'Teen Patti' },
  { value: '/games/matka', label: 'Satta Matka' },
  { value: '/games/lottery', label: 'Lottery' },
  { value: '/games/cricket', label: 'Cricket' },
  { value: '/wallet', label: 'Wallet' },
  { value: '/leaderboard', label: 'Leaderboard' },
  { value: '/missions', label: 'Missions' },
  { value: '/referral', label: 'Refer & Earn' },
  { value: 'custom', label: 'Custom route…' },
]

function SendTab() {
  const [loading, setLoading] = useState(false)
  const [form] = Form.useForm()
  const [target, setTarget] = useState<'all' | 'user'>('all')
  const [routeChoice, setRouteChoice] = useState<string | undefined>(undefined)
  const [isScheduled, setIsScheduled] = useState(false)
  const [templates, setTemplates] = useState<any[]>([])

  useEffect(() => {
    fetchTemplates()
  }, [])

  async function fetchTemplates() {
    try {
      const res = await adminApi.get('/notifications/templates')
      setTemplates(res.data)
    } catch {
      message.error('Failed to load templates')
    }
  }

  const resolveRoute = (values: any): string | undefined => {
    if (!routeChoice) return undefined
    if (routeChoice === 'custom') return values.customRoute?.trim() || undefined
    return routeChoice
  }

  const onSend = async (values: any) => {
    setLoading(true)
    try {
      const route = resolveRoute(values)
      const data = route ? { route } : undefined
      const payload: any = {
        title: values.title,
        body: values.body,
        type: values.type || 'general',
        data,
        image_url: values.image_url || undefined,
        scheduled_for: isScheduled && values.scheduled_for ? values.scheduled_for.toISOString() : undefined,
      }

      if (target === 'all') {
        payload.segment_type = values.segment_type || 'all'
        await adminApi.post('/notifications/broadcast', payload)
        message.success(isScheduled ? 'Broadcast scheduled successfully!' : 'Broadcast sent to users!')
      } else {
        payload.user_id = values.user_id
        await adminApi.post('/notifications/send', payload)
        message.success(isScheduled ? 'Notification scheduled successfully!' : 'Notification sent!')
      }
      form.resetFields(['title', 'body', 'user_id', 'customRoute', 'image_url', 'scheduled_for'])
      setRouteChoice(undefined)
      setIsScheduled(false)
    } catch {
      message.error('Failed to dispatch notification')
    } finally {
      setLoading(false)
    }
  }

  const onTemplateSelect = (val: string) => {
    const t = templates.find(item => item.id === val)
    if (t) {
      form.setFieldsValue({
        title: t.title,
        body: t.body,
        type: t.type,
        image_url: t.image_url,
      })
      if (t.route) {
        const isStandard = ROUTE_OPTIONS.some(opt => opt.value === t.route)
        if (isStandard) {
          setRouteChoice(t.route)
        } else {
          setRouteChoice('custom')
          form.setFieldsValue({ customRoute: t.route })
        }
      } else {
        setRouteChoice(undefined)
      }
    }
  }

  const saveAsTemplate = async () => {
    try {
      const values = await form.validateFields(['title', 'body', 'type', 'customRoute', 'image_url'])
      const name = prompt('Enter a name for this template:')
      if (!name || !name.trim()) return
      
      const route = resolveRoute(values)
      await adminApi.post('/notifications/templates', {
        name: name.trim(),
        title: values.title,
        body: values.body,
        type: values.type,
        route,
        image_url: values.image_url || undefined,
      })
      message.success('Template saved!')
      fetchTemplates()
    } catch (e) {
      message.error('Please enter Title and Message before saving a template')
    }
  }

  return (
    <Card title="Send Push Notification" style={{ maxWidth: 600 }}>
      <Form form={form} layout="vertical" onFinish={onSend}>
        <Form.Item label="Load Template">
          <Select
            allowClear
            placeholder="Select a preset template"
            onChange={onTemplateSelect}
            options={templates.map(t => ({ value: t.id, label: t.name }))}
          />
        </Form.Item>

        <Form.Item label="Send To">
          <Radio.Group value={target} onChange={e => setTarget(e.target.value)}>
            <Radio.Button value="all">Users Segment</Radio.Button>
            <Radio.Button value="user">Specific User</Radio.Button>
          </Radio.Group>
        </Form.Item>

        {target === 'all' && (
          <Form.Item name="segment_type" label="Target Segment" initialValue="all">
            <Select>
              <Select.Option value="all">All Active Users</Select.Option>
              <Select.Option value="active_7d">Active Last 7 Days</Select.Option>
              <Select.Option value="inactive_7d">Inactive Last 7 Days (Re-engage)</Select.Option>
              <Select.Option value="low_balance">Low Balance (&lt; ₹100)</Select.Option>
            </Select>
          </Form.Item>
        )}

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

        <Form.Item name="image_url" label="Rich Push Image URL (optional)">
          <Input placeholder="e.g. https://domain.com/banner.png" />
        </Form.Item>

        <Form.Item label="Deep Link (optional)" help="Where tapping the notification takes the user — leave blank to just open the app">
          <Select
            allowClear
            placeholder="No deep link"
            value={routeChoice}
            onChange={setRouteChoice}
            options={ROUTE_OPTIONS}
          />
        </Form.Item>

        {routeChoice === 'custom' && (
          <Form.Item name="customRoute" label="Custom Route" rules={[{ required: true }]}>
            <Input placeholder="e.g. /games/ludo/lobby" />
          </Form.Item>
        )}

        <Form.Item label="Schedule for Later">
          <Space>
            <Switch checked={isScheduled} onChange={setIsScheduled} />
            {isScheduled && (
              <Form.Item name="scheduled_for" noStyle rules={[{ required: true, message: 'Please pick a time' }]}>
                <DatePicker showTime format="YYYY-MM-DD HH:mm" placeholder="Select date & time" />
              </Form.Item>
            )}
          </Space>
        </Form.Item>

        <Form.Item style={{ marginTop: 24 }}>
          <Space style={{ width: '100%' }}>
            <Button type="primary" htmlType="submit" icon={<SendOutlined />} loading={loading} style={{ minWidth: 200 }}>
              {isScheduled ? 'Schedule Notification' : (target === 'all' ? 'Broadcast to Segment' : 'Send Notification')}
            </Button>
            <Button type="dashed" onClick={saveAsTemplate} icon={<SaveOutlined />}>
              Save as Template
            </Button>
          </Space>
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

