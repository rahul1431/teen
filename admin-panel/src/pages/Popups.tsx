import { useEffect, useState, useRef } from 'react'
import {
  Card,
  Button,
  Table,
  Switch,
  InputNumber,
  Space,
  Typography,
  Tag,
  message,
  Modal,
  Form,
  Input,
  Select,
  Image,
  Popconfirm,
  Row,
  Col,
  Divider,
} from 'antd'
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  NotificationOutlined,
  LinkOutlined,
  UploadOutlined,
  MobileOutlined,
  UserOutlined,
  TeamOutlined,
  EyeOutlined,
  ClockCircleOutlined,
  CompassOutlined,
  GiftOutlined,
} from '@ant-design/icons'
import { useAuthStore } from '../store/auth'

const { Title, Text } = Typography

export interface AppPopup {
  id: string
  title: string
  body: string | null
  image_url: string | null
  button_text: string | null
  button_link: string | null
  target_audience: 'all' | 'player' | 'agent'
  display_type: 'modal' | 'bottom_sheet'
  target_page: string
  delay_seconds: number
  action_type: 'navigate' | 'claim_bonus' | 'join_game' | 'external_link' | 'close'
  sort_order: number
  is_active: boolean
  starts_at?: string | null
  ends_at?: string | null
  created_at: string
}

export default function Popups() {
  const { token } = useAuthStore()
  const [popups, setPopups] = useState<AppPopup[]>([])
  const [loading, setLoading] = useState(true)
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<AppPopup | null>(null)
  const [saving, setSaving] = useState(false)
  const [form] = Form.useForm()
  const fileRef = useRef<HTMLInputElement>(null)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string>('')
  const [targetFilter, setTargetFilter] = useState<string>('all')

  const headers = { Authorization: `Bearer ${token}` }

  const fetchPopups = async () => {
    setLoading(true)
    try {
      let url = '/api/admin/popups'
      if (targetFilter !== 'all') url += `?target_audience=${targetFilter}`
      const res = await window.fetch(url, { headers })
      if (!res.ok) throw new Error(await res.text())
      setPopups(await res.json())
    } catch {
      message.error('Failed to load popups')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchPopups()
  }, [targetFilter])

  const openCreate = () => {
    setEditing(null)
    setSelectedFile(null)
    setPreviewUrl('')
    form.resetFields()
    form.setFieldsValue({
      target_audience: 'all',
      target_page: 'all',
      delay_seconds: 2,
      action_type: 'navigate',
      display_type: 'modal',
      sort_order: 0,
      is_active: true,
      button_text: 'Claim Now',
      button_link: '/deposit',
    })
    setModalOpen(true)
  }

  const openEdit = (p: AppPopup) => {
    setEditing(p)
    setSelectedFile(null)
    setPreviewUrl(p.image_url || '')
    form.setFieldsValue({
      ...p,
      target_page: p.target_page || 'all',
      delay_seconds: p.delay_seconds ?? 2,
      action_type: p.action_type || 'navigate',
    })
    setModalOpen(true)
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (!f) return
    setSelectedFile(f)
    setPreviewUrl(URL.createObjectURL(f))
  }

  const handleToggle = async (id: string) => {
    try {
      const res = await window.fetch(`/api/admin/popups/${id}/toggle`, {
        method: 'PATCH',
        headers,
      })
      if (!res.ok) throw new Error(await res.text())
      message.success('Popup status toggled')
      fetchPopups()
    } catch (e: any) {
      message.error(e.message || 'Toggle failed')
    }
  }

  const handleDelete = async (id: string) => {
    try {
      const res = await window.fetch(`/api/admin/popups/${id}`, {
        method: 'DELETE',
        headers,
      })
      if (!res.ok) throw new Error(await res.text())
      message.success('Popup deleted')
      fetchPopups()
    } catch (e: any) {
      message.error(e.message || 'Delete failed')
    }
  }

  const save = async () => {
    const values = await form.validateFields()
    setSaving(true)
    try {
      if (editing) {
        let imageUrl = values.image_url || editing.image_url
        if (selectedFile) {
          const fd = new FormData()
          fd.append('image', selectedFile)
          const uploadRes = await window.fetch('/api/admin/banners', {
            method: 'POST',
            headers,
            body: fd,
          })
          if (uploadRes.ok) {
            const data = await uploadRes.json()
            imageUrl = data.image_url
          }
        }

        const res = await window.fetch(`/api/admin/popups/${editing.id}`, {
          method: 'PUT',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...values, image_url: imageUrl }),
        })
        if (!res.ok) throw new Error(await res.text())
      } else {
        if (selectedFile) {
          const fd = new FormData()
          fd.append('image', selectedFile)
          Object.entries(values).forEach(
            ([k, v]) => v != null && fd.append(k, String(v))
          )
          const res = await window.fetch('/api/admin/popups', {
            method: 'POST',
            headers,
            body: fd,
          })
          if (!res.ok) throw new Error(await res.text())
        } else {
          const res = await window.fetch('/api/admin/popups', {
            method: 'POST',
            headers: { ...headers, 'Content-Type': 'application/json' },
            body: JSON.stringify(values),
          })
          if (!res.ok) throw new Error(await res.text())
        }
      }
      message.success('Popup saved successfully!')
      setModalOpen(false)
      fetchPopups()
    } catch (e: any) {
      message.error(e.message || 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  const columns = [
    {
      title: 'Image',
      dataIndex: 'image_url',
      key: 'image_url',
      width: 90,
      render: (url: string | null) =>
        url ? (
          <Image
            src={url}
            width={72}
            height={50}
            style={{ objectFit: 'cover', borderRadius: 8, border: '1px solid #334155' }}
            fallback="data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='72' height='50' fill='%23334155'><rect width='72' height='50'/><text x='50%' y='50%' dominant-baseline='middle' text-anchor='middle' fill='%2394a3b8' font-size='10'>No Img</text></svg>"
          />
        ) : (
          <div
            style={{
              width: 72,
              height: 50,
              background: '#1e293b',
              borderRadius: 8,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#64748b',
              fontSize: 11,
            }}
          >
            Text Only
          </div>
        ),
    },
    {
      title: 'Popup Title & Body',
      key: 'content',
      render: (_: any, r: AppPopup) => (
        <div>
          <div style={{ fontWeight: 700, fontSize: 14, color: '#f8fafc' }}>{r.title}</div>
          {r.body && (
            <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 2, maxWidth: 360 }}>
              {r.body}
            </div>
          )}
        </div>
      ),
    },
    {
      title: 'Target Page & Delay',
      key: 'target_page',
      width: 170,
      render: (_: any, r: AppPopup) => {
        const pageNames: Record<string, string> = {
          all: '🌐 Anywhere (All Pages)',
          home: '🏠 Home Screen',
          wallet: '💳 Wallet / Deposit',
          games: '🎮 Games Lobby',
          teen_patti: '🃏 Teen Patti',
          rummy: '🎴 Rummy',
          ludo: '🎲 Ludo',
          agent_dashboard: '💼 Agent Dashboard',
          agent_wallet: '💰 Agent Earnings',
        }
        return (
          <div>
            <Tag color="cyan" icon={<CompassOutlined />}>
              {pageNames[r.target_page] || r.target_page || 'All Pages'}
            </Tag>
            <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>
              <ClockCircleOutlined style={{ marginRight: 4 }} />
              Delay: <strong style={{ color: '#f59e0b' }}>{r.delay_seconds ?? 2}s</strong>
            </div>
          </div>
        )
      },
    },
    {
      title: 'Audience',
      dataIndex: 'target_audience',
      key: 'target_audience',
      width: 130,
      render: (v: string) => {
        if (v === 'player')
          return (
            <Tag color="cyan" icon={<UserOutlined />}>
              Player App
            </Tag>
          )
        if (v === 'agent')
          return (
            <Tag color="blue" icon={<TeamOutlined />}>
              Agent App
            </Tag>
          )
        return (
          <Tag color="purple" icon={<MobileOutlined />}>
            All Users
          </Tag>
        )
      },
    },
    {
      title: 'Action & Destination',
      key: 'button',
      width: 180,
      render: (_: any, r: AppPopup) => {
        const actionLabels: Record<string, { label: string; color: string }> = {
          navigate: { label: 'Navigate Page', color: 'blue' },
          claim_bonus: { label: 'Claim Bonus', color: 'green' },
          join_game: { label: 'Join Game', color: 'purple' },
          external_link: { label: 'Open Web Link', color: 'orange' },
          close: { label: 'Close Only', color: 'default' },
        }
        const action = actionLabels[r.action_type] || { label: r.action_type || 'Navigate', color: 'blue' }
        return (
          <div>
            <div style={{ marginBottom: 4 }}>
              <Tag color={action.color} style={{ fontSize: 10 }}>
                {action.label}
              </Tag>
              {r.button_text && (
                <Tag color="gold" style={{ fontWeight: 600 }}>
                  {r.button_text}
                </Tag>
              )}
            </div>
            {r.button_link && (
              <div style={{ fontSize: 11, color: '#38bdf8' }}>
                <LinkOutlined style={{ marginRight: 4 }} />
                <span>{r.button_link.length > 25 ? `${r.button_link.substring(0, 25)}...` : r.button_link}</span>
              </div>
            )}
          </div>
        )
      },
    },
    {
      title: 'Status',
      dataIndex: 'is_active',
      key: 'is_active',
      width: 80,
      render: (active: boolean, r: AppPopup) => (
        <Switch
          checked={active}
          onChange={() => handleToggle(r.id)}
          checkedChildren="ON"
          unCheckedChildren="OFF"
        />
      ),
    },
    {
      title: 'Actions',
      key: 'actions',
      width: 120,
      render: (_: any, r: AppPopup) => (
        <Space>
          <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(r)}>
            Edit
          </Button>
          <Popconfirm
            title="Delete this popup?"
            onConfirm={() => handleDelete(r.id)}
            okText="Yes"
            cancelText="No"
          >
            <Button size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ]

  // Form values watching for live preview
  const formTitle = Form.useWatch('title', form) || (editing ? editing.title : '🎁 Welcome Bonus')
  const formBody = Form.useWatch('body', form) || (editing ? editing.body : 'Claim your exclusive reward now and start winning real cash!')
  const formBtnText = Form.useWatch('button_text', form) || (editing ? editing.button_text : 'Claim Now')
  const formActionType = Form.useWatch('action_type', form) || (editing ? editing.action_type : 'navigate')

  return (
    <div style={{ padding: 24 }}>
      <Card
        title={
          <Space align="center">
            <NotificationOutlined style={{ fontSize: 24, color: '#f59e0b' }} />
            <div>
              <Title level={4} style={{ margin: 0, color: '#ffffff' }}>
                App Announcement Popups
              </Title>
              <Text style={{ fontSize: 12, color: '#94a3b8' }}>
                Create, customize, and schedule modal popups with delay timers, page targeting, and claim actions.
              </Text>
            </div>
          </Space>
        }
        extra={
          <Space>
            <Select
              value={targetFilter}
              onChange={setTargetFilter}
              style={{ width: 180 }}
              options={[
                { label: 'All Audiences', value: 'all' },
                { label: 'Player App Only', value: 'player' },
                { label: 'Agent App & Portal', value: 'agent' },
              ]}
            />
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={openCreate}
              style={{
                background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
                borderColor: '#d97706',
                fontWeight: 600,
              }}
            >
              Create Popup
            </Button>
          </Space>
        }
        style={{
          background: 'rgba(20, 24, 33, 0.85)',
          border: '1px solid rgba(255, 255, 255, 0.08)',
        }}
      >
        <Table
          dataSource={popups}
          columns={columns}
          rowKey="id"
          loading={loading}
          pagination={{ pageSize: 10 }}
        />
      </Card>

      {/* Create / Edit Popup Modal */}
      <Modal
        title={
          <Space>
            <NotificationOutlined style={{ color: '#f59e0b' }} />
            <span>{editing ? 'Edit Announcement Popup' : 'Create New Announcement Popup'}</span>
          </Space>
        }
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={save}
        confirmLoading={saving}
        width={780}
        okText={editing ? 'Update Popup' : 'Publish Popup'}
      >
        <Row gutter={[20, 20]} style={{ marginTop: 16 }}>
          <Col xs={24} md={14}>
            <Form form={form} layout="vertical">
              <Form.Item
                name="title"
                label="Popup Title"
                rules={[{ required: true, message: 'Please enter a title' }]}
              >
                <Input placeholder="e.g. 🎁 Mega Bonus! Get 100% Cash Back" maxLength={150} />
              </Form.Item>

              <Form.Item name="body" label="Popup Message / Body">
                <Input.TextArea
                  rows={3}
                  placeholder="e.g. Deposit ₹500 or more today and instantly receive 100% bonus plus free spins!"
                  maxLength={500}
                />
              </Form.Item>

              <Row gutter={12}>
                <Col span={12}>
                  <Form.Item name="target_audience" label="Target App / Audience" initialValue="all">
                    <Select
                      options={[
                        { label: '📱 All (Player & Agent)', value: 'all' },
                        { label: '🎮 Player App Only', value: 'player' },
                        { label: '💼 Agent App & Portal Only', value: 'agent' },
                      ]}
                    />
                  </Form.Item>
                </Col>

                <Col span={12}>
                  <Form.Item
                    name="target_page"
                    label="Show on Which Screen / Page?"
                    initialValue="all"
                    tooltip="Which app page will trigger this popup"
                  >
                    <Select
                      options={[
                        { label: '🌐 Anywhere (All Pages / App Open)', value: 'all' },
                        { label: '🏠 Home Dashboard Screen', value: 'home' },
                        { label: '💳 Wallet / Add Cash Screen', value: 'wallet' },
                        { label: '🎮 Games Lobby', value: 'games' },
                        { label: '🃏 Teen Patti Lobby', value: 'teen_patti' },
                        { label: '🎴 Rummy Lobby', value: 'rummy' },
                        { label: '🎲 Ludo Lobby', value: 'ludo' },
                        { label: '💼 Agent Dashboard (Agent App)', value: 'agent_dashboard' },
                        { label: '💰 Agent Earnings & Payouts', value: 'agent_wallet' },
                      ]}
                    />
                  </Form.Item>
                </Col>
              </Row>

              <Row gutter={12}>
                <Col span={12}>
                  <Form.Item
                    name="delay_seconds"
                    label="Display Delay (Seconds)"
                    initialValue={2}
                    tooltip="How many seconds after screen loads should the popup appear"
                  >
                    <InputNumber min={0} max={60} style={{ width: '100%' }} addonAfter="sec" />
                  </Form.Item>
                </Col>

                <Col span={12}>
                  <Form.Item
                    name="action_type"
                    label="Button Click Action"
                    initialValue="navigate"
                    tooltip="What happens when the player or agent taps the popup button"
                  >
                    <Select
                      options={[
                        { label: '🧭 Navigate to In-App Page', value: 'navigate' },
                        { label: '🎁 Claim Bonus / Promo Code', value: 'claim_bonus' },
                        { label: '🎮 Join Game / Table', value: 'join_game' },
                        { label: '🌐 Open External Link (WhatsApp/Telegram/URL)', value: 'external_link' },
                        { label: '❌ Close Popup Only', value: 'close' },
                      ]}
                    />
                  </Form.Item>
                </Col>
              </Row>

              <Row gutter={12}>
                <Col span={12}>
                  <Form.Item name="button_text" label="Button Label Text" initialValue="Claim Now">
                    <Input placeholder="e.g. Claim Bonus / Play Now / Join Us" />
                  </Form.Item>
                </Col>

                <Col span={12}>
                  <Form.Item
                    name="button_link"
                    label="Destination Route / Landing URL"
                    initialValue="/deposit"
                    tooltip="Where to send user when clicked (e.g. /deposit, /games/teen-patti, /games/rummy, /vip, or https://...)"
                  >
                    <Select
                      showSearch
                      allowClear
                      placeholder="Select preset or type custom route"
                      options={[
                        { label: '💳 Add Cash / Deposit (/deposit)', value: '/deposit' },
                        { label: '💼 Withdraw Cash (/withdraw)', value: '/withdraw' },
                        { label: '🎁 Daily Missions / Rewards (/missions)', value: '/missions' },
                        { label: '👑 VIP Club (/vip)', value: '/vip' },
                        { label: '👥 Refer & Earn (/referral)', value: '/referral' },
                        { label: '🃏 Teen Patti Game (/games/teen-patti)', value: '/games/teen-patti' },
                        { label: '🎴 Rummy Game (/games/rummy)', value: '/games/rummy' },
                        { label: '🎲 Ludo Game (/games/ludo)', value: '/games/ludo' },
                        { label: '🚀 Aviator Game (/games/aviator)', value: '/games/aviator' },
                        { label: '💬 Customer Support (/support)', value: '/support' },
                        { label: '💼 Agent Dashboard (/agent/home)', value: '/agent/home' },
                        { label: '👥 Agent Downline Leads (/agent/leads)', value: '/agent/leads' },
                      ]}
                      dropdownRender={(menu) => (
                        <>
                          {menu}
                          <Divider style={{ margin: '8px 0' }} />
                          <div style={{ padding: '0 8px 4px', fontSize: 11, color: '#94a3b8' }}>
                            💡 You can also type any custom in-app path (e.g. <code>/wallet</code>) or external URL (<code>https://...</code>)
                          </div>
                        </>
                      )}
                    />
                  </Form.Item>
                </Col>
              </Row>

              <Row gutter={12}>
                <Col span={12}>
                  <Form.Item name="sort_order" label="Priority Sort Order" initialValue={0}>
                    <InputNumber min={0} max={9999} style={{ width: '100%' }} />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item name="is_active" label="Status" valuePropName="checked" initialValue={true}>
                    <Switch checkedChildren="Active" unCheckedChildren="Inactive" />
                  </Form.Item>
                </Col>
              </Row>

              <Form.Item label="Upload Popup Image Banner (Optional)">
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  ref={fileRef}
                  style={{ display: 'none' }}
                  onChange={handleFileChange}
                />
                <Space>
                  <Button icon={<UploadOutlined />} onClick={() => fileRef.current?.click()}>
                    Choose Local Image
                  </Button>
                  {selectedFile && <Text type="success">{selectedFile.name}</Text>}
                </Space>
              </Form.Item>

              <Form.Item name="image_url" label="Or Direct Image URL">
                <Input
                  placeholder="e.g. https://domain.com/banner.jpg"
                  onChange={(e) => setPreviewUrl(e.target.value)}
                />
              </Form.Item>
            </Form>
          </Col>

          {/* Live Mobile Device Preview */}
          <Col xs={24} md={10}>
            <div style={{ textAlign: 'center', marginBottom: 8 }}>
              <Tag color="gold" icon={<EyeOutlined />}>
                Live Device Preview
              </Tag>
            </div>
            <div
              style={{
                width: '100%',
                maxWidth: 250,
                margin: '0 auto',
                background: '#090d16',
                borderRadius: 24,
                padding: '12px 10px',
                border: '2px solid rgba(245, 158, 11, 0.4)',
                boxShadow: '0 10px 25px rgba(0,0,0,0.7)',
              }}
            >
              {/* Mock Popup Box */}
              <div
                style={{
                  background: '#0f172a',
                  borderRadius: 16,
                  overflow: 'hidden',
                  border: '1.5px solid rgba(245, 158, 11, 0.5)',
                  boxShadow: '0 0 15px rgba(245, 158, 11, 0.25)',
                }}
              >
                {/* Image Banner */}
                {previewUrl ? (
                  <img
                    src={previewUrl}
                    alt="Preview"
                    style={{ width: '100%', height: 110, objectFit: 'cover' }}
                  />
                ) : (
                  <div
                    style={{
                      height: 70,
                      background: 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: '#f59e0b',
                    }}
                  >
                    <GiftOutlined style={{ fontSize: 28 }} />
                  </div>
                )}

                <div style={{ padding: '12px 10px', textAlign: 'center' }}>
                  <div
                    style={{
                      color: '#fbbf24',
                      fontWeight: 800,
                      fontSize: 13,
                      lineHeight: 1.3,
                      marginBottom: 6,
                    }}
                  >
                    {formTitle}
                  </div>
                  <div
                    style={{
                      color: '#94a3b8',
                      fontSize: 10.5,
                      lineHeight: 1.4,
                      marginBottom: 12,
                    }}
                  >
                    {formBody}
                  </div>

                  {formBtnText && (
                    <div
                      style={{
                        background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
                        color: '#000',
                        fontWeight: 800,
                        fontSize: 11,
                        padding: '7px 0',
                        borderRadius: 8,
                        boxShadow: '0 2px 8px rgba(245, 158, 11, 0.4)',
                      }}
                    >
                      {formBtnText}
                    </div>
                  )}
                </div>
              </div>

              <div style={{ textAlign: 'center', marginTop: 10 }}>
                <Text style={{ fontSize: 10, color: '#64748b' }}>
                  Action: <strong>{formActionType}</strong>
                </Text>
              </div>
            </div>
          </Col>
        </Row>
      </Modal>
    </div>
  )
}
