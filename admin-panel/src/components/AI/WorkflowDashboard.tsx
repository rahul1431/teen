import { useState, useEffect } from 'react'
import { Card, Row, Col, Progress, Tag, List, Empty, Spin, Alert, Statistic, Divider } from 'antd'
import { CheckCircleOutlined, SyncOutlined, ClockCircleOutlined, AlertOutlined } from '@ant-design/icons'
import { adminApi } from '../../api/client'

interface ModelStatus {
  name: string
  status: 'training' | 'completed' | 'queued' | 'error'
  accuracy?: number
  eta?: string
  lastRetrain?: string
}

interface MLJob {
  id: string
  name: string
  status: 'running' | 'completed' | 'failed'
  progress: number
  processed: number
  total: number
  latency?: number
  startTime?: string
}

interface Prediction {
  id: string
  type: 'churn' | 'fraud' | 'bot_decision'
  target: string
  score: number
  confidence: number
  timestamp: string
  action?: string
}

export function WorkflowDashboard() {
  const [models, setModels] = useState<ModelStatus[]>([])
  const [jobs, setJobs] = useState<MLJob[]>([])
  const [predictions, setPredictions] = useState<Prediction[]>([])
  const [loading, setLoading] = useState(true)
  const [systemHealth, setSystemHealth] = useState<any>(null)

  useEffect(() => {
    loadDashboard()
    const interval = setInterval(loadDashboard, 5000) // Refresh every 5s

    const handleRefresh = () => {
      loadDashboard()
    }
    window.addEventListener('aiDashboardRefresh', handleRefresh)

    return () => {
      clearInterval(interval)
      window.removeEventListener('aiDashboardRefresh', handleRefresh)
    }
  }, [])

  const loadDashboard = async () => {
    setLoading(true)
    try {
      const response = await adminApi.get('/ml/metrics')
      if (response.data.success) {
        const data = response.data.data
        setModels(data.models || [])
        setJobs(data.jobs || [])
        setPredictions(data.predictions || [])
        setSystemHealth(data.system || {})
      }
    } catch (err) {
      console.error('Failed to load ML metrics', err)
    } finally {
      setLoading(false)
    }
  }

  const getStatusColor = (status: string) => {
    const colors: { [key: string]: string } = {
      training: 'processing',
      completed: 'success',
      queued: 'default',
      error: 'error',
      running: 'processing',
      failed: 'error',
    }
    return colors[status] || 'default'
  }

  const getStatusIcon = (status: string) => {
    const icons: { [key: string]: any } = {
      training: <SyncOutlined spin />,
      completed: <CheckCircleOutlined />,
      queued: <ClockCircleOutlined />,
      error: <AlertOutlined />,
      running: <SyncOutlined spin />,
      failed: <AlertOutlined />,
    }
    return icons[status]
  }

  if (loading && models.length === 0) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 50 }}>
        <Spin size="large" />
      </div>
    )
  }

  return (
    <div>
      {/* Status Alert - Phase 1 */}
      <Alert
        message="â­ Phase 1: Fraud Detection Rules Engine - ACTIVE"
        description="Real-time fraud detection with 4 rules: co-location, win-rate anomalies, velocity checks, referral chains. Rules weight: 30/35/20/15%. Actions: allow (<0.4), slow_lane (0.4-0.85), block (>0.85)."
        type="success"
        showIcon
        style={{ marginBottom: 24 }}
      />

      {/* Training Progress (Left Panel) */}
      <Row gutter={24} style={{ marginBottom: 24 }}>
        <Col xs={24} sm={8}>
          <Card title="ðŸ“Š Model Training Status" size="small">
            {models.length === 0 ? (
              <Empty description="No models training" />
            ) : (
              <List
                dataSource={models}
                renderItem={(model) => (
                  <List.Item style={{ padding: 0, marginBottom: 16 }}>
                    <div style={{ width: '100%' }}>
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          marginBottom: 8,
                        }}
                      >
                        <strong>{model.name}</strong>
                        <Tag color={getStatusColor(model.status)}>
                          {model.status}
                        </Tag>
                      </div>

                      {model.status === 'training' ? (
                        <>
                          <Progress percent={0} size="small" status="active" />
                          <div style={{ fontSize: 12, marginTop: 4 }}>
                            ETA: {model.eta || '--'}
                          </div>
                        </>
                      ) : model.status === 'error' ? (
                        <>
                          <Progress percent={0} size="small" status="exception" />
                          <div style={{ fontSize: 12, marginTop: 4, color: '#ff4d4f' }}>
                            Error - Check logs
                          </div>
                        </>
                      ) : (
                        <>
                          <Progress
                            percent={Math.round((model.accuracy || 0) * 100)}
                            size="small"
                            status={
                              (model.accuracy || 0) > 0.8
                                ? 'success'
                                : 'normal'
                            }
                          />
                          <div style={{ fontSize: 12, marginTop: 4 }}>
                            Accuracy:{' '}
                            {((model.accuracy || 0) * 100).toFixed(1)}%
                          </div>
                        </>
                      )}

                      <div style={{ fontSize: 11, color: '#999', marginTop: 4 }}>
                        Last retrain: {model.lastRetrain ? new Date(model.lastRetrain).toLocaleString() : 'N/A'}
                      </div>
                    </div>
                  </List.Item>
                )}
              />
            )}
          </Card>
        </Col>

        {/* Active Jobs (Center Panel) */}
        <Col xs={24} sm={8}>
          <Card title="âš™ï¸ Active ML Jobs" size="small">
            {jobs.length === 0 ? (
              <Empty description="No active jobs" />
            ) : (
              <List
                dataSource={jobs}
                renderItem={(job) => (
                  <List.Item style={{ padding: 0, marginBottom: 16 }}>
                    <div style={{ width: '100%' }}>
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          marginBottom: 8,
                        }}
                      >
                        <strong>{job.name}</strong>
                        {getStatusIcon(job.status)}
                      </div>

                      <Progress
                        percent={job.progress}
                        size="small"
                        status={
                          job.status === 'failed'
                            ? 'exception'
                            : job.status === 'completed'
                              ? 'success'
                              : 'active'
                        }
                      />

                      <div
                        style={{
                          fontSize: 12,
                          marginTop: 4,
                          display: 'flex',
                          justifyContent: 'space-between',
                        }}
                      >
                        <span>
                          {job.processed} / {job.total}
                        </span>
                        {job.latency && (
                          <span>{job.latency.toFixed(2)}ms</span>
                        )}
                      </div>
                    </div>
                  </List.Item>
                )}
              />
            )}
          </Card>
        </Col>

        {/* System Health (Right Panel) */}
        <Col xs={24} sm={8}>
          <Card title="ðŸ–¥ï¸ System Health" size="small">
            {systemHealth ? (
              <>
                <Row gutter={8}>
                  <Col xs={12}>
                    <Statistic
                      title="CPU"
                      value={systemHealth.cpu || '--'}
                      suffix="%"
                    />
                  </Col>
                  <Col xs={12}>
                    <Statistic
                      title="Memory"
                      value={systemHealth.memory || '--'}
                      suffix="%"
                    />
                  </Col>
                </Row>

                <Divider style={{ margin: '12px 0' }} />

                <div style={{ fontSize: 13 }}>
                  <div style={{ marginBottom: 8 }}>
                    <strong>Latency (ms)</strong>
                    <br />
                    <span style={{ color: '#52c41a' }}>
                      p50: {systemHealth.latency_p50 || '--'}
                    </span>
                    <br />
                    <span style={{ color: '#faad14' }}>
                      p95: {systemHealth.latency_p95 || '--'}
                    </span>
                  </div>

                  <div>
                    <strong>Model Inference Speed</strong>
                    <br />
                    {systemHealth.model_speed || '--'} ms/prediction
                  </div>
                </div>
              </>
            ) : (
              <Empty description="Loading..." />
            )}
          </Card>
        </Col>
      </Row>

      <Divider />

      {/* Predictions Feed (Bottom) */}
      <Card title="ðŸŽ¯ Real-Time Predictions & Alerts">
        <Row gutter={24}>
          {/* Churn Risk Alerts */}
          <Col xs={24} md={12}>
            <Alert
              message="Churn Risk Alerts"
              type="warning"
              showIcon
              style={{ marginBottom: 12 }}
            />
            <List
              dataSource={predictions.filter((p) => p.type === 'churn')}
              size="small"
              locale={{
                emptyText: 'No churn alerts',
              }}
              renderItem={(pred) => (
                <List.Item>
                  <List.Item.Meta
                    title={pred.target}
                    description={`Risk: ${(pred.score * 100).toFixed(0)}% | Confidence: ${(pred.confidence * 100).toFixed(0)}%`}
                  />
                  <Tag
                    color={
                      pred.score > 0.7
                        ? 'red'
                        : pred.score > 0.4
                          ? 'orange'
                          : 'green'
                    }
                  >
                    {pred.action || 'Monitor'}
                  </Tag>
                </List.Item>
              )}
            />
          </Col>

          {/* Fraud Alerts */}
          <Col xs={24} md={12}>
            <Alert
              message="Fraud Detection Alerts"
              type="error"
              showIcon
              style={{ marginBottom: 12 }}
            />
            <List
              dataSource={predictions.filter((p) => p.type === 'fraud')}
              size="small"
              locale={{
                emptyText: 'No fraud alerts',
              }}
              renderItem={(pred) => (
                <List.Item>
                  <List.Item.Meta
                    title={pred.target}
                    description={`Score: ${(pred.score * 100).toFixed(0)}% | ${new Date(pred.timestamp).toLocaleTimeString()}`}
                  />
                  <Tag color="red">{pred.action || 'Block'}</Tag>
                </List.Item>
              )}
            />
          </Col>
        </Row>

        <Divider style={{ margin: '16px 0' }} />

        {/* Bot Decisions */}
        <div>
          <Alert
            message="Bot Decision Stream (Last 10)"
            type="info"
            showIcon
            style={{ marginBottom: 12 }}
          />
          <List
            dataSource={predictions.filter((p) => p.type === 'bot_decision')}
            size="small"
            locale={{
              emptyText: 'No bot decisions',
            }}
            renderItem={(pred) => (
              <List.Item>
                <List.Item.Meta
                  title={`${pred.target} â†’ ${pred.action}`}
                  description={`Confidence: ${(pred.confidence * 100).toFixed(0)}% | ${new Date(pred.timestamp).toLocaleTimeString()}`}
                />
              </List.Item>
            )}
          />
        </div>
      </Card>
    </div>
  )
}


