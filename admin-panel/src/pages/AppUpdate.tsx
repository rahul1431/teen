import { useState, useEffect, useRef } from 'react'
import {
  Card, Button, Form, Input, InputNumber, Switch, Upload, Table, Tag,
  Typography, Space, Row, Col, Progress, Statistic, message, Divider
} from 'antd'
import { UploadOutlined, AndroidOutlined, LinkOutlined, CheckCircleOutlined } from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'
import { useAuthStore } from '../store/auth'

const { Title, Text } = Typography
const API = import.meta.env.VITE_API_URL || ''

interface AppVersion {
  id: number
  version_name: string
  version_code: number
  download_url: string
  release_notes: string | null
  force_update: boolean
  created_at: string
}

interface CurrentVersion {
  version_name: string
  version_code: number
  download_url: string
  force_update: boolean
}

export default function AppUpdate() {
  const { token } = useAuthStore()
  const [versions, setVersions] = useState<AppVersion[]>([])
  const [current, setCurrent] = useState<CurrentVersion | null>(null)
  const [uploading, setUploading] = useState(false)
  const [progress, setProgress] = useState(0)
  const [apkFile, setApkFile] = useState<File | null>(null)
  const [form] = Form.useForm()
  const xhrRef = useRef<XMLHttpRequest | null>(null)

  useEffect(() => {
    fetchVersions()
    fetchCurrent()
  }, [])

  async function fetchVersions() {
    try {
      const res = await fetch(`${API}/api/admin/app/versions`, { headers: { Authorization: `Bearer ${token}` } })
      if (res.ok) setVersions(await res.json())
    } catch {}
  }

  async function fetchCurrent() {
    try {
      const res = await fetch(`${API}/api/app/version`)
      if (res.ok) setCurrent(await res.json())
    } catch {}
  }

  function handleUpload(values: { version_name: string; version_code: number; release_notes?: string; force_update?: boolean }) {
    if (!apkFile) { message.error('Please select an APK file'); return }
    if (!values.version_name || !values.version_code) { message.error('Version name and code are required'); return }

    const fd = new FormData()
    fd.append('apk', apkFile)
    fd.append('version_name', values.version_name)
    fd.append('version_code', String(values.version_code))
    fd.append('release_notes', values.release_notes || '')
    fd.append('force_update', String(values.force_update ?? false))

    const xhr = new XMLHttpRequest()
    xhrRef.current = xhr
    setUploading(true)
    setProgress(0)

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) setProgress(Math.round((e.loaded / e.total) * 100))
    }

    xhr.onload = () => {
      setUploading(false)
      setProgress(0)
      if (xhr.status === 200) {
        message.success(`v${values.version_name} uploaded — users will see update prompt!`)
        form.resetFields()
        setApkFile(null)
        fetchVersions()
        fetchCurrent()
      } else {
        try { message.error(JSON.parse(xhr.responseText).error || 'Upload failed') }
        catch { message.error('Upload failed') }
      }
    }

    xhr.onerror = () => { setUploading(false); message.error('Network error') }
    xhr.open('POST', `${API}/api/admin/app/upload`)
    xhr.setRequestHeader('Authorization', `Bearer ${token}`)
    xhr.send(fd)
  }

  const columns: ColumnsType<AppVersion> = [
    { title: 'Version', dataIndex: 'version_name', render: (v, r) => <><strong>{v}</strong> <Text type="secondary">(code {r.version_code})</Text></> },
    { title: 'Force Update', dataIndex: 'force_update', render: (v) => v ? <Tag color="red">Force</Tag> : <Tag color="green">Optional</Tag> },
    { title: 'Release Notes', dataIndex: 'release_notes', render: (v) => v || <Text type="secondary">—</Text> },
    { title: 'Download', dataIndex: 'download_url', render: (v) => <a href={v} target="_blank" rel="noreferrer"><LinkOutlined /> APK</a> },
    { title: 'Uploaded', dataIndex: 'created_at', render: (v) => new Date(v).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) },
  ]

  const downloadUrl = current?.download_url || `${window.location.origin}/downloads/app-release.apk`

  return (
    <div style={{ padding: 24 }}>
      <Title level={3}><AndroidOutlined /> App Update Manager</Title>

      <Row gutter={16} style={{ marginBottom: 24 }}>
        <Col span={6}>
          <Card>
            <Statistic title="Current Live Version" value={current?.version_name ?? '—'} prefix={<CheckCircleOutlined style={{ color: '#52c41a' }} />} />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic title="Version Code" value={current?.version_code ?? 0} />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic title="Update Type" value={current?.force_update ? 'Force Update' : 'Optional'} valueStyle={{ color: current?.force_update ? '#ff4d4f' : '#52c41a' }} />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <div style={{ marginBottom: 8 }}><Text strong>Download Link</Text></div>
            <Space direction="vertical" style={{ width: '100%' }}>
              <a href={downloadUrl} target="_blank" rel="noreferrer" style={{ wordBreak: 'break-all', fontSize: 12 }}>{downloadUrl}</a>
              <Button size="small" icon={<LinkOutlined />} onClick={() => { navigator.clipboard.writeText(downloadUrl); message.success('Copied!') }}>Copy</Button>
            </Space>
          </Card>
        </Col>
      </Row>

      <Row gutter={24}>
        <Col span={10}>
          <Card title="Upload New APK">
            <Form form={form} layout="vertical" onFinish={handleUpload}>
              <Form.Item label="Select APK File" required>
                <Upload
                  accept=".apk"
                  maxCount={1}
                  beforeUpload={(file) => { setApkFile(file); return false }}
                  onRemove={() => setApkFile(null)}
                  fileList={apkFile ? [{ uid: '-1', name: apkFile.name, status: 'done', size: apkFile.size }] : []}
                >
                  <Button icon={<UploadOutlined />} disabled={uploading}>Select APK File</Button>
                </Upload>
                {apkFile && <Text type="secondary" style={{ display: 'block', marginTop: 4 }}>Size: {(apkFile.size / 1024 / 1024).toFixed(1)} MB</Text>}
              </Form.Item>

              <Row gutter={12}>
                <Col span={12}>
                  <Form.Item label="Version Name" name="version_name" rules={[{ required: true, message: 'e.g. 1.2.0' }]}>
                    <Input placeholder="1.2.0" />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item label="Version Code" name="version_code" rules={[{ required: true, type: 'number', min: 1 }]}>
                    <InputNumber placeholder="2" style={{ width: '100%' }} min={1} />
                  </Form.Item>
                </Col>
              </Row>

              <Form.Item label="Release Notes" name="release_notes">
                <Input.TextArea rows={3} placeholder="Bug fixes and performance improvements" />
              </Form.Item>

              <Form.Item label="Force Update (users cannot skip)" name="force_update" valuePropName="checked">
                <Switch />
              </Form.Item>

              {uploading && <Progress percent={progress} style={{ marginBottom: 12 }} />}

              <Form.Item>
                <Button type="primary" htmlType="submit" icon={<UploadOutlined />} loading={uploading} block size="large">
                  {uploading ? `Uploading… ${progress}%` : 'Upload & Publish'}
                </Button>
              </Form.Item>
            </Form>

            <Divider />
            <Text type="secondary" style={{ fontSize: 12 }}>
              After uploading, users will see an update dialog on next app launch.
              The referral download link automatically points to this APK.
            </Text>
          </Card>
        </Col>

        <Col span={14}>
          <Card title="Version History">
            <Table
              dataSource={versions}
              columns={columns}
              rowKey="id"
              size="small"
              pagination={{ pageSize: 10 }}
              locale={{ emptyText: 'No versions uploaded yet' }}
            />
          </Card>
        </Col>
      </Row>
    </div>
  )
}
