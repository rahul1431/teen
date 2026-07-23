import React, { useEffect, useState } from 'react'
import { Table, Card, Button, Space, Input, Select, message } from 'antd'
import { ReloadOutlined } from '@ant-design/icons'
import { adminApi } from '../api/client'

interface AuditSession {
  gameId: string
  winnerBotId: number
  actualWinnerId: number
  botIds: number[]
  rpId: number
  strategyUsed: string
  targetWinRate: number
  coordinationSuccess: boolean
  createdAt: string
}

export const BotTrainingAuditTrail: React.FC = () => {
  const [sessions, setSessions] = useState<AuditSession[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [page, setPage] = useState(1)
  const [filters, setFilters] = useState({
    botId: undefined as number | undefined,
    success: undefined as boolean | undefined,
  })

  useEffect(() => {
    fetchSessions()
  }, [page, filters])

  const fetchSessions = async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({
        page: page.toString(),
        limit: '20',
      })
      if (filters.botId) params.append('botId', filters.botId.toString())
      if (filters.success !== undefined) params.append('success', filters.success ? 'true' : 'false')

      const response = await adminApi.get(`/api/admin/ludo/bot-training/sessions?${params}`)
      setSessions(response.data.sessions || [])
      setTotal(response.data.total || 0)
    } catch (error) {
      message.error('Failed to load audit trail')
    } finally {
      setLoading(false)
    }
  }

  const columns = [
    { title: 'Game ID', dataIndex: 'gameId', key: 'gameId', width: 200, ellipsis: true },
    { title: 'Winner Bot', dataIndex: 'winnerBotId', key: 'winnerBotId' },
    { title: 'Actual Winner', dataIndex: 'actualWinnerId', key: 'actualWinnerId' },
    { title: 'Strategy', dataIndex: 'strategyUsed', key: 'strategyUsed' },
    {
      title: 'Target Win Rate',
      dataIndex: 'targetWinRate',
      key: 'targetWinRate',
      render: (rate: number) => `${(rate * 100).toFixed(0)}%`,
    },
    {
      title: 'Success',
      dataIndex: 'coordinationSuccess',
      key: 'coordinationSuccess',
      render: (success: boolean) => (success ? '✓' : '✗'),
    },
    { title: 'Date', dataIndex: 'createdAt', key: 'createdAt', width: 180 },
  ]

  return (
    <Card
      title="Audit Trail"
      extra={
        <Button icon={<ReloadOutlined />} onClick={() => { setPage(1); fetchSessions() }}>
          Refresh
        </Button>
      }
    >
      <Space style={{ marginBottom: 16 }} wrap>
        <Input
          placeholder="Bot ID"
          type="number"
          onChange={(e) => {
            setFilters({ ...filters, botId: e.target.value ? parseInt(e.target.value) : undefined })
            setPage(1)
          }}
          style={{ width: 120 }}
        />
        <Select
          placeholder="Filter by result"
          allowClear
          style={{ width: 150 }}
          options={[
            { label: 'Success', value: true },
            { label: 'Failure', value: false },
          ]}
          onChange={(value) => {
            setFilters({ ...filters, success: value })
            setPage(1)
          }}
        />
      </Space>

      <Table
        dataSource={sessions}
        columns={columns}
        rowKey="gameId"
        loading={loading}
        pagination={{
          current: page,
          pageSize: 20,
          total,
          onChange: setPage,
        }}
        size="small"
        scroll={{ x: 'max-content' }}
      />
    </Card>
  )
}
