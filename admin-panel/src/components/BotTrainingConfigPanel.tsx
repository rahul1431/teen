import React, { useEffect, useState } from 'react'
import { Card, Form, Switch, Select, Slider, Button, Space, message } from 'antd'
import { adminApi } from '../api/client'

interface BotTrainingConfig {
  enabled: boolean
  strategy: 'lifetime_winrate' | 'vs_rp_winrate' | 'rotation' | 'weakest_first'
  targetWinRate: number
  aggressiveness: number
}

const STRATEGY_OPTIONS = [
  { label: 'Highest Lifetime Win Rate', value: 'lifetime_winrate' },
  { label: 'Highest Win Rate vs RP', value: 'vs_rp_winrate' },
  { label: 'Rotation', value: 'rotation' },
  { label: 'Weakest Bot First', value: 'weakest_first' },
]

export const BotTrainingConfigPanel: React.FC = () => {
  const [config, setConfig] = useState<BotTrainingConfig | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [form] = Form.useForm()

  useEffect(() => {
    fetchConfig()
  }, [])

  const fetchConfig = async () => {
    try {
      const response = await adminApi.get('/ludo/bot-training/config')
      // Convert targetWinRate from decimal (0.85-1.0) to percentage (85-100) for display
      const configForDisplay = {
        ...response.data,
        targetWinRate: response.data.targetWinRate * 100,
      }
      setConfig(configForDisplay)
      form.setFieldsValue(configForDisplay)
      setLoading(false)
    } catch (error) {
      message.error('Failed to load bot training config')
      setLoading(false)
    }
  }

  const handleSave = async (values: any) => {
    setSaving(true)
    try {
      // Convert targetWinRate from percentage (85-100) to decimal (0.85-1.0)
      const configToSave = {
        ...values,
        targetWinRate: values.targetWinRate / 100,
      }
      await adminApi.patch('/ludo/bot-training/config', configToSave)
      setConfig(values)
      message.success('Bot training config updated')
    } catch (error) {
      message.error('Failed to update bot training config')
    } finally {
      setSaving(false)
    }
  }

  if (loading || !config) return <div>Loading...</div>

  return (
    <Card title="Bot Coordination Settings" bordered={false}>
      <Form
        form={form}
        layout="vertical"
        onFinish={handleSave}
        initialValues={config}
      >
        <Form.Item name="enabled" valuePropName="checked">
          <Switch /> Enable Bot Coordination
        </Form.Item>

        <Form.Item
          name="strategy"
          label="Election Strategy"
          rules={[{ required: true }]}
        >
          <Select options={STRATEGY_OPTIONS} />
        </Form.Item>

        <Form.Item
          name="targetWinRate"
          label="Target Win Rate (%)"
          rules={[
            { required: true },
            {
              validator: (_, value) => {
                if (value >= 85 && value <= 100) return Promise.resolve()
                return Promise.reject(new Error('Must be 85-100%'))
              },
            },
          ]}
        >
          <Slider min={85} max={100} step={1} marks={{ 85: '85%', 100: '100%' }} />
        </Form.Item>

        <Form.Item
          name="aggressiveness"
          label="Coordination Aggressiveness"
          help="How hard helpers try to sabotage the RP (0=subtle, 1=aggressive)"
        >
          <Slider
            min={0}
            max={1}
            step={0.1}
            marks={{ 0: 'Conservative', 1: 'Aggressive' }}
          />
        </Form.Item>

        <Form.Item>
          <Button type="primary" htmlType="submit" loading={saving}>
            Save Config
          </Button>
        </Form.Item>
      </Form>
    </Card>
  )
}
