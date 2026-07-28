import { useEffect, useState } from 'react'
import {
  Card, Form, Switch, InputNumber, Button, message, Divider, Row, Col, Tag,
  Statistic, Table
} from 'antd'
import { adminApi } from '../../api/client'

function AviatorPnl() {
  const [pnl, setPnl] = useState<any>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    setLoading(true)
    adminApi.get('/aviator/pnl').then(r => setPnl(r.data)).finally(() => setLoading(false))
  }, [])

  const card = (title: string, data: any) => (
    <Col xs={24} sm={12} lg={6}>
      <Card size="small" loading={loading}>
        <Statistic
          title={title}
          value={data?.pnl ?? 0}
          precision={2}
          prefix="₹"
          valueStyle={{ color: (data?.pnl ?? 0) >= 0 ? '#52c41a' : '#f5222d' }}
        />
        <div style={{ fontSize: 12, color: '#888', marginTop: 4 }}>
          Staked ₹{(data?.staked ?? 0).toLocaleString()} · Paid ₹{(data?.paid_out ?? 0).toLocaleString()} · {data?.bets ?? 0} bets / {data?.rounds ?? 0} rounds
        </div>
      </Card>
    </Col>
  )

  return (
    <Row gutter={[16, 16]}>
      {card('Today', pnl?.daily)}
      {card('This Week', pnl?.weekly)}
      {card('This Month', pnl?.monthly)}
      {card('All Time', pnl?.all_time)}
    </Row>
  )
}

function AviatorHistory() {
  const [rows, setRows] = useState<any[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)
  const limit = 20

  const load = (p: number) => {
    setLoading(true)
    adminApi.get('/aviator/history', { params: { page: p, limit } })
      .then(r => { setRows(r.data.rounds); setTotal(r.data.total) })
      .finally(() => setLoading(false))
  }

  useEffect(() => { load(page) }, [page])

  return (
    <Table
      dataSource={rows}
      rowKey="round_id"
      loading={loading}
      size="small"
      pagination={{ current: page, pageSize: limit, total, onChange: setPage }}
      columns={[
        { title: 'Round Started', dataIndex: 'started_at', render: (v: string) => new Date(v).toLocaleString() },
        { title: 'Crash', dataIndex: 'crash_at', render: (v: string) => `${parseFloat(v).toFixed(2)}x` },
        { title: 'Bets', dataIndex: 'bets' },
        { title: 'Staked (₹)', dataIndex: 'staked', render: (v: number) => v.toLocaleString() },
        { title: 'Paid Out (₹)', dataIndex: 'paid_out', render: (v: number) => v.toLocaleString() },
        {
          title: 'PnL (₹)', dataIndex: 'pnl', render: (v: number) => (
            <span style={{ color: v >= 0 ? '#52c41a' : '#f5222d', fontWeight: 'bold' }}>
              {v >= 0 ? '+' : ''}{v.toLocaleString()}
            </span>
          )
        },
      ]}
    />
  )
}

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

      <Divider>PnL</Divider>
      <AviatorPnl />

      <Divider>Game History</Divider>
      <Card>
        <AviatorHistory />
      </Card>
    </div>
  )
}
