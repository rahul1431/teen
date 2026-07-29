import { useEffect, useState } from 'react'
import {
  Card, Form, InputNumber, Select, Button, Table, Tag,
  Space, Modal, Input, message, Switch
} from 'antd'
import { ReloadOutlined, PlusOutlined } from '@ant-design/icons'
import { adminApi } from '../../api/client'
import dayjs from 'dayjs'

const OUTCOME_COLORS: Record<string, string> = { cash: 'green', coupon: 'purple', no_win: 'default' }

export default function LotteryScratch() {
  const [products, setProducts] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [promoCodes, setPromoCodes] = useState<any[]>([])
  const [createOpen, setCreateOpen] = useState(false)
  const [form] = Form.useForm()

  const loadProducts = () => {
    setLoading(true)
    adminApi.get('/betting/lottery/scratch/products')
      .then(r => setProducts(r.data.products || []))
      .finally(() => setLoading(false))
  }

  const loadPromoCodes = () => {
    adminApi.get('/promo-codes')
      .then(r => setPromoCodes((r.data || []).filter((p: any) => p.is_active)))
      .catch(() => {})
  }

  useEffect(() => {
    loadProducts()
    loadPromoCodes()
  }, [])

  const create = async (v: any) => {
    const total = (v.payouts || []).reduce((sum: number, p: any) => sum + Number(p.probability || 0), 0)
    if (Math.abs(total - 100) > 0.01) {
      message.error(`Payout probabilities must sum to 100 (currently ${total})`)
      return
    }
    try {
      await adminApi.post('/betting/lottery/scratch/create', { name: v.name, price: v.price, payouts: v.payouts })
      message.success('Scratch card product created!')
      setCreateOpen(false)
      form.resetFields()
      loadProducts()
    } catch (e: any) {
      message.error(e?.response?.data?.error || 'Create failed')
    }
  }

  const toggleActive = async (id: string, isActive: boolean) => {
    try {
      await adminApi.patch(`/betting/lottery/scratch/products/${id}`, { is_active: isActive })
      message.success(isActive ? 'Product activated' : 'Product deactivated')
      loadProducts()
    } catch {
      message.error('Failed to update product')
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
        title={<span style={{ color: '#f3f4f6' }}>Scratch Card Products</span>}
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
              Create Product
            </Button>
            <Button icon={<ReloadOutlined />} onClick={loadProducts} style={{ borderRadius: '8px', background: 'transparent', borderColor: '#4b5563', color: '#9ca3af' }}>
              Refresh
            </Button>
          </Space>
        }
        loading={loading}
      >
        <Table
          rowKey="id"
          dataSource={products}
          size="small"
          pagination={{ pageSize: 8 }}
          scroll={{ x: 'max-content' }}
          columns={[
            { title: 'Name', dataIndex: 'name', render: (n) => <span style={{ fontWeight: 600, color: '#f9fafb' }}>{n}</span> },
            { title: 'Price', dataIndex: 'price', render: (v: any) => <span style={{ color: '#34d399', fontWeight: 600 }}>₹{Number(v).toFixed(0)}</span> },
            {
              title: 'Payouts',
              dataIndex: 'payouts',
              render: (payouts: any[]) => (
                <Space wrap size={4}>
                  {(payouts || []).map((p, i) => (
                    <Tag key={i} color={OUTCOME_COLORS[p.outcome]} style={{ fontWeight: 'bold', fontSize: 10 }}>
                      {p.outcome === 'cash' ? `₹${p.amount}` : p.outcome === 'coupon' ? 'Coupon' : 'No Win'}: {p.probability}%
                    </Tag>
                  ))}
                </Space>
              )
            },
            { title: 'Sold', dataIndex: 'tickets_sold', render: (v) => <span style={{ fontWeight: 'bold' }}>{v || 0}</span> },
            { title: 'Revenue', dataIndex: 'total_revenue', render: (v) => <span>₹{Number(v || 0).toFixed(0)}</span> },
            { title: 'Paid Out', dataIndex: 'total_paid', render: (v) => <span style={{ color: '#f87171' }}>₹{Number(v || 0).toFixed(0)}</span> },
            {
              title: 'Active',
              dataIndex: 'is_active',
              render: (active: boolean, record: any) => (
                <Switch checked={active} onChange={(checked) => toggleActive(record.id, checked)} />
              )
            },
            { title: 'Created', dataIndex: 'created_at', render: (v: string) => dayjs(v).format('DD MMM YY') },
          ]}
        />
      </Card>

      <Modal
        open={createOpen}
        title="Create Scratch Card Product"
        onCancel={() => setCreateOpen(false)}
        onOk={() => form.submit()}
        okText="Create Product"
        width={640}
      >
        <Form form={form} layout="vertical" onFinish={create} style={{ marginTop: '16px' }}>
          <Form.Item name="name" label="Product Name" rules={[{ required: true, message: 'Please enter a name' }]}>
            <Input placeholder="e.g., ₹10 Lucky Scratch" />
          </Form.Item>
          <Form.Item name="price" label="Price (₹)" rules={[{ required: true }]} initialValue={10}>
            <InputNumber min={1} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item label="Payouts" required tooltip="Probabilities across all payout rows must sum to exactly 100.">
            <Form.List name="payouts" initialValue={[{ outcome: 'no_win', probability: 100 }]}>
              {(fields, { add, remove }) => (
                <>
                  {fields.map(({ key, name, ...restField }) => (
                    <Form.Item key={key} noStyle shouldUpdate>
                      {() => (
                        <Space style={{ display: 'flex', marginBottom: 12 }} align="baseline">
                          <Form.Item {...restField} name={[name, 'outcome']} rules={[{ required: true }]} style={{ marginBottom: 0 }}>
                            <Select style={{ width: 130 }} options={[
                              { value: 'cash', label: 'Cash' },
                              { value: 'coupon', label: 'Coupon' },
                              { value: 'no_win', label: 'No Win' },
                            ]} />
                          </Form.Item>
                          <Form.Item noStyle shouldUpdate={(prev, cur) => prev.payouts?.[name]?.outcome !== cur.payouts?.[name]?.outcome}>
                            {({ getFieldValue }) => {
                              const outcome = getFieldValue(['payouts', name, 'outcome'])
                              if (outcome === 'cash') {
                                return (
                                  <Form.Item {...restField} name={[name, 'amount']} rules={[{ required: true, message: 'Amount required' }]} style={{ marginBottom: 0 }}>
                                    <InputNumber min={1} placeholder="Amount (₹)" style={{ width: 130 }} />
                                  </Form.Item>
                                )
                              }
                              if (outcome === 'coupon') {
                                return (
                                  <Form.Item {...restField} name={[name, 'promo_code_id']} rules={[{ required: true, message: 'Promo code required' }]} style={{ marginBottom: 0 }}>
                                    <Select style={{ width: 160 }} placeholder="Promo code" options={promoCodes.map(p => ({ value: p.id, label: p.code }))} />
                                  </Form.Item>
                                )
                              }
                              return null
                            }}
                          </Form.Item>
                          <Form.Item {...restField} name={[name, 'probability']} rules={[{ required: true, message: 'Probability required' }]} style={{ marginBottom: 0 }}>
                            <InputNumber min={0} max={100} placeholder="Probability" style={{ width: 120 }} formatter={(v) => `${v}%`} />
                          </Form.Item>
                          {fields.length > 1 ? <Button danger onClick={() => remove(name)}>Remove</Button> : null}
                        </Space>
                      )}
                    </Form.Item>
                  ))}
                  <Form.Item style={{ marginTop: '8px' }}>
                    <Button type="dashed" onClick={() => add()} block icon={<PlusOutlined />}>
                      Add Payout
                    </Button>
                  </Form.Item>
                </>
              )}
            </Form.List>
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}
