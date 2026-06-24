import { useEffect, useState } from 'react'
import {
  Card, Form, Switch, InputNumber, Select, Button, Table, Tag,
  Space, Modal, Input, Typography, message, Row, Col, DatePicker, Divider, Popconfirm
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
        draw_id: drawFor.id, winning_number: v.winning_number,
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
              { title: 'Digits', dataIndex: 'digits' },
              { title: 'Multiplier', dataIndex: 'prize_multiplier', render: (v: any) => `${Number(v).toFixed(0)}x` },
              { title: 'Tickets', dataIndex: 'ticket_count' },
              { title: 'Draw Time', dataIndex: 'draw_time', render: (v: string) => new Date(v).toLocaleString() },
              { title: 'Status', dataIndex: 'status', render: (s: string) => <Tag color={s === 'settled' ? 'red' : 'green'}>{s}</Tag> },
              { title: 'Winning #', dataIndex: 'winning_number', render: (v: string) => v || '—' },
              {
                title: 'Action', render: (_: any, d: any) => (
                  <Space size="middle">
                    <Button type="primary" size="small" disabled={d.status === 'settled'}
                      onClick={() => setDrawFor(d)}>Declare Winner</Button>
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
    </div>
  )
}
