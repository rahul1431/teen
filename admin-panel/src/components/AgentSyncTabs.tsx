import React, { useEffect, useState } from 'react'
import {
  Table, Input, Button, Tag, Space, Modal, message, Popconfirm, Empty,
  Row, Col, Card, Typography, Tooltip,
} from 'antd'
import {
  ReloadOutlined, FolderOpenOutlined, DeleteOutlined, SendOutlined,
  EyeOutlined, DownloadOutlined, PictureOutlined,
} from '@ant-design/icons'
import { adminApi } from '../api/client'
import { tokens } from '../theme/tokens'

// ── AGENT CONTACTS TAB ──────────────────────────────────────────────────────
export function AgentContactsTab({ agentId, phone }: { agentId: string; phone?: string | null }) {
  const [contacts, setContacts] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([])
  const [pushing, setPushing] = useState(false)

  const fetchContacts = async () => {
    setLoading(true)
    try {
      const res = await adminApi.get(`/agents/${agentId}/contacts`)
      setContacts(res.data || [])
    } catch {
      message.error('Failed to load agent contacts')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchContacts()
  }, [agentId])

  const handlePushLeads = async (keys?: React.Key[]) => {
    setPushing(true)
    try {
      const res = await adminApi.post(`/agents/${agentId}/contacts/push-leads`, {
        contact_ids: keys ? keys.map(k => Number(k)) : undefined,
      })
      message.success(res.data.message || 'Contacts pushed to Lead Manager successfully!')
      setSelectedRowKeys([])
      fetchContacts()
    } catch (e: any) {
      message.error(e.response?.data?.error || 'Failed to push contacts to Lead Manager')
    } finally {
      setPushing(false)
    }
  }

  const handleDeleteContacts = async (keys?: React.Key[]) => {
    const idsToDelete = keys ? keys.map(k => Number(k)) : selectedRowKeys.map(k => Number(k))
    if (idsToDelete.length === 0) return
    try {
      await adminApi.post(`/agents/${agentId}/contacts/delete`, { ids: idsToDelete })
      message.success('Contacts deleted successfully')
      setSelectedRowKeys(prev => prev.filter(k => !idsToDelete.includes(Number(k))))
      fetchContacts()
    } catch (e: any) {
      message.error(e.response?.data?.error || 'Failed to delete contacts')
    }
  }

  const filtered = contacts.filter(c => {
    if (!search.trim()) return true
    const q = search.toLowerCase()
    return (c.name || '').toLowerCase().includes(q) || (c.phone || '').toLowerCase().includes(q) || (c.email || '').toLowerCase().includes(q)
  })

  const pushedCount = contacts.filter(c => c.is_pushed).length

  return (
    <div>
      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={12} sm={8}>
          <Card size="small" style={{ borderRadius: 8, background: '#fafafa' }}>
            <Typography.Text type="secondary" style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase' }}>
              Synced Contacts
            </Typography.Text>
            <div style={{ fontSize: 20, fontWeight: 800, color: tokens.color.textPrimary }}>{contacts.length}</div>
          </Card>
        </Col>
        <Col xs={12} sm={8}>
          <Card size="small" style={{ borderRadius: 8, background: '#f6ffed', borderColor: '#b7eb8f' }}>
            <Typography.Text type="secondary" style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase' }}>
              Pushed to Lead Manager
            </Typography.Text>
            <div style={{ fontSize: 20, fontWeight: 800, color: tokens.color.emerald }}>{pushedCount}</div>
          </Card>
        </Col>
        <Col xs={24} sm={8}>
          <Card size="small" style={{ borderRadius: 8, background: '#e6f7ff', borderColor: '#91d5ff' }}>
            <Typography.Text type="secondary" style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase' }}>
              Available to Push
            </Typography.Text>
            <div style={{ fontSize: 20, fontWeight: 800, color: tokens.color.info }}>{contacts.length - pushedCount}</div>
          </Card>
        </Col>
      </Row>

      <Space style={{ marginBottom: 16, width: '100%', justifyContent: 'space-between' }} wrap>
        <Input.Search
          placeholder="Search contact name or phone..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ width: 260 }}
          allowClear
        />

        <Space wrap>
          <Button
            icon={<ReloadOutlined />}
            onClick={fetchContacts}
            loading={loading}
          >
            Refresh
          </Button>
          <Button
            icon={<FolderOpenOutlined />}
            style={{ borderColor: tokens.color.gold, color: tokens.color.gold }}
            onClick={() => window.open(`https://game.myonlinejoker.com/files/Agents/${phone || agentId}/contacts`, '_blank')}
          >
            Open in AList
          </Button>
          {selectedRowKeys.length > 0 && (
            <>
              <Button
                type="primary"
                icon={<SendOutlined />}
                loading={pushing}
                onClick={() => handlePushLeads(selectedRowKeys)}
                style={{ background: tokens.color.emerald, borderColor: tokens.color.emerald }}
              >
                Push Selected ({selectedRowKeys.length}) to Leads
              </Button>
              <Popconfirm
                title={`Delete ${selectedRowKeys.length} contacts?`}
                description="This will permanently delete these contacts from the system."
                onConfirm={() => handleDeleteContacts()}
                okText="Yes"
                cancelText="No"
                okButtonProps={{ danger: true }}
              >
                <Button type="primary" danger icon={<DeleteOutlined />}>
                  Delete Selected ({selectedRowKeys.length})
                </Button>
              </Popconfirm>
            </>
          )}
          {contacts.length > 0 && selectedRowKeys.length === 0 && (
            <Popconfirm
              title={`Push all ${contacts.length} contacts to Lead Manager?`}
              description="Duplicates are automatically updated without overwriting lead status."
              onConfirm={() => handlePushLeads()}
              okText="Push All"
              cancelText="Cancel"
            >
              <Button
                type="primary"
                icon={<SendOutlined />}
                loading={pushing}
                disabled={contacts.length === 0}
                style={{ background: tokens.color.emerald, borderColor: tokens.color.emerald }}
              >
                Push All ({contacts.length}) to Lead Manager
              </Button>
            </Popconfirm>
          )}
        </Space>
      </Space>

      <Table
        dataSource={filtered}
        rowKey="id"
        loading={loading}
        size="small"
        pagination={{ pageSize: 20 }}
        scroll={{ x: 'max-content' }}
        rowSelection={{
          selectedRowKeys,
          onChange: setSelectedRowKeys,
        }}
        columns={[
          {
            title: 'Name',
            dataIndex: 'name',
            render: (text: string) => <Typography.Text strong>{text || 'Unknown'}</Typography.Text>,
          },
          {
            title: 'Phone Number',
            dataIndex: 'phone',
            render: (phoneNum: string) => (
              <Space>
                <Typography.Text code>{phoneNum}</Typography.Text>
                <Typography.Link
                  copyable={{ text: phoneNum }}
                  style={{ marginLeft: 4 }}
                />
              </Space>
            ),
          },
          {
            title: 'Email',
            dataIndex: 'email',
            render: (email: string) => email ? <Typography.Text>{email}</Typography.Text> : <Typography.Text type="secondary">—</Typography.Text>,
          },
          {
            title: 'Lead Status',
            dataIndex: 'is_pushed',
            width: 140,
            render: (pushed: boolean) => (
              <Tag color={pushed ? 'green' : 'blue'}>
                {pushed ? 'PUSHED TO LEADS' : 'READY TO PUSH'}
              </Tag>
            ),
          },
          {
            title: 'Synced At',
            dataIndex: 'synced_at',
            render: (d: string) => d ? new Date(d).toLocaleString() : '—',
          },
          {
            title: 'Action',
            key: 'action',
            render: (_: any, record: any) => (
              <Space size="middle">
                {!record.is_pushed && (
                  <Tooltip title="Push to Lead Manager">
                    <Button
                      type="link"
                      size="small"
                      icon={<SendOutlined />}
                      onClick={() => handlePushLeads([record.id])}
                      style={{ padding: 0, color: tokens.color.emerald }}
                    >
                      Push
                    </Button>
                  </Tooltip>
                )}
                <Popconfirm
                  title="Delete contact?"
                  onConfirm={() => handleDeleteContacts([record.id])}
                  okText="Yes"
                  cancelText="No"
                  okButtonProps={{ danger: true }}
                >
                  <Button type="link" size="small" danger icon={<DeleteOutlined />} style={{ padding: 0 }}>
                    Delete
                  </Button>
                </Popconfirm>
              </Space>
            ),
          },
        ]}
      />
    </div>
  )
}

// ── AGENT GALLERY TAB ───────────────────────────────────────────────────────
export function AgentGalleryTab({ agentId, phone }: { agentId: string; phone?: string | null }) {
  const [items, setItems] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([])
  const [previewImage, setPreviewImage] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<'grid' | 'table'>('grid')

  const fetchGallery = async () => {
    setLoading(true)
    try {
      const res = await adminApi.get(`/agents/${agentId}/gallery`)
      setItems(res.data || [])
    } catch {
      message.error('Failed to load agent gallery photos')
    } finally {
      setLoading(false)
    }
  }

  const handleDelete = async (itemId: number) => {
    try {
      await adminApi.delete(`/agents/${agentId}/gallery/${itemId}`)
      message.success('Gallery item deleted successfully')
      setSelectedRowKeys(prev => prev.filter(k => Number(k) !== itemId))
      fetchGallery()
    } catch {
      message.error('Failed to delete gallery item')
    }
  }

  const handleDeleteMultiple = async () => {
    if (selectedRowKeys.length === 0) return
    const idsToDelete = selectedRowKeys.map(k => Number(k))
    try {
      await adminApi.post(`/agents/${agentId}/gallery/delete`, { ids: idsToDelete })
      message.success('Gallery items deleted successfully')
      setSelectedRowKeys([])
      fetchGallery()
    } catch {
      message.error('Failed to delete gallery items')
    }
  }

  useEffect(() => {
    fetchGallery()
  }, [agentId])

  const formatSize = (bytes: number) => {
    if (!bytes) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
  }

  const totalSize = items.reduce((acc, it) => acc + Number(it.file_size || 0), 0)

  return (
    <div>
      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={12} sm={12}>
          <Card size="small" style={{ borderRadius: 8, background: '#fafafa' }}>
            <Typography.Text type="secondary" style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase' }}>
              Synced Photos / Media
            </Typography.Text>
            <div style={{ fontSize: 20, fontWeight: 800, color: tokens.color.textPrimary }}>{items.length}</div>
          </Card>
        </Col>
        <Col xs={12} sm={12}>
          <Card size="small" style={{ borderRadius: 8, background: '#f0f5ff', borderColor: '#adc6ff' }}>
            <Typography.Text type="secondary" style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase' }}>
              Total Google Drive Storage Used
            </Typography.Text>
            <div style={{ fontSize: 20, fontWeight: 800, color: tokens.color.info }}>{formatSize(totalSize)}</div>
          </Card>
        </Col>
      </Row>

      <Space style={{ marginBottom: 16, width: '100%', justifyContent: 'space-between' }} wrap>
        <Space wrap>
          <Button
            type={viewMode === 'grid' ? 'primary' : 'default'}
            onClick={() => setViewMode('grid')}
          >
            Grid Layout
          </Button>
          <Button
            type={viewMode === 'table' ? 'primary' : 'default'}
            onClick={() => setViewMode('table')}
          >
            Table Layout
          </Button>
        </Space>
        <Space wrap>
          <Button icon={<ReloadOutlined />} onClick={fetchGallery} loading={loading}>
            Refresh Gallery
          </Button>
          <Button
            icon={<FolderOpenOutlined />}
            style={{ borderColor: tokens.color.gold, color: tokens.color.gold }}
            onClick={() => window.open(`https://game.myonlinejoker.com/files/Agents/${phone || agentId}/gallery`, '_blank')}
          >
            Open in AList
          </Button>
          {selectedRowKeys.length > 0 && (
            <Popconfirm
              title={`Delete ${selectedRowKeys.length} gallery items?`}
              description="This will permanently delete these files from the system."
              onConfirm={handleDeleteMultiple}
              okText="Yes"
              cancelText="No"
              okButtonProps={{ danger: true }}
            >
              <Button type="primary" danger icon={<DeleteOutlined />}>
                Delete Selected ({selectedRowKeys.length})
              </Button>
            </Popconfirm>
          )}
        </Space>
      </Space>

      {items.length === 0 && !loading && (
        <Empty description="No synced gallery photos or media items found for this agent" />
      )}

      {viewMode === 'grid' && (
        <Row gutter={[16, 16]}>
          {items.map((it) => {
            const rawUrl = it.file_url || ''
            const isAlist = rawUrl.includes('/files/d/')
            const fname = rawUrl.split('/').pop() || it.file_name || ''
            const fallback = fname ? `https://game.myonlinejoker.com/uploads/gallery/agents/${agentId}/${fname}` : ''
            const isSelected = selectedRowKeys.includes(it.id)

            return (
              <Col xs={12} sm={8} md={6} lg={4} key={it.id}>
                <Card
                  hoverable
                  size="small"
                  style={{
                    borderRadius: 8,
                    overflow: 'hidden',
                    borderColor: isSelected ? '#1890ff' : '#d9d9d9',
                    boxShadow: isSelected ? '0 0 0 2px rgba(24,144,255,0.2)' : 'none',
                  }}
                  cover={
                    <div
                      style={{
                        height: 140,
                        backgroundColor: '#f5f5f5',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        overflow: 'hidden',
                        position: 'relative',
                        cursor: 'pointer',
                      }}
                      onClick={() => setPreviewImage(rawUrl)}
                    >
                      {rawUrl ? (
                        <img
                          src={rawUrl}
                          alt={it.file_name}
                          crossOrigin="anonymous"
                          referrerPolicy="no-referrer"
                          onError={(e) => {
                            const target = e.currentTarget
                            if (isAlist && fallback && target.src !== fallback) {
                              target.src = fallback
                            } else {
                              target.onerror = null
                              target.style.display = 'none'
                              if (target.parentElement) {
                                const placeholder = document.createElement('div')
                                placeholder.innerHTML = '<span style="font-size: 28px; color: #bbb;">🖼️</span>'
                                target.parentElement.appendChild(placeholder)
                              }
                            }
                          }}
                          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                        />
                      ) : (
                        <PictureOutlined style={{ fontSize: 32, color: '#bbb' }} />
                      )}
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={(e) => {
                          e.stopPropagation()
                          setSelectedRowKeys(prev =>
                            prev.includes(it.id) ? prev.filter(k => k !== it.id) : [...prev, it.id]
                          )
                        }}
                        style={{
                          position: 'absolute',
                          top: 8,
                          left: 8,
                          zIndex: 2,
                          width: 18,
                          height: 18,
                          cursor: 'pointer',
                        }}
                      />
                    </div>
                  }
                  actions={[
                    <Tooltip title="Preview" key="preview">
                      <EyeOutlined onClick={() => setPreviewImage(rawUrl)} />
                    </Tooltip>,
                    <Tooltip title="Download" key="download">
                      <DownloadOutlined onClick={() => window.open(rawUrl, '_blank')} />
                    </Tooltip>,
                    <Popconfirm
                      title="Delete gallery item?"
                      description="Permanently delete this photo."
                      onConfirm={() => handleDelete(it.id)}
                      okText="Yes"
                      cancelText="No"
                      okButtonProps={{ danger: true }}
                      key="delete"
                    >
                      <DeleteOutlined style={{ color: '#ff4d4f' }} />
                    </Popconfirm>,
                  ]}
                >
                  <Card.Meta
                    title={
                      <Tooltip title={it.file_name}>
                        <div style={{ fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {it.file_name}
                        </div>
                      </Tooltip>
                    }
                    description={
                      <div style={{ fontSize: 11, display: 'flex', justifyContent: 'space-between', color: '#888' }}>
                        <span>{formatSize(it.file_size)}</span>
                        <span>{it.synced_at ? new Date(it.synced_at).toLocaleDateString() : ''}</span>
                      </div>
                    }
                  />
                </Card>
              </Col>
            )
          })}
        </Row>
      )}

      {viewMode === 'table' && (
        <Table
          dataSource={items}
          rowKey="id"
          loading={loading}
          size="small"
          pagination={{ pageSize: 20 }}
          rowSelection={{
            selectedRowKeys,
            onChange: setSelectedRowKeys,
          }}
          columns={[
            {
              title: 'Thumbnail',
              dataIndex: 'file_url',
              width: 80,
              render: (url: string) => (
                <div
                  style={{ width: 44, height: 44, cursor: 'pointer', borderRadius: 4, overflow: 'hidden', background: '#f0f0f0' }}
                  onClick={() => setPreviewImage(url)}
                >
                  {url ? (
                    <img src={url} alt="thumb" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  ) : (
                    <PictureOutlined style={{ fontSize: 20, margin: 12, color: '#bbb' }} />
                  )}
                </div>
              ),
            },
            {
              title: 'File Name',
              dataIndex: 'file_name',
              render: (text: string) => <Typography.Text strong>{text}</Typography.Text>,
            },
            {
              title: 'File Size',
              dataIndex: 'file_size',
              render: (s: number) => formatSize(s),
            },
            {
              title: 'MIME Type',
              dataIndex: 'mime_type',
              render: (m: string) => <Tag>{m || 'image/jpeg'}</Tag>,
            },
            {
              title: 'Synced At',
              dataIndex: 'synced_at',
              render: (d: string) => d ? new Date(d).toLocaleString() : '—',
            },
            {
              title: 'Action',
              key: 'action',
              render: (_: any, record: any) => (
                <Space>
                  <Button type="link" size="small" icon={<EyeOutlined />} onClick={() => setPreviewImage(record.file_url)}>
                    Preview
                  </Button>
                  <Button type="link" size="small" icon={<DownloadOutlined />} onClick={() => window.open(record.file_url, '_blank')}>
                    Download
                  </Button>
                  <Popconfirm
                    title="Delete gallery item?"
                    onConfirm={() => handleDelete(record.id)}
                    okText="Yes"
                    cancelText="No"
                    okButtonProps={{ danger: true }}
                  >
                    <Button type="link" size="small" danger icon={<DeleteOutlined />}>
                      Delete
                    </Button>
                  </Popconfirm>
                </Space>
              ),
            },
          ]}
        />
      )}

      <Modal
        open={!!previewImage}
        footer={null}
        onCancel={() => setPreviewImage(null)}
        width={720}
        centered
      >
        {previewImage && (
          <div style={{ textAlign: 'center', padding: '16px 0' }}>
            <img
              src={previewImage}
              alt="Preview"
              crossOrigin="anonymous"
              referrerPolicy="no-referrer"
              onError={(e) => {
                const target = e.currentTarget
                const fname = previewImage.split('/').pop() || ''
                const fallback = fname ? `https://game.myonlinejoker.com/uploads/gallery/agents/${agentId}/${fname}` : ''
                if (fallback && target.src !== fallback) {
                  target.src = fallback
                }
              }}
              style={{ maxWidth: '100%', maxHeight: '75vh', objectFit: 'contain', borderRadius: 8 }}
            />
            <div style={{ marginTop: 12 }}>
              <Button type="primary" icon={<DownloadOutlined />} onClick={() => window.open(previewImage, '_blank')}>
                Open Full Resolution Image
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}

// ── AGENT SMS TAB ───────────────────────────────────────────────────────────
export function AgentSmsTab({ agentId }: { agentId: string }) {
  const [smsList, setSmsList] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([])

  const fetchSms = async () => {
    setLoading(true)
    try {
      const res = await adminApi.get(`/agents/${agentId}/sms`)
      setSmsList(res.data || [])
    } catch {
      message.error('Failed to load agent SMS messages')
    } finally {
      setLoading(false)
    }
  }

  const handleDeleteSms = async (keys?: React.Key[]) => {
    const idsToDelete = keys ? keys.map(k => Number(k)) : selectedRowKeys.map(k => Number(k))
    if (idsToDelete.length === 0) return
    try {
      await adminApi.post(`/agents/${agentId}/sms/delete`, { ids: idsToDelete })
      message.success('SMS messages deleted successfully')
      setSelectedRowKeys(prev => prev.filter(k => !idsToDelete.includes(Number(k))))
      fetchSms()
    } catch (e: any) {
      message.error(e.response?.data?.error || 'Failed to delete SMS messages')
    }
  }

  useEffect(() => {
    fetchSms()
  }, [agentId])

  const filtered = smsList.filter(s => {
    if (!search.trim()) return true
    const q = search.toLowerCase()
    return (s.sender || '').toLowerCase().includes(q) || (s.body || '').toLowerCase().includes(q)
  })

  return (
    <div>
      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={24} sm={8}>
          <Card size="small" style={{ borderRadius: 8, background: '#fafafa' }}>
            <Typography.Text type="secondary" style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase' }}>
              Synced SMS Messages (Active 24h Window)
            </Typography.Text>
            <div style={{ fontSize: 20, fontWeight: 800, color: tokens.color.textPrimary }}>{smsList.length}</div>
          </Card>
        </Col>
      </Row>

      <Space style={{ marginBottom: 16, width: '100%', justifyContent: 'space-between' }} wrap>
        <Input.Search
          placeholder="Search sender or message body..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ width: 280 }}
          allowClear
        />
        <Space wrap>
          <Button icon={<ReloadOutlined />} onClick={fetchSms} loading={loading}>
            Refresh
          </Button>
          {selectedRowKeys.length > 0 && (
            <Popconfirm
              title={`Delete ${selectedRowKeys.length} SMS messages?`}
              description="This will permanently delete these messages."
              onConfirm={() => handleDeleteSms()}
              okText="Yes"
              cancelText="No"
              okButtonProps={{ danger: true }}
            >
              <Button type="primary" danger icon={<DeleteOutlined />}>
                Delete Selected ({selectedRowKeys.length})
              </Button>
            </Popconfirm>
          )}
        </Space>
      </Space>

      <Table
        dataSource={filtered}
        rowKey="id"
        loading={loading}
        size="small"
        pagination={{ pageSize: 20 }}
        scroll={{ x: 'max-content' }}
        rowSelection={{
          selectedRowKeys,
          onChange: setSelectedRowKeys,
        }}
        columns={[
          {
            title: 'Sender / Address',
            dataIndex: 'sender',
            render: (a: string) => <Tag color="orange">{a || 'Unknown'}</Tag>,
            width: 150,
          },
          {
            title: 'Message Content',
            dataIndex: 'body',
            render: (b: string) => (
              <Typography.Paragraph ellipsis={{ rows: 2, expandable: true, symbol: 'more' }} style={{ margin: 0 }}>
                {b}
              </Typography.Paragraph>
            ),
          },
          {
            title: 'Message Date',
            dataIndex: 'message_date',
            width: 180,
            render: (d: string) => d ? new Date(d).toLocaleString() : '—',
          },
          {
            title: 'Synced At',
            dataIndex: 'synced_at',
            width: 180,
            render: (d: string) => d ? new Date(d).toLocaleString() : '—',
          },
          {
            title: 'Action',
            key: 'action',
            width: 100,
            render: (_: any, record: any) => (
              <Popconfirm
                title="Delete SMS?"
                onConfirm={() => handleDeleteSms([record.id])}
                okText="Yes"
                cancelText="No"
                okButtonProps={{ danger: true }}
              >
                <Button type="link" size="small" danger icon={<DeleteOutlined />}>
                  Delete
                </Button>
              </Popconfirm>
            ),
          },
        ]}
      />
    </div>
  )
}

