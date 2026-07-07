import { useState } from 'react'
import { Tabs, Card, Alert, Button, Space, Tag, Divider } from 'antd'
import { RobotOutlined, SettingOutlined, DashboardOutlined, SyncOutlined, AlertOutlined, AimOutlined, SafetyOutlined, MonitorOutlined } from '@ant-design/icons'
import { AIPromptConsole } from '../components/AI/AIPromptConsole'
import { MLConfigPanel } from '../components/AI/MLConfigPanel'
import { WorkflowDashboard } from '../components/AI/WorkflowDashboard'
import { ChurnTab } from '../components/AI/ChurnTab'
import { WatchdogTab } from '../components/AI/WatchdogTab'
import { AppMonitorTab } from '../components/AI/AppMonitorTab'
import PlayerTracking from './PlayerTracking'

export function AIControlCenter() {
  const [activeTab, setActiveTab] = useState('1')
  const [refreshing, setRefreshing] = useState(false)

  const handleRefresh = async () => {
    setRefreshing(true)
    // Trigger refresh on active component
    window.dispatchEvent(new Event('aiDashboardRefresh'))
    setTimeout(() => setRefreshing(false), 1000)
  }

  const tabItems = [
    {
      key: '1',
      label: (
        <span>
          <RobotOutlined />
          AI Prompt Console
        </span>
      ),
      children: <AIPromptConsole />,
      extra: <Tag color="blue">Query Interface</Tag>,
    },
    {
      key: '2',
      label: (
        <span>
          <SettingOutlined />
          ML Configuration
        </span>
      ),
      children: <MLConfigPanel />,
      extra: <Tag color="orange">Parameter Tuning</Tag>,
    },
    {
      key: '3',
      label: (
        <span>
          <DashboardOutlined />
          Real-Time Workflow
        </span>
      ),
      children: <WorkflowDashboard />,
      extra: <Tag color="green">Live Monitoring</Tag>,
    },
    {
      key: '4',
      label: (
        <span>
          <AlertOutlined />
          Churn Intelligence
        </span>
      ),
      children: <ChurnTab />,
      extra: <Tag color="red">Re-Engagement</Tag>,
    },
    {
      key: '5',
      label: (
        <span>
          <AimOutlined />
          Player Tracking
        </span>
      ),
      children: <PlayerTracking />,
      extra: <Tag color="gold">Live Players</Tag>,
    },
    {
      key: '6',
      label: (
        <span>
          <SafetyOutlined />
          Game Watchdog
        </span>
      ),
      children: <WatchdogTab />,
      extra: <Tag color="purple">Self-Healing</Tag>,
    },
    {
      key: '7',
      label: (
        <span>
          <MonitorOutlined />
          App Monitor
        </span>
      ),
      children: <AppMonitorTab />,
      extra: <Tag color="cyan">App Health</Tag>,
    },
  ]

  return (
    <div style={{ padding: '24px' }}>
      <Card
        title={
          <Space>
            <RobotOutlined style={{ fontSize: 24, color: '#1890ff' }} />
            <span>AI Control Center</span>
          </Space>
        }
        extra={
          <Space>
            <Button
              type="primary"
              icon={<SyncOutlined spin={refreshing} />}
              onClick={handleRefresh}
              loading={refreshing}
            >
              Refresh
            </Button>
          </Space>
        }
      >
        <Alert
          message="AI Integration in Progress"
          description="Weeks 1-3: Monitoring service, fraud detection, and bot foundations. Weeks 4-6: Analytics dashboards and churn prediction. Weeks 7+: Advanced optimization."
          type="info"
          showIcon
          style={{ marginBottom: 24 }}
        />

        <Divider />

        <Tabs
          activeKey={activeTab}
          onChange={setActiveTab}
          items={tabItems}
          tabPosition="top"
          size="large"
        />

        <Divider style={{ marginTop: 24 }} />

        <Card size="small" style={{ marginTop: 24 }} title="Status & Next Steps">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16 }}>
            <div>
              <strong>Phase 1 (Weeks 1-3)</strong>
              <br />
              ✅ Monitoring Service
              <br />
              ✅ Fraud Detection
              <br />
              ✅ Bot Logging
            </div>
            <div>
              <strong>Phase 2 (Weeks 4-6)</strong>
              <br />
              ✅ Analytics Pipeline
              <br />
              ✅ Churn Prediction
              <br />
              ✅ Dashboards
            </div>
            <div>
              <strong>Phase 3+ (Weeks 7-12)</strong>
              <br />
              ✅ Bot Learning
              <br />
              ✅ Smart Matching
              <br />
              ✅ RTP Optimization
            </div>
          </div>
        </Card>
      </Card>
    </div>
  )
}
