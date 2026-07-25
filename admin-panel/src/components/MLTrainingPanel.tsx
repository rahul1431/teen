import React, { useEffect, useState } from 'react'
import { Card, Slider, Button, Space, message, Statistic, Row, Col, Typography, Progress, Alert, Tag } from 'antd'
import { Link } from 'react-router-dom'
import { adminApi } from '../api/client'

const { Text, Paragraph } = Typography

interface MlTrainingStatus {
  canary_pct: number
  post_cutover_ludo_rows: number
  min_training_rows_required: number
  training_ready: boolean
  difficulty_model_trained: boolean | null
  difficulty_model_test_accuracy: number | null
  churn_ml_service_reachable: boolean
}

export const MLTrainingPanel: React.FC = () => {
  const [status, setStatus] = useState<MlTrainingStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [pendingPct, setPendingPct] = useState<number | null>(null)
  const [savingPct, setSavingPct] = useState(false)
  const [training, setTraining] = useState(false)
  const [runningAnomalyScan, setRunningAnomalyScan] = useState(false)

  const fetchStatus = async () => {
    try {
      const res = await adminApi.get<MlTrainingStatus>('/ludo/ml-training/status')
      setStatus(res.data)
      setPendingPct(res.data.canary_pct)
    } catch {
      message.error('Failed to load ML training status')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchStatus()
  }, [])

  const saveCanaryPct = async () => {
    if (pendingPct === null) return
    setSavingPct(true)
    try {
      await adminApi.patch('/ludo/ml-training/canary', { pct: pendingPct })
      message.success(`Canary rollout set to ${pendingPct}%`)
      fetchStatus()
    } catch {
      message.error('Failed to update canary %')
    } finally {
      setSavingPct(false)
    }
  }

  const trainNow = async () => {
    setTraining(true)
    try {
      const res = await adminApi.post('/ludo/ml-training/train-difficulty')
      message.success(
        `Trained: ${(res.data.test_accuracy * 100).toFixed(1)}% test accuracy on ${res.data.samples} samples`
      )
      fetchStatus()
    } catch (err: any) {
      message.error(err?.response?.data?.error || 'Training failed')
    } finally {
      setTraining(false)
    }
  }

  const runAnomalyScan = async () => {
    setRunningAnomalyScan(true)
    try {
      const res = await adminApi.post('/ludo/ml-training/run-anomaly-detection')
      message.success(
        `Scanned ${res.data.num_players} players, found ${res.data.num_anomalies} anomalies`
      )
    } catch (err: any) {
      message.error(err?.response?.data?.error || 'Anomaly detection failed')
    } finally {
      setRunningAnomalyScan(false)
    }
  }

  if (loading || !status) return <Card loading />

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <Card title="Personalized Difficulty (ML)" bordered={false}>
        <Paragraph type="secondary">
          Recommends easy/medium/hard bot difficulty per real player based on their
          skill and engagement — not a win-rate target. See{' '}
          <Text code>PERSONALIZATION_CANARY_PCT_LUDO</Text> rollout design doc for
          details.
        </Paragraph>

        <Row gutter={[24, 16]} style={{ marginBottom: 16 }}>
          <Col xs={24} sm={8}>
            <Statistic
              title="Training Data Readiness"
              value={status.post_cutover_ludo_rows}
              suffix={`/ ${status.min_training_rows_required}`}
              valueStyle={{ color: status.training_ready ? '#52c41a' : undefined }}
            />
            <Progress
              percent={Math.min(
                100,
                Math.round((status.post_cutover_ludo_rows / status.min_training_rows_required) * 100)
              )}
              size="small"
              status={status.training_ready ? 'success' : 'active'}
              showInfo={false}
            />
            <Text type="secondary" style={{ fontSize: 12 }}>
              Real post-fix Ludo games with a known winner (see Game History fix,
              2026-07-25)
            </Text>
          </Col>
          <Col xs={24} sm={8}>
            <Statistic
              title="Difficulty Model Accuracy"
              value={
                status.difficulty_model_test_accuracy !== null
                  ? status.difficulty_model_test_accuracy * 100
                  : undefined
              }
              precision={1}
              suffix="%"
              valueStyle={{ color: '#1677ff' }}
            />
            <Text type="secondary" style={{ fontSize: 12 }}>
              {status.difficulty_model_test_accuracy !== null
                ? 'From most recent training this session'
                : 'Not measured yet this session — resets on service restart'}
            </Text>
          </Col>
          <Col xs={24} sm={8}>
            {!status.churn_ml_service_reachable && (
              <Alert type="error" message="churn-ml-service unreachable" showIcon />
            )}
          </Col>
        </Row>

        <div style={{ maxWidth: 480, marginBottom: 16 }}>
          <Text strong>Canary Rollout %</Text>
          <Slider
            min={0}
            max={100}
            value={pendingPct ?? 0}
            onChange={setPendingPct}
            marks={{ 0: '0% (off)', 100: '100%' }}
          />
        </div>

        <Space>
          <Button type="primary" onClick={saveCanaryPct} loading={savingPct}>
            Save Canary %
          </Button>
          <Button
            onClick={trainNow}
            loading={training}
            disabled={!status.training_ready}
            title={!status.training_ready ? 'Not enough real post-fix Ludo games yet' : undefined}
          >
            Train Now
          </Button>
        </Space>
      </Card>

      <Card title="Anomaly / Fraud Detection" bordered={false}>
        <Paragraph type="secondary">
          Isolation Forest sweep across win-rate spikes, session-length changes, bet
          aggression, churn-risk jumps, and game-frequency deviations.{' '}
          <Tag color="orange">Cross-game, not Ludo-specific</Tag> — this looks at a
          player's behavior across every game they play, same as the existing
          Player Anomalies dashboard it feeds.
        </Paragraph>
        <Space>
          <Button onClick={runAnomalyScan} loading={runningAnomalyScan}>
            Run Detection Now
          </Button>
          <Link to="/admin/player-anomalies">
            <Button>View Anomalies Dashboard</Button>
          </Link>
        </Space>
      </Card>

      <Card title="Bot Playstyle ML" bordered={false}>
        <Alert
          type="info"
          showIcon
          message="Not yet built"
          description="Having ML output bot behavior parameters (capture/safe-play probabilities) directly per opponent, instead of only picking an easy/medium/hard tier, needs its own design and training data before implementation. Today, difficulty tier still maps to a pre-set trained profile (see Bot Training tab)."
        />
      </Card>
    </div>
  )
}
