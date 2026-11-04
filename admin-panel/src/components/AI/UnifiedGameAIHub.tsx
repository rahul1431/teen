import React, { useState } from 'react'
import { Card, Tabs, Tag, Alert, Row, Col, Space, Typography, Tooltip } from 'antd'
import {
  ThunderboltOutlined,
  AimOutlined,
  ExperimentOutlined,
  RobotOutlined,
  CheckCircleOutlined,
  SyncOutlined,
  InfoCircleOutlined
} from '@ant-design/icons'
import { BotLearningSection } from './BotLearningSection'
import { BotTrainingConfigPanel } from '../BotTrainingConfigPanel'
import { BotTrainingTrendChart } from '../BotTrainingTrendChart'
import { BotMetricsTable } from '../BotMetricsTable'
import { BotTrainingAuditTrail } from '../BotTrainingAuditTrail'
import { MLTrainingPanel } from '../MLTrainingPanel'

const { Text, Title } = Typography

export interface UnifiedGameAIHubProps {
  gameType: 'teen_patti' | 'ludo' | 'rummy'
}

const GAME_META: Record<string, { title: string; engine: string; desc: string; icon: string; color: string }> = {
  teen_patti: {
    title: 'Teen Patti AI Suite',
    engine: 'Go Microservice (Port 3010) + Fastify Trainer (Port 3023)',
    desc: 'High-performance Go evaluator with dynamic bluff/trap adaptation, real-time Redis opponent modeling, Box-Muller jitter, and DDAS win-rate steering.',
    icon: '🃏',
    color: '#D97706'
  },
  ludo: {
    title: 'Ludo AI Suite',
    engine: 'Node/TS Engine (Port 3011) + Fastify Trainer (Port 3024)',
    desc: 'Token pathfinder with safe-spot prioritization, opponent capture heuristics, boldness-driven decision scoring, and DDAS target steering.',
    icon: '🎲',
    color: '#2563EB'
  },
  rummy: {
    title: '13-Card Rummy AI Suite',
    engine: 'Fastify Microservice (Port 3009) + Dedicated Trainer (Port 3025)',
    desc: 'Backtracking 13-card meld optimizer with deadwood point minimization, smart discard analysis, cognitive reaction delay, and dynamic drop thresholds.',
    icon: '🎴',
    color: '#7C3AED'
  }
}

export const UnifiedGameAIHub: React.FC<UnifiedGameAIHubProps> = ({ gameType }) => {
  const [activeTab, setActiveTab] = useState<string>('intelligence')
  const meta = GAME_META[gameType] || {
    title: `${gameType} AI Suite`,
    engine: 'Unified AI Engine',
    desc: 'Automated bot intelligence and win-rate management.',
    icon: '🤖',
    color: '#4B5563'
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Top Banner: Explaining Unified Bot AI */}
      <Card
        size="small"
        style={{
          background: 'linear-gradient(135deg, #0F172A 0%, #1E293B 100%)',
          border: '1px solid #334155',
          borderRadius: 12,
          color: '#F8FAFC'
        }}
      >
        <Row justify="space-between" align="middle" gutter={[16, 16]}>
          <Col xs={24} lg={16}>
            <Space align="center" size={12}>
              <span style={{ fontSize: 32 }}>{meta.icon}</span>
              <div>
                <Title level={4} style={{ color: '#F8FAFC', margin: 0 }}>
                  {meta.title}
                </Title>
                <Text style={{ color: '#94A3B8', fontSize: 13 }}>
                  {meta.desc}
                </Text>
              </div>
            </Space>
          </Col>
          <Col xs={24} lg={8} style={{ textAlign: 'right' }}>
            <Space wrap>
              <Tooltip title="Engine microservice & port">
                <Tag color="cyan" icon={<RobotOutlined />}>{meta.engine.split('+')[0].trim()}</Tag>
              </Tooltip>
              <Tag color="green" icon={<CheckCircleOutlined />}>Opponent Modeler Active</Tag>
              <Tag color="purple" icon={<SyncOutlined spin />}>DDAS Synchronized</Tag>
            </Space>
          </Col>
        </Row>
      </Card>

      {/* Sub-Tabs: Decision Intelligence | DDAS Steering | ML Canary */}
      <Card
        style={{ borderRadius: 12, border: '1px solid #E2E8F0', boxShadow: '0 2px 8px rgba(0,0,0,0.04)' }}
        styles={{ body: { padding: '16px 20px' } }}
      >
        <Tabs
          activeKey={activeTab}
          onChange={setActiveTab}
          type="line"
          items={[
            {
              key: 'intelligence',
              label: (
                <span>
                  <ThunderboltOutlined style={{ color: '#F59E0B' }} /> Decision Intelligence & Profiles
                </span>
              ),
              children: (
                <div style={{ paddingTop: 8 }}>
                  <Alert
                    type="info"
                    showIcon
                    icon={<InfoCircleOutlined />}
                    message="Live Decision Brain & Human Simulation"
                    description="Real-time opponent classification (tight folder, calling station, maniac aggressor) counter-adapts bot risk tolerances. Cognitive delays (1-5s Box-Muller distribution) and in-game chat emojis simulate realistic human players."
                    style={{ marginBottom: 16 }}
                  />
                  <BotLearningSection gameType={gameType} />
                </div>
              )
            },
            {
              key: 'ddas',
              label: (
                <span>
                  <AimOutlined style={{ color: '#10B981' }} /> DDAS & Win-Rate Steering
                </span>
              ),
              children: (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 20, paddingTop: 8 }}>
                  {gameType === 'teen_patti' && (
                    <Alert
                      type="info"
                      showIcon
                      message="Teen Patti DDAS Win-Rate Steering"
                      description="Strategy and Target Win Rate steer which bot is elected to win when bots play against real players. Actual hand playstyle and folding thresholds are controlled by the Decision Intelligence profiles."
                    />
                  )}
                  {gameType === 'rummy' && (
                    <Alert
                      type="info"
                      showIcon
                      message="Rummy DDAS Win-Rate Steering"
                      description="Rummy bot winner selection adapts based on lifetime vs real-player win rates, enforcing house edge while maintaining natural play."
                    />
                  )}
                  <BotTrainingConfigPanel gameType={gameType} />
                  <BotTrainingTrendChart gameType={gameType} />
                  <BotMetricsTable gameType={gameType} />
                  <BotTrainingAuditTrail gameType={gameType} />
                </div>
              )
            },
            {
              key: 'ml-canary',
              label: (
                <span>
                  <ExperimentOutlined style={{ color: '#8B5CF6' }} /> ML Canary & Diagnostics
                </span>
              ),
              children: (
                <div style={{ paddingTop: 8 }}>
                  <MLTrainingPanel gameType={gameType} />
                </div>
              )
            }
          ]}
        />
      </Card>
    </div>
  )
}

export default UnifiedGameAIHub
