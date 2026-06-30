import { useEffect, useState, useRef } from 'react'
import {
  Card, Button, Table, Switch, InputNumber, Space, Typography, Tag,
  message, Upload, Modal, Form, Input, Select, Tooltip, Image,
} from 'antd'
import {
  PlusOutlined, EditOutlined, DeleteOutlined, PictureOutlined,
  LinkOutlined, UploadOutlined,
} from '@ant-design/icons'
import { useAuthStore } from '../store/auth'

const { Title, Text } = Typography

interface Banner {
  id: string
  title: string
  subtitle: string
  image_url: string
  click_url: string
  click_type: string
  sort_order: number
  is_active: boolean
}

export default function Banners() {
  const { token } = useAuthStore()
  const [banners, setBanners] = useState<Banner[]>([])
  const [loading, setLoading] = useState(true)
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<Banner | null>(null)
  const [saving, setSaving] = useState(false)
  const [form] = Form.useForm()
  const fileRef = useRef<HTMLInputElement>(null)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string>('')

  const headers = { Authorization: `Bearer ${token}` }

  const fetch = async () => {
    setLoading(true)
    try {
      const res = await window.fetch('/api/admin/banners', { headers })
      setBanners(await res.json())
    } catch { message.error('Failed to load banners') }
    finally { setLoading(false) }
  }

  useEffect(() => { fetch() }, [])

  const openCreate = () => {
    setEditing(null)
    setSelectedFile(null)
    setPreviewUrl('')
    form.resetFields()
    setModalOpen(true)
  }

  const openEdit = (b: Banner) => {
    setEditing(b)
    setSelectedFile(null)
    setPreviewUrl('')
    form.setFieldsValue(b)
    setModalOpen(true)
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (!f) return
    setSelectedFile(f)
    setPreviewUrl(URL.createObjectURL(f))
  }

  const save = async () => {
    const values = await form.validateFields()
    setSaving(true)
    try {
      if (editing) {
        // Update metadata only (image stays unless re-uploaded separately)
        const res = await window.fetch(`/api/admin/banners/${editing.id}`, {
          method: 'PUT',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify(values),
        })
        if (!res.ok) throw new Error(await res.text())
      } else {
        if (!selectedFile) { message.warning('Please select an image'); return }
        const fd = new FormData()
        fd.append('image', selectedFile)
        Object.entries(values).forEach(([k, v]) => v != null && fd.append(k, String(v)))
        const res = await window.fetch('/api/admin/banners', { method: 'POST', headers, body: fd })
        if (!res.ok) throw new Error(await res.text())
      }
      message.success('Saved!')
      setModalOpen(false)
      fetch()
    } catch (e: any) {
      message.error(e.message || 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  const remove = async (id: string) => {
    Modal.confirm({
      title: 'Delete this banner?',
      onOk: async () => {
        await window.fetch(`/api/admin/banners/${id}`, { method: 'DELETE', headers })
        message.success('Deleted')
        fetch()
      },
    })
  }

  const toggleActive = async (b: Banner) => {
    await window.fetch(`/api/admin/banners/${b.id}`, {
      method: 'PUT',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_active: !b.is_active }),
    })
    fetch()
  }

  const resolve = (url: string) => {
    if (!url) return ''
    if (url.startsWith('http')) return url
    return `${window.location.origin}${url}`
  }

  const columns = [
    {
      title: 'Preview',
      dataIndex: 'image_url',
      width: 100,
      render: (url: string) => url
        ? <Image src={resolve(url)} width={80} height={48} style={{ objectFit: 'cover', borderRadius: 6 }} />
        : <div style={{ width: 80, height: 48, background: '#1e1e2e', borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><PictureOutlined style={{ color: '#555' }} /></div>,
    },
    { title: 'Title', dataIndex: 'title', render: (v: string, b: Banner) => (
      <Space direction="vertical" size={2}>
        <Text style={{ color: '#fff' }}>{v || <Text style={{ color: '#555' }}>No title</Text>}</Text>
        {b.subtitle && <Text style={{ color: '#8b949e', fontSize: 12 }}>{b.subtitle}</Text>}
      </Space>
    )},
    { title: 'Click Action', render: (_: any, b: Banner) => b.click_url
      ? <Space><Tag color={b.click_type === 'route' ? 'blue' : 'purple'}>{b.click_type}</Tag><Text style={{ color: '#8b949e', fontSize: 12 }}>{b.click_url}</Text></Space>
      : <Text style={{ color: '#555' }}>None</Text>
    },
    { title: 'Order', dataIndex: 'sort_order', width: 80, render: (v: number) => <Tag>{v}</Tag> },
    { title: 'Active', dataIndex: 'is_active', width: 80,
      render: (v: boolean, b: Banner) => <Switch checked={v} size="small" onChange={() => toggleActive(b)} /> },
    { title: '', width: 100, render: (_: any, b: Banner) => (
      <Space>
        <Tooltip title="Edit"><Button size="small" icon={<EditOutlined />} onClick={() => openEdit(b)} /></Tooltip>
        <Tooltip title="Delete"><Button size="small" danger icon={<DeleteOutlined />} onClick={() => remove(b.id)} /></Tooltip>
      </Space>
    )},
  ]

  return (
    <div style={{ padding: 24, background: '#0d1117', minHeight: '100vh' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
        <div>
          <Title level={3} style={{ color: '#fff', margin: 0 }}>
            <PictureOutlined style={{ color: '#d4af37', marginRight: 10 }} />
            Home Banners
          </Title>
          <Text style={{ color: '#8b949e' }}>
            Manage the hero banner carousel on the app's home page
          </Text>
        </div>
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}
          style={{ background: '#d4af37', borderColor: '#d4af37', color: '#000', fontWeight: 700 }}>
          Add Banner
        </Button>
      </div>

      <Card style={{ background: '#161b22', border: '1px solid #30363d' }}>
        <Table
          dataSource={banners}
          columns={columns}
          rowKey="id"
          loading={loading}
          pagination={false}
          size="small"
        />
      </Card>

      <Modal
        title={<Text style={{ color: '#fff' }}>{editing ? 'Edit Banner' : 'Add Banner'}</Text>}
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={save}
        confirmLoading={saving}
        styles={{ body: { background: '#161b22' }, content: { background: '#161b22', border: '1px solid #30363d' }, header: { background: '#161b22', borderBottom: '1px solid #30363d' } }}
        okButtonProps={{ style: { background: '#d4af37', borderColor: '#d4af37', color: '#000' } }}
      >
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          {!editing && (
            <Form.Item label={<Text style={{ color: '#8b949e' }}>Banner Image *</Text>}>
              <input ref={fileRef} type="file" accept="image/*" onChange={handleFileChange} style={{ display: 'none' }} />
              <Button icon={<UploadOutlined />} onClick={() => fileRef.current?.click()}>
                {selectedFile ? selectedFile.name : 'Choose Image (jpg/png/webp)'}
              </Button>
              {previewUrl && <img src={previewUrl} style={{ marginTop: 8, width: '100%', height: 120, objectFit: 'cover', borderRadius: 8 }} />}
            </Form.Item>
          )}
          <Form.Item name="title" label={<Text style={{ color: '#8b949e' }}>Title</Text>}>
            <Input placeholder="e.g. Play & Win Big!" style={{ background: '#0d1117', color: '#fff', border: '1px solid #30363d' }} />
          </Form.Item>
          <Form.Item name="subtitle" label={<Text style={{ color: '#8b949e' }}>Subtitle</Text>}>
            <Input placeholder="e.g. Get ₹100 bonus on first deposit" style={{ background: '#0d1117', color: '#fff', border: '1px solid #30363d' }} />
          </Form.Item>
          <Form.Item name="click_url" label={<Text style={{ color: '#8b949e' }}>Click URL / Route</Text>}>
            <Input prefix={<LinkOutlined />} placeholder="e.g. /referral or https://..." style={{ background: '#0d1117', color: '#fff', border: '1px solid #30363d' }} />
          </Form.Item>
          <Form.Item name="click_type" label={<Text style={{ color: '#8b949e' }}>Click Type</Text>} initialValue="route">
            <Select style={{ background: '#0d1117' }} options={[
              { value: 'route', label: '📱 In-App Route' },
              { value: 'url', label: '🌐 External URL' },
              { value: 'none', label: '🚫 Not Clickable' },
            ]} />
          </Form.Item>
          <Form.Item name="sort_order" label={<Text style={{ color: '#8b949e' }}>Sort Order (lower = first)</Text>} initialValue={0}>
            <InputNumber min={0} max={99} style={{ width: '100%', background: '#0d1117', color: '#fff' }} />
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
