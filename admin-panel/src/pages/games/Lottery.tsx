import { useEffect, useState } from 'react'
import {
  Card, Form, Switch, InputNumber, Select, Button, Table, Tag,
  Space, Modal, Input, Typography, message, Row, Col, DatePicker, Divider, Popconfirm, Drawer
} from 'antd'
import { ReloadOutlined, DeleteOutlined } from '@ant-design/icons'
import { adminApi } from '../../api/client'

const { Text } = Typography

export default function Lottery() {
  const [config, setConfig] = useState<any>(null)
  const [loadingConfig, setLoadingConfig] = useState(false)
  const [savingConfig, setSavingConfig] = useState(false)

  const [draws, setDraws] = useState<any[]>([])
  const [loadingDraws, setLoadingDraws] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [drawFor, setDrawFor] = useState<any>(null)
  const [cForm] = Form.useForm()
  const [dForm] = Form.useForm()

  const [ticketsOpen, setTicketsOpen] = useState(false)
  const [selectedDraw, setSelectedDraw] = useState<any>(null)
  const [tickets, setTickets] = useState<any[]>([])
  const [loadingTickets, setLoadingTickets] = useState(false)

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
        name: v.name, ticket_price: v.ticket_price, digits: v.digits,
        prize_multiplier: v.prize_multiplier, draw_time: v.draw_time.toISOString(),
      })
      message.success('Draw created')
      setCreateOpen(false)
      cForm.resetFields()
      loadDraws()
    } catch (e: any) {
      message.error(e?.response?.data?.error || 'Create failed')
    }
  }

  const declare = async (v: any) => {
    try {
      const r = await adminApi.post('/betting/lottery/draw', {
        draw_id: drawFor.id,
        winners: v.winners,
      })
      message.success(`Drawn — ${r.data.winners}/${r.data.tickets} winners, ₹${Number(r.data.paid).toFixed(0)} paid`)
      setDrawFor(null)
      dForm.resetFields()
      loadDraws()
    } catch (e: any) {
      message.error(e?.response?.data?.error || 'Draw failed')
    }
  }

  const deleteDraw = async (id: string) => {
    try {
      await adminApi.delete(`/betting/lottery/draws/${id}`)
      message.success('Draw deleted successfully!')
      loadDraws()
    } catch (e: any) {
      message.error(e?.response?.data?.error || 'Failed to delete draw')
    }
  }

  useEffect(() => {
    loadConfig()
    loadDraws()
  }, [])

  return (
    <div>
      <h2 style={{ color: '#d4af37', marginBottom: 24 }}>🎰 Lottery Management</h2>
      <Row gutter={[24, 24]}>
        <Col xs={24} lg={8}>
          <Card title="Lottery Rules & Config" loading={loadingConfig}>
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
          <Card title="Lottery Draws"
            extra={
              <Space>
                <Button type="primary" onClick={() => setCreateOpen(true)}>+ New Draw</Button>
                <Button icon={<ReloadOutlined />} onClick={loadDraws}>Refresh</Button>
              </Space>
            }
            loading={loadingDraws}>
            <Table rowKey="id" dataSource={draws} size="small" columns={[
              { title: 'Name', dataIndex: 'name' },
              { title: 'Ticket', dataIndex: 'ticket_price', render: (v: any) => `₹${Number(v).toFixed(0)}` },
              { title: 'Digits Limit', dataIndex: 'digits' },
              { title: 'Multiplier', dataIndex: 'prize_multiplier', render: (v: any) => `${Number(v).toFixed(0)}x` },
              { title: 'Tickets Sold', dataIndex: 'ticket_count' },
              { title: 'Draw Time', dataIndex: 'draw_time', render: (v: string) => new Date(v).toLocaleString() },
              { title: 'Status', dataIndex: 'status', render: (s: string) => <Tag color={s === 'settled' ? 'red' : 'green'}>{s}</Tag> },
              { title: 'Winning Number(s)', dataIndex: 'winning_number', render: (v: string) => v || '—' },
              {
                title: 'Action', render: (_: any, d: any) => (
                  <Space size="middle">
                    <Button type="primary" size="small" disabled={d.status === 'settled'}
                      onClick={() => setDrawFor(d)}>Declare Winner</Button>
                    <Button size="small" onClick={() => viewTickets(d)}>View Tickets</Button>
                    <Popconfirm
                      title="Delete Draw"
                      description="Delete this draw and all associated tickets? This cannot be undone."
                      onConfirm={() => deleteDraw(d.id)}
                      okText="Yes"
                      cancelText="No"
                      okButtonProps={{ danger: true }}
                    >
                      <Button danger size="small" icon={<DeleteOutlined />}>Delete</Button>
                    </Popconfirm>
                  </Space>
                ),
              },
            ]} />
          </Card>
        </Col>
      </Row>

      <Modal open={createOpen} title="Create Lottery Draw" onCancel={() => setCreateOpen(false)} onOk={() => cForm.submit()} okText="Create">
        <Form form={cForm} layout="vertical" onFinish={create}>
          <Form.Item name="name" label="Name" rules={[{ required: true }]}><Input placeholder="Daily Lucky Draw" /></Form.Item>
          <Form.Item name="ticket_price" label="Ticket Price (₹)" rules={[{ required: true }]} initialValue={10}><InputNumber min={1} style={{ width: '100%' }} /></Form.Item>
          <Form.Item name="digits" label="Number Length (digits limit)" initialValue={8}><InputNumber min={1} max={8} style={{ width: '100%' }} /></Form.Item>
          <Form.Item name="prize_multiplier" label="Prize Multiplier" initialValue={1000} rules={[{ required: true }]}><InputNumber min={1} style={{ width: '100%' }} /></Form.Item>
          <Form.Item name="draw_time" label="Draw Time" rules={[{ required: true }]}><DatePicker showTime style={{ width: '100%' }} /></Form.Item>
        </Form>
      </Modal>

      <Modal 
        open={!!drawFor} 
        title={`Declare winners — ${drawFor?.name}`} 
        onCancel={() => { setDrawFor(null); dForm.resetFields(); }} 
        onOk={() => dForm.submit()} 
        okText="Declare & Settle"
        width={600}
      >
        <Form form={dForm} layout="vertical" onFinish={declare} initialValues={{ winners: [{ ticket_number: '', prize: 1000 }] }}>
          <Form.List name="winners">
            {(fields, { add, remove }) => (
              <>
                {fields.map(({ key, name, ...restField }) => (
                  <Space key={key} style={{ display: 'flex', marginBottom: 8 }} align="baseline">
                    <Form.Item
                      {...restField}
                      name={[name, 'ticket_number']}
                      rules={[{ required: true, message: 'Missing ticket number' }]}
                    >
                      <Input placeholder="Ticket Number (e.g. 10)" style={{ width: 220 }} />
                    </Form.Item>
                    <Form.Item
                      {...restField}
                      name={[name, 'prize']}
                      rules={[{ required: true, message: 'Missing prize amount' }]}
                    >
                      <InputNumber min={1} placeholder="Prize (₹)" style={{ width: 180 }} formatter={(v) => `₹ ${v}`} />
                    </Form.Item>
                    {fields.length > 1 ? (
                      <Button danger onClick={() => remove(name)}>Remove</Button>
                    ) : null}
                  </Space>
                ))}
                <Form.Item>
                  <Button type="dashed" onClick={() => add()} block style={{ marginTop: 8 }}>
                    + Add Winner Rank
                  </Button>
                </Form.Item>
              </>
            )}
          </Form.List>
          <Text type="warning">This settles all tickets, credits winning accounts immediately, and cancels/marks all other tickets as lost. This cannot be undone.</Text>
        </Form>
      </Modal>

      <Drawer
        title={`Tickets Purchased - ${selectedDraw?.name}`}
        placement="right"
        width={750}
        onClose={() => { setTicketsOpen(false); setTickets([]); }}
        open={ticketsOpen}
      >
        <Table
          rowKey="id"
          loading={loadingTickets}
          dataSource={tickets}
          columns={[
            { title: 'Ticket Number', dataIndex: 'ticket_number', render: (v) => <Tag color="blue" style={{ fontSize: 13, fontWeight: 'bold' }}>{v}</Tag> },
            { title: 'User Name', dataIndex: 'username', render: (v) => v || '—' },
            { title: 'User Phone', dataIndex: 'phone', render: (v) => v || '—' },
            { title: 'Stake Amount', dataIndex: 'amount', render: (v) => `₹${Number(v).toFixed(0)}` },
            { title: 'Status', dataIndex: 'is_winner', render: (isWinner, record) => {
                if (selectedDraw?.status === 'open') return <Tag color="orange">Pending Draw</Tag>
                return isWinner ? <Tag color="green">Winner (₹{Number(record.prize).toFixed(0)})</Tag> : <Tag color="red">Lost</Tag>
              }
            },
            { title: 'Purchase Time', dataIndex: 'created_at', render: (v) => new Date(v).toLocaleString() }
          ]}
        />
      </Drawer>
    </div>
  )
}
