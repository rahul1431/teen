import { useEffect, useState } from 'react'
import {
  Table, Button, Tag, Space, Modal, Form, Input, Select, DatePicker, Popconfirm,
  message, Empty, Drawer, Descriptions, List, Avatar, Alert, Switch, Segmented, Grid,
  Card, Radio, Tooltip, Badge, Row, Col, Typography
} from 'antd'
import {
  PlusOutlined, DeleteOutlined, WarningOutlined, UserOutlined, RobotOutlined,
  CheckCircleOutlined, CloseCircleOutlined, ClockCircleOutlined, AuditOutlined,
  ThunderboltOutlined, SafetyCertificateOutlined, FilterOutlined
} from '@ant-design/icons'
import dayjs from 'dayjs'
import { adminApi } from '../api/client'
import { useAuthStore } from '../store/auth'

const { Text } = Typography

const PRIORITY_COLOR: Record<string, string> = {
  urgent: 'red',
  high: 'volcano',
  medium: 'gold',
  low: 'default',
}

const STATUS_COLOR: Record<string, string> = {
  todo: 'default',
  in_progress: 'blue',
  done: 'green',
  cancelled: 'default',
}

const STATUS_LABEL: Record<string, string> = {
  todo: 'To Do',
  in_progress: 'In Progress',
  done: 'Done',
  cancelled: 'Cancelled',
}

const AI_AGENT_OPTIONS = [
  { value: 'atlas', label: '🛡️ Atlas (SRE & Infrastructure)' },
  { value: 'midas', label: '💰 Midas (Finance & Revenue Auditor)' },
  { value: 'argus', label: '⚖️ Argus (Fraud & Risk Detective)' },
  { value: 'zeus', label: '📢 Zeus (VIP Retention & Marketing)' },
  { value: 'athena', label: '🎯 Athena (Chief Gaming Officer & Bot AI)' },
  { value: 'pythia', label: '🔮 Pythia (Data Science & Churn ML)' },
  { value: 'aegis', label: '📱 Aegis (Mobile Performance Sentinel)' },
  { value: 'gemini-coo', label: '🧠 Gemini 3.5 Pro (Autonomous AI COO)' },
  { value: 'hermes', label: '📲 Hermes (Telegram Command Bot)' },
]

function DueDate({ date, status }: { date: string | null; status: string }) {
  if (!date) return <span>—</span>
  const d = dayjs(date)
  const isDone = status === 'done' || status === 'cancelled'
  const overdue = !isDone && d.isBefore(dayjs(), 'day')
  const dueSoon = !isDone && !overdue && d.diff(dayjs(), 'day') <= 2
  return (
    <span>
      {d.format('MMM D, YYYY')}{' '}
      {overdue && <Tag color="red">OVERDUE</Tag>}
      {dueSoon && <Tag color="gold">Due soon</Tag>}
    </span>
  )
}

export default function Tasks() {
  const screens = Grid.useBreakpoint()
  const isMobile = !screens.md
  const { admin } = useAuthStore()
  const isSuperadmin = admin?.role === 'superadmin'

  const [rows, setRows] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [assignees, setAssignees] = useState<any[]>([])
  const [statusFilter, setStatusFilter] = useState<string | undefined>()
  const [filterType, setFilterType] = useState<string>('all')

  const [createOpen, setCreateOpen] = useState(false)
  const [taskMode, setTaskMode] = useState<'human' | 'ai'>('human')
  const [activeTask, setActiveTask] = useState<any>(null)
  const [comments, setComments] = useState<any[]>([])
  const [commentBody, setCommentBody] = useState('')
  const [editForm] = Form.useForm()

  // Human Verification Modal State
  const [verifyOpen, setVerifyOpen] = useState(false)
  const [verifyForm] = Form.useForm()
  const [verifyingTaskId, setVerifyingTaskId] = useState<string | null>(null)

  const load = async () => {
    setLoading(true)
    try {
      const params: any = {}
      if (statusFilter) params.status = statusFilter
      if (filterType !== 'all') params.filter_type = filterType
      const res = await adminApi.get('/tasks', { params })
      setRows(res.data.tasks || [])
    } catch (e: any) {
      message.error(e.response?.data?.error || 'Failed to load tasks')
    } finally {
      setLoading(false)
    }
  }

  const loadAssignees = async () => {
    try {
      const res = await adminApi.get('/admin-users')
      setAssignees(res.data || [])
    } catch {
      // Only superadmin can list admin-users; employees never need this.
    }
  }

  useEffect(() => { load() }, [statusFilter, filterType])
  useEffect(() => { if (isSuperadmin) loadAssignees() }, [isSuperadmin])

  const createTask = async (values: any) => {
    try {
      await adminApi.post('/tasks', {
        ...values,
        due_date: values.due_date ? values.due_date.format('YYYY-MM-DD') : undefined,
      })
      message.success('Task created successfully')
      setCreateOpen(false)
      load()
    } catch (e: any) {
      message.error(e.response?.data?.error || 'Failed to create task')
    }
  }

  const deleteTask = async (id: string) => {
    try {
      await adminApi.delete(`/tasks/${id}`)
      message.success('Task deleted')
      load()
    } catch (e: any) {
      message.error(e.response?.data?.error || 'Failed to delete task')
    }
  }

  const openTask = async (task: any) => {
    setActiveTask(task)
    editForm.setFieldsValue({
      status: task.status,
      has_issue: task.has_issue,
      issue_note: task.issue_note,
    })
    try {
      const res = await adminApi.get(`/tasks/${task.id}/comments`)
      setComments(res.data || [])
    } catch (e: any) {
      message.error(e.response?.data?.error || 'Failed to load comments')
    }
  }

  const patchTask = async (values: any) => {
    if (!activeTask) return
    try {
      const res = await adminApi.patch(`/tasks/${activeTask.id}`, values)
      setActiveTask(res.data)
      message.success('Task updated')
      load()
    } catch (e: any) {
      message.error(e.response?.data?.error || 'Failed to update task')
    }
  }

  const addComment = async () => {
    if (!activeTask || !commentBody.trim()) return
    try {
      const res = await adminApi.post(`/tasks/${activeTask.id}/comments`, { body: commentBody })
      setComments([...comments, res.data])
      setCommentBody('')
    } catch (e: any) {
      message.error(e.response?.data?.error || 'Failed to add comment')
    }
  }

  const handleVerifySubmit = async (values: any) => {
    if (!verifyingTaskId) return
    try {
      await adminApi.post(`/tasks/${verifyingTaskId}/verify`, values)
      message.success('Human verification recorded successfully')
      setVerifyOpen(false)
      verifyForm.resetFields()
      setVerifyingTaskId(null)
      if (activeTask && activeTask.id === verifyingTaskId) {
        setActiveTask(null)
      }
      load()
    } catch (e: any) {
      message.error(e.response?.data?.error || 'Failed to verify task')
    }
  }

  const unverifiedCount = rows.filter((r) => r.verification_status === 'unverified' && (r.raised_by_ai || r.target_ai_agent)).length

  return (
    <>
      <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
        <Space wrap>
          {isSuperadmin && (
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>
              New Task
            </Button>
          )}

          <Segmented
            value={filterType}
            onChange={(v) => setFilterType(String(v))}
            options={[
              { label: 'All Tasks', value: 'all' },
              {
                label: (
                  <span>
                    <ClockCircleOutlined style={{ color: '#faad14' }} /> Needs Verification{' '}
                    {unverifiedCount > 0 && <Badge count={unverifiedCount} size="small" />}
                  </span>
                ),
                value: 'unverified'
              },
              {
                label: (
                  <span>
                    <RobotOutlined style={{ color: '#7c3aed' }} /> AI Agent Tasks
                  </span>
                ),
                value: 'ai_only'
              },
              {
                label: (
                  <span>
                    <UserOutlined /> Human Staff Only
                  </span>
                ),
                value: 'human_only'
              },
            ]}
          />
        </Space>

        <Segmented
          value={statusFilter || 'all'}
          onChange={(v) => setStatusFilter(v === 'all' ? undefined : String(v))}
          options={[
            { label: 'All Status', value: 'all' },
            { label: 'To Do', value: 'todo' },
            { label: 'In Progress', value: 'in_progress' },
            { label: 'Done', value: 'done' },
            { label: 'Cancelled', value: 'cancelled' },
          ]}
        />
      </div>

      <Table
        dataSource={rows}
        rowKey="id"
        loading={loading}
        size="small"
        locale={{ emptyText: <Empty description="No tasks found matching criteria" /> }}
        onRow={(r) => ({ onClick: () => openTask(r), style: { cursor: 'pointer' } })}
        scroll={{ x: 'max-content' }}
        columns={[
          {
            title: 'Task & Issue',
            dataIndex: 'title',
            render: (title: string, r: any) => (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <Space>
                  {r.has_issue && <WarningOutlined style={{ color: '#faad14' }} />}
                  <span style={{ fontWeight: 600 }}>{title}</span>
                </Space>
                <Space size={4} wrap>
                  {r.raised_by_ai && (
                    <Tag color="purple" icon={<RobotOutlined />}>
                      Raised by {r.raised_by_ai.toUpperCase()}
                    </Tag>
                  )}
                  {r.target_ai_agent && (
                    <Tag color="cyan">
                      Target AI: {r.target_ai_agent.toUpperCase()}
                    </Tag>
                  )}
                  {r.issue_type && (
                    <Tag color="orange">
                      {r.issue_type}
                    </Tag>
                  )}
                </Space>
              </div>
            ),
          },
          {
            title: 'Assigned To',
            dataIndex: 'assignee_username',
            render: (u: string, r: any) => {
              if (r.target_ai_agent) {
                return <Tag color="blue">🤖 AI Agent ({r.target_ai_agent})</Tag>
              }
              return u ? <Tag color="default"><UserOutlined /> {u}</Tag> : <span style={{ color: '#94a3b8' }}>Unassigned</span>
            }
          },
          {
            title: 'Priority',
            dataIndex: 'priority',
            render: (p: string) => <Tag color={PRIORITY_COLOR[p]}>{p}</Tag>,
          },
          {
            title: 'Verification Status',
            dataIndex: 'verification_status',
            render: (v: string, r: any) => {
              if (v === 'unverified') {
                return (
                  <Tag color="warning" icon={<ClockCircleOutlined />}>
                    Needs Verification
                  </Tag>
                )
              }
              if (v === 'verified') {
                return (
                  <Tag color="success" icon={<CheckCircleOutlined />}>
                    Verified {r.verified_by_username ? `(${r.verified_by_username})` : ''}
                  </Tag>
                )
              }
              if (v === 'rejected') {
                return (
                  <Tag color="error" icon={<CloseCircleOutlined />}>
                    Rejected
                  </Tag>
                )
              }
              return <span>—</span>
            }
          },
          {
            title: 'Status',
            dataIndex: 'status',
            render: (s: string) => <Tag color={STATUS_COLOR[s]}>{STATUS_LABEL[s]}</Tag>,
          },
          {
            title: 'Due Date',
            dataIndex: 'due_date',
            render: (d: string, r: any) => <DueDate date={d} status={r.status} />,
          },
          {
            title: 'Actions',
            render: (r: any) => (
              <Space onClick={(e) => e.stopPropagation()}>
                {r.verification_status === 'unverified' && (
                  <Button
                    size="small"
                    type="primary"
                    icon={<SafetyCertificateOutlined />}
                    style={{ background: '#10b981', borderColor: '#10b981' }}
                    onClick={() => {
                      setVerifyingTaskId(r.id)
                      setVerifyOpen(true)
                    }}
                  >
                    Verify
                  </Button>
                )}
                {isSuperadmin && (
                  <Popconfirm title="Delete this task?" onConfirm={() => deleteTask(r.id)}>
                    <Button size="small" danger icon={<DeleteOutlined />} />
                  </Popconfirm>
                )}
              </Space>
            ),
          },
        ]}
      />

      {/* Create Task Modal */}
      <Modal title="Create New Task / Log Issue" open={createOpen} onCancel={() => setCreateOpen(false)} footer={null} destroyOnHidden width={540}>
        <div style={{ marginBottom: 16 }}>
          <Radio.Group value={taskMode} onChange={(e) => setTaskMode(e.target.value)} buttonStyle="solid">
            <Radio.Button value="human">👤 Human Task</Radio.Button>
            <Radio.Button value="ai">🤖 AI Agent Task</Radio.Button>
          </Radio.Group>
        </div>

        <Form layout="vertical" onFinish={createTask}>
          {taskMode === 'ai' && (
            <Row gutter={12}>
              <Col span={12}>
                <Form.Item name="raised_by_ai" label="Raised By AI Agent" rules={[{ required: true }]}>
                  <Select options={AI_AGENT_OPTIONS} placeholder="Select AI Agent" />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item name="target_ai_agent" label="Target AI Agent (Optional)">
                  <Select options={AI_AGENT_OPTIONS} allowClear placeholder="Select Target Agent" />
                </Form.Item>
              </Col>
              <Col span={24}>
                <Form.Item name="issue_type" label="Specific Issue Type" rules={[{ required: true }]}>
                  <Select
                    options={[
                      { value: 'Fraud / Cashout Flag', label: '⚖️ Fraud / Cashout Flag' },
                      { value: 'Service Health / OOM Alert', label: '🛡️ Service Health / OOM Alert' },
                      { value: 'VIP Retention Outreach', label: '📢 VIP Retention Outreach' },
                      { value: 'Bot Win-Rate Retuning', label: '🎯 Bot Win-Rate Retuning' },
                      { value: 'Churn Risk Mitigation', label: '🔮 Churn Risk Mitigation' },
                      { value: 'Mobile Crash Telemetry', label: '📱 Mobile Crash Telemetry' },
                      { value: 'Double-Entry Discrepancy', label: '💰 Double-Entry Discrepancy' },
                      { value: 'General Operational Blocker', label: '⚠️ General Operational Blocker' },
                    ]}
                    placeholder="Select or type issue category"
                  />
                </Form.Item>
              </Col>
            </Row>
          )}

          <Form.Item name="title" label="Task Title / Summary" rules={[{ required: true, max: 200 }]}>
            <Input placeholder={taskMode === 'ai' ? 'e.g. Audit ₹15,000 cashout for User 4022' : 'e.g. Verify KYC for user'} />
          </Form.Item>

          <Form.Item name="description" label="Detailed Description & Context">
            <Input.TextArea rows={3} placeholder="Provide specific issue details, user IDs, error codes or logs..." />
          </Form.Item>

          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="assigned_to" label="Assign To Human Staff" rules={[{ required: taskMode === 'human' }]}>
                <Select
                  showSearch
                  allowClear
                  optionFilterProp="label"
                  placeholder="Select staff member"
                  options={assignees.map((a) => ({ value: a.id, label: `${a.username} (${a.role})` }))}
                />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="priority" label="Priority" initialValue="medium">
                <Select options={[
                  { value: 'low', label: 'Low' },
                  { value: 'medium', label: 'Medium' },
                  { value: 'high', label: 'High' },
                  { value: 'urgent', label: 'Urgent' },
                ]} />
              </Form.Item>
            </Col>
          </Row>

          <Form.Item name="due_date" label="Due Date">
            <DatePicker style={{ width: '100%' }} />
          </Form.Item>

          <Button type="primary" htmlType="submit" block>
            {taskMode === 'ai' ? 'Raise AI Task for Verification' : 'Create Task'}
          </Button>
        </Form>
      </Modal>

      {/* Human Verification Modal */}
      <Modal
        title={
          <Space>
            <SafetyCertificateOutlined style={{ color: '#10b981', fontSize: 20 }} />
            <span>Human Verification &amp; Review</span>
          </Space>
        }
        open={verifyOpen}
        onCancel={() => {
          setVerifyOpen(false)
          setVerifyingTaskId(null)
        }}
        footer={null}
        destroyOnHidden
      >
        <Alert
          type="info"
          showIcon
          message="Autonomous AI Quality Assurance"
          description="Review the issue flagged by the AI Department Head. You can verify and approve the resolution, or reject it as a false positive."
          style={{ marginBottom: 16 }}
        />

        <Form form={verifyForm} layout="vertical" onFinish={handleVerifySubmit} initialValues={{ verification_status: 'verified', resolution: 'done' }}>
          <Form.Item name="verification_status" label="Verification Decision" rules={[{ required: true }]}>
            <Radio.Group buttonStyle="solid">
              <Radio.Button value="verified">✅ Approve &amp; Verify</Radio.Button>
              <Radio.Button value="rejected">❌ Reject (False Positive)</Radio.Button>
            </Radio.Group>
          </Form.Item>

          <Form.Item name="resolution" label="Task Status After Verification">
            <Select
              options={[
                { value: 'done', label: 'Mark Task Done (Resolved)' },
                { value: 'in_progress', label: 'Keep In Progress' },
                { value: 'todo', label: 'Keep in To-Do' },
                { value: 'cancelled', label: 'Cancel Task' },
              ]}
            />
          </Form.Item>

          <Form.Item name="verification_notes" label="Human Review Notes">
            <Input.TextArea rows={3} placeholder="Explain reason for approval or rejection (e.g. KYC documents confirmed authentic, withdrawal released)..." />
          </Form.Item>

          <Button type="primary" htmlType="submit" block style={{ background: '#10b981', borderColor: '#10b981' }}>
            Submit Verification
          </Button>
        </Form>
      </Modal>

      {/* Task Details Drawer */}
      <Drawer
        title={activeTask?.title}
        open={!!activeTask}
        onClose={() => setActiveTask(null)}
        width={isMobile ? '100%' : 520}
      >
        {activeTask && (
          <>
            {activeTask.raised_by_ai && (
              <Alert
                type="info"
                showIcon
                icon={<RobotOutlined />}
                message={`AI Raised Issue by ${activeTask.raised_by_ai.toUpperCase()}`}
                description={`Issue: ${activeTask.issue_type || 'General System Issue'}`}
                style={{ marginBottom: 16 }}
              />
            )}

            {activeTask.verification_status === 'unverified' && (
              <Card size="small" style={{ marginBottom: 16, background: '#fffbeb', border: '1px solid #fde68a' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <Text strong style={{ color: '#92400e' }}>Awaiting Human Verification</Text>
                    <div style={{ fontSize: 12, color: '#b45309' }}>This AI task requires human compliance review.</div>
                  </div>
                  <Button
                    type="primary"
                    size="small"
                    icon={<SafetyCertificateOutlined />}
                    style={{ background: '#10b981', borderColor: '#10b981' }}
                    onClick={() => {
                      setVerifyingTaskId(activeTask.id)
                      setVerifyOpen(true)
                    }}
                  >
                    Verify Now
                  </Button>
                </div>
              </Card>
            )}

            {activeTask.verification_status === 'verified' && (
              <Alert
                type="success"
                showIcon
                icon={<CheckCircleOutlined />}
                message={`Human Verified by ${activeTask.verified_by_username || 'Admin'}`}
                description={activeTask.verification_notes || 'Approved and confirmed by administrative team.'}
                style={{ marginBottom: 16 }}
              />
            )}

            <Descriptions column={1} size="small" style={{ marginBottom: 16 }}>
              <Descriptions.Item label="Description">{activeTask.description || '—'}</Descriptions.Item>
              <Descriptions.Item label="Assignee">{activeTask.assignee_username || activeTask.target_ai_agent ? `AI: ${activeTask.target_ai_agent}` : '—'}</Descriptions.Item>
              <Descriptions.Item label="Created By">{activeTask.creator_username || (activeTask.raised_by_ai ? `AI (${activeTask.raised_by_ai})` : '—')}</Descriptions.Item>
              <Descriptions.Item label="Priority">
                <Tag color={PRIORITY_COLOR[activeTask.priority]}>{activeTask.priority}</Tag>
              </Descriptions.Item>
              <Descriptions.Item label="Due Date">
                <DueDate date={activeTask.due_date} status={activeTask.status} />
              </Descriptions.Item>
            </Descriptions>

            <Form form={editForm} layout="vertical" onValuesChange={(_, all) => patchTask(all)}>
              <Form.Item name="status" label="Status">
                <Select options={
                  isSuperadmin
                    ? [
                        { value: 'todo', label: 'To Do' },
                        { value: 'in_progress', label: 'In Progress' },
                        { value: 'done', label: 'Done' },
                        { value: 'cancelled', label: 'Cancelled' },
                      ]
                    : [
                        { value: 'todo', label: 'To Do' },
                        { value: 'in_progress', label: 'In Progress' },
                        { value: 'done', label: 'Done' },
                      ]
                } />
              </Form.Item>
              <Form.Item name="has_issue" label="Blocked / Issue" valuePropName="checked">
                <Switch />
              </Form.Item>
              <Form.Item name="issue_note" label="Issue Note">
                <Input.TextArea rows={2} placeholder="What's blocking this task?" />
              </Form.Item>
            </Form>

            {activeTask.has_issue && (
              <Alert
                type="warning"
                showIcon
                icon={<WarningOutlined />}
                message="Blocked"
                description={activeTask.issue_note || 'No details provided'}
                style={{ marginBottom: 16 }}
              />
            )}

            <h4>Comments &amp; Audit Trail</h4>
            <List
              dataSource={comments}
              locale={{ emptyText: 'No comments yet' }}
              renderItem={(c: any) => (
                <List.Item>
                  <List.Item.Meta
                    avatar={<Avatar icon={<UserOutlined />} />}
                    title={c.admin_username || 'System'}
                    description={c.body}
                  />
                </List.Item>
              )}
            />
            <Space.Compact style={{ width: '100%', marginTop: 8 }}>
              <Input
                value={commentBody}
                onChange={(e) => setCommentBody(e.target.value)}
                onPressEnter={addComment}
                placeholder="Add a comment or audit note..."
              />
              <Button type="primary" onClick={addComment}>Send</Button>
            </Space.Compact>
          </>
        )}
      </Drawer>
    </>
  )
}
