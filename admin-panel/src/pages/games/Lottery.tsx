import { useEffect, useState } from 'react'
import {
  Card, Form, Switch, InputNumber, Select, Button, Table, Tag,
  Space, Modal, Input, Typography, message, Row, Col, DatePicker, Divider, Popconfirm, Drawer, Statistic, Radio, Tabs
} from 'antd'
import {
  ReloadOutlined, DeleteOutlined, TrophyOutlined, WalletOutlined,
  ShoppingCartOutlined, CalendarOutlined, PlusOutlined, SettingOutlined, WarningOutlined
} from '@ant-design/icons'
import { adminApi } from '../../api/client'
import dayjs from 'dayjs'
import LotteryScratch from './LotteryScratch'
import LotteryDailyDashboard from '../../components/LotteryDailyDashboard'

const { Text, Title } = Typography

export default function Lottery() {
  const [config, setConfig] = useState<any>(null)
  const [loadingConfig, setLoadingConfig] = useState(false)
  const [savingConfig, setSavingConfig] = useState(false)

  const [draws, setDraws] = useState<any[]>([])
  const [loadingDraws, setLoadingDraws] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [drawFor, setDrawFor] = useState<any>(null)
  const [declareMode, setDeclareMode] = useState<'manual' | 'random'>('manual')
  const [cForm] = Form.useForm()
  const [dForm] = Form.useForm()

  const [ticketsOpen, setTicketsOpen] = useState(false)
  const [selectedDraw, setSelectedDraw] = useState<any>(null)
  const [tickets, setTickets] = useState<any[]>([])
  const [loadingTickets, setLoadingTickets] = useState(false)

  // Stats State
  const [stats, setStats] = useState<any>(null)
  const [loadingStats, setLoadingStats] = useState(false)

  const loadConfig = () => {
    setLoadingConfig(true)
    adminApi.get('/game-configs')
      .then(r => {
        const ltConfig = r.data.find((c: any) => c.game_type === 'lottery')
        setConfig(ltConfig)
      })
      .finally(() => setLoadingConfig(false))
  }

  const saveConfig = async (values: any) => {
    setSavingConfig(true)
    try {
      await adminApi.patch('/game-configs/lottery', values)
      message.success('Lottery configuration saved!')
      loadConfig()
    } catch {
      message.error('Failed to save configuration')
    } finally {
      setSavingConfig(false)
    }
  }

  const loadDraws = () => {
    setLoadingDraws(true)
    adminApi.get('/betting/lottery/draws')
      .then(r => setDraws(r.data.draws || []))
      .finally(() => setLoadingDraws(false))
  }

  const loadStats = () => {
    setLoadingStats(true)
    adminApi.get('/betting/lottery/stats')
      .then(r => setStats(r.data.stats || null))
      .catch(() => console.error('Failed to load stats'))
      .finally(() => setLoadingStats(false))
  }

  const viewTickets = (draw: any) => {
    setSelectedDraw(draw)
    setTicketsOpen(true)
    setLoadingTickets(true)
    adminApi.get(`/betting/lottery/draws/${draw.id}/tickets`)
      .then(r => setTickets(r.data.tickets || []))
      .catch(() => message.error('Failed to load tickets'))
      .finally(() => setLoadingTickets(false))
  }

  const create = async (v: any) => {
    try {
      await adminApi.post('/betting/lottery/create', {
        name: v.name, ticket_price: v.ticket_price,
        prize_tiers: v.prize_tiers, draw_time: v.draw_time.toISOString(),
        category: v.category,
      })
      message.success('Draw created successfully!')
      setCreateOpen(false)
      cForm.resetFields()
      loadDraws()
      loadStats()
    } catch (e: any) {
      message.error(e?.response?.data?.error || 'Create failed')
    }
  }

  const declare = async (v: any) => {
    try {
      const payload: any = { draw_id: drawFor.id }
      if (declareMode === 'random') payload.random = true
      else payload.winning_number = v.winning_number
      const r = await adminApi.post('/betting/lottery/draw', payload)
      message.success(`Drawn (${r.data.winning_number}) — ${r.data.winners}/${r.data.tickets} winners, ₹${Number(r.data.paid).toFixed(0)} paid`)
      setDrawFor(null)
      if (declareMode === 'manual') dForm.resetFields()
      setDeclareMode('manual')
      loadDraws()
      loadStats()
    } catch (e: any) {
      message.error(e?.response?.data?.error || 'Draw failed')
    }
  }

  const deleteDraw = async (id: string) => {
    try {
      await adminApi.delete(`/betting/lottery/draws/${id}`)
      message.success('Draw deleted successfully!')
      loadDraws()
      loadStats()
    } catch (e: any) {
      message.error(e?.response?.data?.error || 'Failed to delete draw')
    }
  }

  useEffect(() => {
    loadConfig()
    loadDraws()
    loadStats()
  }, [])

  // Styles
  const cardStyle = {
    background: 'linear-gradient(145deg, #111827 0%, #1f2937 100%)',
    border: '1px solid #374151',
    borderRadius: '16px',
    boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.3), 0 4px 6px -2px rgba(0, 0, 0, 0.15)',
    color: '#f3f4f6'
  }

  const statsCardStyle = (glowColor: string) => ({
    ...cardStyle,
    overflow: 'hidden',
    position: 'relative' as const,
    padding: '20px 24px',
    boxShadow: `0 4px 20px rgba(0, 0, 0, 0.25), inset 0 0 12px ${glowColor}1a`
  })

  const glowStyle = (color: string) => ({
    position: 'absolute' as const,
    top: '-30px',
    right: '-30px',
    width: '100px',
    height: '100px',
    background: color,
    filter: 'blur(35px)',
    borderRadius: '50%',
    opacity: 0.15,
  })

  return (
    <Tabs
      defaultActiveKey="draws"
      items={[
        {
          key: 'draws',
          label: 'Weekly & Monthly Draws',
          children: (
    <div style={{ padding: '4px 0' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 28 }}>
        <div>
          <Title level={2} style={{ color: '#d4af37', margin: 0, fontWeight: 800, letterSpacing: '0.5px' }}>
            🎰 Lottery Management
          </Title>
          <Text type="secondary" style={{ fontSize: '14px' }}>
            Configure and schedule lottery draws, manage rules, and declare winning ticket numbers.
          </Text>
        </div>
        <Button 
          type="primary" 
          icon={<ReloadOutlined />} 
          onClick={() => { loadConfig(); loadDraws(); loadStats(); message.info('Refreshed data'); }}
          style={{ 
            borderRadius: '8px', 
            background: 'linear-gradient(135deg, #1f2937 0%, #111827 100%)',
            borderColor: '#4b5563',
            color: '#d4af37',
            height: '40px'
          }}
        >
          Refresh All Data
        </Button>
      </div>

      {/* KPI Stats Section */}
      <Row gutter={[20, 20]} style={{ marginBottom: 28 }}>
        <Col xs={12} sm={12} lg={6}>
          <div style={statsCardStyle('#3b82f6')}>
            <div style={glowStyle('#3b82f6')} />
            <Statistic
              title={<span style={{ color: '#9ca3af', fontWeight: 600 }}>Total Draws Scheduled</span>}
              value={stats?.total_draws ?? 0}
              valueStyle={{ color: '#3b82f6', fontWeight: 800, fontSize: '32px' }}
              prefix={<CalendarOutlined style={{ marginRight: '8px' }} />}
              loading={loadingStats}
            />
          </div>
        </Col>
        <Col xs={12} sm={12} lg={6}>
          <div style={statsCardStyle('#d4af37')}>
            <div style={glowStyle('#d4af37')} />
            <Statistic
              title={<span style={{ color: '#9ca3af', fontWeight: 600 }}>Tickets Purchased</span>}
              value={stats?.total_tickets ?? 0}
              valueStyle={{ color: '#ffd700', fontWeight: 800, fontSize: '32px' }}
              prefix={<ShoppingCartOutlined style={{ marginRight: '8px' }} />}
              loading={loadingStats}
            />
          </div>
        </Col>
        <Col xs={12} sm={12} lg={6}>
          <div style={statsCardStyle('#10b981')}>
            <div style={glowStyle('#10b981')} />
            <Statistic
              title={<span style={{ color: '#9ca3af', fontWeight: 600 }}>Total Revenue Collected</span>}
              value={Number(stats?.total_revenue ?? 0)}
              precision={0}
              valueStyle={{ color: '#10b981', fontWeight: 800, fontSize: '32px' }}
              prefix={<span style={{ marginRight: '4px', fontSize: '26px' }}>₹</span>}
              loading={loadingStats}
            />
          </div>
        </Col>
        <Col xs={12} sm={12} lg={6}>
          <div style={statsCardStyle('#8b5cf6')}>
            <div style={glowStyle('#8b5cf6')} />
            <Statistic
              title={<span style={{ color: '#9ca3af', fontWeight: 600 }}>Prizes Disbursed</span>}
              value={Number(stats?.total_paid_out ?? 0)}
              precision={0}
              valueStyle={{ color: '#a78bfa', fontWeight: 800, fontSize: '32px' }}
              prefix={<TrophyOutlined style={{ marginRight: '8px' }} />}
              loading={loadingStats}
            />
          </div>
        </Col>
      </Row>

      <Row gutter={[24, 24]}>
        <Col xs={24} lg={8}>
          <Card 
            title={
              <Space>
                <SettingOutlined style={{ color: '#d4af37' }} />
                <span style={{ color: '#f3f4f6' }}>Lottery Settings</span>
              </Space>
            } 
            loading={loadingConfig}
            style={cardStyle}
            headStyle={{ borderBottom: '1px solid #374151' }}
          >
            {config && (
              <Form
                layout="vertical"
                initialValues={{ ...config }}
                onFinish={saveConfig}
              >
                <Form.Item name="is_active" label={<span style={{ color: '#d1d5db' }}>Game Active</span>} valuePropName="checked">
                  <Switch checkedChildren="ON" unCheckedChildren="OFF" style={{ background: config.is_active ? '#10b981' : '#ef4444' }} />
                </Form.Item>
                <Form.Item name="rake_percent" label={<span style={{ color: '#d1d5db' }}>Rake % (Platform Fee)</span>}>
                  <InputNumber min={0} max={20} step={0.5} suffix="%" style={{ width: '100%', borderRadius: '6px' }} />
                </Form.Item>
                <Divider style={{ borderColor: '#374151', margin: '20px 0' }}><span style={{ color: '#9ca3af', fontSize: '12px' }}>Bot Auto-Fill Rules</span></Divider>
                <Form.Item name="bot_fill_enabled" label={<span style={{ color: '#d1d5db' }}>Bot Fill Enabled</span>} valuePropName="checked">
                  <Switch checkedChildren="Yes" unCheckedChildren="No" />
                </Form.Item>
                <Form.Item name="bot_fill_delay_seconds" label={<span style={{ color: '#d1d5db' }}>Bot Fill Delay (seconds)</span>}>
                  <InputNumber min={5} max={60} style={{ width: '100%', borderRadius: '6px' }} />
                </Form.Item>
                <Form.Item name="max_bot_ratio" label={<span style={{ color: '#d1d5db' }}>Max Bot Ratio (0-1)</span>}>
                  <InputNumber min={0} max={1} step={0.1} style={{ width: '100%', borderRadius: '6px' }} />
                </Form.Item>
                <Form.Item name="bot_difficulty" label={<span style={{ color: '#d1d5db' }}>Bot Difficulty</span>}>
                  <Select style={{ borderRadius: '6px' }}>
                    <Select.Option value="easy">Easy</Select.Option>
                    <Select.Option value="medium">Medium</Select.Option>
                    <Select.Option value="hard">Hard</Select.Option>
                  </Select>
                </Form.Item>
                <Form.Item style={{ marginBottom: 0 }}>
                  <Button 
                    type="primary" 
                    htmlType="submit" 
                    block 
                    loading={savingConfig}
                    style={{ 
                      borderRadius: '8px', 
                      height: '44px',
                      background: 'linear-gradient(135deg, #ffd700 0%, #d4af37 100%)',
                      border: 'none',
                      color: 'black',
                      fontWeight: 'bold'
                    }}
                  >
                    Save Configuration
                  </Button>
                </Form.Item>
              </Form>
            )}
          </Card>
        </Col>

        <Col xs={24} lg={16}>
          <Card 
            title={<span style={{ color: '#f3f4f6' }}>Active & Settled Draws</span>}
            headStyle={{ borderBottom: '1px solid #374151' }}
            style={cardStyle}
            extra={
              <Space>
                <Button 
                  type="primary" 
                  icon={<PlusOutlined />}
                  onClick={() => setCreateOpen(true)}
                  style={{ 
                    borderRadius: '8px',
                    background: 'linear-gradient(135deg, #059669 0%, #10b981 100%)',
                    border: 'none',
                    fontWeight: 600
                  }}
                >
                  Create Draw
                </Button>
                <Button 
                  icon={<ReloadOutlined />} 
                  onClick={loadDraws}
                  style={{ borderRadius: '8px', background: 'transparent', borderColor: '#4b5563', color: '#9ca3af' }}
                >
                  Refresh
                </Button>
              </Space>
            }
            loading={loadingDraws}
          >
            <Table 
              rowKey="id" 
              dataSource={draws} 
              size="small" 
              pagination={{ pageSize: 8 }}
              className="lottery-draws-table"
              columns={[
                { 
                  title: 'Draw Name', 
                  dataIndex: 'name',
                  render: (name) => <span style={{ fontWeight: 600, color: '#f9fafb' }}>{name}</span>
                },
                { 
                  title: 'Price', 
                  dataIndex: 'ticket_price', 
                  render: (v: any) => <span style={{ color: '#34d399', fontWeight: 600 }}>₹{Number(v).toFixed(0)}</span> 
                },
                {
                  title: 'Prize Tiers',
                  dataIndex: 'prize_tiers',
                  render: (tiers: any[]) => (
                    <Space wrap size={4}>
                      {(tiers || []).map((t, i) => (
                        <Tag key={i} color="gold" style={{ fontWeight: 'bold', fontSize: 10 }}>
                          {t.match_type === 'exact' ? '4/4' : t.match_type.replace('last_', 'Last ')}: {t.multiplier}x
                        </Tag>
                      ))}
                    </Space>
                  )
                },
                {
                  title: 'Category',
                  dataIndex: 'category',
                  render: (c: string) => {
                    const colors: Record<string, string> = { daily: 'cyan', instant: 'purple', weekly: 'blue', monthly: 'gold' }
                    return <Tag color={colors[c] || 'default'} style={{ fontWeight: 'bold', textTransform: 'capitalize' }}>{c}</Tag>
                  }
                },
                {
                  title: 'Sold',
                  dataIndex: 'ticket_count',
                  render: (v) => <span style={{ fontWeight: 'bold' }}>{v || 0}</span>
                },
                { 
                  title: 'Draw Time', 
                  dataIndex: 'draw_time', 
                  render: (v: string) => dayjs(v).format('DD MMM YY · hh:mm A') 
                },
                { 
                  title: 'Status', 
                  dataIndex: 'status', 
                  render: (s: string) => {
                    const isSettled = s === 'settled';
                    return (
                      <Tag 
                        color={isSettled ? 'default' : 'success'} 
                        style={{ 
                          borderRadius: '6px', 
                          fontWeight: 'bold', 
                          textTransform: 'uppercase',
                          padding: '2px 8px',
                          border: isSettled ? '1px solid #4b5563' : '1px solid #05966944'
                        }}
                      >
                        {s}
                      </Tag>
                    )
                  }
                },
                { 
                  title: 'Winners', 
                  dataIndex: 'winning_number', 
                  render: (v: string) => v ? <Tag color="cyan" style={{ fontFamily: 'monospace', fontWeight: 'bold', fontSize: '12px' }}>{v}</Tag> : <span style={{ color: '#9ca3af' }}>—</span> 
                },
                {
                  title: 'Action', 
                  render: (_: any, d: any) => {
                    const isSettled = d.status === 'settled';
                    return (
                      <Space size="small">
                        <Button 
                          type="primary" 
                          size="small" 
                          disabled={isSettled}
                          onClick={() => setDrawFor(d)}
                          style={{ borderRadius: '6px', fontSize: '11px', fontWeight: 600 }}
                        >
                          Settle
                        </Button>
                        <Button 
                          size="small" 
                          onClick={() => viewTickets(d)}
                          style={{ borderRadius: '6px', fontSize: '11px', background: '#374151', color: '#e5e7eb', border: 'none' }}
                        >
                          Tickets
                        </Button>
                        <Popconfirm
                          title="Delete Draw"
                          description="Delete this draw and all associated tickets? This cannot be undone."
                          onConfirm={() => deleteDraw(d.id)}
                          okText="Delete"
                          cancelText="Cancel"
                          okButtonProps={{ danger: true }}
                        >
                          <Button 
                            danger 
                            type="text" 
                            size="small" 
                            icon={<DeleteOutlined />} 
                            style={{ borderRadius: '6px' }} 
                          />
                        </Popconfirm>
                      </Space>
                    )
                  },
                },
              ]} 
            />
          </Card>
        </Col>
      </Row>

      {/* Modal: Create Draw */}
      <Modal 
        open={createOpen} 
        title="Create New Lottery Draw" 
        onCancel={() => setCreateOpen(false)} 
        onOk={() => cForm.submit()} 
        okText="Create Draw"
        okButtonProps={{ style: { borderRadius: '6px' } }}
        cancelButtonProps={{ style: { borderRadius: '6px' } }}
      >
        <Form form={cForm} layout="vertical" onFinish={create} style={{ marginTop: '16px' }}>
          <Form.Item name="name" label="Draw Name" rules={[{ required: true, message: 'Please enter a name' }]}>
            <Input placeholder="e.g., Weekly Megadraw, Daily Lucky Draw" style={{ borderRadius: '6px' }} />
          </Form.Item>
          <Form.Item name="ticket_price" label="Ticket Price (₹)" rules={[{ required: true }]} initialValue={10}>
            <InputNumber min={1} style={{ width: '100%', borderRadius: '6px' }} />
          </Form.Item>
          <Form.Item label="Prize Tiers" required tooltip="Every ticket is a 4-digit number. Define which digit-match patterns pay out and at what multiple of the ticket price.">
            <Form.List name="prize_tiers" initialValue={[{ match_type: 'exact', multiplier: 5000 }]}>
              {(fields, { add, remove }) => (
                <>
                  {fields.map(({ key, name, ...restField }) => (
                    <Space key={key} style={{ display: 'flex', marginBottom: 12 }} align="baseline">
                      <Form.Item
                        {...restField}
                        name={[name, 'match_type']}
                        rules={[{ required: true, message: 'Missing match type' }]}
                        style={{ marginBottom: 0 }}
                      >
                        <Select style={{ width: 180, borderRadius: '6px' }} options={[
                          { value: 'exact', label: 'Exact (4/4 digits)' },
                          { value: 'last_3', label: 'Last 3 digits' },
                          { value: 'last_2', label: 'Last 2 digits' },
                          { value: 'last_1', label: 'Last 1 digit' },
                        ]} />
                      </Form.Item>
                      <Form.Item
                        {...restField}
                        name={[name, 'multiplier']}
                        rules={[{ required: true, message: 'Missing multiplier' }]}
                        style={{ marginBottom: 0 }}
                      >
                        <InputNumber min={1} placeholder="Multiplier" style={{ width: 140, borderRadius: '6px' }} formatter={(v) => `${v}x`} />
                      </Form.Item>
                      {fields.length > 1 ? (
                        <Button danger onClick={() => remove(name)} style={{ borderRadius: '6px' }}>Remove</Button>
                      ) : null}
                    </Space>
                  ))}
                  <Form.Item style={{ marginTop: '8px' }}>
                    <Button type="dashed" onClick={() => add()} block icon={<PlusOutlined />} style={{ borderRadius: '8px' }}>
                      Add Prize Tier
                    </Button>
                  </Form.Item>
                </>
              )}
            </Form.List>
          </Form.Item>
          <Form.Item name="draw_time" label="Draw Time" rules={[{ required: true, message: 'Please select draw time' }]}>
            <DatePicker showTime style={{ width: '100%', borderRadius: '6px' }} />
          </Form.Item>
          <Form.Item name="category" label="Category" rules={[{ required: true, message: 'Please select a category' }]} initialValue="weekly">
            <Radio.Group>
              <Radio.Button value="daily" disabled>Daily 🔜</Radio.Button>
              <Radio.Button value="instant" disabled>Instant 🔜</Radio.Button>
              <Radio.Button value="weekly">Weekly</Radio.Button>
              <Radio.Button value="monthly">Monthly</Radio.Button>
            </Radio.Group>
          </Form.Item>
        </Form>
      </Modal>

      {/* Modal: Declare Result */}
      <Modal
        open={!!drawFor}
        title={
          <span style={{ fontSize: '18px' }}>
            🏆 Declare Result — <span style={{ color: '#d4af37' }}>{drawFor?.name}</span>
          </span>
        }
        onCancel={() => { setDrawFor(null); if (declareMode === 'manual') dForm.resetFields(); setDeclareMode('manual'); }}
        onOk={() => { if (declareMode === 'random') declare({}); else dForm.submit(); }}
        okText="Declare & Settle"
        okButtonProps={{ danger: true, style: { borderRadius: '6px' } }}
        cancelButtonProps={{ style: { borderRadius: '6px' } }}
        width={600}
      >
        <div style={{ marginTop: '16px' }}>
          <Radio.Group value={declareMode} onChange={e => setDeclareMode(e.target.value)} style={{ marginBottom: 20 }}>
            <Radio.Button value="manual">Enter Manually</Radio.Button>
            <Radio.Button value="random">Generate Randomly 🎲</Radio.Button>
          </Radio.Group>

          {declareMode === 'manual' ? (
            <Form form={dForm} layout="vertical" onFinish={declare}>
              <Form.Item
                name="winning_number"
                label="Winning 4-Digit Number"
                rules={[{ required: true, pattern: /^[0-9]{4}$/, message: 'Must be exactly 4 digits' }]}
              >
                <Input
                  maxLength={4}
                  placeholder="e.g. 4821"
                  style={{ fontSize: 22, letterSpacing: 6, textAlign: 'center', fontWeight: 'bold', borderRadius: '6px' }}
                />
              </Form.Item>
            </Form>
          ) : (
            <Text type="secondary">A random 4-digit number will be generated by the server and used to settle this draw.</Text>
          )}

          <div style={{
            background: '#fff2f0',
            border: '1px solid #ffccc7',
            borderRadius: '8px',
            padding: '12px 16px',
            marginTop: '20px',
            display: 'flex',
            alignItems: 'flex-start'
          }}>
            <WarningOutlined style={{ color: '#ff4d4f', fontSize: '18px', marginRight: '10px', marginTop: '3px' }} />
            <div>
              <Text strong style={{ color: '#ff4d4f', display: 'block', marginBottom: '2px' }}>Critical Action</Text>
              <Text type="danger" style={{ fontSize: '12px' }}>
                This will close the draw, automatically match every ticket against the winning number using this draw's prize tiers, credit all winner balances immediately, and mark all other tickets as lost. This cannot be undone.
              </Text>
            </div>
          </div>
        </div>
      </Modal>

      {/* Drawer: Tickets purchased */}
      <Drawer
        title={
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>Purchased Tickets</span>
            <Tag color="blue" style={{ borderRadius: '4px' }}>{selectedDraw?.name}</Tag>
          </div>
        }
        placement="right"
        width={750}
        onClose={() => { setTicketsOpen(false); setTickets([]); }}
        open={ticketsOpen}
        headerStyle={{ borderBottom: '1px solid #f0f0f0' }}
      >
        <Table
          rowKey="id"
          loading={loadingTickets}
          dataSource={tickets}
          size="middle"
          pagination={{ pageSize: 12 }}
          columns={[
            { 
              title: 'Ticket Number', 
              dataIndex: 'ticket_number', 
              render: (v) => <Tag color="blue" style={{ fontSize: 13, fontWeight: 'bold', padding: '4px 8px', borderRadius: '4px' }}>{v}</Tag> 
            },
            { title: 'Purchaser Name', dataIndex: 'username', render: (v) => v || <span style={{ color: '#bfbfbf' }}>—</span> },
            { title: 'Phone Number', dataIndex: 'phone', render: (v) => v || <span style={{ color: '#bfbfbf' }}>—</span> },
            { 
              title: 'Stake Amount', 
              dataIndex: 'amount', 
              render: (v) => <span style={{ fontWeight: 'bold' }}>₹{Number(v).toFixed(0)}</span> 
            },
            { 
              title: 'Result', 
              dataIndex: 'is_winner', 
              render: (isWinner, record) => {
                if (selectedDraw?.status === 'open') {
                  return <Tag color="orange" style={{ borderRadius: '4px', fontWeight: 'bold' }}>Pending Draw</Tag>
                }
                return isWinner 
                  ? <Tag color="success" style={{ borderRadius: '4px', fontWeight: 'bold' }}>Winner (₹{Number(record.prize).toLocaleString()})</Tag> 
                  : <Tag color="error" style={{ borderRadius: '4px' }}>Lost</Tag>
              }
            },
            { 
              title: 'Purchase Date', 
              dataIndex: 'created_at', 
              render: (v) => dayjs(v).format('DD MMM YY · hh:mm A') 
            }
          ]}
        />
      </Drawer>
    </div>
          ),
        },
        {
          key: 'scratch',
          label: 'Instant Lottery',
          children: <LotteryScratch />,
        },
        {
          key: 'daily',
          label: 'Daily Lottery',
          children: <LotteryDailyDashboard />,
        },
      ]}
    />
  )
}
