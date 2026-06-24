import { useEffect, useState } from 'react'
import {
  Card, Form, Switch, InputNumber, Select, Button, Table, Tag,
  Space, Modal, Input, Typography, Divider, Popconfirm, message, Row, Col, DatePicker
} from 'antd'
import { ReloadOutlined } from '@ant-design/icons'
import { adminApi } from '../../api/client'

const { Text } = Typography

export default function Cricket() {
  const [config, setConfig] = useState<any>(null)
  const [loadingConfig, setLoadingConfig] = useState(false)
  const [savingConfig, setSavingConfig] = useState(false)

  const [matches, setMatches] = useState<any[]>([])
  const [loadingMatches, setLoadingMatches] = useState(false)
  const [matchOpen, setMatchOpen] = useState(false)
  const [marketFor, setMarketFor] = useState<any>(null)
  const [mForm] = Form.useForm()
  const [mkForm] = Form.useForm()

  const loadConfig = () => {
    setLoadingConfig(true)
    adminApi.get('/game-configs')
      .then(r => {
        const ckConfig = r.data.find((c: any) => c.game_type === 'cricket')
        setConfig(ckConfig)
      })
      .finally(() => setLoadingConfig(false))
  }

  const saveConfig = async (values: any) => {
    setSavingConfig(true)
    try {
      await adminApi.patch('/game-configs/cricket', values)
      message.success('Cricket configuration saved!')
      loadConfig()
    } catch {
      message.error('Failed to save configuration')
    } finally {
      setSavingConfig(false)
    }
  }

  const loadMatches = () => {
    setLoadingMatches(true)
    adminApi.get('/betting/cricket/matches')
      .then(r => setMatches(r.data.matches || []))
      .finally(() => setLoadingMatches(false))
  }

  const createMatch = async (v: any) => {
    try {
      await adminApi.post('/betting/cricket/match', {
        series: v.series, format: v.format, team_a: v.team_a, team_b: v.team_b,
        team_a_short: v.team_a_short, team_b_short: v.team_b_short,
        start_time: v.start_time.toISOString(),
      })
      message.success('Match added')
      setMatchOpen(false)
      mForm.resetFields()
      loadMatches()
    } catch (e: any) {
      message.error(e?.response?.data?.error || 'Failed to add match')
    }
  }

  const createMarket = async (v: any) => {
    try {
      const options = (v.options as string).split('\n').map(l => l.trim()).filter(Boolean).map(l => {
        const [key, label, odds] = l.split('|').map(s => s.trim())
        return { key, label, odds: Number(odds) }
      })
      await adminApi.post('/betting/cricket/market', {
        match_id: marketFor.id, market_type: v.market_type, label: v.label, options,
      })
      message.success('Market added')
      setMarketFor(null)
      mkForm.resetFields()
      loadMatches()
    } catch (e: any) {
      message.error(e?.response?.data?.error || 'Failed to add market')
    }
  }

  const settle = async (market: any, resultKey: string | null) => {
    try {
      const r = await adminApi.post('/betting/cricket/settle', { market_id: market.id, result_key: resultKey })
      message.success(`Settled — ${r.data.winners} winners, ₹${Number(r.data.paid).toFixed(0)} paid`)
      loadMatches()
    } catch (e: any) {
      message.error(e?.response?.data?.error || 'Settle failed')
    }
  }

  useEffect(() => {
    loadConfig()
    loadMatches()
  }, [])

  return (
    <div>
      <h2 style={{ color: '#d4af37', marginBottom: 24 }}>🏏 Cricket Betting Management</h2>
      <Row gutter={[24, 24]}>
        <Col xs={24} lg={8}>
          <Card title="Cricket Rules & Config" loading={loadingConfig}>
            {config && (
              <Form
                layout="vertical"
                initialValues={{ ...config }}
                onFinish={saveConfig}
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
                  <Button type="primary" htmlType="submit" block loading={savingConfig}>
                    Save Config
                  </Button>
                </Form.Item>
              </Form>
            )}
          </Card>
        </Col>

        <Col xs={24} lg={16}>
          <Card title="Cricket Matches"
            extra={
              <Space>
                <Button type="primary" onClick={() => setMatchOpen(true)}>+ Add Match</Button>
                <Button icon={<ReloadOutlined />} onClick={loadMatches}>Refresh</Button>
              </Space>
            }
            loading={loadingMatches}>
            {matches.map(m => (
              <Card key={m.id} type="inner" style={{ marginBottom: 16 }}
                title={<span>{m.series} · {String(m.format).toUpperCase()} — <b>{m.team_a} vs {m.team_b}</b> <Tag color={m.status === 'settled' ? 'red' : m.status === 'live' ? 'orange' : 'blue'}>{m.status}</Tag></span>}
                extra={<Button size="small" onClick={() => setMarketFor(m)}>+ Market</Button>}>
                <Text type="secondary">{new Date(m.start_time).toLocaleString()}</Text>
                {(m.markets || []).map((mk: any) => (
                  <div key={mk.id} style={{ marginTop: 12 }}>
                    <Divider style={{ margin: '8px 0' }} />
                    <Space wrap>
                      <Text strong>{mk.label}</Text>
                      <Tag color={mk.status === 'settled' ? 'red' : 'green'}>{mk.status}</Tag>
                      {mk.result_key && <Tag color="gold">Result: {mk.result_key}</Tag>}
                    </Space>
                    <div style={{ marginTop: 8 }}>
                      <Space wrap>
                        {(mk.options || []).map((o: any) => (
                          <Popconfirm key={o.key} title={`Settle "${mk.label}" → ${o.label} wins?`}
                            disabled={mk.status === 'settled'} onConfirm={() => settle(mk, o.key)}>
                            <Button size="small" disabled={mk.status === 'settled'}>{o.label} @ {o.odds}</Button>
                          </Popconfirm>
                        ))}
                        <Popconfirm title="Void this market and refund all stakes?"
                          disabled={mk.status === 'settled'} onConfirm={() => settle(mk, null)}>
                          <Button size="small" danger disabled={mk.status === 'settled'}>Void / Refund</Button>
                        </Popconfirm>
                      </Space>
                    </div>
                  </div>
                ))}
              </Card>
            ))}
          </Card>
        </Col>
      </Row>

      <Modal open={matchOpen} title="Add Cricket Match" onCancel={() => setMatchOpen(false)} onOk={() => mForm.submit()} okText="Add">
        <Form form={mForm} layout="vertical" onFinish={createMatch}>
          <Form.Item name="series" label="Series" rules={[{ required: true }]}><Input placeholder="IPL 2026 / ICC T20 World Cup" /></Form.Item>
          <Form.Item name="format" label="Format" rules={[{ required: true }]} initialValue="t20">
            <Select options={['ipl', 't20', 'odi', 'test'].map(f => ({ value: f, label: f.toUpperCase() }))} />
          </Form.Item>
          <Space>
            <Form.Item name="team_a" label="Team A" rules={[{ required: true }]}><Input placeholder="India" /></Form.Item>
            <Form.Item name="team_a_short" label="Short"><Input placeholder="IND" /></Form.Item>
          </Space>
          <Space>
            <Form.Item name="team_b" label="Team B" rules={[{ required: true }]}><Input placeholder="Australia" /></Form.Item>
            <Form.Item name="team_b_short" label="Short"><Input placeholder="AUS" /></Form.Item>
          </Space>
          <Form.Item name="start_time" label="Start Time" rules={[{ required: true }]}><DatePicker showTime style={{ width: '100%' }} /></Form.Item>
        </Form>
      </Modal>

      <Modal open={!!marketFor} title={`Add Market — ${marketFor?.team_a} vs ${marketFor?.team_b}`}
        onCancel={() => setMarketFor(null)} onOk={() => mkForm.submit()} okText="Add Market">
        <Form form={mkForm} layout="vertical" onFinish={createMarket}>
          <Form.Item name="market_type" label="Market Type" rules={[{ required: true }]} initialValue="match_winner">
            <Select options={[
              { value: 'match_winner', label: 'Match Winner' },
              { value: 'toss_winner', label: 'Toss Winner' },
              { value: 'top_batsman', label: 'Top Batsman' },
              { value: 'total_runs', label: 'Total Runs' },
            ]} />
          </Form.Item>
          <Form.Item name="label" label="Question" rules={[{ required: true }]}><Input placeholder="Who will win the match?" /></Form.Item>
          <Form.Item name="options" label="Options (one per line: key|label|odds)" rules={[{ required: true }]}
            tooltip="Example: a|India|1.75">
            <Input.TextArea rows={4} placeholder={'a|India|1.75\nb|Australia|2.05'} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}
