import { useEffect, useState } from 'react'
import { Card, Tabs, Table, Tag, Statistic, Row, Col, Button, Badge, Space, Popconfirm, message, Typography } from 'antd'
import { WarningOutlined, LinkOutlined } from '@ant-design/icons'
import { adminApi } from '../api/client'
import { useNavigate } from 'react-router-dom'

const statusColor: Record<string, string> = {
  active: 'green', suspended: 'orange', banned: 'red', suspicious: 'volcano',
}

export default function RiskCenter() {
  const navigate = useNavigate()
  const [overview, setOverview] = useState<any>(null)
  const [flaggedUsers, setFlaggedUsers] = useState<any[]>([])
  const [flaggedTotal, setFlaggedTotal] = useState(0)
  const [deviceLinks, setDeviceLinks] = useState<any[]>([])
  const [winAnomalies, setWinAnomalies] = useState<any[]>([])
  const [colluding, setColluding] = useState<any[]>([])
  const [loadingOverview, setLoadingOverview] = useState(true)
  const [loadingFlagged, setLoadingFlagged] = useState(false)
  const [flaggedPage, setFlaggedPage] = useState(1)

  const loadOverview = () => {
    setLoadingOverview(true)
    adminApi.get('/risk/overview').then(r => setOverview(r.data)).finally(() => setLoadingOverview(false))
  }

  const loadFlagged = (page = 1) => {
    setLoadingFlagged(true)
    adminApi.get('/risk/flagged-users', { params: { page, limit: 20 } })
      .then(r => { setFlaggedUsers(r.data.users); setFlaggedTotal(r.data.total) })
      .finally(() => setLoadingFlagged(false))
  }

  useEffect(() => {
    loadOverview()
    loadFlagged()
    adminApi.get('/risk/device-links').then(r => setDeviceLinks(r.data))
    adminApi.get('/risk/win-rate-anomalies').then(r => setWinAnomalies(r.data))
    adminApi.get('/risk/colluding-pairs').then(r => setColluding(r.data))
  }, [])

  const handleFlag = async (userId: string) => {
    try {
      await adminApi.post(`/risk/flag/${userId}`)
      message.success('User flagged as suspicious')
      loadOverview()
      loadFlagged(flaggedPage)
    } catch (e: any) {
      message.error(e.response?.data?.error || 'Failed')
    }
  }

  const handleSuspend = async (userId: string) => {
    try {
      await adminApi.patch(`/users/${userId}/status`, { status: 'suspended' })
      message.success('User suspended')
      loadFlagged(flaggedPage)
    } catch (e: any) {
      message.error(e.response?.data?.error || 'Failed')
    }
  }

  const flaggedColumns = [
    { title: 'Username', dataIndex: 'username', render: (v: string, r: any) =>
      <Button type="link" size="small" icon={<LinkOutlined />} onClick={() => navigate(`/admin/users?id=${r.id}`)}>{v}</Button> },
    { title: 'Status', dataIndex: 'status', render: (v: string) => <Tag color={statusColor[v] || 'default'}>{v}</Tag> },
    { title: 'ROI', dataIndex: 'roi', render: (v: number) =>
      <Typography.Text type={parseFloat(String(v)) > 3 ? 'danger' : undefined} strong={parseFloat(String(v)) > 3}>
        {v != null ? `${parseFloat(String(v)).toFixed(2)}x` : '—'}
      </Typography.Text> },
    { title: 'Games', dataIndex: 'games_played' },
    { title: 'Manual Credits (7d)', dataIndex: 'manual_credits_7d', render: (v: number) =>
      v > 0 ? <Badge count={v} style={{ backgroundColor: '#ff4d4f' }} /> : '0' },
    { title: 'Shared Device', dataIndex: 'shared_device_count', render: (v: number) =>
      v > 0 ? <Tag color="volcano">{v} linked</Tag> : <Tag color="default">none</Tag> },
    { title: 'Actions', render: (_: any, r: any) =>
      <Space size="small">
        <Button size="small" onClick={() => navigate(`/admin/users?id=${r.id}`)}>View</Button>
        {r.status !== 'suspicious' && (
          <Popconfirm title="Flag as suspicious?" onConfirm={() => handleFlag(r.id)}>
            <Button size="small" danger>Flag</Button>
          </Popconfirm>
        )}
        {r.status === 'active' || r.status === 'suspicious' ? (
          <Popconfirm title="Suspend this user?" onConfirm={() => handleSuspend(r.id)}>
            <Button size="small" type="primary" danger>Suspend</Button>
          </Popconfirm>
        ) : null}
      </Space> },
  ]

  const deviceColumns = [
    { title: 'Device Fingerprint', dataIndex: 'device_fingerprint', render: (v: string) =>
      <Typography.Text code copyable style={{ fontSize: 11 }}>{v?.slice(0, 20)}…</Typography.Text> },
    { title: 'Linked Accounts', dataIndex: 'account_count', render: (v: number) =>
      <Tag color="volcano">{v} accounts</Tag> },
  ]

  const deviceExpanded = (record: any) => (
    <Table size="small" dataSource={record.accounts} rowKey="id" pagination={false} scroll={{ x: 'max-content' }}
      columns={[
        { title: 'Username', dataIndex: 'username', render: (v: string, r: any) =>
          <Button type="link" size="small" onClick={() => navigate(`/admin/users?id=${r.id}`)}>{v}</Button> },
        { title: 'Status', dataIndex: 'status', render: (v: string) => <Tag color={statusColor[v] || 'default'}>{v}</Tag> },
        { title: 'Created', dataIndex: 'created_at', render: (v: string) => new Date(v).toLocaleDateString() },
      ]} />
  )

  const winColumns = [
    { title: 'Username', dataIndex: 'username', render: (v: string, r: any) =>
      <Button type="link" size="small" onClick={() => navigate(`/admin/users?id=${r.user_id}`)}>{v}</Button> },
    { title: 'Status', dataIndex: 'status', render: (v: string) => <Tag color={statusColor[v] || 'default'}>{v}</Tag> },
    { title: 'Win Rate', dataIndex: 'win_rate', render: (v: number) =>
      <Typography.Text type={parseFloat(String(v)) > 2 ? 'danger' : 'warning'} strong>
        {(parseFloat(String(v)) * 100).toFixed(1)}%
      </Typography.Text> },
    { title: 'Wagered (₹)', dataIndex: 'total_wagered', render: (v: number) => `₹${parseFloat(String(v)).toLocaleString()}` },
    { title: 'Won (₹)', dataIndex: 'total_won', render: (v: number) => `₹${parseFloat(String(v)).toLocaleString()}` },
    { title: 'Win Txns', dataIndex: 'win_txns' },
    { title: 'Loss Txns', dataIndex: 'loss_txns' },
    { title: 'Actions', render: (_: any, r: any) =>
      <Popconfirm title="Flag as suspicious?" onConfirm={() => handleFlag(r.user_id)}>
        <Button size="small" danger>Flag</Button>
      </Popconfirm> },
  ]

  const colludingColumns = [
    { title: 'User A', dataIndex: 'user_a', render: (v: string, r: any) =>
      <Button type="link" size="small" onClick={() => navigate(`/admin/users?id=${r.user_a_id}`)}>{v}</Button> },
    { title: 'User B', dataIndex: 'user_b', render: (v: string, r: any) =>
      <Button type="link" size="small" onClick={() => navigate(`/admin/users?id=${r.user_b_id}`)}>{v}</Button> },
    { title: 'Shared Rooms', dataIndex: 'shared_rooms', render: (v: number) =>
      <Tag color={v >= 5 ? 'red' : 'orange'}>{v} rooms</Tag> },
    { title: 'Actions', render: (_: any, r: any) =>
      <Space size="small">
        <Popconfirm title={`Flag ${r.user_a} as suspicious?`} onConfirm={() => handleFlag(r.user_a_id)}>
          <Button size="small" danger>Flag A</Button>
        </Popconfirm>
        <Popconfirm title={`Flag ${r.user_b} as suspicious?`} onConfirm={() => handleFlag(r.user_b_id)}>
          <Button size="small" danger>Flag B</Button>
        </Popconfirm>
      </Space> },
  ]

  const items = [
    {
      key: 'overview',
      label: 'Overview',
      children: (
        <Row gutter={16}>
          <Col span={6}>
            <Card><Statistic title="Flagged Users" value={overview?.flagged_users ?? '—'}
              valueStyle={{ color: '#cf1322' }} prefix={<WarningOutlined />} loading={loadingOverview} /></Card>
          </Col>
          <Col span={6}>
            <Card><Statistic title="Suspended Today" value={overview?.suspended_today ?? '—'}
              valueStyle={{ color: '#fa8c16' }} loading={loadingOverview} /></Card>
          </Col>
          <Col span={6}>
            <Card><Statistic title="Win-Rate Alerts (30d)" value={overview?.win_rate_alerts ?? '—'}
              valueStyle={{ color: '#d48806' }} loading={loadingOverview} /></Card>
          </Col>
          <Col span={6}>
            <Card><Statistic title="Manual Credits (24h)" value={overview?.manual_credits_24h ?? '—'}
              valueStyle={{ color: '#722ed1' }} loading={loadingOverview} /></Card>
          </Col>
        </Row>
      ),
    },
    {
      key: 'flagged',
      label: `Flagged Users${flaggedTotal > 0 ? ` (${flaggedTotal})` : ''}`,
      children: (
        <Table
          dataSource={flaggedUsers}
          columns={flaggedColumns}
          rowKey="id"
          loading={loadingFlagged}
          rowClassName={(r: any) => r.status === 'suspicious' ? 'ant-table-row-selected' : ''}
          pagination={{
            current: flaggedPage,
            pageSize: 20,
            total: flaggedTotal,
            onChange: (p) => { setFlaggedPage(p); loadFlagged(p) },
          }}
          size="small"
          scroll={{ x: 'max-content' }}
        />
      ),
    },
    {
      key: 'devices',
      label: 'Device Links',
      children: (
        <Table
          dataSource={deviceLinks}
          columns={deviceColumns}
          rowKey="device_fingerprint"
          expandable={{ expandedRowRender: deviceExpanded }}
          size="small"
          pagination={{ pageSize: 20 }}
          scroll={{ x: 'max-content' }}
        />
      ),
    },
    {
      key: 'winrate',
      label: 'Win-Rate Anomalies',
      children: (
        <Table
          dataSource={winAnomalies}
          columns={winColumns}
          rowKey="user_id"
          rowClassName={(r: any) => parseFloat(r.win_rate) > 2 ? 'ant-table-row-danger' : ''}
          size="small"
          pagination={{ pageSize: 20 }}
          scroll={{ x: 'max-content' }}
        />
      ),
    },
    {
      key: 'collusion',
      label: 'Collusion Pairs',
      children: (
        <Table
          dataSource={colluding}
          columns={colludingColumns}
          rowKey={(r: any) => `${r.user_a_id}-${r.user_b_id}`}
          size="small"
          pagination={{ pageSize: 20 }}
          scroll={{ x: 'max-content' }}
        />
      ),
    },
  ]

  return (
    <Card title={<><WarningOutlined style={{ color: '#cf1322', marginRight: 8 }} />Risk Center</>}>
      <Tabs defaultActiveKey="overview" items={items} />
    </Card>
  )
}
