import { useState, useEffect, useRef } from 'react'
import { useSearchParams, Navigate } from 'react-router-dom'
import {
  Layout, Menu, Card, Button, Space, Alert, Badge, Tag, Typography,
  Statistic, Row, Col, Steps, Grid, Drawer, Divider, Empty, List,
  Tooltip, Form, Input, Spin, message, Modal, Progress,
} from 'antd'
import {
  WarningOutlined, GithubOutlined, RocketOutlined, HistoryOutlined,
  ReloadOutlined, CopyOutlined, CheckCircleOutlined, LoadingOutlined,
  ExclamationCircleOutlined, MenuOutlined, ArrowRightOutlined,
  CloseOutlined, CheckOutlined, UndoOutlined,
} from '@ant-design/icons'
import { useAuthStore } from '../store/auth'

const { Sider, Header, Content } = Layout

interface DeploymentRecord {
  id: string
  timestamp: string
  branch: string
  commitHash: string
  message: string
  status: 'success' | 'pending' | 'failed' | 'rolled_back'
  author?: string
  duration?: number
  startTime?: string
  endTime?: string
  logs?: string[]
  servicesRestarted?: string[]
  errors?: string[]
}

interface GitStatus {
  branch: string
  commits: number
  lastCommit: string
  isDirty: boolean
  dirtyFiles?: string[]
  lastCommitHash?: string
  lastCommitAuthor?: string
  lastCommitTime?: string
  commitHistory?: CommitRecord[]
  aheadOfMain?: number
  behindMain?: number
  lastRefresh?: string
}

interface CommitRecord {
  hash: string
  message: string
  author: string
  date: string
}

interface DeploymentStep {
  name: string
  status: 'pending' | 'in-progress' | 'success' | 'failed'
}

type Section = 'dashboard' | 'deployment' | 'git' | 'logs'
type ModalStep = 'review' | 'confirm' | 'progress' | 'result'

export default function DevAdminPanel() {
  const { admin } = useAuthStore()
  const [searchParams, setSearchParams] = useSearchParams()
  const [isMobile, setIsMobile] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [currentSection, setCurrentSection] = useState<Section>(
    (searchParams.get('section') as Section) || 'dashboard'
  )
  const [environment, setEnvironment] = useState<'dev' | 'prod'>('dev')
  const [gitStatus, setGitStatus] = useState<GitStatus | null>(null)
  const [deploymentLogs, setDeploymentLogs] = useState<DeploymentRecord[]>([])
  const [loading, setLoading] = useState(false)

  // Deployment Modal State
  const [deploymentModalOpen, setDeploymentModalOpen] = useState(false)
  const [modalStep, setModalStep] = useState<ModalStep>('review')
  const [confirmText, setConfirmText] = useState('')
  const [deploymentJobId, setDeploymentJobId] = useState<string | null>(null)
  const [deploymentProgress, setDeploymentProgress] = useState(0)
  const [deploymentSteps, setDeploymentSteps] = useState<DeploymentStep[]>([
    { name: 'Pulling code', status: 'pending' },
    { name: 'Installing dependencies', status: 'pending' },
    { name: 'Building application', status: 'pending' },
    { name: 'Running tests', status: 'pending' },
    { name: 'Restarting services', status: 'pending' },
  ])
  const [deploymentError, setDeploymentError] = useState<string | null>(null)
  const [deploymentSuccess, setDeploymentSuccess] = useState(false)
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null)

  const screens = Grid.useBreakpoint()

  // Allow all admins to view, but restrict deployment actions to DevAdmin
  if (!admin) {
    return <Navigate to="/admin" replace />
  }

  const canDeploy = admin.role === 'DevAdmin' || admin.role === 'superadmin' || admin.role === 'SuperAdmin'

  useEffect(() => {
    setIsMobile(!screens.lg)
  }, [screens.lg])

  // Update URL when section changes
  useEffect(() => {
    setSearchParams({ section: currentSection })
  }, [currentSection, setSearchParams])

  // Mock git status fetch
  const fetchGitStatus = async (showMessage = true) => {
    setLoading(true)
    try {
      // In real app, call /dev-admin/git-status API
      await new Promise(r => setTimeout(r, 500))
      setGitStatus({
        branch: 'feature/admin-responsive',
        commits: 3,
        lastCommit: 'fix: implement missing Player Anomalies Dashboard backend routes',
        isDirty: false,
        lastCommitHash: '787eda7',
        lastCommitAuthor: 'Rahul',
        lastCommitTime: new Date().toISOString(),
      })
      if (showMessage) {
        message.success('Git status refreshed')
      }
    } catch (e) {
      if (showMessage) {
        message.error('Failed to fetch git status')
      }
    } finally {
      setLoading(false)
    }
  }

  // Mock deployment logs fetch
  const fetchDeploymentLogs = async () => {
    setLoading(true)
    try {
      // In real app, call /dev-admin/deployment-logs API
      await new Promise(r => setTimeout(r, 500))
      setDeploymentLogs([
        {
          id: '1',
          timestamp: '2024-01-15 14:32:45',
          branch: 'feature/admin-responsive',
          commitHash: '787eda7',
          message: 'fix: implement missing Player Anomalies Dashboard backend routes',
          status: 'success',
        },
        {
          id: '2',
          timestamp: '2024-01-15 12:10:20',
          branch: 'fix/icon-names',
          commitHash: '70166ee',
          message: 'fix: use correct SafetyOutlined icon name',
          status: 'success',
        },
        {
          id: '3',
          timestamp: '2024-01-15 09:45:15',
          branch: 'fix/admin-panel-types',
          commitHash: 'e62b65f',
          message: 'fix: admin panel type errors - replace WhitelistOutlined and fix Slider onChange',
          status: 'failed',
        },
      ])
    } catch (e) {
      message.error('Failed to fetch deployment logs')
    } finally {
      setLoading(false)
    }
  }

  // Open deployment modal
  const openDeploymentModal = () => {
    if (!gitStatus) {
      fetchGitStatus(false).then(() => {
        initializeDeploymentModal()
      })
    } else {
      initializeDeploymentModal()
    }
  }

  // Initialize modal state
  const initializeDeploymentModal = () => {
    setDeploymentModalOpen(true)
    setModalStep('review')
    setConfirmText('')
    setDeploymentError(null)
    setDeploymentSuccess(false)
    setDeploymentProgress(0)
    setDeploymentSteps([
      { name: 'Pulling code', status: 'pending' },
      { name: 'Installing dependencies', status: 'pending' },
      { name: 'Building application', status: 'pending' },
      { name: 'Running tests', status: 'pending' },
      { name: 'Restarting services', status: 'pending' },
    ])
  }

  // Close deployment modal
  const closeDeploymentModal = () => {
    setDeploymentModalOpen(false)
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current)
    }
  }

  // Simulate deployment progress
  const simulateDeploymentProgress = (currentProgress: number) => {
    const stepIndex = Math.floor((currentProgress / 100) * deploymentSteps.length)
    return deploymentSteps.map((step, idx) => {
      if (idx < stepIndex) {
        return { ...step, status: 'success' as const }
      } else if (idx === stepIndex && currentProgress < 100) {
        return { ...step, status: 'in-progress' as const }
      }
      return { ...step, status: 'pending' as const }
    })
  }

  // Poll deployment status
  const pollDeploymentStatus = async (jobId: string) => {
    try {
      // In real app, call /api/dev/deployment-status/:jobId API
      const newProgress = deploymentProgress + Math.random() * 20
      const finalProgress = Math.min(100, newProgress)

      setDeploymentProgress(finalProgress)
      setDeploymentSteps(simulateDeploymentProgress(finalProgress))

      if (finalProgress >= 100) {
        if (pollIntervalRef.current) {
          clearInterval(pollIntervalRef.current)
        }
        setModalStep('result')
        setDeploymentSuccess(true)
      }
    } catch (error) {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current)
      }
      setDeploymentError('Failed to fetch deployment status')
      setModalStep('result')
    }
  }

  // Initiate deployment
  const handlePushProduction = async () => {
    if (!gitStatus) {
      message.error('Git status not loaded')
      return
    }

    try {
      setDeploymentSteps(simulateDeploymentProgress(0))
      setDeploymentProgress(0)
      setDeploymentError(null)

      // In real app, call POST /api/dev/deploy API with gitStatus.branch and gitStatus.lastCommit
      await new Promise(r => setTimeout(r, 500))

      const jobId = `deploy-${Date.now()}`
      setDeploymentJobId(jobId)
      setModalStep('progress')

      // Start polling for deployment status
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current)
      }

      pollIntervalRef.current = setInterval(async () => {
        await pollDeploymentStatus(jobId)
      }, 800)
    } catch (error: any) {
      setDeploymentError(error.message || 'Failed to initiate deployment')
      setModalStep('result')
    }
  }

  // Handle rollback
  const handleRollback = async () => {
    try {
      message.loading('Rolling back to previous version...')
      // In real app, call /api/dev/rollback API
      await new Promise(r => setTimeout(r, 2000))
      message.success('Rollback successful!')
      closeDeploymentModal()
    } catch (error: any) {
      message.error(error.message || 'Failed to rollback')
    }
  }

  // Handle modal close
  const handleCloseDeploymentModal = () => {
    if (deploymentSuccess) {
      const newLog: DeploymentRecord = {
        id: String(Date.now()),
        timestamp: new Date().toLocaleString(),
        branch: gitStatus?.branch || 'unknown',
        commitHash: gitStatus?.lastCommitHash || 'unknown',
        message: gitStatus?.lastCommit || 'Deployment to production',
        status: 'success',
      }
      setDeploymentLogs([newLog, ...deploymentLogs])
    }
    closeDeploymentModal()
  }

  const menuItems = [
    { key: 'dashboard' as Section, icon: <LoadingOutlined />, label: '📊 Dashboard' },
    { key: 'deployment' as Section, icon: <RocketOutlined />, label: '🚀 Deployment' },
    { key: 'git' as Section, icon: <GithubOutlined />, label: '📝 Git Status' },
    { key: 'logs' as Section, icon: <HistoryOutlined />, label: '📋 Logs' },
  ]

  const navigation = (
    <Menu
      theme="dark"
      mode="inline"
      selectedKeys={[currentSection]}
      items={menuItems}
      onClick={({ key }) => {
        setCurrentSection(key as Section)
        setDrawerOpen(false)
      }}
      style={{ marginTop: 8, borderRight: 0, background: '#8B0000' }}
    />
  )

  // ============ Dashboard Section ============
  const DashboardSection = () => (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <Typography.Title level={2} style={{ margin: 0 }}>
          <Badge status="processing" color="#ff4d4f" />
          DEV Dashboard
        </Typography.Title>
        <Tag color="red" style={{ fontSize: 14, padding: '4px 12px' }}>
          ⚠️ DEVELOPMENT MODE
        </Tag>
      </div>

      <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Statistic
              title="Current Environment"
              value={environment.toUpperCase()}
              prefix={<RocketOutlined />}
              valueStyle={{
                color: environment === 'prod' ? '#ff4d4f' : '#ff7a45',
                fontSize: 24,
                fontWeight: 'bold',
              }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Statistic
              title="Git Branch"
              value={gitStatus?.branch || '—'}
              prefix={<GithubOutlined />}
              valueStyle={{ fontSize: 14 }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Statistic
              title="Pending Commits"
              value={gitStatus?.commits || 0}
              prefix={<ExclamationCircleOutlined />}
              valueStyle={{ fontSize: 24 }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Statistic
              title="Last Deployment"
              value={deploymentLogs.length > 0 ? '✅ Success' : '—'}
              valueStyle={{ color: '#52c41a', fontSize: 14 }}
            />
          </Card>
        </Col>
      </Row>

      <Card style={{ marginBottom: 16 }}>
        <Typography.Text strong style={{ fontSize: 16 }}>
          ⚡ Quick Actions
        </Typography.Text>
        <Divider />
        <Space wrap>
          <Button
            type="primary"
            size="large"
            danger
            icon={<RocketOutlined />}
            onClick={() => fetchGitStatus()}
            loading={loading}
          >
            Refresh Git Status
          </Button>
          <Button
            size="large"
            icon={<ReloadOutlined />}
            onClick={fetchDeploymentLogs}
            loading={loading}
          >
            Refresh Logs
          </Button>
        </Space>
      </Card>

      <Card>
        <Typography.Text strong style={{ fontSize: 16 }}>
          📢 System Information
        </Typography.Text>
        <Divider />
        <Row gutter={[16, 16]}>
          <Col xs={24} sm={12}>
            <Typography.Text type="secondary">Admin User:</Typography.Text>
            <Typography.Paragraph style={{ marginTop: 4, fontSize: 14, fontWeight: 500 }}>
              {admin.username} ({admin.role})
            </Typography.Paragraph>
          </Col>
          <Col xs={24} sm={12}>
            <Typography.Text type="secondary">Server Status:</Typography.Text>
            <Typography.Paragraph style={{ marginTop: 4, fontSize: 14, fontWeight: 500 }}>
              <CheckCircleOutlined style={{ color: '#52c41a', marginRight: 8 }} />
              Online
            </Typography.Paragraph>
          </Col>
        </Row>
      </Card>
    </div>
  )

  // ============ Deployment Control Section ============
  const DeploymentSection = () => (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <Typography.Title level={2} style={{ margin: 0 }}>
          <Badge status="processing" color="#ff4d4f" />
          DEV Deployment Control
        </Typography.Title>
      </div>

      <Alert
        message="⚠️ CAUTION: Production Deployment"
        description="You are about to push code changes to the production environment. This action affects all users. Make sure all changes have been tested thoroughly."
        type="warning"
        showIcon
        icon={<WarningOutlined />}
        style={{ marginBottom: 24, borderLeft: '4px solid #ff4d4f' }}
      />

      <Card style={{ marginBottom: 24, borderLeft: '4px solid #ff4d4f' }}>
        <Typography.Text strong style={{ fontSize: 16 }}>
          🚀 Push to Production
        </Typography.Text>
        <Divider />
        <Typography.Paragraph style={{ marginBottom: 20, color: '#666' }}>
          Click the button below to push all pending changes to production. This will deploy the latest commits
          from the <Tag color="blue">{gitStatus?.branch || 'current branch'}</Tag> to production.
        </Typography.Paragraph>

        <Steps
          current={-1}
          items={[
            { title: 'Review Changes', description: 'Check git status' },
            { title: 'Confirm Deploy', description: 'Type to verify' },
            { title: 'Deploy', description: 'Push to production' },
            { title: 'Verify', description: 'Confirm success' },
          ]}
          style={{ marginBottom: 32 }}
        />

        <Space direction="vertical" size="large" style={{ width: '100%' }}>
          <Tooltip
            title={canDeploy ? 'Click to deploy to production' : `Only DevAdmins can deploy. Contact your DevAdmin. (Your role: ${admin.role})`}
          >
            <Button
              type="primary"
              danger
              size="large"
              block
              icon={<RocketOutlined />}
              onClick={handlePushProduction}
              disabled={!canDeploy}
              loading={loading}
              style={{
                height: 56,
                fontSize: 16,
                fontWeight: 600,
                backgroundColor: canDeploy ? '#ff4d4f' : '#ccc',
                borderColor: canDeploy ? '#ff4d4f' : '#ccc',
                animation: canDeploy ? 'pulse 2s infinite' : 'none',
                cursor: canDeploy ? 'pointer' : 'not-allowed',
                opacity: canDeploy ? 1 : 0.6,
              }}
            >
              🚀 PUSH TO PRODUCTION
            </Button>
          </Tooltip>

          <style>{`
            @keyframes pulse {
              0% {
                box-shadow: 0 0 0 0 rgba(255, 77, 79, 0.7);
              }
              70% {
                box-shadow: 0 0 0 10px rgba(255, 77, 79, 0);
              }
              100% {
                box-shadow: 0 0 0 0 rgba(255, 77, 79, 0);
              }
            }
          `}</style>

          <Alert
            message="💡 Tip for Non-Technical Users"
            description="This will automatically build, test, and deploy your code changes. The process takes about 2-5 minutes. You'll receive confirmation once it completes."
            type="info"
            showIcon
            style={{ marginTop: 16 }}
          />
        </Space>
      </Card>
    </div>
  )

  // ============ Git Status Section ============
  const GitSection = () => (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <Typography.Title level={2} style={{ margin: 0 }}>
          <Badge status="processing" color="#ff4d4f" />
          DEV Git Status
        </Typography.Title>
        <Button icon={<ReloadOutlined />} onClick={() => fetchGitStatus()} loading={loading}>
          Refresh
        </Button>
      </div>

      {loading && <Spin size="large" style={{ display: 'flex', justifyContent: 'center', margin: '40px 0' }} />}

      {!loading && gitStatus && (
        <div>
          <Card style={{ marginBottom: 16 }}>
            <Row gutter={[16, 16]}>
              <Col xs={24} sm={12}>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  Current Branch
                </Typography.Text>
                <Typography.Paragraph style={{ margin: '8px 0 0 0', fontSize: 16, fontWeight: 600 }}>
                  <GithubOutlined style={{ marginRight: 8 }} />
                  {gitStatus.branch}
                </Typography.Paragraph>
              </Col>
              <Col xs={24} sm={12}>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  Repository Status
                </Typography.Text>
                <Typography.Paragraph style={{ margin: '8px 0 0 0', fontSize: 16, fontWeight: 600 }}>
                  {gitStatus.isDirty ? (
                    <Tag color="orange">⚠️ Uncommitted Changes</Tag>
                  ) : (
                    <Tag color="green">✅ Clean</Tag>
                  )}
                </Typography.Paragraph>
              </Col>
            </Row>
          </Card>

          <Card style={{ marginBottom: 16 }}>
            <Typography.Text strong style={{ fontSize: 16 }}>
              📝 Last Commit
            </Typography.Text>
            <Divider />
            <Typography.Paragraph style={{ marginBottom: 12 }}>
              <Tag color="blue">{gitStatus.lastCommitHash || 'N/A'}</Tag>
              <CopyOutlined
                style={{ marginLeft: 8, cursor: 'pointer' }}
                onClick={() => {
                  navigator.clipboard.writeText(gitStatus.lastCommitHash || '')
                  message.success('Copied to clipboard')
                }}
              />
            </Typography.Paragraph>
            <Typography.Text style={{ fontSize: 14, display: 'block' }}>
              {gitStatus.lastCommit}
            </Typography.Text>
          </Card>

          {gitStatus.commits > 0 && (
            <Card style={{ backgroundColor: '#fff7e6', borderLeft: '4px solid #faad14' }}>
              <Typography.Text strong style={{ fontSize: 16 }}>
                ⚡ {gitStatus.commits} Pending Commit{gitStatus.commits > 1 ? 's' : ''}
              </Typography.Text>
              <Divider />
              <Typography.Paragraph style={{ marginBottom: 0 }}>
                Your branch has {gitStatus.commits} commit{gitStatus.commits > 1 ? 's' : ''} ahead of main.
                Ready to be deployed to production.
              </Typography.Paragraph>
            </Card>
          )}
        </div>
      )}
    </div>
  )

  // ============ Deployment Logs Section ============
  const LogsSection = () => (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <Typography.Title level={2} style={{ margin: 0 }}>
          <Badge status="processing" color="#ff4d4f" />
          DEV Deployment Logs
        </Typography.Title>
        <Button icon={<ReloadOutlined />} onClick={fetchDeploymentLogs} loading={loading}>
          Refresh
        </Button>
      </div>

      {loading && <Spin size="large" style={{ display: 'flex', justifyContent: 'center', margin: '40px 0' }} />}

      {!loading && (
        <>
          {deploymentLogs.length === 0 ? (
            <Empty
              description="No deployment logs yet"
              style={{ marginTop: 60 }}
            />
          ) : (
            <List
              dataSource={deploymentLogs}
              renderItem={(log) => (
                <List.Item
                  key={log.id}
                  style={{
                    padding: '16px 0',
                    borderBottom: '1px solid #f0f0f0',
                    display: 'flex',
                    flexDirection: 'column',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8, flexWrap: 'wrap', gap: 8 }}>
                    {log.status === 'success' && (
                      <CheckCircleOutlined style={{ color: '#52c41a', fontSize: 18 }} />
                    )}
                    {log.status === 'failed' && (
                      <ExclamationCircleOutlined style={{ color: '#ff4d4f', fontSize: 18 }} />
                    )}
                    {log.status === 'pending' && (
                      <LoadingOutlined style={{ color: '#faad14', fontSize: 18 }} />
                    )}
                    <Tag color={log.status === 'success' ? 'green' : log.status === 'failed' ? 'red' : 'orange'}>
                      {log.status.toUpperCase()}
                    </Tag>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      {log.timestamp}
                    </Typography.Text>
                  </div>
                  <Typography.Text strong style={{ fontSize: 14, marginBottom: 4 }}>
                    {log.message}
                  </Typography.Text>
                  <div style={{ marginTop: 8 }}>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      Branch: <Tag color="blue">{log.branch}</Tag>
                      Commit: <Tag>{log.commitHash}</Tag>
                    </Typography.Text>
                  </div>
                </List.Item>
              )}
            />
          )}
        </>
      )}
    </div>
  )

  // ============ Deployment Modal ============
  const DeploymentModal = () => (
    <Modal
      title={
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <RocketOutlined style={{ fontSize: 24, color: '#ff4d4f' }} />
          <span>Deploy to Production</span>
        </div>
      }
      open={deploymentModalOpen}
      onCancel={closeDeploymentModal}
      footer={null}
      width={800}
      closable={modalStep !== 'progress'}
      maskClosable={false}
      bodyStyle={{ maxHeight: '70vh', overflowY: 'auto' }}
    >
      {/* Step 1: Review Changes */}
      {modalStep === 'review' && (
        <div>
          <Alert
            message="Review the changes before deployment"
            description="Make sure you have tested all changes thoroughly"
            type="info"
            showIcon
            style={{ marginBottom: 24 }}
          />

          <Card style={{ marginBottom: 24, backgroundColor: '#f5f5f5' }}>
            <Typography.Text strong style={{ fontSize: 14 }}>
              Deployment Information
            </Typography.Text>
            <Divider />

            <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
              <Col xs={24} sm={12}>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  Branch
                </Typography.Text>
                <Typography.Paragraph style={{ margin: '4px 0', fontSize: 14, fontWeight: 600 }}>
                  {gitStatus?.branch || 'Unknown'}
                </Typography.Paragraph>
              </Col>
              <Col xs={24} sm={12}>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  Commits to Deploy
                </Typography.Text>
                <Typography.Paragraph style={{ margin: '4px 0', fontSize: 14, fontWeight: 600 }}>
                  {gitStatus?.commits || 0}
                </Typography.Paragraph>
              </Col>
              <Col xs={24} sm={12}>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  Deploying as
                </Typography.Text>
                <Typography.Paragraph style={{ margin: '4px 0', fontSize: 14, fontWeight: 600 }}>
                  {admin.username}
                </Typography.Paragraph>
              </Col>
              <Col xs={24} sm={12}>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  Estimated Duration
                </Typography.Text>
                <Typography.Paragraph style={{ margin: '4px 0', fontSize: 14, fontWeight: 600 }}>
                  2-3 minutes
                </Typography.Paragraph>
              </Col>
            </Row>
          </Card>

          <Card style={{ marginBottom: 24 }}>
            <Typography.Text strong style={{ fontSize: 14 }}>
              Last 3 Commits Being Deployed
            </Typography.Text>
            <Divider />
            <Space direction="vertical" style={{ width: '100%' }}>
              <div style={{ padding: '12px', backgroundColor: '#f9f9f9', borderRadius: 4 }}>
                <Typography.Text style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>
                  <Tag color="blue">{gitStatus?.lastCommitHash}</Tag>
                </Typography.Text>
                <Typography.Text style={{ fontSize: 13 }}>
                  {gitStatus?.lastCommit}
                </Typography.Text>
              </div>
              <div style={{ padding: '12px', backgroundColor: '#f9f9f9', borderRadius: 4, opacity: 0.7 }}>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  Previous commits not shown in mock data
                </Typography.Text>
              </div>
            </Space>
          </Card>

          <Space style={{ width: '100%', justifyContent: 'flex-end' }}>
            <Button onClick={closeDeploymentModal}>Cancel</Button>
            <Button type="primary" onClick={() => setModalStep('confirm')}>
              I understand, proceed
            </Button>
          </Space>
        </div>
      )}

      {/* Step 2: Type to Confirm */}
      {modalStep === 'confirm' && (
        <div>
          <Alert
            message="This will deploy to PRODUCTION. All users may be affected."
            description="Type exactly 'DEPLOY' below to confirm this action cannot be undone."
            type="error"
            showIcon
            icon={<WarningOutlined />}
            style={{ marginBottom: 24 }}
          />

          <Card style={{ marginBottom: 24, backgroundColor: '#fef2f2', borderColor: '#ff4d4f' }}>
            <Typography.Title level={5} style={{ marginBottom: 16 }}>
              Confirmation Required
            </Typography.Title>
            <Typography.Paragraph style={{ marginBottom: 16, color: '#666' }}>
              Type the word DEPLOY below to confirm you understand the risks and want to proceed with the deployment.
            </Typography.Paragraph>
            <Input
              placeholder='Type "DEPLOY" to confirm'
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              size="large"
              status={confirmText !== '' && confirmText !== 'DEPLOY' ? 'error' : undefined}
              style={{ marginBottom: 8 }}
            />
            {confirmText !== '' && confirmText !== 'DEPLOY' && (
              <Typography.Text type="danger" style={{ fontSize: 12 }}>
                Text does not match. Please type exactly: DEPLOY
              </Typography.Text>
            )}
            {confirmText === 'DEPLOY' && (
              <Typography.Text type="success" style={{ fontSize: 12 }}>
                Confirmation complete
              </Typography.Text>
            )}
          </Card>

          <Space style={{ width: '100%', justifyContent: 'flex-end' }}>
            <Button onClick={() => setModalStep('review')}>Back</Button>
            <Button
              type="primary"
              danger
              onClick={handlePushProduction}
              disabled={confirmText !== 'DEPLOY'}
            >
              Confirm Deployment
            </Button>
          </Space>
        </div>
      )}

      {/* Step 3: Deployment in Progress */}
      {modalStep === 'progress' && (
        <div>
          <Alert
            message="Deployment in progress..."
            description="Please wait while your changes are being deployed to production."
            type="info"
            showIcon
            icon={<LoadingOutlined />}
            style={{ marginBottom: 24 }}
          />

          <Card style={{ marginBottom: 24 }}>
            <div style={{ marginBottom: 24 }}>
              <div style={{ marginBottom: 8, display: 'flex', justifyContent: 'space-between' }}>
                <Typography.Text strong>Overall Progress</Typography.Text>
                <Typography.Text>{Math.round(deploymentProgress)}%</Typography.Text>
              </div>
              <Progress
                percent={Math.round(deploymentProgress)}
                strokeColor={{
                  '0%': '#108ee9',
                  '100%': '#87d068',
                }}
                status={deploymentProgress < 100 ? 'active' : 'success'}
              />
            </div>

            <Typography.Text strong style={{ fontSize: 14, display: 'block', marginBottom: 12 }}>
              Deployment Steps
            </Typography.Text>

            <Space direction="vertical" style={{ width: '100%' }}>
              {deploymentSteps.map((step, idx) => (
                <div
                  key={idx}
                  style={{
                    padding: '12px',
                    backgroundColor: step.status === 'success' ? '#f6ffed' : step.status === 'in-progress' ? '#e6f7ff' : '#fafafa',
                    borderLeft: `4px solid ${step.status === 'success' ? '#52c41a' : step.status === 'in-progress' ? '#1890ff' : '#d9d9d9'}`,
                    borderRadius: 4,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    {step.status === 'success' && <CheckCircleOutlined style={{ color: '#52c41a', fontSize: 18 }} />}
                    {step.status === 'in-progress' && <LoadingOutlined style={{ color: '#1890ff', fontSize: 18 }} />}
                    {step.status === 'pending' && <div style={{ width: 18, height: 18 }} />}
                    <Typography.Text style={{ fontWeight: step.status === 'in-progress' ? 600 : 400 }}>
                      {step.name}
                    </Typography.Text>
                  </div>
                  {step.status === 'success' && <CheckOutlined style={{ color: '#52c41a' }} />}
                  {step.status === 'in-progress' && <Spin size="small" />}
                </div>
              ))}
            </Space>
          </Card>

          <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', textAlign: 'center' }}>
            Do not refresh or close this window while deployment is in progress
          </Typography.Text>
        </div>
      )}

      {/* Step 4: Result */}
      {modalStep === 'result' && (
        <div>
          {deploymentSuccess ? (
            <>
              <Alert
                message="Deployment Successful!"
                description="Your changes have been successfully deployed to production."
                type="success"
                showIcon
                icon={<CheckCircleOutlined />}
                style={{ marginBottom: 24 }}
              />

              <Card style={{ marginBottom: 24, backgroundColor: '#f6ffed', borderColor: '#52c41a' }}>
                <Typography.Title level={5} style={{ color: '#52c41a', marginBottom: 16 }}>
                  Deployment Details
                </Typography.Title>
                <Row gutter={[16, 16]}>
                  <Col xs={24} sm={12}>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      Deployment ID
                    </Typography.Text>
                    <Typography.Paragraph style={{ margin: '4px 0', fontSize: 14, fontWeight: 600 }}>
                      {deploymentJobId}
                    </Typography.Paragraph>
                  </Col>
                  <Col xs={24} sm={12}>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      Completed at
                    </Typography.Text>
                    <Typography.Paragraph style={{ margin: '4px 0', fontSize: 14, fontWeight: 600 }}>
                      {new Date().toLocaleString()}
                    </Typography.Paragraph>
                  </Col>
                  <Col xs={24} sm={12}>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      Branch Deployed
                    </Typography.Text>
                    <Typography.Paragraph style={{ margin: '4px 0', fontSize: 14, fontWeight: 600 }}>
                      {gitStatus?.branch}
                    </Typography.Paragraph>
                  </Col>
                  <Col xs={24} sm={12}>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      Status
                    </Typography.Text>
                    <Typography.Paragraph style={{ margin: '4px 0', fontSize: 14, fontWeight: 600 }}>
                      <Tag color="green">SUCCESS</Tag>
                    </Typography.Paragraph>
                  </Col>
                </Row>
              </Card>

              <Space style={{ width: '100%', justifyContent: 'flex-end' }}>
                <Button onClick={handleCloseDeploymentModal}>Close</Button>
              </Space>
            </>
          ) : (
            <>
              <Alert
                message="Deployment Failed"
                description={deploymentError || 'An error occurred during deployment'}
                type="error"
                showIcon
                icon={<ExclamationCircleOutlined />}
                style={{ marginBottom: 24 }}
              />

              <Card style={{ marginBottom: 24, backgroundColor: '#fef2f2', borderColor: '#ff4d4f' }}>
                <Typography.Title level={5} style={{ color: '#ff4d4f', marginBottom: 16 }}>
                  Error Details
                </Typography.Title>
                <Typography.Paragraph style={{ marginBottom: 0, fontSize: 13 }}>
                  {deploymentError || 'Unknown error occurred'}
                </Typography.Paragraph>
              </Card>

              <Space style={{ width: '100%', justifyContent: 'flex-end' }}>
                <Button onClick={handleRollback} icon={<UndoOutlined />} type="primary" danger>
                  Rollback to Previous Version
                </Button>
                <Button onClick={closeDeploymentModal}>Close</Button>
              </Space>
            </>
          )}
        </div>
      )}
    </Modal>
  )

  return (
    <Layout style={{ minHeight: '100vh', background: '#fafafa' }}>
      {/* Sidebar */}
      {!isMobile && (
        <Sider
          width={240}
          theme="dark"
          style={{
            position: 'fixed',
            height: '100vh',
            zIndex: 10,
            overflowY: 'auto',
            background: '#8B0000',
          }}
        >
          <div style={{ padding: '16px 24px', borderBottom: '2px solid #ff4d4f' }}>
            <Typography.Title level={5} style={{ color: '#ff7a45', margin: 0, fontSize: 16 }}>
              ⚠️ DEV PANEL
            </Typography.Title>
            <Typography.Text style={{ color: 'rgba(255,255,255,0.6)', fontSize: 11 }}>
              Development Mode
            </Typography.Text>
          </div>
          {navigation}
        </Sider>
      )}

      {isMobile && (
        <Drawer
          placement="left"
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          width={240}
          closable={false}
          styles={{ body: { padding: 0, background: '#8B0000' } }}
        >
          <div style={{ padding: '16px 24px', borderBottom: '2px solid #ff4d4f' }}>
            <Typography.Title level={5} style={{ color: '#ff7a45', margin: 0, fontSize: 16 }}>
              ⚠️ DEV PANEL
            </Typography.Title>
            <Typography.Text style={{ color: 'rgba(255,255,255,0.6)', fontSize: 11 }}>
              Development Mode
            </Typography.Text>
          </div>
          {navigation}
        </Drawer>
      )}

      <Layout style={{ marginLeft: isMobile ? 0 : 240 }}>
        {/* Header */}
        <Header
          style={{
            background: '#ff4d4f',
            padding: isMobile ? '0 12px' : '0 24px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            boxShadow: '0 2px 8px rgba(255,77,79,0.3)',
            position: 'sticky',
            top: 0,
            zIndex: 9,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {isMobile && (
              <Button
                type="text"
                icon={<MenuOutlined style={{ fontSize: 18, color: '#fff' }} />}
                onClick={() => setDrawerOpen(true)}
              />
            )}
            <Typography.Title
              level={4}
              style={{
                margin: 0,
                color: '#fff',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                fontSize: 18,
              }}
            >
              <WarningOutlined />
              DEVELOPMENT MODE
            </Typography.Title>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <Tooltip title={canDeploy ? 'DevAdmin - Full deployment access' : `Limited access (${admin.role})`}>
              <Tag
                color={canDeploy ? 'green' : 'orange'}
                style={{
                  padding: '4px 12px',
                  fontSize: 12,
                  fontWeight: 600,
                  margin: 0,
                }}
              >
                {canDeploy ? '✓ DevAdmin' : `⚠️ ${admin.role}`}
              </Tag>
            </Tooltip>
            <Tooltip title={`Current: ${environment.toUpperCase()}`}>
              <Button
                type="text"
                style={{ color: '#fff', fontWeight: 600 }}
                onClick={() => {
                  const newEnv = environment === 'dev' ? 'prod' : 'dev'
                  setEnvironment(newEnv)
                  message.info(`Switched to ${newEnv.toUpperCase()} environment`)
                }}
              >
                {environment === 'prod' ? '🔴' : '🟠'} {environment.toUpperCase()}
              </Button>
            </Tooltip>
          </div>
        </Header>

        {/* Content */}
        <Content style={{ margin: isMobile ? 12 : 24, minHeight: 'calc(100vh - 80px)' }}>
          {currentSection === 'dashboard' && <DashboardSection />}
          {currentSection === 'deployment' && <DeploymentSection />}
          {currentSection === 'git' && <GitSection />}
          {currentSection === 'logs' && <LogsSection />}
        </Content>
      </Layout>

      {/* Deployment Modal */}
      <DeploymentModal />
    </Layout>
  )
}
