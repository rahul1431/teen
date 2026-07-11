import { useEffect, useState } from 'react'
import { Card, Row, Col, Statistic, Empty, Spin, Typography } from 'antd'
import { RiseOutlined, FallOutlined } from '@ant-design/icons'
import { adminApi } from '../api/client'

const { Text } = Typography

interface CohortRetention {
  cohort_size: number
  d1_retention_pct: number | null
  d7_retention_pct: number | null
  d30_retention_pct: number | null
}

interface RetentionResponse {
  personalized: CohortRetention
  standard: CohortRetention
}

function Delta({ personalized, standard }: { personalized: number | null; standard: number | null }) {
  if (personalized === null || standard === null) return null
  const diff = Math.round((personalized - standard) * 10) / 10
  if (diff === 0) return <Text type="secondary" style={{ fontSize: 12 }}>even</Text>
  const positive = diff > 0
  return (
    <Text type={positive ? 'success' : 'danger'} style={{ fontSize: 12 }}>
      {positive ? <RiseOutlined /> : <FallOutlined />} {positive ? '+' : ''}{diff}pp vs standard
    </Text>
  )
}

// Compares D1/D7/D30 retention between the personalized-difficulty canary
// cohort (Task 18/19) and the standard game_configs-driven cohort, so the
// canary % can be judged on real outcomes before ramping it up.
export function RetentionComparisonCard() {
  const [data, setData] = useState<RetentionResponse | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    adminApi
      .get('/metrics/retention')
      .then((res) => setData(res.data))
      .catch((err) => console.error('Failed to fetch retention comparison:', err))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <Spin />

  const personalized = data?.personalized
  const standard = data?.standard

  if (!personalized || !standard || (personalized.cohort_size === 0 && standard.cohort_size === 0)) {
    return <Empty description="No retention data yet — the canary hasn't run any rooms" />
  }

  return (
    <div>
      <Row gutter={[16, 16]}>
        <Col xs={24} md={12}>
          <Card size="small" title={`Personalized (${personalized.cohort_size} players)`} style={{ borderRadius: 10 }}>
            <Row gutter={8}>
              <Col span={8}>
                <Statistic title="D1" value={personalized.d1_retention_pct ?? '—'} suffix={personalized.d1_retention_pct !== null ? '%' : ''} />
                <Delta personalized={personalized.d1_retention_pct} standard={standard.d1_retention_pct} />
              </Col>
              <Col span={8}>
                <Statistic title="D7" value={personalized.d7_retention_pct ?? '—'} suffix={personalized.d7_retention_pct !== null ? '%' : ''} />
                <Delta personalized={personalized.d7_retention_pct} standard={standard.d7_retention_pct} />
              </Col>
              <Col span={8}>
                <Statistic title="D30" value={personalized.d30_retention_pct ?? '—'} suffix={personalized.d30_retention_pct !== null ? '%' : ''} />
                <Delta personalized={personalized.d30_retention_pct} standard={standard.d30_retention_pct} />
              </Col>
            </Row>
          </Card>
        </Col>
        <Col xs={24} md={12}>
          <Card size="small" title={`Standard (${standard.cohort_size} players)`} style={{ borderRadius: 10 }}>
            <Row gutter={8}>
              <Col span={8}>
                <Statistic title="D1" value={standard.d1_retention_pct ?? '—'} suffix={standard.d1_retention_pct !== null ? '%' : ''} />
              </Col>
              <Col span={8}>
                <Statistic title="D7" value={standard.d7_retention_pct ?? '—'} suffix={standard.d7_retention_pct !== null ? '%' : ''} />
              </Col>
              <Col span={8}>
                <Statistic title="D30" value={standard.d30_retention_pct ?? '—'} suffix={standard.d30_retention_pct !== null ? '%' : ''} />
              </Col>
            </Row>
          </Card>
        </Col>
      </Row>
    </div>
  )
}
