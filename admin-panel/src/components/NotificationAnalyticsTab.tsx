import { useEffect, useState } from 'react'
import { Card, Empty, Spin, Row, Col } from 'antd'
import {
  LineChart, Line, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts'
import dayjs from 'dayjs'
import { adminApi } from '../api/client'

interface TrendPoint {
  date: string
  campaignsSent: number
  avgReadRate: number
}

interface TypeBreakdown {
  type: string
  campaignsSent: number
  avgReadRate: number
}

export function NotificationAnalyticsTab() {
  const [trend, setTrend] = useState<TrendPoint[]>([])
  const [byType, setByType] = useState<TypeBreakdown[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchAnalytics()
  }, [])

  async function fetchAnalytics() {
    setLoading(true)
    try {
      const res = await adminApi.get('/notifications/analytics', { params: { days: 30 } })
      setTrend(res.data.trend || [])
      setByType(res.data.byType || [])
    } catch {
      setTrend([])
      setByType([])
    } finally {
      setLoading(false)
    }
  }

  const trendFormatted = trend.map((p) => ({
    ...p,
    date: dayjs(p.date).format('MMM DD'),
    avgReadRatePct: p.avgReadRate * 100,
  }))
  const byTypeFormatted = byType.map((t) => ({ ...t, avgReadRatePct: t.avgReadRate * 100 }))

  return (
    <Spin spinning={loading}>
      <Row gutter={[16, 16]}>
        <Col span={24}>
          <Card title="Sends & Read Rate (last 30 days)" bordered={false}>
            {trendFormatted.length > 0 ? (
              <ResponsiveContainer width="100%" height={320}>
                <LineChart data={trendFormatted}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" tick={{ fontSize: 12 }} />
                  <YAxis yAxisId="left" tick={{ fontSize: 12 }} label={{ value: 'Campaigns Sent', angle: -90, position: 'insideLeft' }} />
                  <YAxis yAxisId="right" orientation="right" domain={[0, 100]} tick={{ fontSize: 12 }} label={{ value: 'Read Rate (%)', angle: 90, position: 'insideRight' }} />
                  <Tooltip formatter={(value: any, name: string) => (name === 'Avg Read Rate' ? `${Number(value).toFixed(1)}%` : value)} />
                  <Legend />
                  <Line yAxisId="left" type="monotone" dataKey="campaignsSent" name="Campaigns Sent" stroke="#1677ff" strokeWidth={2} isAnimationActive={false} />
                  <Line yAxisId="right" type="monotone" dataKey="avgReadRatePct" name="Avg Read Rate" stroke="#00c853" strokeWidth={2} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              !loading && <Empty description="No notifications sent yet" />
            )}
          </Card>
        </Col>
        <Col span={24}>
          <Card title="Read Rate by Type (last 30 days)" bordered={false}>
            {byTypeFormatted.length > 0 ? (
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={byTypeFormatted}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="type" tick={{ fontSize: 12 }} />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 12 }} label={{ value: 'Avg Read Rate (%)', angle: -90, position: 'insideLeft' }} />
                  <Tooltip formatter={(value: any) => `${Number(value).toFixed(1)}%`} />
                  <Bar dataKey="avgReadRatePct" name="Avg Read Rate" fill="#d4af37" />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              !loading && <Empty description="No notifications sent yet" />
            )}
          </Card>
        </Col>
      </Row>
    </Spin>
  )
}
