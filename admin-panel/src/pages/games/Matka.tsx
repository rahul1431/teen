import { useEffect, useState } from 'react'
import {
  Card, Form, Switch, InputNumber, Select, Button, Table, Tag,
  Space, message, Divider, Row, Col, Modal, Input, Typography, Popconfirm
} from 'antd'
import { ReloadOutlined, DeleteOutlined } from '@ant-design/icons'
import { adminApi } from '../../api/client'

const { Text } = Typography

export default function Matka() {
  const [config, setConfig] = useState<any>(null)
  const [loadingConfig, setLoadingConfig] = useState(false)
  const [savingConfig, setSavingConfig] = useState(false)

  const [draws, setDraws] = useState<any[]>([])
  const [loadingDraws, setLoadingDraws] = useState(false)
  const [declareFor, setDeclareFor] = useState<any>(null)
  const [form] = Form.useForm()

  // Markets management state
  const [markets, setMarkets] = useState<any[]>([])
  const [loadingMarkets, setLoadingMarkets] = useState(false)
  const [showCreateMarket, setShowCreateMarket] = useState(false)
  const [submittingMarket, setSubmittingMarket] = useState(false)
  const [marketForm] = Form.useForm()

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
    try {
      const r = await adminApi.post('/betting/matka/declare', {
        draw_id: declareFor.id, session: values.session, panna: values.panna,
      })
      message.success(`Declared — settled ${r.data.settled}, winners ${r.data.winners}`)
      setDeclareFor(null)
      form.resetFields()
      loadDraws()
    } catch (e: any) {
      message.error(e?.response?.data?.error || 'Declare failed')
    }
  }

  useEffect(() => {
    loadConfig()
    loadDraws()
    loadMarkets()
  }, [])

  return (
    <div>
      <h2 style={{ color: '#d4af37', marginBottom: 24 }}>🎯 Satta Matka Management</h2>
      <Row gutter={[24, 24]}>
        <Col xs={24} lg={8}>
          <Card title="Matka Rules & Config" loading={loadingConfig}>
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
          <Space direction="vertical" size={24} style={{ width: '100%' }}>
            
            {/* Matka Markets Card */}
            <Card 
              title="Matka Markets" 
              extra={
                <Space>
                  <Button type="primary" onClick={() => setShowCreateMarket(true)}>+ New Market</Button>
                  <Button icon={<ReloadOutlined />} onClick={loadMarkets}>Refresh</Button>
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
                  { title: 'Market Name', dataIndex: 'name' },
                  { title: 'Open Time', dataIndex: 'open_time' },
                  { title: 'Close Time', dataIndex: 'close_time' },
                  { title: 'Sort Order', dataIndex: 'sort_order' },
                  {
                    title: 'Action', 
                    render: (_: any, m: any) => (
                      <Popconfirm
                        title="Delete Market"
                        description="Delete this market and all associated draws/bets? This cannot be undone."
                        onConfirm={() => deleteMarket(m.id)}
                        okText="Yes"
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

            {/* Draws Card */}
            <Card title="Today's Matka Draws" extra={<Button icon={<ReloadOutlined />} onClick={loadDraws}>Refresh</Button>} loading={loadingDraws}>
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

          </Space>
        </Col>
      </Row>

      {/* Create Market Modal */}
      <Modal 
        open={showCreateMarket} 
        title="Create Matka Market" 
        onCancel={() => setShowCreateMarket(false)} 
        onOk={() => marketForm.submit()} 
        okText="Create" 
        confirmLoading={submittingMarket}
      >
        <Form form={marketForm} layout="vertical" onFinish={createMarket}>
          <Form.Item name="name" label="Market Name" rules={[{ required: true, message: 'Please enter market name' }]}>
            <Input placeholder="e.g. Kalyan Night" />
          </Form.Item>
          <Form.Item name="open_time" label="Open Time (HH:MM:SS)" rules={[{ required: true, message: 'Please enter open time' }]}>
            <Input placeholder="e.g. 21:00:00" />
          </Form.Item>
          <Form.Item name="close_time" label="Close Time (HH:MM:SS)" rules={[{ required: true, message: 'Please enter close time' }]}>
            <Input placeholder="e.g. 23:00:00" />
          </Form.Item>
          <Form.Item name="sort_order" label="Sort Order" initialValue={0}>
            <InputNumber min={0} style={{ width: '100%' }} />
          </Form.Item>
        </Form>
      </Modal>

      {/* Declare Result Modal */}
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
    </div>
  )
}
