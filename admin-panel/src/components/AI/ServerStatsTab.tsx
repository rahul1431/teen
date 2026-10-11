// admin-panel/src/components/AI/ServerStatsTab.tsx
import { useState, useEffect } from 'react'
import {
  Card, Row, Col, Progress, Table, Tag, Button, Spin, Typography, Input, Space, Alert, Badge
} from 'antd'
import {
  CloudServerOutlined, ReloadOutlined, SearchOutlined, WarningOutlined, InfoCircleOutlined
} from '@ant-design/icons'
import { adminApi } from '../../api/client'

const { Text, Title } = Typography

interface CpuInfo {
  usage: number
  loadAvg: number[]
  cores: number
}

interface MemoryInfo {
  total: number
  used: number
  free: number
  buffCache: number
  available: number
}

interface DiskInfo {
  filesystem: string
  size: string
  used: string
  avail: string
  percent: string
  mounted: string
}

interface ServerHealthData {
  cpu: CpuInfo
  memory: MemoryInfo
  disk: DiskInfo[]
  uptime: number
  checkedAt: string
}

interface ProcessInfo {
  user: string
  pid: string
  cpu: string
  mem: string
  vsz: string
  rss: string
  tty: string
  stat: string
  start: string
  time: string
  command: string
}

interface NetworkInfo {
  netid: string
  state: string
  recvQ: string
  sendQ: string
  local: string
  peer: string
  process: string
}

export function ServerStatsTab() {
  const [health, setHealth] = useState<ServerHealthData | null>(null)
  const [processes, setProcesses] = useState<ProcessInfo[]>([])
  const [network, setNetwork] = useState<NetworkInfo[]>([])
  const [loading, setLoading] = useState(false)
  const [searchProcess, setSearchProcess] = useState('')
  const [searchNetwork, setSearchNetwork] = useState('')

  // Alarm Limits
  const CPU_ALERT_THRESHOLD = 80
  const MEM_ALERT_THRESHOLD = 90
  const DISK_ALERT_THRESHOLD = 85

  const loadData = async () => {
    setLoading(true)
    try {
      const [healthRes, procRes, netRes] = await Promise.allSettled([
        adminApi.get('/server/health'),
        adminApi.get('/server/processes'),
        adminApi.get('/server/network')
      ])

      if (healthRes.status === 'fulfilled') setHealth(healthRes.value.data?.data ?? null)
      if (procRes.status === 'fulfilled') setProcesses(procRes.value.data?.data ?? [])
      if (netRes.status === 'fulfilled') setNetwork(netRes.value.data?.data ?? [])
    } catch (err) {
      console.error('Error fetching server stats:', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
    // Support AI Control Center refresh event
    window.addEventListener('aiDashboardRefresh', loadData)
    return () => {
      window.removeEventListener('aiDashboardRefresh', loadData)
    }
  }, [])

  const formatUptime = (seconds: number) => {
    const d = Math.floor(seconds / (3600 * 24))
    const h = Math.floor((seconds % (3600 * 24)) / 3600)
    const m = Math.floor((seconds % 3600) / 60)
    return `${d}d ${h}h ${m}m`
  }

  // Filter lists
  const filteredProcesses = processes.filter(p =>
    p.command.toLowerCase().includes(searchProcess.toLowerCase()) ||
    p.pid.includes(searchProcess) ||
    p.user.toLowerCase().includes(searchProcess.toLowerCase())
  )

  const filteredNetwork = network.filter(n =>
    n.local.toLowerCase().includes(searchNetwork.toLowerCase()) ||
    n.process.toLowerCase().includes(searchNetwork.toLowerCase()) ||
    n.state.toLowerCase().includes(searchNetwork.toLowerCase())
  )

  // Status badges
  const cpuPercent = health?.cpu.usage ?? 0
  const totalMem = health?.memory.total ?? 1
  const usedMem = health?.memory.used ?? 0
  const memPercent = Math.round((usedMem / totalMem) * 100)

  // Find root or primary partition disk percent
  const rootDisk = health?.disk.find(d => d.mounted === '/')
  const diskPercent = rootDisk ? parseInt(rootDisk.percent.replace('%', ''), 10) : 0

  return (
    <Spin spinning={loading}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <Space>
          <CloudServerOutlined style={{ fontSize: 20, color: '#1890ff' }} />
          <Title level={4} style={{ margin: 0 }}>System Resource Health & Live Diagnostics</Title>
        </Space>
        <Button type="primary" icon={<ReloadOutlined />} onClick={loadData} loading={loading}>
          Manual Refresh
        </Button>
      </div>

      {/* System Warning banner */}
      {(cpuPercent > CPU_ALERT_THRESHOLD || memPercent > MEM_ALERT_THRESHOLD || diskPercent > DISK_ALERT_THRESHOLD) && (
        <Alert
          message="System Resource Warning Alert"
          description={`High resource utilization detected! ${cpuPercent > CPU_ALERT_THRESHOLD ? `CPU usage is at ${cpuPercent}%. ` : ''}${memPercent > MEM_ALERT_THRESHOLD ? `Memory usage is at ${memPercent}%. ` : ''}${diskPercent > DISK_ALERT_THRESHOLD ? `Root disk space is at ${diskPercent}%.` : ''}`}
          type="warning"
          showIcon
          icon={<WarningOutlined />}
          style={{ marginBottom: 20 }}
        />
      )}

      {/* Overview Cards */}
      <Row gutter={[16, 16]} style={{ marginBottom: 20 }}>
        {/* CPU Panel */}
        <Col xs={24} md={8}>
          <Card size="small" title={
            <Space>
              <span>CPU Core Health</span>
              {cpuPercent > CPU_ALERT_THRESHOLD && <Badge status="error" text="Critical" />}
            </Space>
          }>
            <div style={{ textAlign: 'center', padding: '10px 0' }}>
              <Progress
                type="dashboard"
                percent={cpuPercent}
                strokeColor={cpuPercent > CPU_ALERT_THRESHOLD ? '#ff4d4f' : '#52c41a'}
                status={cpuPercent > CPU_ALERT_THRESHOLD ? 'exception' : 'normal'}
              />
              <div style={{ marginTop: 8 }}>
                <Text strong>Load Average: </Text>
                <Tag color="blue">{health?.cpu.loadAvg.join(', ') || 'N/A'}</Tag>
                <div style={{ marginTop: 4, fontSize: 12 }}>
                  <Text type="secondary">{health?.cpu.cores} CPU Cores Active</Text>
                </div>
              </div>
            </div>
          </Card>
        </Col>

        {/* RAM Panel */}
        <Col xs={24} md={8}>
          <Card size="small" title={
            <Space>
              <span>Memory Usage (free -m)</span>
              {memPercent > MEM_ALERT_THRESHOLD && <Badge status="error" text="High RAM Usage" />}
            </Space>
          }>
            <div style={{ textAlign: 'center', padding: '10px 0' }}>
              <Progress
                type="dashboard"
                percent={memPercent}
                strokeColor={memPercent > MEM_ALERT_THRESHOLD ? '#ff4d4f' : '#1890ff'}
                format={() => `${memPercent}%`}
              />
              <div style={{ marginTop: 8 }}>
                <Text strong>RAM stats: </Text>
                <div style={{ fontSize: 12, marginTop: 4 }}>
                  <Tag color="cyan">Used: {health?.memory.used ?? 0} MB</Tag>
                  <Tag color="green">Free: {health?.memory.free ?? 0} MB</Tag>
                  <Tag color="purple">Buffer: {health?.memory.buffCache ?? 0} MB</Tag>
                </div>
              </div>
            </div>
          </Card>
        </Col>

        {/* Disk Space & Uptime Panel */}
        <Col xs={24} md={8}>
          <Card size="small" title="System Uptime & Partition Space">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '8px 4px' }}>
              <div>
                <Text type="secondary" style={{ display: 'block', fontSize: 12 }}>SERVER RUNNING TIME</Text>
                <Title level={3} style={{ margin: '4px 0', color: '#722ed1' }}>
                  {health?.uptime ? formatUptime(health.uptime) : 'N/A'}
                </Title>
              </div>

              {health?.disk && health.disk.length > 0 ? (
                <div>
                  <Text type="secondary" style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>ROOT PARTITION SPACE ({rootDisk?.mounted ?? '/'})</Text>
                  <Progress
                    percent={diskPercent}
                    strokeColor={diskPercent > DISK_ALERT_THRESHOLD ? '#ff4d4f' : '#faad14'}
                    status={diskPercent > DISK_ALERT_THRESHOLD ? 'exception' : 'normal'}
                  />
                  <div style={{ fontSize: 12, display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
                    <Text type="secondary">Total: {rootDisk?.size ?? 'N/A'}</Text>
                    <Text type="secondary">Avail: {rootDisk?.avail ?? 'N/A'}</Text>
                  </div>
                </div>
              ) : (
                <Alert message="No partition details" type="info" showIcon />
              )}
            </div>
          </Card>
        </Col>
      </Row>

      {/* Processes & Network Tabs */}
      <Row gutter={[16, 16]}>
        {/* Processes Panel */}
        <Col xs={24} lg={14}>
          <Card
            size="small"
            title="Active System Processes (ps aux)"
            extra={
              <Input
                placeholder="Search processes..."
                prefix={<SearchOutlined />}
                value={searchProcess}
                onChange={e => setSearchProcess(e.target.value)}
                style={{ width: 220 }}
                size="small"
              />
            }
          >
            <Table<ProcessInfo>
              dataSource={filteredProcesses}
              rowKey="pid"
              size="small"
              pagination={{ pageSize: 10, showSizeChanger: true }}
              columns={[
                { title: 'PID', dataIndex: 'pid', width: 70 },
                { title: 'USER', dataIndex: 'user', width: 80, ellipsis: true },
                { title: 'CPU %', dataIndex: 'cpu', width: 70, sorter: (a, b) => parseFloat(a.cpu) - parseFloat(b.cpu) },
                { title: 'MEM %', dataIndex: 'mem', width: 70, sorter: (a, b) => parseFloat(a.mem) - parseFloat(b.mem) },
                { title: 'TIME', dataIndex: 'time', width: 80 },
                { title: 'COMMAND', dataIndex: 'command', ellipsis: true }
              ]}
            />
          </Card>
        </Col>

        {/* Network Connections Panel */}
        <Col xs={24} lg={10}>
          <Card
            size="small"
            title="Listening Ports & Sockets (ss -tulwn)"
            extra={
              <Input
                placeholder="Search ports/state..."
                prefix={<SearchOutlined />}
                value={searchNetwork}
                onChange={e => setSearchNetwork(e.target.value)}
                style={{ width: 180 }}
                size="small"
              />
            }
          >
            <Table<NetworkInfo>
              dataSource={filteredNetwork}
              rowKey={(r, idx) => `${r.local}-${idx}`}
              size="small"
              pagination={{ pageSize: 10 }}
              columns={[
                { title: 'Netid', dataIndex: 'netid', width: 65, render: v => <Tag color={v === 'tcp' ? 'cyan' : 'blue'}>{v}</Tag> },
                { title: 'State', dataIndex: 'state', width: 90 },
                { title: 'Local Address:Port', dataIndex: 'local', ellipsis: true },
                { title: 'Process', dataIndex: 'process', ellipsis: true }
              ]}
            />
          </Card>
        </Col>
      </Row>
    </Spin>
  )
}
