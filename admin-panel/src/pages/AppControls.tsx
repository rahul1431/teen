import React, { useEffect, useState } from 'react'
import { Card, Switch, Alert, Spin, Typography, Space, Row, Col, Input, InputNumber, Button, Tag, message } from 'antd'
import {
  SafetyCertificateOutlined,
  WarningOutlined,
  WalletOutlined,
  RocketOutlined,
  NumberOutlined,
  BgColorsOutlined,
  IdcardOutlined,
  BlockOutlined,
  CrownOutlined,
  AimOutlined,
  LinkOutlined,
  UserSwitchOutlined,
  SaveOutlined,
} from '@ant-design/icons'
import { adminApi } from '../api/client'
import { useAuthStore } from '../store/auth'

const { Title, Text, Paragraph } = Typography

interface FeatureFlagsState {
  wallet: {
    deposit_enabled: boolean
    withdrawal_enabled: boolean
  }
  games: Record<string, boolean>
  review: {
    version_code: number
    active: boolean
    tester_phones: string
  }
  urls: {
    cashier_url: string
    kyc_url: string
  }
}

const GAME_INFO: Record<string, { label: string; icon: React.ReactNode; isRestricted: boolean; category: string }> = {
  teen_patti: { label: 'Teen Patti', icon: <IdcardOutlined />, isRestricted: false, category: 'Skill Card' },
  ludo: { label: 'Ludo', icon: <BlockOutlined />, isRestricted: false, category: 'Board Game' },
  rummy: { label: 'Rummy', icon: <IdcardOutlined />, isRestricted: false, category: 'Skill Card' },
  cricket: { label: 'Cricket Fantasy', icon: <AimOutlined />, isRestricted: false, category: 'Fantasy' },
  lottery: { label: 'Lottery', icon: <CrownOutlined />, isRestricted: false, category: 'Draw' },
  matka: { label: 'Satta Matka', icon: <NumberOutlined />, isRestricted: true, category: 'RNG / Betting' },
  aviator: { label: 'Aviator (Crash)', icon: <RocketOutlined />, isRestricted: true, category: 'Crash RNG' },
  color_prediction: { label: 'Color Prediction (Wingo)', icon: <BgColorsOutlined />, isRestricted: true, category: 'Prediction RNG' },
}

export default function AppControls() {
  const { admin } = useAuthStore()
  const isSuperadmin = admin?.role === 'superadmin'

  const [loading, setLoading] = useState(true)
  const [updatingKey, setUpdatingKey] = useState<string | null>(null)
  const [flags, setFlags] = useState<FeatureFlagsState>({
    wallet: { deposit_enabled: false, withdrawal_enabled: false },
    games: {},
    review: { version_code: 0, active: false, tester_phones: '' },
    urls: { cashier_url: 'https://game.myonlinejoker.com/cashier', kyc_url: 'https://game.myonlinejoker.com/cashier/kyc' },
  })

  // Local form state for inputs
  const [reviewVersion, setReviewVersion] = useState<number>(0)
  const [reviewActive, setReviewActive] = useState<boolean>(false)
  const [testerPhones, setTesterPhones] = useState<string>('')
  const [cashierUrl, setCashierUrl] = useState<string>('')
  const [kycUrl, setKycUrl] = useState<string>('')

  const fetchFlags = async () => {
    try {
      setLoading(true)
      const res = await adminApi.get('/feature-flags')
      if (res.data?.success) {
        const wallet = res.data.wallet || { deposit_enabled: false, withdrawal_enabled: false }
        const games = res.data.games || {}
        const review = res.data.review || { version_code: 0, active: false, tester_phones: '' }
        const urls = res.data.urls || { cashier_url: 'https://game.myonlinejoker.com/cashier', kyc_url: 'https://game.myonlinejoker.com/cashier/kyc' }

        setFlags({ wallet, games, review, urls })
        setReviewVersion(review.version_code)
        setReviewActive(review.active)
        setTesterPhones(review.tester_phones)
        setCashierUrl(urls.cashier_url)
        setKycUrl(urls.kyc_url)
      }
    } catch (err: any) {
      message.error(err.response?.data?.error || 'Failed to load app controls')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchFlags()
  }, [])

  const handleWalletToggle = async (key: 'deposit_enabled' | 'withdrawal_enabled', enabled: boolean) => {
    if (!isSuperadmin) {
      message.warning('Only superadmin can modify feature flags')
      return
    }
    try {
      setUpdatingKey(`wallet_${key}`)
      const res = await adminApi.patch('/feature-flags/wallet', { key, enabled })
      if (res.data?.success) {
        setFlags(prev => ({
          ...prev,
          wallet: {
            ...prev.wallet,
            [key]: enabled,
          },
        }))
        message.success(`${key === 'deposit_enabled' ? 'Deposit' : 'Withdrawal'} is now ${enabled ? 'Enabled' : 'Disabled'}`)
      }
    } catch (err: any) {
      message.error(err.response?.data?.error || 'Failed to update wallet setting')
    } finally {
      setUpdatingKey(null)
    }
  }

  const handleGameToggle = async (gameType: string, enabled: boolean) => {
    if (!isSuperadmin) {
      message.warning('Only superadmin can modify feature flags')
      return
    }
    try {
      setUpdatingKey(`game_${gameType}`)
      const res = await adminApi.patch(`/feature-flags/games/${gameType}`, { enabled })
      if (res.data?.success) {
        setFlags(prev => ({
          ...prev,
          games: {
            ...prev.games,
            [gameType]: enabled,
          },
        }))
        message.success(`${GAME_INFO[gameType]?.label || gameType} is now ${enabled ? 'Active' : 'Disabled'}`)
      }
    } catch (err: any) {
      message.error(err.response?.data?.error || 'Failed to update game status')
    } finally {
      setUpdatingKey(null)
    }
  }

  const handleSaveReviewSettings = async () => {
    if (!isSuperadmin) {
      message.warning('Only superadmin can modify review settings')
      return
    }
    try {
      setUpdatingKey('review_settings')
      const res = await adminApi.patch('/feature-flags/review-mode', {
        version_code: reviewVersion,
        active: reviewActive,
        tester_phones: testerPhones,
      })
      if (res.data?.success) {
        setFlags(prev => ({
          ...prev,
          review: {
            version_code: reviewVersion,
            active: reviewActive,
            tester_phones: testerPhones,
          },
        }))
        message.success('Review mode settings saved successfully')
      }
    } catch (err: any) {
      message.error(err.response?.data?.error || 'Failed to save review settings')
    } finally {
      setUpdatingKey(null)
    }
  }

  const handleSaveUrls = async () => {
    if (!isSuperadmin) {
      message.warning('Only superadmin can modify dynamic URLs')
      return
    }
    try {
      setUpdatingKey('urls')
      const res = await adminApi.patch('/feature-flags/urls', {
        cashier_url: cashierUrl,
        kyc_url: kycUrl,
      })
      if (res.data?.success) {
        setFlags(prev => ({
          ...prev,
          urls: {
            cashier_url: cashierUrl,
            kyc_url: kycUrl,
          },
        }))
        message.success('Dynamic URLs updated successfully')
      }
    } catch (err: any) {
      message.error(err.response?.data?.error || 'Failed to update URLs')
    } finally {
      setUpdatingKey(null)
    }
  }

  if (loading) {
    return (
      <div style={{ padding: 48, textAlign: 'center' }}>
        <Spin size="large" />
      </div>
    )
  }

  const restrictedGames = Object.keys(flags.games).filter(k => GAME_INFO[k]?.isRestricted)
  const standardGames = Object.keys(flags.games).filter(k => !GAME_INFO[k]?.isRestricted)

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', paddingBottom: 40 }}>
      <Space direction="vertical" size="large" style={{ width: '100%' }}>
        <div>
          <Title level={3} style={{ marginBottom: 4 }}>
            App Feature Controls & Play Store Mode
          </Title>
          <Paragraph type="secondary">
            Manage live app features remotely without requiring an APK update. Disable restricted modules for Play Store reviews and re-enable them post-approval.
          </Paragraph>
        </div>

        {/* Play Store Review Mode & Version Gating */}
        <Card
          title={
            <Space>
              <UserSwitchOutlined style={{ color: '#1890ff' }} />
              <span>Targeted Google Play Review Mode (Zero-Downtime Updates)</span>
            </Space>
          }
          extra={
            reviewActive ? (
              <Tag color="error">Review Mode Active (Targeting Build #{reviewVersion})</Tag>
            ) : (
              <Tag color="success">Standard Live Mode</Tag>
            )
          }
        >
          <Paragraph type="secondary" style={{ marginBottom: 16 }}>
            When Review Mode is <b>ACTIVE</b>, only devices running the specified <b>Under-Review Build Number</b> will see Safe Mode (pure virtual coins, no wallet, no KYC, no luck games). <b>Existing players on older builds and whitelisted testers will continue playing all games with 0 interruption.</b>
          </Paragraph>

          <Row gutter={[24, 24]}>
            <Col xs={24} md={8}>
              <Text strong>Review Mode Master Switch</Text>
              <div style={{ marginTop: 8 }}>
                <Switch
                  checked={reviewActive}
                  disabled={!isSuperadmin}
                  onChange={setReviewActive}
                  checkedChildren="ACTIVE"
                  unCheckedChildren="OFF"
                />
              </div>
            </Col>

            <Col xs={24} md={8}>
              <Text strong>Under-Review Build Number</Text>
              <div style={{ marginTop: 8 }}>
                <InputNumber
                  style={{ width: '100%' }}
                  value={reviewVersion}
                  disabled={!isSuperadmin}
                  onChange={(val) => setReviewVersion(val || 0)}
                  placeholder="e.g. 4263"
                />
              </div>
            </Col>

            <Col xs={24} md={8}>
              <Text strong>Tester / Admin Whitelist Phones</Text>
              <div style={{ marginTop: 8 }}>
                <Input
                  value={testerPhones}
                  disabled={!isSuperadmin}
                  onChange={(e) => setTesterPhones(e.target.value)}
                  placeholder="e.g. 9876543210, 9123456789"
                />
              </div>
              <Text type="secondary" style={{ fontSize: 11 }}>Comma-separated mobile numbers that always bypass safe mode.</Text>
            </Col>

            <Col xs={24} style={{ textAlign: 'right' }}>
              <Button
                type="primary"
                icon={<SaveOutlined />}
                loading={updatingKey === 'review_settings'}
                disabled={!isSuperadmin}
                onClick={handleSaveReviewSettings}
              >
                Save Review Settings
              </Button>
            </Col>
          </Row>
        </Card>

        {/* Dynamic URLs (Web Cashier & KYC) */}
        <Card
          title={
            <Space>
              <LinkOutlined style={{ color: '#52c41a' }} />
              <span>Dynamic Cashier & KYC URLs (Alt 2 External Web Flow)</span>
            </Space>
          }
        >
          <Paragraph type="secondary" style={{ marginBottom: 16 }}>
            The mobile app opens these links inside a secure in-app browser (Chrome Custom Tab). You can update your payment links, merchant checkout, UPI gateway, or KYC forms anytime without an APK release.
          </Paragraph>

          <Row gutter={[24, 24]}>
            <Col xs={24} md={12}>
              <Text strong>Cashier / Deposit / Withdrawal URL</Text>
              <Input
                style={{ marginTop: 8 }}
                value={cashierUrl}
                disabled={!isSuperadmin}
                onChange={(e) => setCashierUrl(e.target.value)}
                placeholder="https://game.myonlinejoker.com/cashier"
              />
            </Col>

            <Col xs={24} md={12}>
              <Text strong>KYC Verification URL</Text>
              <Input
                style={{ marginTop: 8 }}
                value={kycUrl}
                disabled={!isSuperadmin}
                onChange={(e) => setKycUrl(e.target.value)}
                placeholder="https://game.myonlinejoker.com/cashier/kyc"
              />
            </Col>

            <Col xs={24} style={{ textAlign: 'right' }}>
              <Button
                type="primary"
                icon={<SaveOutlined />}
                loading={updatingKey === 'urls'}
                disabled={!isSuperadmin}
                onClick={handleSaveUrls}
              >
                Save Dynamic URLs
              </Button>
            </Col>
          </Row>
        </Card>

        {/* Wallet Controls */}
        <Card
          title={
            <Space>
              <WalletOutlined />
              <span>Wallet & Transactions</span>
            </Space>
          }
          extra={
            !flags.wallet.deposit_enabled && !flags.wallet.withdrawal_enabled ? (
              <Tag color="success">Play Store Safe (Wallet Disabled)</Tag>
            ) : (
              <Tag color="warning">Live Real Money Mode</Tag>
            )
          }
        >
          <Row gutter={[24, 24]}>
            <Col xs={24} md={12}>
              <Card type="inner" style={{ background: '#141824' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <Text strong style={{ fontSize: 16 }}>Add Money (Deposit)</Text>
                    <Paragraph type="secondary" style={{ margin: '4px 0 0', fontSize: 13 }}>
                      When OFF, the deposit button and payment options are hidden from the user app.
                    </Paragraph>
                  </div>
                  <Switch
                    checked={flags.wallet.deposit_enabled}
                    loading={updatingKey === 'wallet_deposit_enabled'}
                    disabled={!isSuperadmin}
                    onChange={(checked) => handleWalletToggle('deposit_enabled', checked)}
                  />
                </div>
              </Card>
            </Col>

            <Col xs={24} md={12}>
              <Card type="inner" style={{ background: '#141824' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <Text strong style={{ fontSize: 16 }}>Withdrawal (Payout)</Text>
                    <Paragraph type="secondary" style={{ margin: '4px 0 0', fontSize: 13 }}>
                      When OFF, the withdraw button and manual payout options are hidden from users.
                    </Paragraph>
                  </div>
                  <Switch
                    checked={flags.wallet.withdrawal_enabled}
                    loading={updatingKey === 'wallet_withdrawal_enabled'}
                    disabled={!isSuperadmin}
                    onChange={(checked) => handleWalletToggle('withdrawal_enabled', checked)}
                  />
                </div>
              </Card>
            </Col>
          </Row>
        </Card>

        {/* Restricted Games */}
        <Card
          title={
            <Space>
              <WarningOutlined style={{ color: '#faad14' }} />
              <span>Restricted Games (High Play Store Risk)</span>
            </Space>
          }
          extra={<Tag color="volcano">Review Sensitive</Tag>}
        >
          <Paragraph type="secondary" style={{ marginBottom: 16 }}>
            These games involve luck/pure-RNG mechanics that trigger automated or manual scrutiny by Google Play policy reviewers. Keep them OFF during review.
          </Paragraph>

          <Row gutter={[16, 16]}>
            {restrictedGames.map(gameKey => {
              const meta = GAME_INFO[gameKey] || { label: gameKey, icon: null, category: 'Game' }
              const isEnabled = flags.games[gameKey] === true
              return (
                <Col xs={24} sm={12} md={8} key={gameKey}>
                  <Card
                    size="small"
                    style={{
                      borderColor: isEnabled ? '#d48806' : undefined,
                      background: '#141824',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <Space>
                        {meta.icon}
                        <div>
                          <Text strong>{meta.label}</Text>
                          <div>
                            <Tag color="magenta" style={{ fontSize: 10, marginTop: 2 }}>{meta.category}</Tag>
                          </div>
                        </div>
                      </Space>
                      <Switch
                        checked={isEnabled}
                        loading={updatingKey === `game_${gameKey}`}
                        disabled={!isSuperadmin}
                        onChange={(checked) => handleGameToggle(gameKey, checked)}
                      />
                    </div>
                  </Card>
                </Col>
              )
            })}
          </Row>
        </Card>

        {/* Standard / Skill Games */}
        <Card
          title={
            <Space>
              <SafetyCertificateOutlined style={{ color: '#52c41a' }} />
              <span>Skill & Social Games</span>
            </Space>
          }
        >
          <Paragraph type="secondary" style={{ marginBottom: 16 }}>
            Standard games permissible under skill gaming definitions or free-play mode.
          </Paragraph>

          <Row gutter={[16, 16]}>
            {standardGames.map(gameKey => {
              const meta = GAME_INFO[gameKey] || { label: gameKey, icon: null, category: 'Game' }
              const isEnabled = flags.games[gameKey] === true
              return (
                <Col xs={24} sm={12} md={8} key={gameKey}>
                  <Card size="small" style={{ background: '#141824' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <Space>
                        {meta.icon}
                        <div>
                          <Text strong>{meta.label}</Text>
                          <div>
                            <Tag color="blue" style={{ fontSize: 10, marginTop: 2 }}>{meta.category}</Tag>
                          </div>
                        </div>
                      </Space>
                      <Switch
                        checked={isEnabled}
                        loading={updatingKey === `game_${gameKey}`}
                        disabled={!isSuperadmin}
                        onChange={(checked) => handleGameToggle(gameKey, checked)}
                      />
                    </div>
                  </Card>
                </Col>
              )
            })}
          </Row>
        </Card>
      </Space>
    </div>
  )
}
