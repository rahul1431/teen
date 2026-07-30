import { useEffect, useState } from 'react'
import { Card, Form, Switch, InputNumber, Button, Table, Tag, Space, message, Typography, Row, Col, Select } from 'antd'
import { ReloadOutlined } from '@ant-design/icons'
import { adminApi } from '../../api/client'

const { Text, Title } = Typography

export default function Rummy() {
  const [config, setConfig] = useState<any>(null)
  const [loadingConfig, setLoadingConfig] = useState(false)
  const [savingConfig, setSavingConfig] = useState(false)

  const [rooms, setRooms] = useState<any[]>([])
  const [loadingRooms, setLoadingRooms] = useState(false)
  const [statusFilter, setStatusFilter] = useState('active')

  const loadConfig = () => {
    setLoadingConfig(true)
    adminApi.get('/game-configs')
      .then(r => setConfig(r.data.find((c: any) => c.game_type === 'rummy')))
      .finally(() => setLoadingConfig(false))
  }

  const saveConfig = async (values: any) => {
    setSavingConfig(true)
    try {
      await adminApi.patch('/game-configs/rummy', values)
      message.success('Rummy configuration saved!')
      loadConfig()
    } catch {
      message.error('Failed to save configuration')
    } finally {
      setSavingConfig(false)
    }
  }

  const loadRooms = () => {
    setLoadingRooms(true)
    adminApi.get('/game-rooms', { params: { status: statusFilter } })
      .then(r => setRooms((r.data || []).filter((room: any) => room.game_type === 'rummy')))
      .finally(() => setLoadingRooms(false))
  }

  useEffect(() => {
    loadConfig()
  }, [])

  useEffect(() => {
    loadRooms()
  }, [statusFilter])

  const roomColumns = [
    { title: 'Room ID', dataIndex: 'id', render: (id: string) => id.slice(0, 12) + '...' },
    { title: 'Players', dataIndex: 'player_count' },
    { title: 'Real / Bot', key: 'bots', render: (r: any) => `${r.real_count || 0} / ${r.bot_count || 0}` },
    { title: 'Entry Fee (₹)', dataIndex: 'entry_fee', render: (v: number) => `₹${parseFloat(v as any).toFixed(0)}` },
    { title: 'Pot (₹)', dataIndex: 'pot_amount', render: (v: number) => `₹${parseFloat(v as any).toFixed(2)}` },
    { title: 'Status', dataIndex: 'status', render: (s: string) => <Tag color={s === 'active' ? 'blue' : s === 'completed' ? 'green' : 'default'}>{s}</Tag> },
    { title: 'Started', dataIndex: 'started_at', render: (d: string) => d ? new Date(d).toLocaleTimeString() : '-' },
  ]

  return (
    <div>
      <Title level={3} style={{ color: '#d4af37' }}>🂡 Rummy Management</Title>
      <Row gutter={[24, 24]}>
        <Col xs={24} lg={7}>
          <Card title="⚙️ Game Config" loading={loadingConfig} size="small">
            {config && (
              <Form layout="vertical" initialValues={{ ...config }} onFinish={saveConfig} size="small">
                <Form.Item name="is_active" label="Game Active" valuePropName="checked">
                  <Switch checkedChildren="ON" unCheckedChildren="OFF" />
                </Form.Item>
                <Form.Item name="rake_percent" label="Rake %">
                  <InputNumber min={0} max={20} step={0.5} suffix="%" style={{ width: '100%' }} />
                </Form.Item>
                <Form.Item>
                  <Button type="primary" htmlType="submit" block loading={savingConfig}>Save Config</Button>
                </Form.Item>
              </Form>
            )}
          </Card>
          <Text type="secondary" style={{ fontSize: 12 }}>
            Live spectator, force-action, kick, and terminate controls for any in-progress room are available at
            {' '}<a href="/admin/game-rooms">Live Game Rooms</a>.
          </Text>
        </Col>
        <Col xs={24} lg={17}>
          <Card
            title="Rooms"
            extra={
              <Space>
                <Select value={statusFilter} onChange={setStatusFilter} style={{ width: 140 }}>
                  <Select.Option value="active">Active</Select.Option>
                  <Select.Option value="completed">Completed</Select.Option>
                  <Select.Option value="waiting">Waiting</Select.Option>
                </Select>
                <Button icon={<ReloadOutlined />} onClick={loadRooms}>Refresh</Button>
              </Space>
            }
            loading={loadingRooms}
          >
            <Table rowKey="id" dataSource={rooms} columns={roomColumns} size="small" scroll={{ x: 'max-content' }} />
          </Card>
        </Col>
      </Row>
    </div>
  )
}
