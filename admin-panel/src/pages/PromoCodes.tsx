import { useEffect, useState } from 'react'
import {
  Card, Button, Table, Switch, InputNumber, Space, Typography, Tag,
  message, Modal, Form, Input, Select, DatePicker, Statistic, Row, Col, Tooltip,
} from 'antd'
import {
  PlusOutlined, EditOutlined, DeleteOutlined, TagOutlined,
  CopyOutlined, CheckCircleOutlined,
} from '@ant-design/icons'
import dayjs from 'dayjs'
import { useAuthStore } from '../store/auth'

const { Title, Text } = Typography

interface PromoCode {
  id: string
  code: string
  description: string
  discount_type: 'fixed' | 'percent'
  discount_value: number
  min_deposit: number
  max_discount: number | null
  usage_limit: number | null
  used_count: number
  per_user_limit: number
  is_active: boolean
  expires_at: string | null
  created_at: string
}

export default function PromoCodes() {
  const { token } = useAuthStore()
  const [codes, setCodes] = useState<PromoCode[]>([])
  const [loading, setLoading] = useState(true)
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<PromoCode | null>(null)
  const [saving, setSaving] = useState(false)
  const [form] = Form.useForm()

  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }

  const load = async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/admin/promo-codes', { headers })
      setCodes(await res.json())
    } catch { message.error('Failed to load promo codes') }
    finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])

  const openCreate = () => {
    setEditing(null)
    form.resetFields()
    setModalOpen(true)
  }

  const openEdit = (p: PromoCode) => {
    setEditing(p)
    form.setFieldsValue({
      ...p,
      expires_at: p.expires_at ? dayjs(p.expires_at) : null,
    })
    setModalOpen(true)
  }

  const save = async () => {
    const values = await form.validateFields()
    const payload = {
      ...values,
      code: (values.code as string).toUpperCase(),
      expires_at: values.expires_at ? values.expires_at.toISOString() : null,
    }
    setSaving(true)
    try {
      const url = editing ? `/api/admin/promo-codes/${editing.id}` : '/api/admin/promo-codes'
      const res = await fetch(url, {
        method: editing ? 'PUT' : 'POST',
        headers,
        body: JSON.stringify(payload),
      })
      if (!res.ok) throw new Error(await res.text())
      message.success('Saved!')
      setModalOpen(false)
      load()
    } catch (e: any) {
      message.error(e.message || 'Save failed')
    } finally { setSaving(false) }
  }

  const remove = (id: string) => {
    Modal.confirm({
      title: 'Delete this promo code?',
      onOk: async () => {
        await fetch(`/api/admin/promo-codes/${id}`, { method: 'DELETE', headers })
        message.success('Deleted')
        load()
      },
    })
  }

  const toggle = async (p: PromoCode) => {
    await fetch(`/api/admin/promo-codes/${p.id}`, {
      method: 'PUT', headers,
      body: JSON.stringify({ is_active: !p.is_active }),
    })
    load()
  }

  const copyCode = (code: string) => {
    navigator.clipboard.writeText(code)
    message.success(`Copied "${code}"`)
  }

  const active = codes.filter(c => c.is_active)
  const totalUsed = codes.reduce((s, c) => s + c.used_count, 0)

  const columns = [
    {
      title: 'Code',
      dataIndex: 'code',
      render: (code: string, p: PromoCode) => (
        <Space>
          <Tag color={p.is_active ? 'gold' : 'default'}
            style={{ fontWeight: 900, fontSize: 13, letterSpacing: 1 }}>
            {code}
          </Tag>
          <Tooltip title="Copy code">
            <Button type="text" size="small" icon={<CopyOutlined />} onClick={() => copyCode(code)} />
          </Tooltip>
        </Space>
      ),
    },
    {
      title: 'Discount',
      render: (_: any, p: PromoCode) => (
        <Space direction="vertical" size={0}>
          <Text style={{ color: '#00c853', fontWeight: 700 }}>
            {p.discount_type === 'percent'
              ? `${p.discount_value}% off`
              : `₹${p.discount_value} bonus`}
          </Text>
          {p.max_discount && <Text style={{ color: '#8b949e', fontSize: 11 }}>Max ₹{p.max_discount}</Text>}
          {p.min_deposit > 0 && <Text style={{ color: '#8b949e', fontSize: 11 }}>Min deposit ₹{p.min_deposit}</Text>}
        </Space>
      ),
    },
    {
      title: 'Usage',
      render: (_: any, p: PromoCode) => (
        <Space direction="vertical" size={0}>
          <Text style={{ color: '#fff' }}>
            {p.used_count}{p.usage_limit ? ` / ${p.usage_limit}` : ' uses'}
          </Text>
          <Text style={{ color: '#8b949e', fontSize: 11 }}>
            Max {p.per_user_limit}× per user
          </Text>
        </Space>
      ),
    },
    {
      title: 'Expires',
      dataIndex: 'expires_at',
      render: (v: string | null) => {
        if (!v) return <Tag>Never</Tag>
        const expired = new Date(v) < new Date()
        return <Tag color={expired ? 'red' : 'blue'}>{expired ? 'Expired ' : ''}{dayjs(v).format('DD MMM YYYY')}</Tag>
      },
    },
    {
      title: 'Active',
      dataIndex: 'is_active',
      width: 80,
      render: (v: boolean, p: PromoCode) => <Switch checked={v} size="small" onChange={() => toggle(p)} />,
    },
    {
      title: '',
      width: 100,
      render: (_: any, p: PromoCode) => (
        <Space>
          <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(p)} />
          <Button size="small" danger icon={<DeleteOutlined />} onClick={() => remove(p.id)} />
        </Space>
      ),
    },
  ]

  return (
    <div style={{ padding: 24, background: '#0d1117', minHeight: '100vh' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
        <div>
          <Title level={3} style={{ color: '#fff', margin: 0 }}>
            <TagOutlined style={{ color: '#d4af37', marginRight: 10 }} />
            Promo Codes
          </Title>
          <Text style={{ color: '#8b949e' }}>
            Create and manage deposit bonus promo codes
          </Text>
        </div>
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}
          style={{ background: '#d4af37', borderColor: '#d4af37', color: '#000', fontWeight: 700 }}>
          Create Code
        </Button>
      </div>

      <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
        <Col xs={24} sm={8}>
          <Card style={{ background: '#161b22', border: '1px solid #30363d' }}>
            <Statistic title={<Text style={{ color: '#8b949e' }}>Total Codes</Text>}
              value={codes.length} valueStyle={{ color: '#fff' }} />
          </Card>
        </Col>
        <Col xs={24} sm={8}>
          <Card style={{ background: '#161b22', border: '1px solid #30363d' }}>
            <Statistic title={<Text style={{ color: '#8b949e' }}>Active</Text>}
              value={active.length} prefix={<CheckCircleOutlined style={{ color: '#00c853' }} />}
              valueStyle={{ color: '#00c853' }} />
          </Card>
        </Col>
        <Col xs={24} sm={8}>
          <Card style={{ background: '#161b22', border: '1px solid #30363d' }}>
            <Statistic title={<Text style={{ color: '#8b949e' }}>Total Uses</Text>}
              value={totalUsed} valueStyle={{ color: '#d4af37' }} />
          </Card>
        </Col>
      </Row>

      <Card style={{ background: '#161b22', border: '1px solid #30363d' }}>
        <Table
          dataSource={codes}
          columns={columns}
          rowKey="id"
          loading={loading}
          pagination={{ pageSize: 20 }}
          size="small"
          scroll={{ x: 'max-content' }}
        />
      </Card>

      <Modal
        title={<Text style={{ color: '#fff' }}>{editing ? 'Edit Promo Code' : 'Create Promo Code'}</Text>}
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={save}
        confirmLoading={saving}
        width={540}
        styles={{ body: { background: '#161b22' }, content: { background: '#161b22', border: '1px solid #30363d' }, header: { background: '#161b22', borderBottom: '1px solid #30363d' } }}
        okButtonProps={{ style: { background: '#d4af37', borderColor: '#d4af37', color: '#000' } }}
      >
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="code" label={<Text style={{ color: '#8b949e' }}>Code *</Text>}
                rules={[{ required: true, min: 3 }]}>
                <Input placeholder="WELCOME50" style={{ background: '#0d1117', color: '#fff', border: '1px solid #30363d', textTransform: 'uppercase' }} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="discount_type" label={<Text style={{ color: '#8b949e' }}>Discount Type *</Text>}
                initialValue="fixed" rules={[{ required: true }]}>
                <Select options={[
                  { value: 'fixed', label: '₹ Fixed Amount' },
                  { value: 'percent', label: '% Percentage' },
                ]} />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="discount_value" label={<Text style={{ color: '#8b949e' }}>Discount Value *</Text>}
                rules={[{ required: true }]}>
                <InputNumber min={1} style={{ width: '100%' }} placeholder="e.g. 50" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="max_discount" label={<Text style={{ color: '#8b949e' }}>Max Discount (₹)</Text>}>
                <InputNumber min={1} style={{ width: '100%' }} placeholder="e.g. 500" />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="min_deposit" label={<Text style={{ color: '#8b949e' }}>Min Deposit (₹)</Text>} initialValue={0}>
                <InputNumber min={0} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="per_user_limit" label={<Text style={{ color: '#8b949e' }}>Uses Per User</Text>} initialValue={1}>
                <InputNumber min={1} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="usage_limit" label={<Text style={{ color: '#8b949e' }}>Total Usage Limit</Text>}>
                <InputNumber min={1} style={{ width: '100%' }} placeholder="Unlimited" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="expires_at" label={<Text style={{ color: '#8b949e' }}>Expires At</Text>}>
                <DatePicker style={{ width: '100%' }} showTime />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="description" label={<Text style={{ color: '#8b949e' }}>Description</Text>}>
            <Input.TextArea rows={2} placeholder="e.g. Welcome bonus for new users" style={{ background: '#0d1117', color: '#fff', border: '1px solid #30363d' }} />
          </Form.Item>
          <Form.Item name="is_active" label={<Text style={{ color: '#8b949e' }}>Active</Text>} valuePropName="checked" initialValue={true}>
            <Switch />
          </Form.Item>
        </Form>
      </Modal>

      <style>{`
        .ant-table { background: transparent !important; }
        .ant-table-thead > tr > th { background: #0d1117 !important; color: #8b949e !important; border-bottom: 1px solid #30363d !important; }
        .ant-table-tbody > tr > td { background: transparent !important; color: #fff !important; border-bottom: 1px solid #1e2533 !important; }
        .ant-table-tbody > tr:hover > td { background: rgba(255,255,255,0.03) !important; }
        .ant-card-head { background: transparent !important; border-bottom: 1px solid #30363d !important; }
      `}</style>
    </div>
  )
}
