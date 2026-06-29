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
  botSettings: {
    maxWinRate: number // Cap bot win rate at X%
    difficulty: 'easy' | 'medium' | 'hard'
    decisionTreeDepth: number
    aggressionLevel: number // 1-10
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
  }, [])

  const loadConfig = async () => {
    setLoading(true)
    try {
      const response = await adminApi.get('ml/config')
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

      const response = await adminApi.post('ml/config', values)
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
                label="Days Since Last Play (weight)"
                name={['churnPrediction', 'daysSinceLastPlayWeight']}
                tooltip="How much to weight inactivity in churn score"
              >
                <Slider min={0} max={1} step={0.1} />
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

        {/* Bot Settings */}
        <Card title="ðŸ¤– Bot Settings" style={{ marginBottom: 24 }}>
          <Row gutter={24}>
            <Col xs={24} sm={12}>
              <Form.Item
                label="Max Bot Win Rate (%)"
                name={['botSettings', 'maxWinRate']}
                tooltip="Cap bot win rate at X% (fair play: 48-52%)"
              >
                <Slider min={30} max={70} marks={{ 30: '30%', 50: '50%', 70: '70%' }} />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item
                label="Decision Tree Depth"
                name={['botSettings', 'decisionTreeDepth']}
                tooltip="How deep the decision tree can grow (5-15 recommended)"
              >
                <InputNumber min={3} max={20} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={24}>
            <Col xs={24} sm={12}>
              <Form.Item
                label="Aggression Level (1-10)"
                name={['botSettings', 'aggressionLevel']}
                tooltip="How aggressive the bot plays (1=passive, 10=aggressive)"
              >
                <Slider min={1} max={10} marks={{ 1: 'passive', 5: 'balanced', 10: 'aggressive' }} />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item
                label="Difficulty"
                name={['botSettings', 'difficulty']}
              >
                <div style={{ display: 'flex', gap: 8 }}>
                  {['easy', 'medium', 'hard'].map((diff) => (
                    <Button
                      key={diff}
                      type="default"
                      onClick={() =>
                        form.setFieldValue(['botSettings', 'difficulty'], diff)
                      }
                      style={{
                        backgroundColor:
                          config.botSettings.difficulty === diff
                            ? '#1890ff'
                            : undefined,
                        color:
                          config.botSettings.difficulty === diff
                            ? '#fff'
                            : undefined,
                      }}
                    >
                      {diff}
                    </Button>
                  ))}
                </div>
              </Form.Item>
            </Col>
          </Row>

          <Form.Item
            label="Enable Bots"
            name={['botSettings', 'enabled']}
            valuePropName="checked"
          >
            <Switch />
          </Form.Item>
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

