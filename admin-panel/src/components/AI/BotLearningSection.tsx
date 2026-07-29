import { useState, useEffect } from 'react'
import { Card, Row, Col, Button, Statistic, Tag, Slider, Form, InputNumber, message, Divider, Spin, Tooltip } from 'antd'
import { SyncOutlined, RobotOutlined } from '@ant-design/icons'
import { adminApi } from '../../api/client'

interface BotProfile {
  game_type: string
  difficulty: string
  fold_probability: number
  call_probability: number
  raise_probability: number
  avg_decision_delay_ms: number
  aggression_score: number
  sample_size: number
  last_rebuilt_at: string | null
}

interface BotConfig {
  rebuild_hour: number
  stream_lookback_days: number
  min_sample_size: number
}

const GAME_LABELS: Record<string, string> = {
  teen_patti: 'Teen Patti',
  ludo: 'Ludo',
  aviator: 'Aviator',
}

const DIFF_COLORS: Record<string, string> = { easy: 'green', medium: 'orange', hard: 'red' }

export function BotLearningSection() {
  const [profiles, setProfiles] = useState<BotProfile[]>([])
  const [loading, setLoading] = useState(true)
  const [rebuilding, setRebuilding] = useState(false)
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const [config, setConfig] = useState<BotConfig | null>(null)
  const [saving, setSaving] = useState(false)
  const [configForm] = Form.useForm()

  useEffect(() => {
    loadProfiles(); loadConfig()
    const handleRefresh = () => { loadProfiles(); loadConfig() }
    window.addEventListener('aiDashboardRefresh', handleRefresh)
    return () => window.removeEventListener('aiDashboardRefresh', handleRefresh)
  }, [])

  const loadProfiles = async () => {
    setLoading(true)
    try {
      const res = await adminApi.get('bots/profiles')
      if (res.data.success) {
        // pg returns NUMERIC columns as strings — coerce before any .toFixed/math
        setProfiles((res.data.data.profiles ?? []).map((p: any) => ({
          ...p,
          fold_probability: Number(p.fold_probability) || 0,
          call_probability: Number(p.call_probability) || 0,
          raise_probability: Number(p.raise_probability) || 0,
          avg_decision_delay_ms: Number(p.avg_decision_delay_ms) || 0,
          aggression_score: Number(p.aggression_score) || 0,
          sample_size: Number(p.sample_size) || 0,
        })))
      }
    } catch { message.error('Failed to load bot profiles') }
    finally { setLoading(false) }
  }

  const triggerRebuild = async () => {
    setRebuilding(true)
    try {
      await adminApi.post('bots/rebuild')
      message.success('Rebuild started â€” profiles will update in ~1 minute')
      setTimeout(loadProfiles, 5000)
    } catch { message.error('Failed to trigger rebuild') }
    finally { setRebuilding(false) }
  }

  const loadConfig = async () => {
    try {
      const res = await adminApi.get('bots/config')
      if (res.data.success) {
        setConfig(res.data.data)
        configForm.setFieldsValue(res.data.data)
      }
    } catch { /* silent */ }
  }

  const saveConfig = async (values: BotConfig) => {
    setSaving(true)
    try {
      const updates: Record<string, string> = {}
      for (const [k, v] of Object.entries(values)) updates[k] = String(v)
      await adminApi.patch('bots/config', updates)
      message.success('Config saved')
    } catch { message.error('Failed to save config') }
    finally { setSaving(false) }
  }

  const saveOverride = async (gameType: string, difficulty: string, values: Record<string, unknown>) => {
    try {
      await adminApi.patch(`bots/profiles/${gameType}/${difficulty}`, {
        fold_probability:      parseFloat(String(values.fold_probability)) / 100,
        call_probability:      parseFloat(String(values.call_probability)) / 100,
        avg_decision_delay_ms: parseInt(String(values.avg_decision_delay_ms)),
      })
      message.success(`${GAME_LABELS[gameType]} ${difficulty} profile updated`)
      setEditingKey(null)
      await loadProfiles()
    } catch { message.error('Failed to save override') }
  }

  const gameTypes = [...new Set(profiles.map(p => p.game_type))]

  if (loading) return <Spin />

  return (
    <div style={{ marginTop: 24 }}>
      <Divider orientation="left">
        <RobotOutlined /> Bot Learning
      </Divider>

      <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ color: '#888', fontSize: 12 }}>
          Profiles rebuilt nightly from real player data. Sample size shows how many real players were used.
        </span>
        <Button
          icon={<SyncOutlined spin={rebuilding} />}
          onClick={triggerRebuild}
          loading={rebuilding}
          type="primary"
        >
          Rebuild Now
        </Button>
      </div>

      {gameTypes.map(gameType => (
        <div key={gameType} style={{ marginBottom: 24 }}>
          <h4 style={{ marginBottom: 8 }}>{GAME_LABELS[gameType] ?? gameType}</h4>
          <Row gutter={12}>
            {['easy', 'medium', 'hard'].map(difficulty => {
              const profile = profiles.find(p => p.game_type === gameType && p.difficulty === difficulty)
              if (!profile) return null
              const key = `${gameType}:${difficulty}`
              const isEditing = editingKey === key

              return (
                <Col span={8} key={difficulty}>
                  <Card
                    size="small"
                    title={<Tag color={DIFF_COLORS[difficulty]}>{difficulty.toUpperCase()}</Tag>}
                    extra={
                      <Button size="small" onClick={() => setEditingKey(isEditing ? null : key)}>
                        {isEditing ? 'Cancel' : 'Override'}
                      </Button>
                    }
                  >
                    <Statistic title="Fold %" value={Math.round(profile.fold_probability * 100)} suffix="%" valueStyle={{ fontSize: 14 }} />
                    <Statistic title="Call %" value={Math.round(profile.call_probability * 100)} suffix="%" valueStyle={{ fontSize: 14 }} />
                    <Statistic title="Raise %" value={Math.round(profile.raise_probability * 100)} suffix="%" valueStyle={{ fontSize: 14 }} />
                    <Statistic title="Delay" value={profile.avg_decision_delay_ms} suffix="ms" valueStyle={{ fontSize: 14 }} />
                    <Statistic title="Aggression" value={profile.aggression_score.toFixed(2)} valueStyle={{ fontSize: 14 }} />
                    <div style={{ fontSize: 11, color: '#888', marginTop: 8 }}>
                      <Tooltip title={profile.last_rebuilt_at ? new Date(profile.last_rebuilt_at).toLocaleString() : 'Never rebuilt'}>
                        Sample: {profile.sample_size === 0 ? 'fallback' : `${profile.sample_size} players`}
                      </Tooltip>
                    </div>

                    {isEditing && (
                      <Form
                        layout="vertical"
                        style={{ marginTop: 12 }}
                        initialValues={{
                          fold_probability: Math.round(profile.fold_probability * 100),
                          call_probability: Math.round(profile.call_probability * 100),
                          avg_decision_delay_ms: profile.avg_decision_delay_ms,
                        }}
                        onFinish={(vals) => saveOverride(gameType, difficulty, vals)}
                      >
                        <Form.Item label="Fold %" name="fold_probability">
                          <Slider min={5} max={70} />
                        </Form.Item>
                        <Form.Item label="Call %" name="call_probability">
                          <Slider min={15} max={75} />
                        </Form.Item>
                        <Form.Item label="Delay (ms)" name="avg_decision_delay_ms">
                          <Slider min={500} max={5000} step={100} />
                        </Form.Item>
                        <Button type="primary" htmlType="submit" block size="small">Save</Button>
                      </Form>
                    )}
                  </Card>
                </Col>
              )
            })}
          </Row>
        </div>
      ))}

      <Divider orientation="left">Bot Config</Divider>
      <Card title="Schedule & Sampling Config" style={{ maxWidth: 480 }}>
        {config && (
          <Form form={configForm} layout="vertical" onFinish={saveConfig} initialValues={config}>
            <Form.Item label="Rebuild hour (0â€“23 UTC)" name="rebuild_hour">
              <InputNumber min={0} max={23} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item label="Stream lookback (days)" name="stream_lookback_days">
              <InputNumber min={1} max={90} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item label="Minimum sample size" name="min_sample_size">
              <InputNumber min={1} max={10000} style={{ width: '100%' }} />
            </Form.Item>
            <Button type="primary" htmlType="submit" loading={saving} block>Save Config</Button>
          </Form>
        )}
      </Card>
    </div>
  )
}

