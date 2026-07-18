import { useEffect, useState } from 'react'
import { Card, Table, Tag, Button, Typography, message } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { adminApi } from '../api/client'
import { useAuthStore } from '../store/auth'
import { useNotificationStore, type AdminNotification } from '../store/notifications'

const { Title } = Typography

export default function NotificationsHistory() {
  const { items, setInitial, markAllRead } = useNotificationStore()
  const admin = useAuthStore((s) => s.admin)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    fetchHistory()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function fetchHistory() {
    setLoading(true)
    try {
      const res = await adminApi.get('/notifications', { params: { limit: 200 } })
      const data: AdminNotification[] = res.data.notifications.map((n: any) => ({
        ...n,
        read: Array.isArray(n.read_by) && admin ? n.read_by.includes(admin.id) : false,
      }))
      setInitial(data, res.data.unread_count)
    } catch {
      message.error('Failed to load notification history')
    } finally {
      setLoading(false)
    }
  }

  async function onMarkAllRead() {
    try {
      await adminApi.patch('/notifications/read-all')
      markAllRead()
      message.success('All marked as read')
    } catch {
      message.error('Failed to mark all as read')
    }
  }

  const columns: ColumnsType<AdminNotification> = [
    { title: 'Type', dataIndex: 'type', render: (v) => <Tag>{v}</Tag> },
    { title: 'Title', dataIndex: 'title' },
    { title: 'Details', dataIndex: 'body' },
    { title: 'Severity', dataIndex: 'severity', render: (v) => <Tag color={v === 'warning' ? 'orange' : 'blue'}>{v}</Tag> },
    { title: 'Date', dataIndex: 'created_at', render: (v) => new Date(v).toLocaleString('en-IN') },
  ]

  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <Title level={3}>Notification History</Title>
        <Button onClick={onMarkAllRead}>Mark All Read</Button>
      </div>
      <Card>
        <Table dataSource={items} columns={columns} rowKey="id" loading={loading} pagination={{ pageSize: 20 }} />
      </Card>
    </div>
  )
}
