import { useEffect, useState } from 'react'
import { Card, Form, Switch, Select, InputNumber, Button, message, Divider, Row, Col, Tag } from 'antd'
import { adminApi } from '../api/client'

const GAME_LABELS: Record<string, string> = {
  teen_patti: '🃏 Teen Patti',
  aviator: '✈️ Aviator',
  rummy: '🎴 Rummy',
  ludo: '🎲 Ludo',
  matka: '🎯 Matka',
  lottery: '🎰 Lottery',
}

export default function GameConfig() {
  const [configs, setConfigs] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    adminApi.get('/game-configs').then(r => setConfigs(r.data)).finally(() => setLoading(false))
  }, [])

  const saveConfig = async (gameType: string, values: any) => {
    setSaving(gameType)
    try {
      await adminApi.patch(`/game-configs/${gameType}`, values)
      message.success(`${GAME_LABELS[gameType]} config saved!`)
    } catch {
      message.error('Failed to save config')
    } finally { setSaving(null) }
  }

  return (
    <Row gutter={[16, 16]}>
      {configs.map(cfg => (
        <Col key={cfg.game_type} xs={24} xl={12}>
          <Card
            title={<span>{GAME_LABELS[cfg.game_type] || cfg.game_type} {cfg.is_active ? <Tag color="green">LIVE</Tag> : <Tag color="red">OFF</Tag>}</span>}
            loading={loading}
          >
            <Form
              layout="vertical"
              initialValues={cfg}
              onFinish={(values) => saveConfig(cfg.game_type, values)}
            >
              <Form.Item name="is_active" label="Game Active" valuePropName="checked">
                <Switch checkedChildren="ON" unCheckedChildren="OFF" />
              </Form.Item>
              <Form.Item name="rake_percent" label="Rake % (Platform Fee)">
                <InputNumber min={0} max={20} step={0.5} suffix="%" style={{ width: '100%' }} />
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
                <Button type="primary" htmlType="submit" block loading={saving === cfg.game_type}>
                  Save Config
                </Button>
              </Form.Item>
            </Form>
          </Card>
        </Col>
      ))}
    </Row>
  )
}
