import { useState, useEffect, useCallback } from 'react'
import { Card, Row, Col, Button, Statistic, Tag, Slider, Form, InputNumber, message, Divider, Spin, Tooltip, Alert } from 'antd'
import { SyncOutlined, RobotOutlined, ThunderboltOutlined, SmileOutlined, ClockCircleOutlined, CheckCircleOutlined } from '@ant-design/icons'
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
  // Teen Patti
  fold_probability?: number
  call_probability?: number
  raise_probability?: number
  aggression_score?: number
  // Rummy
  drop_probability?: number
  open_draw_probability?: number
  declare_speed_factor?: number
  // Ludo
  capture_probability?: number | null
  safe_play_probability?: number | null
  // Other games & custom DDAS params
  [key: string]: any
}

interface BotConfig {
  rebuild_hour: number
  stream_lookback_days: number
  min_sample_size: number
}

const GAME_LABELS: Record<string, string> = {
  teen_patti: 'Teen Patti',
  ludo: 'Ludo',
  rummy: 'Rummy',
  aviator: 'Aviator',
  color_prediction: 'Color Prediction',
  matka: 'Matka',
  lottery: 'Lottery',
}

const DIFF_COLORS: Record<string, string> = { easy: 'green', medium: 'orange', hard: 'red' }

interface BotLearningSectionProps {
  gameType: 'teen_patti' | 'ludo' | 'rummy' | 'aviator' | 'color_prediction' | 'matka' | 'lottery'
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
              drop_probability: num(p.drop_probability),
              open_draw_probability: num(p.open_draw_probability),
              declare_speed_factor: num(p.declare_speed_factor),
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
      } else if (gameType === 'rummy') {
        body.drop_probability = parseFloat(String(values.drop_probability)) / 100
        body.open_draw_probability = parseFloat(String(values.open_draw_probability)) / 100
        body.declare_speed_factor = parseFloat(String(values.declare_speed_factor)) / 100
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

      {['teen_patti', 'rummy', 'ludo'].includes(gameType) && (
        <Card size="small" style={{ marginBottom: 16, background: '#f6ffed', borderColor: '#b7eb8f' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <ThunderboltOutlined style={{ color: '#52c41a', fontSize: 18 }} />
              <div>
                <strong style={{ color: '#274916' }}>Active Bot Intelligence: Dynamic Opponent Modeling & Human Simulation</strong>
                <div style={{ fontSize: 12, color: '#595959' }}>
                  Real-time player profiling in Redis adapts bot playstyle (bluffs, slow-play traps, and value betting) against Tight Folders, Calling Stations, and Maniacs.
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <Tag color="success" icon={<CheckCircleOutlined />}>Opponent Modeler: Active</Tag>
              <Tag color="cyan" icon={<ClockCircleOutlined />}>Cognitive Jitter: 1–5s Log-Normal</Tag>
              <Tag color="purple" icon={<SmileOutlined />}>In-Game Emojis: Enabled</Tag>
            </div>
          </div>
        </Card>
      )}

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
                ) : gameType === 'teen_patti' ? (
                  <>
                    <Statistic title="Fold %" value={Math.round((profile.fold_probability ?? 0) * 100)} suffix="%" valueStyle={{ fontSize: 14 }} />
                    <Statistic title="Call %" value={Math.round((profile.call_probability ?? 0) * 100)} suffix="%" valueStyle={{ fontSize: 14 }} />
                    <Statistic title="Raise %" value={Math.round((profile.raise_probability ?? 0) * 100)} suffix="%" valueStyle={{ fontSize: 14 }} />
                    <Statistic title="Aggression" value={(profile.aggression_score ?? 0).toFixed(2)} valueStyle={{ fontSize: 14 }} />
                  </>
                ) : gameType === 'rummy' ? (
                  <>
                    <Statistic title="Initial Drop %" value={Math.round((profile.drop_probability ?? 0.25) * 100)} suffix="%" valueStyle={{ fontSize: 14 }} />
                    <Statistic title="Open Draw %" value={Math.round((profile.open_draw_probability ?? 0.6) * 100)} suffix="%" valueStyle={{ fontSize: 14 }} />
                    <Statistic title="Declare Speed" value={Math.round((profile.declare_speed_factor ?? 0.7) * 100)} suffix="%" valueStyle={{ fontSize: 14 }} />
                    <Statistic title="Aggression" value={(profile.aggression_score ?? 1.8).toFixed(2)} valueStyle={{ fontSize: 14 }} />
                  </>
                ) : gameType === 'aviator' ? (
                  <>
                    <Statistic title="Min Cashout" value={`${profile.cashout_min ?? 1.2}x`} valueStyle={{ fontSize: 14 }} />
                    <Statistic title="Max Cashout" value={`${profile.cashout_max ?? 3.5}x`} valueStyle={{ fontSize: 14 }} />
                    <Statistic title="Greed Factor" value={profile.greed_factor ?? 0.5} valueStyle={{ fontSize: 14 }} />
                  </>
                ) : gameType === 'color_prediction' ? (
                  <>
                    <Statistic title="Streak Bias" value={profile.bet_streak_bias ?? 0.4} valueStyle={{ fontSize: 14 }} />
                    <Statistic title="Hedge Tendency" value={profile.hedge_tendency ?? 0.2} valueStyle={{ fontSize: 14 }} />
                    <Statistic title="Bet Mult." value={`${profile.bet_size_multiplier ?? 1}x`} valueStyle={{ fontSize: 14 }} />
                  </>
                ) : gameType === 'matka' ? (
                  <>
                    <Statistic title="Streak Chase" value={profile.streak_chase_factor ?? 0.3} valueStyle={{ fontSize: 14 }} />
                    <Statistic title="Risk Pref." value={profile.risk_preference ?? 0.5} valueStyle={{ fontSize: 14 }} />
                  </>
                ) : (
                  <>
                    <Statistic title="Ticket Vol." value={profile.ticket_volume_factor ?? 1} valueStyle={{ fontSize: 14 }} />
                    <Statistic title="Fav Bias" value={profile.favorite_number_bias ?? 0.3} valueStyle={{ fontSize: 14 }} />
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
                    initialValues={{
                      win_rate_target: profile.win_rate_target,
                      avg_decision_delay_ms: profile.avg_decision_delay_ms,
                      ...(isLudo ? {
                        capture_probability: Math.round((profile.capture_probability ?? 0.8) * 100),
                        safe_play_probability: Math.round((profile.safe_play_probability ?? 0.5) * 100),
                      } : gameType === 'rummy' ? {
                        drop_probability: Math.round((profile.drop_probability ?? 0.25) * 100),
                        open_draw_probability: Math.round((profile.open_draw_probability ?? 0.6) * 100),
                        declare_speed_factor: Math.round((profile.declare_speed_factor ?? 0.7) * 100),
                      } : gameType === 'teen_patti' ? {
                        fold_probability: Math.round((profile.fold_probability ?? 0) * 100),
                        call_probability: Math.round((profile.call_probability ?? 0) * 100),
                      } : gameType === 'aviator' ? {
                        cashout_min: profile.cashout_min ?? 1.2,
                        cashout_max: profile.cashout_max ?? 3.5,
                      } : {})
                    }}
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
                    ) : gameType === 'rummy' ? (
                      <>
                        <Form.Item label="Initial First Drop %" name="drop_probability" tooltip="Probability bot will drop on turn 1 if hand has high deadwood">
                          <Slider min={5} max={60} />
                        </Form.Item>
                        <Form.Item label="Discard Pickup %" name="open_draw_probability" tooltip="Tendency to pick from visible discard pile when card improves meld">
                          <Slider min={20} max={95} />
                        </Form.Item>
                        <Form.Item label="Declare Speed Factor %" name="declare_speed_factor" tooltip="How rapidly bot attempts declare grouping once target melds are met">
                          <Slider min={30} max={100} />
                        </Form.Item>
                      </>
                    ) : gameType === 'teen_patti' ? (
                      <>
                        <Form.Item label="Fold %" name="fold_probability">
                          <Slider min={5} max={70} />
                        </Form.Item>
                        <Form.Item label="Call %" name="call_probability">
                          <Slider min={15} max={75} />
                        </Form.Item>
                      </>
                    ) : gameType === 'aviator' ? (
                      <>
                        <Form.Item label="Min Cashout Multiplier (x)" name="cashout_min">
                          <Slider min={1.0} max={5.0} step={0.1} />
                        </Form.Item>
                        <Form.Item label="Max Cashout Multiplier (x)" name="cashout_max">
                          <Slider min={2.0} max={20.0} step={0.5} />
                        </Form.Item>
                      </>
                    ) : null}

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
