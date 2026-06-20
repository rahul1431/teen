import { useEffect, useState } from 'react'
import { Table, Tag, Badge, Card, Space, Select, Button, Drawer, Descriptions, List, Avatar } from 'antd'
import { ReloadOutlined, EyeOutlined } from '@ant-design/icons'
import { adminApi } from '../api/client'

export default function GameRooms() {
  const [rooms, setRooms] = useState([])
  const [loading, setLoading] = useState(false)
  const [statusFilter, setStatusFilter] = useState('active')
  const [selectedRoom, setSelectedRoom] = useState<any>(null)

  const fetchRooms = async () => {
    setLoading(true)
    try {
      const res = await adminApi.get('/game-rooms', { params: { status: statusFilter } })
      setRooms(res.data)
    } finally { setLoading(false) }
  }

  useEffect(() => { fetchRooms() }, [statusFilter])

  const columns = [
    { title: 'Room ID', dataIndex: 'id', render: (id: string) => id.slice(0, 12) + '...' },
    { title: 'Game', dataIndex: 'game_type', render: (t: string) => <Tag color="blue">{t.replace('_', ' ').toUpperCase()}</Tag> },
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
      <Space style={{ marginBottom: 16 }}>
        <Select value={statusFilter} onChange={setStatusFilter} style={{ width: 140 }}>
          <Select.Option value="active">Active</Select.Option>
          <Select.Option value="completed">Completed</Select.Option>
          <Select.Option value="waiting">Waiting</Select.Option>
        </Select>
        <Button icon={<ReloadOutlined />} onClick={fetchRooms}>Refresh</Button>
      </Space>

      <Table dataSource={rooms} columns={columns} rowKey="id" loading={loading} size="small" />

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
