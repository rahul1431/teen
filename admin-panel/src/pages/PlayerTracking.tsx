import { useCallback, useEffect, useState } from 'react'
import { Card, Row, Col, Table, Tag, Statistic, Drawer, Spin, Typography, List, Grid } from 'antd'
import { MobileOutlined, EnvironmentOutlined, AimOutlined } from '@ant-design/icons'
import { MapContainer, TileLayer, CircleMarker, Tooltip as LTooltip } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import { adminApi } from '../api/client'

const { Text } = Typography

interface LivePlayer {
  session_id: string; user_id: string | null; username: string | null; phone: string | null
  device_model: string | null; manufacturer: string | null; platform: string
  ip_address: string | null; geo_city: string | null; geo_region: string | null
  geo_lat: number | null; geo_lon: number | null
  last_screen: string | null; last_game: string | null
  started_at: string; last_seen_at: string
}
interface GeoPoint { lat: number; lon: number; city: string | null; players: number }

export default function PlayerTracking() {
  const screens = Grid.useBreakpoint()
  const isMobile = !screens.md
  const [players, setPlayers] = useState<LivePlayer[]>([])
  const [geo, setGeo] = useState<GeoPoint[]>([])
  const [loading, setLoading] = useState(true)
  const [detail, setDetail] = useState<any>(null)
  const [detailOpen, setDetailOpen] = useState(false)

  const load = useCallback(async () => {
    try {
      const [pRes, gRes] = await Promise.allSettled([
        adminApi.get('/monitor/live-players'),
        adminApi.get('/monitor/geo-distribution'),
      ])
      if (pRes.status === 'fulfilled') setPlayers(pRes.value.data?.data ?? [])
      if (gRes.status === 'fulfilled') setGeo(gRes.value.data?.data ?? [])
    } finally { setLoading(false) }
  }, [])

  useEffect(() => {
    load()
    const t = setInterval(load, 30_000)
    window.addEventListener('aiDashboardRefresh', load)
    return () => {
      clearInterval(t)
      window.removeEventListener('aiDashboardRefresh', load)
    }
  }, [load])

  const openDetail = async (userId: string | null) => {
    if (!userId) return
    setDetailOpen(true); setDetail(null)
    const res = await adminApi.get(`/monitor/player/${userId}`)
    setDetail(res.data?.data ?? null)
  }

  const userLabel = (r: LivePlayer) =>
    r.username || r.phone || (r.user_id ? r.user_id.slice(0, 8) : 'guest')

  return (
    <Spin spinning={loading && players.length === 0}>
      <h2 style={{ color: '#d4af37', marginBottom: 16 }}>🛰️ Player Tracking</h2>

      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col span={6}><Card size="small"><Statistic title="Live Players" value={players.length} prefix={<MobileOutlined />} valueStyle={{ color: '#52c41a' }} /></Card></Col>
        <Col span={6}><Card size="small"><Statistic title="Android" value={players.filter(p => p.platform === 'android').length} /></Card></Col>
        <Col span={6}><Card size="small"><Statistic title="iOS" value={players.filter(p => p.platform === 'ios').length} /></Card></Col>
        <Col span={6}><Card size="small"><Statistic title="Located" value={players.filter(p => p.geo_lat != null).length} prefix={<EnvironmentOutlined />} /></Card></Col>
      </Row>

      <Card size="small" title={<span><EnvironmentOutlined /> Live Player Map</span>} style={{ marginBottom: 16 }}>
        <div style={{ height: 340 }}>
          <MapContainer center={[22.35, 78.66]} zoom={4} style={{ height: '100%', width: '100%' }}>
            <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              attribution="&copy; OpenStreetMap" />
            {geo.filter(g => g.lat != null && g.lon != null).map((g, i) => (
              <CircleMarker key={i} center={[g.lat, g.lon]} radius={6 + Math.min(g.players, 12)}
                pathOptions={{ color: '#d4af37', fillOpacity: 0.5 }}>
                <LTooltip>{`${g.city ?? 'Unknown'}: ${g.players} player(s)`}</LTooltip>
              </CircleMarker>
            ))}
          </MapContainer>
        </div>
      </Card>

      <Card size="small" title={<span><AimOutlined /> Live Players</span>}>
        <Table<LivePlayer>
          dataSource={players}
          rowKey="session_id"
          size="small"
          pagination={{ pageSize: 15, size: 'small' }}
          onRow={r => ({ onClick: () => openDetail(r.user_id), style: { cursor: 'pointer' } })}
          columns={[
            { title: 'Device Name', dataIndex: 'device_model', width: 180,
              render: (v, r) => <span><Tag color={r.platform === 'android' ? 'green' : 'blue'}>{r.platform}</Tag>{r.manufacturer ? `${r.manufacturer} ` : ''}{v ?? 'unknown'}</span> },
            { title: 'User', dataIndex: 'username', width: 150, render: (_v, r) => <Text strong>{userLabel(r)}</Text> },
            { title: 'Live Location', dataIndex: 'geo_city', width: 180,
              render: (v, r) => r.geo_lat != null
                ? <span><EnvironmentOutlined /> {v ?? ''}{r.geo_region ? `, ${r.geo_region}` : ''} <Text type="secondary" style={{ fontSize: 10 }}>({r.geo_lat?.toFixed(2)}, {r.geo_lon?.toFixed(2)})</Text></span>
                : <Text type="secondary">—</Text> },
            { title: 'IP Address', dataIndex: 'ip_address', width: 130, render: v => <Text code style={{ fontSize: 11 }}>{v ?? '—'}</Text> },
            { title: 'Game', dataIndex: 'last_game', width: 130, render: v => v ? <Tag color="purple">{v}</Tag> : <Text type="secondary">{'—'}</Text> },
          ]}
          scroll={{ x: 'max-content' }}
        />
      </Card>

      <Drawer title="Player Detail" width={isMobile ? '100%' : 560} open={detailOpen} onClose={() => setDetailOpen(false)}>
        {!detail ? <Spin /> : (
          <>
            <Card size="small" title="Recent Sessions" style={{ marginBottom: 12 }}>
              <List size="small" dataSource={detail.sessions ?? []}
                renderItem={(s: any) => <List.Item>{s.device_model ?? '?'} · {s.geo_city ?? '?'} · {new Date(s.started_at).toLocaleString()}</List.Item>} />
            </Card>
            <Card size="small" title="Screen Timeline" style={{ marginBottom: 12 }}>
              <List size="small" dataSource={detail.screens ?? []}
                renderItem={(s: any) => <List.Item>{s.screen} — {new Date(s.created_at).toLocaleTimeString()}</List.Item>} />
            </Card>
            <Card size="small" title="Game Activity" style={{ marginBottom: 12 }}>
              <List size="small" dataSource={detail.games ?? []}
                renderItem={(g: any) => <List.Item>{g.action} @ {g.screen ?? '?'} — {new Date(g.created_at).toLocaleTimeString()}</List.Item>} />
            </Card>
            <Card size="small" title="Location History">
              <List size="small" dataSource={detail.locations ?? []}
                renderItem={(l: any) => <List.Item>{l.lat.toFixed(4)}, {l.lon.toFixed(4)} (±{l.accuracy_m ?? '?'}m) — {new Date(l.created_at).toLocaleTimeString()}</List.Item>} />
            </Card>
          </>
        )}
      </Drawer>
    </Spin>
  )
}
