import { useEffect, useState } from 'react'
import { Table, Tag, Tooltip, Badge, Space, Empty, Typography, Spin } from 'antd'
import { adminApi } from '../api/client'

const { Text } = Typography

interface BotMetric {
  bot_id: string
  name: string
  lifetime_wins: number
  win_rate: number
  vs_rp_win_rate: number
  last_10_games: string[] // Array of 'W' or 'L'
}

interface BotMetricsTableProps {
  gameType?: string
}

export function BotMetricsTable({ gameType = 'ludo' }: BotMetricsTableProps) {
  const [data, setData] = useState<BotMetric[]>([])
  const [loading, setLoading] = useState(false)
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [pageSize] = useState(10)

  const fetchBotMetrics = () => {
    setLoading(true)
    adminApi
      .get(`/${gameType}/bot-stats`, {
        params: {
          page,
          limit: pageSize,
        },
      })
      .then((r) => {
        setData(r.data.bots || [])
        setTotal(r.data.total || 0)
      })
      .catch(() => {
        setData([])
        setTotal(0)
      })
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    fetchBotMetrics()
  }, [page, gameType])

  const renderLast10Games = (games: string[]) => {
    if (!games || games.length === 0) {
      return <Text type="secondary">—</Text>
    }

    return (
      <Space size={4}>
        {games.map((result, idx) => (
          <Tooltip
            key={idx}
            title={result === 'W' ? 'Win' : 'Loss'}
            placement="top"
          >
            <Badge
              count={result}
              style={{
                backgroundColor: result === 'W' ? '#52c41a' : '#f5222d',
                fontSize: 10,
                padding: '2px 6px',
                borderRadius: 3,
                minWidth: 18,
                textAlign: 'center',
                fontWeight: 'bold',
              }}
            />
          </Tooltip>
        ))}
      </Space>
    )
  }

  const renderWinRate = (rate: number) => {
    let color = '#52c41a' // green for high win rate
    if (rate < 40) {
      color = '#f5222d' // red for low win rate
    } else if (rate < 50) {
      color = '#fa8c16' // orange for medium-low
    } else if (rate < 55) {
      color = '#1890ff' // blue for medium
    }

    return (
      <Tooltip title={`${rate.toFixed(2)}%`}>
        <Text strong style={{ color }}>
          {rate.toFixed(1)}%
        </Text>
      </Tooltip>
    )
  }

  const columns = [
    {
      title: 'Bot ID',
      dataIndex: 'bot_id',
      key: 'bot_id',
      width: 120,
      render: (id: string) => (
        <Tooltip title={id}>
          <Text type="secondary" style={{ fontSize: 11 }}>
            {id.slice(0, 8)}...
          </Text>
        </Tooltip>
      ),
    },
    {
      title: 'Name',
      dataIndex: 'name',
      key: 'name',
      width: 140,
      render: (name: string) => <Text strong>{name || '—'}</Text>,
    },
    {
      title: 'Lifetime Wins',
      dataIndex: 'lifetime_wins',
      key: 'lifetime_wins',
      width: 130,
      sorter: (a: BotMetric, b: BotMetric) => a.lifetime_wins - b.lifetime_wins,
      render: (wins: number) => (
        <Text style={{ color: '#52c41a', fontWeight: 'bold' }}>
          {wins.toLocaleString()}
        </Text>
      ),
    },
    {
      title: 'Win Rate (%)',
      dataIndex: 'win_rate',
      key: 'win_rate',
      width: 130,
      sorter: (a: BotMetric, b: BotMetric) => a.win_rate - b.win_rate,
      render: (rate: number) => renderWinRate(rate),
    },
    {
      title: 'vs RP Win Rate (%)',
      dataIndex: 'vs_rp_win_rate',
      key: 'vs_rp_win_rate',
      width: 150,
      sorter: (a: BotMetric, b: BotMetric) =>
        a.vs_rp_win_rate - b.vs_rp_win_rate,
      render: (rate: number) => renderWinRate(rate),
    },
    {
      title: 'Last 10 Games',
      dataIndex: 'last_10_games',
      key: 'last_10_games',
      width: 220,
      render: (games: string[]) => renderLast10Games(games),
    },
  ]

  return (
    <Spin spinning={loading}>
      <Table
        dataSource={data}
        columns={columns}
        rowKey="bot_id"
        loading={loading}
        pagination={{
          current: page,
          pageSize,
          total,
          onChange: (p) => setPage(p),
          showSizeChanger: false,
          showTotal: (total) => `Total ${total} bots`,
        }}
        scroll={{ x: 1200 }}
        size="small"
        style={{ marginTop: 16 }}
        locale={{
          emptyText:
            data.length === 0 && !loading ? (
              <Empty description="No bot metrics available" />
            ) : undefined,
        }}
      />
    </Spin>
  )
}
