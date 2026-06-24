import { useEffect, useState } from 'react'
import {
  Card, Form, Switch, InputNumber, Select, Button, Table, Tag, Badge,
  Space, Drawer, Descriptions, List, Avatar, message, Divider, Row, Col
} from 'antd'
import { ReloadOutlined, EyeOutlined } from '@ant-design/icons'
import { adminApi } from '../../api/client'

export default function Ludo() {
  const [config, setConfig] = useState<any>(null)
  const [loadingConfig, setLoadingConfig] = useState(false)
  const [savingConfig, setSavingConfig] = useState(false)

  const [rooms, setRooms] = useState<any[]>([])
  const [loadingRooms, setLoadingRooms] = useState(false)
  const [statusFilter, setStatusFilter] = useState('active')
  const [selectedRoom, setSelectedRoom] = useState<any>(null)

  const loadConfig = () => {
    setLoadingConfig(true)
    adminApi.get('/game-configs')
      .then(r => {
        const ldConfig = r.data.find((c: any) => c.game_type === 'ludo')
        setConfig(ldConfig)
      })
      .finally(() => setLoadingConfig(false))
  }

  const saveConfig = async (values: any) => {
    setSavingConfig(true)
    try {
      await adminApi.patch('/game-configs/ludo', values)
      message.success('Ludo configuration saved!')
      loadConfig()
    } catch {
      message.error('Failed to save configuration')
    } finally {
      setSavingConfig(false)
    }
  }

  const fetchRooms = async () => {
    setLoadingRooms(true)
    try {
      const res = await adminApi.get('/game-rooms', { params: { status: statusFilter } })
      // Filter for Ludo rooms on the client
      setRooms(res.data.filter((r: any) => r.game_type === 'ludo'))
    } finally {
      setLoadingRooms(false)
    }
  }

  useEffect(() => {
    loadConfig()
  }, [])

  useEffect(() => {
    fetchRooms()
  }, [statusFilter])

  const roomColumns = [
    { title: 'Room ID', dataIndex: 'id', render: (id: string) => id.slice(0, 12) + '...' },
    { title: 'Players', dataIndex: 'player_count' },
    { title: 'Real / Bot', key: 'bots', render: (r: any) => `${r.real_count || 0} / ${r.bot_count || 0}` },
    { title: 'Entry Fee (₹)', dataIndex: 'entry_fee', render: (v: number) => `₹${parseFloat(v as any).toFixed(0)}` },
    { title: 'Pot (₹)', dataIndex: 'pot_amount', render: (v: number) => `₹${parseFloat(v as any).toFixed(2)}` },
    { title: 'Status', dataIndex: 'status', render: (s: string) => (
      <Badge status={s === 'active' ? 'processing' : s === 'completed' ? 'success' : 'default'} text={s} />
    )},
    { title: 'Started', dataIndex: 'started_at', render: (d: string) => d ? new Date(d).toLocaleTimeString() : '-' },
    {
      title: 'Actions', render: (r: any) => (
        <Button size="small" icon={<EyeOutlined />} onClick={() => setSelectedRoom(r)}>View</Button>
      )
    },
  ]

  return (
    <div>
      <h2 style={{ color: '#d4af37', marginBottom: 24 }}>🎲 Ludo Management</h2>
      <Row gutter={[24, 24]}>
        <Col xs={24} lg={8}>
          <Card title="Ludo Rules & Bots" loading={loadingConfig}>
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
          <Card
            title="Ludo Game Rooms"
            extra={
              <Space>
                <Select value={statusFilter} onChange={setStatusFilter} style={{ width: 120 }}>
                  <Select.Option value="active">Active</Select.Option>
                  <Select.Option value="completed">Completed</Select.Option>
                  <Select.Option value="waiting">Waiting</Select.Option>
                </Select>
                <Button icon={<ReloadOutlined />} onClick={fetchRooms}>Refresh</Button>
              </Space>
            }
          >
            <Table dataSource={rooms} columns={roomColumns} rowKey="id" loading={loadingRooms} size="small" />
          </Card>
        </Col>
      </Row>

      <Drawer title="Room Details" open={!!selectedRoom} onClose={() => setSelectedRoom(null)} width={480}>
        {selectedRoom && (
          <>
            <Descriptions column={2} size="small" bordered>
              <Descriptions.Item label="Game">{selectedRoom.game_type}</Descriptions.Item>
              <Descriptions.Item label="Status">{selectedRoom.status}</Descriptions.Item>
              <Descriptions.Item label="Entry Fee">₹{selectedRoom.entry_fee}</Descriptions.Item>
              <Descriptions.Item label="Pot">₹{parseFloat(selectedRoom.pot_amount).toFixed(2)}</Descriptions.Item>
              <Descriptions.Item label="Rake">{selectedRoom.platform_fee_pct}%</Descriptions.Item>
              <Descriptions.Item label="Rake Collected">₹{parseFloat(selectedRoom.platform_fee_collected || 0).toFixed(2)}</Descriptions.Item>
            </Descriptions>
            <Card title="Players" size="small" style={{ marginTop: 16 }}>
              <List
                dataSource={selectedRoom.participants || []}
                renderItem={(p: any) => (
                  <List.Item>
                    <List.Item.Meta
                      avatar={<Avatar>{p.username?.[0]?.toUpperCase()}</Avatar>}
                      title={<span>{p.username} {p.is_bot && <Tag color="orange">BOT</Tag>}</span>}
                      description={`Seat ${p.seat_number} | Won: ₹${parseFloat(p.prize_won || 0).toFixed(2)}`}
                    />
                  </List.Item>
                )}
              />
            </Card>
          </>
        )}
      </Drawer>
    </div>
  )
}
