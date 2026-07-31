import { useEffect, useState } from 'react'
import {
  Card, Form, Switch, InputNumber, Select, Button, Table, Tag, Badge,
  Space, Drawer, Descriptions, List, Avatar, message, Divider, Row, Col,
  Input, Popconfirm, Modal, Typography, Spin, Upload, Grid, Tabs, Alert
} from 'antd'
import { ReloadOutlined, EyeOutlined, PlusOutlined, DeleteOutlined, UploadOutlined } from '@ant-design/icons'
import { adminApi } from '../../api/client'
import BotManagementPanel from '../../components/BotManagementPanel'
import GamePnlDashboard from '../../components/GamePnlDashboard'
import { BotTrainingConfigPanel } from '../../components/BotTrainingConfigPanel'
import { BotMetricsTable } from '../../components/BotMetricsTable'
import { BotTrainingAuditTrail } from '../../components/BotTrainingAuditTrail'
import { BotTrainingTrendChart } from '../../components/BotTrainingTrendChart'
import { MLTrainingPanel } from '../../components/MLTrainingPanel'
import { BotLearningSection } from '../../components/AI/BotLearningSection'

const { Text } = Typography

// Teen Patti cards from the engine are { value: "A", suit: "S"|"H"|"D"|"C", rank }.
const SUIT: Record<string, { sym: string; color: string }> = {
  S: { sym: '♠', color: '#000' },
  H: { sym: '♥', color: '#d4380d' },
  D: { sym: '♦', color: '#d4380d' },
  C: { sym: '♣', color: '#000' },
}

function PlayingCards({ cards }: { cards: any[] }) {
  if (!cards || cards.length === 0) return <Text type="secondary">—</Text>
  return (
    <Space size={4}>
      {cards.map((c, i) => {
        const s = SUIT[c.suit] ?? { sym: c.suit, color: '#000' }
        return (
          <span
            key={i}
            style={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              minWidth: 34, height: 44, padding: '0 4px', border: '1px solid #d9d9d9',
              borderRadius: 5, background: '#fff', color: s.color, fontWeight: 700,
              fontSize: 15, boxShadow: '0 1px 2px rgba(0,0,0,0.12)',
            }}
          >
            {c.value}{s.sym}
          </span>
        )
      })}
    </Space>
  )
}

export default function TeenPatti() {
  const screens = Grid.useBreakpoint()
  const isMobile = !screens.md
  const [config, setConfig] = useState<any>(null)
  const [loadingConfig, setLoadingConfig] = useState(false)
  const [savingConfig, setSavingConfig] = useState(false)

  const [rooms, setRooms] = useState<any[]>([])
  const [loadingRooms, setLoadingRooms] = useState(false)
  const [statusFilter, setStatusFilter] = useState('active')
  const [selectedRoom, setSelectedRoom] = useState<any>(null)
  const [liveState, setLiveState] = useState<any>(null)
  const [loadingLive, setLoadingLive] = useState(false)

  // Emojis state
  const [emojis, setEmojis] = useState<any[]>([])
  const [loadingEmojis, setLoadingEmojis] = useState(false)
  const [emojiModalOpen, setEmojiModalOpen] = useState(false)
  const [newEmoji, setNewEmoji] = useState('')
  const [newEmojiLabel, setNewEmojiLabel] = useState('')
  const [savingEmoji, setSavingEmoji] = useState(false)
  const [uploadingEmoji, setUploadingEmoji] = useState(false)

  const handleEmojiUpload = async (file: File) => {
    setUploadingEmoji(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await adminApi.post('/uploads/emoji', fd, {
        headers: { 'Content-Type': 'multipart/form-data' }
      })
      setNewEmoji(res.data.url)
      message.success('Animated sticker uploaded successfully!')
    } catch (e: any) {
      message.error(e.response?.data?.error || 'Upload failed')
    } finally {
      setUploadingEmoji(false)
    }
  }


  const loadConfig = () => {
    setLoadingConfig(true)
    adminApi.get('/game-configs')
      .then(r => {
        const tpConfig = r.data.find((c: any) => c.game_type === 'teen_patti')
        setConfig(tpConfig)
      })
      .finally(() => setLoadingConfig(false))
  }

  const saveConfig = async (values: any) => {
    setSavingConfig(true)
    try {
      await adminApi.patch('/game-configs/teen_patti', values)
      message.success('Teen Patti configuration saved!')
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
      setRooms(res.data.filter((r: any) => r.game_type === 'teen_patti'))
    } finally {
      setLoadingRooms(false)
    }
  }

  // Live hole-cards for a room, read from the gateway's tp:game:{id} state
  // (present only while a hand is in progress). Admin-only "god view".
  const fetchLiveCards = async (roomId: string) => {
    setLoadingLive(true)
    setLiveState(null)
    try {
      const res = await adminApi.get(`/game-rooms/${roomId}/live-state`)
      setLiveState(res.data)
    } catch {
      setLiveState(null)
    } finally {
      setLoadingLive(false)
    }
  }

  // ── Emoji management ──────────────────────────────────────────
  const fetchEmojis = async () => {
    setLoadingEmojis(true)
    try {
      const res = await adminApi.get('/emojis')
      setEmojis(res.data)
    } catch { message.error('Failed to load emojis') }
    finally { setLoadingEmojis(false) }
  }

  const addEmoji = async () => {
    if (!newEmoji.trim()) { message.warning('Enter an emoji or upload a sticker'); return }
    setSavingEmoji(true)
    try {
      await adminApi.post('/emojis', { emoji: newEmoji.trim(), label: newEmojiLabel.trim() })
      message.success('Emoji added!')
      setNewEmoji(''); setNewEmojiLabel('')
      setEmojiModalOpen(false)
      fetchEmojis()
    } catch { message.error('Failed to add emoji') }
    finally { setSavingEmoji(false) }
  }

  const toggleEmoji = async (id: string, is_active: boolean) => {
    try {
      await adminApi.patch(`/emojis/${id}`, { is_active })
      fetchEmojis()
    } catch { message.error('Failed to update emoji') }
  }

  const deleteEmoji = async (id: string) => {
    try {
      await adminApi.delete(`/emojis/${id}`)
      message.success('Emoji deleted')
      fetchEmojis()
    } catch { message.error('Failed to delete emoji') }
  }

  useEffect(() => { loadConfig(); fetchEmojis() }, [])
  useEffect(() => { fetchRooms() }, [statusFilter])

  // When a room drawer opens, pull the live hand's cards (only meaningful while active).
  useEffect(() => {
    if (selectedRoom?.id && selectedRoom.status === 'active') {
      fetchLiveCards(selectedRoom.id)
    } else {
      setLiveState(null)
    }
  }, [selectedRoom])

  const emojiColumns = [
    {
      title: 'Emoji / Sticker',
      dataIndex: 'emoji',
      render: (e: string) => {
        if (e && e.startsWith('/uploads/')) {
          return <img src={e} alt="sticker" style={{ maxHeight: 40, maxWidth: 40, objectFit: 'contain' }} />
        }
        return <span style={{ fontSize: 24 }}>{e}</span>
      }
    },
    { title: 'Label', dataIndex: 'label', render: (l: string) => l || <Text type="secondary">—</Text> },
    { title: 'Order', dataIndex: 'sort_order' },
    {
      title: 'Active', dataIndex: 'is_active',
      render: (v: boolean, r: any) => (
        <Switch checked={v} size="small" onChange={(checked) => toggleEmoji(r.id, checked)} />
      )
    },
    {
      title: '', key: 'del',
      render: (r: any) => (
        <Popconfirm title="Delete this emoji?" onConfirm={() => deleteEmoji(r.id)} okText="Delete" okType="danger">
          <Button size="small" danger icon={<DeleteOutlined />} />
        </Popconfirm>
      )
    },
  ]

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
    <Tabs items={[{ key: 'overview', label: 'Overview', children: (
    <div>
      <h2 style={{ color: '#d4af37', marginBottom: 24 }}>🃏 Teen Patti Management</h2>
      <Row gutter={[24, 24]}>
        <Col xs={24} lg={8}>
          <Card title="Teen Patti Rules & Bots" loading={loadingConfig}>
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
            title="Teen Patti Game Rooms"
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
            <Table dataSource={rooms} columns={roomColumns} rowKey="id" loading={loadingRooms} size="small" scroll={{ x: 'max-content' }} />
          </Card>
        </Col>
      </Row>

      {/* Emoji Management */}
      <Row gutter={[24, 24]} style={{ marginTop: 24 }}>
        <Col xs={24} lg={12}>
          <Card
            title="😀 Game Emojis"
            extra={
              <Space>
                <Button icon={<ReloadOutlined />} size="small" onClick={fetchEmojis} />
                <Button type="primary" icon={<PlusOutlined />} size="small" onClick={() => setEmojiModalOpen(true)}>
                  Add Emoji
                </Button>
              </Space>
            }
            loading={loadingEmojis}
          >
            <Alert
              type="info"
              showIcon
              style={{ marginBottom: 12 }}
              message="Shared across games"
              description="This emoji list is not Teen Patti-specific — it also powers Ludo's in-game reaction tray. Changes here affect every game with reactions/chat."
            />
            <Table
              dataSource={emojis}
              columns={emojiColumns}
              rowKey="id"
              size="small"
              pagination={{ pageSize: 10 }}
              scroll={{ x: 'max-content' }}
            />
          </Card>
        </Col>

      </Row>

      {/* Add Emoji Modal */}
      <Modal
        title="Add New Emoji"
        open={emojiModalOpen}
        onOk={addEmoji}
        onCancel={() => { setEmojiModalOpen(false); setNewEmoji(''); setNewEmojiLabel('') }}
        confirmLoading={savingEmoji}
        okText="Add"
      >
        <div style={{ marginBottom: 12 }}>
          <label style={{ display: 'block', marginBottom: 4 }}>Emoji character or Sticker URL</label>
          <Input
            value={newEmoji}
            onChange={e => setNewEmoji(e.target.value)}
            placeholder="Paste emoji or sticker URL"
            maxLength={256}
            style={{ fontSize: 16, width: '100%' }}
          />
        </div>
        <div style={{ marginBottom: 12 }}>
          <label style={{ display: 'block', marginBottom: 4 }}>Upload Animated Sticker (GIF, WebP, PNG, etc.)</label>
          <Upload
            showUploadList={false}
            accept="image/*"
            maxCount={1}
            beforeUpload={(file) => { handleEmojiUpload(file as File); return false }}
          >
            <Button icon={<UploadOutlined />} loading={uploadingEmoji} disabled={savingEmoji}>
              {newEmoji.startsWith('/uploads/') ? 'Change Sticker File' : 'Upload Sticker File'}
            </Button>
          </Upload>
        </div>
        <div>
          <label style={{ display: 'block', marginBottom: 4 }}>Label / Name</label>
          <Input
            value={newEmojiLabel}
            onChange={e => setNewEmojiLabel(e.target.value)}
            placeholder="e.g. Laughing GIF"
            maxLength={32}
          />
        </div>
        {newEmoji && (
          <div style={{ marginTop: 16, textAlign: 'center' }}>
            {newEmoji.startsWith('/uploads/') ? (
              <img
                src={newEmoji}
                alt="sticker preview"
                style={{ maxHeight: 80, maxWidth: 80, objectFit: 'contain' }}
                onError={(e) => {
                  (e.target as any).style.display = 'none';
                }}
              />
            ) : (
              <div style={{ fontSize: 40 }}>{newEmoji}</div>
            )}
          </div>
        )}
      </Modal>

      <Drawer title="Room Details" open={!!selectedRoom} onClose={() => setSelectedRoom(null)} width={isMobile ? '100%' : 480}>
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
            <Card
              title="🃏 Live Cards (current hand)"
              size="small"
              style={{ marginTop: 16 }}
              extra={
                <Button
                  size="small"
                  icon={<ReloadOutlined />}
                  loading={loadingLive}
                  onClick={() => selectedRoom?.id && fetchLiveCards(selectedRoom.id)}
                >
                  Refresh
                </Button>
              }
            >
              {loadingLive ? (
                <div style={{ textAlign: 'center', padding: 16 }}><Spin /></div>
              ) : liveState?.players?.some((p: any) => p.cards?.length) ? (
                <List
                  dataSource={liveState.players}
                  renderItem={(p: any) => (
                    <List.Item>
                      <List.Item.Meta
                        avatar={<Avatar>{p.username?.[0]?.toUpperCase()}</Avatar>}
                        title={
                          <span>
                            {p.username || 'Player'}{' '}
                            {p.is_bot && <Tag color="orange">BOT</Tag>}
                            {p.status === 'folded' && <Tag>folded</Tag>}
                          </span>
                        }
                        description={<PlayingCards cards={p.cards} />}
                      />
                    </List.Item>
                  )}
                />
              ) : (
                <Text type="secondary">
                  Cards are visible only during an active hand (they clear when the round ends).
                </Text>
              )}
            </Card>

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
    ) }, { key: 'bots', label: 'Bots', children: <BotManagementPanel gameType="teen_patti" /> }, { key: 'analytics', label: 'Analytics', children: <GamePnlDashboard gameType="teen_patti" /> }, { key: 'bot-training', label: 'Bot Training', children: (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
        <Alert
          type="info"
          showIcon
          message="Shared across games"
          description="This election/coordination config is not Teen Patti-specific — the same settings and session history also drive Ludo's bot-vs-real-player outcomes (bot_learning_sessions has no per-game split yet). Changes here take effect on both games' next hands."
        />
        <BotTrainingConfigPanel />
        <BotTrainingTrendChart />
        <BotMetricsTable gameType="teen_patti" />
        <BotTrainingAuditTrail />
        <BotLearningSection gameType="teen_patti" />
      </div>
    ) }, { key: 'ml-training', label: 'ML Training', children: <MLTrainingPanel gameType="teen_patti" /> }]} />
  )
}
