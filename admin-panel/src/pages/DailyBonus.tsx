import { useEffect, useState } from 'react'
import {
  Card, Table, InputNumber, Button, Select, Switch, Typography, Space,
  Statistic, Row, Col, Tag, message, Tooltip, Badge, Divider, Spin,
} from 'antd'
import {
  GiftOutlined, FireOutlined, SaveOutlined, ReloadOutlined,
  TrophyOutlined, UserOutlined, DollarOutlined, CalendarOutlined,
} from '@ant-design/icons'
import { useAuthStore } from '../store/auth'

const { Title, Text } = Typography

const EMOJI_OPTIONS = ['🎁','💎','🔥','⚡','🌟','👑','🏆','💰','🎉','🎯','🍀','💫']

interface DayConfig {
  day_number: number
  bonus_amount: number
  bonus_type: 'real' | 'bonus'
  label: string
  emoji: string
  is_special: boolean
  is_active: boolean
}

interface Stats {
  today: { claimed_today: number; distributed_today: number }
  all_time: { total_claims: number; total_distributed: number }
  streaks: { max_streak: number; avg_streak: number; active_streaks: number }
}

export default function DailyBonus() {
  const { token } = useAuthStore()
  const [config, setConfig] = useState<DayConfig[]>([])
  const [stats, setStats] = useState<Stats | null>(null)
  const [loadingConfig, setLoadingConfig] = useState(true)
  const [loadingStats, setLoadingStats] = useState(true)
  const [saving, setSaving] = useState(false)

  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }

  const fetchConfig = async () => {
    setLoadingConfig(true)
    try {
      const res = await fetch('/api/admin/bonus/login-config', { headers })
      const data = await res.json()
      // If empty, seed defaults
      if (!data.length) {
        const defaults: DayConfig[] = Array.from({ length: 7 }, (_, i) => ({
          day_number: i + 1,
          bonus_amount: [10, 15, 20, 25, 30, 40, 100][i],
          bonus_type: 'real',
          label: i === 6 ? 'Day 7 — Weekly Bonus!' : `Day ${i + 1}`,
          emoji: ['🎁','💎','🔥','⚡','🌟','👑','🏆'][i],
          is_special: i === 6,
          is_active: true,
        }))
        setConfig(defaults)
      } else {
        setConfig(data)
      }
    } catch {
      message.error('Failed to load config')
    } finally {
      setLoadingConfig(false)
    }
  }

  const fetchStats = async () => {
    setLoadingStats(true)
    try {
      const res = await fetch('/api/admin/bonus/stats', { headers })
      const data = await res.json()
      setStats(data)
    } catch {
      // Stats are non-critical
    } finally {
      setLoadingStats(false)
    }
  }

  useEffect(() => {
    fetchConfig()
    fetchStats()
  }, [])

  const updateDay = (dayNumber: number, field: keyof DayConfig, value: any) => {
    setConfig(prev => prev.map(d =>
      d.day_number === dayNumber ? { ...d, [field]: value } : d
    ))
  }

  const addDay = () => {
    const next = config.length + 1
    if (next > 30) return message.warning('Maximum 30 days')
    setConfig(prev => [...prev, {
      day_number: next,
      bonus_amount: 10,
      bonus_type: 'real',
      label: `Day ${next}`,
      emoji: '🎁',
      is_special: false,
      is_active: true,
    }])
  }

  const removeDay = (dayNumber: number) => {
    if (config.length <= 1) return message.warning('At least 1 day required')
    setConfig(prev => prev.filter(d => d.day_number !== dayNumber))
  }

  const save = async () => {
    setSaving(true)
    try {
      const res = await fetch('/api/admin/bonus/login-config', {
        method: 'PUT',
        headers,
        body: JSON.stringify(config),
      })
      if (!res.ok) throw new Error(await res.text())
      message.success('Bonus config saved successfully!')
      fetchStats()
    } catch (e: any) {
      message.error(e.message || 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  const columns = [
    {
      title: 'Day',
      dataIndex: 'day_number',
      width: 60,
      render: (d: number, row: DayConfig) => (
        <Space>
          <Badge
            count={row.is_special ? '⭐' : null}
            style={{ backgroundColor: 'transparent', color: '#d4af37', fontSize: 16 }}
          >
            <div style={{
              width: 36, height: 36, borderRadius: '50%',
              background: row.is_special ? 'linear-gradient(135deg,#d4af37,#b8870b)' : '#1e1e2e',
              border: `2px solid ${row.is_special ? '#d4af37' : '#333'}`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontWeight: 900, color: row.is_special ? '#000' : '#fff', fontSize: 13,
            }}>
              {d}
            </div>
          </Badge>
        </Space>
      ),
    },
    {
      title: 'Emoji',
      dataIndex: 'emoji',
      width: 120,
      render: (v: string, row: DayConfig) => (
        <Select
          value={v}
          size="small"
          style={{ width: 100 }}
          onChange={val => updateDay(row.day_number, 'emoji', val)}
          options={EMOJI_OPTIONS.map(e => ({ value: e, label: e }))}
        />
      ),
    },
    {
      title: 'Label',
      dataIndex: 'label',
      render: (v: string, row: DayConfig) => (
        <input
          value={v}
          onChange={e => updateDay(row.day_number, 'label', e.target.value)}
          style={{
            background: '#1e1e2e', border: '1px solid #333', borderRadius: 6,
            color: '#fff', padding: '4px 8px', width: '100%', fontSize: 13,
          }}
        />
      ),
    },
    {
      title: 'Bonus Amount (₹)',
      dataIndex: 'bonus_amount',
      width: 160,
      render: (v: number, row: DayConfig) => (
        <InputNumber
          value={v}
          min={1}
          max={100000}
          size="small"
          prefix="₹"
          style={{ width: 130 }}
          onChange={val => updateDay(row.day_number, 'bonus_amount', val ?? 0)}
        />
      ),
    },
    {
      title: 'Wallet Type',
      dataIndex: 'bonus_type',
      width: 130,
      render: (v: string, row: DayConfig) => (
        <Select
          value={v}
          size="small"
          style={{ width: 110 }}
          onChange={val => updateDay(row.day_number, 'bonus_type', val)}
          options={[
            { value: 'real', label: '💵 Real' },
            { value: 'bonus', label: '🎁 Bonus' },
          ]}
        />
      ),
    },
    {
      title: 'Special Day',
      dataIndex: 'is_special',
      width: 100,
      render: (v: boolean, row: DayConfig) => (
        <Tooltip title="Highlights this day as the weekly jackpot">
          <Switch
            size="small"
            checked={v}
            onChange={val => updateDay(row.day_number, 'is_special', val)}
          />
        </Tooltip>
      ),
    },
    {
      title: 'Active',
      dataIndex: 'is_active',
      width: 80,
      render: (v: boolean, row: DayConfig) => (
        <Switch
          size="small"
          checked={v}
          onChange={val => updateDay(row.day_number, 'is_active', val)}
        />
      ),
    },
    {
      title: '',
      width: 60,
      render: (_: any, row: DayConfig) => (
        config.length > 1 ? (
          <Button
            type="text"
            danger
            size="small"
            onClick={() => removeDay(row.day_number)}
          >✕</Button>
        ) : null
      ),
    },
  ]

  return (
    <div style={{ padding: 24, background: '#0d1117', minHeight: '100vh' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
        <div>
          <Title level={3} style={{ color: '#fff', margin: 0 }}>
            <GiftOutlined style={{ color: '#d4af37', marginRight: 10 }} />
            Daily Login Bonus
          </Title>
          <Text style={{ color: '#8b949e' }}>
            Configure the bonus schedule players see on their Daily Bonus page
          </Text>
        </div>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={() => { fetchConfig(); fetchStats() }}>
            Refresh
          </Button>
          <Button
            type="primary"
            icon={<SaveOutlined />}
            loading={saving}
            onClick={save}
            style={{ background: '#d4af37', borderColor: '#d4af37', color: '#000', fontWeight: 700 }}
          >
            Save Config
          </Button>
        </Space>
      </div>

      {/* Stats Row */}
      <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
        <Col xs={24} sm={12} md={6}>
          <Card style={{ background: '#161b22', border: '1px solid #30363d' }}>
            {loadingStats ? <Spin /> : (
              <Statistic
                title={<Text style={{ color: '#8b949e' }}>Claimed Today</Text>}
                value={stats?.today?.claimed_today ?? 0}
                prefix={<CalendarOutlined style={{ color: '#00c853' }} />}
                valueStyle={{ color: '#00c853', fontWeight: 900 }}
              />
            )}
          </Card>
        </Col>
        <Col xs={24} sm={12} md={6}>
          <Card style={{ background: '#161b22', border: '1px solid #30363d' }}>
            {loadingStats ? <Spin /> : (
              <Statistic
                title={<Text style={{ color: '#8b949e' }}>Distributed Today</Text>}
                value={parseFloat(stats?.today?.distributed_today as any ?? '0').toFixed(2)}
                prefix={<DollarOutlined style={{ color: '#d4af37' }} />}
                suffix="₹"
                valueStyle={{ color: '#d4af37', fontWeight: 900 }}
              />
            )}
          </Card>
        </Col>
        <Col xs={24} sm={12} md={6}>
          <Card style={{ background: '#161b22', border: '1px solid #30363d' }}>
            {loadingStats ? <Spin /> : (
              <Statistic
                title={<Text style={{ color: '#8b949e' }}>All-Time Claims</Text>}
                value={stats?.all_time?.total_claims ?? 0}
                prefix={<UserOutlined style={{ color: '#2196f3' }} />}
                valueStyle={{ color: '#2196f3', fontWeight: 900 }}
              />
            )}
          </Card>
        </Col>
        <Col xs={24} sm={12} md={6}>
          <Card style={{ background: '#161b22', border: '1px solid #30363d' }}>
            {loadingStats ? <Spin /> : (
              <Statistic
                title={<Text style={{ color: '#8b949e' }}>Max Streak</Text>}
                value={stats?.streaks?.max_streak ?? 0}
                prefix={<FireOutlined style={{ color: '#ff6d00' }} />}
                suffix="days"
                valueStyle={{ color: '#ff6d00', fontWeight: 900 }}
              />
            )}
          </Card>
        </Col>
      </Row>

      {/* Preview strip */}
      <Card
        style={{ background: '#161b22', border: '1px solid #30363d', marginBottom: 24 }}
        title={<Text style={{ color: '#fff' }}>📱 Player Preview</Text>}
        extra={<Text style={{ color: '#8b949e', fontSize: 12 }}>This is how the schedule appears in the app</Text>}
      >
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {config.filter(d => d.is_active).map(d => (
            <div key={d.day_number} style={{
              width: 72, padding: '10px 6px',
              background: d.is_special ? 'rgba(212,175,55,0.15)' : 'rgba(255,255,255,0.04)',
              border: `2px solid ${d.is_special ? '#d4af37' : '#30363d'}`,
              borderRadius: 12, textAlign: 'center',
              boxShadow: d.is_special ? '0 0 16px rgba(212,175,55,0.3)' : undefined,
            }}>
              <div style={{ fontSize: 22 }}>{d.emoji}</div>
              <div style={{
                color: d.is_special ? '#d4af37' : '#00c853',
                fontSize: 12, fontWeight: 900, marginTop: 4,
              }}>
                ₹{d.bonus_amount}
              </div>
              <div style={{ color: '#8b949e', fontSize: 10, marginTop: 2 }}>D{d.day_number}</div>
              {d.is_special && (
                <Tag color="gold" style={{ fontSize: 9, padding: '0 4px', marginTop: 4 }}>SPECIAL</Tag>
              )}
            </div>
          ))}
        </div>
      </Card>

      {/* Config Table */}
      <Card
        style={{ background: '#161b22', border: '1px solid #30363d' }}
        title={
          <Space>
            <TrophyOutlined style={{ color: '#d4af37' }} />
            <Text style={{ color: '#fff' }}>Bonus Schedule ({config.length} days)</Text>
            <Tag color="blue">{config.filter(d => d.is_active).length} Active</Tag>
          </Space>
        }
        extra={
          config.length < 30 ? (
            <Button size="small" onClick={addDay}>+ Add Day</Button>
          ) : null
        }
      >
        <Table
          dataSource={config}
          columns={columns}
          rowKey="day_number"
          loading={loadingConfig}
          pagination={false}
          size="small"
          rowClassName={(row) => row.is_special ? 'special-row' : ''}
          style={{ background: 'transparent' }}
        />

        <Divider style={{ borderColor: '#30363d' }} />

        <Space style={{ justifyContent: 'flex-end', width: '100%' }}>
          <Text style={{ color: '#8b949e', fontSize: 12 }}>
            Changes apply immediately for all new claims
          </Text>
          <Button
            type="primary"
            icon={<SaveOutlined />}
            loading={saving}
            onClick={save}
            size="large"
            style={{ background: '#d4af37', borderColor: '#d4af37', color: '#000', fontWeight: 700 }}
          >
            Save Configuration
          </Button>
        </Space>
      </Card>

      <style>{`
        .special-row { background: rgba(212,175,55,0.05) !important; }
        .ant-table { background: transparent !important; }
        .ant-table-thead > tr > th { background: #0d1117 !important; color: #8b949e !important; border-bottom: 1px solid #30363d !important; }
        .ant-table-tbody > tr > td { background: transparent !important; color: #fff !important; border-bottom: 1px solid #1e2533 !important; }
        .ant-table-tbody > tr:hover > td { background: rgba(255,255,255,0.03) !important; }
        .ant-statistic-title { color: #8b949e !important; }
        .ant-card-head { background: transparent !important; border-bottom: 1px solid #30363d !important; }
        .ant-card-head-title { color: #fff !important; }
      `}</style>
    </div>
  )
}
