import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import { Card, Empty } from 'antd'
import dayjs from 'dayjs'

interface MetricsChartsProps {
  data: any[]
  timeRange: '24h' | '7d' | '30d'
  title?: string
}

export function MetricsCharts({ data, timeRange, title = 'Win-Rate Trends' }: MetricsChartsProps) {
  if (!data || data.length === 0) {
    return (
      <Card title={title} style={{ borderRadius: 12 }}>
        <Empty description="No data available" />
      </Card>
    )
  }

  // Format data for charting based on time range
  const formattedData = data.map((item: any) => {
    const dateStr = item.hour || item.day
    let label = ''

    if (timeRange === '24h' && item.hour) {
      label = dayjs(item.hour).format('HH:mm')
    } else if (timeRange === '7d' && item.day) {
      label = dayjs(item.day).format('MMM DD')
    } else if (timeRange === '30d' && item.day) {
      label = dayjs(item.day).format('MMM DD')
    } else {
      label = dateStr
    }

    return {
      ...item,
      label,
      win_rate: (item.avg_win_rate * 100).toFixed(2),
      upper_band: ((item.avg_win_rate + 0.02) * 100).toFixed(2), // +2% band
      lower_band: Math.max(0, (item.avg_win_rate - 0.02) * 100).toFixed(2), // -2% band
    }
  })

  return (
    <Card title={title} style={{ borderRadius: 12 }}>
      <ResponsiveContainer width="100%" height={400}>
        <LineChart data={formattedData} margin={{ top: 5, right: 30, left: 0, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 12 }}
            interval={Math.max(0, Math.floor(formattedData.length / 8))}
          />
          <YAxis
            label={{ value: 'Win Rate (%)', angle: -90, position: 'insideLeft' }}
            domain={[0, 100]}
            tick={{ fontSize: 12 }}
          />
          <Tooltip
            formatter={(value: any) => {
              if (typeof value === 'string') return value + '%'
              return value.toFixed(2) + '%'
            }}
            labelFormatter={(label) => `Time: ${label}`}
            contentStyle={{ backgroundColor: '#f5f5f5', border: '1px solid #ddd', borderRadius: 4 }}
          />
          <Legend />
          <Line
            type="monotone"
            dataKey="win_rate"
            stroke="#1677ff"
            strokeWidth={2.5}
            dot={false}
            name="Win Rate"
            isAnimationActive={false}
          />
          <Line
            type="monotone"
            dataKey="upper_band"
            stroke="#52c41a"
            strokeWidth={1}
            strokeDasharray="5 5"
            dot={false}
            name="+2% Band"
            isAnimationActive={false}
          />
          <Line
            type="monotone"
            dataKey="lower_band"
            stroke="#ff7a45"
            strokeWidth={1}
            strokeDasharray="5 5"
            dot={false}
            name="-2% Band"
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </Card>
  )
}
