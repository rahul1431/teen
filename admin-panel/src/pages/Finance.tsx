import { useEffect, useState } from 'react'
import {
  Table, Tag, Button, Space, message, Select, Statistic, Row, Col, Card, Tabs,
  Modal, Input, Descriptions, Empty, Tooltip,
} from 'antd'
import { CheckOutlined, CloseOutlined, DollarOutlined, ReloadOutlined } from '@ant-design/icons'
import { adminApi } from '../api/client'

export default function Finance() {
  const [stats, setStats] = useState<any>({})
  useEffect(() => { adminApi.get('/finance/stats').then(r => setStats(r.data)).catch(() => {}) }, [])

  return (
    <div>
      <Row gutter={16} style={{ marginBottom: 24 }}>
        <Col span={6}><Card><Statistic title="Revenue Today (₹)" value={stats.revenue_today || 0} precision={2} /></Card></Col>
        <Col span={6}><Card><Statistic title="Revenue This Month (₹)" value={stats.revenue_month || 0} precision={2} /></Card></Col>
        <Col span={6}><Card><Statistic title="Total Deposits Today (₹)" value={stats.deposits_today || 0} precision={2} /></Card></Col>
        <Col span={6}><Card><Statistic title="Total Withdrawn Today (₹)" value={stats.withdrawals_today || 0} precision={2} /></Card></Col>
      </Row>

      <Tabs
        defaultActiveKey="withdrawals"
        items={[
          { key: 'withdrawals', label: 'Withdrawals', children: <Withdrawals /> },
          { key: 'deposits', label: 'Deposits', children: <Deposits /> },
          { key: 'ledger', label: 'Ledger', children: <Ledger /> },
          { key: 'reconciliation', label: 'Reconciliation', children: <Reconciliation /> },
        ]}
      />
    </div>
  )
}

// ---- Withdrawals ----
function Withdrawals() {
  const [rows, setRows] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState('created')
  const [acting, setActing] = useState<{ row: any; action: 'paid' | 'refunded' } | null>(null)
  const [reference, setReference] = useState('')
  const [reason, setReason] = useState('')

  const load = async () => {
    setLoading(true)
    try {
      const res = await adminApi.get('/finance/withdrawals', { params: { status } })
      setRows(res.data)
    } finally { setLoading(false) }
  }
  useEffect(() => { load() /* eslint-disable-next-line */ }, [status])

  const submit = async () => {
    if (!acting) return
    if (acting.action === 'paid' && !reference.trim()) {
      message.warning('UTR / transaction reference required'); return
    }
    if (acting.action === 'refunded' && !reason.trim()) {
      message.warning('Rejection reason required'); return
    }
    try {
      await adminApi.patch(`/finance/withdrawals/${acting.row.id}`, {
        status: acting.action,
        reference: reference || undefined,
        reason: reason || undefined,
      })
      message.success(`Withdrawal ${acting.action === 'paid' ? 'approved' : 'rejected'}`)
      setActing(null); setReference(''); setReason('')
      load()
    } catch (e: any) {
      message.error(e.response?.data?.error || 'Failed')
    }
  }

  return (
    <>
      <Space style={{ marginBottom: 16 }}>
        <Select value={status} onChange={setStatus} style={{ width: 160 }}>
          <Select.Option value="created">Pending</Select.Option>
          <Select.Option value="paid">Approved</Select.Option>
          <Select.Option value="refunded">Rejected</Select.Option>
        </Select>
        <Button icon={<ReloadOutlined />} onClick={load}>Refresh</Button>
      </Space>
      <Table dataSource={rows} rowKey="id" loading={loading} size="small" pagination={{ pageSize: 20 }}
        columns={[
          { title: 'User', dataIndex: 'username' },
          { title: 'Amount (₹)', dataIndex: 'amount', align: 'right' as const, render: (v: any) => parseFloat(v).toFixed(2) },
          { title: 'UPI / Bank', key: 'payment', render: (r: any) => r.metadata?.upi_id || r.metadata?.bank_account || '-' },
          { title: 'Requested', dataIndex: 'created_at', render: (d: string) => new Date(d).toLocaleString() },
          { title: 'UTR', key: 'utr', render: (r: any) => r.metadata?.utr || '-' },
          { title: 'Status', dataIndex: 'status', render: (s: string) => (
            <Tag color={{ created: 'orange', paid: 'green', failed: 'red', refunded: 'purple' }[s] || 'default'}>{s}</Tag>
          )},
          {
            title: 'Actions', render: (r: any) => r.status === 'created' ? (
              <Space>
                <Button size="small" type="primary" icon={<CheckOutlined />}
                  onClick={() => { setActing({ row: r, action: 'paid' }); setReference(''); setReason('') }}>Approve</Button>
                <Button size="small" danger icon={<CloseOutlined />}
                  onClick={() => { setActing({ row: r, action: 'refunded' }); setReference(''); setReason('') }}>Reject</Button>
              </Space>
            ) : '-'
          },
        ]} />

      <Modal
        open={!!acting}
        title={acting?.action === 'paid' ? 'Approve Withdrawal' : 'Reject Withdrawal'}
        onCancel={() => { setActing(null); setReference(''); setReason('') }}
        onOk={submit}
        okButtonProps={{ danger: acting?.action === 'refunded' }}>
        {acting && (
          <>
            <Descriptions size="small" column={1} bordered style={{ marginBottom: 12 }}>
              <Descriptions.Item label="User">{acting.row.username}</Descriptions.Item>
              <Descriptions.Item label="Amount">₹{parseFloat(acting.row.amount).toFixed(2)}</Descriptions.Item>
              <Descriptions.Item label="Destination">{acting.row.metadata?.upi_id || acting.row.metadata?.bank_account || '-'}</Descriptions.Item>
            </Descriptions>
            {acting.action === 'paid' ? (
              <>
                <p>UTR / Transaction reference (required):</p>
                <Input value={reference} onChange={(e) => setReference(e.target.value)}
                  placeholder="e.g. NEFT/UPI reference number" />
              </>
            ) : (
              <>
                <p>Reason for rejection (required — held funds will be returned to wallet):</p>
                <Input.TextArea rows={3} value={reason} onChange={(e) => setReason(e.target.value)}
                  placeholder="e.g. KYC mismatch, suspicious activity, user requested cancellation" />
              </>
            )}
          </>
        )}
      </Modal>
    </>
  )
}

// ---- Deposits ----
function Deposits() {
  const [rows, setRows] = useState<any[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [status, setStatus] = useState<string>('')
  const [gateway, setGateway] = useState<string>('')
  const [loading, setLoading] = useState(false)
  const [recon, setRecon] = useState<{ row: any; action: 'mark_paid_and_credit' | 'mark_failed' } | null>(null)
  const [reference, setReference] = useState('')
  const [reason, setReason] = useState('')

  const load = async () => {
    setLoading(true)
    try {
      const res = await adminApi.get('/finance/deposits', { params: { status, gateway, page, limit: 20 } })
      setRows(res.data.deposits); setTotal(res.data.total)
    } finally { setLoading(false) }
  }
  useEffect(() => { load() /* eslint-disable-next-line */ }, [status, gateway, page])

  const submit = async () => {
    if (!recon) return
    try {
      await adminApi.patch(`/finance/deposits/${recon.row.id}`, {
        action: recon.action,
        reference: reference || undefined,
        reason: reason || undefined,
      })
      message.success(`Deposit ${recon.action === 'mark_paid_and_credit' ? 'credited' : 'marked failed'}`)
      setRecon(null); setReference(''); setReason('')
      load()
    } catch (e: any) {
      message.error(e.response?.data?.error || 'Failed')
    }
  }

  return (
    <>
      <Space style={{ marginBottom: 16 }}>
        <Select placeholder="Status" allowClear style={{ width: 140 }} value={status || undefined}
          onChange={(v) => { setStatus(v || ''); setPage(1) }}>
          <Select.Option value="created">Created</Select.Option>
          <Select.Option value="paid">Paid</Select.Option>
          <Select.Option value="failed">Failed</Select.Option>
        </Select>
        <Select placeholder="Gateway" allowClear style={{ width: 140 }} value={gateway || undefined}
          onChange={(v) => { setGateway(v || ''); setPage(1) }}>
          <Select.Option value="razorpay">Razorpay</Select.Option>
          <Select.Option value="manual">Manual</Select.Option>
        </Select>
        <Button icon={<ReloadOutlined />} onClick={load}>Refresh</Button>
      </Space>
      <Table dataSource={rows} rowKey="id" loading={loading} size="small"
        pagination={{ pageSize: 20, total, current: page, onChange: setPage }}
        columns={[
          { title: 'When', dataIndex: 'created_at', render: (d: string) => new Date(d).toLocaleString() },
          { title: 'User', dataIndex: 'username' },
          { title: 'Amount (₹)', dataIndex: 'amount', align: 'right' as const, render: (v: any) => parseFloat(v).toFixed(2) },
          { title: 'Gateway', dataIndex: 'gateway' },
          { title: 'Gateway Ref', dataIndex: 'gateway_payment_id', render: (v: string) => v ? <Tooltip title={v}><code>{v.slice(0, 14)}…</code></Tooltip> : '-' },
          { title: 'Status', dataIndex: 'status', render: (s: string) => (
            <Tag color={{ created: 'orange', paid: 'green', failed: 'red', refunded: 'purple' }[s] || 'default'}>{s}</Tag>
          )},
          {
            title: 'Actions', render: (r: any) => r.status !== 'paid' ? (
              <Space>
                <Tooltip title="Credit the user's wallet and mark this deposit paid (use when gateway succeeded but webhook never landed)">
                  <Button size="small" icon={<DollarOutlined />}
                    onClick={() => { setRecon({ row: r, action: 'mark_paid_and_credit' }); setReference(''); setReason('') }}>
                    Reconcile + Credit
                  </Button>
                </Tooltip>
                <Button size="small" danger icon={<CloseOutlined />}
                  onClick={() => { setRecon({ row: r, action: 'mark_failed' }); setReference(''); setReason('') }}>
                  Mark Failed
                </Button>
              </Space>
            ) : '-'
          },
        ]} />

      <Modal
        open={!!recon}
        title={recon?.action === 'mark_paid_and_credit' ? 'Reconcile Deposit (credit wallet)' : 'Mark Deposit Failed'}
        onCancel={() => { setRecon(null); setReference(''); setReason('') }}
        onOk={submit}
        okButtonProps={{ danger: recon?.action === 'mark_failed' }}>
        {recon && (
          <>
            <Descriptions size="small" column={1} bordered style={{ marginBottom: 12 }}>
              <Descriptions.Item label="User">{recon.row.username}</Descriptions.Item>
              <Descriptions.Item label="Amount">₹{parseFloat(recon.row.amount).toFixed(2)}</Descriptions.Item>
              <Descriptions.Item label="Gateway">{recon.row.gateway}</Descriptions.Item>
              <Descriptions.Item label="Gateway Ref">{recon.row.gateway_payment_id || '-'}</Descriptions.Item>
            </Descriptions>
            <p>Reference (gateway TXN ID / UTR — for the audit trail):</p>
            <Input value={reference} onChange={(e) => setReference(e.target.value)}
              placeholder="Bank UTR or gateway payment ID" />
            <p style={{ marginTop: 12 }}>Reason / note:</p>
            <Input.TextArea rows={2} value={reason} onChange={(e) => setReason(e.target.value)}
              placeholder={recon.action === 'mark_paid_and_credit' ? 'Why this needs manual credit (e.g. webhook missed)' : 'Why this deposit failed'} />
          </>
        )}
      </Modal>
    </>
  )
}

// ---- Ledger ----
function Ledger() {
  const [rows, setRows] = useState<any[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [type, setType] = useState('')
  const [walletType, setWalletType] = useState('')
  const [userId, setUserId] = useState('')
  const [loading, setLoading] = useState(false)

  const load = async () => {
    setLoading(true)
    try {
      const res = await adminApi.get('/finance/ledger', {
        params: { type, wallet_type: walletType, user_id: userId || undefined, page, limit: 50 },
      })
      setRows(res.data.entries); setTotal(res.data.total)
    } finally { setLoading(false) }
  }
  useEffect(() => { load() /* eslint-disable-next-line */ }, [type, walletType, page])

  return (
    <>
      <Space style={{ marginBottom: 16, flexWrap: 'wrap' }}>
        <Select placeholder="Txn type" allowClear style={{ width: 170 }} value={type || undefined}
          onChange={(v) => { setType(v || ''); setPage(1) }}>
          {['deposit', 'withdrawal', 'game_credit', 'game_debit', 'bonus', 'referral', 'manual_credit', 'manual_debit'].map(t =>
            <Select.Option key={t} value={t}>{t}</Select.Option>)}
        </Select>
        <Select placeholder="Wallet" allowClear style={{ width: 130 }} value={walletType || undefined}
          onChange={(v) => { setWalletType(v || ''); setPage(1) }}>
          <Select.Option value="real">Real</Select.Option>
          <Select.Option value="bonus">Bonus</Select.Option>
        </Select>
        <Input.Search placeholder="User ID (UUID)" allowClear value={userId} onChange={(e) => setUserId(e.target.value)}
          onSearch={() => { setPage(1); load() }} style={{ width: 280 }} />
        <Button icon={<ReloadOutlined />} onClick={load}>Refresh</Button>
      </Space>
      <Table dataSource={rows} rowKey="id" loading={loading} size="small"
        pagination={{ pageSize: 50, total, current: page, onChange: setPage }}
        columns={[
          { title: 'When', dataIndex: 'created_at', render: (d: string) => new Date(d).toLocaleString() },
          { title: 'User', dataIndex: 'username' },
          { title: 'Type', dataIndex: 'type', render: (t: string) => <Tag>{t}</Tag> },
          { title: 'Wallet', dataIndex: 'wallet_type' },
          { title: 'Amount (₹)', dataIndex: 'amount', align: 'right' as const,
            render: (v: string, r: any) => {
              const sign = ['deposit', 'game_credit', 'bonus', 'referral', 'manual_credit'].includes(r.type) ? '+' : '−'
              const color = sign === '+' ? '#52c41a' : '#cf1322'
              return <span style={{ color, fontWeight: 600 }}>{sign}₹{parseFloat(v).toFixed(2)}</span>
            } },
          { title: 'Balance After', dataIndex: 'balance_after', align: 'right' as const, render: (v: string) => parseFloat(v).toFixed(2) },
          { title: 'Status', dataIndex: 'status', render: (s: string) => <Tag color={s === 'completed' ? 'green' : 'orange'}>{s}</Tag> },
          { title: 'Reference', dataIndex: 'reference_id', ellipsis: true },
          { title: 'Description', dataIndex: 'description', ellipsis: true },
        ]} />
    </>
  )
}

// ---- Reconciliation ----
function Reconciliation() {
  const [data, setData] = useState<any>(null)
  const [days, setDays] = useState(7)
  const [loading, setLoading] = useState(false)

  const load = async () => {
    setLoading(true)
    try { setData((await adminApi.get('/finance/reconciliation', { params: { days } })).data) }
    finally { setLoading(false) }
  }
  useEffect(() => { load() /* eslint-disable-next-line */ }, [days])

  return (
    <>
      <Space style={{ marginBottom: 16 }}>
        <span>Period:</span>
        <Select value={days} onChange={setDays} style={{ width: 120 }}>
          {[1, 7, 30, 90].map(d => <Select.Option key={d} value={d}>{d} days</Select.Option>)}
        </Select>
        <Button icon={<ReloadOutlined />} onClick={load}>Refresh</Button>
      </Space>

      {!data ? <Empty description={loading ? 'Loading…' : 'No data'} /> : (
        <Row gutter={16}>
          <Col span={12}>
            <Card title="Payment Orders by Day" size="small" style={{ marginBottom: 16 }}>
              <Table size="small" pagination={false} dataSource={data.by_day} rowKey={(r: any) => `${r.day}-${r.type}-${r.status}`}
                columns={[
                  { title: 'Day', dataIndex: 'day', render: (d: string) => new Date(d).toLocaleDateString() },
                  { title: 'Type', dataIndex: 'type', render: (t: string) => <Tag>{t}</Tag> },
                  { title: 'Status', dataIndex: 'status' },
                  { title: 'Count', dataIndex: 'count', align: 'right' as const },
                  { title: 'Total (₹)', dataIndex: 'total', align: 'right' as const, render: (v: string) => parseFloat(v).toFixed(2) },
                ]} />
            </Card>
          </Col>
          <Col span={12}>
            <Card title="Gross Gaming Revenue" size="small" style={{ marginBottom: 16 }}>
              <Table size="small" pagination={false} dataSource={data.ggr} rowKey="day"
                columns={[
                  { title: 'Day', dataIndex: 'day', render: (d: string) => new Date(d).toLocaleDateString() },
                  { title: 'Pot Volume (₹)', dataIndex: 'pot', align: 'right' as const, render: (v: string) => parseFloat(v).toFixed(2) },
                  { title: 'GGR / Platform Fee (₹)', dataIndex: 'ggr', align: 'right' as const,
                    render: (v: string) => <strong style={{ color: '#52c41a' }}>{parseFloat(v).toFixed(2)}</strong> },
                ]} />
            </Card>
            <Card title="By Gateway" size="small">
              <Table size="small" pagination={false} dataSource={data.by_gateway} rowKey={(r: any) => `${r.gateway}-${r.status}`}
                columns={[
                  { title: 'Gateway', dataIndex: 'gateway' },
                  { title: 'Status', dataIndex: 'status' },
                  { title: 'Count', dataIndex: 'count', align: 'right' as const },
                  { title: 'Total (₹)', dataIndex: 'total', align: 'right' as const, render: (v: string) => parseFloat(v).toFixed(2) },
                ]} />
            </Card>
          </Col>
        </Row>
      )}
    </>
  )
}
