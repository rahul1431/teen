import { useEffect, useState } from 'react'
import { Card, Table, Button, Modal, Form, Input, Select, Space, Tag, message, Popconfirm } from 'antd'
import { PlusOutlined, EditOutlined, DeleteOutlined, SendOutlined } from '@ant-design/icons'
import { adminApi } from '../api/client'

interface Template {
  id: string
  name: string
  title: string
  body: string
  type: string
  route?: string | null
  image_url?: string | null
  action_buttons?: any
  created_at: string
}

export function NotificationTemplatesTab({ onSelectTemplate }: { onSelectTemplate?: (tpl: Template) => void }) {
  const [templates, setTemplates] = useState<Template[]>([])
  const [loading, setLoading] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [editingTemplate, setEditingTemplate] = useState<Template | null>(null)
  const [form] = Form.useForm()

  useEffect(() => {
    fetchTemplates()
  }, [])

  async function fetchTemplates() {
    setLoading(true)
    try {
      const res = await adminApi.get('/notifications/templates')
      setTemplates(res.data)
    } catch {
      message.error('Failed to load templates')
    } finally {
      setLoading(false)
    }
  }

  const handleOpenCreate = () => {
    setEditingTemplate(null)
    form.resetFields()
    setModalOpen(true)
  }

  const handleOpenEdit = (tpl: Template) => {
    setEditingTemplate(tpl)
    form.setFieldsValue({
      name: tpl.name,
      title: tpl.title,
      body: tpl.body,
      type: tpl.type || 'general',
      route: tpl.route,
      image_url: tpl.image_url,
    })
    setModalOpen(true)
  }

  const handleDelete = async (id: string) => {
    try {
      await adminApi.delete(`/notifications/templates/${id}`)
      message.success('Template deleted')
      fetchTemplates()
    } catch {
      message.error('Failed to delete template')
    }
  }

  const handleSubmit = async (values: any) => {
    try {
      if (editingTemplate) {
        await adminApi.put(`/notifications/templates/${editingTemplate.id}`, values)
        message.success('Template updated!')
      } else {
        await adminApi.post('/notifications/templates', values)
        message.success('Template created!')
      }
      setModalOpen(false)
      fetchTemplates()
    } catch {
      message.error('Failed to save template')
    }
  }

  const columns = [
    {
      title: 'Template Name',
      dataIndex: 'name',
      render: (v: string, row: Template) => (
        <div>
          <b>{v}</b>
          {row.image_url && <span style={{ marginLeft: 6 }}>🖼️</span>}
        </div>
      ),
    },
    {
      title: 'Type',
      dataIndex: 'type',
      render: (v: string) => <Tag color={v === 'promotion' ? 'gold' : v === 'wallet' ? 'green' : 'blue'}>{(v || 'general').toUpperCase()}</Tag>,
    },
    {
      title: 'Title & Body Preview',
      dataIndex: 'title',
      render: (_: any, row: Template) => (
        <div>
          <div style={{ fontWeight: 600, color: '#e6e6e6' }}>{row.title}</div>
          <div style={{ fontSize: 12, color: '#8c8c8c', maxWidth: 360, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {row.body}
          </div>
        </div>
      ),
    },
    {
      title: 'Deep Link',
      dataIndex: 'route',
      render: (v: string) => (v ? <Tag color="cyan">{v}</Tag> : <span style={{ color: '#666' }}>None</span>),
    },
    {
      title: 'Actions',
      key: 'actions',
      render: (_: any, row: Template) => (
        <Space size={8}>
          {onSelectTemplate && (
            <Button
              type="primary"
              size="small"
              icon={<SendOutlined />}
              onClick={() => onSelectTemplate(row)}
            >
              Use
            </Button>
          )}
          <Button
            size="small"
            icon={<EditOutlined />}
            onClick={() => handleOpenEdit(row)}
          >
            Edit
          </Button>
          <Popconfirm
            title="Delete this template?"
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
    <Card
      title="Notification Templates & Presets"
      extra={
        <Button type="primary" icon={<PlusOutlined />} onClick={handleOpenCreate}>
          New Template
        </Button>
      }
    >
      <Table
        dataSource={templates}
        columns={columns as any}
        rowKey="id"
        loading={loading}
        pagination={{ pageSize: 10 }}
      />

      <Modal
        title={editingTemplate ? 'Edit Notification Template' : 'Create Notification Template'}
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={() => form.submit()}
        okText={editingTemplate ? 'Save Changes' : 'Create Template'}
      >
        <Form form={form} layout="vertical" onFinish={handleSubmit}>
          <Form.Item name="name" label="Template Identifier" rules={[{ required: true }]}>
            <Input placeholder="e.g. VIP Win-back Promo 50%" />
          </Form.Item>

          <Form.Item name="type" label="Category / Type" initialValue="promotion">
            <Select>
              <Select.Option value="general">General</Select.Option>
              <Select.Option value="promotion">Promotion</Select.Option>
              <Select.Option value="wallet">Wallet / Cashier</Select.Option>
              <Select.Option value="game_result">Game Result</Select.Option>
            </Select>
          </Form.Item>

          <Form.Item name="title" label="Notification Title" rules={[{ required: true }]}>
            <Input placeholder="e.g. Claim Your Exclusive Bonus, {{username}}!" />
          </Form.Item>

          <Form.Item name="body" label="Message Body" rules={[{ required: true }]}>
            <Input.TextArea rows={3} placeholder="Use tags like {{username}} and {{balance}}" />
          </Form.Item>

          <Form.Item name="image_url" label="Rich Image URL (optional)">
            <Input placeholder="https://domain.com/banner.png" />
          </Form.Item>

          <Form.Item name="route" label="Target Deep Link Route (optional)">
            <Input placeholder="e.g. /wallet, /games/teen-patti, /home" />
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  )
}
