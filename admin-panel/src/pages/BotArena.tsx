import { Card, Space, Typography, Tag } from 'antd'
import { ThunderboltOutlined } from '@ant-design/icons'
import { BotLearningTab } from '../components/AI/BotLearningTab'

export default function BotArena() {
  return (
    <div style={{ padding: '24px' }}>
      <Card
        title={
          <Space align="center">
            <ThunderboltOutlined style={{ fontSize: 24, color: '#ec4899' }} />
            <Typography.Title level={4} style={{ margin: 0, color: '#ffffff' }}>
              Game Bots &amp; AI Arena Studio
            </Typography.Title>
            <Tag color="magenta" style={{ marginLeft: 8 }}>Visual GTO &amp; Strategy Engine</Tag>
          </Space>
        }
        style={{
          background: 'rgba(20, 24, 33, 0.85)',
          border: '1px solid rgba(255, 255, 255, 0.08)',
        }}
      >
        <BotLearningTab />
      </Card>
    </div>
  )
}

