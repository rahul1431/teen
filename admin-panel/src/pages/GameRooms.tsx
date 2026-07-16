import { useEffect, useState } from 'react'
import { Table, Tag, Badge, Card, Space, Select, Button, Drawer, Descriptions, List, Avatar, message, Divider, Popconfirm, Grid } from 'antd'
import { ReloadOutlined, EyeOutlined } from '@ant-design/icons'
import { adminApi } from '../api/client'

export default function GameRooms() {
  const screens = Grid.useBreakpoint()
  const isMobile = !screens.md
  const [rooms, setRooms] = useState([])
  const [loading, setLoading] = useState(false)
  const [statusFilter, setStatusFilter] = useState('active')
  const [selectedRoom, setSelectedRoom] = useState<any>(null)
  
  // Live spectator state
  const [liveState, setLiveState] = useState<any>(null)
  const [loadingLive, setLoadingLive] = useState(false)
  const [actionLoading, setActionLoading] = useState(false)

  const fetchRooms = async () => {
    setLoading(true)
    try {
      const res = await adminApi.get('/game-rooms', { params: { status: statusFilter } })
      setRooms(res.data)
    } finally { setLoading(false) }
  }

  useEffect(() => { fetchRooms() }, [statusFilter])

  // Live state polling
  useEffect(() => {
    if (!selectedRoom || selectedRoom.status !== 'active') {
      setLiveState(null)
      return
    }

    setLoadingLive(true)
    const fetchLive = () => {
      adminApi.get(`/game-rooms/${selectedRoom.id}/live-state`)
        .then(r => setLiveState(r.data))
        .catch(() => {})
        .finally(() => setLoadingLive(false))
    }

    fetchLive()
    const interval = setInterval(fetchLive, 2000)
    return () => clearInterval(interval)
  }, [selectedRoom])

  const handleForceAction = async (userId: string, actionName: string, extra: any = {}) => {
    if (!selectedRoom) return
    setActionLoading(true)
    try {
      await adminApi.post(`/game-rooms/${selectedRoom.id}/force-action`, {
        user_id: userId,
        action: actionName,
        ...extra
      })
      message.success(`Forced action '${actionName}' successfully`)
    } catch (e: any) {
      message.error(e?.response?.data?.error || 'Failed to force action')
    } finally {
      setActionLoading(false)
    }
  }

  const handleKick = async (userId: string) => {
    if (!selectedRoom) return
    try {
      await adminApi.post(`/game-rooms/${selectedRoom.id}/kick`, { user_id: userId })
      message.success('Player kicked and replaced by bot')
    } catch (e: any) {
      message.error(e?.response?.data?.error || 'Failed to kick player')
    }
  }

  const handleTerminate = async () => {
    if (!selectedRoom) return
    try {
      await adminApi.post(`/game-rooms/${selectedRoom.id}/terminate`)
      message.success('Game room terminated and stakes refunded')
      setSelectedRoom(null)
      fetchRooms()
    } catch (e: any) {
      message.error(e?.response?.data?.error || 'Failed to terminate room')
    }
  }

  const renderCard = (card: { value: string; suit: string }) => {
    const symbols: Record<string, string> = { S: '♠', H: '♥', D: '♦', C: '♣' }
    const colors: Record<string, string> = { S: '#000', H: '#ff4d4f', D: '#ff4d4f', C: '#000' }
    const symbol = symbols[card.suit?.toUpperCase()] || card.suit
    const color = colors[card.suit?.toUpperCase()] || '#000'
    return (
      <span key={`${card.value}-${card.suit}`} style={{
        display: 'inline-block',
        padding: '2px 6px',
        margin: '0 2px',
        border: '1px solid #d9d9d9',
        borderRadius: '4px',
        background: '#fff',
        color,
        fontWeight: 'bold',
        boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
        fontFamily: 'monospace',
      }}>
        {card.value}{symbol}
      </span>
    )
  }

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

      <Table dataSource={rooms} columns={columns} rowKey="id" loading={loading} size="small" scroll={{ x: 'max-content' }} />

      <Drawer title="Room Details & Controls" open={!!selectedRoom} onClose={() => setSelectedRoom(null)} width={isMobile ? '100%' : 550}>
        {selectedRoom && (
          <Space direction="vertical" size="middle" style={{ width: '100%' }}>
            <Descriptions column={2} size="small" bordered title="Database Record">
              <Descriptions.Item label="Game">{selectedRoom.game_type}</Descriptions.Item>
              <Descriptions.Item label="Status">{selectedRoom.status}</Descriptions.Item>
              <Descriptions.Item label="Entry Fee">₹{selectedRoom.entry_fee}</Descriptions.Item>
              <Descriptions.Item label="Pot">₹{parseFloat(selectedRoom.pot_amount).toFixed(2)}</Descriptions.Item>
              <Descriptions.Item label="Rake">{selectedRoom.platform_fee_pct}%</Descriptions.Item>
              <Descriptions.Item label="Rake Collected">₹{parseFloat(selectedRoom.platform_fee_collected || 0).toFixed(2)}</Descriptions.Item>
            </Descriptions>

            {selectedRoom.status === 'active' && (
              <>
                <Divider style={{ margin: '12px 0' }} />
                <h4 style={{ color: '#ff4d4f', margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ display: 'inline-block', width: 8, height: 8, background: '#ff4d4f', borderRadius: '50%', animation: 'pulse 1.5s infinite' }} />
                  Live Spectator (Real-time Reveal)
                </h4>

                {!liveState ? (
                  <Card loading={loadingLive} size="small">Fetching in-memory state...</Card>
                ) : (
                  <Space direction="vertical" size="small" style={{ width: '100%' }}>
                    <Card size="small" style={{ background: '#f5f5f5' }}>
                      <Descriptions column={2} size="small">
                        <Descriptions.Item label="In-Memory Pot">₹{Number(liveState.pot ?? liveState.Pot ?? 0).toFixed(2)}</Descriptions.Item>
                        <Descriptions.Item label="Min Bet">₹{Number(liveState.minBet ?? liveState.min_bet ?? liveState.MinBet ?? selectedRoom.entry_fee).toFixed(0)}</Descriptions.Item>
                        <Descriptions.Item label="Active Turn">
                          Seat {Number(liveState.currentTurn ?? liveState.current_turn ?? 0) + 1} ({liveState.players?.[liveState.currentTurn ?? liveState.current_turn ?? 0]?.username || 'Bot'})
                        </Descriptions.Item>
                        <Descriptions.Item label="Status">{liveState.status}</Descriptions.Item>
                      </Descriptions>
                    </Card>

                    <Card title="Live Players & Controls" size="small">
                      <List
                        dataSource={liveState.players || []}
                        renderItem={(p: any, idx: number) => {
                          const isCurrentTurn = idx === (liveState.currentTurn ?? liveState.current_turn);
                          const isFolded = p.status === 'folded';
                          const isLudo = liveState.gameType === 'ludo' || liveState.game_type === 'ludo';
                          const uid = p.userId ?? p.user_id ?? p.id;
                          return (
                            <List.Item
                              style={{
                                background: isCurrentTurn ? '#e6f4ff' : undefined,
                                padding: '8px 12px',
                                border: isCurrentTurn ? '1px solid #91d5ff' : undefined,
                                borderRadius: isCurrentTurn ? 6 : 0,
                                marginBottom: 4
                              }}
                              actions={[
                                isCurrentTurn && !isFolded && (
                                  <Button
                                    key="force-action"
                                    type="primary"
                                    danger
                                    size="small"
                                    loading={actionLoading}
                                    onClick={() => {
                                      if (isLudo) {
                                        const nextAction = liveState.awaiting === 'roll' ? 'roll_dice' : 'move_token';
                                        const tokenIdx = liveState.movable_tokens?.[0] ?? -1;
                                        handleForceAction(uid, nextAction, { token_index: tokenIdx });
                                      } else {
                                        handleForceAction(uid, 'fold');
                                      }
                                    }}
                                  >
                                    {isLudo ? (liveState.awaiting === 'roll' ? 'Force Roll' : 'Force Move') : 'Force Fold'}
                                  </Button>
                                ),
                                !p.is_bot && !p.isBot && (
                                  <Popconfirm
                                    key="kick"
                                    title="Kick Player?"
                                    description="Kick this player and replace them with a bot? Locked stakes stay in the game."
                                    onConfirm={() => handleKick(uid)}
                                    okText="Yes"
                                    cancelText="No"
                                    okButtonProps={{ danger: true }}
                                  >
                                    <Button danger size="small">Kick</Button>
                                  </Popconfirm>
                                )
                              ].filter(Boolean)}
                            >
                              <List.Item.Meta
                                avatar={<Avatar>{p.username?.[0]?.toUpperCase()}</Avatar>}
                                title={
                                  <span>
                                    {p.username} 
                                    {isCurrentTurn && <Tag color="blue" style={{ marginLeft: 6 }}>ON TURN</Tag>}
                                    {(p.is_bot || p.isBot) && <Tag color="orange" style={{ marginLeft: 6 }}>BOT</Tag>}
                                    {isFolded && <Tag color="default" style={{ marginLeft: 6 }}>FOLDED</Tag>}
                                  </span>
                                }
                                description={
                                  <div style={{ marginTop: 4 }}>
                                    {!isLudo && p.cards && p.cards.length > 0 && (
                                      <div style={{ marginBottom: 4 }}>
                                        Cards: {p.cards.map((c: any) => renderCard(c))}
                                      </div>
                                    )}
                                    {isLudo && p.tokens && (
                                      <span>Tokens: {JSON.stringify(p.tokens)}</span>
                                    )}
                                    <div>Seat {idx + 1} | Status: {p.status} | Bet: ₹{Number(p.bet ?? 0).toFixed(0)}</div>
                                  </div>
                                }
                              />
                            </List.Item>
                          );
                        }}
                      />
                    </Card>

                    <Popconfirm
                      title="Force Terminate Game Room?"
                      description="This will end the game room and refund the entry fee to all active real players immediately. This cannot be undone."
                      onConfirm={handleTerminate}
                      okText="Yes"
                      cancelText="No"
                      okButtonProps={{ danger: true, size: 'middle' }}
                    >
                      <Button danger type="primary" block size="large" style={{ marginTop: 8 }}>
                        Force Terminate & Refund
                      </Button>
                    </Popconfirm>
                  </Space>
                )}
              </>
            )}

            {selectedRoom.status !== 'active' && (
              <Card title="Past Players Record" size="small" style={{ marginTop: 8 }}>
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
            )}
          </Space>
        )}
      </Drawer>
    </div>
  )
}

