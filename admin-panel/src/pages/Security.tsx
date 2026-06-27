import { useEffect, useState } from 'react'
import { Card, Table, Button, Space, Tag, Typography, message, Alert } from 'antd'
import { SafetyOutlined, ReloadOutlined } from '@ant-design/icons'
import { adminApi } from '../api/client'
import { useAuthStore } from '../store/auth'

const { Text } = Typography

export default function Security() {
  const { admin } = useAuthStore()
  const [logs, setLogs] = useState<any[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)
  const [loading, setLoading] = useState(false)

  const loadAuditLogs = async (p = page, ps = pageSize) => {
    setLoading(true)
    try {
      const offset = (p - 1) * ps
      const res = await adminApi.get('/security/audit-logs', { params: { limit: ps, offset } })
      setLogs(res.data.logs || [])
      setTotal(res.data.total || 0)
    } catch (e: any) {
      message.error(e.response?.data?.error || 'Failed to load audit log data')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (admin?.role === 'superadmin') {
      loadAuditLogs(page, pageSize)
    }
  }, [page, pageSize, admin?.role])

  if (admin?.role !== 'superadmin') {
    return <Alert type="warning" showIcon message="Superadmin access required to view security audit logs" />
  }

  const columns = [
    {
      title: 'Timestamp',
      dataIndex: 'created_at',
      key: 'created_at',
      render: (d: string) => new Date(d).toLocaleString(),
      width: 180,
    },
    {
      title: 'Admin User',
      dataIndex: 'admin_username',
      key: 'admin_username',
      render: (u: string) => <Text strong>{u || 'System'}</Text>,
      width: 140,
    },
    {
      title: 'Action',
      dataIndex: 'action',
      key: 'action',
      render: (action: string) => {
        let color = 'blue'
        if (action.includes('ban') || action.includes('delete') || action.includes('disable')) {
          color = 'red'
        } else if (action.includes('create') || action.includes('enable')) {
          color = 'green'
        } else if (action.includes('update') || action.includes('reset') || action.includes('credit') || action.includes('debit')) {
          color = 'orange'
        }
        return <Tag color={color}>{action.replace('_', ' ').toUpperCase()}</Tag>
      },
      width: 180,
    },
    {
      title: 'Target Type',
      dataIndex: 'target_type',
      key: 'target_type',
      render: (t: string) => t ? <Tag>{t.toUpperCase()}</Tag> : '—',
      width: 120,
    },
    {
      title: 'Target ID',
      dataIndex: 'target_id',
      key: 'target_id',
      render: (id: string) => id ? <Text type="secondary" copyable>{id}</Text> : '—',
      width: 180,
    },
    {
      title: 'IP Address',
      dataIndex: 'ip_address',
      key: 'ip_address',
      render: (ip: string) => ip || '—',
      width: 130,
    },
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 style={{ color: '#d4af37', margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
          <SafetyOutlined /> Security & Audit logs
        </h2>
        <Button icon={<ReloadOutlined />} onClick={() => loadAuditLogs(page, pageSize)} loading={loading} type="primary">
          Refresh Logs
        </Button>
      </div>

      <Card loading={loading}>
        <Table
          dataSource={logs}
          columns={columns}
          rowKey="id"
          pagination={{
            current: page,
            pageSize: pageSize,
            total: total,
            showSizeChanger: true,
            onChange: (p, ps) => {
              setPage(p)
              setPageSize(ps)
            },
          }}
          expandable={{
            expandedRowRender: (record) => (
              <div style={{ padding: '8px 24px', background: '#f5f5f5', borderRadius: 4 }}>
                <Text strong>Action Details JSON:</Text>
                <pre style={{ margin: '8px 0 0 0', whiteSpace: 'pre-wrap', fontSize: '12px' }}>
                  {JSON.stringify(record.details || {}, null, 2)}
                </pre>
              </div>
            ),
            rowExpandable: (record) => !!record.details && Object.keys(record.details).length > 0,
          }}
          locale={{ emptyText: 'No audit log entries found' }}
        />
      </Card>
    </div>
  )
}
