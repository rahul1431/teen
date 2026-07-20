import { useEffect, useState } from 'react'
import { Tabs, Card, Statistic, Row, Col, Table, Button, Modal, Form, Input, InputNumber, Switch, Select, message, Popconfirm, Tag } from 'antd'
import { adminApi } from '../api/client'

export default function Analytics() {
  return (
    <Tabs
      items={[
        { key: 'deposit', label: 'Deposit Funnel', children: <DepositFunnel /> },
        { key: 'onboarding', label: 'Onboarding Funnel', children: <OnboardingFunnel /> },
        { key: 'retention', label: 'Retention Cohorts', children: <Retention /> },
        { key: 'flags', label: 'Feature Flags', children: <FeatureFlags /> },
      ]}
    />
  )
}

function DepositFunnel() {
  const [data, setData] = useState<any>(null)
  useEffect(() => { adminApi.get('/analytics/funnels/deposit', { params: { days: 7 } }).then(r => setData(r.data)) }, [])
  if (!data) return null
  return (
    <Row gutter={16}>
      <Col span={6}><Card><Statistic title="Deposit Screen Opened (7d)" value={data.deposit_screen_opened} /></Card></Col>
      <Col span={6}><Card><Statistic title="Deposit Submitted (7d)" value={data.deposit_submitted} /></Card></Col>
      <Col span={6}><Card><Statistic title="Conversion Rate" value={data.conversion_rate} suffix="%" /></Card></Col>
    </Row>
  )
}

function OnboardingFunnel() {
  const [data, setData] = useState<any>(null)
  useEffect(() => { adminApi.get('/analytics/funnels/onboarding', { params: { days: 30 } }).then(r => setData(r.data)) }, [])
  if (!data) return null
  return (
    <Row gutter={16}>
      <Col span={6}><Card><Statistic title="Signups (30d)" value={data.signups} /></Card></Col>
      <Col span={6}><Card><Statistic title="Deposited" value={data.deposited} /></Card></Col>
      <Col span={6}><Card><Statistic title="Placed a Bet" value={data.placed_bet} /></Card></Col>
      <Col span={6}><Card><Statistic title="Signup → Deposit" value={data.signup_to_deposit_rate} suffix="%" /></Card></Col>
    </Row>
  )
}

function Retention() {
  const [rows, setRows] = useState<any[]>([])
  useEffect(() => { adminApi.get('/analytics/retention', { params: { days: 30 } }).then(r => setRows(r.data)) }, [])
  return (
    <Table
      rowKey="cohort"
      dataSource={rows}
      columns={[
        { title: 'Cohort', dataIndex: 'cohort', render: (v: string) => v === 'agent_referred' ? 'Agent-Referred' : 'Direct Signup' },
        { title: 'Cohort Size', dataIndex: 'cohort_size' },
        { title: 'Active After Week 1', dataIndex: 'active_after_week_1' },
        { title: 'Retention Rate', dataIndex: 'retention_rate', render: (v: number) => `${v}%` },
      ]}
    />
  )
}

function FeatureFlags() {
  const [flags, setFlags] = useState<any[]>([])
  const [modalOpen, setModalOpen] = useState(false)
  const [form] = Form.useForm()

  const load = () => adminApi.get('/analytics/flags').then(r => setFlags(r.data))
  useEffect(() => { load() }, [])

  const createFlag = async (values: any) => {
    try {
      await adminApi.post('/analytics/flags', values)
      message.success('Flag created')
      setModalOpen(false)
      form.resetFields()
      load()
    } catch (e: any) {
      message.error(e.response?.data?.error || 'Failed to create flag')
    }
  }

  const updateRollout = async (id: string, rollout_percent: number) => {
    try {
      await adminApi.patch(`/analytics/flags/${id}`, { rollout_percent })
      message.success('Rollout updated')
      load()
    } catch (e: any) {
      message.error(e.response?.data?.error || 'Failed to update')
    }
  }

  const toggleEnabled = async (id: string, enabled: boolean) => {
    try {
      await adminApi.patch(`/analytics/flags/${id}`, { enabled })
      message.success(enabled ? 'Flag enabled' : 'Flag disabled')
      load()
    } catch (e: any) {
      message.error(e.response?.data?.error || 'Failed to update')
    }
  }

  return (
    <div>
      <Button type="primary" onClick={() => setModalOpen(true)} style={{ marginBottom: 16 }}>New Flag</Button>
      <Table
        rowKey="id"
        dataSource={flags}
        columns={[
          { title: 'Key', dataIndex: 'key' },
          { title: 'Description', dataIndex: 'description' },
          {
            title: 'Enabled', dataIndex: 'enabled', render: (v: boolean, r: any) => (
              <Popconfirm title={`${v ? 'Disable' : 'Enable'} this flag?`} onConfirm={() => toggleEnabled(r.id, !v)}>
                <Switch checked={v} />
              </Popconfirm>
            ),
          },
          {
            title: 'Rollout %', dataIndex: 'rollout_percent', render: (v: number, r: any) => (
              <InputNumber min={0} max={100} defaultValue={v} onPressEnter={(e: any) => updateRollout(r.id, Number(e.target.value))} onBlur={(e: any) => updateRollout(r.id, Number(e.target.value))} />
            ),
          },
          { title: 'Variants', dataIndex: 'variants', render: (v: any) => v ? v.map((x: any) => <Tag key={x.key}>{x.key}:{x.weight}</Tag>) : '—' },
        ]}
      />

      <Modal title="New Feature Flag" open={modalOpen} onCancel={() => setModalOpen(false)} onOk={() => form.submit()}>
        <Form form={form} layout="vertical" onFinish={createFlag}>
          <Form.Item name="key" label="Key (lowercase, underscores)" rules={[{ required: true, pattern: /^[a-z0-9_]+$/ }]}><Input /></Form.Item>
          <Form.Item name="description" label="Description"><Input /></Form.Item>
          <Form.Item name="enabled" label="Enabled" valuePropName="checked" initialValue={false}><Switch /></Form.Item>
          <Form.Item name="rollout_percent" label="Rollout %" initialValue={0}><InputNumber min={0} max={100} style={{ width: '100%' }} /></Form.Item>
        </Form>
      </Modal>
    </div>
  )
}
