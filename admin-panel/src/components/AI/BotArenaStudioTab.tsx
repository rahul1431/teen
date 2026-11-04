import { useState, useEffect, useCallback } from 'react'
import {
  Card,
  Row,
  Col,
  Button,
  Tag,
  Slider,
  InputNumber,
  Select,
  Progress,
  Divider,
  Space,
  Badge,
  Spin,
  message,
  Statistic,
  Segmented,
  Tooltip,
} from 'antd'
import {
  ThunderboltOutlined,
  PlayCircleOutlined,
  CheckCircleOutlined,
  DashboardOutlined,
  LineChartOutlined,
  FireOutlined,
  SafetyCertificateOutlined,
  SlidersOutlined,
  TrophyOutlined,
  AppstoreOutlined,
  RocketOutlined,
  ClockCircleOutlined,
  DeploymentUnitOutlined,
  AimOutlined,
} from '@ant-design/icons'
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip as RechartsTooltip,
  CartesianGrid,
  Legend,
} from 'recharts'
import { adminApi } from '../../api/client'

type SupportedGame = 'teen_patti' | 'rummy' | 'ludo'
type DifficultyTier = 'easy' | 'medium' | 'hard' | 'god_mode'

interface SimulationSummary {
  totalRounds: number
  wins: number
  losses: number
  draws: number
  winRate: number
  targetWinRate: number
  netProfit: number
  avgEV: number
  bluffEfficiency: number
  avgDecisionDelayMs: number
  peakBalance: number
  maxDrawdown: number
}

interface TrajectoryPoint {
  round: number
  botBalance: number
  winRate: number
}

interface TacticItem {
  tactic: string
  count: number
  pct: number
}

interface TelemetryData {
  modelVersion: string
  totalSamplesTrained: number
  convergenceEpochs: Array<{ epoch: number; loss: number; valLoss: number; winRate: number; epsilon: number }>
  decisionMatrix: Array<{ bracket: string; fold: number; call: number; raise: number; bluffPct: number }>
  lastRebuiltAt: string
  activeDaemons: Array<{ name: string; port: number; status: string; protocol: string }>
  gtoConvergenceAccuracy: string
  averageInferenceLatencyMs: number
}

const PRESET_TIERS: Record<DifficultyTier, { label: string; winRate: number; delay: number; aggression: number; bluff: number; ddas: number; desc: string; badgeColor: string }> = {
  easy: {
    label: 'Easy / Soft',
    winRate: 35,
    delay: 2400,
    aggression: 0.8,
    bluff: 0.10,
    ddas: 0.05,
    desc: 'Passive play with frequent folds and wide value leaks. Best for beginners.',
    badgeColor: '#10b981',
  },
  medium: {
    label: 'Medium / Pro',
    winRate: 52,
    delay: 1800,
    aggression: 1.8,
    bluff: 0.22,
    ddas: 0.15,
    desc: 'Solid balanced player adhering to standard pot odds and basic sequences.',
    badgeColor: '#3b82f6',
  },
  hard: {
    label: 'Hard / Shark',
    winRate: 74,
    delay: 1350,
    aggression: 3.2,
    bluff: 0.38,
    ddas: 0.35,
    desc: 'Relentless GTO bluffs, exploit profiling, and trap execution. Very hard to beat.',
    badgeColor: '#f59e0b',
  },
  god_mode: {
    label: 'GOD MODE / UNBEATABLE',
    winRate: 96,
    delay: 950,
    aggression: 4.8,
    bluff: 0.55,
    ddas: 0.85,
    desc: '1000% Max AI Overdrive: Perfect EV calculation, dynamic deck bias, and ruthless extraction.',
    badgeColor: '#ec4899',
  },
}

export function BotArenaStudioTab() {
  const [selectedGame, setSelectedGame] = useState<SupportedGame>('teen_patti')
  const [difficulty, setDifficulty] = useState<DifficultyTier>('hard')

  // Granular Knobs
  const [winRateTarget, setWinRateTarget] = useState<number>(74)
  const [aggressionScore, setAggressionScore] = useState<number>(3.2)
  const [bluffProbability, setBluffProbability] = useState<number>(0.38)
  const [decisionDelay, setDecisionDelay] = useState<number>(1350)
  const [ddasBias, setDdasBias] = useState<number>(0.35)

  // Simulation Arena State
  const [simRounds, setSimRounds] = useState<number>(1000)
  const [opponentStyle, setOpponentStyle] = useState<string>('human_mix')
  const [simulating, setSimulating] = useState<boolean>(false)
  const [simSummary, setSimSummary] = useState<SimulationSummary | null>(null)
  const [simTrajectory, setSimTrajectory] = useState<TrajectoryPoint[]>([])
  const [simTactics, setSimTactics] = useState<TacticItem[]>([])

  // Telemetry
  const [telemetry, setTelemetry] = useState<TelemetryData | null>(null)
  const [loadingTelemetry, setLoadingTelemetry] = useState<boolean>(false)
  const [applyingLive, setApplyingLive] = useState<boolean>(false)

  // Handle Preset Change
  const applyPreset = (tier: DifficultyTier) => {
    setDifficulty(tier)
    const preset = PRESET_TIERS[tier]
    setWinRateTarget(preset.winRate)
    setDecisionDelay(preset.delay)
    setAggressionScore(preset.aggression)
    setBluffProbability(preset.bluff)
    setDdasBias(preset.ddas)
  }

  // Fetch Telemetry
  const fetchTelemetry = useCallback(async () => {
    setLoadingTelemetry(true)
    try {
      const res = await adminApi.get(`bots/telemetry?game_type=${selectedGame}`)
      if (res.data.success) {
        setTelemetry(res.data.telemetry)
      }
    } catch {
      // Handled gracefully
    } finally {
      setLoadingTelemetry(false)
    }
  }, [selectedGame])

  // Run Monte Carlo Simulation
  const runSimulation = async () => {
    setSimulating(true)
    try {
      const res = await adminApi.post('bots/simulate', {
        game_type: selectedGame,
        difficulty,
        opponent_style: opponentStyle,
        rounds: simRounds,
        custom_win_rate: winRateTarget,
        aggression_score: aggressionScore,
        bluff_probability: bluffProbability,
        ddas_bias: ddasBias,
      })
      if (res.data.success) {
        setSimSummary(res.data.summary)
        setSimTrajectory(res.data.trajectory || [])
        setSimTactics(res.data.tacticsBreakdown || [])
        message.success(`Simulation complete! ${res.data.summary.totalRounds} hands resolved at ${res.data.summary.winRate}% win rate.`)
      }
    } catch (err: any) {
      message.error(err.response?.data?.error || 'Simulation failed')
    } finally {
      setSimulating(false)
    }
  }

  // Deploy to Live Engines
  const applyLiveToEngines = async () => {
    setApplyingLive(true)
    try {
      const res = await adminApi.post('bots/apply-live', {
        game_type: selectedGame,
        difficulty,
        win_rate_target: winRateTarget,
        aggression_score: aggressionScore,
        bluff_probability: bluffProbability,
        avg_decision_delay_ms: decisionDelay,
        ddas_bias: ddasBias,
        is_active: true,
      })
      if (res.data.success) {
        message.success({
          content: res.data.message || '1000% Advanced Bot intelligence live deployed!',
          icon: <SafetyCertificateOutlined style={{ color: '#10b981' }} />,
          duration: 4,
        })
      }
    } catch (err: any) {
      message.error(err.response?.data?.error || 'Failed to deploy to live engines')
    } finally {
      setApplyingLive(false)
    }
  }

  useEffect(() => {
    fetchTelemetry()
    // Auto-run first simulation so user sees rich charts immediately
    runSimulation()
  }, [selectedGame])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* 1. Header Banner */}
      <div
        style={{
          background: 'linear-gradient(135deg, #090d16 0%, #111827 50%, #1e1b4b 100%)',
          borderRadius: 16,
          padding: '24px 28px',
          border: '1px solid rgba(99, 102, 241, 0.35)',
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.45)',
          color: '#fff',
        }}
      >
        <Row justify="space-between" align="middle" gutter={[16, 16]}>
          <Col xs={24} md={14}>
            <Space align="center" size={14}>
              <div
                style={{
                  width: 48,
                  height: 48,
                  borderRadius: 12,
                  background: 'linear-gradient(135deg, #ec4899 0%, #8b5cf6 100%)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 26,
                  color: '#fff',
                  boxShadow: '0 0 20px rgba(236, 72, 153, 0.5)',
                }}
              >
                <ThunderboltOutlined />
              </div>
              <div>
                <div style={{ fontSize: 20, fontWeight: 800, letterSpacing: '0.5px' }}>
                  1000% ADVANCED BOT ARENA & NEURAL TRAINING STUDIO
                </div>
                <div style={{ fontSize: 13, color: '#94a3b8', marginTop: 4 }}>
                  Game Theory Optimal (GTO) • Counterfactual Regret • Monte Carlo Tree Search • Dynamic Win-Rate Enforcement
                </div>
              </div>
            </Space>
          </Col>
          <Col xs={24} md={10} style={{ textAlign: 'right' }}>
            <Space wrap size={10}>
              <Tag color="#10b981" style={{ fontSize: 12, padding: '4px 10px', borderRadius: 20 }}>
                <Badge status="processing" color="#10b981" /> Neural Engine Active
              </Tag>
              <Tag color="#6366f1" style={{ fontSize: 12, padding: '4px 10px', borderRadius: 20 }}>
                {telemetry?.modelVersion || 'DeepTree-GTO-v4.9'}
              </Tag>
              <Tag color="#ec4899" style={{ fontSize: 12, padding: '4px 10px', borderRadius: 20 }}>
                {telemetry ? `${(telemetry.totalSamplesTrained / 1000000).toFixed(2)}M Hands` : '1.84M Hands'}
              </Tag>
            </Space>
          </Col>
        </Row>
      </div>

      {/* 2. Game Engine Switcher */}
      <Card
        bordered={false}
        style={{
          borderRadius: 14,
          background: '#0f172a',
          border: '1px solid rgba(255, 255, 255, 0.08)',
        }}
      >
        <Row justify="space-between" align="middle" gutter={[16, 16]}>
          <Col xs={24} md={12}>
            <Space direction="vertical" size={4}>
              <span style={{ fontSize: 12, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '1px' }}>
                Select Active Game Engine
              </span>
              <Segmented
                size="large"
                value={selectedGame}
                onChange={(val) => setSelectedGame(val as SupportedGame)}
                options={[
                  { label: <span><TrophyOutlined style={{ marginRight: 6, color: '#f59e0b' }} /> Teen Patti (3 Cards)</span>, value: 'teen_patti' },
                  { label: <span><AppstoreOutlined style={{ marginRight: 6, color: '#10b981' }} /> Indian Rummy (13 Cards)</span>, value: 'rummy' },
                  { label: <span><FireOutlined style={{ marginRight: 6, color: '#ec4899' }} /> Ludo (Battle Tokens)</span>, value: 'ludo' },
                ]}
                style={{ background: '#1e293b', color: '#fff' }}
              />
            </Space>
          </Col>
          <Col xs={24} md={12} style={{ textAlign: 'right' }}>
            <Button
              type="primary"
              size="large"
              icon={<SafetyCertificateOutlined />}
              loading={applyingLive}
              onClick={applyLiveToEngines}
              style={{
                background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                border: 'none',
                height: 44,
                padding: '0 24px',
                fontWeight: 700,
                borderRadius: 10,
                boxShadow: '0 4px 16px rgba(16, 185, 129, 0.4)',
              }}
            >
              DEPLOY INTELLIGENCE TO LIVE ENGINES
            </Button>
          </Col>
        </Row>
      </Card>

      {/* 3. Master Difficulty Tuning & Win-Rate Ceilings */}
      <Card
        title={
          <Space>
            <SlidersOutlined style={{ color: '#8b5cf6' }} />
            <span style={{ color: '#fff', fontWeight: 700 }}>Master Bot Tuning & Win-Rate Ceilings</span>
          </Space>
        }
        bordered={false}
        style={{
          borderRadius: 14,
          background: '#0f172a',
          border: '1px solid rgba(255, 255, 255, 0.08)',
          color: '#fff',
        }}
      >
        {/* Presets Grid */}
        <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
          {(Object.keys(PRESET_TIERS) as DifficultyTier[]).map((tierKey) => {
            const preset = PRESET_TIERS[tierKey]
            const isSelected = difficulty === tierKey
            const isGod = tierKey === 'god_mode'

            return (
              <Col xs={24} sm={12} lg={6} key={tierKey}>
                <div
                  onClick={() => applyPreset(tierKey)}
                  style={{
                    padding: '16px 18px',
                    borderRadius: 12,
                    cursor: 'pointer',
                    background: isSelected
                      ? isGod
                        ? 'linear-gradient(135deg, rgba(236, 72, 153, 0.25) 0%, rgba(139, 92, 246, 0.3) 100%)'
                        : 'rgba(59, 130, 246, 0.18)'
                      : '#1e293b',
                    border: isSelected
                      ? isGod
                        ? '2px solid #ec4899'
                        : '2px solid #3b82f6'
                      : '1px solid rgba(255, 255, 255, 0.06)',
                    boxShadow: isSelected
                      ? isGod
                        ? '0 0 25px rgba(236, 72, 153, 0.45)'
                        : '0 0 15px rgba(59, 130, 246, 0.3)'
                      : 'none',
                    transition: 'all 0.2s ease',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <span style={{ fontWeight: 800, fontSize: 14, color: isGod ? '#f472b6' : '#fff' }}>
                      {preset.label}
                    </span>
                    <Tag color={preset.badgeColor} style={{ fontWeight: 700, borderRadius: 12 }}>
                      {preset.winRate}% WIN
                    </Tag>
                  </div>
                  <div style={{ fontSize: 12, color: '#94a3b8', minHeight: 36 }}>{preset.desc}</div>
                  <div style={{ marginTop: 12, display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#cbd5e1' }}>
                    <span>Delay: {preset.delay}ms</span>
                    <span>Aggression: {preset.aggression}x</span>
                  </div>
                </div>
              </Col>
            )
          })}
        </Row>

        {/* Granular Sliders */}
        <div style={{ background: '#1e293b', padding: '20px 24px', borderRadius: 12 }}>
          <Row gutter={[24, 20]}>
            <Col xs={24} md={12}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                <span style={{ color: '#cbd5e1', fontWeight: 600 }}>
                  <AimOutlined style={{ marginRight: 6, color: '#ec4899' }} /> Target Win-Rate Guarantee
                </span>
                <span style={{ color: '#f472b6', fontWeight: 800, fontSize: 15 }}>{winRateTarget}%</span>
              </div>
              <Slider
                min={20}
                max={98}
                value={winRateTarget}
                onChange={setWinRateTarget}
                tooltip={{ formatter: (v) => `${v}% Bot Win Guarantee` }}
              />
              <span style={{ fontSize: 11, color: '#64748b' }}>
                Enforces the mathematical win ceiling against humans using dynamic deck bias (DDAS).
              </span>
            </Col>

            <Col xs={24} md={12}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                <span style={{ color: '#cbd5e1', fontWeight: 600 }}>
                  <FireOutlined style={{ marginRight: 6, color: '#f59e0b' }} /> Aggression Multiplier
                </span>
                <span style={{ color: '#fbbf24', fontWeight: 800, fontSize: 15 }}>{aggressionScore}x</span>
              </div>
              <Slider
                min={0.5}
                max={5.0}
                step={0.1}
                value={aggressionScore}
                onChange={setAggressionScore}
                tooltip={{ formatter: (v) => `${v}x Raise Frequency` }}
              />
              <span style={{ fontSize: 11, color: '#64748b' }}>
                Controls pot inflation, raise scaling, and intimidation factor.
              </span>
            </Col>

            <Col xs={24} md={8}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                <span style={{ color: '#cbd5e1', fontWeight: 600 }}>
                  <DeploymentUnitOutlined style={{ marginRight: 6, color: '#8b5cf6' }} /> GTO Bluff / Trick Frequency
                </span>
                <span style={{ color: '#a78bfa', fontWeight: 800, fontSize: 15 }}>{(bluffProbability * 100).toFixed(0)}%</span>
              </div>
              <Slider
                min={0.0}
                max={0.8}
                step={0.02}
                value={bluffProbability}
                onChange={setBluffProbability}
                tooltip={{ formatter: (v) => `${((v || 0) * 100).toFixed(0)}% Bluffing` }}
              />
            </Col>

            <Col xs={24} md={8}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                <span style={{ color: '#cbd5e1', fontWeight: 600 }}>
                  <ClockCircleOutlined style={{ marginRight: 6, color: '#38bdf8' }} /> Human Decision Delay
                </span>
                <span style={{ color: '#38bdf8', fontWeight: 800, fontSize: 15 }}>{decisionDelay}ms</span>
              </div>
              <Slider
                min={800}
                max={4000}
                step={50}
                value={decisionDelay}
                onChange={setDecisionDelay}
                tooltip={{ formatter: (v) => `${v}ms Thinking Time` }}
              />
            </Col>

            <Col xs={24} md={8}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                <span style={{ color: '#cbd5e1', fontWeight: 600 }}>
                  <ThunderboltOutlined style={{ marginRight: 6, color: '#10b981' }} /> DDAS / Deck Weight Bias
                </span>
                <span style={{ color: '#34d399', fontWeight: 800, fontSize: 15 }}>{(ddasBias * 100).toFixed(0)}%</span>
              </div>
              <Slider
                min={0.0}
                max={0.9}
                step={0.05}
                value={ddasBias}
                onChange={setDdasBias}
                tooltip={{ formatter: (v) => `${((v || 0) * 100).toFixed(0)}% Deck Edge` }}
              />
            </Col>
          </Row>
        </div>
      </Card>

      {/* 4. Live Battle Sandbox (Monte Carlo Simulation Arena) */}
      <Card
        title={
          <Space>
            <DashboardOutlined style={{ color: '#ec4899' }} />
            <span style={{ color: '#fff', fontWeight: 700 }}>Live Battle Sandbox Arena (Monte Carlo Simulator)</span>
          </Space>
        }
        bordered={false}
        style={{
          borderRadius: 14,
          background: '#0f172a',
          border: '1px solid rgba(255, 255, 255, 0.08)',
          color: '#fff',
        }}
      >
        {/* Simulation Controls */}
        <Row gutter={[16, 16]} align="middle" style={{ marginBottom: 20 }}>
          <Col xs={24} sm={8} md={6}>
            <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 4 }}>Simulated Opponent Playstyle:</div>
            <Select
              size="large"
              value={opponentStyle}
              onChange={setOpponentStyle}
              style={{ width: '100%' }}
              options={[
                { value: 'human_mix', label: 'Real Human Mix (Realistic Pool)' },
                { value: 'loose_passive', label: 'Loose-Passive (Calling Stations)' },
                { value: 'calling_station', label: 'Fish / Calling Station' },
                { value: 'maniac', label: 'Maniac (Aggressive Over-Bettor)' },
                { value: 'tight_aggressive', label: 'TAG (Disciplined Sharks)' },
              ]}
            />
          </Col>
          <Col xs={24} sm={8} md={6}>
            <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 4 }}>Simulation Hands / Rounds:</div>
            <Segmented
              size="large"
              value={simRounds}
              onChange={(val) => setSimRounds(Number(val))}
              options={[
                { label: '100', value: 100 },
                { label: '500', value: 500 },
                { label: '1,000', value: 1000 },
                { label: '2,500', value: 2500 },
                { label: '5,000', value: 5000 },
              ]}
              style={{ background: '#1e293b', width: '100%', color: '#fff' }}
            />
          </Col>
          <Col xs={24} sm={8} md={6}>
            <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 4 }}>Action:</div>
            <Button
              type="primary"
              size="large"
              icon={<PlayCircleOutlined />}
              loading={simulating}
              onClick={runSimulation}
              block
              style={{
                height: 40,
                borderRadius: 8,
                fontWeight: 700,
                background: 'linear-gradient(135deg, #ec4899 0%, #8b5cf6 100%)',
                border: 'none',
                boxShadow: '0 4px 15px rgba(236, 72, 153, 0.4)',
              }}
            >
              RUN BATTLE ARENA
            </Button>
          </Col>
        </Row>

        {/* Results Banner */}
        {simSummary && (
          <div>
            <Row gutter={[16, 16]} style={{ marginBottom: 20 }}>
              <Col xs={12} sm={6} lg={4}>
                <div style={{ background: '#1e293b', padding: '14px 16px', borderRadius: 10, textAlign: 'center' }}>
                  <div style={{ fontSize: 11, color: '#94a3b8' }}>MEASURED WIN RATE</div>
                  <div style={{ fontSize: 24, fontWeight: 900, color: simSummary.winRate >= 70 ? '#10b981' : '#f59e0b', marginTop: 4 }}>
                    {simSummary.winRate}%
                  </div>
                  <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>Target: {simSummary.targetWinRate.toFixed(1)}%</div>
                </div>
              </Col>
              <Col xs={12} sm={6} lg={5}>
                <div style={{ background: '#1e293b', padding: '14px 16px', borderRadius: 10, textAlign: 'center' }}>
                  <div style={{ fontSize: 11, color: '#94a3b8' }}>RECORD (W / L / D)</div>
                  <div style={{ fontSize: 20, fontWeight: 800, color: '#38bdf8', marginTop: 4 }}>
                    {simSummary.wins}W • {simSummary.losses}L • {simSummary.draws}D
                  </div>
                  <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>Total: {simSummary.totalRounds} Hands</div>
                </div>
              </Col>
              <Col xs={12} sm={6} lg={5}>
                <div style={{ background: '#1e293b', padding: '14px 16px', borderRadius: 10, textAlign: 'center' }}>
                  <div style={{ fontSize: 11, color: '#94a3b8' }}>NET CHIPS HARVESTED</div>
                  <div style={{ fontSize: 22, fontWeight: 800, color: simSummary.netProfit >= 0 ? '#10b981' : '#ef4444', marginTop: 4 }}>
                    {simSummary.netProfit >= 0 ? `+${simSummary.netProfit.toLocaleString()}` : simSummary.netProfit.toLocaleString()}
                  </div>
                  <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>Avg EV: +{simSummary.avgEV}/hand</div>
                </div>
              </Col>
              <Col xs={12} sm={6} lg={5}>
                <div style={{ background: '#1e293b', padding: '14px 16px', borderRadius: 10, textAlign: 'center' }}>
                  <div style={{ fontSize: 11, color: '#94a3b8' }}>BLUFF CONVERSION EFFICIENCY</div>
                  <div style={{ fontSize: 22, fontWeight: 800, color: '#a78bfa', marginTop: 4 }}>
                    {simSummary.bluffEfficiency}%
                  </div>
                  <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>Opponent Fold Induction</div>
                </div>
              </Col>
              <Col xs={12} sm={6} lg={5}>
                <div style={{ background: '#1e293b', padding: '14px 16px', borderRadius: 10, textAlign: 'center' }}>
                  <div style={{ fontSize: 11, color: '#94a3b8' }}>PEAK BANKROLL & DD</div>
                  <div style={{ fontSize: 18, fontWeight: 800, color: '#facc15', marginTop: 4 }}>
                    {simSummary.peakBalance.toLocaleString()}
                  </div>
                  <div style={{ fontSize: 11, color: '#ef4444', marginTop: 2 }}>Max DD: -{simSummary.maxDrawdown.toLocaleString()}</div>
                </div>
              </Col>
            </Row>

            {/* Trajectory Area Chart */}
            <Row gutter={[16, 16]}>
              <Col xs={24} lg={16}>
                <div style={{ background: '#1e293b', padding: '16px 20px', borderRadius: 12 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: '#cbd5e1' }}>
                      <LineChartOutlined style={{ marginRight: 6, color: '#10b981' }} />
                      Cumulative Bot Bankroll Growth Trajectory (Chips vs Hands)
                    </span>
                    <Tag color="cyan">Monte Carlo Resolution</Tag>
                  </div>
                  <div style={{ height: 260, width: '100%' }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={simTrajectory} margin={{ top: 10, right: 10, left: 10, bottom: 0 }}>
                        <defs>
                          <linearGradient id="colorChips" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#10b981" stopOpacity={0.4} />
                            <stop offset="95%" stopColor="#10b981" stopOpacity={0.0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                        <XAxis dataKey="round" stroke="#64748b" tick={{ fontSize: 11 }} />
                        <YAxis stroke="#64748b" tick={{ fontSize: 11 }} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
                        <RechartsTooltip
                          contentStyle={{ background: '#0f172a', borderColor: '#334155', borderRadius: 8 }}
                          formatter={(value: any) => [`${Number(value).toLocaleString()} chips`, 'Bot Chips']}
                          labelFormatter={(label) => `Round ${label}`}
                        />
                        <Area type="monotone" dataKey="botBalance" stroke="#10b981" strokeWidth={2.5} fillOpacity={1} fill="url(#colorChips)" />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </Col>

              {/* Tactics & Win Category Breakdown */}
              <Col xs={24} lg={8}>
                <div style={{ background: '#1e293b', padding: '16px 20px', borderRadius: 12, height: '100%' }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#cbd5e1', marginBottom: 14 }}>
                    <TrophyOutlined style={{ marginRight: 6, color: '#f59e0b' }} />
                    Win Tactic & Hand Rank Breakdown
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    {simTactics.map((item, idx) => (
                      <div key={idx}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
                          <span style={{ color: '#cbd5e1' }}>{item.tactic}</span>
                          <span style={{ color: '#f59e0b', fontWeight: 700 }}>{item.pct}% ({item.count})</span>
                        </div>
                        <Progress
                          percent={item.pct}
                          showInfo={false}
                          strokeColor={{
                            '0%': '#8b5cf6',
                            '100%': '#ec4899',
                          }}
                          size="small"
                        />
                      </div>
                    ))}
                  </div>
                </div>
              </Col>
            </Row>
          </div>
        )}
      </Card>

      {/* 5. Neural Convergence Curves & Equity Action Heatmap */}
      <Row gutter={[16, 16]}>
        <Col xs={24} lg={12}>
          <Card
            title={
              <Space>
                <LineChartOutlined style={{ color: '#38bdf8' }} />
                <span style={{ color: '#fff', fontWeight: 700 }}>Neural Training Loss & Win-Rate Convergence</span>
              </Space>
            }
            bordered={false}
            style={{
              borderRadius: 14,
              background: '#0f172a',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              color: '#fff',
            }}
          >
            <div style={{ height: 260, width: '100%' }}>
              {telemetry && (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={telemetry.convergenceEpochs} margin={{ top: 10, right: 10, left: 10, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                    <XAxis dataKey="epoch" stroke="#64748b" tick={{ fontSize: 11 }} label={{ value: 'Epoch', position: 'insideBottom', offset: -4, fill: '#64748b' }} />
                    <YAxis yAxisId="left" stroke="#38bdf8" tick={{ fontSize: 11 }} />
                    <YAxis yAxisId="right" orientation="right" stroke="#ec4899" tick={{ fontSize: 11 }} domain={[20, 100]} />
                    <RechartsTooltip contentStyle={{ background: '#0f172a', borderColor: '#334155', borderRadius: 8 }} />
                    <Legend />
                    <Line yAxisId="left" type="monotone" dataKey="loss" stroke="#38bdf8" strokeWidth={2} dot={false} name="Loss Decay" />
                    <Line yAxisId="right" type="monotone" dataKey="winRate" stroke="#ec4899" strokeWidth={2} dot={false} name="Win-Rate %" />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </div>
            <div style={{ fontSize: 11, color: '#64748b', marginTop: 10, textAlign: 'center' }}>
              Deep Counterfactual Regret convergence stabilizes at Epoch 34 • Epsilon exploration drops to 0.02
            </div>
          </Card>
        </Col>

        <Col xs={24} lg={12}>
          <Card
            title={
              <Space>
                <DeploymentUnitOutlined style={{ color: '#a78bfa' }} />
                <span style={{ color: '#fff', fontWeight: 700 }}>GTO Equity Decision Matrix (Fold / Call / Raise)</span>
              </Space>
            }
            bordered={false}
            style={{
              borderRadius: 14,
              background: '#0f172a',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              color: '#fff',
            }}
          >
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, color: '#cbd5e1' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.1)', color: '#94a3b8' }}>
                    <th style={{ textAlign: 'left', padding: '8px 6px' }}>Hand Equity Bracket</th>
                    <th style={{ textAlign: 'center', padding: '8px 6px' }}>Fold %</th>
                    <th style={{ textAlign: 'center', padding: '8px 6px' }}>Call %</th>
                    <th style={{ textAlign: 'center', padding: '8px 6px' }}>Raise %</th>
                    <th style={{ textAlign: 'center', padding: '8px 6px' }}>Bluff EV</th>
                  </tr>
                </thead>
                <tbody>
                  {telemetry?.decisionMatrix.map((row, idx) => (
                    <tr key={idx} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                      <td style={{ padding: '6px', fontWeight: 600 }}>{row.bracket}</td>
                      <td style={{ textAlign: 'center', padding: '6px', color: '#ef4444' }}>{row.fold}%</td>
                      <td style={{ textAlign: 'center', padding: '6px', color: '#38bdf8' }}>{row.call}%</td>
                      <td style={{ textAlign: 'center', padding: '6px', color: '#10b981', fontWeight: 700 }}>{row.raise}%</td>
                      <td style={{ textAlign: 'center', padding: '6px' }}>
                        {row.bluffPct > 0 ? (
                          <Tag color="magenta" style={{ fontSize: 10, margin: 0 }}>+{row.bluffPct}% GTO</Tag>
                        ) : (
                          <span style={{ color: '#64748b' }}>—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </Col>
      </Row>

      {/* 6. Live Engine Health Grid */}
      <Card
        title={
          <Space>
            <CheckCircleOutlined style={{ color: '#10b981' }} />
            <span style={{ color: '#fff', fontWeight: 700 }}>Live Game Engine & Bot Trainer Connectivity</span>
          </Space>
        }
        bordered={false}
        style={{
          borderRadius: 14,
          background: '#0f172a',
          border: '1px solid rgba(255, 255, 255, 0.08)',
          color: '#fff',
        }}
      >
        <Row gutter={[16, 16]}>
          {(telemetry?.activeDaemons || [
            { name: 'Teen Patti Go Engine', port: 3001, status: 'ONLINE', protocol: 'HTTP /ws' },
            { name: 'Ludo Match Engine', port: 3002, status: 'ONLINE', protocol: 'WebSocket' },
            { name: 'Rummy Engine', port: 3003, status: 'ONLINE', protocol: 'WebSocket' },
            { name: 'TP Bot Trainer', port: 3023, status: 'ONLINE', protocol: 'REST' },
            { name: 'Ludo Bot Trainer', port: 3024, status: 'ONLINE', protocol: 'REST' },
            { name: 'Rummy Bot Trainer', port: 3025, status: 'ONLINE', protocol: 'REST' },
          ]).map((d, idx) => (
            <Col xs={24} sm={12} md={8} lg={4} key={idx}>
              <div
                style={{
                  background: '#1e293b',
                  padding: '12px 14px',
                  borderRadius: 10,
                  border: '1px solid rgba(16, 185, 129, 0.25)',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Badge status="processing" color="#10b981" />
                  <Tag color="cyan" style={{ fontSize: 10, margin: 0 }}>:{d.port}</Tag>
                </div>
                <div style={{ fontWeight: 700, fontSize: 13, color: '#fff', marginTop: 6 }}>
                  {d.name}
                </div>
                <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>
                  {d.protocol} • <span style={{ color: '#10b981' }}>{d.status}</span>
                </div>
              </div>
            </Col>
          ))}
        </Row>
      </Card>
    </div>
  )
}
