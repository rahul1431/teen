import { useEffect, useState } from 'react'
import {
  Card, Form, Switch, InputNumber, Select, Button, Table, Tag,
  Space, Modal, Input, Typography, Divider, Popconfirm, message, Row, Col, DatePicker, Tabs, Alert, Avatar, Upload, Statistic
} from 'antd'
import {
  ReloadOutlined, PlusOutlined, SyncOutlined, CloudDownloadOutlined, DeleteOutlined,
  TrophyOutlined, UploadOutlined, CheckCircleOutlined, DollarOutlined,
  FireOutlined, HistoryOutlined, SettingOutlined, GlobalOutlined, AppstoreOutlined, ClockCircleOutlined
} from '@ant-design/icons'
import dayjs from 'dayjs'
import { adminApi } from '../../api/client'

const { Text, Title } = Typography

function matchLabel(m: any): string {
  if (!m) return ''
  const date = new Date(m.start_time)
  const dateStr = date.toLocaleDateString(undefined, { day: '2-digit', month: 'short' })
  const timeStr = date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  return `${m.team_a} vs ${m.team_b} · ${dateStr} ${timeStr} (${m.series || 'Match'}) [#${m.id?.slice(0, 8)}]`
}

function TeamFlagUploadField({ form }: { form: any }) {
  const [uploading, setUploading] = useState(false)
  const url: string | undefined = Form.useWatch('flag_url', form)

  const upload = async (file: File) => {
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await adminApi.post('/uploads/cricket-flag', fd, { headers: { 'Content-Type': 'multipart/form-data' } })
      form.setFieldsValue({ flag_url: res.data.url })
      message.success('Flag uploaded')
    } catch (e: any) {
      message.error(e.response?.data?.error || 'Upload failed')
    } finally { setUploading(false) }
  }

  return (
    <Form.Item label="Team Flag Icon">
      <Form.Item name="flag_url" noStyle>
        <Input type="hidden" />
      </Form.Item>
      <Space direction="vertical">
        <Upload showUploadList={false} accept="image/*" maxCount={1}
          beforeUpload={(file) => { upload(file as File); return false }}>
          <Button icon={<UploadOutlined />} loading={uploading}>{url ? 'Replace Flag' : 'Upload Flag'}</Button>
        </Upload>
        <Input placeholder="Or paste flag image URL" value={url} onChange={e => form.setFieldsValue({ flag_url: e.target.value })} />
        {url && <img src={url} alt="Flag" style={{ width: 48, height: 32, objectFit: 'cover', border: '1px solid #eee', borderRadius: 4 }} />}
      </Space>
    </Form.Item>
  )
}

export default function Cricket() {
  const [activeTab, setActiveTab] = useState('matches')
  const [matches, setMatches] = useState<any[]>([])
  const [teams, setTeams] = useState<any[]>([])
  const [seriesCatalog, setSeriesCatalog] = useState<any[]>([])
  const [oddsMarkets, setOddsMarkets] = useState<any[]>([])
  const [oddsBets, setOddsBets] = useState<any[]>([])
  const [sessionBets, setSessionBets] = useState<any[]>([])
  const [loading, setLoading] = useState(false)

  // Modals state
  const [addMatchModal, setAddMatchModal] = useState(false)
  const [scoreModal, setScoreModal] = useState(false)
  const [selectedMatch, setSelectedMatch] = useState<any>(null)
  const [finalizeModal, setFinalizeModal] = useState(false)
  const [marketModal, setMarketModal] = useState(false)
  const [sessionModal, setSessionModal] = useState(false)
  const [bulkSessionModal, setBulkSessionModal] = useState(false)
  const [settleSessionModal, setSettleSessionModal] = useState(false)
  const [selectedSession, setSelectedSession] = useState<any>(null)
  const [teamModal, setTeamModal] = useState(false)
  const [editingTeam, setEditingTeam] = useState<any>(null)

  // API Sync State
  const [syncingApi, setSyncingApi] = useState(false)
  const [syncingSeries, setSyncingSeries] = useState(false)
  const [seriesQuery, setSeriesQuery] = useState('')
  const [foundSeries, setFoundSeries] = useState<any[]>([])

  // Forms
  const [configForm] = Form.useForm()
  const [matchForm] = Form.useForm()
  const [scoreForm] = Form.useForm()
  const [finalizeForm] = Form.useForm()
  const [marketForm] = Form.useForm()
  const [sessionForm] = Form.useForm()
  const [bulkSessionForm] = Form.useForm()
  const [settleSessionForm] = Form.useForm()
  const [teamForm] = Form.useForm()
  const [newSeriesName, setNewSeriesName] = useState('')

  // Load Data
  const loadAll = async () => {
    setLoading(true)
    try {
      const [mRes, tRes, sRes, mkRes, bRes, sbRes, cfgRes] = await Promise.all([
        adminApi.get('/betting/cricket/matches').catch(() => ({ data: { matches: [] } })),
        adminApi.get('/betting/cricket/teams').catch(() => ({ data: { teams: [] } })),
        adminApi.get('/betting/cricket/series-catalog').catch(() => ({ data: { series: [] } })),
        adminApi.get('/betting/cricket/odds/markets').catch(() => ({ data: { markets: [] } })),
        adminApi.get('/betting/cricket/bets').catch(() => ({ data: { bets: [] } })),
        adminApi.get('/betting/cricket/session/bets').catch(() => ({ data: { bets: [] } })),
        adminApi.get('/game-configs').catch(() => ({ data: [] })),
      ])
      setMatches(mRes.data?.matches || [])
      setTeams(tRes.data?.teams || [])
      setSeriesCatalog(sRes.data?.series || [])
      setOddsMarkets(mkRes.data?.markets || [])
      setOddsBets(bRes.data?.bets || [])
      setSessionBets(sbRes.data?.bets || [])

      const ckConfig = Array.isArray(cfgRes.data) ? cfgRes.data.find((c: any) => c.game_type === 'cricket') : null
      if (ckConfig) {
        configForm.setFieldsValue({
          is_active: ckConfig.is_active,
          min_bet: ckConfig.min_bet ?? 10,
          max_bet: ckConfig.max_bet ?? 50000,
          house_edge_pct: ckConfig.house_edge_pct ?? 5,
          auto_settle: ckConfig.special_rules?.auto_settle ?? true,
        })
      }
    } catch (err: any) {
      message.error(err.message || 'Failed loading cricket data')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadAll()
  }, [])

  // Action Handlers
  const handleSaveConfig = async (values: any) => {
    try {
      await adminApi.patch('/game-configs/cricket', {
        is_active: values.is_active,
        min_bet: values.min_bet,
        max_bet: values.max_bet,
        house_edge_pct: values.house_edge_pct,
        special_rules: { auto_settle: values.auto_settle },
      })
      message.success('Cricket configuration saved!')
    } catch (e: any) {
      message.error(e.response?.data?.error || 'Failed saving config')
    }
  }

  const handleCreateMatch = async (values: any) => {
    try {
      await adminApi.post('/betting/cricket/match', {
        series: values.series,
        format: values.format,
        team_a: values.team_a,
        team_b: values.team_b,
        team_a_short: values.team_a_short,
        team_b_short: values.team_b_short,
        start_time: values.start_time.toISOString(),
      })
      message.success('Match created successfully!')
      setAddMatchModal(false)
      matchForm.resetFields()
      loadAll()
    } catch (e: any) {
      message.error(e.response?.data?.error || 'Failed creating match')
    }
  }

  const handleUpdateScore = async (values: any) => {
    if (!selectedMatch) return
    try {
      const liveScore = {
        runs: values.runs ?? 0,
        wickets: values.wickets ?? 0,
        overs: values.overs ? String(values.overs) : '0.0',
        target: values.target ? Number(values.target) : undefined,
        description: values.description || undefined,
      }
      await adminApi.post('/betting/cricket/scores/update', {
        match_id: selectedMatch.id,
        live_score: liveScore,
        status: values.status,
        live_tv_url: values.live_tv_url,
      })
      message.success('Live scores updated!')
      setScoreModal(false)
      loadAll()
    } catch (e: any) {
      message.error(e.response?.data?.error || 'Failed updating score')
    }
  }

  const handleFinalizeMatch = async (values: any) => {
    if (!selectedMatch) return
    try {
      await adminApi.post('/betting/cricket/odds/finalize', {
        match_id: selectedMatch.id,
        winner_key: values.winner_key,
      })
      message.success('Match finalized and winning odds bets credited!')
      setFinalizeModal(false)
      loadAll()
    } catch (e: any) {
      message.error(e.response?.data?.error || 'Failed finalizing match')
    }
  }

  const handleDeleteMatch = async (id: string) => {
    try {
      await adminApi.delete(`/betting/cricket/matches/${id}`)
      message.success('Match deleted')
      loadAll()
    } catch (e: any) {
      message.error(e.response?.data?.error || 'Failed deleting match')
    }
  }

  const handleCreateMarket = async (values: any) => {
    try {
      const options = [
        { key: 'team_a', label: values.option_a_label, odds: Number(values.option_a_odds) },
        { key: 'team_b', label: values.option_b_label, odds: Number(values.option_b_odds) },
      ]
      if (values.option_draw_label && values.option_draw_odds) {
        options.push({ key: 'draw', label: values.option_draw_label, odds: Number(values.option_draw_odds) })
      }
      await adminApi.post('/betting/cricket/odds/market/create', {
        match_id: values.match_id,
        market_type: values.market_type || 'match_winner',
        label: values.label,
        options,
      })
      message.success('Odds market created!')
      setMarketModal(false)
      marketForm.resetFields()
      loadAll()
    } catch (e: any) {
      message.error(e.response?.data?.error || 'Failed creating market')
    }
  }

  const handleDeleteMarket = async (id: string) => {
    try {
      await adminApi.delete(`/betting/cricket/odds/markets/${id}`)
      message.success('Market deleted')
      loadAll()
    } catch (e: any) {
      message.error(e.response?.data?.error || 'Failed deleting market')
    }
  }

  const handleCreateSession = async (values: any) => {
    try {
      await adminApi.post('/betting/cricket/session/create', values)
      message.success('Session bracket created!')
      setSessionModal(false)
      sessionForm.resetFields()
      loadAll()
    } catch (e: any) {
      message.error(e.response?.data?.error || 'Failed creating session')
    }
  }

  const handleBulkCreateSessions = async (values: any) => {
    try {
      const res = await adminApi.post('/betting/cricket/session/bulk-create', values)
      message.success(`Created ${res.data?.created || 0} session brackets!`)
      setBulkSessionModal(false)
      bulkSessionForm.resetFields()
      loadAll()
    } catch (e: any) {
      message.error(e.response?.data?.error || 'Failed bulk creating sessions')
    }
  }

  const handleSettleSession = async (values: any) => {
    if (!selectedSession) return
    try {
      await adminApi.post('/betting/cricket/session/settle', {
        session_id: selectedSession.id,
        result_runs: values.result_runs !== undefined ? Number(values.result_runs) : null,
      })
      message.success('Session settled and winning bets paid out!')
      setSettleSessionModal(false)
      loadAll()
    } catch (e: any) {
      message.error(e.response?.data?.error || 'Failed settling session')
    }
  }

  const handleDeleteSession = async (id: string) => {
    try {
      await adminApi.delete(`/betting/cricket/sessions/${id}`)
      message.success('Session deleted')
      loadAll()
    } catch (e: any) {
      message.error(e.response?.data?.error || 'Failed deleting session')
    }
  }

  const handleVoidBet = async (id: string, isSession: boolean) => {
    try {
      const endpoint = isSession ? `/betting/cricket/session/bets/${id}/void` : `/betting/cricket/bets/${id}/void`
      await adminApi.post(endpoint, {})
      message.success('Bet voided and stake refunded to player wallet!')
      loadAll()
    } catch (e: any) {
      message.error(e.response?.data?.error || 'Failed voiding bet')
    }
  }

  const handleSyncApi = async () => {
    setSyncingApi(true)
    try {
      const r = await adminApi.post('/betting/cricket/sync-api', {})
      message.success(`Synced API: ${r.data?.inserted || 0} new matches, ${r.data?.updated || 0} updated.`)
      loadAll()
    } catch (e: any) {
      message.error(e.response?.data?.error || 'API sync failed')
    } finally { setSyncingApi(false) }
  }

  const handleSyncTeams = async () => {
    try {
      const r = await adminApi.post('/betting/cricket/sync-countries', {})
      message.success(`Synced ${r.data?.count || 0} teams & flag icons.`)
      loadAll()
    } catch (e: any) {
      message.error(e.response?.data?.error || 'Teams sync failed')
    }
  }

  const handleSearchSeries = async () => {
    if (!seriesQuery.trim()) return
    setSyncingSeries(true)
    try {
      const r = await adminApi.post('/betting/cricket/sync-series', { search: seriesQuery })
      setFoundSeries(r.data?.series || [])
    } catch (e: any) {
      message.error(e.response?.data?.error || 'Series search failed')
    } finally { setSyncingSeries(false) }
  }

  const handleImportSeries = async (seriesId: string) => {
    try {
      const r = await adminApi.post('/betting/cricket/import-series-matches', { series_id: seriesId })
      message.success(`Imported series: ${r.data?.inserted || 0} matches added.`)
      loadAll()
    } catch (e: any) {
      message.error(e.response?.data?.error || 'Import failed')
    }
  }

  const handleAddSeriesCatalog = async () => {
    if (!newSeriesName.trim()) return
    try {
      await adminApi.post('/betting/cricket/series-catalog', { name: newSeriesName.trim() })
      message.success('Series added to catalog')
      setNewSeriesName('')
      loadAll()
    } catch (e: any) {
      message.error(e.response?.data?.error || 'Failed adding series')
    }
  }

  const handleDeleteSeriesCatalog = async (id: string) => {
    try {
      await adminApi.delete(`/betting/cricket/series-catalog/${id}`)
      message.success('Series removed from catalog')
      loadAll()
    } catch (e: any) {
      message.error(e.response?.data?.error || 'Failed removing series')
    }
  }

  const handleSaveTeam = async (values: any) => {
    try {
      if (editingTeam) {
        await adminApi.patch(`/betting/cricket/teams/${editingTeam.id}`, values)
        message.success('Team updated')
      } else {
        await adminApi.post('/betting/cricket/teams', values)
        message.success('Team added')
      }
      setTeamModal(false)
      setEditingTeam(null)
      teamForm.resetFields()
      loadAll()
    } catch (e: any) {
      message.error(e.response?.data?.error || 'Failed saving team')
    }
  }

  // Calculate live statistics
  const liveCount = matches.filter(m => m.status === 'live').length
  const upcomingCount = matches.filter(m => m.status === 'upcoming').length
  const totalOddsBetsStaked = oddsBets.reduce((acc, b) => acc + (Number(b.amount) || 0), 0)
  const totalSessionBetsStaked = sessionBets.reduce((acc, b) => acc + (Number(b.amount) || 0), 0)

  return (
    <div style={{ padding: '0 8px 24px' }}>
      {/* Header Bar */}
      <Row justify="space-between" align="middle" style={{ marginBottom: 16 }}>
        <Col>
          <Title level={4} style={{ margin: 0 }}>🏏 Cricket Odds & Session Betting Management</Title>
          <Text type="secondary">Manage live fixtures, decimal odds markets, over session brackets, and bets in ₹ (Rupees)</Text>
        </Col>
        <Col>
          <Space>
            <Button icon={<SyncOutlined />} onClick={loadAll} loading={loading}>Refresh</Button>
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setAddMatchModal(true)}>Add Match</Button>
          </Space>
        </Col>
      </Row>

      {/* Top Metrics Cards */}
      <Row gutter={[16, 16]} style={{ marginBottom: 20 }}>
        <Col xs={12} sm={6} md={4}>
          <Card size="small" bordered={false} style={{ background: '#141414' }}>
            <Statistic title="Total Fixtures" value={matches.length} prefix={<TrophyOutlined style={{ color: '#faad14' }} />} />
          </Card>
        </Col>
        <Col xs={12} sm={6} md={4}>
          <Card size="small" bordered={false} style={{ background: '#141414' }}>
            <Statistic title="Live Matches" value={liveCount} valueStyle={{ color: '#ff4d4f' }} prefix={<FireOutlined />} />
          </Card>
        </Col>
        <Col xs={12} sm={6} md={4}>
          <Card size="small" bordered={false} style={{ background: '#141414' }}>
            <Statistic title="Upcoming" value={upcomingCount} prefix={<ClockCircleOutlined style={{ color: '#52c41a' }} />} />
          </Card>
        </Col>
        <Col xs={12} sm={6} md={4}>
          <Card size="small" bordered={false} style={{ background: '#141414' }}>
            <Statistic title="Open Markets" value={oddsMarkets.length} prefix={<AppstoreOutlined style={{ color: '#1890ff' }} />} />
          </Card>
        </Col>
        <Col xs={12} sm={6} md={4}>
          <Card size="small" bordered={false} style={{ background: '#141414' }}>
            <Statistic title="Odds Staked (₹)" value={totalOddsBetsStaked} precision={2} prefix={<DollarOutlined style={{ color: '#faad14' }} />} />
          </Card>
        </Col>
        <Col xs={12} sm={6} md={4}>
          <Card size="small" bordered={false} style={{ background: '#141414' }}>
            <Statistic title="Session Staked (₹)" value={totalSessionBetsStaked} precision={2} prefix={<DollarOutlined style={{ color: '#52c41a' }} />} />
          </Card>
        </Col>
      </Row>

      {/* Main Tabs Container */}
      <Card bordered={false}>
        <Tabs activeKey={activeTab} onChange={setActiveTab} items={[
          {
            key: 'matches',
            label: <span><TrophyOutlined /> Fixtures & Live Operations ({matches.length})</span>,
            children: (
              <div>
                <Row justify="space-between" align="middle" style={{ marginBottom: 12 }}>
                  <Text strong>Active & Scheduled Cricket Fixtures</Text>
                  <Space>
                    <Button icon={<CloudDownloadOutlined />} onClick={handleSyncApi} loading={syncingApi}>Sync CricAPI Live Matches</Button>
                    <Button type="primary" icon={<PlusOutlined />} onClick={() => setAddMatchModal(true)}>Add Match</Button>
                  </Space>
                </Row>
                <Table
                  dataSource={matches}
                  rowKey="id"
                  loading={loading}
                  pagination={{ pageSize: 15 }}
                  columns={[
                    {
                      title: 'Status',
                      dataIndex: 'status',
                      width: 100,
                      render: (st: string) => {
                        if (st === 'live') return <Tag color="red" icon={<FireOutlined />}>LIVE</Tag>
                        if (st === 'upcoming') return <Tag color="green">UPCOMING</Tag>
                        if (st === 'settled') return <Tag color="blue">SETTLED</Tag>
                        return <Tag>{st?.toUpperCase()}</Tag>
                      }
                    },
                    {
                      title: 'Series / Tournament',
                      dataIndex: 'series',
                      render: (series: string, r: any) => (
                        <div>
                          <Text strong>{series || 'Bilateral Series'}</Text>
                          <div><Tag color="cyan">{r.format?.toUpperCase() || 'T20'}</Tag></div>
                        </div>
                      )
                    },
                    {
                      title: 'Teams & Fixture',
                      render: (_: any, r: any) => (
                        <Space align="center">
                          {r.team_a_flag && <Avatar src={r.team_a_flag} size="small" shape="square" />}
                          <Text strong>{r.team_a}</Text>
                          <Text type="secondary">vs</Text>
                          <Text strong>{r.team_b}</Text>
                          {r.team_b_flag && <Avatar src={r.team_b_flag} size="small" shape="square" />}
                        </Space>
                      )
                    },
                    {
                      title: 'Live Score',
                      dataIndex: 'live_score',
                      render: (sc: any) => {
                        if (!sc || (!sc.runs && !sc.overs)) return <Text type="secondary">-</Text>
                        return (
                          <div>
                            <Text strong style={{ color: '#faad14' }}>{sc.runs || 0}/{sc.wickets || 0}</Text>
                            <Text type="secondary"> ({sc.overs || 0} ov)</Text>
                            {sc.target && <div><Text type="secondary" style={{ fontSize: 11 }}>Target: {sc.target}</Text></div>}
                          </div>
                        )
                      }
                    },
                    {
                      title: 'Start Time',
                      dataIndex: 'start_time',
                      render: (t: string) => dayjs(t).format('DD MMM YYYY, hh:mm A')
                    },
                    {
                      title: 'Markets / Sessions',
                      render: (_: any, r: any) => (
                        <Space>
                          <Tag color="gold">{r.markets?.length || 0} Markets</Tag>
                          <Tag color="purple">{r.sessions?.length || 0} Sessions</Tag>
                        </Space>
                      )
                    },
                    {
                      title: 'Actions',
                      render: (_: any, r: any) => (
                        <Space wrap>
                          <Button size="small" type="primary" ghost onClick={() => {
                            setSelectedMatch(r)
                            scoreForm.setFieldsValue({
                              status: r.status,
                              runs: r.live_score?.runs,
                              wickets: r.live_score?.wickets,
                              overs: r.live_score?.overs,
                              target: r.live_score?.target,
                              description: r.live_score?.description,
                              live_tv_url: r.live_tv_url,
                            })
                            setScoreModal(true)
                          }}>Score & TV</Button>
                          <Button size="small" onClick={() => {
                            setSelectedMatch(r)
                            finalizeForm.resetFields()
                            setFinalizeModal(true)
                          }}>Finalize</Button>
                          <Popconfirm title="Delete this match?" onConfirm={() => handleDeleteMatch(r.id)}>
                            <Button size="small" danger icon={<DeleteOutlined />} />
                          </Popconfirm>
                        </Space>
                      )
                    }
                  ]}
                />
              </div>
            )
          },
          {
            key: 'markets',
            label: <span><AppstoreOutlined /> Odds Markets ({oddsMarkets.length})</span>,
            children: (
              <div>
                <Row justify="space-between" align="middle" style={{ marginBottom: 12 }}>
                  <Text strong>Active Match-Odds & Moneyline Markets</Text>
                  <Button type="primary" icon={<PlusOutlined />} onClick={() => {
                    marketForm.resetFields()
                    setMarketModal(true)
                  }}>Create Odds Market</Button>
                </Row>
                <Table
                  dataSource={oddsMarkets}
                  rowKey="id"
                  loading={loading}
                  pagination={{ pageSize: 15 }}
                  columns={[
                    {
                      title: 'Market Type / Label',
                      render: (_: any, r: any) => (
                        <div>
                          <Text strong>{r.label}</Text>
                          <div><Tag color="blue">{r.market_type}</Tag></div>
                        </div>
                      )
                    },
                    {
                      title: 'Match',
                      render: (_: any, r: any) => `${r.team_a || 'Team A'} vs ${r.team_b || 'Team B'} (${r.series || ''})`
                    },
                    {
                      title: 'Options & Decimal Odds',
                      dataIndex: 'options',
                      render: (opts: any) => {
                        const parsed = typeof opts === 'string' ? JSON.parse(opts) : (opts || [])
                        return (
                          <Space wrap>
                            {parsed.map((opt: any, i: number) => (
                              <Tag color="gold" key={i} style={{ padding: '2px 8px' }}>
                                <Text strong>{opt.label}: </Text>
                                <Text style={{ color: '#d46b08', fontWeight: 800 }}>{Number(opt.odds).toFixed(2)}x</Text>
                              </Tag>
                            ))}
                          </Space>
                        )
                      }
                    },
                    {
                      title: 'Status',
                      dataIndex: 'status',
                      render: (st: string) => <Tag color={st === 'open' ? 'green' : 'default'}>{st?.toUpperCase()}</Tag>
                    },
                    {
                      title: 'Actions',
                      render: (_: any, r: any) => (
                        <Popconfirm title="Delete this odds market?" onConfirm={() => handleDeleteMarket(r.id)}>
                          <Button size="small" danger icon={<DeleteOutlined />}>Delete</Button>
                        </Popconfirm>
                      )
                    }
                  ]}
                />
              </div>
            )
          },
          {
            key: 'sessions',
            label: <span><ClockCircleOutlined /> Session / Fancy Betting</span>,
            children: (
              <div>
                <Row justify="space-between" align="middle" style={{ marginBottom: 12 }}>
                  <Text strong>Over-Bracket Fancy & Session Betting</Text>
                  <Space>
                    <Button icon={<AppstoreOutlined />} onClick={() => {
                      bulkSessionForm.resetFields()
                      setBulkSessionModal(true)
                    }}>Bulk Create Over Brackets</Button>
                    <Button type="primary" icon={<PlusOutlined />} onClick={() => {
                      sessionForm.resetFields()
                      setSessionModal(true)
                    }}>Add Single Session</Button>
                  </Space>
                </Row>
                <Table
                  dataSource={matches.flatMap(m => (m.sessions || []).map((s: any) => ({ ...s, match: m })))}
                  rowKey="id"
                  loading={loading}
                  pagination={{ pageSize: 15 }}
                  columns={[
                    {
                      title: 'Match',
                      dataIndex: 'match',
                      render: (m: any) => `${m.team_a} vs ${m.team_b}`
                    },
                    {
                      title: 'Session Bracket',
                      dataIndex: 'label',
                      render: (l: string, r: any) => (
                        <div>
                          <Text strong>{l}</Text>
                          <div><Text type="secondary">Runs Bracket: {r.min_runs} - {r.max_runs}</Text></div>
                        </div>
                      )
                    },
                    {
                      title: 'Odds (Yes / No)',
                      render: (_: any, r: any) => (
                        <Space>
                          <Tag color="green">Yes: {Number(r.odds_yes || 1.0).toFixed(2)}x</Tag>
                          <Tag color="red">No: {Number(r.odds_no || 1.0).toFixed(2)}x</Tag>
                        </Space>
                      )
                    },
                    {
                      title: 'Status / Result',
                      render: (_: any, r: any) => (
                        <div>
                          <Tag color={r.status === 'open' ? 'green' : 'blue'}>{r.status?.toUpperCase()}</Tag>
                          {r.result_runs !== null && r.result_runs !== undefined && (
                            <Text strong style={{ color: '#faad14' }}> (Result: {r.result_runs} runs)</Text>
                          )}
                        </div>
                      )
                    },
                    {
                      title: 'Actions',
                      render: (_: any, r: any) => (
                        <Space>
                          {r.status === 'open' && (
                            <Button size="small" type="primary" onClick={() => {
                              setSelectedSession(r)
                              settleSessionForm.resetFields()
                              setSettleSessionModal(true)
                            }}>Settle</Button>
                          )}
                          <Popconfirm title="Delete this session?" onConfirm={() => handleDeleteSession(r.id)}>
                            <Button size="small" danger icon={<DeleteOutlined />} />
                          </Popconfirm>
                        </Space>
                      )
                    }
                  ]}
                />
              </div>
            )
          },
          {
            key: 'bets',
            label: <span><HistoryOutlined /> Bets Explorer</span>,
            children: (
              <div>
                <Tabs items={[
                  {
                    key: 'odds_bets',
                    label: `Match-Odds Bets (${oddsBets.length})`,
                    children: (
                      <Table
                        dataSource={oddsBets}
                        rowKey="id"
                        pagination={{ pageSize: 15 }}
                        columns={[
                          {
                            title: 'User Phone',
                            dataIndex: 'user_phone',
                            render: (p: string) => p || 'Player'
                          },
                          {
                            title: 'Match / Market',
                            render: (_: any, r: any) => (
                              <div>
                                <Text strong>{r.team_a} vs {r.team_b}</Text>
                                <div><Text type="secondary">{r.market_label || 'Match Winner'}</Text></div>
                              </div>
                            )
                          },
                          {
                            title: 'Selected Option',
                            render: (_: any, r: any) => (
                              <Tag color="gold">{r.option_label} @ {Number(r.odds).toFixed(2)}x</Tag>
                            )
                          },
                          {
                            title: 'Stake (₹)',
                            dataIndex: 'amount',
                            render: (amt: any) => `₹ ${Number(amt).toFixed(2)}`
                          },
                          {
                            title: 'Potential Win (₹)',
                            dataIndex: 'potential_payout',
                            render: (payout: any) => (
                              <Text strong style={{ color: '#52c41a' }}>₹ {Number(payout).toFixed(2)}</Text>
                            )
                          },
                          {
                            title: 'Status',
                            dataIndex: 'status',
                            render: (st: string) => {
                              const color = st === 'won' ? 'green' : st === 'lost' ? 'red' : st === 'refunded' ? 'purple' : 'gold'
                              return <Tag color={color}>{st?.toUpperCase()}</Tag>
                            }
                          },
                          {
                            title: 'Placed At',
                            dataIndex: 'created_at',
                            render: (t: string) => dayjs(t).format('DD/MM/YY hh:mm A')
                          },
                          {
                            title: 'Actions',
                            render: (_: any, r: any) => r.status === 'pending' ? (
                              <Popconfirm title="Void and refund this bet stake in ₹?" onConfirm={() => handleVoidBet(r.id, false)}>
                                <Button size="small" danger>Void & Refund</Button>
                              </Popconfirm>
                            ) : null
                          }
                        ]}
                      />
                    )
                  },
                  {
                    key: 'session_bets',
                    label: `Session Bets (${sessionBets.length})`,
                    children: (
                      <Table
                        dataSource={sessionBets}
                        rowKey="id"
                        pagination={{ pageSize: 15 }}
                        columns={[
                          {
                            title: 'User Phone',
                            dataIndex: 'user_phone',
                            render: (p: string) => p || 'Player'
                          },
                          {
                            title: 'Match / Session',
                            render: (_: any, r: any) => (
                              <div>
                                <Text strong>{r.team_a} vs {r.team_b}</Text>
                                <div><Text type="secondary">{r.session_label}</Text></div>
                              </div>
                            )
                          },
                          {
                            title: 'Selection',
                            dataIndex: 'selection',
                            render: (sel: string) => (
                              <Tag color={sel === 'yes' ? 'green' : 'red'}>{sel?.toUpperCase()}</Tag>
                            )
                          },
                          {
                            title: 'Stake (₹)',
                            dataIndex: 'amount',
                            render: (amt: any) => `₹ ${Number(amt).toFixed(2)}`
                          },
                          {
                            title: 'Potential Win (₹)',
                            dataIndex: 'potential_payout',
                            render: (payout: any) => (
                              <Text strong style={{ color: '#52c41a' }}>₹ {Number(payout).toFixed(2)}</Text>
                            )
                          },
                          {
                            title: 'Status',
                            dataIndex: 'status',
                            render: (st: string) => {
                              const color = st === 'won' ? 'green' : st === 'lost' ? 'red' : st === 'refunded' ? 'purple' : 'gold'
                              return <Tag color={color}>{st?.toUpperCase()}</Tag>
                            }
                          },
                          {
                            title: 'Placed At',
                            dataIndex: 'created_at',
                            render: (t: string) => dayjs(t).format('DD/MM/YY hh:mm A')
                          },
                          {
                            title: 'Actions',
                            render: (_: any, r: any) => r.status === 'pending' ? (
                              <Popconfirm title="Void and refund this session bet stake in ₹?" onConfirm={() => handleVoidBet(r.id, true)}>
                                <Button size="small" danger>Void & Refund</Button>
                              </Popconfirm>
                            ) : null
                          }
                        ]}
                      />
                    )
                  }
                ]} />
              </div>
            )
          },
          {
            key: 'sync',
            label: <span><GlobalOutlined /> API & Tournament Import</span>,
            children: (
              <div>
                <Alert
                  type="info"
                  showIcon
                  message="Live Cricket Feeds & The Odds API Sync"
                  description="Use the automated tools below to sync real-time matches from CricAPI, sync country flags and teams, or search and import entire tournament series (IPL, ICC World Cup, BBL)."
                  style={{ marginBottom: 16 }}
                />
                <Row gutter={[16, 16]}>
                  <Col xs={24} md={12}>
                    <Card title="CricAPI Live Feeds Sync" size="small">
                      <Space direction="vertical" style={{ width: '100%' }}>
                        <Button icon={<CloudDownloadOutlined />} onClick={handleSyncApi} loading={syncingApi} block>
                          Sync Current Matches
                        </Button>
                        <Button icon={<SyncOutlined />} onClick={handleSyncTeams} block>
                          Sync Teams & Flag Icons
                        </Button>
                      </Space>
                    </Card>
                  </Col>
                  <Col xs={24} md={12}>
                    <Card title="Tournament Series Search & Import" size="small">
                      <Space.Compact style={{ width: '100%', marginBottom: 12 }}>
                        <Input placeholder="Search tournament (e.g. IPL 2026, World Cup)" value={seriesQuery} onChange={e => setSeriesQuery(e.target.value)} onPressEnter={handleSearchSeries} />
                        <Button type="primary" onClick={handleSearchSeries} loading={syncingSeries}>Search</Button>
                      </Space.Compact>
                      {foundSeries.length > 0 && (
                        <Table
                          size="small"
                          dataSource={foundSeries}
                          rowKey="id"
                          pagination={{ pageSize: 5 }}
                          columns={[
                            { title: 'Series Name', dataIndex: 'name' },
                            { title: 'Matches', dataIndex: 'matchCount' },
                            {
                              title: 'Action',
                              render: (_: any, r: any) => (
                                <Button size="small" type="primary" onClick={() => handleImportSeries(r.id)}>Import Matches</Button>
                              )
                            }
                          ]}
                        />
                      )}
                    </Card>
                  </Col>
                </Row>
              </div>
            )
          },
          {
            key: 'teams_catalog',
            label: <span><TrophyOutlined /> Teams & Tournament Catalog</span>,
            children: (
              <Row gutter={[16, 16]}>
                <Col xs={24} md={12}>
                  <Card title="Tournament Catalog" size="small" extra={
                    <Space.Compact>
                      <Input placeholder="Tournament Name" value={newSeriesName} onChange={e => setNewSeriesName(e.target.value)} />
                      <Button type="primary" onClick={handleAddSeriesCatalog}>Add</Button>
                    </Space.Compact>
                  }>
                    <Table
                      size="small"
                      dataSource={seriesCatalog}
                      rowKey="id"
                      pagination={{ pageSize: 8 }}
                      columns={[
                        { title: 'Tournament Name', dataIndex: 'name' },
                        {
                          title: 'Action',
                          render: (_: any, r: any) => (
                            <Popconfirm title="Delete tournament from catalog?" onConfirm={() => handleDeleteSeriesCatalog(r.id)}>
                              <Button size="small" danger icon={<DeleteOutlined />} />
                            </Popconfirm>
                          )
                        }
                      ]}
                    />
                  </Card>
                </Col>
                <Col xs={24} md={12}>
                  <Card title="Cricket Teams & Flags" size="small" extra={
                    <Button type="primary" size="small" icon={<PlusOutlined />} onClick={() => {
                      setEditingTeam(null)
                      teamForm.resetFields()
                      setTeamModal(true)
                    }}>Add Team</Button>
                  }>
                    <Table
                      size="small"
                      dataSource={teams}
                      rowKey="id"
                      pagination={{ pageSize: 8 }}
                      columns={[
                        {
                          title: 'Flag',
                          dataIndex: 'flag_url',
                          width: 60,
                          render: (f: string) => f ? <img src={f} alt="Flag" style={{ width: 32, height: 22, objectFit: 'cover', borderRadius: 2 }} /> : '-'
                        },
                        { title: 'Team Name', dataIndex: 'name' },
                        { title: 'Code', dataIndex: 'short_name' },
                        {
                          title: 'Actions',
                          render: (_: any, r: any) => (
                            <Button size="small" onClick={() => {
                              setEditingTeam(r)
                              teamForm.setFieldsValue(r)
                              setTeamModal(true)
                            }}>Edit</Button>
                          )
                        }
                      ]}
                    />
                  </Card>
                </Col>
              </Row>
            )
          },
          {
            key: 'settings',
            label: <span><SettingOutlined /> Game Configuration</span>,
            children: (
              <Card size="small" title="Cricket Game Configuration & Limits">
                <Form form={configForm} layout="vertical" onFinish={handleSaveConfig} style={{ maxWidth: 600 }}>
                  <Form.Item name="is_active" label="Game Active Status" valuePropName="checked">
                    <Switch checkedChildren="Active" unCheckedChildren="Disabled" />
                  </Form.Item>
                  <Row gutter={16}>
                    <Col span={12}>
                      <Form.Item name="min_bet" label="Minimum Bet Stake (₹)" rules={[{ required: true }]}>
                        <InputNumber min={1} style={{ width: '100%' }} />
                      </Form.Item>
                    </Col>
                    <Col span={12}>
                      <Form.Item name="max_bet" label="Maximum Bet Stake (₹)" rules={[{ required: true }]}>
                        <InputNumber min={100} style={{ width: '100%' }} />
                      </Form.Item>
                    </Col>
                  </Row>
                  <Row gutter={16}>
                    <Col span={12}>
                      <Form.Item name="house_edge_pct" label="House Commission / Margin (%)">
                        <InputNumber min={0} max={25} style={{ width: '100%' }} />
                      </Form.Item>
                    </Col>
                    <Col span={12}>
                      <Form.Item name="auto_settle" label="Auto-Settlement on API Match Finish" valuePropName="checked">
                        <Switch checkedChildren="Enabled" unCheckedChildren="Manual Only" />
                      </Form.Item>
                    </Col>
                  </Row>
                  <Button type="primary" htmlType="submit">Save Configuration</Button>
                </Form>
              </Card>
            )
          }
        ]} />
      </Card>

      {/* Modal: Add Match */}
      <Modal title="Add Cricket Match" open={addMatchModal} onCancel={() => setAddMatchModal(false)} footer={null}>
        <Form form={matchForm} layout="vertical" onFinish={handleCreateMatch}>
          <Form.Item name="series" label="Tournament / Series" rules={[{ required: true }]}>
            <Select placeholder="Select series" showSearch>
              {seriesCatalog.map(s => <Select.Option key={s.name} value={s.name}>{s.name}</Select.Option>)}
            </Select>
          </Form.Item>
          <Form.Item name="format" label="Match Format" initialValue="t20" rules={[{ required: true }]}>
            <Select>
              <Select.Option value="t20">T20</Select.Option>
              <Select.Option value="odi">ODI (One Day)</Select.Option>
              <Select.Option value="test">Test Match</Select.Option>
              <Select.Option value="t10">T10</Select.Option>
            </Select>
          </Form.Item>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="team_a" label="Team A" rules={[{ required: true }]}>
                <Input placeholder="e.g. India" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="team_a_short" label="Team A Short Code" initialValue="IND">
                <Input placeholder="e.g. IND" />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="team_b" label="Team B" rules={[{ required: true }]}>
                <Input placeholder="e.g. Australia" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="team_b_short" label="Team B Short Code" initialValue="AUS">
                <Input placeholder="e.g. AUS" />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="start_time" label="Match Start Time" rules={[{ required: true }]}>
            <DatePicker showTime style={{ width: '100%' }} />
          </Form.Item>
          <Button type="primary" htmlType="submit" block>Create Match</Button>
        </Form>
      </Modal>

      {/* Modal: Live Score & Stream */}
      <Modal title={`Live Score & Stream: ${selectedMatch?.team_a} vs ${selectedMatch?.team_b}`} open={scoreModal} onCancel={() => setScoreModal(false)} footer={null}>
        <Form form={scoreForm} layout="vertical" onFinish={handleUpdateScore}>
          <Form.Item name="status" label="Match Status" rules={[{ required: true }]}>
            <Select>
              <Select.Option value="upcoming">Upcoming</Select.Option>
              <Select.Option value="live">Live Now 🔴</Select.Option>
              <Select.Option value="closed">Closed</Select.Option>
              <Select.Option value="settled">Settled / Completed</Select.Option>
            </Select>
          </Form.Item>
          <Row gutter={16}>
            <Col span={8}>
              <Form.Item name="runs" label="Runs">
                <InputNumber min={0} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="wickets" label="Wickets">
                <InputNumber min={0} max={10} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="overs" label="Overs (e.g. 14.2)">
                <Input placeholder="14.2" />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="target" label="Target Runs (if chasing)">
            <InputNumber min={1} style={{ width: '100%' }} placeholder="e.g. 185" />
          </Form.Item>
          <Form.Item name="description" label="Score Ticker Description">
            <Input placeholder="e.g. IND need 24 runs in 18 balls" />
          </Form.Item>
          <Form.Item name="live_tv_url" label="Live TV Stream Link (m3u8 / embed)">
            <Input placeholder="https://stream.example.com/live.m3u8" />
          </Form.Item>
          <Button type="primary" htmlType="submit" block>Update Live Details</Button>
        </Form>
      </Modal>

      {/* Modal: Finalize Match Winner */}
      <Modal title={`Finalize Winner: ${selectedMatch?.team_a} vs ${selectedMatch?.team_b}`} open={finalizeModal} onCancel={() => setFinalizeModal(false)} footer={null}>
        <Alert type="warning" message="Settles all Match-Winner odds bets and automatically credits winning payouts in ₹." style={{ marginBottom: 16 }} />
        <Form form={finalizeForm} layout="vertical" onFinish={handleFinalizeMatch}>
          <Form.Item name="winner_key" label="Match Result" rules={[{ required: true }]}>
            <Select placeholder="Select winner">
              <Select.Option value="team_a">{selectedMatch?.team_a} Won</Select.Option>
              <Select.Option value="team_b">{selectedMatch?.team_b} Won</Select.Option>
              <Select.Option value="draw">Match Tied / Draw</Select.Option>
              <Select.Option value="abandoned">Match Abandoned / Cancelled (Refund All)</Select.Option>
            </Select>
          </Form.Item>
          <Button type="primary" htmlType="submit" block>Finalize & Pay Out Bets</Button>
        </Form>
      </Modal>

      {/* Modal: Create Odds Market */}
      <Modal title="Create Decimal Odds Market" open={marketModal} onCancel={() => setMarketModal(false)} footer={null}>
        <Form form={marketForm} layout="vertical" onFinish={handleCreateMarket}>
          <Form.Item name="match_id" label="Select Match" rules={[{ required: true }]}>
            <Select placeholder="Pick match" showSearch filterOption={(input, opt: any) => (opt?.children as string)?.toLowerCase().includes(input.toLowerCase())}>
              {matches.map(m => <Select.Option key={m.id} value={m.id}>{matchLabel(m)}</Select.Option>)}
            </Select>
          </Form.Item>
          <Form.Item name="label" label="Market Name" initialValue="Match Winner" rules={[{ required: true }]}>
            <Input placeholder="e.g. Match Winner, Toss Winner, 1st Innings 50+ Runs" />
          </Form.Item>
          <Row gutter={16}>
            <Col span={14}>
              <Form.Item name="option_a_label" label="Option A Name" initialValue="Team A" rules={[{ required: true }]}>
                <Input placeholder="e.g. India" />
              </Form.Item>
            </Col>
            <Col span={10}>
              <Form.Item name="option_a_odds" label="Odds Multiplier" initialValue={1.85} rules={[{ required: true }]}>
                <InputNumber min={1.01} step={0.05} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={14}>
              <Form.Item name="option_b_label" label="Option B Name" initialValue="Team B" rules={[{ required: true }]}>
                <Input placeholder="e.g. Australia" />
              </Form.Item>
            </Col>
            <Col span={10}>
              <Form.Item name="option_b_odds" label="Odds Multiplier" initialValue={1.95} rules={[{ required: true }]}>
                <InputNumber min={1.01} step={0.05} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={14}>
              <Form.Item name="option_draw_label" label="Option C (Optional)">
                <Input placeholder="e.g. Draw / Tie" />
              </Form.Item>
            </Col>
            <Col span={10}>
              <Form.Item name="option_draw_odds" label="Draw Odds">
                <InputNumber min={1.01} step={0.1} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>
          <Button type="primary" htmlType="submit" block>Create Market</Button>
        </Form>
      </Modal>

      {/* Modal: Bulk Create Over Sessions */}
      <Modal title="Bulk Create Over Session Brackets" open={bulkSessionModal} onCancel={() => setBulkSessionModal(false)} footer={null}>
        <Form form={bulkSessionForm} layout="vertical" onFinish={handleBulkCreateSessions}>
          <Form.Item name="match_id" label="Select Match" rules={[{ required: true }]}>
            <Select placeholder="Pick match">
              {matches.map(m => <Select.Option key={m.id} value={m.id}>{matchLabel(m)}</Select.Option>)}
            </Select>
          </Form.Item>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="from_over" label="From Over" initialValue={1} rules={[{ required: true }]}>
                <InputNumber min={1} max={50} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="to_over" label="To Over" initialValue={20} rules={[{ required: true }]}>
                <InputNumber min={1} max={50} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="base_runs" label="Base Runs at Over 1" initialValue={8} rules={[{ required: true }]}>
                <InputNumber min={0} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="runs_per_over" label="Expected Runs / Over" initialValue={8.5} rules={[{ required: true }]}>
                <InputNumber min={1} step={0.5} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="odds_yes" label="Odds Yes" initialValue={1.90}>
                <InputNumber min={1.01} step={0.05} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="odds_no" label="Odds No" initialValue={1.90}>
                <InputNumber min={1.01} step={0.05} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>
          <Button type="primary" htmlType="submit" block>Generate Sessions</Button>
        </Form>
      </Modal>

      {/* Modal: Single Session */}
      <Modal title="Create Session Bracket" open={sessionModal} onCancel={() => setSessionModal(false)} footer={null}>
        <Form form={sessionForm} layout="vertical" onFinish={handleCreateSession}>
          <Form.Item name="match_id" label="Select Match" rules={[{ required: true }]}>
            <Select placeholder="Pick match">
              {matches.map(m => <Select.Option key={m.id} value={m.id}>{matchLabel(m)}</Select.Option>)}
            </Select>
          </Form.Item>
          <Form.Item name="label" label="Session Title" initialValue="6 Over Runs" rules={[{ required: true }]}>
            <Input placeholder="e.g. 6 Over Runs - India" />
          </Form.Item>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="min_runs" label="Min Runs (No Threshold)" initialValue={48} rules={[{ required: true }]}>
                <InputNumber min={0} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="max_runs" label="Max Runs (Yes Threshold)" initialValue={50} rules={[{ required: true }]}>
                <InputNumber min={0} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="odds_yes" label="Odds Yes" initialValue={1.90}>
                <InputNumber min={1.01} step={0.05} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="odds_no" label="Odds No" initialValue={1.90}>
                <InputNumber min={1.01} step={0.05} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>
          <Button type="primary" htmlType="submit" block>Create Session</Button>
        </Form>
      </Modal>

      {/* Modal: Settle Session */}
      <Modal title={`Settle Session: ${selectedSession?.label}`} open={settleSessionModal} onCancel={() => setSettleSessionModal(false)} footer={null}>
        <Form form={settleSessionForm} layout="vertical" onFinish={handleSettleSession}>
          <Text style={{ display: 'block', marginBottom: 12 }}>
            Bracket: <Text strong>{selectedSession?.min_runs} - {selectedSession?.max_runs} runs</Text>
          </Text>
          <Form.Item name="result_runs" label="Actual Runs Scored" rules={[{ required: true }]}>
            <InputNumber min={0} style={{ width: '100%' }} placeholder="e.g. 52" />
          </Form.Item>
          <Button type="primary" htmlType="submit" block>Settle Session & Pay Bettors</Button>
        </Form>
      </Modal>

      {/* Modal: Team & Flag */}
      <Modal title={editingTeam ? 'Edit Team' : 'Add Team'} open={teamModal} onCancel={() => setTeamModal(false)} footer={null}>
        <Form form={teamForm} layout="vertical" onFinish={handleSaveTeam}>
          <Form.Item name="name" label="Team Name" rules={[{ required: true }]}>
            <Input placeholder="e.g. Mumbai Indians" />
          </Form.Item>
          <Form.Item name="short_name" label="Short Code">
            <Input placeholder="e.g. MI" />
          </Form.Item>
          <TeamFlagUploadField form={teamForm} />
          <Button type="primary" htmlType="submit" block>Save Team</Button>
        </Form>
      </Modal>
    </div>
  )
}
