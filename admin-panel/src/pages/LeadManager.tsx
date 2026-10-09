import { useEffect, useState, useRef } from 'react'
import {
  Table, Input, Select, Button, Tag, Space, Modal, Form,
  message, Popconfirm, Row, Col, Card, Typography, Tooltip,
  Tabs, Slider, Badge, Alert, Statistic, Checkbox
} from 'antd'
import {
  SearchOutlined, PlusOutlined, DeleteOutlined,
  EditOutlined, ExportOutlined, CopyOutlined, ReloadOutlined,
  WhatsAppOutlined, UserOutlined, SendOutlined, DisconnectOutlined,
  BarChartOutlined, KeyOutlined, SyncOutlined, SoundOutlined, HistoryOutlined
} from '@ant-design/icons';

import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip as ChartTooltip, Legend, ResponsiveContainer,
  BarChart, Bar
} from 'recharts'
import { adminApi } from '../api/client'
import { tokens } from '../theme/tokens'

type Lead = {
  id: number
  source_user_id?: string
  source_username?: string
  contact_name: string
  contact_phone: string
  contact_email?: string
  status: 'new' | 'contacted' | 'interested' | 'converted' | 'rejected'
  lead_group?: string
  notes?: string
  created_at: string
  updated_at: string
  is_registered?: boolean
  whatsapp_exists?: boolean | null
  telegram_exists?: boolean | null
}

interface MarketingSession {
  id: string
  protocol: 'whatsapp' | 'telegram'
  status: 'connected' | 'disconnected' | 'pairing'
  phoneNumber?: string
  handle?: string
  dc?: string
  battery?: number
  subscribers?: number
  qrCode?: string
  logs: string[]
  lastActive: string
}

export default function LeadManager() {
  const [activeTab, setActiveTab] = useState('leads')
  const [leads, setLeads] = useState<Lead[]>([])
  const [loading, setLoading] = useState(false)
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [leadGroupFilter, setLeadGroupFilter] = useState('')
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([])

  // Modal states
  const [addModalOpen, setAddModalOpen] = useState(false)
  const [editLead, setEditLead] = useState<Lead | null>(null)
  const [bulkStatusOpen, setBulkStatusOpen] = useState(false)
  const [bulkStatusVal, setBulkStatusVal] = useState<'new' | 'contacted' | 'interested' | 'converted' | 'rejected'>('contacted')
  const [bulkGroupOpen, setBulkGroupOpen] = useState(false)
  const [bulkGroupVal, setBulkGroupVal] = useState('all_users')
  const [availableGroups, setAvailableGroups] = useState<string[]>(['all_users', 'allready_player', 'invite', 'uninstalled_users', 'new_users'])

  // Auth Hub States
  const [sessions, setSessions] = useState<MarketingSession[]>([])
  const [pairingModalOpen, setPairingModalOpen] = useState(false)
  const [pairingSession, setPairingSession] = useState<MarketingSession | null>(null)
  const [pairingProtocol, setPairingProtocol] = useState<'whatsapp' | 'telegram'>('whatsapp')
  const [countdown, setCountdown] = useState(30)
  const countdownInterval = useRef<any>(null)
  const [qrModalOpen, setQrModalOpen] = useState(false)
  const [tgVerifyModalOpen, setTgVerifyModalOpen] = useState(false)
  const [qrCodeText, setQrCodeText] = useState<string | undefined>()
  const [telegramCode, setTelegramCode] = useState('')
  const [telegramPassword, setTelegramPassword] = useState('')
  const qrPollRef = useRef<any>(null)

  // Dispatcher States
  const [dispatchChannel, setDispatchChannel] = useState<'whatsapp' | 'telegram' | 'all'>('whatsapp')
  const [messageTemplate, setMessageTemplate] = useState('{Hello|Hi|Hey} {there|friend|player}! 🎲 Get 100% Welcome Bonus on Teen Patti now. Play here: https://game.myonlinejoker.com')
  const [messageTemplateB, setMessageTemplateB] = useState('{Hello|Hey} {{Name}}, claim your free ₹100 chips right now! 💰 Link: https://game.myonlinejoker.com')
  const [isAbTest, setIsAbTest] = useState(false)
  const [isScheduled, setIsScheduled] = useState(false)
  const [scheduledTime, setScheduledTime] = useState<string>('')
  const [spintaxPreview, setSpintaxPreview] = useState('')
  const [jitterRange, setJitterRange] = useState<[number, number]>([3, 8])
  const [excludeRegistered, setExcludeRegistered] = useState(false)
  const [dispatching, setDispatching] = useState(false)
  const [activeCampaignId, setActiveCampaignId] = useState<string | null>(null)
  const [queueItems, setQueueItems] = useState<any[]>([])
  const [queueModalOpen, setQueueModalOpen] = useState(false)

  // New Dispatcher Upgrades States
  const [segmentType, setSegmentType] = useState('all')
  const [imageUrl, setImageUrl] = useState('')
  const [buttonText, setButtonText] = useState('')
  const [buttonUrl, setButtonUrl] = useState('')
  const [scheduleType, setScheduleType] = useState('once')
  const [cronExpression, setCronExpression] = useState('')
  const [aiLoading, setAiLoading] = useState(false)
  const [aiSuggestions, setAiSuggestions] = useState<string[]>([])
  const [aiModalOpen, setAiModalOpen] = useState(false)

  // Campaign targets selection states
  const [allLeadsForCampaign, setAllLeadsForCampaign] = useState<Lead[]>([])
  const [allLeadsLoading, setAllLeadsLoading] = useState(false)
  const [selectedCampaignTargets, setSelectedCampaignTargets] = useState<string[]>([])
  const [campaignSearchText, setCampaignSearchText] = useState('')

  const fetchAllLeadsForCampaign = async () => {
    setAllLeadsLoading(true)
    try {
      const res = await adminApi.get('/leads', {
        params: { page: 1, limit: 10000 },
      })
      setAllLeadsForCampaign(res.data.leads || [])
    } catch (e: any) {
      message.error('Failed to load all leads for campaign targeting')
    } finally {
      setAllLeadsLoading(false)
    }
  }

  // Analytics States
  const [analyticsData, setAnalyticsData] = useState<any>(null)
  const [analyticsFilter, setAnalyticsFilter] = useState<'all' | 'whatsapp' | 'telegram'>('all')
  const [campaigns, setCampaigns] = useState<any[]>([])

  const [form] = Form.useForm()
  const [editForm] = Form.useForm()

  const fetchLeads = async (p = page) => {
    setLoading(true)
    try {
      const res = await adminApi.get('/leads', {
        params: { page: p, limit: 20, search, status: statusFilter, leadGroup: leadGroupFilter },
      })
      setLeads(res.data.leads || [])
      setTotal(res.data.total || 0)
    } catch (e: any) {
      message.error(e?.response?.data?.error || 'Failed to load leads')
    } finally {
      setLoading(false)
    }
  }

  const fetchSessions = async () => {
    try {
      const res = await adminApi.get('/leads/sessions')
      setSessions(res.data || [])
    } catch (e) {
      console.error('Failed to load sessions', e)
    }
  }

  const fetchAnalytics = async () => {
    try {
      const res = await adminApi.get('/leads/analytics')
      setAnalyticsData(res.data || null)
    } catch (e) {
      console.error('Failed to load analytics', e)
    }
  }

  const fetchGroups = async () => {
    try {
      const res = await adminApi.get('/leads/groups')
      const dbGroups = res.data.groups || []
      const merged = Array.from(new Set(['all_users', 'allready_player', 'invite', 'uninstalled_users', 'new_users', ...dbGroups]))
      setAvailableGroups(merged)
    } catch (e) {
      console.error('Failed to load lead groups', e)
    }
  }

  const fetchCampaigns = async () => {
    try {
      const res = await adminApi.get('/leads/campaigns')
      setCampaigns(res.data || [])
    } catch (e) {
      console.error('Failed to load campaigns list', e)
    }
  }

  useEffect(() => {
    fetchLeads()
  }, [page, search, statusFilter, leadGroupFilter])

  useEffect(() => {
    fetchSessions()
    fetchAnalytics()
    fetchGroups()
    fetchCampaigns()
    if (activeTab === 'dispatcher') {
      fetchAllLeadsForCampaign()
    }
  }, [activeTab])

  useEffect(() => {
    let interval: any
    const hasPending = queueItems.some(i => i.status === 'pending')
    if (activeCampaignId && hasPending) {
      interval = setInterval(() => {
        fetchQueue(activeCampaignId)
      }, 5000)
    }
    return () => clearInterval(interval)
  }, [activeCampaignId, queueItems])

  // Spintax Previewer Logic
  useEffect(() => {
    const resolveSpintax = (text: string): string => {
      let resolved = text.replace(/\{([^{}]+)\}/g, (_, choices) => {
        const parts = choices.split('|')
        return parts[Math.floor(Math.random() * parts.length)]
      })
      resolved = resolved.replace(/\{\{Name\}\}/g, 'Rahul')
      return resolved
    }
    setSpintaxPreview(resolveSpintax(messageTemplate))
  }, [messageTemplate])

  const [pairForm] = Form.useForm()

  const handleStartPairing = async (protocol: 'whatsapp' | 'telegram') => {
    setPairingProtocol(protocol)
    pairForm.resetFields()
    setPairingModalOpen(true)
  }

  const startQrPolling = (sessionId: string) => {
    if (qrPollRef.current) clearInterval(qrPollRef.current)
    qrPollRef.current = setInterval(async () => {
      try {
        const res = await adminApi.get(`/leads/sessions/${sessionId}/qr`)
        if (res.data.qr) {
          setQrCodeText(res.data.qr)
        }
        const sessionsRes = await adminApi.get('/leads/sessions')
        setSessions(sessionsRes.data || [])
        const currentSession = sessionsRes.data.find((s: any) => s.id === sessionId)
        if (currentSession && currentSession.status === 'connected') {
          message.success('WhatsApp paired successfully!')
          if (qrPollRef.current) clearInterval(qrPollRef.current)
          setQrModalOpen(false)
          setQrCodeText(undefined)
        }
      } catch (e) {
        console.error('QR code polling error:', e)
      }
    }, 3000)
  }

  const handleVerifyTelegramCode = async () => {
    if (!pairingSession) return
    try {
      await adminApi.post('/leads/sessions/telegram-verify', {
        sessionId: pairingSession.id,
        phoneCode: telegramCode,
        password: telegramPassword || undefined
      })
      message.success('Telegram paired successfully!')
      setTgVerifyModalOpen(false)
      setTelegramCode('')
      setTelegramPassword('')
      fetchSessions()
    } catch (e: any) {
      message.error(e?.response?.data?.error || 'Failed to verify Telegram code')
    }
  }

  const handleLinkSession = async (values: any) => {
    try {
      const res = await adminApi.post('/leads/sessions/pair', {
        protocol: pairingProtocol,
        phoneNumber: values.phoneNumber,
        handle: values.handle
      })
      const newSession = res.data.session
      setPairingSession(newSession)
      setPairingModalOpen(false)

      if (pairingProtocol === 'whatsapp') {
        setQrModalOpen(true)
        startQrPolling(newSession.id)
      } else {
        setTgVerifyModalOpen(true)
      }
      fetchSessions()
    } catch (e) {
      message.error('Failed to link sender connection')
    }
  }

  const handleDisconnect = async (id: string) => {
    try {
      await adminApi.post('/leads/sessions/disconnect', { id })
      message.success('Session disconnected')
      fetchSessions()
    } catch (e) {
      message.error('Failed to disconnect session')
    }
  }

  const fetchQueue = async (campaignId: string) => {
    try {
      const res = await adminApi.get(`/leads/campaigns/${campaignId}/queue`)
      setQueueItems(res.data || [])
    } catch (e) {
      console.error('Failed to load campaign queue', e)
    }
  }

  const handleDispatchQueueItem = async (item: any) => {
    if (item.channel === 'whatsapp') {
      const cleanPhone = item.target_phone.replace(/\D/g, '')
      const encodedMsg = encodeURIComponent(item.resolved_message)
      window.open(`https://wa.me/${cleanPhone}?text=${encodedMsg}`, '_blank')
    }

    try {
      await adminApi.post(`/leads/queue-items/${item.id}/status`, { status: 'sent' })
      message.success(`Marked ${item.target_name} as sent`)
      if (activeCampaignId) {
        fetchQueue(activeCampaignId)
      } else {
        fetchQueue(item.campaign_id)
      }
      fetchLeads()
    } catch (e) {
      message.error('Failed to update status')
    }
  }

  const handleSkipQueueItem = async (item: any) => {
    try {
      await adminApi.post(`/leads/queue-items/${item.id}/status`, { status: 'skipped' })
      message.success(`Skipped ${item.target_name}`)
      if (activeCampaignId) {
        fetchQueue(activeCampaignId)
      } else {
        fetchQueue(item.campaign_id)
      }
    } catch (e) {
      message.error('Failed to update status')
    }
  }

  const getBaseEligibleLeads = () => {
    const sourceLeads = allLeadsForCampaign.length > 0 ? allLeadsForCampaign : leads
    let filtered = sourceLeads

    // Filter by channel
    if (dispatchChannel === 'whatsapp') {
      filtered = filtered.filter(l => l.whatsapp_exists === true)
    } else if (dispatchChannel === 'telegram') {
      filtered = filtered.filter(l => l.telegram_exists === true)
    } else if (dispatchChannel === 'all') {
      filtered = filtered.filter(l => l.whatsapp_exists === true || l.telegram_exists === true)
    }

    // Exclude registered if checked
    if (excludeRegistered) {
      filtered = filtered.filter(l => !l.is_registered)
    }

    return filtered
  }

  const getVisibleEligibleLeads = () => {
    let filtered = getBaseEligibleLeads()

    if (campaignSearchText.trim()) {
      const q = campaignSearchText.toLowerCase()
      filtered = filtered.filter(l => 
        l.contact_name?.toLowerCase().includes(q) || 
        l.contact_phone?.toLowerCase().includes(q)
      )
    }

    return filtered
  }

  // Auto-select all eligible leads when list changes (due to channel or excludeRegistered settings)
  useEffect(() => {
    const baseEligible = getBaseEligibleLeads()
    setSelectedCampaignTargets(baseEligible.map(l => l.contact_phone))
  }, [allLeadsForCampaign, dispatchChannel, excludeRegistered])

  const handleDispatchCampaign = async () => {
    if (!selectedCampaignTargets.length) {
      message.warning('No targets selected to broadcast to.')
      return
    }
    setDispatching(true)
    try {
      const res = await adminApi.post('/leads/broadcast', {
        channel: dispatchChannel,
        messageText: messageTemplate,
        messageTextB: isAbTest ? messageTemplateB : undefined,
        isAbTest,
        scheduledFor: isScheduled ? scheduledTime : undefined,
        delayMin: jitterRange[0],
        delayMax: jitterRange[1],
        targets: selectedCampaignTargets,
        excludeRegistered,
        buttonText: buttonText || undefined,
        buttonUrl: buttonUrl || undefined,
        imageUrl: imageUrl || undefined,
        cronExpression: scheduleType === 'once' ? undefined : (scheduleType === 'custom' ? cronExpression : scheduleType),
        segmentType
      })

      const campaignId = res.data.campaignId
      setActiveCampaignId(campaignId)
      
      message.success(`Campaign initialized! Distributed: ${res.data.totalRecipients} recipients.`)
      
      // Load queue and show the Queue Dispatcher modal
      await fetchQueue(campaignId)
      setQueueModalOpen(true)
      fetchLeads()
    } catch (e) {
      message.error('Campaign broadcast failed')
    } finally {
      setDispatching(false)
    }
  }

  const handleOptimizeCopy = async () => {
    if (!messageTemplate.trim()) {
      message.warning('Please enter a message template first.')
      return
    }
    setAiLoading(true)
    try {
      const res = await adminApi.post('/leads/ai-spintax', { prompt: messageTemplate })
      setAiSuggestions(res.data.variations || [])
      setAiModalOpen(true)
    } catch (e: any) {
      message.error(e?.response?.data?.error || 'AI optimization failed. Ensure GEMINI_API_KEY is configured.')
    } finally {
      setAiLoading(false)
    }
  }

  const handleCreateLead = async (values: any) => {
    try {
      await adminApi.post('/leads', values)
      message.success('Lead added successfully')
      setAddModalOpen(false)
      form.resetFields()
      fetchLeads()
    } catch (e: any) {
      message.error(e?.response?.data?.error || 'Failed to add lead')
    }
  }

  const handleUpdateLead = async (values: any) => {
    if (!editLead) return
    try {
      await adminApi.patch(`/leads/${editLead.id}`, values)
      message.success('Lead updated successfully')
      setEditLead(null)
      fetchLeads()
    } catch (e: any) {
      message.error(e?.response?.data?.error || 'Failed to update lead')
    }
  }

  const handleDeleteLead = async (id: number) => {
    try {
      await adminApi.delete(`/leads/${id}`)
      message.success('Lead deleted')
      fetchLeads()
    } catch (e: any) {
      message.error(e?.response?.data?.error || 'Failed to delete lead')
    }
  }

  const handleBulkDelete = async () => {
    if (!selectedRowKeys.length) return
    try {
      await adminApi.post('/leads/bulk-delete', { ids: selectedRowKeys.map(k => Number(k)) })
      message.success(`${selectedRowKeys.length} leads deleted`)
      setSelectedRowKeys([])
      fetchLeads()
    } catch (e: any) {
      message.error(e?.response?.data?.error || 'Failed to delete selected leads')
    }
  }

  const handleBulkStatusChange = async () => {
    if (!selectedRowKeys.length) return
    try {
      await adminApi.post('/leads/bulk-status', {
        ids: selectedRowKeys.map(k => Number(k)),
        status: bulkStatusVal,
      })
      message.success(`${selectedRowKeys.length} leads updated to ${bulkStatusVal}`)
      setSelectedRowKeys([])
      setBulkStatusOpen(false)
      fetchLeads()
    } catch (e: any) {
      message.error(e?.response?.data?.error || 'Failed to update selected leads')
    }
  }

  const handleBulkGroupChange = async () => {
    if (!selectedRowKeys.length) return
    try {
      await adminApi.post('/leads/bulk-group', {
        ids: selectedRowKeys.map(k => Number(k)),
        leadGroup: bulkGroupVal,
      })
      message.success(`${selectedRowKeys.length} leads updated to group ${bulkGroupVal}`)
      setSelectedRowKeys([])
      setBulkGroupOpen(false)
      fetchLeads()
    } catch (e: any) {
      message.error(e?.response?.data?.error || 'Failed to update selected leads')
    }
  }

  const handleCreateGroupManual = () => {
    const customName = prompt('Enter new group name:')
    if (customName && customName.trim()) {
      const name = customName.trim()
      setAvailableGroups(prev => Array.from(new Set([...prev, name])))
      message.success(`Group "${name}" created. You can now assign leads to it.`)
    }
  }

  const [pushingToGateway, setPushingToGateway] = useState(false)

  const handlePushToGateway = async () => {
    if (!selectedRowKeys.length) return
    setPushingToGateway(true)
    const hide = message.loading(`Pushing ${selectedRowKeys.length} contacts to WhatsApp gateway...`, 0)
    try {
      const res = await adminApi.post('/leads/push-to-gateway', {
        ids: selectedRowKeys.map(k => Number(k)),
      })
      message.success(res.data.message || 'Contacts pushed successfully!')
      setSelectedRowKeys([])
    } catch (e: any) {
      message.error(e?.response?.data?.error || 'Failed to push contacts to WhatsApp gateway')
    } finally {
      hide()
      setPushingToGateway(false)
    }
  }

  const handleExportCSV = () => {
    if (!leads.length) {
      message.warning('No leads available to export')
      return
    }
    const headers = ['ID', 'Contact Name', 'Phone', 'Email', 'Status', 'Created At']
    const rows = leads.map(l => [
      l.id,
      `"${l.contact_name || ''}"`,
      `"${l.contact_phone || ''}"`,
      `"${l.contact_email || ''}"`,
      l.status,
      new Date(l.created_at).toLocaleString(),
    ])

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map(e => e.join(','))].join('\n')
    const encodedUri = encodeURI(csvContent)
    const link = document.createElement('a')
    link.setAttribute('href', encodedUri)
    link.setAttribute('download', `leads_${new Date().toISOString().slice(0, 10)}.csv`)
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    message.success('Leads exported to CSV!')
  }

  const handleImportCSV = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = async (event) => {
      const text = event.target?.result as string
      if (!text) return

      try {
        const lines = text.split(/\r?\n/)
        if (lines.length <= 1) {
          message.error('CSV file is empty')
          return
        }

        const headers = lines[0].split(',').map(h => h.trim().replace(/^["']|["']$/g, '').toLowerCase())
        const nameIdx = headers.indexOf('name') !== -1 ? headers.indexOf('name') : headers.indexOf('contact name') !== -1 ? headers.indexOf('contact name') : headers.indexOf('contact_name')
        const phoneIdx = headers.indexOf('phone') !== -1 ? headers.indexOf('phone') : headers.indexOf('phone number') !== -1 ? headers.indexOf('phone number') : headers.indexOf('contact_phone')
        const emailIdx = headers.indexOf('email') !== -1 ? headers.indexOf('email') : headers.indexOf('contact_email')
        const notesIdx = headers.indexOf('notes') !== -1 ? headers.indexOf('notes') : headers.indexOf('note')

        if (nameIdx === -1 || phoneIdx === -1) {
          message.error('CSV must contain "Name" and "Phone" headers')
          return
        }

        const importedLeads: any[] = []
        for (let i = 1; i < lines.length; i++) {
          const line = lines[i].trim()
          if (!line) continue
          
          const matches = line.match(/(".*?"|[^",\s]+)(?=\s*,|\s*$)/g) || line.split(',')
          const parts = matches.map(p => p.trim().replace(/^["']|["']$/g, ''))
          
          if (!parts[phoneIdx] || !parts[nameIdx]) continue

          importedLeads.push({
            contact_name: parts[nameIdx],
            contact_phone: parts[phoneIdx],
            contact_email: emailIdx !== -1 ? parts[emailIdx] || null : null,
            notes: notesIdx !== -1 ? parts[notesIdx] || null : null,
            status: 'new'
          })
        }

        if (importedLeads.length === 0) {
          message.error('No valid leads found in CSV')
          return
        }

        const hide = message.loading(`Importing ${importedLeads.length} leads...`, 0)
        await adminApi.post('/leads/import', { leads: importedLeads })
        hide()
        message.success(`Successfully imported ${importedLeads.length} leads!`)
        fetchLeads()
      } catch (err: any) {
        message.error(err?.response?.data?.error || 'Failed to import CSV')
      } finally {
        e.target.value = ''
      }
    }
    reader.readAsText(file)
  }

  const columns = [
    {
      title: 'Contact Name',
      dataIndex: 'contact_name',
      render: (name: string) => <span style={{ fontWeight: 600 }}>{name}</span>,
    },
    {
      title: 'Phone Number',
      dataIndex: 'contact_phone',
      render: (phone: string, record: Lead) => (
        <Space>
          <Tag color="blue">{phone}</Tag>
          {record.is_registered && <Tag color="green">REGISTERED</Tag>}
          
          {record.whatsapp_exists === true && <Tag color="green"><WhatsAppOutlined /> WA</Tag>}
          {record.whatsapp_exists === false && <Tag color="red"><WhatsAppOutlined /> NO WA</Tag>}

          {record.telegram_exists === true && <Tag color="cyan"><SendOutlined /> TG</Tag>}
          {record.telegram_exists === false && <Tag color="red"><SendOutlined /> NO TG</Tag>}

          {(record.whatsapp_exists === null || record.telegram_exists === null) && (
            <Tooltip title="Verify WhatsApp & Telegram Status">
              <Button
                type="text"
                size="small"
                icon={<SyncOutlined />}
                onClick={async () => {
                  try {
                    const hide = message.loading(`Checking registration for ${phone}...`, 0);
                    if (record.whatsapp_exists === null) {
                      await adminApi.post('/leads/verify-contact-single', { channel: 'whatsapp', phone });
                    }
                    if (record.telegram_exists === null) {
                      await adminApi.post('/leads/verify-contact-single', { channel: 'telegram', phone });
                    }
                    hide();
                    message.success(`Verified: ${phone}`);
                    fetchLeads();
                  } catch (e: any) {
                    message.error(e?.response?.data?.error || 'Verification failed');
                  }
                }}
              />
            </Tooltip>
          )}

          <Tooltip title="Copy Phone">
            <Button
              type="text"
              size="small"
              icon={<CopyOutlined />}
              onClick={() => {
                navigator.clipboard.writeText(phone)
                message.success('Phone copied')
              }}
            />
          </Tooltip>
        </Space>
      ),
    },
    {
      title: 'Email',
      dataIndex: 'contact_email',
      render: (email: string) => email || '-',
    },
    {
      title: 'Status',
      dataIndex: 'status',
      render: (status: string, record: Lead) => (
        <Select
          size="small"
          value={status}
          style={{ width: 120 }}
          onChange={async (newStatus) => {
            try {
              await adminApi.patch(`/leads/${record.id}`, { status: newStatus })
              message.success('Status updated')
              fetchLeads()
            } catch (e: any) {
              message.error('Failed to update status')
            }
          }}
        >
          <Select.Option value="new"><Tag color="blue">NEW</Tag></Select.Option>
          <Select.Option value="contacted"><Tag color="orange">CONTACTED</Tag></Select.Option>
          <Select.Option value="interested"><Tag color="purple">INTERESTED</Tag></Select.Option>
          <Select.Option value="converted"><Tag color="green">CONVERTED</Tag></Select.Option>
          <Select.Option value="rejected"><Tag color="red">REJECTED</Tag></Select.Option>
        </Select>
      ),
    },
    {
      title: 'Group/Segment',
      dataIndex: 'lead_group',
      render: (lead_group: string, record: Lead) => (
        <Select
          size="small"
          value={lead_group || 'all_users'}
          style={{ width: 140 }}
          onChange={async (newGroup) => {
            let targetGroup = newGroup
            if (newGroup === '__custom__') {
              const customName = prompt('Enter custom group name:')
              if (!customName || !customName.trim()) return
              targetGroup = customName.trim()
            }
            try {
              await adminApi.patch(`/leads/${record.id}`, { lead_group: targetGroup })
              message.success('Group updated')
              fetchLeads()
              fetchGroups()
            } catch (e: any) {
              message.error('Failed to update group')
            }
          }}
        >
          {availableGroups.map(g => (
            <Select.Option key={g} value={g}>
              {g.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}
            </Select.Option>
          ))}
          <Select.Option value="__custom__" style={{ color: tokens.color.gold, fontWeight: 'bold' }}>
            + Create New Group...
          </Select.Option>
        </Select>
      ),
    },
    {
      title: 'Created At',
      dataIndex: 'created_at',
      render: (d: string) => new Date(d).toLocaleDateString(),
    },
    {
      title: 'Actions',
      key: 'actions',
      render: (r: Lead) => (
        <Space>
          <Button
            size="small"
            icon={<EditOutlined />}
            onClick={() => {
              setEditLead(r)
              editForm.setFieldsValue({
                status: r.status,
                notes: r.notes,
                lead_group: r.lead_group || 'all_users',
              })
            }}
          />
          <Popconfirm title="Delete this lead?" onConfirm={() => handleDeleteLead(r.id)}>
            <Button size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ]

  return (
    <div style={{ padding: '24px', background: '#f8fafc', minHeight: '100vh' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 28, fontWeight: 800, color: tokens.color.textPrimary }}>
            Lead & Campaign Hub
          </h2>
          <Typography.Text type="secondary">
            Broadcasting via WhatsApp (Baileys) and Telegram (MTProto) with automated pacing & tracking.
          </Typography.Text>
        </div>
      </div>

      <Tabs activeKey={activeTab} onChange={setActiveTab} type="card" style={{ marginBottom: 24 }}>
        
        {/* TAB 1: Leads List */}
        <Tabs.TabPane tab={<span><UserOutlined />Leads List</span>} key="leads">
          <Row gutter={[16, 16]} style={{ marginBottom: 20 }}>
            <Col xs={24} md={6}>
              <Card size="small" style={{ borderRadius: 12 }}>
                <Typography.Text type="secondary" style={{ fontSize: 11, fontWeight: 600 }}>TOTAL LEADS</Typography.Text>
                <div style={{ fontSize: 24, fontWeight: 800, marginTop: 4 }}>{total}</div>
              </Card>
            </Col>
            <Col xs={24} md={6}>
              <Card size="small" style={{ borderRadius: 12 }}>
                <Typography.Text type="secondary" style={{ fontSize: 11, fontWeight: 600 }}>NEW CONTACTS</Typography.Text>
                <div style={{ fontSize: 24, fontWeight: 800, marginTop: 4, color: tokens.color.info }}>
                  {leads.filter(l => l.status === 'new').length}
                </div>
              </Card>
            </Col>
            <Col xs={24} md={6}>
              <Card size="small" style={{ borderRadius: 12 }}>
                <Typography.Text type="secondary" style={{ fontSize: 11, fontWeight: 600 }}>INTERESTED</Typography.Text>
                <div style={{ fontSize: 24, fontWeight: 800, marginTop: 4, color: '#9012fe' }}>
                  {leads.filter(l => l.status === 'interested').length}
                </div>
              </Card>
            </Col>
            <Col xs={24} md={6}>
              <Card size="small" style={{ borderRadius: 12 }}>
                <Typography.Text type="secondary" style={{ fontSize: 11, fontWeight: 600 }}>CONVERTED</Typography.Text>
                <div style={{ fontSize: 24, fontWeight: 800, marginTop: 4, color: tokens.color.emerald }}>
                  {leads.filter(l => l.status === 'converted').length}
                </div>
              </Card>
            </Col>
          </Row>

          <Card style={{ borderRadius: 12, marginBottom: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
              <Space wrap>
                <Input.Search
                  placeholder="Search lead..."
                  onSearch={setSearch}
                  style={{ width: 250 }}
                  enterButton
                  allowClear
                />
                 <Select
                  placeholder="Filter Status"
                  allowClear
                  style={{ width: 150 }}
                  onChange={setStatusFilter}
                >
                  <Select.Option value="new">New</Select.Option>
                  <Select.Option value="contacted">Contacted</Select.Option>
                  <Select.Option value="interested">Interested</Select.Option>
                  <Select.Option value="converted">Converted</Select.Option>
                  <Select.Option value="rejected">Rejected</Select.Option>
                  <Select.Option value="auto_find_wa">Auto find WA</Select.Option>
                  <Select.Option value="wa">WA</Select.Option>
                  <Select.Option value="no_wa">No WA</Select.Option>
                  <Select.Option value="tg">TG</Select.Option>
                  <Select.Option value="no_tg">NO TG</Select.Option>
                </Select>
                <Select
                  placeholder="Filter Group"
                  allowClear
                  style={{ width: 160 }}
                  onChange={setLeadGroupFilter}
                >
                  {availableGroups.map(g => (
                    <Select.Option key={g} value={g}>
                      {g.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}
                    </Select.Option>
                  ))}
                </Select>
              </Space>
              <Space wrap>
                <Button icon={<ReloadOutlined />} onClick={() => fetchLeads()}>Refresh</Button>
                <Button icon={<ExportOutlined />} onClick={handleExportCSV}>Export CSV</Button>
                <input
                  type="file"
                  accept=".csv"
                  id="csv-file-input"
                  style={{ display: 'none' }}
                  onChange={handleImportCSV}
                />
                <Button 
                  icon={<PlusOutlined />} 
                  onClick={() => document.getElementById('csv-file-input')?.click()}
                >
                  Import CSV
                </Button>
                <Button icon={<PlusOutlined />} onClick={handleCreateGroupManual}>Create Group</Button>
                <Button type="primary" icon={<PlusOutlined />} onClick={() => setAddModalOpen(true)}>Add Lead</Button>
                {selectedRowKeys.length > 0 && (
                  <>
                    <Button 
                      type="primary" 
                      icon={<SyncOutlined spin={pushingToGateway} />} 
                      onClick={handlePushToGateway}
                      loading={pushingToGateway}
                      style={{ background: '#25D366', borderColor: '#25D366' }}
                    >
                      Push to Zender ({selectedRowKeys.length})
                    </Button>
                    <Button onClick={() => setBulkStatusOpen(true)}>Bulk Status</Button>
                    <Button onClick={() => setBulkGroupOpen(true)}>Bulk Group</Button>
                    <Popconfirm title="Delete selected?" onConfirm={handleBulkDelete}>
                      <Button danger icon={<DeleteOutlined />}>Delete Selected ({selectedRowKeys.length})</Button>
                    </Popconfirm>
                  </>
                )}
              </Space>
            </div>
          </Card>

          <Table
            dataSource={leads}
            columns={columns}
            rowKey="id"
            loading={loading}
            pagination={{
              total,
              pageSize: 20,
              current: page,
              onChange: setPage,
            }}
            rowSelection={{
              selectedRowKeys,
              onChange: setSelectedRowKeys
            }}
            scroll={{ x: 'max-content' }}
          />
        </Tabs.TabPane>

        {/* TAB 2: QR Code Authentication Hub */}
        <Tabs.TabPane tab={<span><KeyOutlined />Authentication Hub</span>} key="auth">
          <Row gutter={[24, 24]}>
            <Col xs={24} md={8}>
              <Card title="Initiate Connection" style={{ borderRadius: 12 }}>
                <Typography.Paragraph>
                  Pair new outbound nodes to broadcast messages. Scanning the QR code links the session securely.
                </Typography.Paragraph>
                <Space direction="vertical" style={{ width: '100%' }}>
                  <Button
                    type="primary"
                    block
                    icon={<WhatsAppOutlined />}
                    onClick={() => handleStartPairing('whatsapp')}
                    style={{ background: '#25D366', borderColor: '#25D366', height: 40 }}
                  >
                    Pair WhatsApp Node
                  </Button>
                  <Button
                    type="primary"
                    block
                    icon={<SendOutlined />}
                    onClick={() => handleStartPairing('telegram')}
                    style={{ background: '#0088cc', borderColor: '#0088cc', height: 40 }}
                  >
                    Pair Telegram (MTProto)
                  </Button>
                </Space>
              </Card>
            </Col>
            <Col xs={24} md={16}>
              <h3 style={{ marginBottom: 16 }}>Persistent Sessions</h3>
              <Row gutter={[16, 16]}>
                {sessions.map(sess => (
                  <Col xs={24} sm={12} key={sess.id}>
                    <Card
                      style={{
                        borderRadius: 12,
                        border: sess.status === 'connected' ? '1px solid #d9f7be' : '1px solid #d9d9d9',
                        boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.05)'
                      }}
                      actions={[
                        <Button type="link" danger icon={<DisconnectOutlined />} onClick={() => handleDisconnect(sess.id)}>
                          Disconnect
                        </Button>,
                        sess.status === 'pairing' ? (
                          <Button type="link" icon={<SyncOutlined />} onClick={() => handleStartPairing(sess.protocol)}>
                            Re-scan
                          </Button>
                        ) : null
                      ].filter(Boolean) as any}
                    >
                      <Card.Meta
                        avatar={
                          <Badge status={sess.status === 'connected' ? 'success' : 'processing'}>
                            <AvatarWrapper protocol={sess.protocol} />
                          </Badge>
                        }
                        title={<span style={{ textTransform: 'capitalize' }}>{sess.protocol} Session</span>}
                        description={
                          <div style={{ marginTop: 8 }}>
                            <div style={{ fontSize: 13, color: '#334155' }}>
                              <strong>Status: </strong>
                              <Tag color={sess.status === 'connected' ? 'green' : 'orange'}>{sess.status.toUpperCase()}</Tag>
                            </div>
                            {sess.phoneNumber && (
                              <div style={{ fontSize: 12, marginTop: 4 }}>
                                <strong>Phone:</strong> {sess.phoneNumber}
                              </div>
                            )}
                            {sess.handle && (
                              <div style={{ fontSize: 12, marginTop: 2 }}>
                                <strong>Handle:</strong> {sess.handle}
                              </div>
                            )}
                            {sess.dc && (
                              <div style={{ fontSize: 12, marginTop: 2 }}>
                                <strong>Data Center:</strong> {sess.dc}
                              </div>
                            )}
                            {sess.battery !== undefined && (
                              <div style={{ fontSize: 12, marginTop: 2 }}>
                                <strong>Sync Battery:</strong> {sess.battery}%
                              </div>
                            )}
                            {sess.subscribers !== undefined && (
                              <div style={{ fontSize: 12, marginTop: 2 }}>
                                <strong>Subscribers:</strong> {sess.subscribers}
                              </div>
                            )}
                          </div>
                        }
                      />
                    </Card>
                  </Col>
                ))}
                {sessions.length === 0 && (
                  <Col span={24}>
                    <Alert message="No active pairing sessions found. Use the panel on the left to add one." type="info" showIcon />
                  </Col>
                )}
              </Row>
            </Col>
          </Row>
        </Tabs.TabPane>

        {/* TAB 3: Mass Dispatcher */}
        <Tabs.TabPane tab={<span><SendOutlined />Mass Dispatcher</span>} key="dispatcher">
          <Card title="Broadcast Hub" style={{ borderRadius: 12 }}>
            <Form layout="vertical">
              <Row gutter={24}>
                <Col xs={24} md={12}>
                  <Form.Item label="Outbound Channel" required>
                    <Select value={dispatchChannel} onChange={setDispatchChannel} style={{ height: 40 }}>
                      <Select.Option value="whatsapp">WhatsApp Only</Select.Option>
                      <Select.Option value="telegram">Telegram Only</Select.Option>
                      <Select.Option value="all">Distributed (WhatsApp & Telegram)</Select.Option>
                    </Select>
                  </Form.Item>

                  <Form.Item label="Target Segment / User Cohort">
                    <Select value={segmentType} onChange={setSegmentType} style={{ height: 40 }}>
                      <Select.Option value="all">All Leads</Select.Option>
                      <Select.Option value="active_7d">Active (7d) Players</Select.Option>
                      <Select.Option value="inactive_7d">Inactive (7d) Players</Select.Option>
                      <Select.Option value="low_balance">Low Balance (&lt; ₹100) Players</Select.Option>
                    </Select>
                  </Form.Item>

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <Typography.Text strong>Message Template (Spintax Supported)</Typography.Text>
                    <Button 
                      type="link" 
                      size="small" 
                      loading={aiLoading} 
                      onClick={handleOptimizeCopy}
                      style={{ color: tokens.color.gold, fontWeight: 'bold' }}
                    >
                      ✨ Optimize with AI
                    </Button>
                  </div>
                  <Form.Item>
                    <Input.TextArea
                      rows={4}
                      value={messageTemplate}
                      onChange={e => setMessageTemplate(e.target.value)}
                      placeholder="Use syntax: {Hi|Hello|Hey} {friend|player} to bypass anti-spam filters. Use {{Link}} for dynamic tracking links."
                    />
                  </Form.Item>

                  <div style={{ marginBottom: 16 }}>
                    <Checkbox
                      checked={isAbTest}
                      onChange={e => setIsAbTest(e.target.checked)}
                    >
                      <strong>Enable A/B Split Testing</strong>
                    </Checkbox>
                  </div>

                  {isAbTest && (
                    <Form.Item label="Message Template B (Alternative Variant)">
                      <Input.TextArea
                        rows={4}
                        value={messageTemplateB}
                        onChange={e => setMessageTemplateB(e.target.value)}
                        placeholder="Alternative template for A/B testing splits."
                      />
                    </Form.Item>
                  )}

                  <Form.Item label="Spintax Randomized Live Preview">
                    <Card size="small" style={{ background: '#f1f5f9', border: '1px dashed #cbd5e1' }}>
                      <Typography.Text italic>{spintaxPreview || 'Preview will display here...'}</Typography.Text>
                    </Card>
                  </Form.Item>

                  <Form.Item label="Attachment Image URL (Optional)">
                    <Input value={imageUrl} onChange={e => setImageUrl(e.target.value)} placeholder="e.g. https://domain.com/banner.jpg" style={{ height: 40 }} />
                  </Form.Item>
                  <Form.Item label="CTA Button Text (Optional)">
                    <Input value={buttonText} onChange={e => setButtonText(e.target.value)} placeholder="e.g. Claim Free ₹100" style={{ height: 40 }} />
                  </Form.Item>
                  <Form.Item label="CTA Button Redirect URL (Optional - Generates Tracking Links)">
                    <Input value={buttonUrl} onChange={e => setButtonUrl(e.target.value)} placeholder="e.g. https://game.myonlinejoker.com/lobby" style={{ height: 40 }} />
                  </Form.Item>
                </Col>

                <Col xs={24} md={12}>
                  <Form.Item label="Anti-Ban Jitter Pace Delay (Seconds)">
                    <div style={{ padding: '0 10px' }}>
                      <Slider
                        range
                        min={1}
                        max={30}
                        value={jitterRange}
                        onChange={(val) => setJitterRange(val as [number, number])}
                        marks={{
                          1: 'Fast',
                          10: 'Safe',
                          20: 'Strict',
                          30: 'Max Delay'
                        }}
                      />
                    </div>
                    <Typography.Paragraph type="secondary" style={{ marginTop: 12, fontSize: 12 }}>
                      Messages will be sent with a random interval between <strong>{jitterRange[0]}s</strong> and <strong>{jitterRange[1]}s</strong> to emulate human behavior and avoid automated IP blocks.
                    </Typography.Paragraph>
                  </Form.Item>

                  <Form.Item label="Recipients / Target Group" required>
                    <div style={{ marginBottom: 12 }}>
                      <Alert
                        message={`Broadcast targets: ${selectedCampaignTargets.length} selected of ${getBaseEligibleLeads().length} eligible contacts.`}
                        type={selectedCampaignTargets.length > 0 ? "info" : "warning"}
                        showIcon
                      />
                    </div>
                    
                    <div style={{ marginBottom: 12 }}>
                      <Checkbox
                        checked={excludeRegistered}
                        onChange={e => setExcludeRegistered(e.target.checked)}
                      >
                        Exclude already registered players
                      </Checkbox>
                    </div>

                    <div style={{ marginBottom: 12 }}>
                      <Input.Search
                        placeholder="Search targets by name or phone..."
                        value={campaignSearchText}
                        onChange={e => setCampaignSearchText(e.target.value)}
                        allowClear
                        style={{ width: '100%' }}
                      />
                    </div>

                    <Table
                      dataSource={getVisibleEligibleLeads()}
                      loading={allLeadsLoading}
                      rowKey="contact_phone"
                      size="small"
                      pagination={{ pageSize: 5, size: 'small', showSizeChanger: false }}
                      rowSelection={{
                        selectedRowKeys: selectedCampaignTargets,
                        onChange: (keys) => setSelectedCampaignTargets(keys as string[]),
                      }}
                      columns={[
                        {
                          title: 'Name',
                          dataIndex: 'contact_name',
                          key: 'contact_name',
                          render: (name: string) => <span style={{ fontWeight: 500 }}>{name}</span>
                        },
                        {
                          title: 'Phone',
                          dataIndex: 'contact_phone',
                          key: 'contact_phone',
                        },
                        {
                          title: 'Status',
                          key: 'status',
                          render: (_, record: Lead) => (
                            <Space size={4}>
                              {record.whatsapp_exists === true && <WhatsAppOutlined style={{ color: '#25D366' }} />}
                              {record.telegram_exists === true && <SendOutlined style={{ color: '#0088cc' }} />}
                            </Space>
                          )
                        }
                      ]}
                      style={{ border: '1px solid #cbd5e1', borderRadius: 8, overflow: 'hidden' }}
                    />

                    <div style={{ marginTop: 12 }}>
                      <Typography.Text strong style={{ display: 'block', marginBottom: 4 }}>Campaign Schedule & Recurrence:</Typography.Text>
                      <Select value={scheduleType} onChange={setScheduleType} style={{ width: '100%', height: 40, marginBottom: 12 }}>
                        <Select.Option value="once">Send Once (One-Time)</Select.Option>
                        <Select.Option value="*/5 * * * *">Every 5 Minutes (Development Test)</Select.Option>
                        <Select.Option value="0 0 * * *">Daily at Midnight (Recurring)</Select.Option>
                        <Select.Option value="0 0 * * 1">Weekly on Mondays (Recurring)</Select.Option>
                        <Select.Option value="custom">Custom Cron Expression...</Select.Option>
                      </Select>
                    </div>

                    {scheduleType === 'custom' && (
                      <div style={{ marginBottom: 12 }}>
                        <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 4 }}>Cron Expression (5 fields: min hour dom month dow):</Typography.Text>
                        <Input
                          placeholder="e.g. */10 * * * * (every 10 minutes)"
                          value={cronExpression}
                          onChange={e => setCronExpression(e.target.value)}
                          style={{ height: 40 }}
                        />
                      </div>
                    )}

                    {scheduleType === 'once' && (
                      <>
                        <div style={{ marginTop: 12 }}>
                          <Checkbox
                            checked={isScheduled}
                            onChange={e => setIsScheduled(e.target.checked)}
                          >
                            <strong>Schedule broadcast for a future date/time</strong>
                          </Checkbox>
                        </div>

                        {isScheduled && (
                          <div style={{ marginTop: 12 }}>
                            <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 4 }}>Pick Broadcast Date & Time:</Typography.Text>
                            <Input
                              type="datetime-local"
                              value={scheduledTime}
                              onChange={e => setScheduledTime(e.target.value)}
                              style={{ height: 40 }}
                            />
                          </div>
                        )}
                      </>
                    )}
                  </Form.Item>

                  <Button
                    type="primary"
                    size="large"
                    icon={<SoundOutlined />}
                    onClick={handleDispatchCampaign}
                    loading={dispatching}
                    block
                    style={{ background: tokens.color.gold, borderColor: tokens.color.gold, height: 50, marginTop: 24, fontSize: 16 }}
                  >
                    Start Broadcast Campaign
                  </Button>
                </Col>
              </Row>
            </Form>
          </Card>

          {activeCampaignId && (
            <Card 
              title={
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
                  <span>Active Campaign Queue (ID: {activeCampaignId})</span>
                  <Button size="small" icon={<ReloadOutlined />} onClick={() => fetchQueue(activeCampaignId)}>Refresh Queue</Button>
                </div>
              } 
              style={{ borderRadius: 12, marginTop: 24 }}
            >
              <div style={{ marginBottom: 16 }}>
                <div style={{ display: 'flex', gap: 16, background: '#f1f5f9', padding: 12, borderRadius: 8, fontWeight: 600 }}>
                  <div>Pending: <span style={{ color: tokens.color.gold }}>{queueItems.filter(i => i.status === 'pending').length}</span></div>
                  <div>Sent: <span style={{ color: tokens.color.emerald }}>{queueItems.filter(i => i.status === 'sent').length}</span></div>
                  <div>Skipped: <span style={{ color: '#64748b' }}>{queueItems.filter(i => i.status === 'skipped').length}</span></div>
                </div>
              </div>

              <Table
                dataSource={queueItems}
                rowKey="id"
                pagination={{ pageSize: 10 }}
                size="small"
                columns={[
                  {
                    title: 'Recipient',
                    key: 'recipient',
                    render: (r: any) => (
                      <div>
                        <strong>{r.target_name}</strong>
                        <div style={{ fontSize: 11, color: '#64748b' }}>{r.target_phone}</div>
                      </div>
                    )
                  },
                  {
                    title: 'Channel',
                    dataIndex: 'channel',
                    render: (ch: string) => (
                      <Tag color={ch === 'whatsapp' ? 'green' : 'blue'} style={{ fontWeight: 600 }}>
                        {ch === 'whatsapp' ? 'WHATSAPP' : 'TELEGRAM'}
                      </Tag>
                    )
                  },
                  {
                    title: 'Message Preview',
                    dataIndex: 'resolved_message',
                    ellipsis: true,
                    render: (msg: string) => <span style={{ fontSize: 12, color: '#475569' }}>{msg}</span>
                  },
                  {
                    title: 'Status',
                    dataIndex: 'status',
                    render: (st: string) => {
                      let color = 'default'
                      if (st === 'sent') color = 'success'
                      if (st === 'skipped') color = 'warning'
                      return <Tag color={color} style={{ fontWeight: 600 }}>{st.toUpperCase()}</Tag>
                    }
                  },
                  {
                    title: 'Action',
                    key: 'action',
                    render: (r: any) => {
                      if (r.status !== 'pending') return '-'
                      return (
                        <Space>
                          {r.channel === 'whatsapp' ? (
                            <Button
                              type="primary"
                              size="small"
                              icon={<WhatsAppOutlined />}
                              onClick={() => handleDispatchQueueItem(r)}
                              style={{ background: '#25D366', borderColor: '#25D366' }}
                            >
                              Send Link
                            </Button>
                          ) : (
                            <Button
                              type="primary"
                              size="small"
                              icon={<SendOutlined />}
                              onClick={() => handleDispatchQueueItem(r)}
                            >
                              Send
                            </Button>
                          )}
                          <Button size="small" onClick={() => handleSkipQueueItem(r)}>
                            Skip
                          </Button>
                        </Space>
                      )
                    }
                  }
                ]}
              />
            </Card>
          )}
        </Tabs.TabPane>

        {/* TAB 4: Campaign Analytics */}
        <Tabs.TabPane tab={<span><BarChartOutlined />Campaign Analytics</span>} key="analytics">
          {analyticsData ? (
            <div>
              <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
                <Col xs={24} md={6}>
                  <Card size="small">
                    <Statistic title="Outbound Delivered DMs" value={analyticsData.channels.whatsapp.delivered + analyticsData.channels.telegram.delivered} />
                  </Card>
                </Col>
                <Col xs={24} md={6}>
                  <Card size="small">
                    <Statistic title="Total Converted Users" value={analyticsData.channels.whatsapp.converted + analyticsData.channels.telegram.converted} />
                  </Card>
                </Col>
                <Col xs={24} md={6}>
                  <Card size="small">
                    <Statistic title="Conversion Rate" value={`${((analyticsData.channels.whatsapp.converted + analyticsData.channels.telegram.converted) / (analyticsData.channels.whatsapp.delivered + analyticsData.channels.telegram.delivered) * 100).toFixed(1)}%`} />
                  </Card>
                </Col>
                <Col xs={24} md={6}>
                  <Card size="small" style={{ background: '#f0fdf4' }}>
                    <Statistic title="Attributed Revenue" value={analyticsData.channels.whatsapp.revenue + analyticsData.channels.telegram.revenue} prefix="₹" valueStyle={{ color: '#16a34a', fontWeight: 'bold' }} />
                  </Card>
                </Col>
              </Row>

              <Row gutter={[24, 24]}>
                <Col xs={24} lg={16}>
                  <Card
                    title="Daily Campaign Broadcast Performance"
                    extra={
                      <Select value={analyticsFilter} onChange={setAnalyticsFilter} style={{ width: 140 }}>
                        <Select.Option value="all">All Channels</Select.Option>
                        <Select.Option value="whatsapp">WhatsApp Only</Select.Option>
                        <Select.Option value="telegram">Telegram Only</Select.Option>
                      </Select>
                    }
                    style={{ borderRadius: 12 }}
                  >
                    <div style={{ width: '100%', height: 350 }}>
                      <ResponsiveContainer>
                        <AreaChart data={analyticsData.dailyAnalytics} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                          <defs>
                            <linearGradient id="colorWA" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor="#25D366" stopOpacity={0.8}/>
                              <stop offset="95%" stopColor="#25D366" stopOpacity={0}/>
                            </linearGradient>
                            <linearGradient id="colorTG" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor="#0088cc" stopOpacity={0.8}/>
                              <stop offset="95%" stopColor="#0088cc" stopOpacity={0}/>
                            </linearGradient>
                          </defs>
                          <CartesianGrid strokeDasharray="3 3" />
                          <XAxis dataKey="date" />
                          <YAxis />
                          <ChartTooltip />
                          <Legend />
                          {(analyticsFilter === 'all' || analyticsFilter === 'whatsapp') && (
                            <Area type="monotone" dataKey="whatsappDMs" name="WhatsApp DMs" stroke="#25D366" fillOpacity={1} fill="url(#colorWA)" />
                          )}
                          {(analyticsFilter === 'all' || analyticsFilter === 'telegram') && (
                            <Area type="monotone" dataKey="telegramDMs" name="Telegram DMs" stroke="#0088cc" fillOpacity={1} fill="url(#colorTG)" />
                          )}
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                  </Card>
                </Col>

                <Col xs={24} lg={8}>
                  <Card title="Conversion & Signups Split" style={{ borderRadius: 12 }}>
                    <div style={{ width: '100%', height: 350 }}>
                      <ResponsiveContainer>
                        <BarChart
                          data={[
                            { name: 'WhatsApp', Conversions: analyticsData.channels.whatsapp.converted, Delivered: analyticsData.channels.whatsapp.delivered / 10 },
                            { name: 'Telegram', Conversions: analyticsData.channels.telegram.converted, Delivered: analyticsData.channels.telegram.delivered / 10 }
                          ]}
                        >
                          <CartesianGrid strokeDasharray="3 3" />
                          <XAxis dataKey="name" />
                          <YAxis />
                          <ChartTooltip />
                          <Legend />
                          <Bar dataKey="Conversions" fill="#8884d8" name="Conversions" />
                          <Bar dataKey="Delivered" fill="#82ca9d" name="Delivered DMs (scaled)" />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </Card>
                </Col>
              </Row>
            </div>
          ) : (
            <Alert message="Loading analytics statistics..." type="info" showIcon />
          )}
        </Tabs.TabPane>

        {/* TAB 5: Campaign History */}
        <Tabs.TabPane tab={<span><HistoryOutlined />Campaign History</span>} key="history">
          <Card title="Outbound Campaign History & Link Analytics" extra={<Button icon={<ReloadOutlined />} onClick={fetchCampaigns}>Refresh</Button>} style={{ borderRadius: 12 }}>
            <Table
              dataSource={campaigns}
              rowKey="id"
              pagination={{ pageSize: 10 }}
              columns={[
                {
                  title: 'Campaign Details',
                  key: 'details',
                  render: (c: any) => (
                    <div>
                      <strong style={{ fontSize: 14 }}>{c.title}</strong>
                      <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>
                        Created: {new Date(c.created_at).toLocaleString()}
                      </div>
                      <div style={{ fontSize: 12, color: '#475569', marginTop: 4, fontStyle: 'italic' }}>
                        {c.body}
                      </div>
                    </div>
                  )
                },
                {
                  title: 'Schedule / Recurrence',
                  key: 'schedule',
                  render: (c: any) => {
                    if (c.cron_expression) {
                      return (
                        <Tag color="purple" style={{ fontWeight: 600 }}>
                          RECURRING: {c.cron_expression}
                        </Tag>
                      )
                    }
                    return <Tag>ONE-TIME</Tag>
                  }
                },
                {
                  title: 'Media / Action',
                  key: 'media',
                  render: (c: any) => (
                    <div>
                      {c.image_url && <Tag color="blue">IMAGE ATTACHED</Tag>}
                      {c.button_text && (
                        <div style={{ fontSize: 11, marginTop: 4 }}>
                          <strong>Btn:</strong> {c.button_text}
                        </div>
                      )}
                    </div>
                  )
                },
                {
                  title: 'Total Recipients',
                  dataIndex: 'total_recipients',
                  align: 'center',
                  render: (val: number) => <strong>{val}</strong>
                },
                {
                  title: 'Link Click Stats',
                  key: 'clicks',
                  render: (c: any) => {
                    const ctr = c.total_links > 0 ? ((c.unique_clicks / c.total_links) * 100).toFixed(1) : '0.0';
                    return (
                      <div>
                        <div>Unique Clicks: <strong>{c.unique_clicks}</strong> / {c.total_links}</div>
                        <div>Total Clicks: <strong>{c.total_clicks}</strong></div>
                        <div style={{ fontSize: 12, color: tokens.color.gold, fontWeight: 'bold', marginTop: 2 }}>
                          CTR: {ctr}%
                        </div>
                      </div>
                    )
                  }
                },
                {
                  title: 'Actions',
                  key: 'actions',
                  render: (c: any) => (
                    <Button 
                      size="small" 
                      onClick={async () => {
                        await fetchQueue(c.id);
                        setActiveCampaignId(c.id);
                        setQueueModalOpen(true);
                      }}
                    >
                      View Queue
                    </Button>
                  )
                }
              ]}
            />
          </Card>
        </Tabs.TabPane>
      </Tabs>

      {/* Link Outbound Sender Modal */}
      <Modal
        title={
          <span style={{ fontSize: 18, fontWeight: 700 }}>
            Link Outbound {pairingProtocol === 'whatsapp' ? 'WhatsApp Sender' : 'Telegram Sender'}
          </span>
        }
        open={pairingModalOpen}
        onCancel={() => setPairingModalOpen(false)}
        onOk={() => pairForm.submit()}
        width={500}
        destroyOnClose
      >
        <Form form={pairForm} layout="vertical" onFinish={handleLinkSession}>
          <Form.Item
            name="phoneNumber"
            label="Sender Phone Number"
            rules={[{ required: true, message: 'Please enter the sender phone number' }]}
          >
            <Input placeholder="e.g. +91 99887 76655" />
          </Form.Item>
          <Form.Item
            name="handle"
            label={pairingProtocol === 'whatsapp' ? 'Sender Name/Label' : 'Telegram @Username'}
            rules={[{ required: true, message: 'Please enter the sender handle' }]}
          >
            <Input placeholder={pairingProtocol === 'whatsapp' ? 'e.g. Outbound Agent Sync' : 'e.g. @teenpatticampaign'} />
          </Form.Item>
        </Form>
      </Modal>

      {/* WhatsApp QR Modal */}
      <Modal
        title="Scan WhatsApp QR Code"
        open={qrModalOpen}
        onCancel={() => {
          setQrModalOpen(false)
          if (qrPollRef.current) clearInterval(qrPollRef.current)
        }}
        footer={null}
        width={350}
        destroyOnClose
      >
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '20px 0' }}>
          {qrCodeText ? (
            <>
              <img 
                src={`https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(qrCodeText)}`} 
                alt="WhatsApp QR Code"
                style={{ width: 250, height: 250, border: '1px solid #cbd5e1', padding: 8, borderRadius: 8 }}
              />
              <Typography.Text type="secondary" style={{ marginTop: 16, textAlign: 'center' }}>
                Open WhatsApp on your phone &rarr; Linked Devices &rarr; Link a Device.
              </Typography.Text>
            </>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: 250 }}>
              <SyncOutlined spin style={{ fontSize: 32, color: tokens.color.gold }} />
              <Typography.Text type="secondary" style={{ marginTop: 16 }}>
                Generating QR code... Please wait.
              </Typography.Text>
            </div>
          )}
        </div>
      </Modal>

      {/* Telegram Verification Code Modal */}
      <Modal
        title="Enter Telegram Verification Code"
        open={tgVerifyModalOpen}
        onCancel={() => setTgVerifyModalOpen(false)}
        onOk={handleVerifyTelegramCode}
        width={400}
        destroyOnClose
      >
        <Form layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item label="SMS or Telegram Verification Code" required>
            <Input 
              value={telegramCode} 
              onChange={e => setTelegramCode(e.target.value)} 
              placeholder="e.g. 12345" 
            />
          </Form.Item>
          <Form.Item label="2FA Cloud Password (Optional)">
            <Input.Password 
              value={telegramPassword} 
              onChange={e => setTelegramPassword(e.target.value)} 
              placeholder="If 2-step verification is enabled" 
            />
          </Form.Item>
        </Form>
      </Modal>

      {/* Queue Dispatcher Modal */}
      <Modal
        title={
          <span style={{ fontSize: 18, fontWeight: 800, color: tokens.color.textPrimary }}>
            Campaign Dispatcher Queue
          </span>
        }
        open={queueModalOpen}
        onCancel={() => setQueueModalOpen(false)}
        footer={[
          <Button key="close" onClick={() => setQueueModalOpen(false)}>
            Close Queue
          </Button>
        ]}
        width={800}
        destroyOnClose
      >
        <div style={{ marginBottom: 16 }}>
          <Typography.Paragraph type="secondary">
            Manage outbound dispatches. Auto-sent Telegram DMs are marked as sent instantly if the user is linked and bot credentials exist. WhatsApp Business messages can be sent manually without an API key using the direct link buttons.
          </Typography.Paragraph>
          <div style={{ display: 'flex', gap: 16, background: '#f1f5f9', padding: 12, borderRadius: 8, marginBottom: 16, fontWeight: 600 }}>
            <div>Pending: <span style={{ color: tokens.color.gold }}>{queueItems.filter(i => i.status === 'pending').length}</span></div>
            <div>Sent: <span style={{ color: tokens.color.emerald }}>{queueItems.filter(i => i.status === 'sent').length}</span></div>
            <div>Skipped: <span style={{ color: '#64748b' }}>{queueItems.filter(i => i.status === 'skipped').length}</span></div>
          </div>
        </div>

        <Table
          dataSource={queueItems}
          rowKey="id"
          pagination={{ pageSize: 5 }}
          size="small"
          columns={[
            {
              title: 'Recipient',
              key: 'recipient',
              render: (r: any) => (
                <div>
                  <strong>{r.target_name}</strong>
                  <div style={{ fontSize: 11, color: '#64748b' }}>{r.target_phone}</div>
                </div>
              )
            },
            {
              title: 'Channel',
              dataIndex: 'channel',
              render: (ch: string) => (
                <Tag color={ch === 'whatsapp' ? 'green' : 'blue'} style={{ fontWeight: 600 }}>
                  {ch === 'whatsapp' ? 'WHATSAPP' : 'TELEGRAM'}
                </Tag>
              )
            },
            {
              title: 'Message Preview',
              dataIndex: 'resolved_message',
              ellipsis: true,
              render: (msg: string) => <span style={{ fontSize: 12, color: '#475569' }}>{msg}</span>
            },
            {
              title: 'Status',
              dataIndex: 'status',
              render: (st: string) => {
                let color = 'default'
                if (st === 'sent') color = 'success'
                if (st === 'skipped') color = 'warning'
                return <Tag color={color} style={{ fontWeight: 600 }}>{st.toUpperCase()}</Tag>
              }
            },
            {
              title: 'Action',
              key: 'action',
              render: (r: any) => {
                if (r.status !== 'pending') return '-'
                return (
                  <Space>
                    {r.channel === 'whatsapp' ? (
                      <Button
                        type="primary"
                        size="small"
                        icon={<WhatsAppOutlined />}
                        onClick={() => handleDispatchQueueItem(r)}
                        style={{ background: '#25D366', borderColor: '#25D366' }}
                      >
                        Send Link
                      </Button>
                    ) : (
                      <Button
                        type="primary"
                        size="small"
                        icon={<SendOutlined />}
                        onClick={() => handleDispatchQueueItem(r)}
                      >
                        Send
                      </Button>
                    )}
                    <Button size="small" onClick={() => handleSkipQueueItem(r)}>
                      Skip
                    </Button>
                  </Space>
                )
              }
            }
          ]}
        />
      </Modal>

      {/* Add Lead Modal */}
      <Modal
        title="Add Manual Marketing Lead"
        open={addModalOpen}
        onCancel={() => setAddModalOpen(false)}
        onOk={() => form.submit()}
      >
        <Form form={form} layout="vertical" onFinish={handleCreateLead} initialValues={{ status: 'new', lead_group: 'all_users' }}>
          <Form.Item name="contact_name" label="Contact Name" rules={[{ required: true, message: 'Required' }]}>
            <Input placeholder="e.g. Aarav Sharma" />
          </Form.Item>
          <Form.Item name="contact_phone" label="Phone Number" rules={[{ required: true, message: 'Required' }]}>
            <Input placeholder="e.g. +91 98765 43210" />
          </Form.Item>
          <Form.Item name="contact_email" label="Email Address">
            <Input placeholder="e.g. aarav@example.com" />
          </Form.Item>
          <Form.Item name="status" label="Initial Lead Status">
            <Select>
              <Select.Option value="new">New</Select.Option>
              <Select.Option value="contacted">Contacted</Select.Option>
              <Select.Option value="interested">Interested</Select.Option>
              <Select.Option value="converted">Converted</Select.Option>
              <Select.Option value="rejected">Rejected</Select.Option>
            </Select>
          </Form.Item>
          <Form.Item name="lead_group" label="Lead Group / Segment">
            <Select
              onChange={(value) => {
                if (value === '__custom__') {
                  const customName = prompt('Enter custom group name:')
                  if (customName && customName.trim()) {
                    const name = customName.trim()
                    setAvailableGroups(prev => Array.from(new Set([...prev, name])))
                    form.setFieldsValue({ lead_group: name })
                  } else {
                    form.setFieldsValue({ lead_group: 'all_users' })
                  }
                }
              }}
            >
              {availableGroups.map(g => (
                <Select.Option key={g} value={g}>
                  {g.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}
                </Select.Option>
              ))}
              <Select.Option value="__custom__" style={{ color: tokens.color.gold, fontWeight: 'bold' }}>
                + Create New Group...
              </Select.Option>
            </Select>
          </Form.Item>
          <Form.Item name="notes" label="Notes / Campaign Source">
            <Input.TextArea rows={2} placeholder="e.g. Collected via WhatsApp promo event" />
          </Form.Item>
        </Form>
      </Modal>

      {/* Edit Lead Modal */}
      <Modal
        title={`Edit Lead — ${editLead?.contact_name}`}
        open={!!editLead}
        onCancel={() => setEditLead(null)}
        onOk={() => editForm.submit()}
      >
        <Form form={editForm} layout="vertical" onFinish={handleUpdateLead}>
          <Form.Item name="status" label="Lead Status" rules={[{ required: true }]}>
            <Select>
              <Select.Option value="new">New</Select.Option>
              <Select.Option value="contacted">Contacted</Select.Option>
              <Select.Option value="interested">Interested</Select.Option>
              <Select.Option value="converted">Converted</Select.Option>
              <Select.Option value="rejected">Rejected</Select.Option>
            </Select>
          </Form.Item>
          <Form.Item name="lead_group" label="Lead Group / Segment">
            <Select
              onChange={(value) => {
                if (value === '__custom__') {
                  const customName = prompt('Enter custom group name:')
                  if (customName && customName.trim()) {
                    const name = customName.trim()
                    setAvailableGroups(prev => Array.from(new Set([...prev, name])))
                    editForm.setFieldsValue({ lead_group: name })
                  } else {
                    editForm.setFieldsValue({ lead_group: 'all_users' })
                  }
                }
              }}
            >
              {availableGroups.map(g => (
                <Select.Option key={g} value={g}>
                  {g.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}
                </Select.Option>
              ))}
              <Select.Option value="__custom__" style={{ color: tokens.color.gold, fontWeight: 'bold' }}>
                + Create New Group...
              </Select.Option>
            </Select>
          </Form.Item>
          <Form.Item name="notes" label="Notes">
            <Input.TextArea rows={3} placeholder="Add follow-up notes or response status..." />
          </Form.Item>
        </Form>
      </Modal>

      {/* Bulk Status Modal */}
      <Modal
        title={`Bulk Change Status (${selectedRowKeys.length} Leads)`}
        open={bulkStatusOpen}
        onCancel={() => setBulkStatusOpen(false)}
        onOk={handleBulkStatusChange}
      >
        <p>Select new status for all {selectedRowKeys.length} selected leads:</p>
        <Select
          style={{ width: '100%' }}
          value={bulkStatusVal}
          onChange={(v) => setBulkStatusVal(v as any)}
        >
          <Select.Option value="new">New</Select.Option>
          <Select.Option value="contacted">Contacted</Select.Option>
          <Select.Option value="interested">Interested</Select.Option>
          <Select.Option value="converted">Converted</Select.Option>
          <Select.Option value="rejected">Rejected</Select.Option>
        </Select>
      </Modal>

      {/* Bulk Group Modal */}
      <Modal
        title={`Bulk Change Group (${selectedRowKeys.length} Leads)`}
        open={bulkGroupOpen}
        onCancel={() => setBulkGroupOpen(false)}
        onOk={handleBulkGroupChange}
      >
        <p>Select new group for all {selectedRowKeys.length} selected leads:</p>
        <Select
          style={{ width: '100%' }}
          value={bulkGroupVal}
          onChange={(value) => {
            if (value === '__custom__') {
              const customName = prompt('Enter custom group name:')
              if (customName && customName.trim()) {
                const name = customName.trim()
                setAvailableGroups(prev => Array.from(new Set([...prev, name])))
                setBulkGroupVal(name)
              }
            } else {
              setBulkGroupVal(value)
            }
          }}
        >
          {availableGroups.map(g => (
            <Select.Option key={g} value={g}>
              {g.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}
            </Select.Option>
          ))}
          <Select.Option value="__custom__" style={{ color: tokens.color.gold, fontWeight: 'bold' }}>
            + Create New Group...
          </Select.Option>
        </Select>
      </Modal>

      {/* AI Suggestions Modal */}
      <Modal
        title="✨ Gemini AI Copy Suggestions (Spintax Format)"
        open={aiModalOpen}
        footer={null}
        onCancel={() => setAiModalOpen(false)}
        width={700}
      >
        <p>Pick one of the generated spintax copy variations to apply it to your campaign template:</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {aiSuggestions.map((suggestion, idx) => (
            <Card 
              key={idx} 
              hoverable 
              size="small" 
              onClick={() => {
                setMessageTemplate(suggestion)
                setAiModalOpen(false)
                message.success('AI copy suggestion applied!')
              }}
              style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8 }}
            >
              <Typography.Paragraph strong style={{ color: tokens.color.gold, marginBottom: 4 }}>Suggestion {idx + 1}:</Typography.Paragraph>
              <Typography.Text>{suggestion}</Typography.Text>
            </Card>
          ))}
        </div>
      </Modal>
    </div>
  )
}

function AvatarWrapper({ protocol }: { protocol: 'whatsapp' | 'telegram' }) {
  return (
    <div
      style={{
        width: 40,
        height: 40,
        borderRadius: '50%',
        background: protocol === 'whatsapp' ? '#e8fcdb' : '#e0f2fe',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: protocol === 'whatsapp' ? '#25D366' : '#0088cc',
        fontSize: 20
      }}
    >
      {protocol === 'whatsapp' ? <WhatsAppOutlined /> : <SendOutlined />}
    </div>
  )
}
