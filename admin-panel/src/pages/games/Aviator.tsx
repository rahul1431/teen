import { useEffect, useState } from 'react'
import {
  Card, Form, Switch, InputNumber, Select, Button, message, Divider, Row, Col, Tag
} from 'antd'
import { adminApi } from '../../api/client'

export default function Aviator() {
  const [config, setConfig] = useState<any>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)

  const loadConfig = () => {
    setLoading(true)
    adminApi.get('/game-configs')
      .then(r => {
        const avConfig = r.data.find((c: any) => c.game_type === 'aviator')
        setConfig(avConfig)
      })
      .finally(() => setLoading(false))
  }

  const saveConfig = async (values: any) => {
    setSaving(true)
    try {
      const { house_edge_percent, max_win, min_bet, max_bet, betting_time_ms, ...rest } = values
      const payload: any = {
        ...rest,
        special_rules: { house_edge_percent, max_win, min_bet, max_bet, betting_time_ms }
      }
      await adminApi.patch('/game-configs/aviator', payload)
      message.success('Aviator configuration saved!')
      loadConfig()
    } catch {
      message.error('Failed to save configuration')
    } finally {
      setSaving(false)
    }
  }

  useEffect(() => {
    loadConfig()
  }, [])

  return (
    <div>
      <h2 style={{ color: '#d4af37', marginBottom: 24 }}>✈️ Aviator Management</h2>
      <Row gutter={[24, 24]}>
        <Col xs={24} lg={12}>
          <Card
            title={
              <span>
                Aviator Rules & Settings{' '}
                {config?.is_active ? <Tag color="green">LIVE</Tag> : <Tag color="red">OFF</Tag>}
              </span>
            }
            loading={loading}
          >
            {config && (
              <Form
                layout="vertical"
                initialValues={{ ...config, ...(config.special_rules || {}) }}
                onFinish={saveConfig}
              >
                <Form.Item name="is_active" label="Game Active" valuePropName="checked">
                  <Switch checkedChildren="ON" unCheckedChildren="OFF" />
                </Form.Item>
                <Form.Item name="rake_percent" label="Rake % (Platform Fee)">
                  <InputNumber min={0} max={20} step={0.5} suffix="%" style={{ width: '100%' }} />
                </Form.Item>

                <Divider>Aviator Economics 💰</Divider>
                <Form.Item name="house_edge_percent" label="House Edge % (instant-crash rate → profit margin)">
                  <InputNumber min={0} max={20} step={0.5} suffix="%" style={{ width: '100%' }} />
                </Form.Item>
                <Form.Item name="max_win" label="Max Win Cap (₹, 0 = unlimited)">
                  <InputNumber min={0} step={1000} style={{ width: '100%' }} />
                </Form.Item>
                <Form.Item name="min_bet" label="Min Bet (₹)">
                  <InputNumber min={1} step={10} style={{ width: '100%' }} />
                </Form.Item>
                <Form.Item name="max_bet" label="Max Bet (₹)">
                  <InputNumber min={10} step={100} style={{ width: '100%' }} />
                </Form.Item>
                <Form.Item name="betting_time_ms" label="Betting Window (ms)">
                  <InputNumber min={2000} max={15000} step={500} style={{ width: '100%' }} />
                </Form.Item>

                <Divider>Bot Settings</Divider>
                <Form.Item name="bot_fill_enabled" label="Bot Fill Enabled" valuePropName="checked">
                  <Switch checkedChildren="Yes" unCheckedChildren="No" />
                </Form.Item>
                <Form.Item name="bot_fill_delay_seconds" label="Bot Fill Delay (seconds)">
                  <InputNumber min={5} max={60} style={{ width: '100%' }} />
                </Form.Item>
                <Form.Item name="max_bot_ratio" label="Max Bot Ratio (0-1)">
                  <InputNumber min={0} max={1} step={0.1} style={{ width: '100%' }} />
                </Form.Item>
                <Form.Item name="bot_difficulty" label="Bot Difficulty">
                  <Select>
                    <Select.Option value="easy">Easy</Select.Option>
                    <Select.Option value="medium">Medium</Select.Option>
                    <Select.Option value="hard">Hard</Select.Option>
                  </Select>
                </Form.Item>

                <Form.Item>
                  <Button type="primary" htmlType="submit" block loading={saving}>
                    Save Config
                  </Button>
                </Form.Item>
              </Form>
            )}
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card title="Aviator System Overview">
            <p>
              Aviator operates as a single continuous multiplayer crash round in memory.
              Bets are accepted during the betting window, after which the multiplier increases exponentially until a random crash point occurs.
            </p>
            <p>
              The crash point is calculated in a provably fair manner using HMAC-SHA256 based on the server seed and round ID. The house edge setting defines the probability of an instant 1.00x crash.
            </p>
          </Card>
        </Col>
      </Row>
    </div>
  )
}
