import { useEffect, useState } from 'react'
import { Card, Table, Select, Button, Space, Tag, Typography, message } from 'antd'
import { TrophyOutlined, ReloadOutlined } from '@ant-design/icons'
import { adminApi } from '../api/client'

const { Text } = Typography

const GAME_OPTIONS = [
  { value: 'teen_patti', label: '🃏 Teen Patti' },
  { value: 'aviator', label: '✈️ Aviator' },
  { value: 'cricket', label: '🏏 Cricket' },
  { value: 'matka', label: '🎯 Satta Matka' },
  { value: 'lottery', label: '🎰 Lottery' },
  { value: 'ludo', label: '🎲 Ludo' },
]

const PERIOD_OPTIONS = [
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
]

export default function Leaderboard() {
  const [gameType, setGameType] = useState('teen_patti')
  const [period, setPeriod] = useState('daily')
  const [entries, setEntries] = useState<any[]>([])
  const [loading, setLoading] = useState(false)

  const loadLeaderboard = async () => {
    setLoading(true)
    try {
      const res = await adminApi.get(`/leaderboard/${gameType}`, { params: { period } })
      setEntries(res.data.entries || [])
    } catch (e: any) {
      message.error(e.response?.data?.error || 'Failed to load leaderboard data')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadLeaderboard()
  }, [gameType, period])

  const columns = [
    {
      title: 'Rank',
      dataIndex: 'rank',
      key: 'rank',
      render: (rank: number) => {
        if (rank === 1) return <Tag color="gold" style={{ fontSize: '13px', fontWeight: 'bold' }}>🏆 1st</Tag>
        if (rank === 2) return <Tag color="silver" style={{ fontSize: '12px', fontWeight: 'bold' }}>🥈 2nd</Tag>
        if (rank === 3) return <Tag color="orange" style={{ fontSize: '11px', fontWeight: 'bold' }}>🥉 3rd</Tag>
        return <Text strong>{rank}</Text>
      },
      width: 100,
    },
    {
      title: 'Username',
      dataIndex: 'username',
      key: 'username',
      render: (username: string) => <Text strong>{username}</Text>,
    },
    {
      title: 'User ID',
      dataIndex: 'user_id',
      key: 'user_id',
      render: (id: string) => <Text type="secondary" copyable>{id}</Text>,
    },
    {
      title: 'GGR / Score',
      dataIndex: 'score',
      key: 'score',
      render: (score: number) => <Text style={{ color: '#d4af37', fontWeight: 'bold' }}>₹{Number(score || 0).toLocaleString()}</Text>,
    },
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 style={{ color: '#d4af37', margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
          <TrophyOutlined /> Leaderboard Standings
        </h2>
        <Space>
          <Select
            value={gameType}
            onChange={setGameType}
            options={GAME_OPTIONS}
            style={{ width: 160 }}
          />
          <Select
            value={period}
            onChange={setPeriod}
            options={PERIOD_OPTIONS}
            style={{ width: 120 }}
          />
          <Button icon={<ReloadOutlined />} onClick={loadLeaderboard} loading={loading} type="primary">
            Refresh
          </Button>
        </Space>
      </div>

      <Card loading={loading}>
        <Table
          dataSource={entries}
          columns={columns}
          rowKey="user_id"
          pagination={{ pageSize: 20 }}
          locale={{ emptyText: 'No leaderboard records found for this period' }}
          scroll={{ x: 'max-content' }}
        />
      </Card>
    </div>
  )
}
