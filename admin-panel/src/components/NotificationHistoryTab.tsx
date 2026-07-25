import { useEffect, useState } from 'react'
import { Card, Table, Tag, Select, DatePicker, Space, message, Progress } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import type { Dayjs } from 'dayjs'
import { adminApi } from '../api/client'

const { RangePicker } = DatePicker

interface Campaign {
  id: string
  title: string
  type: string
  target_type: 'all' | 'specific_user'
  target_user_id: string | null
  total_recipients: number
  delivered_count: number | null
  read_count: number
  read_rate: number
  sent_by_username: string | null
  created_at: string
}

export function NotificationHistoryTab() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)
  const [type, setType] = useState<string | undefined>(undefined)
  const [dateRange, setDateRange] = useState<[Dayjs | null, Dayjs | null] | null>(null)

  useEffect(() => {
    fetchCampaigns()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, type, dateRange])

  async function fetchCampaigns() {
    setLoading(true)
    try {
      const params: any = { page, limit: 20 }
      if (type) params.type = type
      if (dateRange && dateRange[0] && dateRange[1]) {
        params.startDate = dateRange[0].startOf('day').toISOString()
        params.endDate = dateRange[1].endOf('day').toISOString()
      }
      const res = await adminApi.get('/notifications/campaigns', { params })
      setCampaigns(res.data.campaigns)
      setTotal(res.data.total)
    } catch {
      message.error('Failed to load notification history')
    } finally {
      setLoading(false)
    }
  }

  const columns: ColumnsType<Campaign> = [
    { title: 'Title', dataIndex: 'title' },
    { title: 'Type', dataIndex: 'type', render: (v) => <Tag>{v}</Tag> },
    {
      title: 'Target',
      dataIndex: 'target_type',
      render: (v, row) => (v === 'all' ? 'All Users' : `User: ${row.target_user_id?.slice(0, 8)}…`),
    },
    { title: 'Sent By', dataIndex: 'sent_by_username', render: (v) => v ?? '—' },
    { title: 'Recipients', dataIndex: 'total_recipients' },
    { title: 'Delivered', dataIndex: 'delivered_count', render: (v) => v ?? '—' },
    {
      title: 'Read Rate',
      dataIndex: 'read_rate',
      render: (v, row) => <Progress percent={Math.round(v * 100)} size="small" format={() => `${row.read_count}/${row.total_recipients}`} />,
    },
    { title: 'Sent At', dataIndex: 'created_at', render: (v) => new Date(v).toLocaleString('en-IN') },
  ]

  return (
    <Card>
      <Space style={{ marginBottom: 16 }}>
        <Select
          allowClear
          placeholder="Filter by type"
          style={{ width: 180 }}
          value={type}
          onChange={setType}
          options={[
            { value: 'general', label: 'General' },
            { value: 'promotion', label: 'Promotion' },
            { value: 'game_result', label: 'Game Result' },
            { value: 'wallet', label: 'Wallet Update' },
            { value: 'broadcast', label: 'Broadcast' },
          ]}
        />
        <RangePicker value={dateRange as any} onChange={(range) => setDateRange(range as [Dayjs | null, Dayjs | null] | null)} allowClear />
      </Space>
      <Table
        dataSource={campaigns}
        columns={columns}
        rowKey="id"
        loading={loading}
        pagination={{ current: page, pageSize: 20, total, onChange: setPage }}
      />
    </Card>
  )
}
