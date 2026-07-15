import { useEffect, useState } from 'react'
import { Table, Button, Modal, Form, InputNumber, Select, Space, message, TimePicker, Tag, Popconfirm } from 'antd'
import { PlusOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons'
import { adminApi } from '../api/client'
import dayjs from 'dayjs'

interface PrizeTier {
  match_type: 'last_1' | 'last_2' | 'last_3' | 'exact'
  outcome_type: 'cash' | 'coupon'
  multiplier?: number
  coupon_code?: string
}

interface Tier {
  id: string
  amount: number
  draw_time: string
  default_prize_tiers: PrizeTier[]
  status: 'active' | 'paused' | 'archived'
  created_at: string
}

interface LotteryDailyTiersProps {
  onRefresh?: () => void
}

export default function LotteryDailyTiers({ onRefresh }: LotteryDailyTiersProps) {
  const [tiers, setTiers] = useState<Tier[]>([])
  const [loading, setLoading] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form] = Form.useForm()

  useEffect(() => {
    loadTiers()
  }, [])

  const loadTiers = async () => {
    setLoading(true)
    try {
      const res = await adminApi.get('/betting/lottery/daily/admin/tiers')
      setTiers(res.data.tiers || [])
    } catch (err: any) {
      message.error('Failed to load tiers')
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  const handleCreate = () => {
    setEditingId(null)
    form.resetFields()
    setModalOpen(true)
  }

  const handleEdit = (tier: Tier) => {
    setEditingId(tier.id)
    form.setFieldsValue({
      amount: tier.amount,
      draw_time: dayjs(tier.draw_time, 'HH:mm:ss'),
      status: tier.status,
      default_prize_tiers: tier.default_prize_tiers || []
    })
    setModalOpen(true)
  }

  const handleSave = async (values: any) => {
    try {
      const payload = {
        amount: values.amount,
        draw_time: values.draw_time.format('HH:mm:ss'),
        status: values.status,
        default_prize_tiers: values.default_prize_tiers || []
      }

      if (editingId) {
        await adminApi.put(`/betting/lottery/daily/admin/tiers/${editingId}`, payload)
        message.success('Tier updated')
      } else {
        await adminApi.post('/betting/lottery/daily/admin/tiers', payload)
        message.success('Tier created')
      }

      setModalOpen(false)
      loadTiers()
      onRefresh?.()
    } catch (err: any) {
      message.error(err?.response?.data?.error || 'Failed to save tier')
      console.error(err)
    }
  }

  const handleArchive = async (id: string) => {
    try {
      await adminApi.put(`/betting/lottery/daily/admin/tiers/${id}`, { status: 'archived' })
      message.success('Tier archived')
      loadTiers()
      onRefresh?.()
    } catch (err: any) {
      message.error('Failed to archive tier')
      console.error(err)
    }
  }

  const statusColors: Record<string, string> = {
    active: 'green',
    paused: 'orange',
    archived: 'default'
  }

  const columns = [
    {
      title: 'Amount (₹)',
      dataIndex: 'amount',
      key: 'amount',
      width: 120,
      sorter: (a: Tier, b: Tier) => a.amount - b.amount,
      render: (amount: number) => <span>₹{amount}</span>
    },
    {
      title: 'Draw Time',
      dataIndex: 'draw_time',
      key: 'draw_time',
      width: 120
    },
    {
      title: 'Prize Tiers',
      dataIndex: 'default_prize_tiers',
      key: 'default_prize_tiers',
      width: 200,
      render: (tiers: PrizeTier[]) => (
        <Space size="small" wrap>
          {(tiers || []).map((t, idx) => (
            <Tag key={idx} color={t.outcome_type === 'cash' ? 'green' : 'orange'}>
              {t.match_type}: {t.multiplier || 1}x
            </Tag>
          ))}
        </Space>
      )
    },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      width: 100,
      filters: [
        { text: 'Active', value: 'active' },
        { text: 'Paused', value: 'paused' },
        { text: 'Archived', value: 'archived' }
      ],
      onFilter: (value: any, record: Tier) => record.status === value,
      render: (status: string) => (
        <Tag color={statusColors[status] || 'default'}>{status.toUpperCase()}</Tag>
      )
    },
    {
      title: 'Actions',
      key: 'actions',
      width: 200,
      fixed: 'right' as const,
      render: (_: any, record: Tier) => (
        <Space size="small">
          <Button
            type="primary"
            size="small"
            icon={<EditOutlined />}
            onClick={() => handleEdit(record)}
          >
            Edit
          </Button>
          <Popconfirm
            title="Archive Tier"
            description="Are you sure? Existing draws will complete, but new draws won't be created."
            okText="Archive"
            okType="danger"
            onConfirm={() => handleArchive(record.id)}
          >
            <Button danger size="small" icon={<DeleteOutlined />}>
              Archive
            </Button>
          </Popconfirm>
        </Space>
      )
    }
  ]

  return (
    <>
      <Button
        type="primary"
        icon={<PlusOutlined />}
        onClick={handleCreate}
        style={{ marginBottom: '16px' }}
      >
        Create Tier
      </Button>

      <Table
        rowKey="id"
        dataSource={tiers}
        columns={columns}
        loading={loading}
        size="small"
        pagination={{ pageSize: 20 }}
        scroll={{ x: 1000 }}
      />

      <Modal
        title={editingId ? 'Edit Tier' : 'Create Tier'}
        open={modalOpen}
        onOk={() => form.submit()}
        onCancel={() => setModalOpen(false)}
        width={600}
      >
        <Form form={form} layout="vertical" onFinish={handleSave}>
          <Form.Item
            label="Amount (₹)"
            name="amount"
            rules={[
              { required: true, message: 'Amount is required' },
              { type: 'number', min: 1, message: 'Amount must be at least 1' }
            ]}
          >
            <InputNumber min={1} placeholder="Enter amount in rupees" />
          </Form.Item>

          <Form.Item
            label="Draw Time (HH:mm)"
            name="draw_time"
            rules={[{ required: true, message: 'Draw time is required' }]}
          >
            <TimePicker format="HH:mm" placeholder="Select time" />
          </Form.Item>

          <Form.Item
            label="Status"
            name="status"
            initialValue="active"
            rules={[{ required: true, message: 'Status is required' }]}
          >
            <Select
              options={[
                { label: 'Active', value: 'active' },
                { label: 'Paused', value: 'paused' },
                { label: 'Archived', value: 'archived' }
              ]}
            />
          </Form.Item>

          <Form.Item
            label="Default Prize Tiers"
            name="default_prize_tiers"
            initialValue={[]}
          >
            <Form.List name="default_prize_tiers">
              {(fields, { add, remove }) => (
                <>
                  {fields.map((field, index) => (
                    <div key={field.key} style={{ marginBottom: '12px', padding: '12px', backgroundColor: '#f5f5f5', borderRadius: '4px' }}>
                      <Form.Item
                        {...field}
                        name={[field.name, 'match_type']}
                        label="Match Type"
                        rules={[{ required: true, message: 'Match type required' }]}
                      >
                        <Select
                          options={[
                            { label: 'Exact Match', value: 'exact' },
                            { label: 'Last 3 Digits', value: 'last_3' },
                            { label: 'Last 2 Digits', value: 'last_2' },
                            { label: 'Last 1 Digit', value: 'last_1' }
                          ]}
                        />
                      </Form.Item>

                      <Form.Item
                        {...field}
                        name={[field.name, 'outcome_type']}
                        label="Outcome Type"
                        rules={[{ required: true, message: 'Outcome type required' }]}
                      >
                        <Select
                          options={[
                            { label: 'Cash', value: 'cash' },
                            { label: 'Coupon', value: 'coupon' }
                          ]}
                        />
                      </Form.Item>

                      <Form.Item
                        {...field}
                        name={[field.name, 'multiplier']}
                        label="Multiplier"
                        rules={[{ type: 'number', min: 0.1, message: 'Multiplier must be positive' }]}
                      >
                        <InputNumber min={0.1} step={0.1} placeholder="e.g., 10 for 10x" />
                      </Form.Item>

                      <Button danger size="small" onClick={() => remove(field.name)}>
                        Remove
                      </Button>
                    </div>
                  ))}

                  <Button type="dashed" onClick={() => add()} block style={{ marginTop: '8px' }}>
                    + Add Prize Tier
                  </Button>
                </>
              )}
            </Form.List>
          </Form.Item>
        </Form>
      </Modal>
    </>
  )
}
