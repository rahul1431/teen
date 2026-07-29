import React, { useEffect, useState } from 'react'
import { Card, Form, Switch, Select, Slider, Button, Space, message, Statistic, Row, Col, Typography } from 'antd'
import { adminApi } from '../api/client'

const { Text } = Typography

interface BotTrainingConfig {
  enabled: boolean
  strategy: 'lifetime_winrate' | 'vs_rp_winrate' | 'rotation' | 'weakest_first' | 'tiered_hard_wins'
  fallbackStrategy: 'lifetime_winrate' | 'vs_rp_winrate' | 'rotation' | 'weakest_first'
  targetWinRate: number
  aggressiveness: number
  winnerBotSkill: 'casual' | 'skilled' | 'expert'
  winnerBotBoldness: number
  adaptiveBoldness: boolean
  winnerBotDiceBias: number
  effectiveBoldness?: number // read-only, returned by GET only
}

const STRATEGY_OPTIONS = [
  { label: 'Highest Lifetime Win Rate', value: 'lifetime_winrate' },
  { label: 'Highest Win Rate vs RP', value: 'vs_rp_winrate' },
  { label: 'Rotation', value: 'rotation' },
  { label: 'Weakest Bot First', value: 'weakest_first' },
  { label: 'Tiered Hard-Wins (hard-tier bot always wins)', value: 'tiered_hard_wins' },
]

const FALLBACK_STRATEGY_OPTIONS = [
  { label: 'Highest Lifetime Win Rate', value: 'lifetime_winrate' },
  { label: 'Highest Win Rate vs RP', value: 'vs_rp_winrate' },
  { label: 'Rotation', value: 'rotation' },
  { label: 'Weakest Bot First', value: 'weakest_first' },
]

const WINNER_SKILL_OPTIONS = [
  { label: 'Casual — tactical booster (captures, safe cells, most progress)', value: 'casual' },
  { label: 'Skilled — casual + avoids leaving itself exposed to the RP', value: 'skilled' },
  { label: 'Expert — full move scoring, tuned by boldness below', value: 'expert' },
]

export const BotTrainingConfigPanel: React.FC = () => {
  const [config, setConfig] = useState<BotTrainingConfig | null>(null)
  const [effectiveBoldness, setEffectiveBoldness] = useState<number | undefined>(undefined)
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
      setEffectiveBoldness(response.data.effectiveBoldness)
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
        <Form.Item name="enabled" label="Enable Bot Coordination" valuePropName="checked">
          <Switch />
        </Form.Item>

        <Form.Item
          name="strategy"
          label="Election Strategy"
          help="Tiered Hard-Wins requires one easy-, one medium-, and one hard-tagged bot to be seated together (set per-bot via a bot's Difficulty Override) — falls back to the strategy below whenever a full set isn't available for a room. Uses its own maxed-out bias, independent of the sliders further down; real win rate realistically lands ~60-70%, not literally guaranteed."
          rules={[{ required: true }]}
        >
          <Select options={STRATEGY_OPTIONS} />
        </Form.Item>

        <Form.Item noStyle shouldUpdate={(prev, cur) => prev.strategy !== cur.strategy}>
          {({ getFieldValue }) => {
            if (getFieldValue('strategy') !== 'tiered_hard_wins') return null
            return (
              <Form.Item
                name="fallbackStrategy"
                label="Fallback Strategy"
                help="Used only when a room can't be seated with one easy/medium/hard bot each"
                rules={[{ required: true }]}
              >
                <Select options={FALLBACK_STRATEGY_OPTIONS} />
              </Form.Item>
            )
          }}
        </Form.Item>

        <Form.Item
          name="targetWinRate"
          label="Target Win Rate (%)"
          help="Simulation against the current move-choice + dice bias settings shows this design realistically plateaus around 55-65% -- treat higher targets as aspirational, not guaranteed"
          rules={[
            { required: true },
            {
              validator: (_, value) => {
                if (value >= 50 && value <= 100) return Promise.resolve()
                return Promise.reject(new Error('Must be 50-100%'))
              },
            },
          ]}
        >
          <Slider min={50} max={100} step={1} marks={{ 50: '50%', 100: '100%' }} />
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

        <Form.Item
          name="winnerBotSkill"
          label="Winner Bot Skill"
          help="How smart the elected winner bot's own moves are — helpers stay unaffected"
        >
          <Select options={WINNER_SKILL_OPTIONS} />
        </Form.Item>

        <Form.Item noStyle shouldUpdate={(prev, cur) => prev.winnerBotSkill !== cur.winnerBotSkill || prev.adaptiveBoldness !== cur.adaptiveBoldness}>
          {({ getFieldValue }) => {
            const skill = getFieldValue('winnerBotSkill')
            if (skill === 'casual') return null
            const adaptive = getFieldValue('adaptiveBoldness')
            return (
              <Form.Item
                name="winnerBotBoldness"
                label={adaptive ? 'Winner Bot Boldness (starting point / floor)' : 'Winner Bot Boldness'}
                help="How much the winner bot favours racing/captures (bold) vs. playing it safe (cautious)"
              >
                <Slider min={0} max={1} step={0.1} marks={{ 0: 'Cautious', 1: 'Bold' }} />
              </Form.Item>
            )
          }}
        </Form.Item>

        <Form.Item
          name="adaptiveBoldness"
          label="Adaptive Boldness (self-learning)"
          valuePropName="checked"
          help="Auto-tune boldness from the last 20 coordinated games' success rate vs. target win rate, instead of using a fixed value"
        >
          <Switch />
        </Form.Item>

        <Form.Item
          name="winnerBotDiceBias"
          label="Winner Bot Dice Bias"
          help="Skews the winner bot's OWN dice rolls toward high faces (0 = completely fair, same as every other player). This is direct outcome manipulation, not move-choice AI. Simulation showed this plateaus around 0.3-0.5 (~60% win rate) -- the three-consecutive-sixes forfeit rule caps further gains from pushing higher."
        >
          <Slider min={0} max={1} step={0.1} marks={{ 0: 'Fair', 0.4: 'Recommended', 1: 'Max' }} />
        </Form.Item>

        {config.adaptiveBoldness && effectiveBoldness !== undefined && (
          <Row style={{ marginBottom: 24 }}>
            <Col>
              <Statistic
                title="Current Effective Boldness"
                value={effectiveBoldness}
                precision={2}
                valueStyle={{ color: '#1677ff' }}
              />
              <Text type="secondary" style={{ fontSize: 12 }}>
                Auto-tuned from recent coordination results — refreshes on page load
              </Text>
            </Col>
          </Row>
        )}

        <Form.Item>
          <Button type="primary" htmlType="submit" loading={saving}>
            Save Config
          </Button>
        </Form.Item>
      </Form>
    </Card>
  )
}
