import { useEffect, useState } from 'react'
import {
  Card, Button, Table, Tag, Space, Typography, Statistic, Row, Col,
  message, Modal, Image, Select, Spin, Input,
} from 'antd'
import {
  CheckCircleOutlined, CloseCircleOutlined, SafetyOutlined,
  EyeOutlined, ClockCircleOutlined, UserOutlined,
} from '@ant-design/icons'
import dayjs from 'dayjs'
import { useAuthStore } from '../store/auth'

const { Title, Text } = Typography
const { TextArea } = Input

interface KYCSub {
  user_id: string
  username: string
  phone: string
  email: string
  doc_type: string
  status: 'under_review' | 'approved' | 'rejected' | 'pending'
  rejection_reason: string | null
  submitted_at: string
  reviewed_at: string | null
  front_url: string | null
  back_url: string | null
  selfie_url: string | null
}

const STATUS_TAG: Record<string, { color: string; label: string; icon: React.ReactNode }> = {
  under_review: { color: 'orange', label: 'Under Review', icon: <ClockCircleOutlined /> },
  approved:     { color: 'green',  label: 'Approved',    icon: <CheckCircleOutlined /> },
  rejected:     { color: 'red',    label: 'Rejected',    icon: <CloseCircleOutlined /> },
  pending:      { color: 'default',label: 'Pending',     icon: <UserOutlined /> },
}

export default function KYCPage() {
  const { token } = useAuthStore()
  const [submissions, setSubmissions] = useState<KYCSub[]>([])
  const [loading, setLoading] = useState(true)
  const [stats, setStats] = useState({ pending: 0, under_review: 0, approved: 0, rejected: 0 })
  const [filterStatus, setFilterStatus] = useState<string>('')
  const [reviewing, setReviewing] = useState<KYCSub | null>(null)
  const [rejectionReason, setRejectionReason] = useState('')
  const [acting, setActing] = useState(false)

  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }

  const load = async (status?: string) => {
    setLoading(true)
    try {
      const qs = status ? `?status=${status}` : ''
      const [subRes, statsRes] = await Promise.all([
        fetch(`/api/admin/kyc${qs}`, { headers }),
        fetch('/api/admin/kyc/stats', { headers }),
      ])
      const subData = await subRes.json()
      const statsData = await statsRes.json()
      setSubmissions(subData.submissions || [])
      setStats(statsData)
    } catch { message.error('Failed to load KYC data') }
    finally { setLoading(false) }
  }

  useEffect(() => { load(filterStatus || undefined) }, [filterStatus])

  const review = async (action: 'approve' | 'reject') => {
    if (!reviewing) return
    if (action === 'reject' && !rejectionReason.trim()) {
      message.warning('Please enter a rejection reason')
      return
    }
    setActing(true)
    try {
      const res = await fetch(`/api/admin/kyc/${reviewing.user_id}/review`, {
        method: 'PUT', headers,
        body: JSON.stringify({ action, rejection_reason: rejectionReason || undefined }),
      })
      if (!res.ok) throw new Error(await res.text())
      message.success(action === 'approve' ? 'KYC Approved!' : 'KYC Rejected')
      setReviewing(null)
      setRejectionReason('')
      load(filterStatus || undefined)
    } catch (e: any) {
      message.error(e.message || 'Action failed')
    } finally { setActing(false) }
  }

  const KycImg = ({ userId, type, style }: { userId: string; type: 'front' | 'back' | 'selfie'; style: React.CSSProperties }) => {
    const [src, setSrc] = useState<string | null>(null)
    useEffect(() => {
      let objectUrl: string | null = null
      let cancelled = false
      fetch(`/api/admin/kyc/${userId}/file/${type}`, { headers: { Authorization: `Bearer ${token}` } })
        .then(res => (res.ok ? res.blob() : Promise.reject()))
        .then(blob => {
          if (cancelled) return
          objectUrl = URL.createObjectURL(blob)
          setSrc(objectUrl)
        })
        .catch(() => {})
      return () => {
        cancelled = true
        if (objectUrl) URL.revokeObjectURL(objectUrl)
      }
    }, [userId, type])
    if (!src) return <div style={{ ...style, background: '#0d1117' }} />
    return <Image src={src} style={style} />
  }

  const columns = [
    {
      title: 'User',
      render: (_: any, s: KYCSub) => (
        <Space direction="vertical" size={0}>
          <Text style={{ color: '#fff', fontWeight: 700 }}>{s.username}</Text>
          <Text style={{ color: '#8b949e', fontSize: 12 }}>{s.phone}</Text>
        </Space>
      ),
    },
    {
      title: 'Status',
      dataIndex: 'status',
      render: (v: string) => {
        const t = STATUS_TAG[v] || STATUS_TAG.pending
        return <Tag color={t.color} icon={t.icon}>{t.label}</Tag>
      },
    },
    {
      title: 'Submitted',
      dataIndex: 'submitted_at',
      render: (v: string) => v ? dayjs(v).format('DD MMM YYYY, HH:mm') : '—',
    },
    {
      title: 'Reviewed',
      dataIndex: 'reviewed_at',
      render: (v: string | null) => v ? dayjs(v).format('DD MMM YYYY') : <Text style={{ color: '#555' }}>—</Text>,
    },
    {
      title: 'Documents',
      render: (_: any, s: KYCSub) => (
        <Space>
          {s.front_url && <KycImg userId={s.user_id} type="front" style={{ width: 48, height: 32, objectFit: 'cover', borderRadius: 4 }} />}
          {s.back_url && <KycImg userId={s.user_id} type="back" style={{ width: 48, height: 32, objectFit: 'cover', borderRadius: 4 }} />}
          {s.selfie_url && <KycImg userId={s.user_id} type="selfie" style={{ width: 32, height: 32, objectFit: 'cover', borderRadius: 16 }} />}
        </Space>
      ),
    },
    {
      title: 'Action',
      width: 100,
      render: (_: any, s: KYCSub) =>
        s.status === 'under_review' ? (
          <Button size="small" icon={<EyeOutlined />} onClick={() => { setReviewing(s); setRejectionReason('') }}>
            Review
          </Button>
        ) : s.status === 'rejected' ? (
          <Text style={{ color: '#555', fontSize: 12 }}>Rejected</Text>
        ) : null,
    },
  ]

  return (
    <div style={{ padding: 24, background: '#0d1117', minHeight: '100vh' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
        <div>
          <Title level={3} style={{ color: '#fff', margin: 0 }}>
            <SafetyOutlined style={{ color: '#d4af37', marginRight: 10 }} />
            KYC Verification
          </Title>
          <Text style={{ color: '#8b949e' }}>Review and approve user identity documents</Text>
        </div>
        <Select
          style={{ width: 160 }}
          value={filterStatus || 'all'}
          onChange={v => setFilterStatus(v === 'all' ? '' : v)}
          options={[
            { value: 'all', label: 'All Submissions' },
            { value: 'under_review', label: '⏳ Under Review' },
            { value: 'approved', label: '✅ Approved' },
            { value: 'rejected', label: '❌ Rejected' },
          ]}
        />
      </div>

      <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
        {[
          { key: 'under_review', label: 'Pending Review', color: '#f5a623', icon: <ClockCircleOutlined /> },
          { key: 'approved',     label: 'Approved',       color: '#52c41a', icon: <CheckCircleOutlined /> },
          { key: 'rejected',     label: 'Rejected',       color: '#ff4d4f', icon: <CloseCircleOutlined /> },
          { key: 'pending',      label: 'Not Started',    color: '#8b949e', icon: <UserOutlined /> },
        ].map(s => (
          <Col xs={24} sm={6} key={s.key}>
            <Card
              style={{ background: '#161b22', border: '1px solid #30363d', cursor: 'pointer' }}
              onClick={() => setFilterStatus(s.key === filterStatus ? '' : s.key)}
              bodyStyle={{ padding: 16 }}
            >
              <Statistic
                title={<Text style={{ color: '#8b949e', fontSize: 12 }}>{s.label}</Text>}
                value={(stats as any)[s.key] || 0}
                prefix={s.icon}
                valueStyle={{ color: s.color, fontSize: 24 }}
              />
            </Card>
          </Col>
        ))}
      </Row>

      <Card style={{ background: '#161b22', border: '1px solid #30363d' }}>
        <Table
          dataSource={submissions}
          columns={columns}
          rowKey="user_id"
          loading={loading}
          pagination={{ pageSize: 15 }}
          size="small"
          rowClassName={(s) => s.status === 'under_review' ? 'kyc-pending-row' : ''}
        />
      </Card>

      {/* Review Modal */}
      <Modal
        title={<Text style={{ color: '#fff' }}>Review KYC — {reviewing?.username}</Text>}
        open={!!reviewing}
        onCancel={() => { setReviewing(null); setRejectionReason('') }}
        footer={null}
        width={680}
        styles={{
          body: { background: '#161b22', padding: 20 },
          content: { background: '#161b22', border: '1px solid #30363d' },
          header: { background: '#161b22', borderBottom: '1px solid #30363d' },
        }}
      >
        {reviewing && (
          <div>
            {/* User info */}
            <div style={{ marginBottom: 16, padding: '10px 14px', background: '#0d1117', borderRadius: 8 }}>
              <Text style={{ color: '#fff', fontWeight: 700 }}>{reviewing.username}</Text>
              <Text style={{ color: '#8b949e', marginLeft: 12 }}>{reviewing.phone}</Text>
            </div>

            {/* Documents */}
            <Text style={{ color: '#8b949e', fontSize: 12, display: 'block', marginBottom: 10 }}>DOCUMENTS</Text>
            <Row gutter={[12, 12]} style={{ marginBottom: 20 }}>
              {[
                { url: reviewing.front_url, type: 'front' as const, label: 'Aadhaar Front' },
                { url: reviewing.back_url, type: 'back' as const, label: 'Aadhaar Back' },
                { url: reviewing.selfie_url, type: 'selfie' as const, label: 'Selfie' },
              ].map(d => d.url && (
                <Col span={8} key={d.label}>
                  <div style={{ textAlign: 'center' }}>
                    <KycImg
                      userId={reviewing.user_id}
                      type={d.type}
                      style={{ width: '100%', maxHeight: 160, objectFit: 'cover', borderRadius: 8, border: '1px solid #30363d' }}
                    />
                    <Text style={{ color: '#8b949e', fontSize: 11, display: 'block', marginTop: 4 }}>{d.label}</Text>
                  </div>
                </Col>
              ))}
            </Row>

            {/* Rejection reason (only for reject action) */}
            <div style={{ marginBottom: 20 }}>
              <Text style={{ color: '#8b949e', fontSize: 12, display: 'block', marginBottom: 8 }}>
                REJECTION REASON (required only if rejecting)
              </Text>
              <TextArea
                rows={2}
                placeholder="e.g. Document blurry, incorrect document type..."
                value={rejectionReason}
                onChange={e => setRejectionReason(e.target.value)}
                style={{ background: '#0d1117', color: '#fff', border: '1px solid #30363d' }}
              />
            </div>

            {/* Actions */}
            <Row gutter={12}>
              <Col span={12}>
                <Button
                  block
                  danger
                  size="large"
                  icon={<CloseCircleOutlined />}
                  loading={acting}
                  onClick={() => review('reject')}
                >
                  Reject
                </Button>
              </Col>
              <Col span={12}>
                <Button
                  block
                  size="large"
                  type="primary"
                  icon={<CheckCircleOutlined />}
                  loading={acting}
                  onClick={() => review('approve')}
                  style={{ background: '#52c41a', borderColor: '#52c41a' }}
                >
                  Approve KYC
                </Button>
              </Col>
            </Row>
          </div>
        )}
      </Modal>

      <style>{`
        .ant-table { background: transparent !important; }
        .ant-table-thead > tr > th { background: #0d1117 !important; color: #8b949e !important; border-bottom: 1px solid #30363d !important; }
        .ant-table-tbody > tr > td { background: transparent !important; color: #fff !important; border-bottom: 1px solid #1e2533 !important; }
        .ant-table-tbody > tr:hover > td { background: rgba(255,255,255,0.03) !important; }
        .kyc-pending-row > td { background: rgba(245,166,35,0.04) !important; }
        .ant-card-head { background: transparent !important; border-bottom: 1px solid #30363d !important; }
      `}</style>
    </div>
  )
}
