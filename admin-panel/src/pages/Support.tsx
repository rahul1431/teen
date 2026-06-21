import { useEffect, useState } from 'react'
import {
  Card, Tabs, Table, Tag, Button, Modal, Form, Input, Select, Space, message, Popconfirm,
  Switch, InputNumber, Drawer, Typography, Divider, Badge, Empty,
} from 'antd'
import { MessageOutlined, FileTextOutlined, NotificationOutlined, PlusOutlined } from '@ant-design/icons'
import { adminApi } from '../api/client'

const statusColor: Record<string, string> = {
  open: 'red', in_progress: 'orange', resolved: 'green', closed: 'default',
}
const priorityColor: Record<string, string> = {
  urgent: 'red', high: 'volcano', normal: 'blue', low: 'default',
}

function TicketsTab() {
  const [tickets, setTickets] = useState<any[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [statusFilter, setStatusFilter] = useState<string | undefined>()
  const [loading, setLoading] = useState(false)
  const [drawerTicket, setDrawerTicket] = useState<any>(null)
  const [drawerMessages, setDrawerMessages] = useState<any[]>([])
  const [replyBody, setReplyBody] = useState('')
  const [replyInternal, setReplyInternal] = useState(false)

  const load = (p = page) => {
    setLoading(true)
    adminApi.get('/support/tickets', { params: { page: p, limit: 20, status: statusFilter } })
      .then(r => { setTickets(r.data.tickets); setTotal(r.data.total) })
      .finally(() => setLoading(false))
  }

  useEffect(() => { load(1); setPage(1) }, [statusFilter])

  const openTicket = async (id: string) => {
    const r = await adminApi.get(`/support/tickets/${id}`)
    setDrawerTicket(r.data.ticket)
    setDrawerMessages(r.data.messages)
  }

  const sendReply = async () => {
    if (!replyBody.trim()) return
    try {
      await adminApi.post(`/support/tickets/${drawerTicket.id}/messages`, { body: replyBody, is_internal: replyInternal })
      setReplyBody(''); setReplyInternal(false)
      openTicket(drawerTicket.id)
      load()
    } catch (e: any) {
      message.error(e.response?.data?.error || 'Failed')
    }
  }

  const updateTicket = async (patch: any) => {
    try {
      await adminApi.patch(`/support/tickets/${drawerTicket.id}`, patch)
      message.success('Updated')
      openTicket(drawerTicket.id)
      load()
    } catch (e: any) {
      message.error(e.response?.data?.error || 'Failed')
    }
  }

  const columns = [
    { title: 'Subject', dataIndex: 'subject', render: (v: string, r: any) =>
      <Button type="link" size="small" onClick={() => openTicket(r.id)}>{v}</Button> },
    { title: 'User', dataIndex: 'username', render: (v: string) => v || <Typography.Text type="secondary">—</Typography.Text> },
    { title: 'Category', dataIndex: 'category' },
    { title: 'Priority', dataIndex: 'priority', render: (v: string) => <Tag color={priorityColor[v]}>{v}</Tag> },
    { title: 'Status', dataIndex: 'status', render: (v: string) => <Tag color={statusColor[v]}>{v.replace('_', ' ')}</Tag> },
    { title: 'Messages', dataIndex: 'message_count', render: (v: number) => <Badge count={v} showZero style={{ backgroundColor: v > 0 ? '#1890ff' : '#bbb' }} /> },
    { title: 'Assigned', dataIndex: 'assigned_to_username', render: (v: string) => v || <Typography.Text type="secondary">unassigned</Typography.Text> },
    { title: 'Created', dataIndex: 'created_at', render: (v: string) => new Date(v).toLocaleString() },
  ]

  return (
    <>
      <Space style={{ marginBottom: 12 }}>
        <Select
          allowClear placeholder="Filter status" style={{ width: 180 }}
          value={statusFilter} onChange={setStatusFilter}
          options={[
            { value: 'open', label: 'Open' },
            { value: 'in_progress', label: 'In Progress' },
            { value: 'resolved', label: 'Resolved' },
            { value: 'closed', label: 'Closed' },
          ]}
        />
        <Button onClick={() => load()}>Refresh</Button>
      </Space>
      <Table
        dataSource={tickets} columns={columns} rowKey="id" loading={loading} size="small"
        pagination={{ current: page, pageSize: 20, total, onChange: (p) => { setPage(p); load(p) } }}
      />

      <Drawer
        title={drawerTicket?.subject} open={!!drawerTicket} onClose={() => setDrawerTicket(null)}
        width={680}
        extra={
          drawerTicket && (
            <Space>
              <Select value={drawerTicket.priority} style={{ width: 110 }}
                onChange={(v) => updateTicket({ priority: v })}
                options={['low','normal','high','urgent'].map(p => ({ value: p, label: p }))} />
              <Select value={drawerTicket.status} style={{ width: 140 }}
                onChange={(v) => updateTicket({ status: v })}
                options={['open','in_progress','resolved','closed'].map(s => ({ value: s, label: s.replace('_',' ') }))} />
            </Space>
          )
        }
      >
        {drawerTicket && (
          <>
            <Typography.Paragraph type="secondary" style={{ marginBottom: 8 }}>
              From: <strong>{drawerTicket.username || 'unknown'}</strong>
              {drawerTicket.email && ` · ${drawerTicket.email}`}
              {drawerTicket.phone && ` · ${drawerTicket.phone}`}
              {' '}· Category: <Tag>{drawerTicket.category}</Tag>
            </Typography.Paragraph>
            <Divider />
            {drawerMessages.length === 0 ? <Empty description="No messages yet" /> : (
              <div style={{ maxHeight: 360, overflowY: 'auto', marginBottom: 16 }}>
                {drawerMessages.map((m: any) => (
                  <div key={m.id} style={{
                    padding: 10, marginBottom: 8, borderRadius: 6,
                    background: m.is_internal ? '#fffbe6' : m.sender_type === 'admin' ? '#e6f4ff' : '#f6ffed',
                    border: m.is_internal ? '1px dashed #d4af37' : '1px solid #f0f0f0',
                  }}>
                    <div style={{ fontSize: 11, color: '#666', marginBottom: 4 }}>
                      <strong>{m.sender_username || m.sender_type}</strong> · {new Date(m.created_at).toLocaleString()}
                      {m.is_internal && <Tag color="gold" style={{ marginLeft: 6 }}>INTERNAL</Tag>}
                    </div>
                    <div style={{ whiteSpace: 'pre-wrap' }}>{m.body}</div>
                  </div>
                ))}
              </div>
            )}
            <Divider>Reply</Divider>
            <Input.TextArea rows={4} value={replyBody} onChange={(e) => setReplyBody(e.target.value)}
              placeholder="Type your reply..." />
            <div style={{ marginTop: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <Space>
                <Switch checked={replyInternal} onChange={setReplyInternal} />
                <span>Internal note (not visible to user)</span>
              </Space>
              <Button type="primary" onClick={sendReply}>Send Reply</Button>
            </div>
          </>
        )}
      </Drawer>
    </>
  )
}

function PagesTab() {
  const [pages, setPages] = useState<any[]>([])
  const [editing, setEditing] = useState<any>(null)
  const [creating, setCreating] = useState(false)
  const [form] = Form.useForm()

  const load = () => adminApi.get('/cms/pages').then(r => setPages(r.data))
  useEffect(() => { load() }, [])

  const openEdit = async (slug: string) => {
    const r = await adminApi.get(`/cms/pages/${slug}`)
    setEditing(r.data)
    form.setFieldsValue(r.data)
  }

  const save = async () => {
    const v = await form.validateFields()
    try {
      if (creating) {
        await adminApi.post('/cms/pages', v)
        message.success('Page created')
      } else {
        await adminApi.patch(`/cms/pages/${editing.slug}`, v)
        message.success('Page updated')
      }
      setEditing(null); setCreating(false); form.resetFields()
      load()
    } catch (e: any) {
      message.error(e.response?.data?.error || 'Failed')
    }
  }

  const remove = async (slug: string) => {
    try {
      await adminApi.delete(`/cms/pages/${slug}`)
      message.success('Deleted')
      load()
    } catch (e: any) {
      message.error(e.response?.data?.error || 'Failed (requires superadmin)')
    }
  }

  const columns = [
    { title: 'Slug', dataIndex: 'slug', render: (v: string) => <Typography.Text code>{v}</Typography.Text> },
    { title: 'Title', dataIndex: 'title' },
    { title: 'Published', dataIndex: 'is_published', render: (v: boolean) => v ? <Tag color="green">live</Tag> : <Tag>draft</Tag> },
    { title: 'Updated', dataIndex: 'updated_at', render: (v: string) => new Date(v).toLocaleString() },
    { title: 'By', dataIndex: 'updated_by_username' },
    { title: 'Actions', render: (_: any, r: any) =>
      <Space size="small">
        <Button size="small" onClick={() => openEdit(r.slug)}>Edit</Button>
        <Popconfirm title="Delete this page?" onConfirm={() => remove(r.slug)}>
          <Button size="small" danger>Delete</Button>
        </Popconfirm>
      </Space> },
  ]

  return (
    <>
      <Button type="primary" icon={<PlusOutlined />} style={{ marginBottom: 12 }}
        onClick={() => { setCreating(true); setEditing({}); form.resetFields() }}>New Page</Button>
      <Table dataSource={pages} columns={columns} rowKey="slug" size="small" pagination={false} />

      <Modal
        open={!!editing} onCancel={() => { setEditing(null); setCreating(false); form.resetFields() }}
        onOk={save} okText="Save" width={720}
        title={creating ? 'New CMS Page' : `Edit: ${editing?.slug}`}
      >
        <Form form={form} layout="vertical">
          {creating && (
            <Form.Item name="slug" label="Slug (lowercase, dashes only)" rules={[{ required: true, pattern: /^[a-z0-9-]+$/, message: 'Lowercase letters/numbers/dashes only' }]}>
              <Input placeholder="e.g. how-to-play" />
            </Form.Item>
          )}
          <Form.Item name="title" label="Title" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="body_md" label="Body (Markdown)" rules={[{ required: true }]}>
            <Input.TextArea rows={14} style={{ fontFamily: 'monospace' }} />
          </Form.Item>
          <Form.Item name="is_published" label="Published" valuePropName="checked" initialValue={true}>
            <Switch />
          </Form.Item>
        </Form>
      </Modal>
    </>
  )
}

function BannersTab() {
  const [banners, setBanners] = useState<any[]>([])
  const [editing, setEditing] = useState<any>(null)
  const [creating, setCreating] = useState(false)
  const [form] = Form.useForm()

  const load = () => adminApi.get('/cms/banners').then(r => setBanners(r.data))
  useEffect(() => { load() }, [])

  const save = async () => {
    const v = await form.validateFields()
    try {
      if (creating) {
        await adminApi.post('/cms/banners', v)
        message.success('Banner created')
      } else {
        await adminApi.patch(`/cms/banners/${editing.id}`, v)
        message.success('Banner updated')
      }
      setEditing(null); setCreating(false); form.resetFields()
      load()
    } catch (e: any) {
      message.error(e.response?.data?.error || 'Failed')
    }
  }

  const toggleActive = async (id: string, is_active: boolean) => {
    await adminApi.patch(`/cms/banners/${id}`, { is_active })
    load()
  }

  const remove = async (id: string) => {
    await adminApi.delete(`/cms/banners/${id}`)
    load()
  }

  const columns = [
    { title: 'Title', dataIndex: 'title' },
    { title: 'Placement', dataIndex: 'placement', render: (v: string) => <Tag>{v}</Tag> },
    { title: 'Priority', dataIndex: 'priority' },
    { title: 'Active', dataIndex: 'is_active', render: (v: boolean, r: any) =>
      <Switch checked={v} onChange={(c) => toggleActive(r.id, c)} /> },
    { title: 'CTA', dataIndex: 'cta_label', render: (v: string, r: any) =>
      v ? <a href={r.cta_url} target="_blank" rel="noopener noreferrer">{v}</a> : '—' },
    { title: 'Window', render: (_: any, r: any) =>
      r.starts_at || r.ends_at
        ? <span style={{ fontSize: 11 }}>{r.starts_at ? new Date(r.starts_at).toLocaleDateString() : '…'} → {r.ends_at ? new Date(r.ends_at).toLocaleDateString() : '…'}</span>
        : <Typography.Text type="secondary">always</Typography.Text> },
    { title: 'Actions', render: (_: any, r: any) =>
      <Space size="small">
        <Button size="small" onClick={() => { setEditing(r); form.setFieldsValue(r) }}>Edit</Button>
        <Popconfirm title="Delete this banner?" onConfirm={() => remove(r.id)}>
          <Button size="small" danger>Delete</Button>
        </Popconfirm>
      </Space> },
  ]

  return (
    <>
      <Button type="primary" icon={<PlusOutlined />} style={{ marginBottom: 12 }}
        onClick={() => { setCreating(true); setEditing({}); form.resetFields() }}>New Banner</Button>
      <Table dataSource={banners} columns={columns} rowKey="id" size="small" pagination={{ pageSize: 20 }} />

      <Modal
        open={!!editing} onCancel={() => { setEditing(null); setCreating(false); form.resetFields() }}
        onOk={save} okText="Save" width={640}
        title={creating ? 'New Banner' : 'Edit Banner'}
      >
        <Form form={form} layout="vertical">
          <Form.Item name="title" label="Title" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="body" label="Body"><Input.TextArea rows={3} /></Form.Item>
          <Form.Item name="image_url" label="Image URL"><Input placeholder="https://..." /></Form.Item>
          <Space style={{ width: '100%' }}>
            <Form.Item name="cta_label" label="CTA Label" style={{ minWidth: 180 }}><Input /></Form.Item>
            <Form.Item name="cta_url" label="CTA URL" style={{ minWidth: 280 }}><Input /></Form.Item>
          </Space>
          <Space style={{ width: '100%' }}>
            <Form.Item name="placement" label="Placement" initialValue="home" style={{ minWidth: 160 }}>
              <Select options={['home','lobby','wallet','promo'].map(v => ({ value: v, label: v }))} />
            </Form.Item>
            <Form.Item name="priority" label="Priority" initialValue={0} style={{ minWidth: 120 }}>
              <InputNumber min={0} max={100} />
            </Form.Item>
            <Form.Item name="is_active" label="Active" valuePropName="checked" initialValue={true}>
              <Switch />
            </Form.Item>
          </Space>
        </Form>
      </Modal>
    </>
  )
}

export default function Support() {
  return (
    <Card title="Support & CMS">
      <Tabs defaultActiveKey="tickets" items={[
        { key: 'tickets', label: <><MessageOutlined /> Tickets</>, children: <TicketsTab /> },
        { key: 'pages', label: <><FileTextOutlined /> CMS Pages</>, children: <PagesTab /> },
        { key: 'banners', label: <><NotificationOutlined /> Banners</>, children: <BannersTab /> },
      ]} />
    </Card>
  )
}
