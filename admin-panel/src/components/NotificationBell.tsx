import { Badge, Dropdown, Button, List, Switch, Typography, Empty } from 'antd'
import { BellOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import { adminApi } from '../api/client'
import { useNotificationStore } from '../store/notifications'
import { useAdminNotifications } from '../hooks/useAdminNotifications'

const { Text } = Typography

export default function NotificationBell() {
  useAdminNotifications()
  const navigate = useNavigate()
  const { items, unreadCount, muted, markRead, toggleMute } = useNotificationStore()

  const onItemClick = async (id: number, refTable: string | null) => {
    markRead(id)
    try { await adminApi.patch(`/notifications/${id}/read`) } catch { /* best-effort */ }
    const dest: Record<string, string> = {
      payment_orders: '/admin/finance',
      users: '/admin/users',
      support_tickets: '/admin/support',
      kyc_documents: '/admin/kyc',
      wallet_transactions: '/admin/finance',
    }
    if (refTable && dest[refTable]) navigate(dest[refTable])
  }

  const dropdownContent = (
    <div style={{ width: 340, background: '#fff', borderRadius: 8, boxShadow: '0 2px 8px rgba(0,0,0,0.15)' }}>
      <div style={{ padding: '10px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #f0f0f0' }}>
        <Text strong>Notifications</Text>
        <Switch size="small" checked={!muted} onChange={toggleMute} checkedChildren="🔔" unCheckedChildren="🔕" />
      </div>
      <List
        style={{ maxHeight: 360, overflowY: 'auto' }}
        dataSource={items.slice(0, 10)}
        locale={{ emptyText: <Empty description="No notifications yet" style={{ padding: 24 }} /> }}
        renderItem={(item) => (
          <List.Item
            style={{ padding: '10px 16px', cursor: 'pointer', background: item.read ? '#fff' : '#f6ffed' }}
            onClick={() => onItemClick(item.id, item.ref_table)}
          >
            <div>
              <Text strong={!item.read}>{item.title}</Text>
              <br />
              <Text type="secondary" style={{ fontSize: 12 }}>{item.body}</Text>
            </div>
          </List.Item>
        )}
      />
      <div style={{ padding: 8, textAlign: 'center', borderTop: '1px solid #f0f0f0' }}>
        <Button type="link" size="small" onClick={() => navigate('/admin/notifications-history')}>View All</Button>
      </div>
    </div>
  )

  return (
    <Dropdown popupRender={() => dropdownContent} trigger={['click']} placement="bottomRight">
      <Badge count={unreadCount} size="small">
        <Button type="text" icon={<BellOutlined style={{ fontSize: 18 }} />} />
      </Badge>
    </Dropdown>
  )
}
