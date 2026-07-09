import { useEffect, useState } from 'react'
import {
  Card, Form, Switch, InputNumber, Select, Button, Table, Tag, Badge,
  Space, message, Divider, Row, Col, Modal, Input, Typography, Popconfirm,
  Statistic, Alert, Progress, Tooltip, Timeline, Tabs
} from 'antd'
import {
  ReloadOutlined, DeleteOutlined, CheckCircleOutlined, ClockCircleOutlined,
  TrophyOutlined, DollarOutlined, FireOutlined, BarChartOutlined, PlusOutlined
} from '@ant-design/icons'
import { adminApi } from '../../api/client'

const { Text, Title } = Typography

// Panna-to-digit calculator helper
function pannaToDigit(panna: string): number {
  if (!/^\d{3}$/.test(panna)) return -1
  return panna.split('').reduce((s, c) => s + parseInt(c), 0) % 10
}

// All valid Pannas grouped by Ank
const ALL_PANNAS: Record<number, string[]> = {}
for (let i = 1; i <= 10; i++) {
  for (let j = i; j <= 10; j++) {
    for (let k = j; k <= 10; k++) {
      const d1 = i === 10 ? 0 : i
      const d2 = j === 10 ? 0 : j
      const d3 = k === 10 ? 0 : k
      const s = `${d1}${d2}${d3}`
      const ank = (d1 + d2 + d3) % 10
      if (!ALL_PANNAS[ank]) ALL_PANNAS[ank] = []
      ALL_PANNAS[ank].push(s)
    }
  }
}

function PannaCalculator({ value, onChange }: { value?: string; onChange?: (v: string) => void }) {
  const digit = value && /^\d{3}$/.test(value) ? pannaToDigit(value) : -1
  return (
    <Space direction="vertical" style={{ width: '100%' }}>
      <Input
        value={value}
        onChange={e => onChange?.(e.target.value)}
        maxLength={3}
        placeholder="e.g. 113"
        style={{ fontFamily: 'monospace', fontSize: 20, textAlign: 'center', letterSpacing: 8 }}
      />
      {digit >= 0 && (
        <Alert
          type="success"
          icon={<CheckCircleOutlined />}
          showIcon
          message={
            <Space>
              <Text>Ank Digit:</Text>
              <Text strong style={{ fontSize: 24, color: '#d4380d' }}>{digit}</Text>
              <Divider type="vertical" />
              <Text type="secondary">Valid pannas for ank {digit}:</Text>
              <Text code>{ALL_PANNAS[digit]?.join(', ')}</Text>
            </Space>
          }
        />
      )}
    </Space>
  )
}

export default function Matka() {
  const [config, setConfig] = useState<any>(null)
  const [loadingConfig, setLoadingConfig] = useState(false)
  const [savingConfig, setSavingConfig] = useState(false)

  const [draws, setDraws] = useState<any[]>([])
  const [loadingDraws, setLoadingDraws] = useState(false)
  const [declareFor, setDeclareFor] = useState<any>(null)
  const [declaring, setDeclaring] = useState(false)
  const [form] = Form.useForm()

  const [markets, setMarkets] = useState<any[]>([])
  const [loadingMarkets, setLoadingMarkets] = useState(false)
  const [showCreateMarket, setShowCreateMarket] = useState(false)
  const [submittingMarket, setSubmittingMarket] = useState(false)
  const [marketForm] = Form.useForm()

  const [bets, setBets] = useState<any[]>([])
  const [loadingBets, setLoadingBets] = useState(false)
  const [selectedDraw, setSelectedDraw] = useState<string | null>(null)

  // Derived stats from draws
  const stats = {
    total: draws.length,
    open: draws.filter(d => d.status === 'open').length,
    declared: draws.filter(d => d.status === 'open_declared').length,
    settled: draws.filter(d => d.status === 'settled').length,
    totalStaked: draws.reduce((s, d) => s + Number(d.total_staked || 0), 0),
    totalBets: draws.reduce((s, d) => s + Number(d.bet_count || 0), 0),
  }

  const loadConfig = () => {
    setLoadingConfig(true)
    adminApi.get('/game-configs')
      .then(r => {
        const mkConfig = r.data.find((c: any) => c.game_type === 'matka')
        setConfig(mkConfig)
      })
      .finally(() => setLoadingConfig(false))
  }

  const saveConfig = async (values: any) => {
    setSavingConfig(true)
    try {
      await adminApi.patch('/game-configs/matka', values)
      message.success('Matka configuration saved!')
      loadConfig()
    } catch {
      message.error('Failed to save configuration')
    } finally {
      setSavingConfig(false)
    }
  }

  const loadDraws = () => {
    setLoadingDraws(true)
    adminApi.get('/betting/matka/draws')
      .then(r => setDraws(r.data.draws || []))
      .finally(() => setLoadingDraws(false))
  }

  const loadMarkets = () => {
    setLoadingMarkets(true)
    adminApi.get('/betting/matka/markets')
      .then(r => setMarkets(r.data.markets || []))
      .catch(() => message.error('Failed to load markets'))
      .finally(() => setLoadingMarkets(false))
  }

  const loadBetsForDraw = (drawId: string) => {
    setLoadingBets(true)
    setSelectedDraw(drawId)
    adminApi.get(`/betting/matka/draws/${drawId}/bets`)
      .then(r => setBets(r.data.bets || []))
      .catch(() => message.error('Failed to load bets'))
      .finally(() => setLoadingBets(false))
  }

  const createMarket = async (values: any) => {
    setSubmittingMarket(true)
    try {
      await adminApi.post('/betting/matka/markets', values)
      message.success('Matka market created successfully!')
      setShowCreateMarket(false)
      marketForm.resetFields()
      loadMarkets()
    } catch (e: any) {
      message.error(e?.response?.data?.error || 'Failed to create market')
    } finally {
      setSubmittingMarket(false)
    }
  }

  const deleteMarket = async (id: number) => {
    try {
      await adminApi.delete(`/betting/matka/markets/${id}`)
      message.success('Market and all associated draws deleted successfully')
      loadMarkets()
      loadDraws()
    } catch (e: any) {
      message.error(e?.response?.data?.error || 'Failed to delete market')
    }
  }

  const declare = async (values: any) => {
    setDeclaring(true)
    try {
      const r = await adminApi.post('/betting/matka/declare', {
        draw_id: declareFor.id, session: values.session, panna: values.panna,
      })
      const digit = pannaToDigit(values.panna)
      message.success({
        content: (
          <Space direction="vertical">
            <Text strong>✅ Result Declared!</Text>
            <Text>Panna: <Text code>{values.panna}</Text> → Ank: <Text strong style={{ color: '#d4380d', fontSize: 18 }}>{digit}</Text></Text>
            <Text>Settled: {r.data.settled} bets | Winners: {r.data.winners} 🏆</Text>
          </Space>
        ),
        duration: 6,
      })
      setDeclareFor(null)
      form.resetFields()
      loadDraws()
    } catch (e: any) {
      message.error(e?.response?.data?.error || 'Declare failed')
    } finally {
      setDeclaring(false)
    }
  }

  useEffect(() => {
    loadConfig()
    loadDraws()
    loadMarkets()
    // Auto-refresh every 30 seconds
    const interval = setInterval(() => { loadDraws() }, 30000)
    return () => clearInterval(interval)
  }, [])

  const drawColumns = [
    { title: 'Market', dataIndex: 'market_name', width: 140 },
    {
      title: 'Status', dataIndex: 'status', width: 130,
      render: (s: string) => {
        const map: Record<string, { color: string; label: string; icon: any }> = {
          open: { color: 'blue', label: 'Open', icon: <ClockCircleOutlined /> },
          open_declared: { color: 'orange', label: 'Open Declared', icon: <FireOutlined /> },
          settled: { color: 'green', label: 'Settled', icon: <CheckCircleOutlined /> },
        }
        const cfg = map[s] || { color: 'default', label: s, icon: null }
        return <Tag icon={cfg.icon} color={cfg.color}>{cfg.label}</Tag>
      }
    },
    {
      title: 'Open Result', width: 110,
      render: (_: any, d: any) => d.open_panna
        ? <Space><Text code>{d.open_panna}</Text><Text strong style={{ color: '#d4380d' }}>{d.open_digit}</Text></Space>
        : <Text type="secondary">—</Text>
    },
    {
      title: 'Close Result', width: 110,
      render: (_: any, d: any) => d.close_panna
        ? <Space><Text strong style={{ color: '#d4380d' }}>{d.close_digit}</Text><Text code>{d.close_panna}</Text></Space>
        : <Text type="secondary">—</Text>
    },
    {
      title: 'Jodi', dataIndex: 'jodi', width: 70,
      render: (j: string) => j ? <Text strong style={{ fontSize: 16, color: '#722ed1' }}>{j}</Text> : <Text type="secondary">—</Text>
    },
    {
      title: 'Bets / Staked', width: 120,
      render: (_: any, d: any) => (
        <Space direction="vertical" size={0}>
          <Text>{d.bet_count || 0} bets</Text>
          <Text type="secondary" style={{ fontSize: 11 }}>₹{Number(d.total_staked || 0).toFixed(0)}</Text>
        </Space>
      )
    },
    {
      title: 'Actions', width: 150,
      render: (_: any, d: any) => (
        <Space>
          <Tooltip title="View Bets">
            <Button
              type="text" size="small" icon={<BarChartOutlined />}
              onClick={() => loadBetsForDraw(d.id)}
            />
          </Tooltip>
          <Button
            type="primary" size="small"
            disabled={d.status === 'settled'}
            onClick={() => { setDeclareFor(d); form.setFieldValue('session', d.status === 'open_declared' ? 'close' : 'open') }}
            style={d.status === 'open_declared' ? { background: '#fa8c16', border: 'none' } : {}}
          >
            {d.status === 'open_declared' ? 'Declare Close' : 'Declare Open'}
          </Button>
        </Space>
      ),
    },
  ]

  const betColumns = [
    { title: 'User', dataIndex: 'username', width: 120 },
    {
      title: 'Type', dataIndex: 'bet_type', width: 130,
      render: (t: string) => {
        const colors: Record<string, string> = {
          single: 'blue', jodi: 'purple', single_panna: 'cyan',
          double_panna: 'magenta', triple_panna: 'red',
          half_sangam_a: 'orange', half_sangam_b: 'gold', full_sangam: 'lime',
        }
        return <Tag color={colors[t] || 'default'}>{t.replace(/_/g, ' ').toUpperCase()}</Tag>
      }
    },
    { title: 'Number', dataIndex: 'number', render: (n: string) => <Text code style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 14 }}>{n}</Text> },
    { title: 'Session', dataIndex: 'session', render: (s: string) => <Tag>{s}</Tag> },
    { title: 'Stake', dataIndex: 'amount', render: (v: any) => `₹${Number(v).toFixed(2)}` },
    { title: 'Potential', dataIndex: 'potential_payout', render: (v: any) => <Text style={{ color: '#52c41a' }}>₹{Number(v).toFixed(2)}</Text> },
    {
      title: 'Status', dataIndex: 'status',
      render: (s: string) => (
        <Tag color={s === 'won' ? 'gold' : s === 'lost' ? 'red' : 'blue'}>
          {s === 'won' ? '🏆 Won' : s === 'lost' ? 'Lost' : 'Pending'}
        </Tag>
      )
    },
    {
      title: 'Payout', dataIndex: 'payout',
      render: (v: any) => v ? <Text strong style={{ color: '#d4380d' }}>₹{Number(v).toFixed(2)}</Text> : '—'
    },
  ]

  return (
    <div>
      <Space align="center" style={{ marginBottom: 24 }}>
        <Title level={3} style={{ color: '#d4af37', margin: 0 }}>🎯 Satta Matka Management</Title>
        <Badge count={stats.open + stats.declared} color="#fa8c16" offset={[0, 0]}>
          <Tag color="orange">Live Draws</Tag>
        </Badge>
      </Space>

      {/* Live Stats Row */}
      <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
        {[
          { title: "Today's Draws", value: stats.total, icon: <FireOutlined />, color: '#1677ff' },
          { title: 'Open', value: stats.open, icon: <ClockCircleOutlined />, color: '#fa8c16' },
          { title: 'Open Declared', value: stats.declared, icon: <BarChartOutlined />, color: '#722ed1' },
          { title: 'Settled', value: stats.settled, icon: <CheckCircleOutlined />, color: '#52c41a' },
          { title: 'Total Bets', value: stats.totalBets, icon: <TrophyOutlined />, color: '#13c2c2' },
          { title: 'Total Staked', value: `₹${stats.totalStaked.toFixed(0)}`, icon: <DollarOutlined />, color: '#eb2f96' },
        ].map(s => (
          <Col xs={12} sm={8} md={4} key={s.title}>
            <Card size="small" style={{ borderLeft: `3px solid ${s.color}` }}>
              <Statistic title={s.title} value={s.value} prefix={<span style={{ color: s.color }}>{s.icon}</span>} valueStyle={{ fontSize: 20 }} />
            </Card>
          </Col>
        ))}
      </Row>

      <Row gutter={[24, 24]}>
        {/* Left: Config */}
        <Col xs={24} lg={7}>
          <Space direction="vertical" size={16} style={{ width: '100%' }}>
            <Card title="⚙️ Game Config" loading={loadingConfig} size="small">
              {config && (
                <Form layout="vertical" initialValues={{ ...config }} onFinish={saveConfig} size="small">
                  <Form.Item name="is_active" label="Game Active" valuePropName="checked">
                    <Switch checkedChildren="ON" unCheckedChildren="OFF" />
                  </Form.Item>
                  <Form.Item name="rake_percent" label="Rake %">
                    <InputNumber min={0} max={20} step={0.5} suffix="%" style={{ width: '100%' }} />
                  </Form.Item>
                  <Divider>Bot Settings</Divider>
                  <Form.Item name="bot_fill_enabled" label="Bot Fill" valuePropName="checked">
                    <Switch checkedChildren="Yes" unCheckedChildren="No" />
                  </Form.Item>
                  <Form.Item name="bot_fill_delay_seconds" label="Delay (sec)">
                    <InputNumber min={5} max={60} style={{ width: '100%' }} />
                  </Form.Item>
                  <Form.Item name="max_bot_ratio" label="Max Bot Ratio">
                    <InputNumber min={0} max={1} step={0.1} style={{ width: '100%' }} />
                  </Form.Item>
                  <Form.Item>
                    <Button type="primary" htmlType="submit" block loading={savingConfig}>Save Config</Button>
                  </Form.Item>
                </Form>
              )}
            </Card>

            {/* Bet type breakdown if a draw is selected */}
            {selectedDraw && (
              <Card title="📊 Bet Type Breakdown" size="small" loading={loadingBets}>
                {(() => {
                  const types = ['single', 'jodi', 'single_panna', 'double_panna', 'triple_panna', 'half_sangam_a', 'half_sangam_b', 'full_sangam']
                  return types.map(t => {
                    const count = bets.filter(b => b.bet_type === t).length
                    const total = bets.length || 1
                    return count > 0 ? (
                      <div key={t} style={{ marginBottom: 8 }}>
                        <Space style={{ width: '100%', justifyContent: 'space-between' }}>
                          <Text style={{ fontSize: 11 }}>{t.replace(/_/g, ' ')}</Text>
                          <Text strong>{count}</Text>
                        </Space>
                        <Progress percent={Math.round(count / total * 100)} size="small" showInfo={false} />
                      </div>
                    ) : null
                  })
                })()}
              </Card>
            )}
          </Space>
        </Col>

        {/* Right: Markets + Draws + Bets */}
        <Col xs={24} lg={17}>
          <Tabs
            defaultActiveKey="draws"
            items={[
              {
                key: 'draws',
                label: <Space><FireOutlined />Today's Draws</Space>,
                children: (
                  <Card
                    extra={<Button icon={<ReloadOutlined />} size="small" onClick={loadDraws}>Refresh</Button>}
                    loading={loadingDraws}
                    style={{ marginBottom: 16 }}
                  >
                    <Table
                      rowKey="id"
                      dataSource={draws}
                      columns={drawColumns}
                      pagination={false}
                      size="small"
                      scroll={{ x: 800 }}
                      rowClassName={(d: any) => d.status === 'open' ? 'draw-row-active' : ''}
                    />
                    {bets.length > 0 && (
                      <>
                        <Divider>Bets for selected draw</Divider>
                        <Table
                          rowKey="id"
                          dataSource={bets}
                          columns={betColumns}
                          size="small"
                          scroll={{ x: 900 }}
                          pagination={{ pageSize: 15 }}
                          loading={loadingBets}
                        />
                      </>
                    )}
                  </Card>
                ),
              },
              {
                key: 'markets',
                label: <Space><BarChartOutlined />Markets</Space>,
                children: (
                  <Card
                    extra={
                      <Space>
                        <Button type="primary" size="small" icon={<PlusOutlined />} onClick={() => setShowCreateMarket(true)}>New Market</Button>
                        <Button icon={<ReloadOutlined />} size="small" onClick={loadMarkets}>Refresh</Button>
                      </Space>
                    }
                    loading={loadingMarkets}
                  >
                    <Table
                      rowKey="id"
                      dataSource={markets}
                      pagination={false}
                      size="small"
                      columns={[
                        { title: 'Market Name', dataIndex: 'name', render: (n: string) => <Text strong>{n}</Text> },
                        { title: 'Open Time', dataIndex: 'open_time' },
                        { title: 'Close Time', dataIndex: 'close_time' },
                        { title: 'Sort', dataIndex: 'sort_order' },
                        {
                          title: 'Status', dataIndex: 'is_active',
                          render: (v: boolean) => <Tag color={v ? 'green' : 'red'}>{v ? 'Active' : 'Inactive'}</Tag>
                        },
                        {
                          title: 'Action',
                          render: (_: any, m: any) => (
                            <Popconfirm
                              title="Delete Market"
                              description="Delete this market and all associated draws/bets?"
                              onConfirm={() => deleteMarket(m.id)}
                              okText="Yes, Delete"
                              cancelText="No"
                              okButtonProps={{ danger: true }}
                            >
                              <Button danger type="text" size="small" icon={<DeleteOutlined />}>Delete</Button>
                            </Popconfirm>
                          ),
                        },
                      ]}
                    />
                  </Card>
                ),
              },
              {
                key: 'chart',
                label: <Space><TrophyOutlined />Panel Chart Guide</Space>,
                children: (
                  <Card title="How to Read Satta Matka Results">
                    <Timeline
                      items={[
                        { color: 'blue', children: <><Text strong>Open Session</Text><br /><Text type="secondary">Declare the Open Panna (3 digits). The Open Ank is auto-calculated as (sum % 10). Settles Single (open) and Panna (open) bets.</Text></> },
                        { color: 'orange', children: <><Text strong>Close Session</Text><br /><Text type="secondary">Declare the Close Panna (3 digits). Settles: Jodi (Open Ank + Close Ank), Single (close), Panna (close), Half Sangam A/B, Full Sangam.</Text></> },
                        { color: 'green', children: <><Text strong>Payouts</Text><br /><Text type="secondary">Winners are automatically credited via wallet. Multipliers: Single 9.5x, Jodi 95x, Panna 142-950x, Sangam 1000-10000x.</Text></> },
                      ]}
                    />
                    <Divider>Multiplier Table</Divider>
                    <Table
                      size="small"
                      pagination={false}
                      dataSource={[
                        { type: 'Single (Ank)', mult: '9.5x', note: 'Single digit 0-9' },
                        { type: 'Jodi', mult: '95x', note: 'Two digit combo 00-99' },
                        { type: 'Single Panna', mult: '142x', note: '3 unique digits' },
                        { type: 'Double Panna', mult: '285x', note: '2 matching digits' },
                        { type: 'Triple Panna', mult: '950x', note: '3 matching digits (000,111...)' },
                        { type: 'Half Sangam A', mult: '1,000x', note: 'Open Panna + Close Ank' },
                        { type: 'Half Sangam B', mult: '1,000x', note: 'Open Ank + Close Panna' },
                        { type: 'Full Sangam', mult: '10,000x', note: 'Open Panna + Close Panna' },
                      ]}
                      columns={[
                        { title: 'Bet Type', dataIndex: 'type' },
                        { title: 'Multiplier', dataIndex: 'mult', render: v => <Text strong style={{ color: '#52c41a' }}>{v}</Text> },
                        { title: 'Format', dataIndex: 'note' },
                      ]}
                    />
                  </Card>
                ),
              },
            ]}
          />
        </Col>
      </Row>

      {/* Create Market Modal */}
      <Modal
        open={showCreateMarket}
        title="➕ Create Matka Market"
        onCancel={() => setShowCreateMarket(false)}
        onOk={() => marketForm.submit()}
        okText="Create Market"
        confirmLoading={submittingMarket}
      >
        <Form form={marketForm} layout="vertical" onFinish={createMarket}>
          <Form.Item name="name" label="Market Name" rules={[{ required: true }]}>
            <Input placeholder="e.g. Kalyan Night" />
          </Form.Item>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="open_time" label="Open Time" rules={[{ required: true }]}>
                <Input placeholder="e.g. 21:00:00" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="close_time" label="Close Time" rules={[{ required: true }]}>
                <Input placeholder="e.g. 23:00:00" />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="sort_order" label="Sort Order" initialValue={0}>
            <InputNumber min={0} style={{ width: '100%' }} />
          </Form.Item>
        </Form>
      </Modal>

      {/* Declare Result Modal — Enhanced */}
      <Modal
        open={!!declareFor}
        title={
          <Space>
            <FireOutlined style={{ color: '#fa8c16' }} />
            <span>Declare Result — <Text style={{ color: '#d4af37' }}>{declareFor?.market_name}</Text></span>
          </Space>
        }
        onCancel={() => { setDeclareFor(null); form.resetFields() }}
        onOk={() => form.submit()}
        okText="🎯 Confirm Declare"
        confirmLoading={declaring}
        width={520}
      >
        {declareFor && (
          <Space direction="vertical" style={{ width: '100%' }}>
            <Alert
              message={
                <Space>
                  <Text>Draw status:</Text>
                  <Tag color={declareFor.status === 'open' ? 'blue' : 'orange'}>{declareFor.status}</Tag>
                  <Text type="secondary">{declareFor.bet_count} bets • ₹{Number(declareFor.total_staked || 0).toFixed(0)} staked</Text>
                </Space>
              }
              type="info"
              showIcon
            />
            <Form form={form} layout="vertical" onFinish={declare}>
              <Form.Item name="session" label="Session" rules={[{ required: true }]}>
                <Select
                  options={[
                    { value: 'open', label: '🌅 Open Session', disabled: declareFor.status === 'open_declared' || declareFor.status === 'settled' },
                    { value: 'close', label: '🌙 Close Session', disabled: declareFor.status === 'open' },
                  ]}
                />
              </Form.Item>
              <Form.Item
                name="panna"
                label="Winning Panna (3 digits)"
                rules={[
                  { required: true, message: 'Enter 3 digits' },
                  { pattern: /^\d{3}$/, message: 'Must be exactly 3 digits' },
                ]}
              >
                <PannaCalculator />
              </Form.Item>
              <Alert
                type="warning"
                showIcon
                message="⚠️ This action cannot be undone. All bets will be settled immediately and winners credited."
              />
            </Form>
          </Space>
        )}
      </Modal>
    </div>
  )
}
