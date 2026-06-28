import { useEffect, useState } from 'react'
import {
  Table, Tag, Button, Space, message, Select, Statistic, Row, Col, Card, Tabs,
  Modal, Input, Descriptions, Empty, Tooltip, Switch, InputNumber, Form, Popconfirm, Upload,
} from 'antd'
import { CheckOutlined, CloseOutlined, DollarOutlined, ReloadOutlined, PlusOutlined, DeleteOutlined, UploadOutlined } from '@ant-design/icons'
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
          { key: 'methods', label: 'Payment Methods', children: <PaymentMethods /> },
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
          { title: 'User Ref / UTR', dataIndex: 'reference_number', render: (v: string) => v ? <Tooltip title={v}><code>{v.slice(0, 18)}{v.length > 18 ? '…' : ''}</code></Tooltip> : '-' },
          { title: 'Proof', dataIndex: 'screenshot_url', render: (v: string) => v
            ? <a href={v} target="_blank" rel="noreferrer">View</a> : '-' },
          { title: 'Status', dataIndex: 'status', render: (s: string) => (
            <Tag color={{ created: 'orange', paid: 'green', failed: 'red', refunded: 'purple' }[s] || 'default'}>{s}</Tag>
          )},
          {
            title: 'Actions', render: (r: any) => r.status !== 'paid' ? (
              <Space>
                <Tooltip title={r.gateway === 'manual'
                  ? "Approve this manual deposit: credit the user's wallet and mark it paid"
                  : "Credit the user's wallet and mark this deposit paid (use when gateway succeeded but webhook never landed)"}>
                  <Button size="small" type="primary" icon={<DollarOutlined />}
                    onClick={() => { setRecon({ row: r, action: 'mark_paid_and_credit' }); setReference(''); setReason('') }}>
                    {r.gateway === 'manual' ? 'Approve & Credit' : 'Reconcile + Credit'}
                  </Button>
                </Tooltip>
                <Button size="small" danger icon={<CloseOutlined />}
                  onClick={() => { setRecon({ row: r, action: 'mark_failed' }); setReference(''); setReason('') }}>
                  {r.gateway === 'manual' ? 'Reject' : 'Mark Failed'}
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
              <Descriptions.Item label="User Ref / UTR">{recon.row.reference_number || '-'}</Descriptions.Item>
            </Descriptions>
            {recon.row.screenshot_url && (
              <div style={{ marginBottom: 12 }}>
                <p style={{ marginBottom: 4 }}>Payment proof:</p>
                <a href={recon.row.screenshot_url} target="_blank" rel="noreferrer">
                  <img src={recon.row.screenshot_url} alt="payment proof"
                    style={{ maxWidth: '100%', maxHeight: 220, border: '1px solid #eee', borderRadius: 6 }} />
                </a>
              </div>
            )}
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

// ---- Custom SVG Charting Components ----
function SVGLineChart({ data, width = 500, height = 200, strokeColor = '#d4af37', fillColor = 'rgba(212, 175, 55, 0.08)', valueKey = 'ggr' }: { data: any[], width?: number, height?: number, strokeColor?: string, fillColor?: string, valueKey?: string }) {
  if (!data || data.length === 0) return <div style={{ height, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>No data available</div>;

  const values = data.map(d => parseFloat(d[valueKey] || 0));
  const maxVal = Math.max(...values, 100);
  const minVal = Math.min(...values, 0);
  const range = maxVal - minVal;

  const points = data.map((d, idx) => {
    const x = (idx / (data.length - 1 || 1)) * (width - 60) + 40;
    const val = parseFloat(d[valueKey] || 0);
    const y = height - 25 - ((val - minVal) / range) * (height - 45);
    return { x, y, label: d.day ? new Date(d.day).toLocaleDateString(undefined, {month: 'short', day: 'numeric'}) : '', val };
  });

  const pathD = points.reduce((acc, p, idx) => {
    return acc + (idx === 0 ? `M ${p.x} ${p.y}` : ` L ${p.x} ${p.y}`);
  }, '');

  const areaD = pathD ? `${pathD} L ${points[points.length - 1].x} ${height - 25} L ${points[0].x} ${height - 25} Z` : '';

  return (
    <svg viewBox={`0 0 ${width} ${height}`} width="100%" height={height} style={{ overflow: 'visible' }}>
      {/* Grid lines */}
      {[0, 0.25, 0.5, 0.75, 1].map((ratio, idx) => {
        const y = 20 + ratio * (height - 45);
        const val = maxVal - ratio * range;
        return (
          <g key={idx}>
            <line x1="40" y1={y} x2={width - 20} y2={y} stroke="#f0f0f0" strokeDasharray="4 4" />
            <text x="35" y={y + 4} textAnchor="end" fontSize="10" fill="#999">₹{val.toFixed(0)}</text>
          </g>
        );
      })}

      {/* Area fill */}
      {areaD && <path d={areaD} fill={fillColor} />}
      {/* Line path */}
      {pathD && <path d={pathD} fill="none" stroke={strokeColor} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />}

      {/* Points and Tooltips */}
      {points.map((p, idx) => (
        <g key={idx} className="chart-point-group">
          <circle cx={p.x} cy={p.y} r="4" fill={strokeColor} stroke="#fff" strokeWidth="1.5" />
          <title>{`${p.label}\n₹${p.val.toFixed(2)}`}</title>
        </g>
      ))}

      {/* X Axis Labels */}
      {points.filter((_, idx) => data.length < 8 || idx % Math.ceil(data.length / 5) === 0).map((p, idx) => (
        <text key={idx} x={p.x} y={height - 5} textAnchor="middle" fontSize="10" fill="#999">
          {p.label}
        </text>
      ))}
    </svg>
  );
}

function SVGBarChart({ data, width = 500, height = 200 }: { data: any[], width?: number, height?: number }) {
  if (!data || data.length === 0) return <div style={{ height, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>No data available</div>;

  // Group data by day
  const dailyMap = new Map<string, { deposits: number; withdrawals: number }>();
  data.forEach((item) => {
    const dayStr = new Date(item.day).toLocaleDateString(undefined, {month: 'short', day: 'numeric'});
    if (!dailyMap.has(dayStr)) {
      dailyMap.set(dayStr, { deposits: 0, withdrawals: 0 });
    }
    const val = parseFloat(item.total || 0);
    const dayData = dailyMap.get(dayStr)!;
    if (item.type === 'deposit' && item.status === 'paid') {
      dayData.deposits += val;
    } else if (item.type === 'withdrawal' && item.status === 'paid') {
      dayData.withdrawals += val;
    }
  });

  const dailyList = Array.from(dailyMap.entries()).map(([day, values]) => ({ day, ...values })).reverse();
  const maxVal = Math.max(...dailyList.map((d) => Math.max(d.deposits, d.withdrawals)), 100);
  const chartWidth = width - 60;
  const chartHeight = height - 45;
  const barWidth = Math.max(3, Math.floor(chartWidth / (dailyList.length * 3 || 1)));

  return (
    <svg viewBox={`0 0 ${width} ${height}`} width="100%" height={height} style={{ overflow: 'visible' }}>
      {/* Grid lines */}
      {[0, 0.25, 0.5, 0.75, 1].map((ratio, idx) => {
        const y = 20 + ratio * chartHeight;
        const val = maxVal - ratio * maxVal;
        return (
          <g key={idx}>
            <line x1="45" y1={y} x2={width - 15} y2={y} stroke="#f0f0f0" strokeDasharray="4 4" />
            <text x="40" y={y + 4} textAnchor="end" fontSize="10" fill="#999">₹{val.toFixed(0)}</text>
          </g>
        );
      })}

      {/* Bars */}
      {dailyList.map((d, idx) => {
        const xGroup = 45 + (idx / dailyList.length) * chartWidth;
        const depHeight = (d.deposits / maxVal) * chartHeight;
        const witHeight = (d.withdrawals / maxVal) * chartHeight;

        const depY = 20 + chartHeight - depHeight;
        const witY = 20 + chartHeight - witHeight;

        return (
          <g key={idx}>
            {/* Deposit Bar */}
            <rect x={xGroup} y={depY} width={barWidth} height={depHeight} fill="#52c41a" rx="1.5" ry="1.5">
              <title>{`Deposits: ₹${d.deposits.toFixed(2)}`}</title>
            </rect>
            {/* Withdrawal Bar */}
            <rect x={xGroup + barWidth + 2} y={witY} width={barWidth} height={witHeight} fill="#ff4d4f" rx="1.5" ry="1.5">
              <title>{`Withdrawals: ₹${d.withdrawals.toFixed(2)}`}</title>
            </rect>
            {/* X label */}
            {dailyList.length < 8 || idx % Math.ceil(dailyList.length / 5) === 0 ? (
              <text x={xGroup + barWidth} y={height - 5} textAnchor="middle" fontSize="10" fill="#999">
                {d.day}
              </text>
            ) : null}
          </g>
        );
      })}

      {/* Legend */}
      <g transform={`translate(${width - 160}, 0)`}>
        <rect x="0" y="0" width="8" height="8" fill="#52c41a" rx="1" />
        <text x="12" y="8" fontSize="10" fill="#666">Deposits</text>
        <rect x="65" y="0" width="8" height="8" fill="#ff4d4f" rx="1" />
        <text x="77" y="8" fontSize="10" fill="#666">Withdrawals</text>
      </g>
    </svg>
  );
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
        <Space direction="vertical" size="large" style={{ width: '100%' }}>
          <Row gutter={[24, 24]}>
            <Col xs={24} xl={12}>
              <Card title="GGR Platform Revenue Trend (₹)" size="small" style={{ borderRadius: 12, boxShadow: '0 2px 8px rgba(0,0,0,0.04)' }}>
                <div style={{ padding: '16px 8px' }}>
                  <SVGLineChart data={data.ggr} strokeColor="#d4af37" fillColor="rgba(212, 175, 55, 0.08)" valueKey="ggr" />
                </div>
              </Card>
            </Col>
            <Col xs={24} xl={12}>
              <Card title="Daily Deposits vs Withdrawals Volume (₹)" size="small" style={{ borderRadius: 12, boxShadow: '0 2px 8px rgba(0,0,0,0.04)' }}>
                <div style={{ padding: '16px 8px' }}>
                  <SVGBarChart data={data.by_day} />
                </div>
              </Card>
            </Col>
          </Row>

          <Row gutter={[24, 24]}>
            <Col xs={24} lg={12}>
              <Card title="Payment Orders by Day" size="small" style={{ borderRadius: 12 }}>
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
            <Col xs={24} lg={12}>
              <Card title="Gross Gaming Revenue (Rake)" size="small" style={{ borderRadius: 12, marginBottom: 16 }}>
                <Table size="small" pagination={false} dataSource={data.ggr} rowKey="day"
                  columns={[
                    { title: 'Day', dataIndex: 'day', render: (d: string) => new Date(d).toLocaleDateString() },
                    { title: 'Pot Volume (₹)', dataIndex: 'pot', align: 'right' as const, render: (v: string) => parseFloat(v).toFixed(2) },
                    { title: 'GGR / Platform Fee (₹)', dataIndex: 'ggr', align: 'right' as const,
                      render: (v: string) => <strong style={{ color: '#52c41a' }}>{parseFloat(v).toFixed(2)}</strong> },
                  ]} />
              </Card>
              <Card title="By Gateway" size="small" style={{ borderRadius: 12 }}>
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
        </Space>
      )}
    </>
  )
}

// ---- QR image uploader used inside the payment-method form ----
function QrUploadField({ form, required, label }: { form: any; required: boolean; label: string }) {
  const [uploading, setUploading] = useState(false)
  const url: string | undefined = form.getFieldValue('qr_image_url')

  const upload = async (file: File) => {
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await adminApi.post('/uploads/qr', fd, { headers: { 'Content-Type': 'multipart/form-data' } })
      form.setFieldsValue({ qr_image_url: res.data.url })
      message.success('QR uploaded')
    } catch (e: any) {
      message.error(e.response?.data?.error || 'Upload failed')
    } finally { setUploading(false) }
  }

  return (
    <Form.Item label={label} required={required}>
      <Form.Item name="qr_image_url" noStyle rules={required ? [{ required: true, message: 'Upload a QR image' }] : []}>
        <Input type="hidden" />
      </Form.Item>
      <Space direction="vertical">
        <Upload showUploadList={false} accept="image/*" maxCount={1}
          beforeUpload={(file) => { upload(file as File); return false }}>
          <Button icon={<UploadOutlined />} loading={uploading}>{url ? 'Replace QR Image' : 'Upload QR Image'}</Button>
        </Upload>
        {url && <img src={url} alt="QR" style={{ width: 150, height: 150, objectFit: 'contain', border: '1px solid #eee', borderRadius: 6 }} />}
      </Space>
    </Form.Item>
  )
}

// ---- Payment Methods (manual deposit destinations) ----
function PaymentMethods() {
  const [rows, setRows] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [editing, setEditing] = useState<any | null>(null)
  const [form] = Form.useForm()

  const load = async () => {
    setLoading(true)
    try { setRows((await adminApi.get('/payment-methods')).data) }
    finally { setLoading(false) }
  }
  useEffect(() => { load() }, [])

  const openNew = () => { setEditing({}); form.resetFields(); form.setFieldsValue({ method_type: 'upi', is_active: true, min_amount: 100, max_amount: 100000, sort_order: 0 }) }
  const openEdit = (r: any) => { setEditing(r); form.setFieldsValue(r) }

  const save = async () => {
    const vals = await form.validateFields()
    try {
      if (editing?.id) await adminApi.patch(`/payment-methods/${editing.id}`, vals)
      else await adminApi.post('/payment-methods', vals)
      message.success('Saved'); setEditing(null); load()
    } catch (e: any) { message.error(e.response?.data?.error || 'Failed') }
  }

  const remove = async (id: string) => {
    try { await adminApi.delete(`/payment-methods/${id}`); message.success('Deleted'); load() }
    catch (e: any) { message.error(e.response?.data?.error || 'Failed') }
  }

  const toggleActive = async (r: any, v: boolean) => {
    try { await adminApi.patch(`/payment-methods/${r.id}`, { is_active: v }); load() }
    catch { message.error('Failed') }
  }

  return (
    <>
      <Space style={{ marginBottom: 16 }}>
        <Button type="primary" icon={<PlusOutlined />} onClick={openNew}>Add Method</Button>
        <Button icon={<ReloadOutlined />} onClick={load}>Refresh</Button>
      </Space>
      <Table dataSource={rows} rowKey="id" loading={loading} size="small" pagination={false}
        columns={[
          { title: 'Type', dataIndex: 'method_type', render: (t: string) => <Tag color={{ upi: 'blue', bank: 'green', qr: 'purple' }[t]}>{t?.toUpperCase()}</Tag> },
          { title: 'Label', dataIndex: 'label' },
          { title: 'Details', render: (r: any) => r.method_type === 'upi'
              ? <code>{r.upi_id}</code>
              : r.method_type === 'bank'
                ? <span>{r.bank_name} · {r.account_number} · {r.ifsc}</span>
                : (r.qr_image_url ? <a href={r.qr_image_url} target="_blank" rel="noreferrer">QR image</a> : '-') },
          { title: 'Limits (₹)', render: (r: any) => `${parseFloat(r.min_amount).toFixed(0)} – ${parseFloat(r.max_amount).toFixed(0)}` },
          { title: 'Active', dataIndex: 'is_active', render: (v: boolean, r: any) => <Switch checked={v} onChange={(c) => toggleActive(r, c)} /> },
          { title: 'Actions', render: (r: any) => (
            <Space>
              <Button size="small" onClick={() => openEdit(r)}>Edit</Button>
              <Popconfirm title="Delete this method?" onConfirm={() => remove(r.id)}>
                <Button size="small" danger icon={<DeleteOutlined />} />
              </Popconfirm>
            </Space>
          )},
        ]} />

      <Modal open={!!editing} title={editing?.id ? 'Edit Payment Method' : 'Add Payment Method'}
        onCancel={() => setEditing(null)} onOk={save} width={560}>
        <Form form={form} layout="vertical">
          <Form.Item name="method_type" label="Type" rules={[{ required: true }]}>
            <Select disabled={!!editing?.id}>
              <Select.Option value="upi">UPI</Select.Option>
              <Select.Option value="bank">Bank Transfer</Select.Option>
              <Select.Option value="qr">QR Code</Select.Option>
            </Select>
          </Form.Item>
          <Form.Item name="label" label="Label" rules={[{ required: true }]}>
            <Input placeholder="e.g. Primary UPI / HDFC Current A/c" />
          </Form.Item>
          <Form.Item noStyle shouldUpdate={(p, c) => p.method_type !== c.method_type || p.qr_image_url !== c.qr_image_url}>
            {({ getFieldValue }) => {
              const t = getFieldValue('method_type')
              if (t === 'upi') return (
                <>
                  <Form.Item name="upi_id" label="UPI ID" rules={[{ required: true }]}>
                    <Input placeholder="name@bank" />
                  </Form.Item>
                  <QrUploadField form={form} required={false} label="UPI QR Code (optional — users can scan to pay)" />
                </>
              )
              if (t === 'bank') return (
                <>
                  <Form.Item name="account_name" label="Account Holder Name"><Input /></Form.Item>
                  <Form.Item name="account_number" label="Account Number" rules={[{ required: true }]}><Input /></Form.Item>
                  <Form.Item name="ifsc" label="IFSC" rules={[{ required: true }]}><Input /></Form.Item>
                  <Form.Item name="bank_name" label="Bank Name"><Input /></Form.Item>
                </>
              )
              return <QrUploadField form={form} required={true} label="QR Code Image" />
            }}
          </Form.Item>
          <Form.Item name="instructions" label="Instructions (optional)">
            <Input.TextArea rows={2} placeholder="Any note shown to the user (e.g. add your phone number in the remarks)" />
          </Form.Item>
          <Row gutter={12}>
            <Col span={8}><Form.Item name="min_amount" label="Min ₹"><InputNumber style={{ width: '100%' }} min={1} /></Form.Item></Col>
            <Col span={8}><Form.Item name="max_amount" label="Max ₹"><InputNumber style={{ width: '100%' }} min={1} /></Form.Item></Col>
            <Col span={8}><Form.Item name="sort_order" label="Sort"><InputNumber style={{ width: '100%' }} /></Form.Item></Col>
          </Row>
          <Form.Item name="is_active" label="Active" valuePropName="checked"><Switch /></Form.Item>
        </Form>
      </Modal>
    </>
  )
}
