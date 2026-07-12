import { Dropdown, Button, Tag, Tooltip, Space, Divider, Typography, Row, Col } from 'antd'
import type { MenuProps } from 'antd'
import { SwapOutlined, CheckOutlined } from '@ant-design/icons'
import { useEnvironmentStore } from '../store/environment'
import { useAuthStore } from '../store/auth'
import { ENVIRONMENT_CONFIGS, Environment } from '../types/environment'
import { useState } from 'react'
import { Modal, message } from 'antd'

export default function EnvironmentSwitcher() {
  const { currentEnv, setEnvironment } = useEnvironmentStore()
  const { admin } = useAuthStore()
  const [confirmModalOpen, setConfirmModalOpen] = useState(false)
  const [targetEnv, setTargetEnv] = useState<Environment | null>(null)

  // Only show to DevAdmin and SuperAdmin
  const canSwitchEnvironment = admin && (admin.role === 'DevAdmin' || admin.role === 'SuperAdmin' || admin.role === 'superadmin')
  if (!canSwitchEnvironment) return null

  const config = ENVIRONMENT_CONFIGS[currentEnv]
  const otherEnv: Environment = currentEnv === 'dev' ? 'prod' : 'dev'
  const otherConfig = ENVIRONMENT_CONFIGS[otherEnv]

  const handleSwitchClick = (env: Environment) => {
    if (env === currentEnv) return

    // Show warning for production switch
    if (env === 'prod') {
      setTargetEnv(env)
      setConfirmModalOpen(true)
    } else {
      performSwitch(env)
    }
  }

  const performSwitch = (env: Environment) => {
    setEnvironment(env)
    message.success(`Switched to ${ENVIRONMENT_CONFIGS[env].label} environment`)
    setConfirmModalOpen(false)
    setTargetEnv(null)
  }

  const menuItems: MenuProps['items'] = [
    {
      key: 'info',
      label: (
        <div style={{ pointerEvents: 'none', padding: '8px 0' }}>
          <Typography.Text strong>Current Environment</Typography.Text>
        </div>
      ),
      disabled: true,
    },
    {
      key: 'current',
      label: (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div
            style={{
              width: 12,
              height: 12,
              borderRadius: '50%',
              backgroundColor: config.color,
            }}
          />
          <span>{config.label}</span>
          <CheckOutlined style={{ marginLeft: 'auto', color: '#52c41a' }} />
        </div>
      ),
      disabled: true,
    },
    { type: 'divider' },
    {
      key: 'switch',
      label: (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <SwapOutlined />
          Switch to {otherConfig.label}
        </div>
      ),
      onClick: () => handleSwitchClick(otherEnv),
      danger: otherEnv === 'prod',
    },
    { type: 'divider' },
    {
      key: 'info-header',
      label: (
        <div style={{ pointerEvents: 'none', padding: '8px 0' }}>
          <Typography.Text strong>Environment Info</Typography.Text>
        </div>
      ),
      disabled: true,
    },
    {
      key: 'details',
      label: (
        <div style={{ pointerEvents: 'none', minWidth: 280, padding: '4px 0' }}>
          <Row gutter={[8, 12]}>
            <Col xs={24}>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                Domain
              </Typography.Text>
              <Typography.Paragraph style={{ margin: '2px 0', fontSize: 13, fontWeight: 500 }}>
                {config.domain}
              </Typography.Paragraph>
            </Col>
            <Col xs={24}>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                Database
              </Typography.Text>
              <Typography.Paragraph style={{ margin: '2px 0', fontSize: 13, fontWeight: 500 }}>
                {config.database}
              </Typography.Paragraph>
            </Col>
            <Col xs={24}>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                API Port
              </Typography.Text>
              <Typography.Paragraph style={{ margin: '2px 0', fontSize: 13, fontWeight: 500 }}>
                :{config.servicePorts.api}
              </Typography.Paragraph>
            </Col>
            <Col xs={24}>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                Redis Port
              </Typography.Text>
              <Typography.Paragraph style={{ margin: '2px 0', fontSize: 13, fontWeight: 500 }}>
                :{config.redisPort}
              </Typography.Paragraph>
            </Col>
          </Row>
        </div>
      ),
      disabled: true,
    },
  ]

  return (
    <>
      <Tooltip
        title={`Current: ${config.label} Environment`}
        color={config.color}
      >
        <Dropdown menu={{ items: menuItems }} placement="bottomRight" trigger={['click']}>
          <Button
            type="text"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '4px 12px',
              height: 32,
              borderRadius: 4,
              border: `1px solid ${config.color}`,
            }}
          >
            <div
              style={{
                width: 10,
                height: 10,
                borderRadius: '50%',
                backgroundColor: config.color,
              }}
            />
            <span style={{ fontSize: 12, fontWeight: 600, color: config.color }}>
              {config.label}
            </span>
          </Button>
        </Dropdown>
      </Tooltip>

      <Modal
        title="⚠️ Switch to Production Environment"
        open={confirmModalOpen}
        onOk={() => performSwitch('prod')}
        onCancel={() => setConfirmModalOpen(false)}
        okText="I understand, switch"
        cancelText="Cancel"
        okButtonProps={{ danger: true }}
        centered
      >
        <div style={{ marginBottom: 16 }}>
          <Space direction="vertical" size="large" style={{ width: '100%' }}>
            <div style={{ padding: '12px', backgroundColor: '#fef2f2', borderRadius: 4, borderLeft: '3px solid #ff4d4f' }}>
              <Typography.Text strong>
                You are about to switch to the PRODUCTION environment.
              </Typography.Text>
              <Typography.Paragraph style={{ margin: '8px 0 0 0', color: '#666' }}>
                Any changes you make here will affect all users. Proceed with caution.
              </Typography.Paragraph>
            </div>

            <div>
              <Typography.Text strong>Current Environment</Typography.Text>
              <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
                <div
                  style={{
                    width: 12,
                    height: 12,
                    borderRadius: '50%',
                    backgroundColor: ENVIRONMENT_CONFIGS.dev.color,
                  }}
                />
                <span>DEV</span>
              </div>
            </div>

            <div>
              <Typography.Text strong>Switching to</Typography.Text>
              <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
                <div
                  style={{
                    width: 12,
                    height: 12,
                    borderRadius: '50%',
                    backgroundColor: ENVIRONMENT_CONFIGS.prod.color,
                  }}
                />
                <span style={{ color: ENVIRONMENT_CONFIGS.prod.color, fontWeight: 600 }}>
                  PROD
                </span>
              </div>
            </div>
          </Space>
        </div>
      </Modal>
    </>
  )
}
