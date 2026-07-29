import { useEffect, useState } from 'react'
import {
  Card, Tabs, Table, Tag, Button, Modal, Form, Input, Select, Space, message, Popconfirm,
  Switch, InputNumber, Divider, Typography
} from 'antd'
import { PlusOutlined, FileTextOutlined, NotificationOutlined } from '@ant-design/icons'
import { adminApi } from '../api/client'

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
      <Table dataSource={pages} columns={columns} rowKey="slug" size="small" pagination={false} scroll={{ x: 'max-content' }} />

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
      <Table dataSource={banners} columns={columns} rowKey="id" size="small" pagination={{ pageSize: 20 }} scroll={{ x: 'max-content' }} />

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

export default function CMSManagement() {
  return (
    <Card title="CMS Management">
      <Tabs defaultActiveKey="pages" items={[
        { key: 'pages', label: <><FileTextOutlined /> CMS Pages</>, children: <PagesTab /> },
        { key: 'banners', label: <><NotificationOutlined /> Banners</>, children: <BannersTab /> },
      ]} />
    </Card>
  )
}
