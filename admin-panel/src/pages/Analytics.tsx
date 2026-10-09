import { useEffect, useState } from 'react'
import {
  Tabs, Card, Statistic, Row, Col, Table, Button, Modal, Form, Input,
  InputNumber, Switch, Select, message, Popconfirm, Tag, Typography,
  Radio, Space, Progress, Divider, Alert, Tooltip
} from 'antd'
import {
  RiseOutlined, FallOutlined, ReloadOutlined, ThunderboltOutlined,
  UserOutlined, DollarOutlined, TrophyOutlined, TeamOutlined,
  GlobalOutlined, MobileOutlined, DesktopOutlined, TabletOutlined,
  AimOutlined, PlusOutlined, SettingOutlined, SafetyCertificateOutlined,
  ArrowRightOutlined, CheckCircleOutlined
} from '@ant-design/icons'
import { adminApi } from '../api/client'
import { tokens } from '../theme/tokens'

const { Title, Text, Paragraph } = Typography

export default function Analytics() {
  const [period, setPeriod] = useState<number>(30)

  return (
    <div style={{ padding: '0 8px 24px' }}>
      {/* Header Bar */}
      <Row justify="space-between" align="middle" style={{ marginBottom: 20 }}>
        <Col>
          <Title level={4} style={{ margin: 0 }}>📊 Advanced Funnel Analytics & Attribution Tracker</Title>
          <Text type="secondary">End-to-end player acquisition, conversion funnel stages, UTM source attribution, and cohort retention</Text>
        </Col>
        <Col>
          <Space>
            <Radio.Group value={period} onChange={e => setPeriod(e.target.value)} buttonStyle="solid">
              <Radio.Button value={7}>7 Days</Radio.Button>
              <Radio.Button value={30}>30 Days</Radio.Button>
              <Radio.Button value={90}>90 Days</Radio.Button>
              <Radio.Button value={180}>6 Months</Radio.Button>
            </Radio.Group>
          </Space>
        </Col>
      </Row>

      {/* Main Tabs */}
      <Card bordered={false}>
        <Tabs items={[
          {
            key: 'master_funnel',
            label: <span><AimOutlined /> Acquisition & Revenue Funnel</span>,
            children: <MasterFunnelView days={period} />,
          },
          {
            key: 'sources',
            label: <span><GlobalOutlined /> UTM Attribution & Device Analytics</span>,
            children: <SourcesAttributionView days={period} />,
          },
          {
            key: 'agent_funnels',
            label: <span><TeamOutlined /> Agent Funnel Leaderboard</span>,
            children: <AgentFunnelLeaderboard days={period} />,
          },
          {
            key: 'retention_matrix',
            label: <span><RiseOutlined /> Cohort Retention Matrix</span>,
            children: <CohortRetentionMatrix days={period} />,
          },
          {
            key: 'flags',
            label: <span><SettingOutlined /> Feature Flags & A/B Rollouts</span>,
            children: <FeatureFlagsManager />,
          },
        ]} />
      </Card>
    </div>
  )
}

// -------------------------------------------------------------
// Component 1: Acquisition & Monetization Master Funnel
// -------------------------------------------------------------
function MasterFunnelView({ days }: { days: number }) {
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(false)

  const load = () => {
    setLoading(true)
    adminApi.get('/analytics/funnels/master', { params: { days } })
      .then(r => setData(r.data))
      .catch(e => message.error('Failed to load funnel data'))
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [days])

  if (!data) return <div style={{ padding: 40, textAlign: 'center' }}>Loading funnel analytics...</div>

  const s = data.summary
  const stages: any[] = data.stages || []
  const maxCount = Math.max(...stages.map(st => st.count), 1)

  const stageColors = ['#2563EB', '#0891B2', '#059669', '#D97706', '#7C3AED']

  return (
    <div>
      {/* High-Level Overview Metrics */}
      <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
        <Col xs={12} sm={8} md={4}>
          <Card size="small" style={{ background: '#FFFFFF', borderRadius: 14, border: '1px solid #E2E8F0' }}>
            <Statistic title="Total Clicks / Visits" value={s.total_clicks} prefix={<GlobalOutlined style={{ color: '#2563EB' }} />} />
          </Card>
        </Col>
        <Col xs={12} sm={8} md={4}>
          <Card size="small" style={{ background: '#FFFFFF', borderRadius: 14, border: '1px solid #E2E8F0' }}>
            <Statistic title="Total Signups" value={s.signups} prefix={<UserOutlined style={{ color: '#0891B2' }} />} />
          </Card>
        </Col>
        <Col xs={12} sm={8} md={4}>
          <Card size="small" style={{ background: '#FFFFFF', borderRadius: 14, border: '1px solid #E2E8F0' }}>
            <Statistic title="First Deposits (FTD)" value={s.ftds} prefix={<DollarOutlined style={{ color: '#059669' }} />} />
          </Card>
        </Col>
        <Col xs={12} sm={8} md={4}>
          <Card size="small" style={{ background: '#FFFFFF', borderRadius: 14, border: '1px solid #E2E8F0' }}>
            <Statistic title="Total Deposit Volume" value={s.total_deposits} precision={2} prefix="₹ " valueStyle={{ color: '#059669', fontWeight: 700 }} />
          </Card>
        </Col>
        <Col xs={12} sm={8} md={4}>
          <Card size="small" style={{ background: '#FFFFFF', borderRadius: 14, border: '1px solid #E2E8F0' }}>
            <Statistic title="Total Game Turnover" value={s.total_turnover} precision={2} prefix="₹ " valueStyle={{ color: '#D97706', fontWeight: 700 }} />
          </Card>
        </Col>
        <Col xs={12} sm={8} md={4}>
          <Card size="small" style={{ background: '#FFFFFF', borderRadius: 14, border: '1px solid #E2E8F0' }}>
            <Statistic title="Overall Conversion" value={s.overall_conversion_rate} precision={2} suffix="%" valueStyle={{ color: '#7C3AED', fontWeight: 800 }} />
          </Card>
        </Col>
      </Row>

      {/* Visual Multi-Stage Funnel Flow */}
      <Card title="🪜 5-Stage Conversion Flow & Step Drop-Offs" style={{ background: '#FFFFFF', borderRadius: 16, marginBottom: 24, border: '1px solid #E2E8F0' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          {stages.map((st, idx) => {
            const widthPct = Math.max(12, Math.round((st.count / maxCount) * 100))
            const color = stageColors[idx % stageColors.length]
            return (
              <div key={st.key} style={{ background: '#F8FAFC', borderRadius: 14, padding: '16px 20px', border: '1px solid #E2E8F0' }}>
                <Row justify="space-between" align="middle" style={{ marginBottom: 8 }}>
                  <Col>
                    <Space size="middle">
                      <span style={{ fontSize: 20 }}>{st.icon}</span>
                      <Text strong style={{ color: '#0F172A', fontSize: 15 }}>{st.label}</Text>
                    </Space>
                  </Col>
                  <Col>
                    <Space size="large">
                      <div>
                        <Text type="secondary" style={{ fontSize: 12 }}>Users / Actions: </Text>
                        <Text strong style={{ fontSize: 16, color }}>{st.count.toLocaleString()}</Text>
                      </div>
                      {idx > 0 && (
                        <Tag color={st.conversion_from_prev >= 50 ? 'green' : st.conversion_from_prev >= 20 ? 'orange' : 'red'} style={{ fontWeight: 700, padding: '2px 8px' }}>
                          {st.conversion_from_prev}% step conv
                        </Tag>
                      )}
                      {st.drop_off > 0 && (
                        <Text type="danger" style={{ fontSize: 12 }}>
                          🔻 {st.drop_off.toLocaleString()} dropped off
                        </Text>
                      )}
                    </Space>
                  </Col>
                </Row>
                <Progress
                  percent={widthPct}
                  strokeColor={color}
                  trailColor="#E2E8F0"
                  showInfo={false}
                  strokeWidth={14}
                  style={{ margin: 0 }}
                />
              </div>
            )
          })}
        </div>
      </Card>

      {/* Breakdown Details */}
      <Row gutter={[16, 16]}>
        <Col xs={24} md={12}>
          <Card title="👥 Organic vs Agent Affiliate Signup Split" style={{ background: '#FFFFFF', borderRadius: 16, height: '100%', border: '1px solid #E2E8F0' }}>
            <Row gutter={16} align="middle">
              <Col span={12}>
                <Statistic title="Agent-Referred Signups" value={s.agent_signups} valueStyle={{ color: '#D97706', fontWeight: 700 }} prefix={<TeamOutlined />} />
                <Progress percent={s.signups > 0 ? Math.round((s.agent_signups / s.signups) * 100) : 0} strokeColor="#D97706" />
              </Col>
              <Col span={12}>
                <Statistic title="Organic / Direct Signups" value={s.organic_signups} valueStyle={{ color: '#2563EB', fontWeight: 700 }} prefix={<GlobalOutlined />} />
                <Progress percent={s.signups > 0 ? Math.round((s.organic_signups / s.signups) * 100) : 0} strokeColor="#2563EB" />
              </Col>
            </Row>
          </Card>
        </Col>

        <Col xs={24} md={12}>
          <Card title="💰 Financial Conversion Economics" style={{ background: '#FFFFFF', borderRadius: 16, height: '100%', border: '1px solid #E2E8F0' }}>
            <Row gutter={16}>
              <Col span={8}>
                <Statistic title="Avg FTD Size" value={s.ftds > 0 ? (s.total_ftd_amount / s.ftds) : 0} precision={2} prefix="₹ " valueStyle={{ color: '#059669', fontWeight: 700 }} />
              </Col>
              <Col span={8}>
                <Statistic title="Avg Player Turnover" value={s.signups > 0 ? (s.total_turnover / s.signups) : 0} precision={2} prefix="₹ " valueStyle={{ color: '#D97706', fontWeight: 700 }} />
              </Col>
              <Col span={8}>
                <Statistic title="Net House GGR" value={s.net_ggr} precision={2} prefix="₹ " valueStyle={{ color: s.net_ggr >= 0 ? '#059669' : '#E11D48', fontWeight: 700 }} />
              </Col>
            </Row>
          </Card>
        </Col>
      </Row>
    </div>
  )
}

// -------------------------------------------------------------
// Component 2: UTM Attribution & Device Analytics
// -------------------------------------------------------------
function SourcesAttributionView({ days }: { days: number }) {
  const [sourcesData, setSourcesData] = useState<any>({ utm_sources: [], devices: [] })
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    setLoading(true)
    adminApi.get('/analytics/funnels/sources', { params: { days } })
      .then(r => setSourcesData(r.data))
      .finally(() => setLoading(false))
  }, [days])

  return (
    <div>
      {/* Device Breakdown */}
      <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
        {sourcesData.devices.map((d: any) => (
          <Col xs={24} sm={8} key={d.device_type}>
            <Card size="small" style={{ background: '#FFFFFF', borderRadius: 14, border: '1px solid #E2E8F0' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ fontSize: 24, color: '#D97706' }}>
                  {d.device_type === 'desktop' ? <DesktopOutlined /> : d.device_type === 'tablet' ? <TabletOutlined /> : <MobileOutlined />}
                </div>
                <div>
                  <Text strong style={{ color: '#0F172A', textTransform: 'capitalize' }}>{d.device_type} Traffic</Text>
                  <div><Text type="secondary">{d.clicks.toLocaleString()} clicks · {d.signups.toLocaleString()} signups</Text></div>
                </div>
              </div>
            </Card>
          </Col>
        ))}
      </Row>

      {/* UTM Sources Table */}
      <Card title="🌐 UTM Campaign & Source Conversion Attribution" style={{ background: '#FFFFFF', borderRadius: 16, border: '1px solid #E2E8F0' }}>
        <Table
          rowKey="source"
          dataSource={sourcesData.utm_sources}
          loading={loading}
          pagination={{ pageSize: 10 }}
          columns={[
            {
              title: 'Source / Campaign',
              dataIndex: 'source',
              render: (s: string) => <Text strong style={{ color: '#0F172A' }}>{s}</Text>
            },
            {
              title: 'Total Clicks',
              dataIndex: 'clicks',
              render: (v: number) => v.toLocaleString()
            },
            {
              title: 'Signups',
              dataIndex: 'signups',
              render: (v: number) => v.toLocaleString()
            },
            {
              title: 'Signup Rate (%)',
              dataIndex: 'signup_conversion_rate',
              render: (r: number) => <Tag color={r >= 30 ? 'green' : 'blue'}>{r}%</Tag>
            },
            {
              title: 'First Deposits (FTDs)',
              dataIndex: 'ftds',
              render: (v: number) => v.toLocaleString()
            },
            {
              title: 'FTD Conv (%)',
              dataIndex: 'ftd_conversion_rate',
              render: (r: number) => <Tag color={r >= 20 ? 'gold' : 'default'}>{r}%</Tag>
            },
            {
              title: 'Deposit Volume (₹)',
              dataIndex: 'deposit_volume',
              render: (v: number) => `₹ ${Number(v).toFixed(2)}`
            },
            {
              title: 'Game Turnover (₹)',
              dataIndex: 'total_turnover',
              render: (v: number) => <Text strong style={{ color: '#D97706' }}>₹ {Number(v).toFixed(2)}</Text>
            }
          ]}
        />
      </Card>
    </div>
  )
}

// -------------------------------------------------------------
// Component 3: Agent Referral Funnel Leaderboard
// -------------------------------------------------------------
function AgentFunnelLeaderboard({ days }: { days: number }) {
  const [agents, setAgents] = useState<any[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    setLoading(true)
    adminApi.get('/analytics/funnels/agent-leaderboard', { params: { days } })
      .then(r => setAgents(r.data))
      .finally(() => setLoading(false))
  }, [days])

  return (
    <Card title="🏆 Top Affiliate Agents Ranked by Funnel Conversion & Turnover" style={{ background: '#FFFFFF', borderRadius: 16, border: '1px solid #E2E8F0' }}>
      <Table
        rowKey="id"
        dataSource={agents}
        loading={loading}
        pagination={{ pageSize: 10 }}
        columns={[
          {
            title: 'Agent',
            render: (_: any, r: any) => (
              <div>
                <Text strong style={{ color: '#0F172A' }}>{r.display_name}</Text>
                <div><Text type="secondary">@{r.username} · Code: <Tag color="gold">{r.referral_code}</Tag></Text></div>
              </div>
            )
          },
          {
            title: 'Link Clicks',
            dataIndex: 'clicks',
            render: (v: number) => v.toLocaleString()
          },
          {
            title: 'Signups',
            dataIndex: 'signups',
            render: (v: number) => v.toLocaleString()
          },
          {
            title: 'Click → Signup %',
            dataIndex: 'conversion_rate',
            render: (r: number) => <Tag color="green">{r}%</Tag>
          },
          {
            title: 'FTDs',
            dataIndex: 'ftds',
            render: (v: number) => v.toLocaleString()
          },
          {
            title: 'FTD %',
            dataIndex: 'ftd_rate',
            render: (r: number) => <Tag color="orange">{r}%</Tag>
          },
          {
            title: 'Total Deposits (₹)',
            dataIndex: 'total_deposits',
            render: (v: number) => `₹ ${Number(v).toFixed(2)}`
          },
          {
            title: 'Total Turnover (₹)',
            dataIndex: 'total_turnover',
            render: (v: number) => <Text strong style={{ color: '#D97706' }}>₹ {Number(v).toFixed(2)}</Text>
          },
          {
            title: 'Net GGR (₹)',
            dataIndex: 'net_ggr',
            render: (v: number) => (
              <Text strong style={{ color: Number(v) >= 0 ? '#059669' : '#E11D48' }}>
                ₹ {Number(v).toFixed(2)}
              </Text>
            )
          }
        ]}
      />
    </Card>
  )
}

// -------------------------------------------------------------
// Component 4: Cohort Retention Matrix
// -------------------------------------------------------------
function CohortRetentionMatrix({ days }: { days: number }) {
  const [cohorts, setCohorts] = useState<any[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    setLoading(true)
    adminApi.get('/analytics/retention', { params: { days } })
      .then(r => setCohorts(r.data))
      .finally(() => setLoading(false))
  }, [days])

  return (
    <Card title="📈 Multi-Day Cohort Retention Matrix (Active Wagering Retention %)" style={{ background: '#FFFFFF', borderRadius: 16, border: '1px solid #E2E8F0' }}>
      <Alert
        type="info"
        showIcon
        message="Cohort Wagering Retention"
        description="Measures what percentage of players who registered in the last selected timeframe returned to place real-money wagers after Day 1, Day 3, Day 7, Day 14, and Day 30."
        style={{ marginBottom: 20 }}
      />
      <Table
        rowKey="cohort"
        dataSource={cohorts}
        loading={loading}
        pagination={false}
        columns={[
          {
            title: 'Acquisition Cohort',
            dataIndex: 'cohort',
            render: (c: string) => <Text strong style={{ color: '#0F172A', fontSize: 14 }}>{c}</Text>
          },
          {
            title: 'Total Players',
            dataIndex: 'cohort_size',
            render: (v: number) => <Text strong>{v.toLocaleString()}</Text>
          },
          {
            title: 'Day 1 (D1)',
            dataIndex: 'd1',
            render: (v: number, r: any) => (
              <div>
                <Tag color={v >= 40 ? 'green' : 'blue'}>{v}%</Tag>
                <div style={{ fontSize: 11, color: '#64748B' }}>{r.raw?.d1} players</div>
              </div>
            )
          },
          {
            title: 'Day 3 (D3)',
            dataIndex: 'd3',
            render: (v: number, r: any) => (
              <div>
                <Tag color={v >= 30 ? 'green' : 'blue'}>{v}%</Tag>
                <div style={{ fontSize: 11, color: '#64748B' }}>{r.raw?.d3} players</div>
              </div>
            )
          },
          {
            title: 'Day 7 (D7)',
            dataIndex: 'd7',
            render: (v: number, r: any) => (
              <div>
                <Tag color={v >= 20 ? 'green' : 'orange'}>{v}%</Tag>
                <div style={{ fontSize: 11, color: '#64748B' }}>{r.raw?.d7} players</div>
              </div>
            )
          },
          {
            title: 'Day 14 (D14)',
            dataIndex: 'd14',
            render: (v: number, r: any) => (
              <div>
                <Tag color={v >= 15 ? 'gold' : 'orange'}>{v}%</Tag>
                <div style={{ fontSize: 11, color: '#64748B' }}>{r.raw?.d14} players</div>
              </div>
            )
          },
          {
            title: 'Day 30 (D30)',
            dataIndex: 'd30',
            render: (v: number, r: any) => (
              <div>
                <Tag color={v >= 10 ? 'purple' : 'red'}>{v}%</Tag>
                <div style={{ fontSize: 11, color: '#64748B' }}>{r.raw?.d30} players</div>
              </div>
            )
          }
        ]}
      />
    </Card>
  )
}

// -------------------------------------------------------------
// Component 5: Feature Flags & A/B Rollouts
// -------------------------------------------------------------
function FeatureFlagsManager() {
  const [flags, setFlags] = useState<any[]>([])
  const [modalOpen, setModalOpen] = useState(false)
  const [form] = Form.useForm()

  const load = () => adminApi.get('/analytics/flags').then(r => setFlags(r.data))
  useEffect(() => { load() }, [])

  const createFlag = async (values: any) => {
    try {
      await adminApi.post('/analytics/flags', values)
      message.success('Feature Flag created')
      setModalOpen(false)
      form.resetFields()
      load()
    } catch (e: any) {
      message.error(e.response?.data?.error || 'Failed to create flag')
    }
  }

  const updateRollout = async (id: string, rollout_percent: number) => {
    try {
      await adminApi.patch(`/analytics/flags/${id}`, { rollout_percent })
      message.success('Rollout updated')
      load()
    } catch (e: any) {
      message.error(e.response?.data?.error || 'Failed to update')
    }
  }

  const toggleEnabled = async (id: string, enabled: boolean) => {
    try {
      await adminApi.patch(`/analytics/flags/${id}`, { enabled })
      message.success(enabled ? 'Flag enabled' : 'Flag disabled')
      load()
    } catch (e: any) {
      message.error(e.response?.data?.error || 'Failed to update')
    }
  }

  const deleteFlag = async (id: string) => {
    try {
      await adminApi.delete(`/analytics/flags/${id}`)
      message.success('Flag deleted')
      load()
    } catch (e: any) {
      message.error(e.response?.data?.error || 'Failed to delete')
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <Title level={5} style={{ color: '#0F172A', margin: 0 }}>Feature Flags & Controlled A/B Feature Rollouts</Title>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setModalOpen(true)}>Create Flag</Button>
      </div>

      <Table
        rowKey="id"
        dataSource={flags}
        pagination={{ pageSize: 8 }}
        columns={[
          { title: 'Flag Key', dataIndex: 'key', render: (k: string) => <Text code>{k}</Text> },
          { title: 'Description', dataIndex: 'description', render: (d: string) => d || '—' },
          {
            title: 'Enabled',
            dataIndex: 'enabled',
            render: (en: boolean, r: any) => (
              <Switch checked={en} onChange={val => toggleEnabled(r.id, val)} />
            )
          },
          {
            title: 'Rollout %',
            dataIndex: 'rollout_percent',
            render: (pct: number, r: any) => (
              <InputNumber
                min={0}
                max={100}
                value={pct}
                suffix="%"
                onChange={val => val !== null && updateRollout(r.id, val)}
              />
            )
          },
          {
            title: 'Actions',
            render: (_: any, r: any) => (
              <Popconfirm title="Delete this feature flag?" onConfirm={() => deleteFlag(r.id)}>
                <Button size="small" danger>Delete</Button>
              </Popconfirm>
            )
          }
        ]}
      />

      <Modal title="Create Feature Flag" open={modalOpen} onCancel={() => setModalOpen(false)} footer={null}>
        <Form form={form} layout="vertical" onFinish={createFlag}>
          <Form.Item name="key" label="Key (snake_case)" rules={[{ required: true }]}>
            <Input placeholder="e.g. new_cricket_odds_engine" />
          </Form.Item>
          <Form.Item name="description" label="Description">
            <Input placeholder="Brief description of the feature or experiment" />
          </Form.Item>
          <Form.Item name="rollout_percent" label="Initial Rollout %" initialValue={0}>
            <InputNumber min={0} max={100} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="enabled" label="Enabled Immediately" valuePropName="checked" initialValue={false}>
            <Switch />
          </Form.Item>
          <Button type="primary" htmlType="submit" block size="large">Create Flag</Button>
        </Form>
      </Modal>
    </div>
  )
}
