import { useEffect, useState } from 'react'
import {
  Table, Button, Tag, Space, Modal, Form, Input, Select, DatePicker, Popconfirm,
  message, Empty, Drawer, Descriptions, List, Avatar, Alert, Switch, Segmented, Grid
} from 'antd'
import {
  PlusOutlined, DeleteOutlined, WarningOutlined, UserOutlined,
} from '@ant-design/icons'
import dayjs from 'dayjs'
import { adminApi } from '../api/client'
import { useAuthStore } from '../store/auth'

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

  const [createOpen, setCreateOpen] = useState(false)
  const [activeTask, setActiveTask] = useState<any>(null)
  const [comments, setComments] = useState<any[]>([])
  const [commentBody, setCommentBody] = useState('')
  const [editForm] = Form.useForm()

  const load = async () => {
    setLoading(true)
    try {
      const params: any = {}
      if (statusFilter) params.status = statusFilter
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

  useEffect(() => { load() }, [statusFilter])
  useEffect(() => { if (isSuperadmin) loadAssignees() }, [isSuperadmin])

  const createTask = async (values: any) => {
    try {
      await adminApi.post('/tasks', {
        ...values,
        due_date: values.due_date ? values.due_date.format('YYYY-MM-DD') : undefined,
      })
      message.success('Task created')
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

  return (
    <>
      <Space style={{ marginBottom: 16 }} wrap>
        {isSuperadmin && (
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>
            New Task
          </Button>
        )}
        <Segmented
          value={statusFilter || 'all'}
          onChange={(v) => setStatusFilter(v === 'all' ? undefined : String(v))}
          options={[
            { label: 'All', value: 'all' },
            { label: 'To Do', value: 'todo' },
            { label: 'In Progress', value: 'in_progress' },
            { label: 'Done', value: 'done' },
            { label: 'Cancelled', value: 'cancelled' },
          ]}
        />
      </Space>

      <Table
        dataSource={rows}
        rowKey="id"
        loading={loading}
        size="small"
        locale={{ emptyText: <Empty description="No tasks" /> }}
        onRow={(r) => ({ onClick: () => openTask(r), style: { cursor: 'pointer' } })}
        scroll={{ x: 'max-content' }}
        columns={[
          {
            title: 'Title',
            dataIndex: 'title',
            render: (title: string, r: any) => (
              <Space>
                {r.has_issue && <WarningOutlined style={{ color: '#faad14' }} />}
                {title}
              </Space>
            ),
          },
          { title: 'Assignee', dataIndex: 'assignee_username', render: (u: string) => u || '—' },
          {
            title: 'Priority',
            dataIndex: 'priority',
            render: (p: string) => <Tag color={PRIORITY_COLOR[p]}>{p}</Tag>,
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
          ...(isSuperadmin ? [{
            title: 'Actions',
            render: (r: any) => (
              <Popconfirm title="Delete this task?" onConfirm={(e) => { e?.stopPropagation(); deleteTask(r.id) }}>
                <Button size="small" danger icon={<DeleteOutlined />} onClick={(e) => e.stopPropagation()} />
              </Popconfirm>
            ),
          }] : []),
        ]}
      />

      <Modal title="New Task" open={createOpen} onCancel={() => setCreateOpen(false)} footer={null} destroyOnClose>
        <Form layout="vertical" onFinish={createTask}>
          <Form.Item name="title" label="Title" rules={[{ required: true, max: 200 }]}>
            <Input />
          </Form.Item>
          <Form.Item name="description" label="Description">
            <Input.TextArea rows={3} />
          </Form.Item>
          <Form.Item name="assigned_to" label="Assign To" rules={[{ required: true }]}>
            <Select
              showSearch
              optionFilterProp="label"
              options={assignees.map((a) => ({ value: a.id, label: `${a.username} (${a.role})` }))}
            />
          </Form.Item>
          <Form.Item name="priority" label="Priority" initialValue="medium">
            <Select options={[
              { value: 'low', label: 'Low' },
              { value: 'medium', label: 'Medium' },
              { value: 'high', label: 'High' },
              { value: 'urgent', label: 'Urgent' },
            ]} />
          </Form.Item>
          <Form.Item name="due_date" label="Due Date">
            <DatePicker style={{ width: '100%' }} />
          </Form.Item>
          <Button type="primary" htmlType="submit" block>Create Task</Button>
        </Form>
      </Modal>

      <Drawer
        title={activeTask?.title}
        open={!!activeTask}
        onClose={() => setActiveTask(null)}
        width={isMobile ? '100%' : 480}
      >
        {activeTask && (
          <>
            <Descriptions column={1} size="small" style={{ marginBottom: 16 }}>
              <Descriptions.Item label="Description">{activeTask.description || '—'}</Descriptions.Item>
              <Descriptions.Item label="Assignee">{activeTask.assignee_username || '—'}</Descriptions.Item>
              <Descriptions.Item label="Created By">{activeTask.creator_username || '—'}</Descriptions.Item>
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

            <h4>Comments</h4>
            <List
              dataSource={comments}
              locale={{ emptyText: 'No comments yet' }}
              renderItem={(c: any) => (
                <List.Item>
                  <List.Item.Meta
                    avatar={<Avatar icon={<UserOutlined />} />}
                    title={c.admin_username}
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
                placeholder="Add a comment..."
              />
              <Button type="primary" onClick={addComment}>Send</Button>
            </Space.Compact>
          </>
        )}
      </Drawer>
    </>
  )
}
