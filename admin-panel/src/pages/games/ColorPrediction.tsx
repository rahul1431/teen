import { useEffect, useState } from 'react'
import {
  Card, Row, Col, Typography, Statistic, Table, Tag, Button, Space,
  Progress, Form, InputNumber, Switch, Select, Modal, message, Popconfirm,
  Badge, Tabs, Alert, Divider, Radio, Tooltip
} from 'antd'
import {
  ReloadOutlined, SaveOutlined, PlayCircleOutlined, ThunderboltOutlined,
  StopOutlined, CheckCircleOutlined, SettingOutlined, TrophyOutlined,
  DollarOutlined, LineChartOutlined, BgColorsOutlined, FireOutlined,
  ClockCircleOutlined, UserOutlined
} from '@ant-design/icons'
import { adminApi } from '../../api/client'
import { tokens } from '../../theme/tokens'

const { Title, Text, Paragraph } = Typography

export default function ColorPrediction() {
  const [selectedMode, setSelectedMode] = useState<string>('30s')
  const [statusData, setStatusData] = useState<any>(null)
  const [loading, setLoading] = useState(false)
  const [config, setConfig] = useState<any>(null)
  const [savingConfig, setSavingConfig] = useState(false)
  const [history, setHistory] = useState<any[]>([])
  const [totalHistory, setTotalHistory] = useState(0)
  const [page, setPage] = useState(1)
  const [loadingHistory, setLoadingHistory] = useState(false)

  const [selectedOverride, setSelectedOverride] = useState<number | null>(null)
  const [overrideLoading, setOverrideLoading] = useState(false)

  const [form] = Form.useForm()

  const loadStatus = async (mode = selectedMode) => {
    try {
      const res = await adminApi.get('/color-prediction/admin/status', {
        params: { game_mode: mode }
      })
      setStatusData(res.data)
    } catch {
      // Polling fallback
    }
  }

  const loadConfig = async () => {
    try {
      const res = await adminApi.get('/game-configs')
      const cpConf = res.data.find((c: any) => c.game_type === 'color_prediction')
      setConfig(cpConf)
      if (cpConf) {
        const rules = typeof cpConf.special_rules === 'string'
          ? JSON.parse(cpConf.special_rules)
          : (cpConf.special_rules || {})
        form.setFieldsValue({
          is_active: cpConf.is_active,
          rake_percent: cpConf.rake_percent,
          min_bet: cpConf.min_bet ?? 10,
          max_bet: cpConf.max_bet ?? 50000,
          interval_seconds: rules.interval_seconds ?? 30,
          house_mode: rules.house_mode ?? 'fair',
        })
      }
    } catch {
      message.error('Failed to load Color Prediction configuration')
    }
  }

  const loadHistory = async (p = 1, mode = selectedMode) => {
    setLoadingHistory(true)
    try {
      const res = await adminApi.get('/color-prediction/history', {
        params: { page: p, limit: 15, game_mode: mode }
      })
      setHistory(res.data.rounds || [])
      setTotalHistory(res.data.total || 0)
      setPage(p)
    } catch {
      // silent
    } finally {
      setLoadingHistory(false)
    }
  }

  const saveConfig = async (values: any) => {
    setSavingConfig(true)
    try {
      const payload = {
        is_active: values.is_active,
        rake_percent: values.rake_percent,
        special_rules: {
          min_bet: values.min_bet,
          max_bet: values.max_bet,
          interval_seconds: values.interval_seconds,
          house_mode: values.house_mode,
        }
      }
      await adminApi.patch('/game-configs/color_prediction', payload)
      message.success('Color Prediction configuration saved successfully!')
      loadConfig()
    } catch (e: any) {
      message.error(e.response?.data?.error || 'Failed to save configuration')
    } finally {
      setSavingConfig(false)
    }
  }

  const handleSetOverride = async (num: number) => {
    setOverrideLoading(true)
    try {
      await adminApi.post('/color-prediction/admin/override', {
        round_id: statusData?.active_round?.id,
        winning_number: num
      })
      message.success(`Outcome successfully locked to #${num} (${getColorName(num)}) for this round!`)
      setSelectedOverride(num)
      loadStatus()
    } catch (e: any) {
      message.error(e.response?.data?.error || 'Failed to set outcome override')
    } finally {
      setOverrideLoading(false)
    }
  }

  const handleForceSettle = async () => {
    if (!statusData?.active_round?.id) return
    try {
      await adminApi.post('/color-prediction/admin/settle', {
        round_id: statusData.active_round.id,
        winning_number: selectedOverride !== null ? selectedOverride : undefined
      })
      message.success('Round settled instantly!')
      setSelectedOverride(null)
      loadStatus()
      loadHistory(1)
    } catch (e: any) {
      message.error(e.response?.data?.error || 'Failed to settle round')
    }
  }

  useEffect(() => {
    loadStatus()
    loadConfig()
    loadHistory(1)

    // 2-second live poller for smooth admin updates
    const interval = setInterval(() => {
      loadStatus()
    }, 2000)
    return () => clearInterval(interval)
  }, [])

  const getColorName = (num: number) => {
    if (num === 0) return 'Violet + Red'
    if (num === 5) return 'Violet + Green'
    if ([1, 3, 7, 9].includes(num)) return 'Green'
    return 'Red'
  }

  const getColorBadge = (num: number) => {
    if (num === 0) {
      return (
        <span style={{
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          width: 32, height: 32, borderRadius: '50%',
          background: 'linear-gradient(135deg, #7C3AED 50%, #EF4444 50%)',
          color: '#fff', fontWeight: 800, fontSize: 14, boxShadow: '0 2px 6px rgba(0,0,0,0.2)'
        }}>
          0
        </span>
      )
    }
    if (num === 5) {
      return (
        <span style={{
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          width: 32, height: 32, borderRadius: '50%',
          background: 'linear-gradient(135deg, #7C3AED 50%, #10B981 50%)',
          color: '#fff', fontWeight: 800, fontSize: 14, boxShadow: '0 2px 6px rgba(0,0,0,0.2)'
        }}>
          5
        </span>
      )
    }
    const isGreen = [1, 3, 7, 9].includes(num)
    return (
      <span style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        width: 32, height: 32, borderRadius: '50%',
        background: isGreen ? '#10B981' : '#EF4444',
        color: '#fff', fontWeight: 800, fontSize: 14, boxShadow: '0 2px 6px rgba(0,0,0,0.2)'
      }}>
        {num}
      </span>
    )
  }

  const activeRound = statusData?.active_round
  const betSummary = statusData?.bet_summary || {
    total_bets: 0,
    total_amount: 0,
    green_amount: 0,
    red_amount: 0,
    violet_amount: 0,
    big_amount: 0,
    small_amount: 0,
    number_amounts: Array(10).fill(0)
  }
  const overall = statusData?.overall_stats || {}
  const remainingSec = activeRound?.remaining_seconds ?? 30
  const isLocked = activeRound?.status === 'locked' || remainingSec <= 5

  return (
    <div style={{ padding: '0 8px 32px' }}>
      {/* Header Bar */}
      <Row justify="space-between" align="middle" style={{ marginBottom: 12 }}>
        <Col>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Title level={4} style={{ margin: 0, color: '#0F172A' }}>🎨 Color Prediction (Wingo / Fast Parity) Hub</Title>
            {config && (
              <Tag color={config.is_active ? 'green' : 'red'} style={{ fontWeight: 700 }}>
                {config.is_active ? '● LIVE & ACCEPTING BETS' : '○ DISABLED'}
              </Tag>
            )}
          </div>
          <Text type="secondary">Real-time round control, bet exposure heatmap, admin outcome intervention, and PnL analytics</Text>
        </Col>
        <Col>
          <Space>
            <Button icon={<ReloadOutlined />} onClick={() => { loadStatus(); loadConfig(); loadHistory(page) }}>Refresh</Button>
          </Space>
        </Col>
      </Row>

      {/* Mode Switcher */}
      <div style={{ marginBottom: 16 }}>
        <Radio.Group
          value={selectedMode}
          onChange={(e) => {
            const mode = e.target.value
            setSelectedMode(mode)
            loadStatus(mode)
            loadHistory(1, mode)
          }}
          buttonStyle="solid"
          size="middle"
        >
          <Radio.Button value="30s">⚡ 30s Fast Parity</Radio.Button>
          <Radio.Button value="1m">⏱️ 1M WinGo</Radio.Button>
          <Radio.Button value="3m">⏳ 3M WinGo</Radio.Button>
          <Radio.Button value="5m">🕒 5M WinGo</Radio.Button>
        </Radio.Group>
      </div>

      {/* Overview Statistics Cards */}
      <Row gutter={[12, 12]} style={{ marginBottom: 20 }}>
        <Col xs={12} sm={6} md={4}>
          <Card size="small" style={{ background: '#FFFFFF', borderRadius: 14, border: '1px solid #E2E8F0' }}>
            <Statistic
              title="Active Round"
              value={activeRound?.period_id ? `#${activeRound.period_id.slice(-6)}` : 'Syncing'}
              prefix={<ClockCircleOutlined style={{ color: '#2563EB' }} />}
              valueStyle={{ fontSize: 16, fontWeight: 700 }}
            />
          </Card>
        </Col>
        <Col xs={12} sm={6} md={4}>
          <Card size="small" style={{ background: '#FFFFFF', borderRadius: 14, border: '1px solid #E2E8F0' }}>
            <Statistic
              title="Live Pool Stake"
              value={betSummary.total_amount}
              precision={2}
              prefix="₹ "
              valueStyle={{ color: '#059669', fontWeight: 700 }}
            />
          </Card>
        </Col>
        <Col xs={12} sm={6} md={4}>
          <Card size="small" style={{ background: '#FFFFFF', borderRadius: 14, border: '1px solid #E2E8F0' }}>
            <Statistic
              title="Live Bets Placed"
              value={betSummary.total_bets}
              prefix={<UserOutlined style={{ color: '#7C3AED' }} />}
              valueStyle={{ fontWeight: 700 }}
            />
          </Card>
        </Col>
        <Col xs={12} sm={6} md={4}>
          <Card size="small" style={{ background: '#FFFFFF', borderRadius: 14, border: '1px solid #E2E8F0' }}>
            <Statistic
              title="Total Turnover"
              value={Number(overall.total_turnover || 0)}
              precision={2}
              prefix="₹ "
              valueStyle={{ color: '#D97706', fontWeight: 700 }}
            />
          </Card>
        </Col>
        <Col xs={12} sm={6} md={4}>
          <Card size="small" style={{ background: '#FFFFFF', borderRadius: 14, border: '1px solid #E2E8F0' }}>
            <Statistic
              title="Net House Profit"
              value={Number(overall.total_house_profit || 0)}
              precision={2}
              prefix="₹ "
              valueStyle={{ color: '#2563EB', fontWeight: 700 }}
            />
          </Card>
        </Col>
        <Col xs={12} sm={6} md={4}>
          <Card size="small" style={{ background: '#FFFFFF', borderRadius: 14, border: '1px solid #E2E8F0' }}>
            <Statistic
              title="Settled Rounds"
              value={overall.total_settled_rounds || 0}
              prefix={<TrophyOutlined style={{ color: '#0891B2' }} />}
            />
          </Card>
        </Col>
      </Row>

      {/* Main Action Tabs */}
      <Tabs defaultActiveKey="live" items={[
        {
          key: 'live',
          label: <span><PlayCircleOutlined /> Live Draw & Intervention</span>,
          children: (
            <Row gutter={[16, 16]}>
              {/* Left Column: Live Round & Intervention */}
              <Col xs={24} lg={12}>
                <Card
                  title={<span style={{ display: 'flex', alignItems: 'center', gap: 8 }}><ThunderboltOutlined style={{ color: '#D97706' }} /> Active Draw: Period {activeRound?.period_id || '—'}</span>}
                  extra={
                    <Tag color={isLocked ? 'red' : 'green'} style={{ fontWeight: 700 }}>
                      {isLocked ? '🔒 BETTING LOCKED (<5s)' : '🟢 OPEN FOR BETS'}
                    </Tag>
                  }
                  style={{ borderRadius: 16, border: '1px solid #E2E8F0', marginBottom: 16 }}
                >
                  <div style={{ textAlign: 'center', padding: '12px 0 20px' }}>
                    <div style={{ fontSize: 13, color: '#64748B', marginBottom: 4 }}>TIME REMAINING FOR DRAW</div>
                    <div style={{
                      fontSize: 48,
                      fontWeight: 900,
                      fontFamily: 'monospace',
                      color: remainingSec <= 5 ? '#EF4444' : remainingSec <= 10 ? '#F59E0B' : '#10B981',
                      letterSpacing: 2
                    }}>
                      00:{String(remainingSec).padStart(2, '0')}
                    </div>
                    <Progress
                      percent={Math.min(100, Math.max(0, (remainingSec / 30) * 100))}
                      showInfo={false}
                      strokeColor={remainingSec <= 5 ? '#EF4444' : remainingSec <= 10 ? '#F59E0B' : '#10B981'}
                      style={{ maxWidth: 320, margin: '0 auto' }}
                    />
                  </div>

                  <Divider style={{ margin: '12px 0' }} />

                  {/* Manual Result Intervention */}
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                      <Text strong style={{ fontSize: 15, color: '#0F172A' }}>🎯 Admin Outcome Intervention (Next Draw Result):</Text>
                      {activeRound?.manual_override_number != null && (
                        <Tag color="purple" style={{ fontWeight: 700 }}>
                          Forced Result: #{activeRound.manual_override_number}
                        </Tag>
                      )}
                    </div>
                    <Paragraph type="secondary" style={{ fontSize: 12 }}>
                      Click any number (0–9) below to lock it as the winning result for this round. If unset, the system uses fair RNG or House Protection mode.
                    </Paragraph>

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 8, marginTop: 12 }}>
                      {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((num) => {
                        const isSelected = selectedOverride === num || activeRound?.manual_override_number === num
                        return (
                          <Button
                            key={num}
                            type={isSelected ? 'primary' : 'default'}
                            onClick={() => handleSetOverride(num)}
                            loading={overrideLoading}
                            style={{
                              height: 52,
                              borderRadius: 12,
                              display: 'flex',
                              flexDirection: 'column',
                              alignItems: 'center',
                              justifyContent: 'center',
                              border: isSelected ? '2px solid #7C3AED' : '1px solid #E2E8F0',
                              background: isSelected ? '#F3E8FF' : '#FFFFFF'
                            }}
                          >
                            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                              {getColorBadge(num)}
                              <span style={{ fontSize: 11, color: '#64748B' }}>{num >= 5 ? 'Big' : 'Sml'}</span>
                            </div>
                          </Button>
                        )
                      })}
                    </div>

                    <div style={{ marginTop: 16, display: 'flex', gap: 8 }}>
                      <Popconfirm
                        title="Force Settle Round Now?"
                        description="This will immediately calculate payouts and start the next round."
                        onConfirm={handleForceSettle}
                      >
                        <Button type="primary" danger block size="large" icon={<ThunderboltOutlined />}>
                          Instant Draw & Settle (Force Now)
                        </Button>
                      </Popconfirm>
                    </div>
                  </div>
                </Card>

                {/* Recent Result Beads */}
                <Card
                  title="🔮 Recent Draw Outcomes (Beads)"
                  size="small"
                  style={{ borderRadius: 16, border: '1px solid #E2E8F0' }}
                >
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, padding: '4px 0' }}>
                    {history.slice(0, 14).map((h, i) => (
                      <Tooltip key={i} title={`Period ${h.period_id} | ${getColorName(h.winning_number)} (${h.winning_size?.toUpperCase()})`}>
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                          {getColorBadge(h.winning_number)}
                          <span style={{ fontSize: 10, color: '#64748B', fontWeight: 600 }}>{h.winning_size?.[0]?.toUpperCase()}</span>
                        </div>
                      </Tooltip>
                    ))}
                  </div>
                </Card>
              </Col>

              {/* Right Column: Live Bet Exposure Heatmap */}
              <Col xs={24} lg={12}>
                <Card
                  title={<span style={{ display: 'flex', alignItems: 'center', gap: 8 }}><BgColorsOutlined style={{ color: '#7C3AED' }} /> Live Bet Exposure Heatmap</span>}
                  style={{ borderRadius: 16, border: '1px solid #E2E8F0', marginBottom: 16 }}
                >
                  {/* Colors Breakdown */}
                  <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
                    <Col span={8}>
                      <div style={{ padding: 12, borderRadius: 12, background: '#ECFDF5', border: '1px solid #A7F3D0', textAlign: 'center' }}>
                        <Tag color="green" style={{ fontWeight: 800 }}>🟢 GREEN (2x)</Tag>
                        <div style={{ fontSize: 20, fontWeight: 800, color: '#059669', marginTop: 4 }}>
                          ₹ {betSummary.green_amount.toFixed(2)}
                        </div>
                      </div>
                    </Col>
                    <Col span={8}>
                      <div style={{ padding: 12, borderRadius: 12, background: '#F5F3FF', border: '1px solid #DDD6FE', textAlign: 'center' }}>
                        <Tag color="purple" style={{ fontWeight: 800 }}>🟣 VIOLET (4.5x)</Tag>
                        <div style={{ fontSize: 20, fontWeight: 800, color: '#7C3AED', marginTop: 4 }}>
                          ₹ {betSummary.violet_amount.toFixed(2)}
                        </div>
                      </div>
                    </Col>
                    <Col span={8}>
                      <div style={{ padding: 12, borderRadius: 12, background: '#FEF2F2', border: '1px solid #FECACA', textAlign: 'center' }}>
                        <Tag color="red" style={{ fontWeight: 800 }}>🔴 RED (2x)</Tag>
                        <div style={{ fontSize: 20, fontWeight: 800, color: '#DC2626', marginTop: 4 }}>
                          ₹ {betSummary.red_amount.toFixed(2)}
                        </div>
                      </div>
                    </Col>
                  </Row>

                  {/* Big vs Small */}
                  <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
                    <Col span={12}>
                      <div style={{ padding: 10, borderRadius: 12, background: '#EFF6FF', border: '1px solid #BFDBFE', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontWeight: 700, color: '#1D4ED8' }}>🔵 BIG (5–9):</span>
                        <span style={{ fontWeight: 800, fontSize: 16, color: '#1D4ED8' }}>₹ {betSummary.big_amount.toFixed(2)}</span>
                      </div>
                    </Col>
                    <Col span={12}>
                      <div style={{ padding: 10, borderRadius: 12, background: '#FFFBEB', border: '1px solid #FDE68A', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontWeight: 700, color: '#B45309' }}>🟠 SMALL (0–4):</span>
                        <span style={{ fontWeight: 800, fontSize: 16, color: '#B45309' }}>₹ {betSummary.small_amount.toFixed(2)}</span>
                      </div>
                    </Col>
                  </Row>

                  <Divider style={{ margin: '12px 0' }}>Number Stakes (0 to 9) — 9x Multiplier</Divider>

                  {/* 0-9 Numbers Grid Breakdown */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 8 }}>
                    {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(num => (
                      <div key={num} style={{ padding: 8, background: '#F8FAFC', borderRadius: 10, border: '1px solid #E2E8F0', textAlign: 'center' }}>
                        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 2 }}>{getColorBadge(num)}</div>
                        <div style={{ fontSize: 12, fontWeight: 700, color: '#0F172A', marginTop: 2 }}>
                          ₹ {Number(betSummary.number_amounts[num] || 0).toFixed(0)}
                        </div>
                      </div>
                    ))}
                  </div>
                </Card>
              </Col>
            </Row>
          )
        },
        {
          key: 'history',
          label: <span><LineChartOutlined /> Draw History & Audit</span>,
          children: (
            <Card style={{ borderRadius: 16, border: '1px solid #E2E8F0' }}>
              <Table
                rowKey="id"
                dataSource={history}
                loading={loadingHistory}
                pagination={{
                  current: page,
                  total: totalHistory,
                  pageSize: 15,
                  onChange: (p) => loadHistory(p)
                }}
                scroll={{ x: 'max-content' }}
                size="small"
                columns={[
                  {
                    title: 'Period ID',
                    dataIndex: 'period_id',
                    render: (p: string) => <Text strong>{p}</Text>
                  },
                  {
                    title: 'Result Number',
                    dataIndex: 'winning_number',
                    render: (n: number) => getColorBadge(n)
                  },
                  {
                    title: 'Winning Color',
                    dataIndex: 'winning_color',
                    render: (c: string, r: any) => (
                      <Tag color={c?.includes('green') ? 'green' : c?.includes('red') ? 'red' : 'purple'}>
                        {getColorName(r.winning_number)}
                      </Tag>
                    )
                  },
                  {
                    title: 'Size',
                    dataIndex: 'winning_size',
                    render: (s: string) => (
                      <Tag color={s === 'big' ? 'blue' : 'orange'}>
                        {s?.toUpperCase()}
                      </Tag>
                    )
                  },
                  {
                    title: 'Total Turnover (₹)',
                    dataIndex: 'total_bet_amount',
                    render: (v: any) => <Text strong style={{ color: '#D97706' }}>₹ {Number(v || 0).toFixed(2)}</Text>
                  },
                  {
                    title: 'Payouts (₹)',
                    dataIndex: 'total_payout_amount',
                    render: (v: any) => <Text style={{ color: '#EF4444' }}>₹ {Number(v || 0).toFixed(2)}</Text>
                  },
                  {
                    title: 'House Profit (₹)',
                    dataIndex: 'house_profit',
                    render: (v: any) => {
                      const num = Number(v || 0)
                      return <Text strong style={{ color: num >= 0 ? '#059669' : '#EF4444' }}>₹ {num.toFixed(2)}</Text>
                    }
                  },
                  {
                    title: 'Settled At',
                    dataIndex: 'settled_at',
                    render: (d: string) => d ? new Date(d).toLocaleTimeString() : '—'
                  }
                ]}
              />
            </Card>
          )
        },
        {
          key: 'config',
          label: <span><SettingOutlined /> Game Configuration & Economics</span>,
          children: (
            <div style={{ maxWidth: 680 }}>
              <Card style={{ borderRadius: 16, border: '1px solid #E2E8F0' }}>
                <Form form={form} layout="vertical" onFinish={saveConfig}>
                  <Row gutter={16}>
                    <Col span={12}>
                      <Form.Item name="is_active" label="Game Active on Mobile App" valuePropName="checked">
                        <Switch checkedChildren="LIVE" unCheckedChildren="DISABLED" />
                      </Form.Item>
                    </Col>
                    <Col span={12}>
                      <Form.Item name="rake_percent" label="House Commission Rake (%)" rules={[{ required: true }]}>
                        <InputNumber min={0} max={20} step={0.5} suffix="%" style={{ width: '100%' }} />
                      </Form.Item>
                    </Col>
                  </Row>

                  <Row gutter={16}>
                    <Col span={12}>
                      <Form.Item name="interval_seconds" label="Draw Timer Interval" rules={[{ required: true }]}>
                        <Select options={[
                          { value: 30, label: '⚡ 30 Seconds (Fast Parity)' },
                          { value: 60, label: '⏱️ 1 Minute (Wingo 1M)' },
                          { value: 180, label: '⏳ 3 Minutes (Wingo 3M)' },
                          { value: 300, label: '🕒 5 Minutes (Wingo 5M)' },
                        ]} />
                      </Form.Item>
                    </Col>
                    <Col span={12}>
                      <Form.Item name="house_mode" label="Outcome Algorithm Mode" rules={[{ required: true }]}>
                        <Select options={[
                          { value: 'fair', label: '🎲 Fair RNG (Pure Random)' },
                          { value: 'low_payout', label: '🛡️ Profit Guard (Min House Payout)' },
                        ]} />
                      </Form.Item>
                    </Col>
                  </Row>

                  <Row gutter={16}>
                    <Col span={12}>
                      <Form.Item name="min_bet" label="Minimum Bet Stake (₹)">
                        <InputNumber min={1} max={1000} prefix="₹ " style={{ width: '100%' }} />
                      </Form.Item>
                    </Col>
                    <Col span={12}>
                      <Form.Item name="max_bet" label="Maximum Bet Stake (₹)">
                        <InputNumber min={1000} max={500000} prefix="₹ " style={{ width: '100%' }} />
                      </Form.Item>
                    </Col>
                  </Row>

                  <Button type="primary" htmlType="submit" size="large" icon={<SaveOutlined />} loading={savingConfig} block>
                    Save Color Prediction Settings
                  </Button>
                </Form>
              </Card>
            </div>
          )
        }
      ]} />
    </div>
  )
}
