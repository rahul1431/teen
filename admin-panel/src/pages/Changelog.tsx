import { useEffect, useState } from 'react'
import { Card, Table, Tabs, Button, Modal, Form, Input, Select, Tag, Space, Timeline, Typography, message, Popconfirm, Row, Col } from 'antd'
import { HistoryOutlined, PlusOutlined, DeleteOutlined, InfoCircleOutlined } from '@ant-design/icons'
import { adminApi } from '../api/client'
import { useAuthStore } from '../store/auth'

const { Text, Title, Paragraph } = Typography

const PLATFORM_COLOR: Record<string, string> = {
  mobile: 'blue',
  admin: 'orange',
  server: 'purple',
}

const PLATFORM_LABEL: Record<string, string> = {
  mobile: '📱 Mobile App',
  admin: '💻 Admin Panel',
  server: '⚙️ Server Backend',
}

export default function Changelog() {
  const { admin } = useAuthStore()
  const isSuper = admin?.role === 'superadmin'
  
  const [gitCommits, setGitCommits] = useState<any[]>([])
  const [changelogs, setChangelogs] = useState<any[]>([])
  const [loadingGit, setLoadingGit] = useState(false)
  const [loadingNotes, setLoadingNotes] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [form] = Form.useForm()

  const loadGitLogs = async () => {
    setLoadingGit(true)
    try {
      const res = await adminApi.get('/changelogs/git')
      setGitCommits(res.data.commits || [])
      if (res.data.error) {
        message.warning(res.data.error)
      }
    } catch {
      message.error('Failed to load server git commits')
    } finally {
      setLoadingGit(false)
    }
  }

  const loadReleaseNotes = async () => {
    setLoadingNotes(true)
    try {
      const res = await adminApi.get('/changelogs')
      setChangelogs(res.data || [])
    } catch {
      message.error('Failed to load release notes')
    } finally {
      setLoadingNotes(false)
    }
  }

  useEffect(() => {
    loadGitLogs()
    loadReleaseNotes()
  }, [])

  const handleCreateNote = async (v: any) => {
    try {
      await adminApi.post('/changelogs', v)
      message.success('Release note added successfully!')
      setCreateOpen(false)
      form.resetFields()
      loadReleaseNotes()
    } catch (e: any) {
      message.error(e.response?.data?.error || 'Failed to save release note')
    }
  }

  const handleDeleteNote = async (id: string) => {
    try {
      await adminApi.delete(`/changelogs/${id}`)
      message.success('Release note deleted')
      loadReleaseNotes()
    } catch {
      message.error('Failed to delete release note')
    }
  }

  const gitColumns = [
    { title: 'Hash', dataIndex: 'hash', width: 90, render: (h: string) => <Tag color="geekblue">{h}</Tag> },
    { title: 'Commit Message', dataIndex: 'message', render: (m: string) => <b>{m}</b> },
    { title: 'Author', dataIndex: 'author', width: 140 },
    { title: 'Time Ago', dataIndex: 'date', width: 180 },
  ]

  const releaseItems = changelogs.map((note) => ({
    label: (
      <div style={{ textAlign: 'right' }}>
        <Text strong style={{ fontSize: 16 }}>{note.version}</Text>
        <div style={{ fontSize: 11, color: '#aaa' }}>{new Date(note.created_at).toLocaleDateString()}</div>
      </div>
    ),
    children: (
      <Card style={{ marginBottom: 16, borderLeft: '3px solid #d4af37' }} size="small">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <Space>
            <Tag color={PLATFORM_COLOR[note.platform] || 'default'}>
              {PLATFORM_LABEL[note.platform] || note.platform.toUpperCase()}
            </Tag>
            <Text strong style={{ fontSize: 15 }}>{note.title}</Text>
          </Space>
          {isSuper && (
            <Popconfirm title="Delete this release note?" onConfirm={() => handleDeleteNote(note.id)}>
              <Button size="small" type="text" danger icon={<DeleteOutlined />} />
            </Popconfirm>
          )}
        </div>
        <Paragraph style={{ margin: 0, whiteSpace: 'pre-wrap', color: '#555' }}>
          {note.description}
        </Paragraph>
        <div style={{ marginTop: 8, textAlign: 'right', fontSize: 11, color: '#999' }}>
          Released by: <i>{note.released_by}</i>
        </div>
      </Card>
    ),
  }))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 style={{ color: '#d4af37', margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
          <HistoryOutlined /> Platform Changelogs & Updates
        </h2>
        {isSuper && (
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>
            Add Release Note
          </Button>
        )}
      </div>

      <Tabs defaultActiveKey="notes" items={[
        {
          key: 'notes',
          label: '📜 Official Release Notes',
          children: (
            <Card title="Official Releases" extra={<Button onClick={loadReleaseNotes}>Refresh</Button>} loading={loadingNotes}>
              {changelogs.length === 0 ? (
                <div style={{ textAlign: 'center', padding: 24, color: '#999' }}>
                  <InfoCircleOutlined style={{ fontSize: 24, marginBottom: 8 }} />
                  <p>No official release notes published yet.</p>
                </div>
              ) : (
                <Timeline mode="left" items={releaseItems} style={{ marginTop: 24 }} />
              )}
            </Card>
          )
        },
        {
          key: 'commits',
          label: '🚀 Server Deploy History (Git)',
          children: (
            <Card title="Pushed Server Commits (Git Log)" extra={<Button onClick={loadGitLogs}>Refresh Commits</Button>} loading={loadingGit}>
              <Table 
                rowKey="hash"
                dataSource={gitCommits}
                columns={gitColumns}
                size="small"
                pagination={{ pageSize: 15 }}
                locale={{ emptyText: 'No commit records retrieved from server' }}
              />
            </Card>
          )
        }
      ]} />

      <Modal title="Publish Release Note" open={createOpen} onCancel={() => setCreateOpen(false)} onOk={() => form.submit()} okText="Publish">
        <Form form={form} layout="vertical" onFinish={handleCreateNote}>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="version" label="Version" rules={[{ required: true }]} initialValue="1.2.0">
                <Input placeholder="e.g. 1.2.0" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="platform" label="Platform" rules={[{ required: true }]} initialValue="mobile">
                <Select options={[
                  { value: 'mobile', label: '📱 Mobile App' },
                  { value: 'admin', label: '💻 Admin Panel' },
                  { value: 'server', label: '⚙️ Server Backend' },
                ]} />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="title" label="Title" rules={[{ required: true }]} initialValue="UI Upgrades & Performance Fixes">
            <Input placeholder="e.g. Added Matka Lottery Game" />
          </Form.Item>
          <Form.Item name="description" label="Detailed Changelog Description" rules={[{ required: true }]}>
            <Input.TextArea rows={6} placeholder="Describe the updates in detail (markdown or bullets recommended)..." />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}
