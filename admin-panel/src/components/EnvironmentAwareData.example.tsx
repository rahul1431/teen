/**
 * EXAMPLE: Environment-Aware Data Fetching Component
 *
 * This file demonstrates best practices for handling environment switching
 * in data-fetching components. Copy the patterns here to your own pages.
 *
 * DO NOT USE THIS FILE IN PRODUCTION - it's for reference only.
 */

import { useState, useEffect } from 'react'
import { Card, Spin, Alert, Button, Space } from 'antd'
import { ReloadOutlined } from '@ant-design/icons'
import { api } from '../api/client'
import { useEnvironmentStore } from '../store/environment'
import { useEnvironmentEffect } from '../hooks/useEnvironmentEffect'
import { createEnvMessage, logWithEnv } from '../utils/environment'

interface DataItem {
  id: string
  name: string
  value: number
}

/**
 * Pattern 1: Basic environment-aware data fetching
 * Refetch automatically when environment changes
 */
export function BasicEnvironmentAware() {
  const { currentEnv } = useEnvironmentStore()
  const [data, setData] = useState<DataItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Automatically refetch when environment changes
  useEnvironmentEffect(async () => {
    await fetchData()
  }, [])

  const fetchData = async () => {
    setLoading(true)
    setError(null)
    try {
      logWithEnv('Fetching data...')
      const response = await api.get('/dashboard/data')
      setData(response.data)
      logWithEnv('Data fetched successfully', response.data)
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to fetch data'
      setError(errorMsg)
      console.error(createEnvMessage(errorMsg))
    } finally {
      setLoading(false)
    }
  }

  return (
    <Card title="Basic Pattern">
      <Space direction="vertical" style={{ width: '100%' }}>
        <Alert
          message={`Current Environment: ${currentEnv.toUpperCase()}`}
          description="Data will automatically refetch when you switch environments"
          type="info"
          showIcon
        />
        {loading && <Spin />}
        {error && <Alert message={error} type="error" showIcon />}
        {!loading && data.length > 0 && (
          <div>
            <p>Loaded {data.length} items from {currentEnv.toUpperCase()}</p>
            {data.map((item) => (
              <div key={item.id}>{item.name}: {item.value}</div>
            ))}
          </div>
        )}
      </Space>
    </Card>
  )
}

/**
 * Pattern 2: Manual environment switching with loading state
 * Useful when you want to show a loading indicator while data refreshes
 */
export function ManualEnvironmentSwitch() {
  const { currentEnv } = useEnvironmentStore()
  const [data, setData] = useState<DataItem[]>([])
  const [isRefreshing, setIsRefreshing] = useState(false)

  const handleRefresh = async () => {
    setIsRefreshing(true)
    try {
      logWithEnv('Manually refreshing data...')
      const response = await api.get('/dashboard/data')
      setData(response.data)
    } catch (err) {
      console.error(createEnvMessage('Failed to refresh data'), err)
    } finally {
      setIsRefreshing(false)
    }
  }

  useEffect(() => {
    handleRefresh()
  }, [currentEnv])

  return (
    <Card
      title="Manual Refresh Pattern"
      extra={
        <Button
          icon={<ReloadOutlined />}
          onClick={handleRefresh}
          loading={isRefreshing}
        >
          Refresh
        </Button>
      }
    >
      <Space direction="vertical" style={{ width: '100%' }}>
        <Alert
          message={`Environment: ${currentEnv.toUpperCase()}`}
          description={isRefreshing ? 'Refreshing data...' : 'Click refresh to update'}
          type={isRefreshing ? 'warning' : 'info'}
          showIcon
        />
        {data.length > 0 && (
          <div>
            {data.map((item) => (
              <div key={item.id}>{item.name}: {item.value}</div>
            ))}
          </div>
        )}
      </Space>
    </Card>
  )
}

/**
 * Pattern 3: Environment-aware pagination
 * Reset pagination when environment changes
 */
export function EnvironmentAwarePagination() {
  const { currentEnv } = useEnvironmentStore()
  const [data, setData] = useState<DataItem[]>([])
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)

  // Reset pagination when environment changes
  useEnvironmentEffect(async () => {
    setPage(1)
    await fetchData(1)
  }, [])

  const fetchData = async (pageNum: number) => {
    setLoading(true)
    try {
      const response = await api.get('/dashboard/data', {
        params: { page: pageNum, limit: 10 },
      })
      setData(response.data)
    } catch (err) {
      console.error(createEnvMessage('Failed to fetch paginated data'))
    } finally {
      setLoading(false)
    }
  }

  const handlePageChange = async (newPage: number) => {
    setPage(newPage)
    await fetchData(newPage)
  }

  return (
    <Card title="Pagination Pattern">
      <Space direction="vertical" style={{ width: '100%' }}>
        <Alert
          message={`Environment: ${currentEnv.toUpperCase()} | Page: ${page}`}
          description="Pagination resets when environment changes"
          type="info"
          showIcon
        />
        {loading && <Spin />}
        {data.length > 0 && (
          <div>
            {data.map((item) => (
              <div key={item.id}>{item.name}</div>
            ))}
            <Space style={{ marginTop: 16 }}>
              <Button onClick={() => handlePageChange(page - 1)} disabled={page === 1}>
                Previous
              </Button>
              <span>Page {page}</span>
              <Button onClick={() => handlePageChange(page + 1)}>Next</Button>
            </Space>
          </div>
        )}
      </Space>
    </Card>
  )
}

/**
 * Pattern 4: Multiple data sources with environment awareness
 * Handle multiple API calls when environment changes
 */
export function MultipleDataSourcesPattern() {
  const { currentEnv } = useEnvironmentStore()
  const [users, setUsers] = useState<DataItem[]>([])
  const [stats, setStats] = useState<DataItem[]>([])
  const [loading, setLoading] = useState(false)

  useEnvironmentEffect(async () => {
    setLoading(true)
    try {
      logWithEnv('Fetching multiple data sources...')
      const [usersRes, statsRes] = await Promise.all([
        api.get('/users'),
        api.get('/stats'),
      ])
      setUsers(usersRes.data)
      setStats(statsRes.data)
      logWithEnv('All data fetched successfully')
    } catch (err) {
      console.error(createEnvMessage('Failed to fetch data'))
    } finally {
      setLoading(false)
    }
  }, [])

  return (
    <Card title="Multiple Data Sources">
      <Space direction="vertical" style={{ width: '100%' }}>
        <Alert
          message={`Environment: ${currentEnv.toUpperCase()}`}
          description={`Users: ${users.length} | Stats: ${stats.length}`}
          type="info"
          showIcon
        />
        {loading && <Spin />}
      </Space>
    </Card>
  )
}
