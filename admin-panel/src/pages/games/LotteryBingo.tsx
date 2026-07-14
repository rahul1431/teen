import { useEffect, useState } from 'react'
import { Card, Form, InputNumber, Select, Button, Table, Tag, Space, Modal, Input, DatePicker, message, Popconfirm } from 'antd'
import { ReloadOutlined, PlusOutlined } from '@ant-design/icons'
import { adminApi } from '../../api/client'
import dayjs from 'dayjs'

export default function LotteryBingo() {
  const [draws, setDraws] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [form] = Form.useForm()

  const loadDraws = () => {
    setLoading(true)
    adminApi.get('/betting/lottery/bingo/draws')
      .then(r => setDraws(r.data.draws || []))
      .finally(() => setLoading(false))
  }

  useEffect(() => { loadDraws() }, [])

  const create = async (v: any) => {
    try {
      await adminApi.post('/betting/lottery/bingo/create', {
        name: v.name, ticket_price: v.ticket_price,
        prize_tiers: v.prize_tiers, draw_time: v.draw_time.toISOString(),
      })
      message.success('Bingo draw created!')
      setCreateOpen(false)
      form.resetFields()
      loadDraws()
    } catch (e: any) {
      message.error(e?.response?.data?.error || 'Create failed')
    }
  }

  const cancelDraw = async (id: string) => {
    try {
      await adminApi.post(`/betting/lottery/bingo/cancel/${id}`)
      message.success('Draw cancelled, tickets refunded')
      loadDraws()
    } catch (e: any) {
      message.error(e?.response?.data?.error || 'Cancel failed')
    }
  }

  const cardStyle = {
    background: 'linear-gradient(145deg, #111827 0%, #1f2937 100%)',
    border: '1px solid #374151',
    borderRadius: '16px',
    color: '#f3f4f6'
  }

  return (
    <div style={{ padding: '4px 0' }}>
      <Card
        title={<span style={{ color: '#f3f4f6' }}>Daily Bingo Draws</span>}
        headStyle={{ borderBottom: '1px solid #374151' }}
        style={cardStyle}
        extra={
          <Space>
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => setCreateOpen(true)}
              style={{ borderRadius: '8px', background: 'linear-gradient(135deg, #059669 0%, #10b981 100%)', border: 'none', fontWeight: 600 }}
            >
              Create Draw
            </Button>
            <Button icon={<ReloadOutlined />} onClick={loadDraws} style={{ borderRadius: '8px', background: 'transparent', borderColor: '#4b5563', color: '#9ca3af' }}>
              Refresh
            </Button>
          </Space>
        }
        loading={loading}
      >
        <Table
          rowKey="id"
          dataSource={draws}
          size="small"
          pagination={{ pageSize: 8 }}
          columns={[
            { title: 'Name', dataIndex: 'name', render: (n) => <span style={{ fontWeight: 600, color: '#f9fafb' }}>{n}</span> },
            { title: 'Price', dataIndex: 'ticket_price', render: (v: any) => <span style={{ color: '#34d399', fontWeight: 600 }}>₹{Number(v).toFixed(0)}</span> },
            {
              title: 'Prize Tiers',
              dataIndex: 'prize_tiers',
              render: (tiers: any[]) => (
                <Space wrap size={4}>
                  {(tiers || []).map((t, i) => (
                    <Tag key={i} color="gold" style={{ fontWeight: 'bold', fontSize: 10 }}>
                      {t.match_type.replace('_', ' ')}: {t.multiplier}x
                    </Tag>
                  ))}
                </Space>
              )
            },
            { title: 'Sold', dataIndex: 'ticket_count', render: (v) => <span style={{ fontWeight: 'bold' }}>{v || 0}</span> },
            { title: 'Called', dataIndex: 'called_numbers', render: (v: any[]) => `${(v || []).length}/90` },
            { title: 'Draw Time', dataIndex: 'draw_time', render: (v: string) => dayjs(v).format('DD MMM YY · hh:mm A') },
            {
              title: 'Status',
              dataIndex: 'status',
              render: (s: string) => <Tag color={s === 'settled' ? 'default' : s === 'calling' ? 'processing' : s === 'cancelled' ? 'error' : 'success'} style={{ textTransform: 'uppercase', fontWeight: 'bold' }}>{s}</Tag>
            },
            { title: 'Paid Out', dataIndex: 'total_paid', render: (v) => <span style={{ color: '#34d399' }}>₹{Number(v || 0).toFixed(0)}</span> },
            {
              title: 'Action',
              render: (_: any, d: any) => d.status === 'open' ? (
                <Popconfirm title="Cancel Draw" description="Refund all tickets and cancel this draw?" onConfirm={() => cancelDraw(d.id)} okText="Cancel Draw" cancelText="Keep">
                  <Button danger size="small">Cancel</Button>
                </Popconfirm>
              ) : null
            },
          ]}
        />
      </Card>

      <Modal
        open={createOpen}
        title="Create Daily Bingo Draw"
        onCancel={() => setCreateOpen(false)}
        onOk={() => form.submit()}
        okText="Create Draw"
      >
        <Form form={form} layout="vertical" onFinish={create} style={{ marginTop: '16px' }}>
          <Form.Item name="name" label="Draw Name" rules={[{ required: true, message: 'Please enter a name' }]}>
            <Input placeholder="e.g., Evening Bingo" />
          </Form.Item>
          <Form.Item name="ticket_price" label="Ticket Price (₹)" rules={[{ required: true }]} initialValue={10}>
            <InputNumber min={1} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item label="Prize Tiers" required tooltip="Multiplier applies per tier, cumulative — a Full House winner also collects One Line and Two Lines.">
            <Form.List name="prize_tiers" initialValue={[
              { match_type: 'one_line', multiplier: 5 },
              { match_type: 'two_lines', multiplier: 15 },
              { match_type: 'full_house', multiplier: 100 },
            ]}>
              {(fields) => (
                <>
                  {fields.map(({ key, name, ...restField }) => (
                    <Space key={key} style={{ display: 'flex', marginBottom: 12 }} align="baseline">
                      <Form.Item {...restField} name={[name, 'match_type']} rules={[{ required: true }]} style={{ marginBottom: 0 }}>
                        <Select style={{ width: 160 }} options={[
                          { value: 'one_line', label: 'One Line' },
                          { value: 'two_lines', label: 'Two Lines' },
                          { value: 'full_house', label: 'Full House' },
                        ]} />
                      </Form.Item>
                      <Form.Item {...restField} name={[name, 'multiplier']} rules={[{ required: true, message: 'Missing multiplier' }]} style={{ marginBottom: 0 }}>
                        <InputNumber min={1} placeholder="Multiplier" style={{ width: 140 }} formatter={(v) => `${v}x`} />
                      </Form.Item>
                    </Space>
                  ))}
                </>
              )}
            </Form.List>
          </Form.Item>
          <Form.Item name="draw_time" label="Draw Time" rules={[{ required: true, message: 'Please select draw time' }]}>
            <DatePicker showTime style={{ width: '100%' }} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}
