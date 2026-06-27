import { useEffect, useState } from 'react'
import {
  Tabs, Card, Table, Button, Modal, Form, Input, InputNumber, DatePicker,
  Select, Space, Tag, message, Popconfirm, Typography, Divider, Row, Col,
} from 'antd'
import { PlusOutlined, DeleteOutlined } from '@ant-design/icons'
import { adminApi } from '../api/client'
import { useAuthStore } from '../store/auth'

const { Text } = Typography

// ─────────────────────────── MATKA ───────────────────────────
function MatkaTab() {
  const { admin } = useAuthStore()
  const isSuper = admin?.role === 'superadmin'

  const [draws, setDraws] = useState<any[]>([])
  const [markets, setMarkets] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [loadingMarkets, setLoadingMarkets] = useState(false)
  const [declareFor, setDeclareFor] = useState<any>(null)
  const [createMarketOpen, setCreateMarketOpen] = useState(false)
  const [form] = Form.useForm()
  const [marketForm] = Form.useForm()

  const loadDraws = () => {
    setLoading(true)
    adminApi.get('/betting/matka/draws')
      .then(r => setDraws(r.data.draws || []))
      .finally(() => setLoading(false))
  }

  const loadMarkets = () => {
    setLoadingMarkets(true)
    adminApi.get('/betting/matka/markets')
      .then(r => setMarkets(r.data.markets || []))
      .finally(() => setLoadingMarkets(false))
  }

  useEffect(() => {
    loadDraws()
    loadMarkets()
  }, [])

  const declare = async (values: any) => {
    try {
      const r = await adminApi.post('/betting/matka/declare', {
        draw_id: declareFor.id, session: values.session, panna: values.panna,
      })
      message.success(`Declared — settled ${r.data.settled}, winners ${r.data.winners}`)
      setDeclareFor(null); form.resetFields(); loadDraws()
    } catch (e: any) {
      message.error(e?.response?.data?.error || 'Declare failed')
    }
  }

  const handleCreateMarket = async (values: any) => {
    try {
      await adminApi.post('/betting/matka/markets', {
        name: values.name,
        open_time: values.open_time,
        close_time: values.close_time,
        sort_order: values.sort_order || 0
      })
      message.success('Market created successfully')
      setCreateMarketOpen(false)
      marketForm.resetFields()
      loadMarkets()
      loadDraws()
    } catch (e: any) {
      message.error(e?.response?.data?.error || 'Failed to create market')
    }
  }

  const handleDeleteMarket = async (id: string) => {
    try {
      await adminApi.delete(`/betting/matka/markets/${id}`)
      message.success('Market deleted successfully')
      loadMarkets()
      loadDraws()
    } catch (e: any) {
      message.error(e?.response?.data?.error || 'Failed to delete market')
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <Row gutter={[24, 24]}>
        {/* Left Column: Draws */}
        <Col xs={24} lg={15}>
          <Card title="Today's Matka Draws" extra={<Button onClick={loadDraws}>Refresh Draws</Button>} loading={loading}>
            <Table rowKey="id" dataSource={draws} pagination={false} size="small" columns={[
              { title: 'Market', dataIndex: 'market_name' },
              { title: 'Status', dataIndex: 'status', render: (s: string) => <Tag color={s === 'settled' ? 'red' : 'green'}>{s}</Tag> },
              { title: 'Open', render: (_: any, d: any) => d.open_panna ? `${d.open_panna}-${d.open_digit}` : '—' },
              { title: 'Close', render: (_: any, d: any) => d.close_panna ? `${d.close_digit}-${d.close_panna}` : '—' },
              { title: 'Jodi', dataIndex: 'jodi', render: (j: string) => j || '—' },
              { title: 'Bets', dataIndex: 'bet_count' },
              { title: 'Staked', dataIndex: 'total_staked', render: (v: any) => `₹${Number(v || 0).toFixed(0)}` },
              {
                title: 'Action', render: (_: any, d: any) => (
                  <Button type="primary" size="small" disabled={d.status === 'settled'}
                    onClick={() => setDeclareFor(d)}>Declare</Button>
                ),
              },
            ]} />
          </Card>
        </Col>

        {/* Right Column: Markets */}
        <Col xs={24} lg={9}>
          <Card 
            title="Matka Markets" 
            extra={
              <Space>
                {isSuper && (
                  <Button type="primary" size="small" icon={<PlusOutlined />} onClick={() => setCreateMarketOpen(true)}>
                    Add Market
                  </Button>
                )}
                <Button onClick={loadMarkets} size="small">Refresh</Button>
              </Space>
            } 
            loading={loadingMarkets}
          >
            <Table rowKey="id" dataSource={markets} pagination={false} size="small" columns={[
              { title: 'Name', dataIndex: 'name', render: (name: string) => <b>{name}</b> },
              { title: 'Timings', render: (_: any, m: any) => `${m.open_time?.slice(0,5)} - ${m.close_time?.slice(0,5)}` },
              {
                title: 'Action', render: (_: any, m: any) => isSuper && (
                  <Popconfirm 
                    title="Delete Market?" 
                    description="This will delete the market and all its draws and bets permanently!"
                    onConfirm={() => handleDeleteMarket(m.id)}
                    okText="Yes"
                    cancelText="No"
                    okButtonProps={{ danger: true }}
                  >
                    <Button danger size="small" icon={<DeleteOutlined />} type="text" />
                  </Popconfirm>
                )
              }
            ]} />
          </Card>
        </Col>
      </Row>

      <Modal open={!!declareFor} title={`Declare result — ${declareFor?.market_name}`}
        onCancel={() => setDeclareFor(null)} onOk={() => form.submit()} okText="Declare">
        <Form form={form} layout="vertical" onFinish={declare}>
          <Form.Item name="session" label="Session" rules={[{ required: true }]} initialValue="open">
            <Select options={[{ value: 'open', label: 'Open' }, { value: 'close', label: 'Close' }]} />
          </Form.Item>
          <Form.Item name="panna" label="Panna (3 digits)" rules={[{ required: true, pattern: /^[0-9]{3}$/, message: 'Enter 3 digits' }]}>
            <Input maxLength={3} placeholder="e.g. 123" />
          </Form.Item>
          <Text type="secondary">The digit is derived as (sum of panna digits) mod 10. Close also settles all Jodi bets.</Text>
        </Form>
      </Modal>

      <Modal open={createMarketOpen} title="Create Matka Market" onCancel={() => setCreateMarketOpen(false)} onOk={() => marketForm.submit()} okText="Create">
        <Form form={marketForm} layout="vertical" onFinish={handleCreateMarket}>
          <Form.Item name="name" label="Market Name" rules={[{ required: true }]}><Input placeholder="e.g. Kalyan Night" /></Form.Item>
          <Form.Item name="open_time" label="Open Time (HH:mm:ss)" rules={[{ required: true, pattern: /^([0-1]?[0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$/, message: 'Enter valid time format e.g. 14:00:00' }]} initialValue="14:00:00">
            <Input placeholder="e.g. 14:00:00" />
          </Form.Item>
          <Form.Item name="close_time" label="Close Time (HH:mm:ss)" rules={[{ required: true, pattern: /^([0-1]?[0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$/, message: 'Enter valid time format e.g. 16:00:00' }]} initialValue="16:00:00">
            <Input placeholder="e.g. 16:00:00" />
          </Form.Item>
          <Form.Item name="sort_order" label="Sort Order" initialValue={1}><InputNumber min={1} style={{ width: '100%' }} /></Form.Item>
        </Form>
      </Modal>
    </div>
  )
}

// ─────────────────────────── LOTTERY ───────────────────────────
function LotteryTab() {
  const { admin } = useAuthStore()
  const isSuper = admin?.role === 'superadmin'

  const [draws, setDraws] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [drawFor, setDrawFor] = useState<any>(null)
  const [cForm] = Form.useForm()
  const [dForm] = Form.useForm()

  const load = () => {
    setLoading(true)
    adminApi.get('/betting/lottery/draws')
      .then(r => setDraws(r.data.draws || []))
      .finally(() => setLoading(false))
  }
  useEffect(load, [])

  const create = async (v: any) => {
    try {
      await adminApi.post('/betting/lottery/create', {
        name: v.name, ticket_price: v.ticket_price, digits: v.digits,
        prize_multiplier: v.prize_multiplier, draw_time: v.draw_time.toISOString(),
      })
      message.success('Draw created'); setCreateOpen(false); cForm.resetFields(); load()
    } catch (e: any) { message.error(e?.response?.data?.error || 'Create failed') }
  }

  const declare = async (v: any) => {
    try {
      const r = await adminApi.post('/betting/lottery/draw', {
        draw_id: drawFor.id, winning_number: v.winning_number,
      })
      message.success(`Drawn — ${r.data.winners}/${r.data.tickets} winners, ₹${Number(r.data.paid).toFixed(0)} paid`)
      setDrawFor(null); dForm.resetFields(); load()
    } catch (e: any) { message.error(e?.response?.data?.error || 'Draw failed') }
  }

  const handleDeleteLottery = async (id: string) => {
    try {
      await adminApi.delete(`/betting/lottery/draws/${id}`)
      message.success('Lottery draw deleted successfully')
      load()
    } catch (e: any) {
      message.error(e?.response?.data?.error || 'Failed to delete lottery draw')
    }
  }

  return (
    <Card title="Lottery Draws"
      extra={<Space><Button type="primary" onClick={() => setCreateOpen(true)}>+ New Draw</Button><Button onClick={load}>Refresh</Button></Space>}
      loading={loading}>
      <Table rowKey="id" dataSource={draws} columns={[
        { title: 'Name', dataIndex: 'name' },
        { title: 'Ticket', dataIndex: 'ticket_price', render: (v: any) => `₹${Number(v).toFixed(0)}` },
        { title: 'Digits', dataIndex: 'digits' },
        { title: 'Multiplier', dataIndex: 'prize_multiplier', render: (v: any) => `${Number(v).toFixed(0)}x` },
        { title: 'Tickets', dataIndex: 'ticket_count' },
        { title: 'Draw Time', dataIndex: 'draw_time', render: (v: string) => new Date(v).toLocaleString() },
        { title: 'Status', dataIndex: 'status', render: (s: string) => <Tag color={s === 'settled' ? 'red' : 'green'}>{s}</Tag> },
        { title: 'Winning #', dataIndex: 'winning_number', render: (v: string) => v || '—' },
        {
          title: 'Action', render: (_: any, d: any) => (
            <Space>
              <Button type="primary" size="small" disabled={d.status === 'settled'}
                onClick={() => setDrawFor(d)}>Declare Winner</Button>
              {isSuper && (
                <Popconfirm
                  title="Delete Draw?"
                  description="Delete this lottery draw and all its tickets permanently?"
                  onConfirm={() => handleDeleteLottery(d.id)}
                  okText="Yes"
                  cancelText="No"
                  okButtonProps={{ danger: true }}
                >
                  <Button danger size="small" icon={<DeleteOutlined />} type="text" />
                </Popconfirm>
              )}
            </Space>
          ),
        },
      ]} />

      <Modal open={createOpen} title="Create Lottery Draw" onCancel={() => setCreateOpen(false)} onOk={() => cForm.submit()} okText="Create">
        <Form form={cForm} layout="vertical" onFinish={create}>
          <Form.Item name="name" label="Name" rules={[{ required: true }]}><Input placeholder="Daily Lucky Draw" /></Form.Item>
          <Form.Item name="ticket_price" label="Ticket Price (₹)" rules={[{ required: true }]} initialValue={10}><InputNumber min={1} style={{ width: '100%' }} /></Form.Item>
          <Form.Item name="digits" label="Number Length (digits)" initialValue={4}><InputNumber min={1} max={8} style={{ width: '100%' }} /></Form.Item>
          <Form.Item name="prize_multiplier" label="Prize Multiplier" initialValue={1000} rules={[{ required: true }]}><InputNumber min={1} style={{ width: '100%' }} /></Form.Item>
          <Form.Item name="draw_time" label="Draw Time" rules={[{ required: true }]}><DatePicker showTime style={{ width: '100%' }} /></Form.Item>
        </Form>
      </Modal>

      <Modal open={!!drawFor} title={`Declare winner — ${drawFor?.name}`} onCancel={() => setDrawFor(null)} onOk={() => dForm.submit()} okText="Declare">
        <Form form={dForm} layout="vertical" onFinish={declare}>
          <Form.Item name="winning_number" label={`Winning Number (${drawFor?.digits} digits)`} rules={[{ required: true }]}>
            <Input maxLength={drawFor?.digits} placeholder="e.g. 4271" />
          </Form.Item>
          <Text type="warning">This settles all tickets and pays winners immediately. It cannot be undone.</Text>
        </Form>
      </Modal>
    </Card>
  )
}

// ─────────────────────────── CRICKET ───────────────────────────
function CricketTab() {
  const [matches, setMatches] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [syncLoading, setSyncLoading] = useState(false)
  const [matchOpen, setMatchOpen] = useState(false)
  const [marketFor, setMarketFor] = useState<any>(null)
  const [sessionFor, setSessionFor] = useState<any>(null)
  const [mForm] = Form.useForm()
  const [mkForm] = Form.useForm()
  const [sForm] = Form.useForm()

  const load = () => {
    setLoading(true)
    adminApi.get('/betting/cricket/matches')
      .then(r => setMatches(r.data.matches || []))
      .finally(() => setLoading(false))
  }
  useEffect(load, [])

  const handleSync = async () => {
    setSyncLoading(true)
    try {
      const r = await adminApi.post('/betting/cricket/sync-api')
      message.success(`Sync Complete: ${r.data.inserted} new, ${r.data.updated} updated`)
      load()
    } catch (e: any) {
      message.error(e?.response?.data?.error || 'Sync failed')
    } finally {
      setSyncLoading(false)
    }
  }

  const syncCountries = async () => {
    try {
      const r = await adminApi.post('/betting/cricket/sync-countries')
      message.success(`Synced ${r.data.count} countries and flags`)
    } catch (e: any) {
      message.error('Country sync failed')
    }
  }

  const createMatch = async (v: any) => {
    try {
      await adminApi.post('/betting/cricket/match', {
        series: v.series, format: v.format, team_a: v.team_a, team_b: v.team_b,
        team_a_short: v.team_a_short, team_b_short: v.team_b_short,
        start_time: v.start_time.toISOString(),
      })
      message.success('Match added'); setMatchOpen(false); mForm.resetFields(); load()
    } catch (e: any) { message.error(e?.response?.data?.error || 'Failed') }
  }

  const createMarket = async (v: any) => {
    try {
      // options entered as "key|label|odds" lines
      const options = (v.options as string).split('\n').map(l => l.trim()).filter(Boolean).map(l => {
        const [key, label, odds] = l.split('|').map(s => s.trim())
        return { key, label, odds: Number(odds) }
      })
      await adminApi.post('/betting/cricket/market', {
        match_id: marketFor.id, market_type: v.market_type, label: v.label, options,
      })
      message.success('Market added'); setMarketFor(null); mkForm.resetFields(); load()
    } catch (e: any) { message.error(e?.response?.data?.error || 'Failed') }
  }

  const createSession = async (v: any) => {
    try {
      await adminApi.post('/betting/cricket/session/create', {
        match_id: sessionFor.id, label: v.label, min_runs: v.min_runs, max_runs: v.max_runs,
      })
      message.success('Session added'); setSessionFor(null); sForm.resetFields(); load()
    } catch (e: any) { message.error(e?.response?.data?.error || 'Failed') }
  }

  const settle = async (market: any, resultKey: string | null) => {
    try {
      const r = await adminApi.post('/betting/cricket/settle', { market_id: market.id, result_key: resultKey })
      message.success(`Settled — ${r.data.winners} winners, ₹${Number(r.data.paid).toFixed(0)} paid`)
      load()
    } catch (e: any) { message.error(e?.response?.data?.error || 'Settle failed') }
  }

  const settleSession = async (sessionId: string, runs: number | null) => {
    try {
      const r = await adminApi.post('/betting/cricket/session/settle', { session_id: sessionId, result_runs: runs })
      message.success(`Session Settled — ${r.data.winners} winners paid`)
      load()
    } catch (e: any) { message.error('Session settle failed') }
  }

  return (
    <Card title="Cricket Matches"
      extra={
        <Space>
          <Button onClick={syncCountries} size="small">Sync Flags</Button>
          <Button type="primary" onClick={handleSync} loading={syncLoading} icon={<PlusOutlined />}>Sync Matches</Button>
          <Button type="primary" onClick={() => setMatchOpen(true)}>+ Add Match</Button>
          <Button onClick={load}>Refresh</Button>
        </Space>
      }
      loading={loading}>
      {matches.map(m => (
        <Card key={m.id} type="inner" style={{ marginBottom: 16 }}
          title={<span>{m.series} · {String(m.format).toUpperCase()} — <b>{m.team_a} vs {m.team_b}</b> <Tag color={m.status === 'settled' ? 'red' : m.status === 'live' ? 'orange' : 'blue'}>{m.status}</Tag></span>}
          extra={
            <Space>
              <Button size="small" onClick={() => setSessionFor(m)}>+ Session</Button>
              <Button size="small" onClick={() => setMarketFor(m)}>+ Market</Button>
            </Space>
          }>
          <Text type="secondary">{new Date(m.start_time).toLocaleString()}</Text>

          {/* Markets Section */}
          <div style={{ marginTop: 12 }}>
            <Text strong>Markets</Text>
            {(m.markets || []).map((mk: any) => (
              <div key={mk.id} style={{ marginTop: 8 }}>
                <Space wrap>
                  <Text>{mk.label}</Text>
                  <Tag color={mk.status === 'settled' ? 'red' : 'green'}>{mk.status}</Tag>
                  {(mk.options || []).map((o: any) => (
                    <Popconfirm key={o.key} title={`Settle "${mk.label}" → ${o.label} wins?`}
                      disabled={mk.status === 'settled'} onConfirm={() => settle(mk, o.key)}>
                      <Button size="small" disabled={mk.status === 'settled'}>{o.label} @ {o.odds}</Button>
                    </Popconfirm>
                  ))}
                  <Popconfirm title="Void this market?"
                    disabled={mk.status === 'settled'} onConfirm={() => settle(mk, null)}>
                    <Button size="small" danger disabled={mk.status === 'settled'}>Void</Button>
                  </Popconfirm>
                </Space>
              </div>
            ))}
          </div>

          {/* Sessions Section */}
          <div style={{ marginTop: 20 }}>
            <Text strong>Sessions (Fancy)</Text>
            {(m.sessions || []).map((s: any) => (
              <div key={s.id} style={{ marginTop: 8 }}>
                <Space wrap>
                  <Text>{s.label} ({s.min_runs}-{s.max_runs})</Text>
                  <Tag color={s.status === 'settled' ? 'red' : 'green'}>{s.status}</Tag>
                  {s.status !== 'settled' && (
                    <Space>
                      <InputNumber size="small" placeholder="Final Runs" id={`runs-${s.id}`} />
                      <Button size="small" type="primary" onClick={() => {
                        const val = (document.getElementById(`runs-${s.id}`) as HTMLInputElement)?.value;
                        if (val) settleSession(s.id, parseInt(val));
                      }}>Settle</Button>
                    </Space>
                  )}
                  {s.status === 'settled' && <Text type="success">Result: {s.result_runs} runs</Text>}
                </Space>
              </div>
            ))}
          </div>
        </Card>
      ))}

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

      <Modal open={!!sessionFor} title={`Add Session — ${sessionFor?.team_a} vs ${sessionFor?.team_b}`}
        onCancel={() => setSessionFor(null)} onOk={() => sForm.submit()} okText="Add Session">
        <Form form={sForm} layout="vertical" onFinish={createSession}>
          <Form.Item name="label" label="Label" rules={[{ required: true }]} initialValue="6 Over Session - India">
            <Input placeholder="e.g. 6 Over Session - India" />
          </Form.Item>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="min_runs" label="Line (Min)" rules={[{ required: true }]} initialValue={45}>
                <InputNumber style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="max_runs" label="Line (Max)" rules={[{ required: true }]} initialValue={47}>
                <InputNumber style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>
          <Text type="secondary">Min is for 'No' bet, Max is for 'Yes' bet.</Text>
        </Form>
      </Modal>
    </Card>
  )
}

export default function BettingManagement() {
  return (
    <Tabs defaultActiveKey="cricket" items={[
      { key: 'cricket', label: '🏏 Cricket', children: <CricketTab /> },
      { key: 'matka', label: '🎯 Matka', children: <MatkaTab /> },
      { key: 'lottery', label: '🎰 Lottery', children: <LotteryTab /> },
    ]} />
  )
}
