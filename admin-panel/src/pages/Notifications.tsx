import { useEffect, useState } from 'react'
import {
  Form,
  Input,
  Button,
  Select,
  Card,
  message,
  Radio,
  Tabs,
  Switch,
  DatePicker,
  Space,
  Tag,
  Tooltip,
  InputNumber,
} from 'antd'
import {
  SendOutlined,
  SaveOutlined,
  ThunderboltOutlined,
  FieldTimeOutlined,
  ControlOutlined,
  AppstoreAddOutlined,
} from '@ant-design/icons'
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
  { value: '/wallet', label: 'Wallet / Cashier' },
  { value: '/leaderboard', label: 'Leaderboard' },
  { value: '/missions', label: 'Missions' },
  { value: '/referral', label: 'Refer & Earn' },
  { value: 'custom', label: 'Custom route…' },
]

const ACTION_BUTTON_PRESETS = [
  { value: 'none', label: 'None (Standard Notification)' },
  {
    value: 'claim_and_play',
    label: 'Claim & Play ([ Claim Bonus 💰 ] + [ Play Now 🃏 ])',
    actions: [
      { id: 'action_claim', title: 'Claim Bonus 💰', route: '/wallet' },
      { id: 'action_play', title: 'Play Now 🃏', route: '/games/teen-patti' },
    ],
  },
  {
    value: 'table_and_lobby',
    label: 'Join Table & Lobby ([ Join Table 🎮 ] + [ View Lobby 🏆 ])',
    actions: [
      { id: 'action_play', title: 'Join Table 🎮', route: '/games/teen-patti' },
      { id: 'action_lobby', title: 'View Lobby 🏆', route: '/home' },
    ],
  },
]

function SendTab() {
  const [loading, setLoading] = useState(false)
  const [form] = Form.useForm()
  const [target, setTarget] = useState<'all' | 'user'>('all')
  const [routeChoice, setRouteChoice] = useState<string | undefined>(undefined)
  const [actionPreset, setActionPreset] = useState<string>('none')
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

  const insertTag = (tag: string) => {
    const currentBody = form.getFieldValue('body') || ''
    form.setFieldsValue({ body: `${currentBody} ${tag} `.trim() })
  }

  const onSend = async (values: any) => {
    setLoading(true)
    try {
      const route = resolveRoute(values)
      const data = route ? { route } : undefined
      
      const chosenPreset = ACTION_BUTTON_PRESETS.find(p => p.value === actionPreset)
      const actionButtons = chosenPreset && chosenPreset.value !== 'none' ? chosenPreset.actions : undefined

      const payload: any = {
        title: values.title,
        body: values.body,
        type: values.type || 'general',
        data,
        action_buttons: actionButtons,
        image_url: values.image_url || undefined,
        scheduled_for: isScheduled && values.scheduled_for ? values.scheduled_for.toISOString() : undefined,
      }

      if (target === 'all') {
        payload.segment_type = values.segment_type || 'all'
        payload.quiet_hours_enabled = values.quiet_hours_enabled ?? true
        payload.urgent = values.urgent ?? false
        payload.frequency_cap = values.frequency_cap || 3
        const res = await adminApi.post('/notifications/broadcast', payload)
        if (res.data?.quiet_hours) {
          message.warning(res.data.message || 'Broadcast paused due to quiet hours')
        } else {
          const sent = res.data?.sent ?? 0
          const skipped = res.data?.skipped_fatigue ?? 0
          if (skipped > 0) {
            message.success(`Broadcast sent to ${sent} active users (${skipped} protected by daily fatigue cap)!`)
          } else {
            message.success(isScheduled ? 'Broadcast scheduled successfully!' : `Broadcast sent to ${sent} active users!`)
          }
        }
      } else {
        payload.user_id = values.user_id
        await adminApi.post('/notifications/send', payload)
        message.success(isScheduled ? 'Notification scheduled successfully!' : 'Notification sent!')
      }
      form.resetFields(['title', 'body', 'user_id', 'customRoute', 'image_url', 'scheduled_for'])
      setRouteChoice(undefined)
      setActionPreset('none')
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
    <Card title="Send Push Notification" style={{ maxWidth: 680 }}>
      <Form
        form={form}
        layout="vertical"
        onFinish={onSend}
        initialValues={{ quiet_hours_enabled: true, frequency_cap: 3 }}
      >
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

        <Form.Item
          name="body"
          label={
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
              <span>Message</span>
              <Space direction="horizontal" size={6}>
                <span style={{ fontSize: 11, color: '#8c8c8c' }}>Dynamic tags:</span>
                <Tooltip title="Replaced with recipient's username">
                  <Tag color="gold" style={{ cursor: 'pointer', margin: 0 }} onClick={() => insertTag('{{username}}')}>
                    + {'{{username}}'}
                  </Tag>
                </Tooltip>
                <Tooltip title="Replaced with recipient's wallet balance">
                  <Tag color="cyan" style={{ cursor: 'pointer', margin: 0 }} onClick={() => insertTag('{{balance}}')}>
                    + {'{{balance}}'}
                  </Tag>
                </Tooltip>
              </Space>
            </div>
          }
          rules={[{ required: true, max: 300 }]}
        >
          <Input.TextArea rows={3} placeholder="Notification body (e.g. Hey {{username}}, your balance is {{balance}}! Play now)" />
        </Form.Item>

        <Form.Item name="image_url" label="Rich Push Image URL (optional)">
          <Input placeholder="e.g. https://domain.com/banner.png" />
        </Form.Item>

        <Form.Item label="Interactive Action Buttons (Lock Screen)" help="Action buttons displayed directly in user's OS notification tray">
          <Select
            value={actionPreset}
            onChange={setActionPreset}
            options={ACTION_BUTTON_PRESETS}
            suffixIcon={<AppstoreAddOutlined />}
          />
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

        {target === 'all' && (
          <div style={{ background: '#141414', border: '1px solid #303030', borderRadius: 8, padding: '12px 16px', marginBottom: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <Space>
                  <FieldTimeOutlined style={{ color: '#faad14' }} />
                  <span style={{ fontWeight: 600, color: '#e6e6e6' }}>Quiet Hours Protection (IST)</span>
                </Space>
                <div style={{ fontSize: 12, color: '#8c8c8c', marginTop: 4 }}>
                  Pauses non-urgent broadcasts between 10:00 PM and 8:30 AM IST to prevent user fatigue & uninstalls.
                </div>
              </div>
              <Form.Item name="quiet_hours_enabled" valuePropName="checked" noStyle>
                <Switch />
              </Form.Item>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12, paddingTop: 10, borderTop: '1px dashed #262626' }}>
              <div>
                <Space>
                  <ControlOutlined style={{ color: '#52c41a' }} />
                  <span style={{ fontWeight: 600, color: '#e6e6e6' }}>Daily Anti-Fatigue Frequency Cap</span>
                </Space>
                <div style={{ fontSize: 11, color: '#8c8c8c' }}>
                  Max promotional pushes allowed per user in a 24h rolling period. Excess pushes skip noisy lock-screen tray.
                </div>
              </div>
              <Form.Item name="frequency_cap" noStyle>
                <InputNumber min={1} max={5} style={{ width: 70 }} />
              </Form.Item>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12, paddingTop: 10, borderTop: '1px dashed #262626' }}>
              <div>
                <Space>
                  <ThunderboltOutlined style={{ color: '#ff4d4f' }} />
                  <span style={{ fontSize: 13, color: '#e6e6e6' }}>Mark as Urgent (Bypass Quiet Hours & Fatigue Cap)</span>
                </Space>
                <div style={{ fontSize: 11, color: '#8c8c8c' }}>
                  Force immediate delivery (critical service maintenance or emergency only).
                </div>
              </div>
              <Form.Item name="urgent" valuePropName="checked" noStyle initialValue={false}>
                <Switch />
              </Form.Item>
            </div>
          </div>
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
          { key: 'analytics', label: 'Analytics & Revenue Attribution', children: <NotificationAnalyticsTab /> },
        ]}
      />
    </div>
  )
}
