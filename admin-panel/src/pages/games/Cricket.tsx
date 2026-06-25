import { useEffect, useState } from 'react'
import {
  Card, Form, Switch, InputNumber, Select, Button, Table, Tag,
  Space, Modal, Input, Typography, Divider, Popconfirm, message, Row, Col, DatePicker, Tabs, Alert
} from 'antd'
import { ReloadOutlined, PlusOutlined, SyncOutlined, CloudDownloadOutlined } from '@ant-design/icons'
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

  // --- Fantasy States ---
  const [players, setPlayers] = useState<any[]>([])
  const [loadingPlayers, setLoadingPlayers] = useState(false)
  const [playerOpen, setPlayerOpen] = useState(false)
  const [leagueOpen, setLeagueOpen] = useState(false)
  const [settleFantasyFor, setSettleFantasyFor] = useState<any>(null)
  const [pForm] = Form.useForm()
  const [lForm] = Form.useForm()
  const [settleForm] = Form.useForm()

  // --- Sports API States ---
  const [syncing, setSyncing] = useState(false)
  const [syncingCountries, setSyncingCountries] = useState(false)
  const [apiConfigForm] = Form.useForm()

  // --- Series Import States ---
  const [seriesOpen, setSeriesOpen] = useState(false)
  const [seriesQuery, setSeriesQuery] = useState('')
  const [seriesList, setSeriesList] = useState<any[]>([])
  const [searchingSeries, setSearchingSeries] = useState(false)
  const [importingSeriesId, setImportingSeriesId] = useState<string | null>(null)

  // --- Squad Syncing States ---
  const [syncingSquadId, setSyncingSquadId] = useState<string | null>(null)

  // --- Live Console States ---
  const [liveMatchId, setLiveMatchId] = useState<string>('')
  const [liveMatch, setLiveMatch] = useState<any>(null)
  const [loadingLive, setLoadingLive] = useState(false)
  const [scoreForm] = Form.useForm()
  const [liveMarketForm] = Form.useForm()

  const loadConfig = () => {
    setLoadingConfig(true)
    adminApi.get('/game-configs')
      .then(r => {
        const ckConfig = r.data.find((c: any) => c.game_type === 'cricket')
        setConfig(ckConfig)
        if (ckConfig?.special_rules) {
          apiConfigForm.setFieldsValue({
            api_key: ckConfig.special_rules.api_key || '',
            api_provider: ckConfig.special_rules.api_provider || 'cricket_data_api',
          })
        }
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

  const saveApiConfig = async (values: any) => {
    setSavingConfig(true)
    try {
      await adminApi.patch('/game-configs/cricket', {
        ...config,
        special_rules: {
          ...(config?.special_rules || {}),
          api_provider: values.api_provider,
          api_key: values.api_key,
        }
      })
      message.success('Sports API Key saved!')
      loadConfig()
    } catch {
      message.error('Failed to save API config')
    } finally {
      setSavingConfig(false)
    }
  }

  const syncFromApi = async () => {
    setSyncing(true)
    try {
      const r = await adminApi.post('/betting/cricket/sync-api', {})
      message.success(`API Sync Complete! Inserted: ${r.data.inserted}, Updated: ${r.data.updated}`)
      loadMatches()
    } catch (e: any) {
      message.error(e?.response?.data?.error || 'API Sync failed')
    } finally {
      setSyncing(false)
    }
  }

  const syncCountries = async () => {
    setSyncingCountries(true)
    try {
      const r = await adminApi.post('/betting/cricket/sync-countries', {})
      message.success(`Countries & Flags cached! Imported: ${r.data.count}`)
      loadMatches()
    } catch (e: any) {
      message.error(e?.response?.data?.error || 'Flags sync failed')
    } finally {
      setSyncingCountries(false)
    }
  }

  const searchSeries = async () => {
    setSearchingSeries(true)
    try {
      const r = await adminApi.post('/betting/cricket/sync-series', { search: seriesQuery })
      setSeriesList(r.data.series || [])
    } catch (e: any) {
      message.error(e?.response?.data?.error || 'Failed to search series')
    } finally {
      setSearchingSeries(false)
    }
  }

  const importSeriesMatches = async (seriesId: string) => {
    setImportingSeriesId(seriesId)
    try {
      const r = await adminApi.post('/betting/cricket/import-series-matches', { series_id: seriesId })
      message.success(`Series imported! Added: ${r.data.imported} matches`)
      loadMatches()
    } catch (e: any) {
      message.error(e?.response?.data?.error || 'Failed to import series')
    } finally {
      setImportingSeriesId(null)
    }
  }

  const syncSquad = async (match: any) => {
    setSyncingSquadId(match.id)
    try {
      const r = await adminApi.post('/betting/cricket/sync-squad', { match_id: match.id, match_api_id: match.match_api_id })
      message.success(`Squad synced! Seeded ${r.data.seededCount} players for this match`)
      loadPlayers()
    } catch (e: any) {
      message.error(e?.response?.data?.error || 'Failed to sync squad')
    } finally {
      setSyncingSquadId(null)
    }
  }

  const loadMatches = () => {
    setLoadingMatches(true)
    adminApi.get('/betting/cricket/matches')
      .then(r => {
        setMatches(r.data.matches || [])
        // Set first live/upcoming match as active live match if none selected
        const liveOrUpcoming = r.data.matches?.find((m: any) => m.status === 'live' || m.status === 'upcoming')
        if (liveOrUpcoming && !liveMatchId) {
          setLiveMatchId(liveOrUpcoming.id)
        }
      })
      .finally(() => setLoadingMatches(false))
  }

  const loadPlayers = () => {
    setLoadingPlayers(true)
    adminApi.get('/betting/cricket/fantasy/players')
      .then(r => setPlayers(r.data.players || []))
      .finally(() => setLoadingPlayers(false))
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
      if (liveMatch && marketFor.id === liveMatch.id) {
        loadLiveMatch(liveMatch.id)
      }
    } catch (e: any) {
      message.error(e?.response?.data?.error || 'Failed to add market')
    }
  }

  const settleMarket = async (market: any, resultKey: string | null) => {
    try {
      const r = await adminApi.post('/betting/cricket/settle', { market_id: market.id, result_key: resultKey })
      message.success(`Settled — ${r.data.winners} winners, ₹${Number(r.data.paid).toFixed(0)} paid`)
      loadMatches()
      if (liveMatch) {
        loadLiveMatch(liveMatch.id)
      }
    } catch (e: any) {
      message.error(e?.response?.data?.error || 'Settle failed')
    }
  }

  // --- Fantasy Operators ---
  const addPlayer = async (v: any) => {
    try {
      await adminApi.post('/betting/cricket/fantasy/players', {
        name: v.name, role: v.role, credits: v.credits, team_name: v.team_name, avatar_url: v.avatar_url
      })
      message.success('Player added globally')
      setPlayerOpen(false)
      pForm.resetFields()
      loadPlayers()
    } catch (e: any) {
      message.error(e?.response?.data?.error || 'Failed')
    }
  }

  const createLeague = async (v: any) => {
    try {
      // Parse custom prize distribution: "rank_start|rank_end|payout"
      const prize_distribution = (v.prize_distribution as string).split('\n').map(l => l.trim()).filter(Boolean).map(l => {
        const [start, end, pay] = l.split('|').map(s => s.trim())
        return { rank_start: Number(start), rank_end: Number(end), payout: Number(pay) }
      })
      await adminApi.post('/betting/cricket/fantasy/leagues', {
        match_id: v.match_id, name: v.name, entry_fee: v.entry_fee, prize_pool: v.prize_pool,
        max_entries: v.max_entries, prize_distribution
      })
      message.success('Fantasy league created')
      setLeagueOpen(false)
      lForm.resetFields()
      loadMatches()
    } catch (e: any) {
      message.error(e?.response?.data?.error || 'Failed')
    }
  }

  const handleSettleFantasy = async (values: any) => {
    try {
      const player_points: Record<string, number> = {}
      Object.entries(values).forEach(([key, val]) => {
        if (key.startsWith('p_')) {
          player_points[key.replace('p_', '')] = Number(val || 0)
        }
      })
      const r = await adminApi.post('/betting/cricket/fantasy/settle', {
        match_id: settleFantasyFor.id, player_points
      })
      message.success(`Fantasy pool settled! ${r.data.settledLeagues} contests paid, ₹${Number(r.data.totalPaid).toFixed(0)} disbursed`)
      setSettleFantasyFor(null)
      settleForm.resetFields()
      loadMatches()
    } catch (e: any) {
      message.error(e?.response?.data?.error || 'Settlement failed')
    }
  }

  // --- Live Dashboard Operators ---
  const loadLiveMatch = (id: string) => {
    if (!id) return
    setLoadingLive(true)
    adminApi.get(`/betting/cricket/matches`)
      .then(r => {
        const found = r.data.matches?.find((m: any) => m.id === id)
        if (found) {
          setLiveMatch(found)
          // Set initial values for score operator
          scoreForm.setFieldsValue({
            runs: found.live_score?.runs ?? 0,
            wickets: found.live_score?.wickets ?? 0,
            overs: found.live_score?.overs ?? 0,
            target: found.live_score?.target,
            runs_required: found.live_score?.runs_required,
            balls_remaining: found.live_score?.balls_remaining,
            batsman1_name: found.live_score?.batsmen?.[0]?.name ?? '',
            batsman1_runs: found.live_score?.batsmen?.[0]?.runs ?? 0,
            batsman1_balls: found.live_score?.batsmen?.[0]?.balls ?? 0,
            batsman2_name: found.live_score?.batsmen?.[1]?.name ?? '',
            batsman2_runs: found.live_score?.batsmen?.[1]?.runs ?? 0,
            batsman2_balls: found.live_score?.batsmen?.[1]?.balls ?? 0,
            bowler_name: found.live_score?.bowler?.name ?? '',
            bowler_overs: found.live_score?.bowler?.overs ?? 0,
            bowler_runs: found.live_score?.bowler?.runs ?? 0,
            bowler_wickets: found.live_score?.bowler?.wickets ?? 0,
            live_tv_url: found.live_tv_url ?? '',
            status: found.status
          })
        }
      })
      .finally(() => setLoadingLive(false))
  }

  const updateScoreboard = async (v: any) => {
    try {
      const live_score = {
        runs: v.runs,
        wickets: v.wickets,
        overs: v.overs,
        target: v.target || undefined,
        runs_required: v.runs_required || undefined,
        balls_remaining: v.balls_remaining || undefined,
        batsmen: [
          { name: v.batsman1_name, runs: v.batsman1_runs, balls: v.batsman1_balls },
          { name: v.batsman2_name, runs: v.batsman2_runs, balls: v.batsman2_balls }
        ],
        bowler: { name: v.bowler_name, overs: v.bowler_overs, runs: v.bowler_runs, wickets: v.bowler_wickets }
      }
      await adminApi.post('/betting/cricket/scores/update', {
        match_id: liveMatchId, live_score, live_tv_url: v.live_tv_url, status: v.status
      })
      message.success('Live scoreboard & video updated')
      loadLiveMatch(liveMatchId)
      loadMatches()
    } catch (e: any) {
      message.error(e?.response?.data?.error || 'Failed to update scoreboard')
    }
  }

  useEffect(() => {
    loadConfig()
    loadMatches()
    loadPlayers()
  }, [])

  useEffect(() => {
    if (liveMatchId) {
      loadLiveMatch(liveMatchId)
    }
  }, [liveMatchId])

  // Players filtered by teams playing in selected match to score points
  const matchPlayersToScore = settleFantasyFor
    ? players.filter(p => p.team_name === settleFantasyFor.team_a || p.team_name === settleFantasyFor.team_b)
    : []

  const tabItems = [
    {
      key: 'matches',
      label: '🏏 Matches & Markets',
      children: (
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

            <Card title="🌐 CricAPI Integration" style={{ marginTop: 16 }} loading={loadingConfig}>
              <Alert
                type="info"
                message="CricAPI Key Configured"
                description={<span>Paste your API key below to auto-import matches, squads, and flags. By default, the system includes a free key: <code>dd511ce4-aeb7-4e1f-86f4-1160404b2776</code>.</span>}
                style={{ marginBottom: 16 }}
                showIcon
              />
              <Form form={apiConfigForm} layout="vertical" onFinish={saveApiConfig}>
                <Form.Item name="api_provider" label="API Provider" initialValue="cricket_data_api">
                  <Select options={[
                    { value: 'cricket_data_api', label: 'CricAPI (cricapi.com)' }
                  ]} />
                </Form.Item>
                <Form.Item name="api_key" label="API Key">
                  <Input.Password placeholder="Enter your CricAPI key here..." />
                </Form.Item>
                <Space style={{ width: '100%' }} direction="vertical">
                  <Button type="primary" htmlType="submit" block loading={savingConfig} icon={<CloudDownloadOutlined />}>
                    Save API Key
                  </Button>
                  <Button block onClick={syncCountries} loading={syncingCountries} icon={<SyncOutlined />} style={{ backgroundColor: '#13c2c2', color: 'white', border: 'none' }}>
                    {syncingCountries ? 'Caching flags...' : 'Sync Countries & Flags'}
                  </Button>
                  <Button block onClick={syncFromApi} loading={syncing} icon={<SyncOutlined />} style={{ backgroundColor: '#52c41a', color: 'white', border: 'none' }}>
                    {syncing ? 'Syncing...' : 'Sync Live/Upcoming Matches'}
                  </Button>
                </Space>
              </Form>
            </Card>

          </Col>

          <Col xs={24} lg={16}>
            <Card title="Cricket Matches"
              extra={
                <Space>
                  <Button type="primary" onClick={() => setMatchOpen(true)}>+ Add Match</Button>
                  <Button icon={<CloudDownloadOutlined />} onClick={() => setSeriesOpen(true)}>Import Series</Button>
                  <Button icon={<ReloadOutlined />} onClick={loadMatches}>Refresh</Button>
                  <Button icon={<SyncOutlined />} onClick={syncFromApi} loading={syncing} style={{ backgroundColor: '#1677ff', color: 'white', border: 'none' }}>
                    Sync Matches
                  </Button>
                </Space>
              }
              loading={loadingMatches}>
              {matches.map(m => (
                <Card key={m.id} type="inner" style={{ marginBottom: 16 }}
                  title={
                    <span>
                      {m.series} · {String(m.format).toUpperCase()} —{' '}
                      <b>
                        {m.team_a_flag && <img src={m.team_a_flag} alt="" style={{ width: 22, height: 15, marginRight: 6, verticalAlign: 'middle', border: '1px solid #ddd', borderRadius: 2 }} />}
                        {m.team_a} vs {m.team_b}
                        {m.team_b_flag && <img src={m.team_b_flag} alt="" style={{ width: 22, height: 15, marginLeft: 6, verticalAlign: 'middle', border: '1px solid #ddd', borderRadius: 2 }} />}
                      </b>{' '}
                      <Tag color={m.status === 'settled' ? 'red' : m.status === 'live' ? 'orange' : 'blue'}>{m.status}</Tag>
                    </span>
                  }
                  extra={
                    <Space>
                      {m.match_api_id && (
                        <Button size="small" type="dashed" icon={<SyncOutlined />} loading={syncingSquadId === m.id} onClick={() => syncSquad(m)}>
                          Sync Squad
                        </Button>
                      )}
                      <Button size="small" onClick={() => setMarketFor(m)}>+ Market</Button>
                    </Space>
                  }>
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
                              disabled={mk.status === 'settled'} onConfirm={() => settleMarket(mk, o.key)}>
                              <Button size="small" disabled={mk.status === 'settled'}>{o.label} @ {o.odds}</Button>
                            </Popconfirm>
                          ))}
                          <Popconfirm title="Void this market and refund all stakes?"
                            disabled={mk.status === 'settled'} onConfirm={() => settleMarket(mk, null)}>
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
      )
    },
    {
      key: 'fantasy',
      label: '🏆 Fantasy Contests',
      children: (
        <Row gutter={[24, 24]}>
          <Col xs={24} lg={14}>
            <Card title="Matches & Fantasy Pools"
              extra={
                <Space>
                  <Button type="primary" onClick={() => setLeagueOpen(true)}>+ Create Contest</Button>
                  <Button onClick={loadMatches}>Refresh</Button>
                </Space>
              }
            >
              {matches.map(m => (
                <Card key={m.id} type="inner" style={{ marginBottom: 16 }}
                  title={<span>{m.series} — <b>{m.team_a} vs {m.team_b}</b></span>}
                  extra={
                    <Button size="small" type="primary" disabled={m.status === 'settled'}
                      onClick={() => {
                        setSettleFantasyFor(m)
                        settleForm.resetFields()
                      }}
                    >
                      Settle Points
                    </Button>
                  }
                >
                  <Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
                    Starts: {new Date(m.start_time).toLocaleString()} · Status: <Tag color={m.status === 'settled' ? 'red' : 'green'}>{m.status}</Tag>
                  </Text>
                  
                  {/* Fetching leagues would require fetching details, for simplicity we show match status and action */}
                  <Divider style={{ margin: '8px 0' }} />
                  <Text type="secondary">Admin Action: Create contests using the button above and select this match.</Text>
                </Card>
              ))}
            </Card>
          </Col>
          <Col xs={24} lg={10}>
            <Card title="Seeded Fantasy Players" 
              extra={
                <Button type="primary" size="small" icon={<PlusOutlined />} onClick={() => setPlayerOpen(true)}>
                  Add Player
                </Button>
              }
              loading={loadingPlayers}
            >
              <Table 
                rowKey="id" 
                dataSource={players} 
                size="small" 
                pagination={{ pageSize: 8 }}
                columns={[
                  { title: 'Name', dataIndex: 'name', render: (n: string) => <b>{n}</b> },
                  { title: 'Team', dataIndex: 'team_name' },
                  { title: 'Role', dataIndex: 'role', render: (r: string) => <Tag color="blue">{r.toUpperCase().replace('_', ' ')}</Tag> },
                  { title: 'Credits', dataIndex: 'credits', render: (c: any) => `${Number(c).toFixed(1)}` }
                ]} 
              />
            </Card>
          </Col>
        </Row>
      )
    },
    {
      key: 'live_console',
      label: '📺 Live Operators Console',
      children: (
        <Row gutter={[24, 24]}>
          <Col xs={24} lg={10}>
            <Card title="Active Match Operator Scoreboard">
              <div style={{ marginBottom: 16 }}>
                <Text>Select Match: </Text>
                <Select 
                  style={{ width: '100%', marginTop: 8 }} 
                  placeholder="Select match to operate..."
                  value={liveMatchId}
                  onChange={(val) => setLiveMatchId(val)}
                  options={matches.map(m => ({ value: m.id, label: `${m.team_a} vs ${m.team_b} (${m.series})` }))}
                />
              </div>

              {liveMatch && (
                <Form form={scoreForm} layout="vertical" onFinish={updateScoreboard}>
                  <Row gutter={16}>
                    <Col span={12}>
                      <Form.Item name="status" label="Match Status">
                        <Select options={[
                          { value: 'upcoming', label: 'Upcoming' },
                          { value: 'live', label: 'LIVE' },
                          { value: 'closed', label: 'Closed/Innings Break' },
                          { value: 'settled', label: 'Completed/Settled' }
                        ]} />
                      </Form.Item>
                    </Col>
                    <Col span={12}>
                      <Form.Item name="live_tv_url" label="Live Stream URL / YouTube Link">
                        <Input placeholder="https://..." />
                      </Form.Item>
                    </Col>
                  </Row>

                  <Divider style={{ margin: '8px 0' }}>Scoreboard</Divider>
                  <Row gutter={16}>
                    <Col span={8}>
                      <Form.Item name="runs" label="Runs" rules={[{ required: true }]}><InputNumber min={0} style={{ width: '100%' }} /></Form.Item>
                    </Col>
                    <Col span={8}>
                      <Form.Item name="wickets" label="Wickets" rules={[{ required: true }]}><InputNumber min={0} max={10} style={{ width: '100%' }} /></Form.Item>
                    </Col>
                    <Col span={8}>
                      <Form.Item name="overs" label="Overs" rules={[{ required: true }]}><InputNumber min={0} step={0.1} style={{ width: '100%' }} /></Form.Item>
                    </Col>
                  </Row>

                  <Row gutter={16}>
                    <Col span={8}>
                      <Form.Item name="target" label="Target Runs"><InputNumber min={0} style={{ width: '100%' }} /></Form.Item>
                    </Col>
                    <Col span={8}>
                      <Form.Item name="runs_required" label="Runs Req."><InputNumber min={0} style={{ width: '100%' }} /></Form.Item>
                    </Col>
                    <Col span={8}>
                      <Form.Item name="balls_remaining" label="Balls Left"><InputNumber min={0} style={{ width: '100%' }} /></Form.Item>
                    </Col>
                  </Row>

                  <Divider style={{ margin: '8px 0' }}>Batsmen on Crease</Divider>
                  <Row gutter={8}>
                    <Col span={12}>
                      <Form.Item name="batsman1_name" label="Batsman 1 Name"><Input placeholder="e.g. Virat Kohli" /></Form.Item>
                    </Col>
                    <Col span={6}>
                      <Form.Item name="batsman1_runs" label="Runs"><InputNumber min={0} style={{ width: '100%' }} /></Form.Item>
                    </Col>
                    <Col span={6}>
                      <Form.Item name="batsman1_balls" label="Balls"><InputNumber min={0} style={{ width: '100%' }} /></Form.Item>
                    </Col>
                  </Row>
                  <Row gutter={8}>
                    <Col span={12}>
                      <Form.Item name="batsman2_name" label="Batsman 2 Name"><Input placeholder="e.g. Rohit Sharma" /></Form.Item>
                    </Col>
                    <Col span={6}>
                      <Form.Item name="batsman2_runs" label="Runs"><InputNumber min={0} style={{ width: '100%' }} /></Form.Item>
                    </Col>
                    <Col span={6}>
                      <Form.Item name="batsman2_balls" label="Balls"><InputNumber min={0} style={{ width: '100%' }} /></Form.Item>
                    </Col>
                  </Row>

                  <Divider style={{ margin: '8px 0' }}>Active Bowler</Divider>
                  <Row gutter={8}>
                    <Col span={10}>
                      <Form.Item name="bowler_name" label="Bowler Name"><Input placeholder="e.g. Jasprit Bumrah" /></Form.Item>
                    </Col>
                    <Col span={4}>
                      <Form.Item name="bowler_overs" label="Overs"><InputNumber min={0} step={0.1} style={{ width: '100%' }} /></Form.Item>
                    </Col>
                    <Col span={5}>
                      <Form.Item name="bowler_runs" label="Runs"><InputNumber min={0} style={{ width: '100%' }} /></Form.Item>
                    </Col>
                    <Col span={5}>
                      <Form.Item name="bowler_wickets" label="Wkts"><InputNumber min={0} style={{ width: '100%' }} /></Form.Item>
                    </Col>
                  </Row>

                  <Form.Item style={{ marginTop: 16 }}>
                    <Button type="primary" htmlType="submit" block loading={loadingLive}>
                      Publish Live Update
                    </Button>
                  </Form.Item>
                </Form>
              )}
            </Card>
          </Col>

          <Col xs={24} lg={14}>
            <Card title="Live Ball-by-Ball micro-Betting Board" 
              extra={
                <Button type="primary" size="small" disabled={!liveMatch} onClick={() => setMarketFor(liveMatch)}>
                  + Spawn Live Market
                </Button>
              }
              loading={loadingLive}
            >
              {liveMatch ? (
                <div>
                  <Typography.Title level={5} style={{ color: '#d4af37' }}>
                    📈 Active Live Markets: {liveMatch.team_a} vs {liveMatch.team_b}
                  </Typography.Title>
                  
                  {liveMatch.markets?.filter((m: any) => m.status === 'open').length === 0 ? (
                    <Text type="secondary">No live markets currently spawned. Click "Spawn Live Market" to create one.</Text>
                  ) : (
                    liveMatch.markets?.map((mk: any) => (
                      <Card key={mk.id} type="inner" style={{ marginBottom: 12 }} title={mk.label}>
                        <Space wrap>
                          {(mk.options || []).map((o: any) => (
                            <Popconfirm key={o.key} title={`Settle live market to: "${o.label}" wins?`}
                              onConfirm={() => settleMarket(mk, o.key)}>
                              <Button size="small">{o.label} @ {o.odds}</Button>
                            </Popconfirm>
                          ))}
                          <Popconfirm title="Void live market and refund all bets?" onConfirm={() => settleMarket(mk, null)}>
                            <Button size="small" danger>Void/Refund</Button>
                          </Popconfirm>
                        </Space>
                      </Card>
                    ))
                  )}
                </div>
              ) : (
                <Text type="secondary">Select a match on the left to display its live betting board.</Text>
              )}
            </Card>
          </Col>
        </Row>
      )
    }
  ]

  return (
    <div>
      <h2 style={{ color: '#d4af37', marginBottom: 24 }}>🏏 Cricket Betting Management</h2>
      <Tabs defaultActiveKey="matches" items={tabItems} style={{ background: '#fff', padding: 24, borderRadius: 8, boxShadow: '0 1px 4px rgba(0,0,0,0.1)' }} />

      {/* Add Match Modal */}
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

      {/* Add Market Modal */}
      <Modal open={!!marketFor} title={`Add Market — ${marketFor?.team_a} vs ${marketFor?.team_b}`}
        onCancel={() => setMarketFor(null)} onOk={() => mkForm.submit()} okText="Add Market">
        <Form form={mkForm} layout="vertical" onFinish={createMarket}>
          <Form.Item name="market_type" label="Market Type" rules={[{ required: true }]} initialValue="match_winner">
            <Select options={[
              { value: 'match_winner', label: 'Match Winner' },
              { value: 'toss_winner', label: 'Toss Winner' },
              { value: 'top_batsman', label: 'Top Batsman' },
              { value: 'total_runs', label: 'Total Runs' },
              { value: 'live_ball', label: 'Live Ball (Micro)' },
              { value: 'live_over', label: 'Live Over (Micro)' },
              { value: 'live_session', label: 'Live Session (Micro)' }
            ]} />
          </Form.Item>
          <Form.Item name="label" label="Question" rules={[{ required: true }]}><Input placeholder="Who will win the match?" /></Form.Item>
          <Form.Item name="options" label="Options (one per line: key|label|odds)" rules={[{ required: true }]}
            tooltip="Example: a|India|1.75">
            <Input.TextArea rows={4} placeholder={'a|India|1.75\nb|Australia|2.05'} />
          </Form.Item>
        </Form>
      </Modal>

      {/* Add Player Modal */}
      <Modal open={playerOpen} title="Seed Global Fantasy Player" onCancel={() => setPlayerOpen(false)} onOk={() => pForm.submit()} okText="Add Player">
        <Form form={pForm} layout="vertical" onFinish={addPlayer}>
          <Form.Item name="name" label="Player Name" rules={[{ required: true }]}><Input placeholder="e.g. Virat Kohli" /></Form.Item>
          <Form.Item name="role" label="Role" rules={[{ required: true }]} initialValue="batsman">
            <Select options={[
              { value: 'wicket_keeper', label: 'Wicket Keeper (WK)' },
              { value: 'batsman', label: 'Batsman (BAT)' },
              { value: 'all_rounder', label: 'All Rounder (AR)' },
              { value: 'bowler', label: 'Bowler (BOWL)' }
            ]} />
          </Form.Item>
          <Form.Item name="credits" label="Draft Credit Cost (5.0 - 15.0)" rules={[{ required: true }]} initialValue={9.0}>
            <InputNumber min={5.0} max={15.0} step={0.5} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="team_name" label="Team / Country" rules={[{ required: true }]}><Input placeholder="e.g. India" /></Form.Item>
          <Form.Item name="avatar_url" label="Avatar URL"><Input placeholder="https://..." /></Form.Item>
        </Form>
      </Modal>

      {/* Create Contest Modal */}
      <Modal open={leagueOpen} title="Create Fantasy Contest Pool" onCancel={() => setLeagueOpen(false)} onOk={() => lForm.submit()} okText="Create Pool">
        <Form form={lForm} layout="vertical" onFinish={createLeague}>
          <Form.Item name="match_id" label="Target Match" rules={[{ required: true }]}>
            <Select options={matches.map(m => ({ value: m.id, label: `${m.team_a} vs ${m.team_b} (${m.series})` }))} />
          </Form.Item>
          <Form.Item name="name" label="Contest Pool Name" rules={[{ required: true }]}><Input placeholder="e.g. Mega Contest / Head to Head" /></Form.Item>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="entry_fee" label="Entry Fee (₹)" rules={[{ required: true }]} initialValue={49}><InputNumber min={0} style={{ width: '100%' }} /></Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="prize_pool" label="Total Prize Pool (₹)" rules={[{ required: true }]} initialValue={10000}><InputNumber min={0} style={{ width: '100%' }} /></Form.Item>
            </Col>
          </Row>
          <Form.Item name="max_entries" label="Max Joined Ranks Limit" rules={[{ required: true }]} initialValue={100}><InputNumber min={2} style={{ width: '100%' }} /></Form.Item>
          <Form.Item name="prize_distribution" label="Custom Prize Payout Tiers (one per line: rank_start|rank_end|payout)" rules={[{ required: true }]}
            tooltip="Specifies cash payout ranges. Example: 1|1|5000 means Rank 1 gets 5000."
          >
            <Input.TextArea rows={4} placeholder={'1|1|5000\n2|5|1000\n6|10|500'} />
          </Form.Item>
        </Form>
      </Modal>

      {/* Settle Points Modal */}
      <Modal open={!!settleFantasyFor} title={`Post Player Performance Scorecard — ${settleFantasyFor?.team_a} vs ${settleFantasyFor?.team_b}`}
        onCancel={() => setSettleFantasyFor(null)} onOk={() => settleForm.submit()} okText="Calculate & Disburse Payouts" width={600}>
        <Form form={settleForm} layout="vertical" onFinish={handleSettleFantasy}>
          <Text type="secondary" style={{ display: 'block', marginBottom: 16 }}>
            Input final fantasy scoring points achieved by match players. Multipliers for Captain (2x) and Vice-Captain (1.5x) are calculated automatically.
          </Text>
          <div style={{ maxHeight: 400, overflowY: 'auto', paddingRight: 8 }}>
            {matchPlayersToScore.length === 0 ? (
              <Text type="warning" style={{ display: 'block' }}>
                No seeded players found belonging to {settleFantasyFor?.team_a} or {settleFantasyFor?.team_b}. Please add players in the global roster tab first.
              </Text>
            ) : (
              matchPlayersToScore.map(p => (
                <Row key={p.id} gutter={16} align="middle" style={{ marginBottom: 8 }}>
                  <Col span={12}>
                    <b>{p.name}</b> <Tag>{p.team_name}</Tag>
                  </Col>
                  <Col span={12}>
                    <Form.Item name={`p_${p.id}`} noStyle initialValue={0}>
                      <InputNumber min={-50} max={1000} step={0.5} placeholder="Points" style={{ width: '100%' }} />
                    </Form.Item>
                  </Col>
                </Row>
              ))
            )}
          </div>
        </Form>
      </Modal>

      {/* Import Series Modal */}
      <Modal open={seriesOpen} title="Import Matches from Series" onCancel={() => setSeriesOpen(false)} footer={null} width={700}>
        <div style={{ marginBottom: 16 }}>
          <Space.Compact style={{ width: '100%' }}>
            <Input 
              placeholder="Search Series (e.g. IPL, ICC, Big Bash)..." 
              value={seriesQuery} 
              onChange={e => setSeriesQuery(e.target.value)} 
              onPressEnter={searchSeries}
            />
            <Button type="primary" loading={searchingSeries} onClick={searchSeries}>
              Search
            </Button>
          </Space.Compact>
        </div>

        <Table
          rowKey="id"
          dataSource={seriesList}
          size="small"
          loading={searchingSeries}
          pagination={{ pageSize: 5 }}
          columns={[
            { title: 'Series Name', dataIndex: 'name', render: (n: string) => <b>{n}</b> },
            { title: 'Start Date', dataIndex: 'startDate', render: (d: string) => d ? new Date(d).toLocaleDateString() : '-' },
            { title: 'End Date', dataIndex: 'endDate', render: (d: string) => d ? new Date(d).toLocaleDateString() : '-' },
            { title: 'Matches', dataIndex: 'matches' },
            { 
              title: 'Action', 
              render: (record: any) => (
                <Button 
                  size="small" 
                  type="primary" 
                  loading={importingSeriesId === record.id} 
                  onClick={() => importSeriesMatches(record.id)}
                >
                  Import Matches
                </Button>
              ) 
            }
          ]}
        />
      </Modal>
    </div>
  )
}
