import { useState } from 'react'
import { Card, Segmented, Space, Alert, Tag } from 'antd'
import {
  RobotOutlined,
  TrophyOutlined,
  FireOutlined,
  RocketOutlined,
  AppstoreOutlined,
  BgColorsOutlined,
  DollarOutlined,
  ThunderboltOutlined,
  TableOutlined,
  DeploymentUnitOutlined,
  SafetyOutlined,
  EyeOutlined,
} from '@ant-design/icons'
import { BotLearningSection } from './BotLearningSection'
import { BotArenaStudioTab } from './BotArenaStudioTab'
import { BotSelfPlayTab } from './BotSelfPlayTab'
import { BotBehavioralCloningTab } from './BotBehavioralCloningTab'
import { BotSentinelSwarmTab } from './BotSentinelSwarmTab'
import { BotCognitiveMemoryTab } from './BotCognitiveMemoryTab'

type SupportedGame = 'teen_patti' | 'ludo' | 'rummy' | 'aviator' | 'color_prediction' | 'matka' | 'lottery'
type ViewMode = 'arena' | 'self_play' | 'behavioral' | 'sentinel' | 'memory' | 'config'

export function BotLearningTab() {
  const [viewMode, setViewMode] = useState<ViewMode>('arena')
  const [selectedGame, setSelectedGame] = useState<SupportedGame>('teen_patti')

  const gameOptions = [
    { label: 'Teen Patti', value: 'teen_patti', icon: <TrophyOutlined /> },
    { label: 'Rummy', value: 'rummy', icon: <AppstoreOutlined /> },
    { label: 'Ludo', value: 'ludo', icon: <FireOutlined /> },
    { label: 'Aviator', value: 'aviator', icon: <RocketOutlined /> },
    { label: 'Color Prediction', value: 'color_prediction', icon: <BgColorsOutlined /> },
    { label: 'Matka', value: 'matka', icon: <DollarOutlined /> },
    { label: 'Lottery', value: 'lottery', icon: <DollarOutlined /> },
  ]

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
        <Segmented
          size="large"
          value={viewMode}
          onChange={(val) => setViewMode(val as ViewMode)}
          options={[
            {
              label: (
                <span>
                  <ThunderboltOutlined style={{ color: '#ec4899', marginRight: 6 }} />
                  Visual GTO Arena
                </span>
              ),
              value: 'arena',
            },
            {
              label: (
                <span>
                  <ThunderboltOutlined style={{ color: '#8b5cf6', marginRight: 6 }} />
                  Self-Play Training
                </span>
              ),
              value: 'self_play',
            },
            {
              label: (
                <span>
                  <DeploymentUnitOutlined style={{ color: '#10b981', marginRight: 6 }} />
                  Behavioral Cloning
                </span>
              ),
              value: 'behavioral',
            },
            {
              label: (
                <span>
                  <SafetyOutlined style={{ color: '#ef4444', marginRight: 6 }} />
                  Anti-Collusion Sentinel
                </span>
              ),
              value: 'sentinel',
            },
            {
              label: (
                <span>
                  <EyeOutlined style={{ color: '#38bdf8', marginRight: 6 }} />
                  Cognitive Memory
                </span>
              ),
              value: 'memory',
            },
            {
              label: (
                <span>
                  <TableOutlined style={{ marginRight: 6 }} />
                  Strategy &amp; Tables
                </span>
              ),
              value: 'config',
            },
          ]}
        />
        <Tag color="magenta" style={{ padding: '4px 12px', fontSize: 13, borderRadius: 16 }}>
          AI Overdrive: ACTIVE
        </Tag>
      </div>

      {viewMode === 'arena' && <BotArenaStudioTab />}
      {viewMode === 'self_play' && <BotSelfPlayTab />}
      {viewMode === 'behavioral' && <BotBehavioralCloningTab />}
      {viewMode === 'sentinel' && <BotSentinelSwarmTab />}
      {viewMode === 'memory' && <BotCognitiveMemoryTab />}

      {viewMode === 'config' && (
        <div>
          <Alert
            message="AI Bot Learning &amp; Autonomous Agents"
            description="Select a game below to tune AI agent behavior, win-rate ceilings, decision delays, and strategy parameters across Easy, Medium, and Hard tiers. You can also trigger immediate neural profile rebuilds."
            type="info"
            showIcon
            icon={<RobotOutlined />}
            style={{ marginBottom: 20 }}
          />

          <Card size="small" style={{ marginBottom: 20, background: '#fafafa' }}>
            <Space direction="vertical" style={{ width: '100%' }}>
              <div style={{ fontWeight: 600, fontSize: 13, color: '#666' }}>Select Game Engine:</div>
              <Segmented
                size="large"
                value={selectedGame}
                onChange={(val) => setSelectedGame(val as SupportedGame)}
                options={gameOptions}
              />
            </Space>
          </Card>

          <BotLearningSection key={selectedGame} gameType={selectedGame} />
        </div>
      )}
    </div>
  )
}
