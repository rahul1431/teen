import { useEffect, useState } from 'react'
import {
  Table, Input, Select, Button, Tag, Space, Modal, Form,
  message, Popconfirm, Row, Col, Card, Typography, Tooltip,
} from 'antd'
import {
  SearchOutlined, PlusOutlined, DeleteOutlined,
  EditOutlined, ExportOutlined, CopyOutlined, ReloadOutlined,
  WhatsAppOutlined, UserOutlined,
} from '@ant-design/icons'
import { adminApi } from '../api/client'
import { tokens } from '../theme/tokens'

type Lead = {
  id: number
  source_user_id?: string
  source_username?: string
  contact_name: string
  contact_phone: string
  contact_email?: string
  status: 'new' | 'contacted' | 'interested' | 'converted' | 'rejected'
  notes?: string
  created_at: string
  updated_at: string
}

export default function LeadManager() {
  const [leads, setLeads] = useState<Lead[]>([])
  const [loading, setLoading] = useState(false)
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([])

  // Modal states
  const [addModalOpen, setAddModalOpen] = useState(false)
  const [editLead, setEditLead] = useState<Lead | null>(null)
  const [bulkStatusOpen, setBulkStatusOpen] = useState(false)
  const [bulkStatusVal, setBulkStatusVal] = useState<'new' | 'contacted' | 'interested' | 'converted' | 'rejected'>('contacted')

  const [form] = Form.useForm()
  const [editForm] = Form.useForm()

  const fetchLeads = async (p = page) => {
    setLoading(true)
    try {
      const res = await adminApi.get('/leads', {
        params: { page: p, limit: 20, search, status: statusFilter },
      })
      setLeads(res.data.leads || [])
      setTotal(res.data.total || 0)
    } catch (e: any) {
      message.error(e?.response?.data?.error || 'Failed to load leads')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchLeads()
    /* eslint-disable-next-line */
  }, [page, search, statusFilter])

  const handleCreateLead = async (values: any) => {
    try {
      await adminApi.post('/leads', values)
      message.success('Lead added successfully')
      setAddModalOpen(false)
      form.resetFields()
      fetchLeads()
    } catch (e: any) {
      message.error(e?.response?.data?.error || 'Failed to add lead')
    }
  }

  const handleUpdateLead = async (values: any) => {
    if (!editLead) return
    try {
      await adminApi.patch(`/leads/${editLead.id}`, values)
      message.success('Lead updated successfully')
      setEditLead(null)
      fetchLeads()
    } catch (e: any) {
      message.error(e?.response?.data?.error || 'Failed to update lead')
    }
  }

  const handleDeleteLead = async (id: number) => {
    try {
      await adminApi.delete(`/leads/${id}`)
      message.success('Lead deleted')
      fetchLeads()
    } catch (e: any) {
      message.error(e?.response?.data?.error || 'Failed to delete lead')
    }
  }

  const handleBulkDelete = async () => {
    if (!selectedRowKeys.length) return
    try {
      await adminApi.post('/leads/bulk-delete', { ids: selectedRowKeys.map(k => Number(k)) })
      message.success(`${selectedRowKeys.length} leads deleted`)
      setSelectedRowKeys([])
      fetchLeads()
    } catch (e: any) {
      message.error(e?.response?.data?.error || 'Failed to delete selected leads')
    }
  }

  const handleBulkStatusChange = async () => {
    if (!selectedRowKeys.length) return
    try {
      await adminApi.post('/leads/bulk-status', {
        ids: selectedRowKeys.map(k => Number(k)),
        status: bulkStatusVal,
      })
      message.success(`${selectedRowKeys.length} leads updated to ${bulkStatusVal}`)
      setSelectedRowKeys([])
      setBulkStatusOpen(false)
      fetchLeads()
    } catch (e: any) {
      message.error(e?.response?.data?.error || 'Failed to update selected leads')
    }
  }

  const handleExportCSV = () => {
    if (!leads.length) {
      message.warning('No leads available to export')
      return
    }
    const headers = ['ID', 'Contact Name', 'Phone', 'Email', 'Source Username', 'Status', 'Notes', 'Created At']
    const rows = leads.map(l => [
      l.id,
      `"${l.contact_name || ''}"`,
      `"${l.contact_phone || ''}"`,
      `"${l.contact_email || ''}"`,
      `"${l.source_username || ''}"`,
      l.status,
      `"${(l.notes || '').replace(/"/g, '""')}"`,
      new Date(l.created_at).toLocaleString(),
    ])

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map(e => e.join(','))].join('\n')
    const encodedUri = encodeURI(csvContent)
    const link = document.createElement('a')
    link.setAttribute('href', encodedUri)
    link.setAttribute('download', `marketing_leads_${new Date().toISOString().slice(0,10)}.csv`)
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    message.success('Leads exported to CSV!')
  }

  const statusColorMap: Record<string, string> = {
    new: 'blue',
    contacted: 'orange',
    interested: 'purple',
    converted: 'green',
    rejected: 'red',
  }

  const columns = [
    {
      title: 'Contact Name',
      dataIndex: 'contact_name',
      render: (name: string) => <span style={{ fontWeight: 600 }}>{name}</span>,
    },
    {
      title: 'Phone Number',
      dataIndex: 'contact_phone',
      render: (phone: string) => {
        const cleanPhone = phone.replace(/[^\d+]/g, '')
        return (
          <Space>
            <Tag color="blue" style={{ fontSize: 12 }}>{phone}</Tag>
            <Tooltip title="Chat on WhatsApp">
              <Button
                type="text"
                size="small"
                icon={<WhatsAppOutlined style={{ color: '#25D366' }} />}
                href={`https://wa.me/${cleanPhone}`}
                target="_blank"
              />
            </Tooltip>
            <Tooltip title="Copy Phone">
              <Button
                type="text"
                size="small"
                icon={<CopyOutlined />}
                onClick={() => {
                  navigator.clipboard.writeText(phone)
                  message.success('Phone copied')
                }}
              />
            </Tooltip>
          </Space>
        )
      },
    },
    {
      title: 'Email',
      dataIndex: 'contact_email',
      render: (email: string) => email || '-',
    },
    {
      title: 'Source Player',
      key: 'source_username',
      render: (record: Lead) => (
        record.source_user_id ? (
          <Button
            type="link"
            size="small"
            icon={<UserOutlined />}
            href={`/admin/users/view/${record.source_user_id}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            {record.source_username || 'Player View'}
          </Button>
        ) : (
          <Tag color="default">Manual Lead</Tag>
        )
      ),
    },
    {
      title: 'Status',
      dataIndex: 'status',
      render: (status: string, record: Lead) => (
        <Select
          size="small"
          value={status}
          style={{ width: 120 }}
          onChange={async (newStatus) => {
            try {
              await adminApi.patch(`/leads/${record.id}`, { status: newStatus })
              message.success('Status updated')
              fetchLeads()
            } catch (e: any) {
              message.error('Failed to update status')
            }
          }}
        >
          <Select.Option value="new"><Tag color="blue">NEW</Tag></Select.Option>
          <Select.Option value="contacted"><Tag color="orange">CONTACTED</Tag></Select.Option>
          <Select.Option value="interested"><Tag color="purple">INTERESTED</Tag></Select.Option>
          <Select.Option value="converted"><Tag color="green">CONVERTED</Tag></Select.Option>
          <Select.Option value="rejected"><Tag color="red">REJECTED</Tag></Select.Option>
        </Select>
      ),
    },
    {
      title: 'Notes',
      dataIndex: 'notes',
      ellipsis: true,
      render: (notes: string) => notes || '-',
    },
    {
      title: 'Pushed / Created',
      dataIndex: 'created_at',
      render: (d: string) => new Date(d).toLocaleDateString(),
    },
    {
      title: 'Actions',
      key: 'actions',
      render: (r: Lead) => (
        <Space>
          <Button
            size="small"
            icon={<EditOutlined />}
            onClick={() => {
              setEditLead(r)
              editForm.setFieldsValue({
                status: r.status,
                notes: r.notes,
              })
            }}
          />
          <Popconfirm title="Delete this lead?" onConfirm={() => handleDeleteLead(r.id)}>
            <Button size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ]

  // Counts
  const newCount = leads.filter(l => l.status === 'new').length
  const contactedCount = leads.filter(l => l.status === 'contacted').length
  const convertedCount = leads.filter(l => l.status === 'converted').length

  return (
    <div style={{ paddingBottom: 40 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <h2 style={{ margin: 0, fontWeight: 800, color: tokens.color.textPrimary }}>
            Lead Manager
          </h2>
          <Typography.Text type="secondary" style={{ fontSize: 13 }}>
            Aggregated user contacts synced for marketing campaigns, conversion pipelines & outbound leads
          </Typography.Text>
        </div>
        <Space wrap>
          <Button icon={<ExportOutlined />} onClick={handleExportCSV}>
            Export CSV
          </Button>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            style={{ borderRadius: 8, background: tokens.color.gold, borderColor: tokens.color.gold }}
            onClick={() => setAddModalOpen(true)}
          >
            Add Manual Lead
          </Button>
        </Space>
      </div>

      {/* KPI Cards */}
      <Row gutter={[16, 16]} style={{ marginBottom: 20 }}>
        <Col xs={12} sm={6}>
          <Card size="small" style={{ borderRadius: 12 }}>
            <Typography.Text type="secondary" style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase' }}>
              Total Leads
            </Typography.Text>
            <div style={{ fontSize: 22, fontWeight: 800, color: tokens.color.textPrimary, marginTop: 2 }}>
              {total.toLocaleString()}
            </div>
          </Card>
        </Col>

        <Col xs={12} sm={6}>
          <Card size="small" style={{ borderRadius: 12 }}>
            <Typography.Text type="secondary" style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase' }}>
              New Uncontacted
            </Typography.Text>
            <div style={{ fontSize: 22, fontWeight: 800, color: tokens.color.info, marginTop: 2 }}>
              {newCount}
            </div>
          </Card>
        </Col>

        <Col xs={12} sm={6}>
          <Card size="small" style={{ borderRadius: 12 }}>
            <Typography.Text type="secondary" style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase' }}>
              In Follow Up
            </Typography.Text>
            <div style={{ fontSize: 22, fontWeight: 800, color: '#fa8c16', marginTop: 2 }}>
              {contactedCount}
            </div>
          </Card>
        </Col>

        <Col xs={12} sm={6}>
          <Card size="small" style={{ borderRadius: 12 }}>
            <Typography.Text type="secondary" style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase' }}>
              Converted Players
            </Typography.Text>
            <div style={{ fontSize: 22, fontWeight: 800, color: tokens.color.emerald, marginTop: 2 }}>
              {convertedCount}
            </div>
          </Card>
        </Col>
      </Row>

      {/* Search & Actions Bar */}
      <Card style={{ borderRadius: 12, marginBottom: 20 }}>
        <Space style={{ width: '100%', justifyContent: 'space-between' }} wrap>
          <Space wrap>
            <Input.Search
              placeholder="Search contact name, phone, or player..."
              onSearch={setSearch}
              style={{ width: 300, borderRadius: 8 }}
              enterButton={<SearchOutlined />}
              allowClear
            />
            <Select
              placeholder="Filter Status"
              allowClear
              style={{ width: 160 }}
              onChange={(v) => setStatusFilter(v || '')}
            >
              <Select.Option value="new">New</Select.Option>
              <Select.Option value="contacted">Contacted</Select.Option>
              <Select.Option value="interested">Interested</Select.Option>
              <Select.Option value="converted">Converted</Select.Option>
              <Select.Option value="rejected">Rejected</Select.Option>
            </Select>
          </Space>

          <Space wrap>
            <Button icon={<ReloadOutlined />} onClick={() => fetchLeads()} loading={loading}>
              Refresh
            </Button>
            {selectedRowKeys.length > 0 && (
              <>
                <Button onClick={() => setBulkStatusOpen(true)}>
                  Update Status ({selectedRowKeys.length})
                </Button>
                <Popconfirm title={`Delete ${selectedRowKeys.length} selected leads?`} onConfirm={handleBulkDelete}>
                  <Button danger icon={<DeleteOutlined />}>
                    Delete Selected ({selectedRowKeys.length})
                  </Button>
                </Popconfirm>
              </>
            )}
          </Space>
        </Space>
      </Card>

      {/* Leads Table */}
      <Table
        dataSource={leads}
        columns={columns as any}
        rowKey="id"
        loading={loading}
        pagination={{
          total,
          pageSize: 20,
          current: page,
          onChange: setPage,
        }}
        size="small"
        scroll={{ x: 'max-content' }}
        rowSelection={{
          selectedRowKeys,
          onChange: setSelectedRowKeys,
        }}
      />

      {/* Add Lead Modal */}
      <Modal
        title="Add Manual Marketing Lead"
        open={addModalOpen}
        onCancel={() => setAddModalOpen(false)}
        onOk={() => form.submit()}
      >
        <Form form={form} layout="vertical" onFinish={handleCreateLead} initialValues={{ status: 'new' }}>
          <Form.Item name="contact_name" label="Contact Name" rules={[{ required: true, message: 'Required' }]}>
            <Input placeholder="e.g. Aarav Sharma" />
          </Form.Item>
          <Form.Item name="contact_phone" label="Phone Number" rules={[{ required: true, message: 'Required' }]}>
            <Input placeholder="e.g. +91 98765 43210" />
          </Form.Item>
          <Form.Item name="contact_email" label="Email Address">
            <Input placeholder="e.g. aarav@example.com" />
          </Form.Item>
          <Form.Item name="status" label="Initial Lead Status">
            <Select>
              <Select.Option value="new">New</Select.Option>
              <Select.Option value="contacted">Contacted</Select.Option>
              <Select.Option value="interested">Interested</Select.Option>
              <Select.Option value="converted">Converted</Select.Option>
              <Select.Option value="rejected">Rejected</Select.Option>
            </Select>
          </Form.Item>
          <Form.Item name="notes" label="Notes / Campaign Source">
            <Input.TextArea rows={2} placeholder="e.g. Collected via WhatsApp promo event" />
          </Form.Item>
        </Form>
      </Modal>

      {/* Edit Lead Modal */}
      <Modal
        title={`Edit Lead — ${editLead?.contact_name}`}
        open={!!editLead}
        onCancel={() => setEditLead(null)}
        onOk={() => editForm.submit()}
      >
        <Form form={editForm} layout="vertical" onFinish={handleUpdateLead}>
          <Form.Item name="status" label="Lead Status" rules={[{ required: true }]}>
            <Select>
              <Select.Option value="new">New</Select.Option>
              <Select.Option value="contacted">Contacted</Select.Option>
              <Select.Option value="interested">Interested</Select.Option>
              <Select.Option value="converted">Converted</Select.Option>
              <Select.Option value="rejected">Rejected</Select.Option>
            </Select>
          </Form.Item>
          <Form.Item name="notes" label="Notes">
            <Input.TextArea rows={3} placeholder="Add follow-up notes or response status..." />
          </Form.Item>
        </Form>
      </Modal>

      {/* Bulk Status Modal */}
      <Modal
        title={`Bulk Change Status (${selectedRowKeys.length} Leads)`}
        open={bulkStatusOpen}
        onCancel={() => setBulkStatusOpen(false)}
        onOk={handleBulkStatusChange}
      >
        <p>Select new status for all {selectedRowKeys.length} selected leads:</p>
        <Select
          style={{ width: '100%' }}
          value={bulkStatusVal}
          onChange={(v) => setBulkStatusVal(v as any)}
        >
          <Select.Option value="new">New</Select.Option>
          <Select.Option value="contacted">Contacted</Select.Option>
          <Select.Option value="interested">Interested</Select.Option>
          <Select.Option value="converted">Converted</Select.Option>
          <Select.Option value="rejected">Rejected</Select.Option>
        </Select>
      </Modal>
    </div>
  )
}
