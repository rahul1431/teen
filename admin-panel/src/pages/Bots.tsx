import { useEffect, useState } from 'react'
import {
  Card, Form, Button, Row, Col, Switch, Select, InputNumber, Badge, Tag, Typography, message, Space
} from 'antd'
import { ReloadOutlined, RobotOutlined } from '@ant-design/icons'
import { adminApi } from '../api/client'
import BotManagementPanel from '../components/BotManagementPanel'

export default function Bots() {
  // Bot stats
  const [stats, setStats] = useState<any>({ total_bots: 0, active_bots: 0, total_balance: 0 })
  const [loadingStats, setLoadingStats] = useState(false)

  // Game configs (for bot settings)
  const [configs, setConfigs] = useState<any[]>([])
  const [loadingConfigs, setLoadingConfigs] = useState(false)
  const [savingConfig, setSavingConfig] = useState<string | null>(null)

  const loadStats = () => {
    setLoadingStats(true)
    adminApi.get('/bots/stats')
      .then(r => setStats(r.data))
      .catch(() => message.error('Failed to load bot stats'))
      .finally(() => setLoadingStats(false))
  }

  const loadConfigs = () => {
    setLoadingConfigs(true)
    adminApi.get('/game-configs')
      .then(r => {
        setConfigs(r.data || [])
      })
      .catch(() => message.error('Failed to load game configurations'))
      .finally(() => setLoadingConfigs(false))
  }

  const saveGameConfig = async (gameType: string, values: any) => {
    setSavingConfig(gameType)
    try {
      await adminApi.patch(`/game-configs/${gameType}`, values)
      message.success(`${gameType.toUpperCase()} bot configuration updated!`)
      loadConfigs()
      loadStats()
    } catch {
      message.error('Failed to save game configuration')
    } finally {
      setSavingConfig(null)
    }
  }

  useEffect(() => {
    loadConfigs()
    loadStats()
  }, [])

  return (
    <div style={{ padding: '12px 0' }}>
      <Row gutter={[24, 24]} align="middle" style={{ marginBottom: 24 }}>
        <Col span={12}>
          <h2 style={{ color: '#d4af37', margin: 0, display: 'flex', alignItems: 'center', gap: 12 }}>
            <RobotOutlined /> Bot Management System
          </h2>
        </Col>
        <Col span={12} style={{ textAlign: 'right' }}>
          <Space>
            <Button icon={<ReloadOutlined />} onClick={() => { loadConfigs(); loadStats() }}>
              Refresh All
            </Button>
          </Space>
        </Col>
      </Row>

      {/* Bot Wallet Statistics Row */}
      <Row gutter={[24, 24]} style={{ marginBottom: 24 }}>
        <Col xs={24} sm={12} md={8}>
          <Card loading={loadingStats} style={{ borderRadius: 12, boxShadow: '0 4px 12px rgba(0,0,0,0.05)' }}>
            <Badge.Ribbon text="Combined" color="gold">
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <span style={{ fontSize: 13, color: '#888' }}>Total Bot Pool Balance</span>
                <span style={{ fontSize: 24, fontWeight: 'bold', color: '#52c41a', marginTop: 8 }}>
                  ₹{Number(stats.total_balance || 0).toLocaleString()}
                </span>
              </div>
            </Badge.Ribbon>
          </Card>
        </Col>
        <Col xs={24} sm={12} md={8}>
          <Card loading={loadingStats} style={{ borderRadius: 12, boxShadow: '0 4px 12px rgba(0,0,0,0.05)' }}>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <span style={{ fontSize: 13, color: '#888' }}>Active Simulated Bots</span>
              <span style={{ fontSize: 24, fontWeight: 'bold', color: '#1890ff', marginTop: 8 }}>
                {stats.active_bots} <span style={{ fontSize: 14, fontWeight: 'normal', color: '#888' }}>/ {stats.total_bots} total</span>
              </span>
            </div>
          </Card>
        </Col>
      </Row>

      <Row gutter={[24, 24]}>
        {/* Left Column: Game Bot Configuration Panels */}
        <Col xs={24} xl={8}>
          <Card
            title="🎮 Bot In-Game Simulation Rules"
            loading={loadingConfigs}
            style={{ marginBottom: 24, boxShadow: '0 4px 12px rgba(0,0,0,0.05)', borderRadius: 12 }}
          >
            <div style={{ maxHeight: 'calc(100vh - 250px)', overflowY: 'auto', paddingRight: 4 }}>
              {configs.filter(c => ['teen_patti', 'ludo', 'aviator'].includes(c.game_type)).map((config) => (
                <div key={config.game_type} style={{ marginBottom: 24, paddingBottom: 20, borderBottom: '1px solid #f0f0f0' }}>
                  <Typography.Title level={5} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ color: '#d4af37' }}>
                      {config.game_type === 'teen_patti' ? '🃏 Teen Patti' : config.game_type === 'ludo' ? '🎲 Ludo' : '✈️ Aviator'}
                    </span>
                    <Tag color={config.is_active ? 'green' : 'red'}>{config.is_active ? 'Active' : 'Disabled'}</Tag>
                  </Typography.Title>

                  <Form
                    layout="vertical"
                    size="small"
                    initialValues={{
                      is_active: config.is_active,
                      bot_fill_enabled: config.bot_fill_enabled,
                      bot_fill_delay_seconds: config.bot_fill_delay_seconds,
                      max_bot_ratio: config.max_bot_ratio,
                      bot_difficulty: config.bot_difficulty
                    }}
                    onFinish={(values) => saveGameConfig(config.game_type, {
                      ...values,
                      rake_percent: config.rake_percent,
                      special_rules: config.special_rules
                    })}
                  >
                    <Row gutter={12}>
                      <Col span={12}>
                        <Form.Item name="bot_fill_enabled" label="Auto Fill Room" valuePropName="checked">
                          <Switch checkedChildren="ON" unCheckedChildren="OFF" />
                        </Form.Item>
                      </Col>
                      <Col span={12}>
                        <Form.Item name="bot_difficulty" label="Bot Skill Level">
                          <Select options={[
                            { value: 'easy', label: 'Easy' },
                            { value: 'medium', label: 'Medium' },
                            { value: 'hard', label: 'Hard' }
                          ]} />
                        </Form.Item>
                      </Col>
                    </Row>

                    <Row gutter={12}>
                      <Col span={12}>
                        <Form.Item name="bot_fill_delay_seconds" label="Join Delay (s)">
                          <InputNumber min={2} max={120} style={{ width: '100%' }} />
                        </Form.Item>
                      </Col>
                      <Col span={12}>
                        <Form.Item name="max_bot_ratio" label="Max Bot Ratio">
                          <InputNumber min={0} max={1} step={0.1} style={{ width: '100%' }} />
                        </Form.Item>
                      </Col>
                    </Row>

                    <Form.Item style={{ margin: 0 }}>
                      <Button
                        type="primary"
                        htmlType="submit"
                        block
                        loading={savingConfig === config.game_type}
                        style={{ background: '#111', borderColor: '#111' }}
                      >
                        Save Settings
                      </Button>
                    </Form.Item>
                  </Form>
                </div>
              ))}
            </div>
          </Card>
        </Col>

        {/* Right Column: Bot Users Table (all games) */}
        <Col xs={24} xl={16}>
          <BotManagementPanel />
        </Col>
      </Row>
    </div>
  )
}
