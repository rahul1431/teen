import { useEffect, useState, useRef } from 'react'
import {
  Card, Tabs, Table, Tag, Button, Modal, Form, Input, Select, Space, message, Popconfirm,
  Switch, InputNumber, Drawer, Typography, Divider, Badge, Empty,
} from 'antd'
import { MessageOutlined, FileTextOutlined, NotificationOutlined, PlusOutlined, BookOutlined } from '@ant-design/icons'
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
  const [sending, setSending] = useState(false)
  
  const chatEndRef = useRef<HTMLDivElement>(null)

  const load = (p = page) => {
    setLoading(true)
    adminApi.get('/support/tickets', { params: { page: p, limit: 20, status: statusFilter } })
      .then(r => { setTickets(r.data.tickets); setTotal(r.data.total) })
      .finally(() => setLoading(false))
  }

  useEffect(() => { load(1); setPage(1) }, [statusFilter])

  const openTicket = async (id: string) => {
    try {
      const r = await adminApi.get(`/support/tickets/${id}`)
      setDrawerTicket(r.data.ticket)
      setDrawerMessages(r.data.messages || [])
    } catch {
      message.error('Failed to fetch ticket details')
    }
  }

  // Live polling for messages when drawer is open
  useEffect(() => {
    if (!drawerTicket) return
    const interval = setInterval(() => {
      adminApi.get(`/support/tickets/${drawerTicket.id}`)
        .then(r => setDrawerMessages(r.data.messages || []))
        .catch(() => {})
    }, 4000)
    return () => clearInterval(interval)
  }, [drawerTicket])

  // Scroll to bottom on new messages
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [drawerMessages])

  const sendReply = async () => {
    if (!replyBody.trim()) return
    setSending(true)
    try {
      await adminApi.post(`/support/tickets/${drawerTicket.id}/messages`, { body: replyBody, is_internal: replyInternal })
      setReplyBody(''); setReplyInternal(false)
      await openTicket(drawerTicket.id)
      load()
    } catch (e: any) {
      message.error(e.response?.data?.error || 'Failed to send reply')
    } finally {
      setSending(false)
    }
  }

  const updateTicket = async (patch: any) => {
    try {
      await adminApi.patch(`/support/tickets/${drawerTicket.id}`, patch)
      message.success('Updated ticket successfully')
      openTicket(drawerTicket.id)
      load()
    } catch (e: any) {
      message.error(e.response?.data?.error || 'Failed to update ticket')
    }
  }

  const columns = [
    { title: 'Subject', dataIndex: 'subject', render: (v: string, r: any) =>
      <Button type="link" size="small" onClick={() => openTicket(r.id)} style={{ fontWeight: 600 }}>{v}</Button> },
    { title: 'User', dataIndex: 'username', render: (v: string) => v || <Typography.Text type="secondary">—</Typography.Text> },
    { title: 'Category', dataIndex: 'category' },
    { title: 'Priority', dataIndex: 'priority', render: (v: string) => <Tag color={priorityColor[v]}>{v}</Tag> },
    { title: 'Status', dataIndex: 'status', render: (v: string) => <Tag color={statusColor[v]}>{v.replace('_', ' ')}</Tag> },
    { title: 'Messages', dataIndex: 'message_count', render: (v: number) => <Badge count={v} showZero style={{ backgroundColor: v > 0 ? '#1677ff' : '#bbb' }} /> },
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
        title={
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span style={{ fontSize: 16 }}>{drawerTicket?.subject}</span>
            <span style={{ fontSize: 12, fontWeight: 'normal', color: '#8c8c8c', marginTop: 4 }}>
              User: {drawerTicket?.username || 'unknown'} {drawerTicket?.phone && `· ${drawerTicket.phone}`}
            </span>
          </div>
        }
        open={!!drawerTicket}
        onClose={() => setDrawerTicket(null)}
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
          <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            
            {/* Live Chat Thread Box */}
            <div style={{
              flex: 1,
              overflowY: 'auto',
              padding: '16px',
              background: '#f0f2f5',
              borderRadius: 12,
              border: '1px solid #e8e8e8',
              maxHeight: 'calc(100vh - 360px)',
              minHeight: 350,
              display: 'flex',
              flexDirection: 'column',
              gap: 12
            }}>
              {drawerMessages.length === 0 ? <Empty description="No messages yet" /> : (
                drawerMessages.map((m: any) => {
                  const isAdmin = m.sender_type === 'admin';
                  const isInternal = m.is_internal;
                  
                  let bubbleBg = '#fff';
                  let bubbleColor = '#000';
                  let borderStyle = '1px solid #e8e8e8';
                  let alignSelf: 'flex-start' | 'flex-end' | 'center' = 'flex-start';
                  let maxWidth = '75%';

                  if (isInternal) {
                    bubbleBg = '#fffbe6';
                    borderStyle = '1px dashed #d4af37';
                    alignSelf = 'center';
                    maxWidth = '90%';
                  } else if (isAdmin) {
                    bubbleBg = 'linear-gradient(135deg, #1677ff, #096dd9)';
                    bubbleColor = '#fff';
                    alignSelf = 'flex-end';
                  }

                  return (
                    <div
                      key={m.id}
                      style={{
                        alignSelf,
                        maxWidth,
                        background: bubbleBg,
                        color: bubbleColor,
                        padding: '10px 14px',
                        borderRadius: 12,
                        border: isInternal || isAdmin ? undefined : borderStyle,
                        boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
                        position: 'relative'
                      }}
                    >
                      <div style={{ 
                        fontSize: 10, 
                        color: isAdmin && !isInternal ? '#e6f4ff' : '#8c8c8c', 
                        marginBottom: 4,
                        fontWeight: 'bold',
                        display: 'flex',
                        justifyContent: 'space-between',
                        gap: 8
                      }}>
                        <span>{m.sender_username || m.sender_type}</span>
                        <span>{new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                      </div>
                      <div style={{ whiteSpace: 'pre-wrap', fontSize: 13, lineHeight: '1.5' }}>
                        {m.body}
                      </div>
                      {isInternal && (
                        <Tag color="gold" style={{ marginTop: 6, marginRight: 0 }}>
                          INTERNAL NOTE
                        </Tag>
                      )}
                    </div>
                  )
                })
              )}
              <div ref={chatEndRef} />
            </div>

            <Divider style={{ margin: '16px 0' }} />

            {/* Reply Input Box */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <Input.TextArea
                rows={3}
                value={replyBody}
                onChange={(e) => setReplyBody(e.target.value)}
                placeholder="Type your message here..."
                onPressEnter={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    sendReply();
                  }
                }}
              />
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Space>
                  <Switch checked={replyInternal} onChange={setReplyInternal} />
                  <span style={{ fontSize: 13 }}>Internal note (only admins see this)</span>
                </Space>
                <Button type="primary" onClick={sendReply} loading={sending} disabled={!replyBody.trim()}>
                  Send Message
                </Button>
              </div>
            </div>

          </div>
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
          <Tabs defaultActiveKey="content" items={[
            {
              key: 'content',
              label: 'Page Content',
              children: (
                <div style={{ marginTop: 12 }}>
                  {creating && (
                    <Form.Item name="slug" label="Slug (lowercase, dashes only)" rules={[{ required: true, pattern: /^[a-z0-9-]+$/, message: 'Lowercase letters/numbers/dashes only' }]}>
                      <Input placeholder="e.g. how-to-play" />
                    </Form.Item>
                  )}
                  <Form.Item name="title" label="Title" rules={[{ required: true }]}>
                    <Input />
                  </Form.Item>
                  <Form.Item name="body_md" label="Body (Markdown)" rules={[{ required: true }]}>
                    <Input.TextArea rows={12} style={{ fontFamily: 'monospace' }} />
                  </Form.Item>
                  <Form.Item name="is_published" label="Published" valuePropName="checked" initialValue={true}>
                    <Switch />
                  </Form.Item>
                </div>
              )
            },
            {
              key: 'seo',
              label: 'SEO & Social Tags',
              children: (
                <div style={{ marginTop: 12 }}>
                  <Form.Item name="meta_title" label="Search Title (meta title)">
                    <Input placeholder="Leave empty to fallback to Page Title" />
                  </Form.Item>
                  <Form.Item name="meta_description" label="Meta Description">
                    <Input.TextArea rows={3} placeholder="SEO page description snippet" />
                  </Form.Item>
                  <Form.Item name="meta_keywords" label="Meta Keywords">
                    <Input placeholder="e.g. page, topic, game" />
                  </Form.Item>
                  <Divider style={{ margin: '16px 0' }}>Open Graph (Social Sharing)</Divider>
                  <Form.Item name="og_title" label="Social Title (og:title)">
                    <Input placeholder="Title displayed on Twitter/WhatsApp" />
                  </Form.Item>
                  <Form.Item name="og_description" label="Social Description (og:description)">
                    <Input.TextArea rows={2} placeholder="Description shown on social platforms" />
                  </Form.Item>
                  <Form.Item name="og_image" label="Social Share Image URL (og:image)">
                    <Input placeholder="https://domain.com/social-banner.jpg" />
                  </Form.Item>
                </div>
              )
            }
          ]} />
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


import { useAuthStore } from '../store/auth'

const KB_CATEGORIES: Record<string, { label: string, color: string }> = {
  deposits: { label: 'Deposits & Withdrawals', color: 'blue' },
  kyc: { label: 'KYC & Verification', color: 'purple' },
  game_rules: { label: 'Game Rules', color: 'green' },
  technical: { label: 'Technical & Systems', color: 'orange' },
  general: { label: 'General / Other', color: 'cyan' },
}

function renderMarkdown(md: string) {
  if (!md) return null
  let html = md
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')

  // Headers
  html = html.replace(/^### (.*?)$/gm, '<h3>$1</h3>')
  html = html.replace(/^## (.*?)$/gm, '<h2>$1</h2>')
  html = html.replace(/^# (.*?)$/gm, '<h1>$1</h1>')

  // Bold / Italic
  html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
  html = html.replace(/\*(.*?)\*/g, '<em>$1</em>')

  // Lists
  html = html.replace(/^\*\s+(.*?)$/gm, '<li>$1</li>')
  html = html.replace(/^\d+\.\s+(.*?)$/gm, '<li>$1</li>')

  // Paragraphs
  const paragraphs = html.split(/\n\n+/)
  html = paragraphs.map(p => {
    const trimmed = p.trim()
    if (trimmed.startsWith('<h') || trimmed.startsWith('<li') || trimmed.startsWith('<li>')) {
      return p
    }
    return `<p>${p.replace(/\n/g, '<br/>')}</p>`
  }).join('\n')

  return (
    <div
      style={{
        lineHeight: '1.7',
        fontSize: '14px',
        color: '#434343',
      }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}

function KnowledgeBaseTab() {
  const { admin } = useAuthStore()
  const [articles, setArticles] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState<string | undefined>()
  
  const [viewerArticle, setViewerArticle] = useState<any>(null)
  const [editorOpen, setEditorOpen] = useState(false)
  const [editingArticle, setEditingArticle] = useState<any>(null)
  const [form] = Form.useForm()

  const canWrite = admin?.role === 'superadmin' || admin?.role === 'support'
  const isSuper = admin?.role === 'superadmin'

  const load = () => {
    setLoading(true)
    adminApi.get('/support/kb', { params: { search, category: categoryFilter } })
      .then(r => setArticles(r.data))
      .catch(() => message.error('Failed to load knowledge base articles'))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    load()
  }, [search, categoryFilter])

  const handleSave = async (v: any) => {
    try {
      if (editingArticle) {
        await adminApi.patch(`/support/kb/${editingArticle.id}`, v)
        message.success('Article updated successfully')
      } else {
        await adminApi.post('/support/kb', v)
        message.success('Article created successfully')
      }
      setEditorOpen(false)
      setEditingArticle(null)
      form.resetFields()
      load()
      if (viewerArticle && editingArticle && viewerArticle.id === editingArticle.id) {
        const r = await adminApi.get(`/support/kb/${viewerArticle.id}`)
        setViewerArticle(r.data)
      }
    } catch (e: any) {
      message.error(e.response?.data?.error || 'Failed to save article')
    }
  }

  const handleDelete = async (id: string) => {
    try {
      await adminApi.delete(`/support/kb/${id}`)
      message.success('Article deleted successfully')
      setViewerArticle(null)
      load()
    } catch (e: any) {
      message.error(e.response?.data?.error || 'Failed to delete article')
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16, gap: 12, flexWrap: 'wrap' }}>
        <Space size="middle" style={{ flex: 1, minWidth: 280 }}>
          <Input.Search
            placeholder="Search articles by title or content..."
            allowClear
            enterButton={<BookOutlined />}
            onSearch={setSearch}
            style={{ maxWidth: 350 }}
          />
          <Select
            placeholder="Filter by Category"
            allowClear
            style={{ width: 200 }}
            value={categoryFilter}
            onChange={setCategoryFilter}
            options={Object.entries(KB_CATEGORIES).map(([k, v]) => ({ value: k, label: v.label }))}
          />
        </Space>
        {canWrite && (
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => {
              setEditingArticle(null)
              form.resetFields()
              setEditorOpen(true)
            }}
          >
            Create Article
          </Button>
        )}
      </div>

      <Table
        dataSource={articles}
        loading={loading}
        rowKey="id"
        size="small"
        pagination={{ pageSize: 10 }}
        columns={[
          {
            title: 'Category',
            dataIndex: 'category',
            width: 180,
            render: (c) => {
              const cat = KB_CATEGORIES[c] || { label: c, color: 'default' }
              return <Tag color={cat.color}>{cat.label}</Tag>
            }
          },
          {
            title: 'Title',
            dataIndex: 'title',
            render: (t, r) => (
              <Button type="link" onClick={() => setViewerArticle(r)} style={{ padding: 0, fontWeight: 600 }}>
                {t}
              </Button>
            )
          },
          {
            title: 'Updated By',
            dataIndex: 'updated_by_username',
            width: 150,
            render: (u, r) => u || r.created_by_username || 'System'
          },
          {
            title: 'Last Updated',
            dataIndex: 'updated_at',
            width: 180,
            render: (d) => new Date(d).toLocaleString()
          },
          {
            title: 'Actions',
            width: 180,
            render: (_, r) => (
              <Space>
                <Button size="small" onClick={() => setViewerArticle(r)}>Read</Button>
                {canWrite && (
                  <Button
                    size="small"
                    onClick={() => {
                      setEditingArticle(r)
                      form.setFieldsValue(r)
                      setEditorOpen(true)
                    }}
                  >
                    Edit
                  </Button>
                )}
              </Space>
            )
          }
        ]}
      />

      <Drawer
        title={
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 16 }}>{viewerArticle?.title}</span>
            {viewerArticle && (
              <Tag color={KB_CATEGORIES[viewerArticle.category]?.color || 'default'}>
                {KB_CATEGORIES[viewerArticle.category]?.label || viewerArticle.category}
              </Tag>
            )}
          </div>
        }
        width={640}
        open={!!viewerArticle}
        onClose={() => setViewerArticle(null)}
        extra={
          <Space>
            {canWrite && viewerArticle && (
              <Button
                onClick={() => {
                  setEditingArticle(viewerArticle)
                  form.setFieldsValue(viewerArticle)
                  setEditorOpen(true)
                }}
              >
                Edit
              </Button>
            )}
            {isSuper && viewerArticle && (
              <Popconfirm
                title="Are you sure you want to delete this article?"
                onConfirm={() => handleDelete(viewerArticle.id)}
                okText="Yes"
                cancelText="No"
              >
                <Button danger>Delete</Button>
              </Popconfirm>
            )}
          </Space>
        }
      >
        {viewerArticle && (
          <div>
            <div style={{ padding: '16px 20px', background: '#fff', borderRadius: 8, border: '1px solid #f0f0f0', marginBottom: 20 }}>
              {renderMarkdown(viewerArticle.content_md)}
            </div>
            <Divider style={{ margin: '12px 0' }} />
            <div style={{ fontSize: 12, color: '#8c8c8c' }}>
              <p style={{ margin: '4px 0' }}>Created by: <strong>{viewerArticle.created_by_username || 'System'}</strong> on {new Date(viewerArticle.created_at).toLocaleString()}</p>
              <p style={{ margin: '4px 0' }}>Last updated: <strong>{viewerArticle.updated_by_username || viewerArticle.created_by_username || 'System'}</strong> on {new Date(viewerArticle.updated_at).toLocaleString()}</p>
            </div>
          </div>
        )}
      </Drawer>

      <Modal
        title={editingArticle ? 'Edit Article' : 'Create Article'}
        open={editorOpen}
        onCancel={() => {
          setEditorOpen(false)
          setEditingArticle(null)
          form.resetFields()
        }}
        onOk={() => form.submit()}
        width={720}
        okText="Save"
      >
        <Form form={form} layout="vertical" onFinish={handleSave}>
          <Form.Item name="title" label="Article Title" rules={[{ required: true, message: 'Please enter title' }]}>
            <Input placeholder="e.g. UPI Manual Deposit Guide" />
          </Form.Item>
          <Form.Item name="category" label="Category" rules={[{ required: true, message: 'Please select category' }]}>
            <Select placeholder="Select a category">
              {Object.entries(KB_CATEGORIES).map(([k, v]) => (
                <Select.Option key={k} value={k}>{v.label}</Select.Option>
              ))}
            </Select>
          </Form.Item>
          <Form.Item
            name="content_md"
            label="Article Content (Markdown)"
            rules={[{ required: true, message: 'Please enter markdown content' }]}
            extra="You can use markdown syntax (# Header, **bold**, *italic*, * bullets, 1. numbered lists)"
          >
            <Input.TextArea rows={12} placeholder="Write your guide in markdown..." />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}

export default function Support() {
  return (
    <Card title="Support & CMS">
      <Tabs defaultActiveKey="tickets" items={[
        { key: 'tickets', label: <><MessageOutlined /> Tickets</>, children: <TicketsTab /> },
        { key: 'pages', label: <><FileTextOutlined /> CMS Pages</>, children: <PagesTab /> },
        { key: 'banners', label: <><NotificationOutlined /> Banners</>, children: <BannersTab /> },
        { key: 'kb', label: <><BookOutlined /> Knowledge Base</>, children: <KnowledgeBaseTab /> },
      ]} />
    </Card>
  )
}
