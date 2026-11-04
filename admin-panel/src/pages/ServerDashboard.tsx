import React, { useState, useEffect, useCallback, useMemo } from 'react'
import {
  Card,
  Row,
  Col,
  Table,
  Tag,
  Button,
  Modal,
  Input,
  Badge,
  Progress,
  Tabs,
  Typography,
  Space,
  Tooltip,
  Alert,
  Spin,
  Statistic,
  notification
} from 'antd'
import {
  CloudServerOutlined,
  ReloadOutlined,
  PoweroffOutlined,
  ThunderboltOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  ExclamationCircleOutlined,
  HddOutlined,
  DashboardOutlined,
  KeyOutlined,
  CodeOutlined,
  SyncOutlined,
  GlobalOutlined,
  DesktopOutlined,
  ClusterOutlined,
  LockOutlined,
  ArrowLeftOutlined
} from '@ant-design/icons'
import axios from 'axios'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '../store/auth'

const { Title, Text, Paragraph } = Typography

interface HostInfo {
  hostname: string
  platform: string
  arch: string
  release: string
  nodeVersion: string
  uptimeSeconds: number
}

interface HostOverview {
  host: HostInfo
  cpu: {
    usage: number
    loadAvg: [number, number, number]
    cores: number
  }
  memory: {
    total: number
    used: number
    free: number
    buffCache: number
    available: number
  }
  disk: Array<{
    filesystem: string
    size: string
    used: string
    avail: string
    percent: string
    mounted: string
  }>
  pm2: {
    total: number
    online: number
    errored: number
    stopped: number
  }
  docker: {
    runningCount: number
  }
  networkSocketsCount: number
  checkedAt: string
}

interface PM2Process {
  pm_id: number
  name: string
  status: string
  cpu: number
  memory_bytes: number
  memory_mb: number
  restarts: number
  unstable_restarts: number
  uptime_ms: number
  pid: number | null
  mode: string
  version: string
  user: string
  created_at: number | null
}

interface DockerContainer {
  id: string
  name: string
  image: string
  status: string
  state: string
  ports: string
  createdAt: string
  healthy: string
}

interface ConnectionTarget {
  id: string
  name: string
  port: number
  type: string
  latencyMs: number
  status: 'ONLINE' | 'OFFLINE' | 'DEGRADED'
  httpCode?: number
  error?: string | null
}

interface ConnectionMatrix {
  totalServices: number
  onlineServices: number
  healthScore: number
  matrix: ConnectionTarget[]
  checkedAt: string
}

export default function ServerDashboard({ isEmbedded = false }: { isEmbedded?: boolean }) {
  const navigate = useNavigate()
  const { token, admin } = useAuthStore()

  // State
  const [loadingOverview, setLoadingOverview] = useState(false)
  const [overview, setOverview] = useState<HostOverview | null>(null)

  const [loadingPM2, setLoadingPM2] = useState(false)
  const [pm2List, setPm2List] = useState<PM2Process[]>([])
  const [pm2Filter, setPm2Filter] = useState<'all' | 'online' | 'gateways' | 'engines'>('all')

  const [loadingDocker, setLoadingDocker] = useState(false)
  const [dockerList, setDockerList] = useState<DockerContainer[]>([])

  const [loadingMatrix, setLoadingMatrix] = useState(false)
  const [matrixData, setMatrixData] = useState<ConnectionMatrix | null>(null)

  const [k8sInfo, setK8sInfo] = useState<any>(null)

  // PIN & Action Modals
  const [pinModalVisible, setPinModalVisible] = useState(false)
  const [pinValue, setPinValue] = useState('')
  const [pendingAction, setPendingAction] = useState<{
    type: 'pm2_stop' | 'pm2_restart_critical' | 'pm2_reload_all' | 'docker_action' | 'system_reboot'
    target?: string
    dockerAction?: 'restart' | 'stop' | 'start'
  } | null>(null)
  const [actionLoading, setActionLoading] = useState(false)

  // Log Viewer Modal
  const [logsModalVisible, setLogsModalVisible] = useState(false)
  const [logsTitle, setLogsTitle] = useState('')
  const [logsContent, setLogsContent] = useState('')
  const [logsLoading, setLogsLoading] = useState(false)

  // Auth headers
  const authHeaders = useMemo(() => ({
    headers: {
      Authorization: `Bearer ${token}`
    }
  }), [token])

  // 1. Fetch Overview
  const fetchOverview = useCallback(async () => {
    try {
      setLoadingOverview(true)
      const res = await axios.get('/api/server/overview', authHeaders)
      if (res.data?.success) {
        setOverview(res.data.data)
      }
    } catch (err: any) {
      console.error('Fetch overview failed:', err)
    } finally {
      setLoadingOverview(false)
    }
  }, [authHeaders])

  // 2. Fetch PM2
  const fetchPM2 = useCallback(async () => {
    try {
      setLoadingPM2(true)
      const res = await axios.get('/api/server/pm2/list', authHeaders)
      if (res.data?.success) {
        setPm2List(res.data.data)
      }
    } catch (err: any) {
      console.error('Fetch PM2 failed:', err)
    } finally {
      setLoadingPM2(false)
    }
  }, [authHeaders])

  // 3. Fetch Docker
  const fetchDocker = useCallback(async () => {
    try {
      setLoadingDocker(true)
      const res = await axios.get('/api/server/docker/list', authHeaders)
      if (res.data?.success) {
        setDockerList(res.data.data)
      }
    } catch (err: any) {
      console.error('Fetch Docker failed:', err)
    } finally {
      setLoadingDocker(false)
    }
  }, [authHeaders])

  // 4. Fetch Connections Matrix
  const fetchMatrix = useCallback(async () => {
    try {
      setLoadingMatrix(true)
      const res = await axios.get('/api/server/connections/matrix', authHeaders)
      if (res.data?.success) {
        setMatrixData(res.data.data)
      }
    } catch (err: any) {
      console.error('Fetch Matrix failed:', err)
    } finally {
      setLoadingMatrix(false)
    }
  }, [authHeaders])

  // 5. Fetch K8s
  const fetchK8s = useCallback(async () => {
    try {
      const res = await axios.get('/api/server/k8s/status', authHeaders)
      if (res.data?.success) {
        setK8sInfo(res.data.data)
      }
    } catch {}
  }, [authHeaders])

  // Refresh all
  const refreshAll = useCallback(() => {
    fetchOverview()
    fetchPM2()
    fetchDocker()
    fetchMatrix()
    fetchK8s()
  }, [fetchOverview, fetchPM2, fetchDocker, fetchMatrix, fetchK8s])

  useEffect(() => {
    refreshAll()
    const interval = setInterval(refreshAll, 15000) // auto-poll every 15s
    return () => clearInterval(interval)
  }, [refreshAll])

  // Handlers
  const handlePM2Restart = async (processName: string) => {
    // If it's a critical process, prompt for PIN
    if (['teen-core-api', 'teen-wallet', 'teen-admin-svc'].includes(processName)) {
      setPendingAction({ type: 'pm2_restart_critical', target: processName })
      setPinValue('')
      setPinModalVisible(true)
      return
    }

    try {
      setActionLoading(true)
      const res = await axios.post('/api/server/pm2/action', {
        action: 'restart',
        target: processName
      }, authHeaders)
      if (res.data?.success) {
        notification.success({ message: `Process ${processName} restarted successfully` })
        fetchPM2()
        fetchMatrix()
      }
    } catch (err: any) {
      notification.error({ message: 'PM2 action failed', description: err.response?.data?.error || err.message })
    } finally {
      setActionLoading(false)
    }
  }

  const handlePM2StopPrompt = (processName: string) => {
    setPendingAction({ type: 'pm2_stop', target: processName })
    setPinValue('')
    setPinModalVisible(true)
  }

  const handleReloadAllPrompt = () => {
    setPendingAction({ type: 'pm2_reload_all', target: 'all' })
    setPinValue('')
    setPinModalVisible(true)
  }

  const handleDockerActionPrompt = (container: string, action: 'restart' | 'stop' | 'start') => {
    setPendingAction({ type: 'docker_action', target: container, dockerAction: action })
    setPinValue('')
    setPinModalVisible(true)
  }

  const handleSystemRebootPrompt = () => {
    setPendingAction({ type: 'system_reboot' })
    setPinValue('')
    setPinModalVisible(true)
  }

  // Execute PIN confirmed action
  const handleExecutePinAction = async () => {
    if (!pendingAction) return
    if (!pinValue) {
      notification.warning({ message: 'Please enter the Master PIN' })
      return
    }

    setActionLoading(true)
    try {
      if (pendingAction.type === 'pm2_stop' || pendingAction.type === 'pm2_restart_critical') {
        const act = pendingAction.type === 'pm2_stop' ? 'stop' : 'restart'
        const res = await axios.post('/api/server/pm2/action', {
          action: act,
          target: pendingAction.target,
          pin: pinValue
        }, authHeaders)
        if (res.data?.success) {
          notification.success({ message: `PM2 ${act} on ${pendingAction.target} succeeded!` })
          setPinModalVisible(false)
          fetchPM2()
        }
      } else if (pendingAction.type === 'pm2_reload_all') {
        const res = await axios.post('/api/server/pm2/action', {
          action: 'reload',
          target: 'all',
          pin: pinValue
        }, authHeaders)
        if (res.data?.success) {
          notification.success({ message: 'Reload all microservices command executed!' })
          setPinModalVisible(false)
          setTimeout(refreshAll, 3000)
        }
      } else if (pendingAction.type === 'docker_action') {
        const res = await axios.post('/api/server/docker/action', {
          action: pendingAction.dockerAction,
          container: pendingAction.target,
          pin: pinValue
        }, authHeaders)
        if (res.data?.success) {
          notification.success({ message: `Docker ${pendingAction.dockerAction} on ${pendingAction.target} completed!` })
          setPinModalVisible(false)
          fetchDocker()
        }
      } else if (pendingAction.type === 'system_reboot') {
        const res = await axios.post('/api/server/system/reboot', {
          pin: pinValue,
          confirmation: 'REBOOT_HOST_SERVER'
        }, authHeaders)
        if (res.data?.success) {
          notification.warning({
            message: 'Server Reboot Scheduled',
            description: 'The GCP VM is restarting in 60 seconds. Services will reconnect automatically.'
          })
          setPinModalVisible(false)
        }
      }
    } catch (err: any) {
      notification.error({
        message: 'Action Authorization Failed',
        description: err.response?.data?.error || 'Invalid Master PIN or command failure.'
      })
    } finally {
      setActionLoading(false)
    }
  }

  // View Logs
  const handleViewPM2Logs = async (processName: string) => {
    setLogsTitle(`PM2 Real-Time Logs: ${processName}`)
    setLogsModalVisible(true)
    setLogsLoading(true)
    setLogsContent('')
    try {
      const res = await axios.get(`/api/server/pm2/logs/${processName}?lines=100`, authHeaders)
      setLogsContent(res.data?.logs || 'No log stream captured.')
    } catch (err: any) {
      setLogsContent(`Error reading logs: ${err.message}`)
    } finally {
      setLogsLoading(false)
    }
  }

  const handleViewDockerLogs = async (containerName: string) => {
    setLogsTitle(`Docker Container Logs: ${containerName}`)
    setLogsModalVisible(true)
    setLogsLoading(true)
    setLogsContent('')
    try {
      const res = await axios.get(`/api/server/docker/logs/${containerName}?lines=100`, authHeaders)
      setLogsContent(res.data?.logs || 'No container log stream captured.')
    } catch (err: any) {
      setLogsContent(`Error reading docker logs: ${err.message}`)
    } finally {
      setLogsLoading(false)
    }
  }

  // Filtered PM2 list
  const filteredPM2 = useMemo(() => {
    if (pm2Filter === 'all') return pm2List
    if (pm2Filter === 'online') return pm2List.filter(p => p.status === 'online')
    if (pm2Filter === 'gateways') return pm2List.filter(p => p.name.includes('gateway'))
    if (pm2Filter === 'engines') return pm2List.filter(p => p.name.includes('engine') || ['teen-ludo', 'teen-rummy', 'teen-aviator'].includes(p.name))
    return pm2List
  }, [pm2List, pm2Filter])

  // Format uptime
  const formatUptime = (seconds: number) => {
    const days = Math.floor(seconds / (3600 * 24))
    const hours = Math.floor((seconds % (3600 * 24)) / 3600)
    const minutes = Math.floor((seconds % 3600) / 60)
    if (days > 0) return `${days}d ${hours}h ${minutes}m`
    if (hours > 0) return `${hours}h ${minutes}m`
    return `${minutes}m ${Math.floor(seconds % 60)}s`
  }

  // PM2 columns
  const pm2Columns = [
    {
      title: 'App / Service',
      dataIndex: 'name',
      key: 'name',
      render: (name: string, record: PM2Process) => (
        <Space direction="vertical" size={2}>
          <Space>
            <Text strong style={{ color: '#fff' }}>{name}</Text>
            {record.unstable_restarts > 5 && (
              <Tag color="red">Unstable ({record.unstable_restarts})</Tag>
            )}
          </Space>
          <Text type="secondary" style={{ fontSize: 11 }}>PID: {record.pid || 'N/A'} • Mode: {record.mode}</Text>
        </Space>
      )
    },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      render: (status: string) => {
        const isOnline = status === 'online'
        return (
          <Badge
            status={isOnline ? 'success' : 'error'}
            text={
              <Text strong style={{ color: isOnline ? '#10b981' : '#f43f5e', textTransform: 'uppercase' }}>
                {status}
              </Text>
            }
          />
        )
      }
    },
    {
      title: 'CPU',
      dataIndex: 'cpu',
      key: 'cpu',
      render: (cpu: number) => (
        <Space>
          <Progress
            percent={Math.min(cpu, 100)}
            size="small"
            showInfo={false}
            strokeColor={cpu > 80 ? '#f43f5e' : cpu > 40 ? '#f59e0b' : '#10b981'}
            style={{ width: 60 }}
          />
          <Text style={{ fontSize: 12 }}>{cpu}%</Text>
        </Space>
      )
    },
    {
      title: 'Memory',
      dataIndex: 'memory_mb',
      key: 'memory_mb',
      render: (mb: number) => (
        <Tag color={mb > 250 ? 'volcano' : mb > 150 ? 'orange' : 'cyan'}>
          {mb} MB
        </Tag>
      )
    },
    {
      title: 'Restarts',
      dataIndex: 'restarts',
      key: 'restarts',
      render: (r: number) => (
        <Text style={{ color: r > 1000 ? '#f59e0b' : '#9ca3af' }}>{r.toLocaleString()}</Text>
      )
    },
    {
      title: 'Uptime',
      dataIndex: 'uptime_ms',
      key: 'uptime_ms',
      render: (ms: number) => (
        <Text style={{ fontSize: 12 }}>{formatUptime(Math.floor(ms / 1000))}</Text>
      )
    },
    {
      title: 'Actions',
      key: 'actions',
      render: (_: any, record: PM2Process) => (
        <Space size="small">
          <Tooltip title="View last 100 lines of live logs">
            <Button
              size="small"
              icon={<CodeOutlined />}
              onClick={() => handleViewPM2Logs(record.name)}
              style={{ background: '#1f2937', borderColor: '#374151', color: '#9ca3af' }}
            >
              Logs
            </Button>
          </Tooltip>
          <Tooltip title="Restart process">
            <Button
              size="small"
              icon={<ReloadOutlined />}
              onClick={() => handlePM2Restart(record.name)}
              type="primary"
              ghost
            >
              Restart
            </Button>
          </Tooltip>
          <Tooltip title="Stop process (Master PIN required)">
            <Button
              size="small"
              danger
              icon={<PoweroffOutlined />}
              onClick={() => handlePM2StopPrompt(record.name)}
            />
          </Tooltip>
        </Space>
      )
    }
  ]

  return (
    <div style={{
      minHeight: '100vh',
      background: '#090d16',
      color: '#e5e7eb',
      padding: isEmbedded ? 0 : '24px 32px',
      fontFamily: 'Inter, system-ui, sans-serif'
    }}>
      {/* Top Banner Navigation */}
      <div style={{
        background: 'linear-gradient(135deg, #111827 0%, #1e1b4b 50%, #0f172a 100%)',
        borderRadius: 14,
        padding: '20px 28px',
        border: '1px solid rgba(255, 255, 255, 0.08)',
        boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.5)',
        marginBottom: 24
      }}>
        <Row justify="space-between" align="middle" gutter={[16, 16]}>
          <Col xs={24} md={14}>
            <Space direction="vertical" size={4}>
              <Space align="center">
                {!isEmbedded && (
                  <Button
                    icon={<ArrowLeftOutlined />}
                    onClick={() => navigate('/admin')}
                    style={{ background: 'rgba(255,255,255,0.08)', borderColor: 'transparent', color: '#fff' }}
                  >
                    Admin Panel
                  </Button>
                )}
                <Tag color="#10b981" style={{ fontWeight: 700, padding: '3px 10px' }}>
                  <Badge status="processing" color="#10b981" /> LIVE NOC
                </Tag>
                <Title level={3} style={{ color: '#fff', margin: 0, letterSpacing: -0.5 }}>
                  Server & Gateway Operations Center
                </Title>
              </Space>
              <Text style={{ color: '#94a3b8', fontSize: 13 }}>
                GCP Compute Engine VM (35.244.3.210) • Microservices Fleet, PM2 Cluster, Multi-Gateway & Containers
              </Text>
            </Space>
          </Col>

          <Col xs={24} md={10} style={{ textAlign: 'right' }}>
            <Space wrap>
              <Button
                icon={<ThunderboltOutlined />}
                onClick={fetchMatrix}
                loading={loadingMatrix}
                style={{ background: '#0284c7', borderColor: '#0284c7', color: '#fff' }}
              >
                Ping All Services
              </Button>
              <Button
                icon={<ReloadOutlined />}
                onClick={refreshAll}
                loading={loadingOverview || loadingPM2}
                style={{ background: '#334155', borderColor: '#475569', color: '#fff' }}
              >
                Refresh
              </Button>
              <Button
                icon={<SyncOutlined />}
                onClick={handleReloadAllPrompt}
                style={{ background: '#f59e0b', borderColor: '#f59e0b', color: '#000', fontWeight: 600 }}
              >
                Reload Fleet
              </Button>
              <Button
                danger
                icon={<PoweroffOutlined />}
                onClick={handleSystemRebootPrompt}
                style={{ fontWeight: 600 }}
              >
                Reboot Server
              </Button>
            </Space>
          </Col>
        </Row>
      </div>

      {/* Quick Metrics Bar */}
      <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
        <Col xs={12} sm={6} lg={4}>
          <Card style={{ background: '#111827', borderColor: '#1f2937', borderRadius: 12 }}>
            <Statistic
              title={<Text style={{ color: '#94a3b8', fontSize: 12 }}>SERVICES HEALTH</Text>}
              value={matrixData ? `${matrixData.healthScore}%` : '100%'}
              valueStyle={{ color: '#10b981', fontWeight: 700 }}
              prefix={<CheckCircleOutlined />}
            />
          </Card>
        </Col>
        <Col xs={12} sm={6} lg={4}>
          <Card style={{ background: '#111827', borderColor: '#1f2937', borderRadius: 12 }}>
            <Statistic
              title={<Text style={{ color: '#94a3b8', fontSize: 12 }}>PM2 FLEET</Text>}
              value={overview?.pm2.online ?? pm2List.filter(p => p.status === 'online').length}
              suffix={`/ ${overview?.pm2.total ?? pm2List.length}`}
              valueStyle={{ color: '#38bdf8', fontWeight: 700 }}
              prefix={<CloudServerOutlined />}
            />
          </Card>
        </Col>
        <Col xs={12} sm={6} lg={4}>
          <Card style={{ background: '#111827', borderColor: '#1f2937', borderRadius: 12 }}>
            <Statistic
              title={<Text style={{ color: '#94a3b8', fontSize: 12 }}>HOST CPU LOAD</Text>}
              value={overview?.cpu.usage ?? 0}
              suffix="%"
              valueStyle={{
                color: (overview?.cpu.usage ?? 0) > 80 ? '#f43f5e' : '#10b981',
                fontWeight: 700
              }}
              prefix={<DashboardOutlined />}
            />
          </Card>
        </Col>
        <Col xs={12} sm={6} lg={4}>
          <Card style={{ background: '#111827', borderColor: '#1f2937', borderRadius: 12 }}>
            <Statistic
              title={<Text style={{ color: '#94a3b8', fontSize: 12 }}>RAM UTILIZATION</Text>}
              value={overview ? `${Math.round((overview.memory.used / overview.memory.total) * 100)}%` : '0%'}
              valueStyle={{ color: '#a855f7', fontWeight: 700 }}
              prefix={<HddOutlined />}
            />
          </Card>
        </Col>
        <Col xs={12} sm={6} lg={4}>
          <Card style={{ background: '#111827', borderColor: '#1f2937', borderRadius: 12 }}>
            <Statistic
              title={<Text style={{ color: '#94a3b8', fontSize: 12 }}>DOCKER CONTAINERS</Text>}
              value={dockerList.length || 3}
              suffix="Running"
              valueStyle={{ color: '#06b6d4', fontWeight: 700 }}
              prefix={<ClusterOutlined />}
            />
          </Card>
        </Col>
        <Col xs={12} sm={6} lg={4}>
          <Card style={{ background: '#111827', borderColor: '#1f2937', borderRadius: 12 }}>
            <Statistic
              title={<Text style={{ color: '#94a3b8', fontSize: 12 }}>SYSTEM UPTIME</Text>}
              value={overview ? formatUptime(overview.host.uptimeSeconds) : '24h+'}
              valueStyle={{ color: '#f59e0b', fontWeight: 700, fontSize: 16 }}
              prefix={<DesktopOutlined />}
            />
          </Card>
        </Col>
      </Row>

      {/* Main Tabs Container */}
      <Tabs
        defaultActiveKey="gateways"
        type="card"
        style={{
          background: '#111827',
          padding: 16,
          borderRadius: 14,
          border: '1px solid #1f2937'
        }}
        items={[
          {
            key: 'gateways',
            label: (
              <span><ThunderboltOutlined /> Service & Gateway Latency Matrix</span>
            ),
            children: (
              <div>
                <Alert
                  type="info"
                  showIcon
                  message="Real-Time Network Latency & Microservice Ping Grid"
                  description="Concurrent health probes evaluate HTTP roundtrip time, database latency, Redis PING responses, and game WebSocket gateways directly from internal loopback and public endpoints."
                  style={{ background: '#0f172a', borderColor: '#1e293b', marginBottom: 16 }}
                />

                <Row gutter={[16, 16]}>
                  {(matrixData?.matrix || []).map((svc) => {
                    const isOnline = svc.status === 'ONLINE'
                    const latencyColor = svc.latencyMs < 25 ? '#10b981' : svc.latencyMs < 80 ? '#f59e0b' : '#f43f5e'
                    return (
                      <Col xs={24} sm={12} md={8} lg={6} key={svc.id}>
                        <Card
                          style={{
                            background: '#0b0f19',
                            borderColor: isOnline ? 'rgba(16, 185, 129, 0.2)' : 'rgba(244, 63, 94, 0.3)',
                            borderRadius: 12
                          }}
                          bodyStyle={{ padding: 16 }}
                        >
                          <Row justify="space-between" align="middle" style={{ marginBottom: 8 }}>
                            <Col>
                              <Badge status={isOnline ? 'success' : 'error'} />
                              <Text strong style={{ color: '#fff', marginLeft: 6 }}>{svc.name}</Text>
                            </Col>
                            <Col>
                              <Tag color={isOnline ? 'green' : 'red'}>{svc.status}</Tag>
                            </Col>
                          </Row>

                          <Space direction="vertical" size={2} style={{ width: '100%' }}>
                            <Row justify="space-between">
                              <Text type="secondary" style={{ fontSize: 12 }}>Port: {svc.port}</Text>
                              <Tag style={{ background: '#1e293b', borderColor: 'transparent', color: latencyColor, fontWeight: 700 }}>
                                {svc.latencyMs} ms
                              </Tag>
                            </Row>
                            <Row justify="space-between">
                              <Text type="secondary" style={{ fontSize: 12 }}>Type: {svc.type.toUpperCase()}</Text>
                              {svc.httpCode && (
                                <Text style={{ fontSize: 12, color: svc.httpCode === 200 ? '#10b981' : '#f59e0b' }}>
                                  HTTP {svc.httpCode}
                                </Text>
                              )}
                            </Row>
                            {svc.error && (
                              <Text type="danger" style={{ fontSize: 11 }}>{svc.error}</Text>
                            )}
                          </Space>
                        </Card>
                      </Col>
                    )
                  })}
                </Row>
              </div>
            )
          },
          {
            key: 'pm2',
            label: (
              <span><CloudServerOutlined /> PM2 Process Fleet ({pm2List.length})</span>
            ),
            children: (
              <div>
                <Row justify="space-between" align="middle" style={{ marginBottom: 16 }}>
                  <Col>
                    <Space>
                      <Button
                        type={pm2Filter === 'all' ? 'primary' : 'default'}
                        onClick={() => setPm2Filter('all')}
                      >
                        All ({pm2List.length})
                      </Button>
                      <Button
                        type={pm2Filter === 'online' ? 'primary' : 'default'}
                        onClick={() => setPm2Filter('online')}
                      >
                        Online ({pm2List.filter(p => p.status === 'online').length})
                      </Button>
                      <Button
                        type={pm2Filter === 'gateways' ? 'primary' : 'default'}
                        onClick={() => setPm2Filter('gateways')}
                      >
                        Gateways ({pm2List.filter(p => p.name.includes('gateway')).length})
                      </Button>
                      <Button
                        type={pm2Filter === 'engines' ? 'primary' : 'default'}
                        onClick={() => setPm2Filter('engines')}
                      >
                        Game Engines
                      </Button>
                    </Space>
                  </Col>
                  <Col>
                    <Button
                      icon={<ReloadOutlined />}
                      onClick={fetchPM2}
                      loading={loadingPM2}
                    >
                      Refresh Processes
                    </Button>
                  </Col>
                </Row>

                <Table
                  dataSource={filteredPM2}
                  columns={pm2Columns}
                  rowKey="name"
                  pagination={{ pageSize: 12 }}
                  loading={loadingPM2}
                  style={{ background: '#0b0f19', borderRadius: 8 }}
                />
              </div>
            )
          },
          {
            key: 'docker',
            label: (
              <span><ClusterOutlined /> Docker Containers ({dockerList.length})</span>
            ),
            children: (
              <div>
                <Alert
                  type="info"
                  showIcon
                  message="Containerized Infrastructure Services"
                  description="Persistent database (PostgreSQL 16), in-memory cache/pub-sub (Redis 7), and Roundcube webmail operate as isolated Docker containers on network bridge."
                  style={{ background: '#0f172a', borderColor: '#1e293b', marginBottom: 16 }}
                />

                <Row gutter={[16, 16]}>
                  {dockerList.map((ct) => (
                    <Col xs={24} md={8} key={ct.id}>
                      <Card
                        style={{
                          background: '#0b0f19',
                          borderColor: '#1f2937',
                          borderRadius: 12
                        }}
                        title={
                          <Space>
                            <ClusterOutlined style={{ color: '#06b6d4' }} />
                            <Text strong style={{ color: '#fff' }}>{ct.name}</Text>
                          </Space>
                        }
                        extra={
                          <Tag color={ct.state === 'running' ? 'green' : 'red'}>
                            {ct.state.toUpperCase()}
                          </Tag>
                        }
                      >
                        <Space direction="vertical" size={4} style={{ width: '100%', marginBottom: 16 }}>
                          <Text type="secondary" style={{ fontSize: 12 }}>Image: <Text style={{ color: '#cbd5e1' }}>{ct.image}</Text></Text>
                          <Text type="secondary" style={{ fontSize: 12 }}>Ports: <Text style={{ color: '#cbd5e1' }}>{ct.ports || 'Internal'}</Text></Text>
                          <Text type="secondary" style={{ fontSize: 12 }}>Status: <Text style={{ color: '#10b981' }}>{ct.status}</Text></Text>
                          <Text type="secondary" style={{ fontSize: 11 }}>ID: {ct.id}</Text>
                        </Space>

                        <Space>
                          <Button
                            size="small"
                            icon={<CodeOutlined />}
                            onClick={() => handleViewDockerLogs(ct.name)}
                          >
                            Logs
                          </Button>
                          <Button
                            size="small"
                            icon={<ReloadOutlined />}
                            onClick={() => handleDockerActionPrompt(ct.name, 'restart')}
                            type="primary"
                            ghost
                          >
                            Restart
                          </Button>
                        </Space>
                      </Card>
                    </Col>
                  ))}
                </Row>
              </div>
            )
          },
          {
            key: 'k8s',
            label: (
              <span><GlobalOutlined /> Kubernetes & Orchestration</span>
            ),
            children: (
              <div style={{ padding: 12 }}>
                <Card style={{ background: '#0b0f19', borderColor: '#1f2937', borderRadius: 12 }}>
                  <Space direction="vertical" size={16} style={{ width: '100%' }}>
                    <Row align="middle" gutter={16}>
                      <Col>
                        <ClusterOutlined style={{ fontSize: 36, color: '#38bdf8' }} />
                      </Col>
                      <Col>
                        <Title level={4} style={{ color: '#fff', margin: 0 }}>
                          Orchestration Mode: {k8sInfo?.orchestrationMode || 'PM2 + Docker Engine'}
                        </Title>
                        <Text type="secondary">
                          Host Instance: {k8sInfo?.hostAddress || '35.244.3.210'} (GCP Compute Engine e2-standard)
                        </Text>
                      </Col>
                    </Row>

                    <Alert
                      type="success"
                      message="Active Architecture Status"
                      description={
                        k8sInfo?.architectureNotes ||
                        'All microservices run on dedicated high-performance PM2 daemon instances with direct low-latency socket communication. Ingress is routed through HestiaCP Nginx proxy.'
                      }
                      style={{ background: '#042f2e', borderColor: '#115e59' }}
                    />

                    {k8sInfo?.installed ? (
                      <div>
                        <Text strong style={{ color: '#10b981' }}>Kubectl Detected:</Text>
                        <pre style={{ background: '#020617', padding: 12, borderRadius: 8, color: '#94a3b8' }}>
                          {k8sInfo.clusterInfo}
                        </pre>
                      </div>
                    ) : (
                      <Card style={{ background: '#020617', borderColor: '#1e293b' }}>
                        <Title level={5} style={{ color: '#cbd5e1' }}>Kubernetes Ingress Compatibility</Title>
                        <Paragraph style={{ color: '#94a3b8' }}>
                          The backend repository is containerized and compatible with Helm/K8s manifests. If migrating to Google Kubernetes Engine (GKE), the existing environment configs will seamlessly bind to Kubernetes Services and Ingress.
                        </Paragraph>
                      </Card>
                    )}
                  </Space>
                </Card>
              </div>
            )
          },
          {
            key: 'hardware',
            label: (
              <span><HddOutlined /> Host Hardware & Storage</span>
            ),
            children: (
              <div>
                <Row gutter={[16, 16]}>
                  {/* Disk Usage */}
                  <Col xs={24} md={14}>
                    <Card title={<Text strong style={{ color: '#fff' }}>Disk Partitions (`df -h`)</Text>} style={{ background: '#0b0f19', borderColor: '#1f2937' }}>
                      <Table
                        dataSource={overview?.disk || []}
                        rowKey="mounted"
                        pagination={false}
                        size="small"
                        columns={[
                          { title: 'Mount', dataIndex: 'mounted', key: 'mounted' },
                          { title: 'Filesystem', dataIndex: 'filesystem', key: 'filesystem', render: (t) => <Text style={{ fontSize: 11 }}>{t}</Text> },
                          { title: 'Size', dataIndex: 'size', key: 'size' },
                          { title: 'Used', dataIndex: 'used', key: 'used' },
                          { title: 'Avail', dataIndex: 'avail', key: 'avail' },
                          {
                            title: 'Usage',
                            dataIndex: 'percent',
                            key: 'percent',
                            render: (p: string) => {
                              const num = parseInt(p.replace('%', ''), 10) || 0
                              return (
                                <Space>
                                  <Progress
                                    percent={num}
                                    size="small"
                                    strokeColor={num > 85 ? '#f43f5e' : '#10b981'}
                                    style={{ width: 80 }}
                                  />
                                  <Text style={{ fontSize: 11 }}>{p}</Text>
                                </Space>
                              )
                            }
                          }
                        ]}
                      />
                    </Card>
                  </Col>

                  {/* RAM Breakdown */}
                  <Col xs={24} md={10}>
                    <Card title={<Text strong style={{ color: '#fff' }}>RAM Distribution (`free -m`)</Text>} style={{ background: '#0b0f19', borderColor: '#1f2937' }}>
                      {overview && (
                        <Space direction="vertical" size={12} style={{ width: '100%' }}>
                          <div>
                            <Row justify="space-between">
                              <Text type="secondary">Used RAM</Text>
                              <Text strong style={{ color: '#fff' }}>{overview.memory.used} MB / {overview.memory.total} MB</Text>
                            </Row>
                            <Progress
                              percent={Math.round((overview.memory.used / overview.memory.total) * 100)}
                              strokeColor="#a855f7"
                            />
                          </div>

                          <Row gutter={8}>
                            <Col span={12}>
                              <Card size="small" style={{ background: '#020617', borderColor: '#1e293b' }}>
                                <Statistic title="Free Memory" value={overview.memory.free} suffix="MB" valueStyle={{ color: '#10b981', fontSize: 16 }} />
                              </Card>
                            </Col>
                            <Col span={12}>
                              <Card size="small" style={{ background: '#020617', borderColor: '#1e293b' }}>
                                <Statistic title="Buffer / Cache" value={overview.memory.buffCache} suffix="MB" valueStyle={{ color: '#38bdf8', fontSize: 16 }} />
                              </Card>
                            </Col>
                          </Row>

                          <Card size="small" style={{ background: '#020617', borderColor: '#1e293b' }}>
                            <Row justify="space-between">
                              <Text type="secondary">CPU Load Avg (1m, 5m, 15m):</Text>
                              <Text strong style={{ color: '#f59e0b' }}>
                                {overview.cpu.loadAvg.join(', ')} ({overview.cpu.cores} Cores)
                              </Text>
                            </Row>
                          </Card>
                        </Space>
                      )}
                    </Card>
                  </Col>
                </Row>
              </div>
            )
          }
        ]}
      />

      {/* Master PIN Authorization Modal */}
      <Modal
        title={
          <Space>
            <LockOutlined style={{ color: '#f59e0b' }} />
            <Text strong style={{ color: '#fff' }}>Superadmin Master PIN Required</Text>
          </Space>
        }
        open={pinModalVisible}
        onCancel={() => setPinModalVisible(false)}
        onOk={handleExecutePinAction}
        confirmLoading={actionLoading}
        okText="Authorize & Execute"
        okButtonProps={{ danger: pendingAction?.type === 'system_reboot' || pendingAction?.type === 'pm2_stop' }}
      >
        <Space direction="vertical" size={16} style={{ width: '100%', padding: '12px 0' }}>
          <Alert
            type="warning"
            showIcon
            message={
              pendingAction?.type === 'system_reboot'
                ? 'WARNING: You are about to initiate an Operating System reboot on the GCP VM.'
                : pendingAction?.type === 'pm2_stop'
                ? `WARNING: Stopping ${pendingAction?.target} will take that service offline.`
                : 'Sensitive Operations Authorization'
            }
            description="Enter the Superadmin Master PIN to confirm this operational action."
          />

          <div>
            <Text strong style={{ display: 'block', marginBottom: 6 }}>Master PIN:</Text>
            <Input.Password
              size="large"
              placeholder="Enter Master PIN (e.g. 9849)"
              prefix={<KeyOutlined />}
              value={pinValue}
              onChange={(e) => setPinValue(e.target.value)}
              onPressEnter={handleExecutePinAction}
              autoFocus
            />
            <Text type="secondary" style={{ fontSize: 12, marginTop: 4, display: 'block' }}>
              Configured via SERVER_MASTER_PIN in server .env (Default: 9849)
            </Text>
          </div>
        </Space>
      </Modal>

      {/* Terminal Logs Modal */}
      <Modal
        title={
          <Space>
            <CodeOutlined style={{ color: '#10b981' }} />
            <Text strong style={{ color: '#fff' }}>{logsTitle}</Text>
          </Space>
        }
        open={logsModalVisible}
        onCancel={() => setLogsModalVisible(false)}
        footer={[
          <Button key="close" onClick={() => setLogsModalVisible(false)}>
            Close
          </Button>
        ]}
        width={850}
      >
        <div style={{
          background: '#020617',
          padding: 16,
          borderRadius: 8,
          maxHeight: 500,
          overflowY: 'auto',
          border: '1px solid #1e293b'
        }}>
          {logsLoading ? (
            <div style={{ textAlign: 'center', padding: 40 }}>
              <Spin />
              <div style={{ color: '#94a3b8', marginTop: 12 }}>Streaming real-time log output...</div>
            </div>
          ) : (
            <pre style={{
              margin: 0,
              fontFamily: 'Consolas, Monaco, "Courier New", monospace',
              fontSize: 12,
              color: '#34d399',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-all'
            }}>
              {logsContent}
            </pre>
          )}
        </div>
      </Modal>
    </div>
  )
}
