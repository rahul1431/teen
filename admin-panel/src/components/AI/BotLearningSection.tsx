import { useState, useEffect, useCallback } from 'react'
import { Card, Row, Col, Button, Statistic, Tag, Slider, Form, InputNumber, message, Divider, Spin, Tooltip, Alert } from 'antd'
import { SyncOutlined, RobotOutlined } from '@ant-design/icons'
import { adminApi } from '../../api/client'

/**
 * Per-game bot training panel.
 *
 * Each game is served by its own trainer (services/bot-training/<game>) and has
 * its own profile shape, so this renders different controls per game rather
 * than one card layout with fields blanked out. Teen Patti bots decide
 * fold/call/raise; Ludo bots decide which token to move, so showing Ludo a
 * "Fold %" slider — as the shared version did — described a decision the game
 * does not have.
 */

interface BotProfile {
  game_type: string
  difficulty: string
  win_rate_target: number
  avg_decision_delay_ms: number
  sample_size: number
  last_rebuilt_at: string | null
  // Teen Patti only
  fold_probability?: number
  call_probability?: number
  raise_probability?: number
  aggression_score?: number
  // Ludo only. null is meaningful: the bot falls back to its deterministic
  // rule rather than rolling against a learned rate.
  capture_probability?: number | null
  safe_play_probability?: number | null
}

interface BotConfig {
  rebuild_hour: number
  stream_lookback_days: number
  min_sample_size: number
}

const GAME_LABELS: Record<string, string> = {
  teen_patti: 'Teen Patti',
  ludo: 'Ludo',
}

const DIFF_COLORS: Record<string, string> = { easy: 'green', medium: 'orange', hard: 'red' }

interface BotLearningSectionProps {
  /** Which game's bots to show. Each game has its own trainer, profiles, and
   *  training config — there is no cross-game view any more. */
  gameType: 'teen_patti' | 'ludo'
}

const num = (v: unknown) => Number(v) || 0
/** Preserves null (untrained) instead of collapsing it to 0 (never captures). */
const numOrNull = (v: unknown) => (v == null ? null : Number(v))

export function BotLearningSection({ gameType }: BotLearningSectionProps) {
  const [profiles, setProfiles] = useState<BotProfile[]>([])
  const [loading, setLoading] = useState(true)
  const [rebuilding, setRebuilding] = useState(false)
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const [config, setConfig] = useState<BotConfig | null>(null)
  const [unavailable, setUnavailable] = useState(false)
  const [saving, setSaving] = useState(false)
  const [configForm] = Form.useForm()

  const isLudo = gameType === 'ludo'
  const gameLabel = GAME_LABELS[gameType] ?? gameType

  const loadProfiles = useCallback(async () => {
    setLoading(true)
    try {
      const res = await adminApi.get('bots/profiles')
      if (res.data.success) {
        const all = (res.data.data ?? []) as any[]
        setUnavailable((res.data.unavailable ?? []).includes(gameType))
        setProfiles(
          all
            .filter(p => p.game_type === gameType)
            // pg returns NUMERIC columns as strings — coerce before any math.
            .map(p => ({
              ...p,
              win_rate_target: num(p.win_rate_target),
              avg_decision_delay_ms: num(p.avg_decision_delay_ms),
              sample_size: num(p.sample_size),
              fold_probability: num(p.fold_probability),
              call_probability: num(p.call_probability),
              raise_probability: num(p.raise_probability),
              aggression_score: num(p.aggression_score),
              capture_probability: numOrNull(p.capture_probability),
              safe_play_probability: numOrNull(p.safe_play_probability),
            }))
        )
      }
    } catch { message.error(`Failed to load ${gameLabel} bot profiles`) }
    finally { setLoading(false) }
  }, [gameType, gameLabel])

  const loadConfig = useCallback(async () => {
    try {
      const res = await adminApi.get(`bots/config?game_type=${gameType}`)
      if (res.data.success) {
        setConfig(res.data.data)
        configForm.setFieldsValue(res.data.data)
      }
    } catch { /* silent — the profiles view is still useful without config */ }
  }, [gameType, configForm])

  useEffect(() => {
    loadProfiles(); loadConfig()
    const handleRefresh = () => { loadProfiles(); loadConfig() }
    window.addEventListener('aiDashboardRefresh', handleRefresh)
    return () => window.removeEventListener('aiDashboardRefresh', handleRefresh)
  }, [loadProfiles, loadConfig])

  const triggerRebuild = async () => {
    setRebuilding(true)
    try {
      await adminApi.post('bots/rebuild', { game_type: gameType })
      message.success(`${gameLabel} rebuild started — profiles update in ~1 minute`)
      setTimeout(loadProfiles, 5000)
    } catch { message.error('Failed to trigger rebuild') }
    finally { setRebuilding(false) }
  }

  const saveConfig = async (values: BotConfig) => {
    setSaving(true)
    try {
      const updates: Record<string, string> = {}
      for (const [k, v] of Object.entries(values)) updates[k] = String(v)
      await adminApi.patch(`bots/config?game_type=${gameType}`, updates)
      message.success(`${gameLabel} config saved`)
    } catch { message.error('Failed to save config') }
    finally { setSaving(false) }
  }

  const saveOverride = async (difficulty: string, values: Record<string, unknown>) => {
    try {
      const body: Record<string, number | null> = {
        win_rate_target: parseFloat(String(values.win_rate_target)),
        avg_decision_delay_ms: parseInt(String(values.avg_decision_delay_ms)),
      }
      if (isLudo) {
        body.capture_probability = parseFloat(String(values.capture_probability)) / 100
        body.safe_play_probability = parseFloat(String(values.safe_play_probability)) / 100
      } else {
        body.fold_probability = parseFloat(String(values.fold_probability)) / 100
        body.call_probability = parseFloat(String(values.call_probability)) / 100
      }
      await adminApi.patch(`bots/profiles/${gameType}/${difficulty}`, body)
      message.success(`${gameLabel} ${difficulty} profile updated`)
      setEditingKey(null)
      await loadProfiles()
    } catch { message.error('Failed to save override') }
  }

  if (loading) return <Spin />

  return (
    <div style={{ marginTop: 24 }}>
      <Divider orientation="left">
        <RobotOutlined /> {gameLabel} Bot Training
      </Divider>

      {unavailable && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          message={`${gameLabel} bot training service is unreachable`}
          description="Bots are running on their fallback profiles. Profiles shown here may be stale."
        />
      )}

      <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ color: '#888', fontSize: 12 }}>
          Rebuilt nightly from real {gameLabel} players only — this game's schedule and
          sampling are independent of every other game's.
        </span>
        <Button icon={<SyncOutlined spin={rebuilding} />} onClick={triggerRebuild} loading={rebuilding} type="primary">
          Rebuild {gameLabel}
        </Button>
      </div>

      <Row gutter={12}>
        {['easy', 'medium', 'hard'].map(difficulty => {
          const profile = profiles.find(p => p.difficulty === difficulty)
          if (!profile) return null
          const isEditing = editingKey === difficulty

          return (
            <Col span={8} key={difficulty}>
              <Card
                size="small"
                title={<Tag color={DIFF_COLORS[difficulty]}>{difficulty.toUpperCase()}</Tag>}
                extra={
                  <Button size="small" onClick={() => setEditingKey(isEditing ? null : difficulty)}>
                    {isEditing ? 'Cancel' : 'Override'}
                  </Button>
                }
              >
                <Statistic title="Win Rate Target" value={profile.win_rate_target} suffix="%" valueStyle={{ fontSize: 14 }} />

                {isLudo ? (
                  <>
                    <Statistic
                      title="Takes Capture"
                      value={profile.capture_probability == null ? 'untrained' : Math.round(profile.capture_probability * 100)}
                      suffix={profile.capture_probability == null ? '' : '%'}
                      valueStyle={{ fontSize: 14 }}
                    />
                    <Statistic
                      title="Plays Safe"
                      value={profile.safe_play_probability == null ? 'untrained' : Math.round(profile.safe_play_probability * 100)}
                      suffix={profile.safe_play_probability == null ? '' : '%'}
                      valueStyle={{ fontSize: 14 }}
                    />
                  </>
                ) : (
                  <>
                    <Statistic title="Fold %" value={Math.round((profile.fold_probability ?? 0) * 100)} suffix="%" valueStyle={{ fontSize: 14 }} />
                    <Statistic title="Call %" value={Math.round((profile.call_probability ?? 0) * 100)} suffix="%" valueStyle={{ fontSize: 14 }} />
                    <Statistic title="Raise %" value={Math.round((profile.raise_probability ?? 0) * 100)} suffix="%" valueStyle={{ fontSize: 14 }} />
                    <Statistic title="Aggression" value={(profile.aggression_score ?? 0).toFixed(2)} valueStyle={{ fontSize: 14 }} />
                  </>
                )}

                <Statistic title="Delay" value={profile.avg_decision_delay_ms} suffix="ms" valueStyle={{ fontSize: 14 }} />

                <div style={{ fontSize: 11, color: '#888', marginTop: 8 }}>
                  <Tooltip title={profile.last_rebuilt_at ? new Date(profile.last_rebuilt_at).toLocaleString() : 'Never rebuilt'}>
                    Sample: {profile.sample_size === 0 ? 'fallback' : `${profile.sample_size} players`}
                  </Tooltip>
                </div>

                {isEditing && (
                  <Form
                    layout="vertical"
                    style={{ marginTop: 12 }}
                    initialValues={
                      isLudo
                        ? {
                            win_rate_target: profile.win_rate_target,
                            capture_probability: Math.round((profile.capture_probability ?? 0.8) * 100),
                            safe_play_probability: Math.round((profile.safe_play_probability ?? 0.5) * 100),
                            avg_decision_delay_ms: profile.avg_decision_delay_ms,
                          }
                        : {
                            win_rate_target: profile.win_rate_target,
                            fold_probability: Math.round((profile.fold_probability ?? 0) * 100),
                            call_probability: Math.round((profile.call_probability ?? 0) * 100),
                            avg_decision_delay_ms: profile.avg_decision_delay_ms,
                          }
                    }
                    onFinish={(vals) => saveOverride(difficulty, vals)}
                  >
                    <Form.Item
                      label="Win Rate Target %"
                      name="win_rate_target"
                      tooltip="Odds a human's best hand is swapped to a bot this hand (fair play: 48-52%)"
                    >
                      <Slider min={0} max={100} />
                    </Form.Item>

                    {isLudo ? (
                      <>
                        <Form.Item
                          label="Takes Capture %"
                          name="capture_probability"
                          tooltip="How often the bot takes an available capture. Real players miss some; 100% reads as robotic."
                        >
                          <Slider min={0} max={100} />
                        </Form.Item>
                        <Form.Item
                          label="Plays Safe %"
                          name="safe_play_probability"
                          tooltip="How often a hard bot picks a safe square over an exposed one when both are available."
                        >
                          <Slider min={0} max={100} />
                        </Form.Item>
                      </>
                    ) : (
                      <>
                        <Form.Item label="Fold %" name="fold_probability">
                          <Slider min={5} max={70} />
                        </Form.Item>
                        <Form.Item label="Call %" name="call_probability">
                          <Slider min={15} max={75} />
                        </Form.Item>
                      </>
                    )}

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

      <Divider orientation="left">{gameLabel} Training Config</Divider>
      <Card title="Schedule & Sampling" style={{ maxWidth: 480 }} extra={<Tag color="blue">{gameLabel} only</Tag>}>
        {config && (
          <Form form={configForm} layout="vertical" onFinish={saveConfig} initialValues={config}>
            <Form.Item label="Rebuild hour (0–23 IST)" name="rebuild_hour">
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
