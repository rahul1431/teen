import { useState, useEffect } from 'react'
import { Card, Form, Slider, InputNumber, Switch, Button, Space, message, Divider, Alert, Row, Col } from 'antd'
import { SaveOutlined, ReloadOutlined } from '@ant-design/icons'
import { adminApi } from '../../api/client'
import { BotLearningSection } from './BotLearningSection'

interface MLConfig {
  fraudDetection: {
    coLocationThreshold: number // 3+ accounts
    winRateAnomalyThreshold: number // 95%+
    velocityLimitHours: number // â‚¹10k in X hours
    referralChainDepth: number // How deep to check
    enabled: boolean
  }
  churnPrediction: {
    daysSinceLastPlay: number
    avgLossStreakWeight: number
    bonusBalanceWeight: number
    retrainFrequency: 'daily' | 'weekly' | 'monthly'
    enabled: boolean
  }
  rtpOptimizer: {
    minRakePercent: number
    maxRakePercent: number
    testDuration: number // Hours
    confidenceThreshold: number
    enabled: boolean
  }
}

export function MLConfigPanel() {
  const [form] = Form.useForm()
  const [config, setConfig] = useState<MLConfig | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    loadConfig()
    window.addEventListener('aiDashboardRefresh', loadConfig)
    return () => window.removeEventListener('aiDashboardRefresh', loadConfig)
  }, [])

  const loadConfig = async () => {
    setLoading(true)
    try {
      const response = await adminApi.get('/ml/config')
      if (response.data.success) {
        setConfig(response.data.data)
        form.setFieldsValue(response.data.data)
      }
    } catch (err) {
      message.error('Failed to load ML configuration')
    } finally {
      setLoading(false)
    }
  }

  const handleSave = async () => {
    try {
      const values = await form.validateFields()
      setSaving(true)

      const response = await adminApi.post('/ml/config', values)
      if (response.data.success) {
        setConfig(values)
        message.success('Configuration saved successfully')
      } else {
        message.error(response.data.error || 'Failed to save configuration')
      }
    } catch (err: any) {
      message.error(err.message || 'Error saving configuration')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <div>Loading configuration...</div>
  }

  if (!config) {
    return <div>Failed to load configuration</div>
  }

  return (
    <div>
      <Alert
        message="ML Parameter Tuning"
        description="Adjust thresholds and settings for fraud detection, churn prediction, bot behavior, and revenue optimization. Changes take effect immediately."
        type="warning"
        showIcon
        style={{ marginBottom: 24 }}
      />

      <Form form={form} layout="vertical" onFinish={handleSave}>
        {/* Fraud Detection */}
        <Card title="ðŸ” Fraud Detection Rules" style={{ marginBottom: 24 }}>
          <Row gutter={24}>
            <Col xs={24} sm={12}>
              <Form.Item
                label="Co-Location Threshold (number of accounts)"
                name={['fraudDetection', 'coLocationThreshold']}
                tooltip="Flag when N+ accounts on same device win against each other"
              >
                <Slider min={2} max={10} marks={{ 2: '2', 5: '5', 10: '10' }} />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item
                label="Win-Rate Anomaly Threshold (%)"
                name={['fraudDetection', 'winRateAnomalyThreshold']}
                tooltip="Flag players with >X% win rate vs specific opponents"
              >
                <Slider min={70} max={99} marks={{ 70: '70%', 85: '85%', 99: '99%' }} />
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={24}>
            <Col xs={24} sm={12}>
              <Form.Item
                label="Velocity Limit (hours)"
                name={['fraudDetection', 'velocityLimitHours']}
                tooltip="Flag if user deposits/withdraws â‚¹10k in <X hours"
              >
                <InputNumber min={1} max={24} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item
                label="Referral Chain Depth"
                name={['fraudDetection', 'referralChainDepth']}
                tooltip="How many levels deep to check for flagged referrers"
              >
                <InputNumber min={1} max={5} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>

          <Form.Item
            label="Enable Fraud Detection"
            name={['fraudDetection', 'enabled']}
            valuePropName="checked"
          >
            <Switch />
          </Form.Item>
        </Card>

        {/* Churn Prediction */}
        <Card title="ðŸ“‰ Churn Prediction Model" style={{ marginBottom: 24 }}>
          <Row gutter={24}>
            <Col xs={24} sm={12}>
              <Form.Item
                label="Days Since Last Play"
                name={['churnPrediction', 'daysSinceLastPlay']}
                tooltip="Inactivity cutoff used as the churn-model's training label and retrain cadence"
              >
                <InputNumber min={1} max={60} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item
                label="Loss Streak Weight"
                name={['churnPrediction', 'avgLossStreakWeight']}
                tooltip="How much to weight consecutive losses"
              >
                <Slider min={0} max={1} step={0.1} />
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={24}>
            <Col xs={24} sm={12}>
              <Form.Item
                label="Retrain Frequency"
                name={['churnPrediction', 'retrainFrequency']}
              >
                <div style={{ display: 'flex', gap: 12 }}>
                  {['daily', 'weekly', 'monthly'].map((freq) => (
                    <Button
                      key={freq}
                      type="default"
                      onClick={() =>
                        form.setFieldValue(
                          ['churnPrediction', 'retrainFrequency'],
                          freq
                        )
                      }
                      style={{
                        backgroundColor:
                          config.churnPrediction.retrainFrequency === freq
                            ? '#1890ff'
                            : undefined,
                        color:
                          config.churnPrediction.retrainFrequency === freq
                            ? '#fff'
                            : undefined,
                      }}
                    >
                      {freq}
                    </Button>
                  ))}
                </div>
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item
                label="Enable Churn Prediction"
                name={['churnPrediction', 'enabled']}
                valuePropName="checked"
              >
                <Switch />
              </Form.Item>
            </Col>
          </Row>
        </Card>

        {/* RTP Optimizer */}
        <Card title="ðŸ’° RTP / Revenue Optimizer" style={{ marginBottom: 24 }}>
          <Row gutter={24}>
            <Col xs={24} sm={12}>
              <Form.Item
                label="Min Rake %"
                name={['rtpOptimizer', 'minRakePercent']}
                tooltip="Minimum rake percentage (floor)"
              >
                <InputNumber min={1} max={8} step={0.1} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item
                label="Max Rake %"
                name={['rtpOptimizer', 'maxRakePercent']}
                tooltip="Maximum rake percentage (ceiling)"
              >
                <InputNumber min={3} max={10} step={0.1} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={24}>
            <Col xs={24} sm={12}>
              <Form.Item
                label="Test Duration (hours)"
                name={['rtpOptimizer', 'testDuration']}
                tooltip="How long to test each rake variant before decision"
              >
                <InputNumber min={1} max={168} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item
                label="Confidence Threshold"
                name={['rtpOptimizer', 'confidenceThreshold']}
                tooltip="Statistical significance required to change rake"
              >
                <Slider min={0.8} max={0.99} step={0.01} marks={{ 0.8: '80%', 0.95: '95%' }} />
              </Form.Item>
            </Col>
          </Row>

          <Form.Item
            label="Enable RTP Optimization"
            name={['rtpOptimizer', 'enabled']}
            valuePropName="checked"
          >
            <Switch />
          </Form.Item>
        </Card>

        <Divider />

        {/* Action Buttons */}
        <Space style={{ width: '100%', justifyContent: 'flex-end' }}>
          <Button icon={<ReloadOutlined />} onClick={loadConfig}>
            Reset to Saved
          </Button>
          <Button
            type="primary"
            icon={<SaveOutlined />}
            onClick={handleSave}
            loading={saving}
            size="large"
          >
            Save Configuration
          </Button>
        </Space>
      </Form>

      <BotLearningSection />
    </div>
  )
}


