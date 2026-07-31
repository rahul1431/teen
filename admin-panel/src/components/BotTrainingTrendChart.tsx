import { useEffect, useState } from 'react'
import { Card, Empty, Spin } from 'antd'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts'
import dayjs from 'dayjs'
import { adminApi } from '../api/client'

interface TrendPoint {
  date: string
  games: number
  successRate: number
  targetWinRate: number
}

interface BotTrainingTrendChartProps {
  gameType?: 'ludo' | 'teen_patti'
}

export const BotTrainingTrendChart: React.FC<BotTrainingTrendChartProps> = ({ gameType = 'ludo' }) => {
  const [trend, setTrend] = useState<TrendPoint[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchTrend()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameType])

  const fetchTrend = async () => {
    setLoading(true)
    try {
      const response = await adminApi.get(`/${gameType}/bot-training/trend`, { params: { days: 30 } })
      setTrend(response.data.trend || [])
    } catch (error) {
      setTrend([])
    } finally {
      setLoading(false)
    }
  }

  const formatted = trend.map((point) => ({
    ...point,
    date: dayjs(point.date).format('MMM DD'),
    successRatePct: point.successRate * 100,
    targetWinRatePct: point.targetWinRate * 100,
  }))

  return (
    <Card title="Training Progress (is it improving?)" bordered={false}>
      <Spin spinning={loading}>
        {formatted.length > 0 ? (
          <ResponsiveContainer width="100%" height={320}>
            <LineChart data={formatted}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" tick={{ fontSize: 12 }} />
              <YAxis
                domain={[0, 100]}
                tick={{ fontSize: 12 }}
                label={{ value: 'Success Rate (%)', angle: -90, position: 'insideLeft' }}
              />
              <Tooltip formatter={(value: any) => `${Number(value).toFixed(1)}%`} />
              <Legend />
              <Line
                type="monotone"
                dataKey="successRatePct"
                name="Coordination Success Rate"
                stroke="#1677ff"
                strokeWidth={2}
                isAnimationActive={false}
              />
              <Line
                type="monotone"
                dataKey="targetWinRatePct"
                name="Target Win Rate"
                stroke="#faad14"
                strokeDasharray="5 5"
                strokeWidth={2}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          !loading && <Empty description="Not enough coordinated games recorded yet" />
        )}
      </Spin>
    </Card>
  )
}
