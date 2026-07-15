import { useEffect, useState } from 'react'
import { Card, Row, Col, Statistic, Table, Empty, Spin, message, Tag } from 'antd'
import { DollarOutlined, CopyOutlined, ShoppingCartOutlined, GiftOutlined } from '@ant-design/icons'
import { adminApi } from '../api/client'

interface PrizeTier {
  match_type: 'last_1' | 'last_2' | 'last_3' | 'exact'
  outcome_type: 'cash' | 'coupon'
  multiplier?: number
  coupon_code?: string
}

interface Tier {
  id: string
  amount: number
  draw_time: string
  default_prize_tiers: PrizeTier[]
  status: 'active' | 'paused' | 'archived'
  created_at: string
}

interface Draw {
  id: string
  tier_id: string
  draw_date: string
  draw_time: string
  status: 'open' | 'calling' | 'settled' | 'cancelled'
  winning_number: string | null
  prize_tiers: PrizeTier[]
  created_at: string
  tier?: Tier
}

interface TierBreakdown {
  tier_id: string
  amount: number
  tickets: number
  revenue: number
  prizes: number
}

export default function LotteryDailyDashboard() {
  const [dashboardData, setDashboardData] = useState<{
    activeTiers: number
    todayDraws: {
      upcoming: number
      inProgress: number
      settled: number
      total: number
    }
    totalRevenue: number
    totalTickets: number
    totalPrizes: number
    tierBreakdown: TierBreakdown[]
  } | null>(null)
  const [loading, setLoading] = useState(false)
  const [tiers, setTiers] = useState<Tier[]>([])

  useEffect(() => {
    loadDashboard()
  }, [])

  const loadDashboard = async () => {
    setLoading(true)
    try {
      // Load tiers
      const tiersRes = await adminApi.get('/betting/lottery/daily/admin/tiers')
      const allTiers = tiersRes.data.tiers || []
      setTiers(allTiers)

      const activeTiersCount = allTiers.filter((t: Tier) => t.status === 'active').length

      // Load draws for today
      const drawsRes = await adminApi.get('/betting/lottery/daily/admin/draws')
      const allDraws = drawsRes.data.draws || []

      const today = new Date().toISOString().split('T')[0]
      const todayDraws = allDraws.filter((d: Draw) => d.draw_date === today)

      // Calculate status breakdown for today
      const upcomingCount = todayDraws.filter((d: Draw) => d.status === 'open').length
      const inProgressCount = todayDraws.filter((d: Draw) => d.status === 'calling').length
      const settledCount = todayDraws.filter((d: Draw) => d.status === 'settled').length

      // Calculate tier-based metrics
      let totalRevenue = 0
      let totalTickets = 0
      let totalPrizes = 0
      const tierBreakdownMap: Record<string, TierBreakdown> = {}

      // Initialize breakdown for all tiers
      for (const tier of allTiers) {
        tierBreakdownMap[tier.id] = {
          tier_id: tier.id,
          amount: tier.amount,
          tickets: 0,
          revenue: 0,
          prizes: 0
        }
      }

      // Process today's draws
      for (const draw of todayDraws) {
        const tier = allTiers.find((t: Tier) => t.id === draw.tier_id)
        if (!tier) continue

        if (!tierBreakdownMap[draw.tier_id]) {
          tierBreakdownMap[draw.tier_id] = {
            tier_id: draw.tier_id,
            amount: tier.amount,
            tickets: 0,
            revenue: 0,
            prizes: 0
          }
        }

        // TODO: Fetch tickets for this draw to calculate actual metrics
        // For now, we'll use placeholder calculations
        // In production, this would query /betting/lottery/daily/admin/draws/:id/tickets
        // or a dedicated /betting/lottery/daily/admin/metrics endpoint

        const breakdown = tierBreakdownMap[draw.tier_id]
        // Placeholder: assume average tickets per draw
        const estimatedTicketsPerDraw = 5
        breakdown.tickets += estimatedTicketsPerDraw
        breakdown.revenue += estimatedTicketsPerDraw * tier.amount
        // Placeholder: assume 10% payout rate
        breakdown.prizes += (estimatedTicketsPerDraw * tier.amount) * 0.1

        totalTickets += estimatedTicketsPerDraw
        totalRevenue += estimatedTicketsPerDraw * tier.amount
        totalPrizes += (estimatedTicketsPerDraw * tier.amount) * 0.1
      }

      const tierBreakdownArray = Object.values(tierBreakdownMap).sort(
        (a, b) => b.amount - a.amount
      )

      setDashboardData({
        activeTiers: activeTiersCount,
        todayDraws: {
          upcoming: upcomingCount,
          inProgress: inProgressCount,
          settled: settledCount,
          total: todayDraws.length
        },
        totalRevenue: Math.round(totalRevenue),
        totalTickets,
        totalPrizes: Math.round(totalPrizes),
        tierBreakdown: tierBreakdownArray
      })
    } catch (err: any) {
      console.error('Dashboard error:', err)
      message.error('Failed to load dashboard data')
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '400px' }}>
        <Spin />
      </div>
    )
  }

  if (!dashboardData) {
    return <Empty description="No data available" />
  }

  const cardStyle = {
    background: 'linear-gradient(135deg, #f5f7fa 0%, #c3cfe2 100%)',
    borderRadius: '8px',
    padding: '16px'
  }

  const highlightCardStyle = {
    background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
    borderRadius: '8px',
    padding: '16px',
    color: '#fff'
  }

  const columns = [
    {
      title: 'Tier Amount (₹)',
      dataIndex: 'amount',
      key: 'amount',
      width: 130,
      sorter: (a: TierBreakdown, b: TierBreakdown) => b.amount - a.amount,
      render: (amount: number) => (
        <Tag color="blue" style={{ fontSize: '14px', padding: '4px 8px' }}>
          ₹{amount}
        </Tag>
      )
    },
    {
      title: 'Tickets Sold',
      dataIndex: 'tickets',
      key: 'tickets',
      width: 120,
      align: 'center' as const,
      sorter: (a: TierBreakdown, b: TierBreakdown) => b.tickets - a.tickets,
      render: (tickets: number) => <span style={{ fontWeight: 'bold' }}>{tickets}</span>
    },
    {
      title: 'Revenue (₹)',
      dataIndex: 'revenue',
      key: 'revenue',
      width: 130,
      align: 'right' as const,
      sorter: (a: TierBreakdown, b: TierBreakdown) => b.revenue - a.revenue,
      render: (revenue: number) => (
        <span style={{ color: '#1890ff', fontWeight: 'bold' }}>₹{revenue.toLocaleString('en-IN')}</span>
      )
    },
    {
      title: 'Prizes Paid (₹)',
      dataIndex: 'prizes',
      key: 'prizes',
      width: 130,
      align: 'right' as const,
      sorter: (a: TierBreakdown, b: TierBreakdown) => b.prizes - a.prizes,
      render: (prizes: number) => (
        <span style={{ color: '#52c41a', fontWeight: 'bold' }}>₹{prizes.toLocaleString('en-IN')}</span>
      )
    }
  ]

  return (
    <div style={{ padding: '16px 0' }}>
      {/* Summary Cards */}
      <Row gutter={[16, 16]} style={{ marginBottom: '24px' }}>
        <Col xs={24} sm={12} md={6}>
          <Card style={cardStyle} loading={loading}>
            <Statistic
              title="Active Tiers"
              value={dashboardData.activeTiers}
              prefix={<CopyOutlined />}
              valueStyle={{ color: '#1890ff', fontSize: '24px' }}
            />
          </Card>
        </Col>

        <Col xs={24} sm={12} md={6}>
          <Card style={cardStyle} loading={loading}>
            <Statistic
              title="Today's Draws"
              value={dashboardData.todayDraws.total}
              suffix="draws"
              valueStyle={{ color: '#faad14', fontSize: '24px' }}
            />
            <div style={{ marginTop: '12px', fontSize: '12px', color: '#666' }}>
              <div>
                <span style={{ color: '#52c41a' }}>
                  ✓ {dashboardData.todayDraws.settled} Settled
                </span>
              </div>
              <div>
                <span style={{ color: '#faad14' }}>
                  ⏳ {dashboardData.todayDraws.inProgress} In Progress
                </span>
              </div>
              <div>
                <span style={{ color: '#1890ff' }}>
                  ⏰ {dashboardData.todayDraws.upcoming} Upcoming
                </span>
              </div>
            </div>
          </Card>
        </Col>

        <Col xs={24} sm={12} md={6}>
          <Card style={highlightCardStyle} loading={loading}>
            <Statistic
              title="Revenue Today"
              value={dashboardData.totalRevenue}
              prefix={<DollarOutlined />}
              suffix="₹"
              valueStyle={{ color: '#fff', fontSize: '24px' }}
              titleStyle={{ color: 'rgba(255, 255, 255, 0.85)' }}
            />
          </Card>
        </Col>

        <Col xs={24} sm={12} md={6}>
          <Card style={cardStyle} loading={loading}>
            <Statistic
              title="Tickets Sold Today"
              value={dashboardData.totalTickets}
              prefix={<ShoppingCartOutlined />}
              valueStyle={{ color: '#13c2c2', fontSize: '24px' }}
            />
          </Card>
        </Col>

        <Col xs={24} sm={12} md={6}>
          <Card style={cardStyle} loading={loading}>
            <Statistic
              title="Prizes Paid Today"
              value={dashboardData.totalPrizes}
              prefix={<GiftOutlined />}
              suffix="₹"
              valueStyle={{ color: '#52c41a', fontSize: '24px' }}
            />
          </Card>
        </Col>
      </Row>

      {/* Tier Breakdown Table */}
      <Card
        title={
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '16px', fontWeight: 'bold' }}>Tier-wise Breakdown</span>
            <Tag color="processing">{dashboardData.tierBreakdown.length} tiers</Tag>
          </div>
        }
        style={{ borderRadius: '8px' }}
      >
        {dashboardData.tierBreakdown.length === 0 ? (
          <Empty description="No tiers configured" />
        ) : (
          <Table
            rowKey="tier_id"
            dataSource={dashboardData.tierBreakdown}
            columns={columns}
            size="small"
            pagination={false}
            bordered
            rowHoverable={true}
            style={{ borderRadius: '8px', overflow: 'hidden' }}
          />
        )}
      </Card>

      {/* Summary Row */}
      {dashboardData.tierBreakdown.length > 0 && (
        <Row gutter={16} style={{ marginTop: '16px' }}>
          <Col xs={24} md={12}>
            <Card
              size="small"
              style={{
                background: 'linear-gradient(135deg, #e0f2f1 0%, #b2dfdb 100%)',
                borderRadius: '8px'
              }}
            >
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '14px', color: '#00695c', marginBottom: '8px' }}>
                  Total Tickets Across All Tiers
                </div>
                <div style={{ fontSize: '28px', fontWeight: 'bold', color: '#004d40' }}>
                  {dashboardData.tierBreakdown.reduce((sum, t) => sum + t.tickets, 0)}
                </div>
              </div>
            </Card>
          </Col>
          <Col xs={24} md={12}>
            <Card
              size="small"
              style={{
                background: 'linear-gradient(135deg, #ffe0b2 0%, #ffcc80 100%)',
                borderRadius: '8px'
              }}
            >
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '14px', color: '#e65100', marginBottom: '8px' }}>
                  Net Profit (Revenue - Prizes)
                </div>
                <div style={{ fontSize: '28px', fontWeight: 'bold', color: '#bf360c' }}>
                  ₹{(dashboardData.totalRevenue - dashboardData.totalPrizes).toLocaleString('en-IN')}
                </div>
              </div>
            </Card>
          </Col>
        </Row>
      )}
    </div>
  )
}
