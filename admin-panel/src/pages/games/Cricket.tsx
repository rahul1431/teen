import { useEffect, useState } from 'react'
import {
  Card, Form, Switch, InputNumber, Select, Button, Table, Tag,
  Space, Modal, Input, Typography, Divider, Popconfirm, message, Row, Col, DatePicker, Tabs, Alert
} from 'antd'
import { ReloadOutlined, PlusOutlined, SyncOutlined, CloudDownloadOutlined, DeleteOutlined, TeamOutlined, TrophyOutlined } from '@ant-design/icons'
import { adminApi } from '../../api/client'

const { Text } = Typography

export default function Cricket() {
  const [config, setConfig] = useState<any>(null)
  const [loadingConfig, setLoadingConfig] = useState(false)
  const [savingConfig, setSavingConfig] = useState(false)

  const [matches, setMatches] = useState<any[]>([])
  const [loadingMatches, setLoadingMatches] = useState(false)
  const [matchOpen, setMatchOpen] = useState(false)
  const [mForm] = Form.useForm()

  // --- Fantasy States ---
  const [players, setPlayers] = useState<any[]>([])
  const [loadingPlayers, setLoadingPlayers] = useState(false)
  const [playerOpen, setPlayerOpen] = useState(false)
  const [leagueOpen, setLeagueOpen] = useState(false)
  const [finalizingFor, setFinalizingFor] = useState<string | null>(null)
  const [pForm] = Form.useForm()
  const [lForm] = Form.useForm()

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
  const [syncingSeriesSquadsId, setSyncingSeriesSquadsId] = useState<string | null>(null)

  // --- Series Catalog States ---
  const [seriesCatalog, setSeriesCatalog] = useState<any[]>([])
  const [newSeriesName, setNewSeriesName] = useState('')

  // --- Fantasy Contests (per-match) States ---
  const [leaguesByMatch, setLeaguesByMatch] = useState<Record<string, any[]>>({})
  const [loadingLeaguesFor, setLoadingLeaguesFor] = useState<string | null>(null)

  // --- Scoring Rulebook States ---
  const [rulesOpen, setRulesOpen] = useState(false)
  const [savingRules, setSavingRules] = useState(false)
  const [rForm] = Form.useForm()

  // --- Live Console States ---
  const [liveMatchId, setLiveMatchId] = useState<string>('')
  const [liveMatch, setLiveMatch] = useState<any>(null)
  const [loadingLive, setLoadingLive] = useState(false)
  const [scoreForm] = Form.useForm()

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
      message.success(`Series imported! ${r.data.inserted} new, ${r.data.updated} updated`)
      loadMatches()
      loadSeriesCatalog()
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

  const syncSeriesSquads = async (seriesId: string) => {
    setSyncingSeriesSquadsId(seriesId)
    try {
      const r = await adminApi.post('/betting/cricket/sync-series-squads', { series_id: seriesId })
      message.success(`Squads synced! ${r.data.teamsSeeded} teams, ${r.data.playersSeeded} players`)
      loadPlayers()
    } catch (e: any) {
      message.error(e?.response?.data?.error || 'Failed to sync series squads')
    } finally {
      setSyncingSeriesSquadsId(null)
    }
  }

  const loadMatches = () => {
    setLoadingMatches(true)
    adminApi.get('/betting/cricket/matches')
      .then(r => {
        setMatches(r.data.matches || [])
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

  const loadSeriesCatalog = () => {
    adminApi.get('/betting/cricket/series-catalog').then(r => setSeriesCatalog(r.data.series || []))
  }

  const addSeriesToCatalog = async () => {
    if (!newSeriesName.trim()) return
    try {
      await adminApi.post('/betting/cricket/series-catalog', { name: newSeriesName.trim() })
      setNewSeriesName('')
      loadSeriesCatalog()
    } catch (e: any) {
      message.error(e?.response?.data?.error || 'Failed to add series')
    }
  }

  const deleteSeriesFromCatalog = async (id: number) => {
    try {
      await adminApi.delete(`/betting/cricket/series-catalog/${id}`)
      message.success('Series removed')
      loadSeriesCatalog()
    } catch (e: any) {
      message.error(e?.response?.data?.error || 'Failed to remove series')
    }
  }

  const deleteMatch = async (id: string) => {
    try {
      await adminApi.delete(`/betting/cricket/matches/${id}`)
      message.success('Match deleted')
      loadMatches()
    } catch (e: any) {
      message.error(e?.response?.data?.error || 'Failed to delete match')
    }
  }

  const deletePlayer = async (id: string) => {
    try {
      await adminApi.delete(`/betting/cricket/fantasy/players/${id}`)
      message.success('Player deleted')
      loadPlayers()
    } catch (e: any) {
      message.error(e?.response?.data?.error || 'Failed to delete player')
    }
  }

  const loadLeagues = (matchId: string) => {
    setLoadingLeaguesFor(matchId)
    adminApi.get('/betting/cricket/fantasy/leagues', { params: { match_id: matchId } })
      .then(r => setLeaguesByMatch(prev => ({ ...prev, [matchId]: r.data.leagues || [] })))
      .finally(() => setLoadingLeaguesFor(null))
  }

  const deleteLeague = async (id: string, matchId: string) => {
    try {
      await adminApi.delete(`/betting/cricket/fantasy/leagues/${id}`)
      message.success('Contest deleted')
      loadLeagues(matchId)
    } catch (e: any) {
      message.error(e?.response?.data?.error || 'Failed to delete contest')
    }
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

  // Dream11-style: no manual point entry — pulls the final scorecard,
  // computes every drafted player's points from the rulebook, ranks
  // contests, and pays out winners in one click.
  const finalizeMatch = async (matchId: string) => {
    setFinalizingFor(matchId)
    try {
      const r = await adminApi.post('/betting/cricket/fantasy/finalize', { match_id: matchId })
      message.success(`Finalized — ${r.data.playersScored} players scored, ${r.data.settledLeagues} contests paid, ₹${Number(r.data.totalPaid).toFixed(0)} disbursed`)
      loadMatches()
      loadLeagues(matchId)
    } catch (e: any) {
      message.error(e?.response?.data?.error || 'Finalize failed')
    } finally {
      setFinalizingFor(null)
    }
  }

  // --- Scoring Rulebook ---
  const loadScoringRules = () => {
    adminApi.get('/betting/cricket/scoring-rules').then(r => rForm.setFieldsValue(r.data.rules))
  }

  const saveScoringRules = async (values: any) => {
    setSavingRules(true)
    try {
      await adminApi.patch('/betting/cricket/scoring-rules', values)
      message.success('Scoring rulebook saved')
      setRulesOpen(false)
    } catch (e: any) {
      message.error(e?.response?.data?.error || 'Failed to save rulebook')
    } finally {
      setSavingRules(false)
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
          loadLeagues(id)
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
    loadSeriesCatalog()
  }, [])

  useEffect(() => {
    if (liveMatchId) {
      loadLiveMatch(liveMatchId)
    }
  }, [liveMatchId])

  const tabItems = [
    {
      key: 'matches',
      label: '🏏 Matches',
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

            <Card title="🏆 Series Catalog" style={{ marginTop: 16 }}
              extra={<Text type="secondary" style={{ fontSize: 12 }}>Powers the Series dropdown below</Text>}>
              <Space.Compact style={{ width: '100%', marginBottom: 12 }}>
                <Input
                  placeholder="e.g. Ranji Trophy"
                  value={newSeriesName}
                  onChange={e => setNewSeriesName(e.target.value)}
                  onPressEnter={addSeriesToCatalog}
                />
                <Button type="primary" icon={<PlusOutlined />} onClick={addSeriesToCatalog}>Add</Button>
              </Space.Compact>
              <div style={{ maxHeight: 220, overflowY: 'auto' }}>
                <Space wrap>
                  {seriesCatalog.map(s => (
                    <Tag key={s.id} closable onClose={(e) => { e.preventDefault(); deleteSeriesFromCatalog(s.id) }} style={{ marginBottom: 6 }}>
                      {s.name}
                    </Tag>
                  ))}
                </Space>
              </div>
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
                      <Popconfirm title="Delete this match?" description="Blocked if it has an active fantasy contest with joined entries." onConfirm={() => deleteMatch(m.id)}>
                        <Button size="small" danger icon={<DeleteOutlined />} />
                      </Popconfirm>
                    </Space>
                  }>
                  <Text type="secondary">{new Date(m.start_time).toLocaleString()}</Text>
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
                  <Button icon={<TrophyOutlined />} onClick={() => { loadScoringRules(); setRulesOpen(true) }}>Scoring Rulebook</Button>
                  <Button onClick={loadMatches}>Refresh</Button>
                </Space>
              }
            >
              {matches.map(m => (
                <Card key={m.id} type="inner" style={{ marginBottom: 16 }}
                  title={<span>{m.series} — <b>{m.team_a} vs {m.team_b}</b></span>}
                  extra={
                    <Space>
                      <Button size="small" onClick={() => loadLeagues(m.id)} loading={loadingLeaguesFor === m.id}>
                        {leaguesByMatch[m.id] ? 'Refresh' : 'View Contests'}
                      </Button>
                      <Popconfirm
                        title="Finalize this match?"
                        description="Pulls the final scorecard, auto-computes every drafted player's points, ranks contests, and pays out winners. Cannot be undone."
                        onConfirm={() => finalizeMatch(m.id)}
                        disabled={m.status === 'settled'}
                      >
                        <Button size="small" type="primary" disabled={m.status === 'settled'} loading={finalizingFor === m.id}>
                          Finalize (Auto)
                        </Button>
                      </Popconfirm>
                    </Space>
                  }
                >
                  <Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
                    Starts: {new Date(m.start_time).toLocaleString()} · Status: <Tag color={m.status === 'settled' ? 'red' : 'green'}>{m.status}</Tag>
                  </Text>

                  {leaguesByMatch[m.id] && (
                    <>
                      <Divider style={{ margin: '8px 0' }} />
                      {leaguesByMatch[m.id].length === 0 ? (
                        <Text type="secondary">No contests created for this match yet.</Text>
                      ) : (
                        leaguesByMatch[m.id].map(l => (
                          <div key={l.id} style={{ marginTop: 6 }}>
                            <Space wrap>
                              <Text strong>{l.name}</Text>
                              <Tag>{l.current_entries}/{l.max_entries} joined</Tag>
                              <Tag color={l.status === 'settled' ? 'red' : 'green'}>{l.status}</Tag>
                              <Text type="secondary">₹{Number(l.entry_fee)} entry · ₹{Number(l.prize_pool)} pool</Text>
                              <Popconfirm title="Delete this contest?" description="Blocked if it has joined entries and isn't settled yet." onConfirm={() => deleteLeague(l.id, m.id)}>
                                <Button size="small" danger type="text" icon={<DeleteOutlined />} />
                              </Popconfirm>
                            </Space>
                          </div>
                        ))
                      )}
                    </>
                  )}
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
                  { title: 'Credits', dataIndex: 'credits', render: (c: any) => `${Number(c).toFixed(1)}` },
                  {
                    title: '', dataIndex: 'id', width: 40,
                    render: (id: string) => (
                      <Popconfirm title="Delete this player?" description="Blocked if set as a fantasy team's captain/vice-captain." onConfirm={() => deletePlayer(id)}>
                        <Button size="small" danger type="text" icon={<DeleteOutlined />} />
                      </Popconfirm>
                    ),
                  },
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
            <Card title="Live Fantasy Leaderboard" loading={loadingLive}>
              {liveMatch ? (
                <div>
                  <Typography.Title level={5} style={{ color: '#d4af37' }}>
                    📈 {liveMatch.team_a} vs {liveMatch.team_b} — points auto-update every ~2 min while the match is live
                  </Typography.Title>
                  {(leaguesByMatch[liveMatch.id] || []).length === 0 ? (
                    <Text type="secondary">No fantasy contests for this match yet.</Text>
                  ) : (
                    leaguesByMatch[liveMatch.id].map(l => (
                      <Card key={l.id} type="inner" style={{ marginBottom: 12 }}
                        title={<span>{l.name} <Tag color={l.status === 'settled' ? 'red' : 'green'}>{l.status}</Tag></span>}>
                        <Text type="secondary">{l.current_entries}/{l.max_entries} joined · ₹{Number(l.prize_pool)} pool — open the contest in-app to see live per-team ranks.</Text>
                      </Card>
                    ))
                  )}
                </div>
              ) : (
                <Text type="secondary">Select a match on the left to see its fantasy contests.</Text>
              )}
            </Card>
          </Col>
        </Row>
      )
    }
  ]

  return (
    <div>
      <h2 style={{ color: '#d4af37', marginBottom: 24 }}>🏏 Cricket Fantasy Management</h2>
      <Tabs defaultActiveKey="matches" items={tabItems} style={{ background: '#fff', padding: 24, borderRadius: 8, boxShadow: '0 1px 4px rgba(0,0,0,0.1)' }} />

      {/* Add Match Modal */}
      <Modal open={matchOpen} title="Add Cricket Match" onCancel={() => setMatchOpen(false)} onOk={() => mForm.submit()} okText="Add">
        <Form form={mForm} layout="vertical" onFinish={createMatch}>
          <Form.Item name="series" label="Series" rules={[{ required: true }]}>
            <Select
              showSearch
              placeholder="Select a series"
              options={seriesCatalog.map(s => ({ value: s.name, label: s.name }))}
              filterOption={(input, option) => (option?.label as string).toLowerCase().includes(input.toLowerCase())}
              notFoundContent={<Text type="secondary">No match — add it to the Series Catalog card first.</Text>}
            />
          </Form.Item>
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
            { title: 'Matches', dataIndex: 'matchCount' },
            {
              title: 'Action',
              render: (record: any) => (
                <Space>
                  <Button
                    size="small"
                    type="primary"
                    loading={importingSeriesId === record.id}
                    onClick={() => importSeriesMatches(record.id)}
                  >
                    Import Matches
                  </Button>
                  <Button
                    size="small"
                    icon={<TeamOutlined />}
                    loading={syncingSeriesSquadsId === record.id}
                    onClick={() => syncSeriesSquads(record.id)}
                  >
                    Sync Squads
                  </Button>
                </Space>
              )
            }
          ]}
        />
      </Modal>

      {/* Scoring Rulebook Modal */}
      <Modal open={rulesOpen} title="🏆 Dream11-Style Scoring Rulebook" onCancel={() => setRulesOpen(false)} onOk={() => rForm.submit()} okText="Save Rulebook" confirmLoading={savingRules} width={640}>
        <Text type="secondary" style={{ display: 'block', marginBottom: 16 }}>
          Points are computed automatically from the live scorecard. These defaults match Dream11's published T20 point values — only change them if you want different contest economics.
        </Text>
        <Form form={rForm} layout="vertical" onFinish={saveScoringRules}>
          <Divider style={{ margin: '8px 0' }}>Batting</Divider>
          <Row gutter={12}>
            <Col span={8}><Form.Item name="runPoint" label="Per Run"><InputNumber style={{ width: '100%' }} /></Form.Item></Col>
            <Col span={8}><Form.Item name="boundaryBonus" label="Four Bonus"><InputNumber style={{ width: '100%' }} /></Form.Item></Col>
            <Col span={8}><Form.Item name="sixBonus" label="Six Bonus"><InputNumber style={{ width: '100%' }} /></Form.Item></Col>
          </Row>
          <Row gutter={12}>
            <Col span={6}><Form.Item name="bonus25Runs" label="25 Runs"><InputNumber style={{ width: '100%' }} /></Form.Item></Col>
            <Col span={6}><Form.Item name="bonus50Runs" label="50 Runs"><InputNumber style={{ width: '100%' }} /></Form.Item></Col>
            <Col span={6}><Form.Item name="bonus75Runs" label="75 Runs"><InputNumber style={{ width: '100%' }} /></Form.Item></Col>
            <Col span={6}><Form.Item name="bonus100Runs" label="100 Runs"><InputNumber style={{ width: '100%' }} /></Form.Item></Col>
          </Row>
          <Row gutter={12}>
            <Col span={12}><Form.Item name="duckPenalty" label="Duck Penalty"><InputNumber style={{ width: '100%' }} /></Form.Item></Col>
          </Row>

          <Divider style={{ margin: '8px 0' }}>Bowling</Divider>
          <Row gutter={12}>
            <Col span={12}><Form.Item name="wicketPoints" label="Per Wicket"><InputNumber style={{ width: '100%' }} /></Form.Item></Col>
            <Col span={12}><Form.Item name="maidenOverPoints" label="Maiden Over"><InputNumber style={{ width: '100%' }} /></Form.Item></Col>
          </Row>
          <Row gutter={12}>
            <Col span={8}><Form.Item name="bonus4Wickets" label="4-Wkt Bonus"><InputNumber style={{ width: '100%' }} /></Form.Item></Col>
            <Col span={8}><Form.Item name="bonus5Wickets" label="5-Wkt Bonus"><InputNumber style={{ width: '100%' }} /></Form.Item></Col>
            <Col span={8}><Form.Item name="bowledLbwBonus" label="Bowled/LBW Bonus"><InputNumber style={{ width: '100%' }} /></Form.Item></Col>
          </Row>

          <Divider style={{ margin: '8px 0' }}>Fielding</Divider>
          <Row gutter={12}>
            <Col span={6}><Form.Item name="catchPoints" label="Per Catch"><InputNumber style={{ width: '100%' }} /></Form.Item></Col>
            <Col span={6}><Form.Item name="bonus3Catches" label="3-Catch Bonus"><InputNumber style={{ width: '100%' }} /></Form.Item></Col>
            <Col span={6}><Form.Item name="stumpingPoints" label="Stumping"><InputNumber style={{ width: '100%' }} /></Form.Item></Col>
            <Col span={6}><Form.Item name="runOutPoints" label="Run Out"><InputNumber style={{ width: '100%' }} /></Form.Item></Col>
          </Row>

          <Divider style={{ margin: '8px 0' }}>Captaincy</Divider>
          <Row gutter={12}>
            <Col span={12}><Form.Item name="captainMultiplier" label="Captain Multiplier"><InputNumber step={0.1} style={{ width: '100%' }} /></Form.Item></Col>
            <Col span={12}><Form.Item name="viceCaptainMultiplier" label="Vice-Captain Multiplier"><InputNumber step={0.1} style={{ width: '100%' }} /></Form.Item></Col>
          </Row>
          <Text type="secondary" style={{ fontSize: 12 }}>
            Strike-rate and economy-rate bonus bands use Dream11's standard tiers and aren't editable here — ask engineering if you need those changed.
          </Text>
        </Form>
      </Modal>
    </div>
  )
}
