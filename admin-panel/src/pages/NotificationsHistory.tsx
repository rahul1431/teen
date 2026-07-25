import { useEffect, useMemo, useState } from 'react'
import { Card, Table, Tag, Button, Typography, message, DatePicker } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import type { Dayjs } from 'dayjs'
import { adminApi } from '../api/client'
import { useAuthStore } from '../store/auth'
import { useNotificationStore, type AdminNotification } from '../store/notifications'
import { NotificationBellTrendChart } from '../components/NotificationBellTrendChart'

const { Title } = Typography
const { RangePicker } = DatePicker

export default function NotificationsHistory() {
  const { items, setInitial, markAllRead } = useNotificationStore()
  const admin = useAuthStore((s) => s.admin)
  const [loading, setLoading] = useState(false)
  const [dateRange, setDateRange] = useState<[Dayjs | null, Dayjs | null] | null>(null)

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

  const typeFilters = useMemo(
    () =>
      Array.from(new Set(items.map((i) => i.type))).map((t) => ({ text: t, value: t })),
    [items],
  )

  const filteredItems = useMemo(() => {
    if (!dateRange || !dateRange[0] || !dateRange[1]) return items
    const start = dateRange[0].startOf('day').valueOf()
    const end = dateRange[1].endOf('day').valueOf()
    return items.filter((i) => {
      const t = new Date(i.created_at).getTime()
      return t >= start && t <= end
    })
  }, [items, dateRange])

  const columns: ColumnsType<AdminNotification> = [
    {
      title: 'Type',
      dataIndex: 'type',
      filters: typeFilters,
      onFilter: (value, record) => record.type === value,
      render: (v) => <Tag>{v}</Tag>,
    },
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
      <NotificationBellTrendChart />
      <Card>
        <div style={{ marginBottom: 16 }}>
          <RangePicker
            value={dateRange as any}
            onChange={(range) => setDateRange(range as [Dayjs | null, Dayjs | null] | null)}
            allowClear
          />
        </div>
        <Table dataSource={filteredItems} columns={columns} rowKey="id" loading={loading} pagination={{ pageSize: 20 }} />
      </Card>
    </div>
  )
}
