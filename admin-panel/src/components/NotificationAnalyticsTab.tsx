import { useEffect, useState } from 'react'
import { Card, Empty, Spin, Row, Col, Statistic, Space, Tag } from 'antd'
import {
  DollarCircleOutlined,
  CheckCircleOutlined,
  AimOutlined,
  SendOutlined,
  SafetyCertificateOutlined,
} from '@ant-design/icons'
import {
  LineChart, Line, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts'
import dayjs from 'dayjs'
import { adminApi } from '../api/client'

interface Totals {
  totalCampaigns: number
  totalRecipients: number
  totalDelivered: number
  totalClicks: number
  ctr: number
  totalConversions: number
  cvr: number
  totalFatigueProtected: number
  totalWhatsapp?: number
  totalSms?: number
  totalFallbacks?: number
  totalRevenue: number
}

interface TrendPoint {
  date: string
  campaignsSent: number
  avgReadRate: number
  avgClickRate: number
  dailyRevenue: number
}

interface TypeBreakdown {
  type: string
  campaignsSent: number
  avgReadRate: number
  avgClickRate: number
  totalRevenue: number
}

interface ReadByHour {
  hour: number
  reads: number
}

export function NotificationAnalyticsTab() {
  const [totals, setTotals] = useState<Totals | null>(null)
  const [trend, setTrend] = useState<TrendPoint[]>([])
  const [byType, setByType] = useState<TypeBreakdown[]>([])
  const [readsByHour, setReadsByHour] = useState<ReadByHour[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchAnalytics()
  }, [])

  async function fetchAnalytics() {
    setLoading(true)
    try {
      const [analyticsRes, readTimeRes] = await Promise.all([
        adminApi.get('/notifications/analytics', { params: { days: 30 } }),
        adminApi.get('/notifications/read-time-analytics', { params: { days: 30 } }),
      ])
      setTotals(analyticsRes.data.totals || null)
      setTrend(analyticsRes.data.trend || [])
      setByType(analyticsRes.data.byType || [])
      setReadsByHour(readTimeRes.data.readsByHour || [])
    } catch {
      setTotals(null)
      setTrend([])
      setByType([])
      setReadsByHour([])
    } finally {
      setLoading(false)
    }
  }

  const trendFormatted = trend.map((p) => ({
    ...p,
    date: dayjs(p.date).format('MMM DD'),
    avgReadRatePct: (p.avgReadRate || 0) * 100,
    avgClickRatePct: (p.avgClickRate || 0) * 100,
    dailyRevenue: p.dailyRevenue || 0,
  }))
  const byTypeFormatted = byType.map((t) => ({
    ...t,
    avgReadRatePct: (t.avgReadRate || 0) * 100,
    avgClickRatePct: (t.avgClickRate || 0) * 100,
  }))
  const readsByHourFormatted = readsByHour.map((h) => ({ ...h, label: `${h.hour}:00` }))
  const hasReadActivity = readsByHour.some((h) => h.reads > 0)

  return (
    <Spin spinning={loading}>
      {/* KPI Top Cards */}
      <Row gutter={[12, 12]} style={{ marginBottom: 20 }}>
        <Col xs={24} sm={12} lg={5}>
          <Card bordered={false} style={{ background: '#141414', border: '1px solid #262626' }}>
            <Statistic
              title={<span style={{ color: '#8c8c8c' }}>Attributed Revenue</span>}
              value={totals?.totalRevenue || 0}
              precision={2}
              prefix={<DollarCircleOutlined style={{ color: '#52c41a', marginRight: 6 }} />}
              suffix="₹"
              valueStyle={{ color: '#52c41a', fontWeight: 'bold' }}
            />
            <div style={{ fontSize: 11, color: '#666', marginTop: 4 }}>
              Deposits within 4h of push click
            </div>
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={5}>
          <Card bordered={false} style={{ background: '#141414', border: '1px solid #262626' }}>
            <Statistic
              title={<span style={{ color: '#8c8c8c' }}>Converted Users</span>}
              value={totals?.totalConversions || 0}
              prefix={<CheckCircleOutlined style={{ color: '#1890ff', marginRight: 6 }} />}
              valueStyle={{ color: '#e6e6e6', fontWeight: 'bold' }}
            />
            <div style={{ fontSize: 11, color: '#1890ff', marginTop: 4 }}>
              {totals?.cvr || 0}% Conversion Rate (CVR)
            </div>
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={5}>
          <Card bordered={false} style={{ background: '#141414', border: '1px solid #262626' }}>
            <Statistic
              title={<span style={{ color: '#8c8c8c' }}>Notification Clicks</span>}
              value={totals?.totalClicks || 0}
              prefix={<AimOutlined style={{ color: '#faad14', marginRight: 6 }} />}
              valueStyle={{ color: '#faad14', fontWeight: 'bold' }}
            />
            <div style={{ fontSize: 11, color: '#faad14', marginTop: 4 }}>
              {totals?.ctr || 0}% Click-Through Rate (CTR)
            </div>
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={5}>
          <Card bordered={false} style={{ background: '#141414', border: '1px solid #262626' }}>
            <Statistic
              title={<span style={{ color: '#8c8c8c' }}>Fatigue Protected</span>}
              value={totals?.totalFatigueProtected || 0}
              prefix={<SafetyCertificateOutlined style={{ color: '#13c2c2', marginRight: 6 }} />}
              valueStyle={{ color: '#13c2c2', fontWeight: 'bold' }}
            />
            <div style={{ fontSize: 11, color: '#666', marginTop: 4 }}>
              Pushes throttled by 24h cap
            </div>
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={4}>
          <Card bordered={false} style={{ background: '#141414', border: '1px solid #262626' }}>
            <Statistic
              title={<span style={{ color: '#8c8c8c' }}>Campaigns Sent</span>}
              value={totals?.totalCampaigns || 0}
              prefix={<SendOutlined style={{ color: '#722ed1', marginRight: 6 }} />}
              valueStyle={{ color: '#e6e6e6', fontWeight: 'bold' }}
            />
            <div style={{ fontSize: 11, color: '#666', marginTop: 4 }}>
              {(totals?.totalRecipients || 0).toLocaleString()} recipients
            </div>
          </Card>
        </Col>
      </Row>

      {/* Omnichannel Breakdown Pill Bar */}
      <div style={{ background: '#1a1a1a', border: '1px solid #303030', borderRadius: 8, padding: '12px 18px', marginBottom: 20, display: 'flex', flexWrap: 'wrap', gap: 20, alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontWeight: 600, color: '#e6e6e6' }}>Omnichannel Cascade Delivery:</span>
        </div>
        <Space size={16} wrap>
          <Tag color="blue" style={{ padding: '4px 10px', fontSize: 12 }}>
            📲 Push Delivered: <b>{totals?.totalDelivered || 0}</b>
          </Tag>
          <Tag color="green" style={{ padding: '4px 10px', fontSize: 12 }}>
            💬 WhatsApp Fallback: <b>{totals?.totalWhatsapp || 0}</b>
          </Tag>
          <Tag color="orange" style={{ padding: '4px 10px', fontSize: 12 }}>
            ✉️ SMS Fallback: <b>{totals?.totalSms || 0}</b>
          </Tag>
          <Tag color="cyan" style={{ padding: '4px 10px', fontSize: 12 }}>
            ⚡ Total Fallbacks: <b>{totals?.totalFallbacks || 0}</b>
          </Tag>
        </Space>
      </div>

      <Row gutter={[16, 16]}>
        <Col span={24}>
          <Card title="Performance & Attribution Trends (last 30 days)" bordered={false}>
            {trendFormatted.length > 0 ? (
              <ResponsiveContainer width="100%" height={320}>
                <LineChart data={trendFormatted}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" tick={{ fontSize: 12 }} />
                  <YAxis yAxisId="left" tick={{ fontSize: 12 }} label={{ value: 'Revenue (₹)', angle: -90, position: 'insideLeft' }} />
                  <YAxis yAxisId="right" orientation="right" domain={[0, 100]} tick={{ fontSize: 12 }} label={{ value: 'Rate (%)', angle: 90, position: 'insideRight' }} />
                  <Tooltip formatter={(value: any, name: string) => (name.includes('Rate') ? `${Number(value).toFixed(1)}%` : name.includes('Revenue') ? `₹${Number(value).toFixed(2)}` : value)} />
                  <Legend />
                  <Line yAxisId="left" type="monotone" dataKey="dailyRevenue" name="Attributed Revenue" stroke="#52c41a" strokeWidth={2.5} isAnimationActive={false} />
                  <Line yAxisId="right" type="monotone" dataKey="avgReadRatePct" name="Read Rate (%)" stroke="#1890ff" strokeWidth={2} isAnimationActive={false} />
                  <Line yAxisId="right" type="monotone" dataKey="avgClickRatePct" name="Click Rate CTR (%)" stroke="#faad14" strokeWidth={2} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              !loading && <Empty description="No notification campaigns sent yet" />
            )}
          </Card>
        </Col>
        <Col span={24}>
          <Card title="Read Rate & Click Rate by Type (last 30 days)" bordered={false}>
            {byTypeFormatted.length > 0 ? (
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={byTypeFormatted}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="type" tick={{ fontSize: 12 }} />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 12 }} label={{ value: 'Percentage (%)', angle: -90, position: 'insideLeft' }} />
                  <Tooltip formatter={(value: any) => `${Number(value).toFixed(1)}%`} />
                  <Legend />
                  <Bar dataKey="avgReadRatePct" name="Avg Read Rate (%)" fill="#1890ff" />
                  <Bar dataKey="avgClickRatePct" name="Avg Click Rate CTR (%)" fill="#faad14" />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              !loading && <Empty description="No notification campaigns sent yet" />
            )}
          </Card>
        </Col>
        <Col span={24}>
          <Card
            title="When Users Open Notifications (last 30 days, IST)"
            bordered={false}
            extra={<span style={{ fontSize: 12, color: '#8b949e' }}>Optimized send timing</span>}
          >
            {hasReadActivity ? (
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={readsByHourFormatted}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} interval={1} />
                  <YAxis tick={{ fontSize: 12 }} allowDecimals={false} label={{ value: 'Notifications Opened', angle: -90, position: 'insideLeft' }} />
                  <Tooltip />
                  <Bar dataKey="reads" name="Opened" fill="#722ed1" />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              !loading && <Empty description="No notification opens recorded yet" />
            )}
          </Card>
        </Col>
      </Row>
    </Spin>
  )
}
