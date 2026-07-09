import { useEffect, useState, useRef } from 'react'
import {
  Card, Tabs, Table, Tag, Button, Modal, Form, Input, Select, Space, message, Popconfirm,
  Switch, InputNumber, Drawer, Typography, Divider, Badge, Empty,
} from 'antd'
import {
  MessageOutlined, PlusOutlined, BookOutlined, SearchOutlined, EditOutlined, DeleteOutlined,
  WalletOutlined, SafetyCertificateOutlined, TrophyOutlined, SettingOutlined, QuestionCircleOutlined,
  ArrowRightOutlined
} from '@ant-design/icons'
import { adminApi } from '../api/client'
import { useAuthStore } from '../store/auth'

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

  const getPreviewText = (md: string) => {
    if (!md) return ''
    const clean = md
      .replace(/[#*`_\[\]()\-]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
    return clean.length > 120 ? clean.substring(0, 120) + '...' : clean
  }

  const categoryIcons: Record<string, React.ReactNode> = {
    deposits: <WalletOutlined style={{ color: '#1890ff' }} />,
    kyc: <SafetyCertificateOutlined style={{ color: '#722ed1' }} />,
    game_rules: <TrophyOutlined style={{ color: '#52c41a' }} />,
    technical: <SettingOutlined style={{ color: '#fa8c16' }} />,
    general: <QuestionCircleOutlined style={{ color: '#13c2c2' }} />,
  }

  return (
    <div style={{ padding: '4px 0' }}>
      {/* Header Glass Banner */}
      <div style={{
        background: 'linear-gradient(135deg, #11152c 0%, #0d1021 100%)',
        border: '1px solid rgba(214, 175, 55, 0.18)',
        borderRadius: '16px',
        padding: '36px 30px',
        color: '#fff',
        marginBottom: '24px',
        position: 'relative',
        overflow: 'hidden',
      }}>
        <div style={{ position: 'absolute', right: -50, top: -50, width: 200, height: 200, borderRadius: '50%', background: 'rgba(214, 175, 55, 0.05)', filter: 'blur(40px)' }}></div>
        <h2 style={{ color: '#d4af37', margin: 0, fontSize: '24px', fontWeight: 700, letterSpacing: '0.5px' }}>Knowledge Base & Operations Manual</h2>
        <p style={{ color: '#a6adb9', margin: '8px 0 0 0', fontSize: '14px', maxWidth: '600px' }}>
          Explore guidelines, troubleshoot manual deposits, verify KYC compliance, and configure game rules.
        </p>
      </div>

      <div style={{ display: 'flex', gap: '24px', flexDirection: 'row', alignItems: 'flex-start', flexWrap: 'wrap', marginBottom: '24px' }}>
        {/* Left Side: Categories Box */}
        <div style={{
          flex: '0 0 280px',
          background: 'rgba(255, 255, 255, 0.65)',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
          border: '1px solid rgba(0, 0, 0, 0.06)',
          borderRadius: '16px',
          padding: '20px 16px',
          boxShadow: '0 8px 32px 0 rgba(31, 38, 135, 0.03)',
          width: '100%',
        }}>
          <h3 style={{ fontSize: '15px', fontWeight: 700, color: '#262626', marginBottom: '16px', paddingLeft: '8px' }}>Categories</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <div
              onClick={() => setCategoryFilter(undefined)}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '10px 12px',
                borderRadius: '10px',
                cursor: 'pointer',
                transition: 'all 0.2s',
                background: !categoryFilter ? 'rgba(212, 175, 55, 0.12)' : 'transparent',
                border: !categoryFilter ? '1px solid rgba(212, 175, 55, 0.3)' : '1px solid transparent',
              }}
            >
              <Space>
                <BookOutlined style={{ color: !categoryFilter ? '#d4af37' : '#8c8c8c' }} />
                <span style={{ fontWeight: !categoryFilter ? 600 : 500, color: !categoryFilter ? '#b8860b' : '#595959', fontSize: '13px' }}>All Articles</span>
              </Space>
              <Tag color={!categoryFilter ? 'gold' : 'default'} style={{ borderRadius: '10px' }}>{articles.length}</Tag>
            </div>

            {Object.entries(KB_CATEGORIES).map(([k, v]) => {
              const active = categoryFilter === k
              return (
                <div
                  key={k}
                  onClick={() => setCategoryFilter(k)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '10px 12px',
                    borderRadius: '10px',
                    cursor: 'pointer',
                    transition: 'all 0.2s',
                    background: active ? 'rgba(212, 175, 55, 0.12)' : 'transparent',
                    border: active ? '1px solid rgba(212, 175, 55, 0.3)' : '1px solid transparent',
                  }}
                >
                  <Space>
                    {categoryIcons[k] || <BookOutlined />}
                    <span style={{ fontWeight: active ? 600 : 500, color: active ? '#b8860b' : '#595959', fontSize: '13px' }}>{v.label}</span>
                  </Space>
                  <Tag color={active ? 'gold' : 'default'} style={{ borderRadius: '10px' }}>{articles.filter(a => a.category === k).length}</Tag>
                </div>
              )
            })}
          </div>

          {canWrite && (
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => {
                setEditingArticle(null)
                form.resetFields()
                setEditorOpen(true)
              }}
              style={{ width: '100%', marginTop: '20px', borderRadius: '10px', height: '38px', fontWeight: 600, background: '#d4af37', borderColor: '#d4af37' }}
            >
              Create Article
            </Button>
          )}
        </div>

        {/* Right Side: Search and Glassy Cards Grid */}
        <div style={{ flex: 1, minWidth: '320px' }}>
          <div style={{ display: 'flex', gap: '12px', marginBottom: '20px' }}>
            <Input
              placeholder="Search guides by title or keywords..."
              prefix={<SearchOutlined style={{ color: '#bfbfbf' }} />}
              allowClear
              onChange={(e) => setSearch(e.target.value)}
              style={{
                height: '42px',
                borderRadius: '12px',
                border: '1px solid rgba(0, 0, 0, 0.08)',
                boxShadow: '0 2px 8px rgba(0, 0, 0, 0.02)',
              }}
            />
          </div>

          {loading ? (
            <div style={{ display: 'flex', justifyContent: 'center', padding: '60px 0' }}>
              <Typography.Text type="secondary">Loading guides...</Typography.Text>
            </div>
          ) : articles.length === 0 ? (
            <div style={{
              background: 'rgba(255, 255, 255, 0.5)',
              borderRadius: '16px',
              padding: '60px 20px',
              textAlign: 'center',
              border: '1px dashed rgba(0, 0, 0, 0.1)',
            }}>
              <BookOutlined style={{ fontSize: '40px', color: '#bfbfbf', marginBottom: '16px' }} />
              <h3>No articles found</h3>
              <p style={{ color: '#8c8c8c' }}>Try adjusting your keywords or selecting another category.</p>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: '20px' }}>
              {articles.map((art) => {
                const cat = KB_CATEGORIES[art.category] || { label: art.category, color: 'default' }
                return (
                  <div
                    key={art.id}
                    style={{
                      background: 'rgba(255, 255, 255, 0.75)',
                      backdropFilter: 'blur(8px)',
                      WebkitBackdropFilter: 'blur(8px)',
                      border: '1px solid rgba(0, 0, 0, 0.06)',
                      borderRadius: '16px',
                      padding: '24px',
                      boxShadow: '0 4px 20px rgba(0, 0, 0, 0.02)',
                      display: 'flex',
                      flexDirection: 'column',
                      justifyContent: 'space-between',
                      transition: 'all 0.3s ease',
                      cursor: 'pointer',
                    }}
                    onClick={() => setViewerArticle(art)}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.transform = 'translateY(-4px)'
                      e.currentTarget.style.boxShadow = '0 12px 30px rgba(212, 175, 55, 0.08)'
                      e.currentTarget.style.borderColor = 'rgba(212, 175, 55, 0.3)'
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.transform = 'translateY(0)'
                      e.currentTarget.style.boxShadow = '0 4px 20px rgba(0, 0, 0, 0.02)'
                      e.currentTarget.style.borderColor = 'rgba(0, 0, 0, 0.06)'
                    }}
                  >
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                        <Tag color={cat.color} style={{ borderRadius: '8px', padding: '2px 8px', fontSize: '11px', fontWeight: 600 }}>
                          {cat.label}
                        </Tag>
                        {canWrite && (
                          <Space onClick={(e) => e.stopPropagation()}>
                            <Button
                              type="text"
                              size="small"
                              icon={<EditOutlined style={{ fontSize: '13px', color: '#1890ff' }} />}
                              onClick={() => {
                                setEditingArticle(art)
                                form.setFieldsValue(art)
                                setEditorOpen(true)
                              }}
                            />
                            {isSuper && (
                              <Popconfirm
                                title="Delete this guide?"
                                onConfirm={() => handleDelete(art.id)}
                                okText="Yes"
                                cancelText="No"
                              >
                                <Button
                                  type="text"
                                  size="small"
                                  danger
                                  icon={<DeleteOutlined style={{ fontSize: '13px' }} />}
                                />
                              </Popconfirm>
                            )}
                          </Space>
                        )}
                      </div>
                      <h4 style={{ fontSize: '16px', fontWeight: 700, color: '#141414', marginBottom: '8px', lineHeight: '1.4' }}>
                        {art.title}
                      </h4>
                      <p style={{ fontSize: '13px', color: '#595959', lineHeight: '1.6', marginBottom: '16px' }}>
                        {getPreviewText(art.content_md)}
                      </p>
                    </div>
                    
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid rgba(0, 0, 0, 0.04)', paddingTop: '12px', marginTop: 'auto' }}>
                      <span style={{ fontSize: '11px', color: '#8c8c8c' }}>
                        Updated {new Date(art.updated_at).toLocaleDateString()}
                      </span>
                      <span style={{ color: '#d4af37', fontWeight: 600, fontSize: '12px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                        Read Guide <ArrowRightOutlined style={{ fontSize: '10px' }} />
                      </span>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

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
    <Card title="Support Center">
      <Tabs defaultActiveKey="tickets" items={[
        { key: 'tickets', label: <><MessageOutlined /> Tickets</>, children: <TicketsTab /> },
        { key: 'kb', label: <><BookOutlined /> Knowledge Base</>, children: <KnowledgeBaseTab /> },
      ]} />
    </Card>
  )
}
