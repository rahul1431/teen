import { useEffect, useState } from 'react'
import { Card, Empty, Spin } from 'antd'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import dayjs from 'dayjs'
import { adminApi } from '../api/client'

interface RawPoint { date: string; type: string; count: number }

export function NotificationBellTrendChart() {
  const [points, setPoints] = useState<RawPoint[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchTrend()
  }, [])

  async function fetchTrend() {
    setLoading(true)
    try {
      const res = await adminApi.get('/notifications/bell-trend', { params: { days: 30 } })
      setPoints(res.data.trend || [])
    } catch {
      setPoints([])
    } finally {
      setLoading(false)
    }
  }

  // Pivot [{date, type, count}] into one row per date with a column per type,
  // which is what recharts' stacked <Bar> needs.
  const types = Array.from(new Set(points.map((p) => p.type)))
  const byDate = new Map<string, any>()
  for (const p of points) {
    const key = dayjs(p.date).format('MMM DD')
    if (!byDate.has(key)) byDate.set(key, { date: key })
    byDate.get(key)[p.type] = p.count
  }
  const chartData = Array.from(byDate.values())

  const COLORS = ['#1677ff', '#faad14', '#00c853', '#d4af37', '#eb2f96', '#722ed1']

  return (
    <Card title="Alert Volume by Type (last 30 days)" bordered={false} style={{ marginBottom: 16 }}>
      <Spin spinning={loading}>
        {chartData.length > 0 ? (
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} allowDecimals={false} />
              <Tooltip />
              <Legend />
              {types.map((t, i) => (
                <Bar key={t} dataKey={t} name={t} stackId="alerts" fill={COLORS[i % COLORS.length]} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        ) : (
          !loading && <Empty description="No alerts recorded yet" />
        )}
      </Spin>
    </Card>
  )
}
