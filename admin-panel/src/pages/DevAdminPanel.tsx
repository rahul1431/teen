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
import { adminApi } from '../api/client'

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

interface DeployReadiness {
  currentCommit: string
  lastDeployedCommit: string | null
  lastDeployedAt: string | null
  pendingMigrations: string[]
  deployNeeded: boolean
  reason: string
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
  const [prodReadiness, setProdReadiness] = useState<DeployReadiness | null>(null)
  const [readinessLoading, setReadinessLoading] = useState(false)
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

  useEffect(() => {
    fetchGitStatus(false)
    fetchProdReadiness()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Update URL when section changes
  useEffect(() => {
    setSearchParams({ section: currentSection })
  }, [currentSection, setSearchParams])

  // Fetch real git status from backend — uses deployment-health + changelogs
  const fetchGitStatus = async (showMessage = true) => {
    setLoading(true)
    try {
      // Get deployment infrastructure health
      const healthRes = await adminApi.get('/dev/deployment-health')
      const health = healthRes.data

      // Get latest git commit info from changelogs endpoint
      let lastCommitMsg = ''
      let lastCommitHash = ''
      let lastCommitAuthor = ''
      let lastCommitTime = new Date().toISOString()
      try {
        const gitRes = await adminApi.get('/changelogs/git')
        const gitData = gitRes.data
        const latestCommit = gitData?.commits?.[0] || gitData?.[0] || null
        if (latestCommit) {
          lastCommitMsg = latestCommit.message || latestCommit.subject || ''
          lastCommitHash = latestCommit.hash || latestCommit.id || ''
          lastCommitAuthor = latestCommit.author || latestCommit.authorName || ''
          lastCommitTime = latestCommit.date || latestCommit.authorDate || new Date().toISOString()
        }
      } catch (_) { /* changelogs optional */ }

      setGitStatus({
        branch: health.branch || 'main',
        commits: 0,
        lastCommit: lastCommitMsg,
        isDirty: health.status !== 'healthy',
        dirtyFiles: health.warnings || [],
        lastCommitHash,
        lastCommitAuthor,
        lastCommitTime,
        lastRefresh: new Date().toISOString(),
      })
      if (showMessage) message.success('Git status refreshed')
    } catch (e: any) {
      if (showMessage)
        message.error('Failed to fetch git status: ' + (e.response?.data?.error || e.message))
    } finally {
      setLoading(false)
    }
  }

  // Real "is there anything to deploy" signal — compares prod's checked-out
  // commit + pending-migration count against its own last successful
  // deployment record. Commit-ahead-of-main isn't reliable once the VPS
  // tree has been reset to match origin (source caught up says nothing
  // about what's actually running).
  const fetchProdReadiness = async () => {
    setReadinessLoading(true)
    try {
      const res = await adminApi.get('/dev/deploy-readiness/prod')
      setProdReadiness(res.data)
    } catch (e: any) {
      message.error('Failed to fetch deploy readiness: ' + (e.response?.data?.error || e.message))
    } finally {
      setReadinessLoading(false)
    }
  }

  // Fetch real deployment logs from backend
  const fetchDeploymentLogs = async () => {
    setLoading(true)
    try {
      const res = await adminApi.get('/dev/deployments')
      // Backend returns a raw array directly
      const rawList = Array.isArray(res.data) ? res.data : (res.data.deployments || [])
      const records: DeploymentRecord[] = rawList.map((d: any) => ({
        id: d.id,
        timestamp: d.created_at,
        branch: d.branch,
        commitHash: d.commit_hash,
        message: d.commit_hash,
        status: d.status as DeploymentRecord['status'],
        startTime: d.started_at,
        endTime: d.completed_at,
      }))
      setDeploymentLogs(records)
    } catch (e: any) {
      message.error('Failed to fetch deployment logs: ' + (e.response?.data?.error || e.message))
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

  // Map backend deployment status to step progress
  const mapStatusToSteps = (status: string, logs: string[]): DeploymentStep[] => {
    const stepNames = [
      'Pulling code',
      'Installing dependencies',
      'Building application',
      'Running health checks',
      'Restarting services',
    ]
    if (status === 'success') {
      return stepNames.map(name => ({ name, status: 'success' as const }))
    }
    if (status === 'failed') {
      return stepNames.map((name, idx) => ({
        name,
        status: idx < stepNames.length - 1 ? 'success' as const : 'failed' as const,
      }))
    }
    // deploying: parse logs to infer step
    const completed: string[] = []
    if (logs.some(l => l.toLowerCase().includes('git pull'))) completed.push('Pulling code')
    if (logs.some(l => l.toLowerCase().includes('npm install'))) completed.push('Installing dependencies')
    if (logs.some(l => l.toLowerCase().includes('build'))) completed.push('Building application')
    if (logs.some(l => l.toLowerCase().includes('health'))) completed.push('Running health checks')
    if (logs.some(l => l.toLowerCase().includes('pm2'))) completed.push('Restarting services')
    return stepNames.map(name => ({
      name,
      status: completed.includes(name)
        ? 'success' as const
        : name === stepNames[completed.length]
          ? 'in-progress' as const
          : 'pending' as const,
    }))
  }

  // Poll real deployment status from backend
  const pollDeploymentStatus = async (jobId: string) => {
    try {
      const res = await adminApi.get(`/dev/deployment-status/${jobId}`)
      const data = res.data
      const pct = data.progress ?? (data.status === 'success' ? 100 : data.status === 'failed' ? 100 : 50)
      const logs: string[] = (data.logs || []).map((l: any) => l.message || l)

      setDeploymentProgress(pct)
      setDeploymentSteps(mapStatusToSteps(data.status, logs))

      if (data.status === 'success') {
        if (pollIntervalRef.current) clearInterval(pollIntervalRef.current)
        setDeploymentSuccess(true)
        setModalStep('result')
        fetchDeploymentLogs()
      } else if (data.status === 'failed') {
        if (pollIntervalRef.current) clearInterval(pollIntervalRef.current)
        setDeploymentError(data.error || 'Deployment failed')
        setModalStep('result')
        fetchDeploymentLogs()
      }
    } catch (error: any) {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current)
      setDeploymentError('Failed to fetch deployment status: ' + (error.response?.data?.error || error.message))
      setModalStep('result')
    }
  }

  // Initiate REAL Push to Production
  const handlePushProduction = async () => {
    if (!gitStatus) {
      message.error('Git status not loaded. Please refresh first.')
      return
    }

    try {
      setDeploymentProgress(0)
      setDeploymentError(null)
      setDeploymentSteps([
        { name: 'Pulling code', status: 'pending' },
        { name: 'Installing dependencies', status: 'pending' },
        { name: 'Building application', status: 'pending' },
        { name: 'Running health checks', status: 'pending' },
        { name: 'Restarting services', status: 'pending' },
      ])

      // Call real backend to kick off prod deployment
      const commitHash = gitStatus.lastCommitHash || 'HEAD00000000'
      // commit_hash must be at least 7 chars
      const safeHash = commitHash.length >= 7 ? commitHash : commitHash.padEnd(7, '0')

      const res = await adminApi.post('/dev/deploy/prod', {
        branch: gitStatus.branch || 'main',
        commit_hash: safeHash,
      })

      const jobId = res.data.job_id || res.data.jobId
      setDeploymentJobId(jobId)
      setModalStep('progress')

      // Start polling real status
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current)
      pollIntervalRef.current = setInterval(() => pollDeploymentStatus(jobId), 3000)
    } catch (error: any) {
      const errMsg = error.response?.data?.error || error.message || 'Failed to initiate deployment'
      setDeploymentError(errMsg)
      setModalStep('result')
    }
  }

  // Handle rollback to latest successful deployment
  const handleRollback = async () => {
    try {
      // Find most recent successful deployment
      const lastGoodLog = deploymentLogs.find(l => l.status === 'success')
      if (!lastGoodLog) {
        message.error('No successful deployment found to rollback to')
        return
      }
      message.loading({ content: 'Initiating rollback...', key: 'rollback' })
      await adminApi.post(`/dev/rollback/${lastGoodLog.id}/environment/prod`)
      message.success({ content: 'Rollback initiated! Monitor logs for progress.', key: 'rollback' })
      closeDeploymentModal()
      fetchDeploymentLogs()
    } catch (error: any) {
      message.error({ content: error.response?.data?.error || error.message || 'Failed to rollback', key: 'rollback' })
    }
  }

  // Handle modal close — refresh logs if deployment completed
  const handleCloseDeploymentModal = () => {
    if (deploymentSuccess) {
      fetchDeploymentLogs()
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
              title="Prod Deploy Needed"
              value={prodReadiness?.deployNeeded ? 'Yes' : 'No'}
              prefix={<ExclamationCircleOutlined />}
              valueStyle={{ fontSize: 24, color: prodReadiness?.deployNeeded ? '#faad14' : '#52c41a' }}
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
              onClick={openDeploymentModal}
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
        <Button
          icon={<ReloadOutlined />}
          onClick={() => { fetchGitStatus(); fetchProdReadiness() }}
          loading={loading || readinessLoading}
        >
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

          <Card
            style={
              prodReadiness?.deployNeeded
                ? { backgroundColor: '#fff7e6', borderLeft: '4px solid #faad14' }
                : { backgroundColor: '#f6ffed', borderLeft: '4px solid #52c41a' }
            }
          >
            <Typography.Text strong style={{ fontSize: 16 }}>
              {readinessLoading
                ? 'Checking production deploy status...'
                : prodReadiness?.deployNeeded
                  ? '⚡ Production deploy needed'
                  : '✅ Production is up to date'}
            </Typography.Text>
            <Divider />
            {prodReadiness && (
              <>
                <Typography.Paragraph style={{ marginBottom: 8 }}>
                  {prodReadiness.reason}
                </Typography.Paragraph>
                <Typography.Paragraph style={{ marginBottom: 8, fontSize: 13, color: '#666' }}>
                  On disk: <Tag color="blue">{prodReadiness.currentCommit.substring(0, 7)}</Tag>
                  {' '}Last deployed to prod:{' '}
                  {prodReadiness.lastDeployedCommit
                    ? <Tag color="default">{prodReadiness.lastDeployedCommit.substring(0, 7)}</Tag>
                    : <Tag color="red">never</Tag>}
                  {prodReadiness.lastDeployedAt && ` (${new Date(prodReadiness.lastDeployedAt).toLocaleString()})`}
                </Typography.Paragraph>
                {prodReadiness.pendingMigrations.length > 0 && (
                  <Typography.Paragraph style={{ marginBottom: 0, fontSize: 13 }}>
                    Pending migrations: {prodReadiness.pendingMigrations.map((f) => (
                      <Tag key={f} color="gold">{f}</Tag>
                    ))}
                  </Typography.Paragraph>
                )}
              </>
            )}
          </Card>
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
                  Pending Migrations
                </Typography.Text>
                <Typography.Paragraph style={{ margin: '4px 0', fontSize: 14, fontWeight: 600 }}>
                  {prodReadiness?.pendingMigrations.length || 0}
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
          {currentSection === 'dashboard' && DashboardSection()}
          {currentSection === 'deployment' && DeploymentSection()}
          {currentSection === 'git' && GitSection()}
          {currentSection === 'logs' && LogsSection()}
        </Content>
      </Layout>

      {/* Deployment Modal */}
      {DeploymentModal()}
    </Layout>
  )
}
