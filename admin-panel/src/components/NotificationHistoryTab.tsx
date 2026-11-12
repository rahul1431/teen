import { useEffect, useState } from 'react'
import { Card, Table, Tag, Select, DatePicker, Space, message, Progress, Button, Modal, Popconfirm, Descriptions } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import type { Dayjs } from 'dayjs'
import { EyeOutlined, DeleteOutlined, CopyOutlined } from '@ant-design/icons'
import { adminApi } from '../api/client'

const { RangePicker } = DatePicker

interface Campaign {
  id: string
  title: string
  body?: string
  type: string
  target_type: 'all' | 'specific_user'
  target_user_id: string | null
  total_recipients: number
  delivered_count: number | null
  clicked_count?: number
  click_rate?: number
  converted_count?: number
  conversion_rate?: number
  conversion_revenue?: number
  skipped_fatigue_count?: number
  whatsapp_sent_count?: number
  sms_sent_count?: number
  fallback_triggered_count?: number
  delivery_channels?: string
  action_buttons?: any
  read_count: number
  read_rate: number
  sent_by_username: string | null
  created_at: string
  scheduled_for?: string
  status: 'pending' | 'processing' | 'sent' | 'failed'
  image_url?: string | null
  segment_type?: string | null
}

export function NotificationHistoryTab({ onCloneCampaign }: { onCloneCampaign?: (c: Campaign) => void }) {
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)
  const [type, setType] = useState<string | undefined>(undefined)
  const [dateRange, setDateRange] = useState<[Dayjs | null, Dayjs | null] | null>(null)
  const [selectedCampaign, setSelectedCampaign] = useState<Campaign | null>(null)

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

  const handleDelete = async (id: string) => {
    try {
      await adminApi.delete(`/notifications/campaigns/${id}`)
      message.success('Campaign deleted/cancelled successfully')
      fetchCampaigns()
    } catch {
      message.error('Failed to delete campaign')
    }
  }

  const columns: ColumnsType<Campaign> = [
    {
      title: 'Status',
      dataIndex: 'status',
      render: (v) => {
        let color = 'default'
        if (v === 'pending') color = 'orange'
        else if (v === 'processing') color = 'blue'
        else if (v === 'sent') color = 'green'
        else if (v === 'failed') color = 'red'
        return <Tag color={color}>{(v || 'sent').toUpperCase()}</Tag>
      }
    },
    {
      title: 'Title',
      dataIndex: 'title',
      render: (v, row) => (
        <span>
          <a onClick={() => setSelectedCampaign(row)} style={{ fontWeight: 600 }}>{v}</a>
          {row.image_url && <span title={row.image_url} style={{ cursor: 'pointer', marginLeft: 6 }}>🖼️</span>}
        </span>
      ),
    },
    { title: 'Type', dataIndex: 'type', render: (v) => <Tag>{v}</Tag> },
    {
      title: 'Target / Segment',
      dataIndex: 'target_type',
      render: (v, row) => {
        if (v === 'all') {
          const map: Record<string, string> = {
            all: 'All Users',
            active_7d: 'Active 7 Days',
            inactive_7d: 'Inactive 7 Days',
            low_balance: 'Balance < ₹100',
          }
          return <Tag color="blue">{map[row.segment_type || 'all'] || 'All Users'}</Tag>
        }
        return `User: ${row.target_user_id?.slice(0, 8)}…`
      },
    },
    {
      title: 'Delivery & Omnichannel',
      key: 'delivery',
      render: (_, row) => (
        <Space size={4} wrap>
          <Tag color="cyan">📲 {row.delivered_count ?? 0}/{row.total_recipients}</Tag>
          {(row.whatsapp_sent_count || 0) > 0 && <Tag color="green">💬 {row.whatsapp_sent_count} WA</Tag>}
          {(row.skipped_fatigue_count || 0) > 0 && <Tag color="purple">🛡️ {row.skipped_fatigue_count} Capped</Tag>}
        </Space>
      ),
    },
    {
      title: 'Read & Attribution',
      key: 'attribution',
      render: (_, row) => (
        <div>
          <Progress
            percent={Math.round((row.read_rate || 0) * 100)}
            size="small"
            format={() => `${row.read_count}/${row.total_recipients}`}
          />
          <div style={{ fontSize: 11, color: '#8c8c8c', marginTop: 2 }}>
            CTR: {((row.click_rate || 0) * 100).toFixed(1)}% | CVR: {((row.conversion_rate || 0) * 100).toFixed(1)}%
            {(row.conversion_revenue || 0) > 0 && (
              <span style={{ color: '#52c41a', marginLeft: 6, fontWeight: 'bold' }}>
                +₹{row.conversion_revenue}
              </span>
            )}
          </div>
        </div>
      ),
    },
    {
      title: 'Sent/Scheduled At',
      dataIndex: 'created_at',
      render: (v, row) => {
        const date = row.status === 'pending' && row.scheduled_for ? row.scheduled_for : v
        return new Date(date).toLocaleString('en-IN')
      }
    },
    {
      title: 'Actions',
      key: 'actions',
      render: (_, row) => (
        <Space size={6}>
          <Button size="small" icon={<EyeOutlined />} onClick={() => setSelectedCampaign(row)} />
          {onCloneCampaign && (
            <Button size="small" icon={<CopyOutlined />} onClick={() => onCloneCampaign(row)} title="Clone to Composer" />
          )}
          <Popconfirm
            title="Delete/Cancel this notification record?"
            onConfirm={() => handleDelete(row.id)}
            okText="Yes"
            cancelText="No"
          >
            <Button size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ]

  return (
    <Card>
      <Space style={{ marginBottom: 16 }}>
        <Select
          allowClear
          placeholder="Filter by type"
          style={{ width: 180 }}
          value={type}
          onChange={(value) => {
            setType(value)
            setPage(1)
          }}
          options={[
            { value: 'general', label: 'General' },
            { value: 'promotion', label: 'Promotion' },
            { value: 'game_result', label: 'Game Result' },
            { value: 'wallet', label: 'Wallet Update' },
            { value: 'broadcast', label: 'Broadcast' },
          ]}
        />
        <RangePicker
          value={dateRange as any}
          onChange={(range) => {
            setDateRange(range as [Dayjs | null, Dayjs | null] | null)
            setPage(1)
          }}
          allowClear
        />
      </Space>
      <Table
        dataSource={campaigns}
        columns={columns}
        rowKey="id"
        loading={loading}
        pagination={{ current: page, pageSize: 20, total, onChange: setPage }}
      />

      {/* Campaign Details Modal */}
      <Modal
        title="Notification Campaign Details"
        open={Boolean(selectedCampaign)}
        onCancel={() => setSelectedCampaign(null)}
        footer={[
          <Button key="close" onClick={() => setSelectedCampaign(null)}>
            Close
          </Button>,
          onCloneCampaign && selectedCampaign && (
            <Button
              key="clone"
              type="primary"
              icon={<CopyOutlined />}
              onClick={() => {
                onCloneCampaign(selectedCampaign)
                setSelectedCampaign(null)
              }}
            >
              Clone to Composer
            </Button>
          ),
        ]}
        width={650}
      >
        {selectedCampaign && (
          <div>
            <Descriptions bordered column={2} size="small">
              <Descriptions.Item label="Campaign ID" span={2}>
                <code>{selectedCampaign.id}</code>
              </Descriptions.Item>
              <Descriptions.Item label="Title" span={2}>
                <b>{selectedCampaign.title}</b>
              </Descriptions.Item>
              <Descriptions.Item label="Message Body" span={2}>
                <div style={{ whiteSpace: 'pre-wrap', color: '#e6e6e6' }}>
                  {selectedCampaign.body || '(No body stored or broadcast payload)'}
                </div>
              </Descriptions.Item>
              <Descriptions.Item label="Type">{selectedCampaign.type}</Descriptions.Item>
              <Descriptions.Item label="Status">
                <Tag color={selectedCampaign.status === 'sent' ? 'green' : 'orange'}>
                  {selectedCampaign.status.toUpperCase()}
                </Tag>
              </Descriptions.Item>
              <Descriptions.Item label="Total Recipients">{selectedCampaign.total_recipients}</Descriptions.Item>
              <Descriptions.Item label="Delivered (FCM)">{selectedCampaign.delivered_count ?? 0}</Descriptions.Item>
              <Descriptions.Item label="WhatsApp Fallback">{selectedCampaign.whatsapp_sent_count ?? 0}</Descriptions.Item>
              <Descriptions.Item label="SMS Fallback">{selectedCampaign.sms_sent_count ?? 0}</Descriptions.Item>
              <Descriptions.Item label="Fatigue Shielded">{selectedCampaign.skipped_fatigue_count ?? 0}</Descriptions.Item>
              <Descriptions.Item label="Total Clicks (CTR)">
                {selectedCampaign.clicked_count ?? 0} ({(((selectedCampaign.click_rate ?? 0) * 100)).toFixed(1)}%)
              </Descriptions.Item>
              <Descriptions.Item label="Total Converted (CVR)">
                {selectedCampaign.converted_count ?? 0} ({(((selectedCampaign.conversion_rate ?? 0) * 100)).toFixed(1)}%)
              </Descriptions.Item>
              <Descriptions.Item label="Attributed Revenue">
                <span style={{ color: '#52c41a', fontWeight: 'bold' }}>
                  ₹{(selectedCampaign.conversion_revenue ?? 0).toFixed(2)}
                </span>
              </Descriptions.Item>
              {selectedCampaign.image_url && (
                <Descriptions.Item label="Rich Image Banner" span={2}>
                  <img
                    src={selectedCampaign.image_url}
                    alt="banner"
                    style={{ maxWidth: '100%', maxHeight: 180, borderRadius: 8, marginTop: 6 }}
                  />
                </Descriptions.Item>
              )}
            </Descriptions>
          </div>
        )}
      </Modal>
    </Card>
  )
}
