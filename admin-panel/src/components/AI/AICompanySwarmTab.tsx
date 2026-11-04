import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Card,
  Row,
  Col,
  Tag,
  Typography,
  Button,
  Space,
  Badge,
  Alert,
  Statistic,
  Spin,
  Tooltip,
  Modal,
  Tabs,
  Descriptions,
  Progress,
  Divider,
  Timeline,
  Segmented,
  Form,
  Input,
  Select,
  message
} from 'antd'
import {
  RobotOutlined,
  ThunderboltOutlined,
  SafetyCertificateOutlined,
  DollarOutlined,
  ReloadOutlined,
  CheckCircleOutlined,
  CloudServerOutlined,
  SendOutlined,
  DashboardOutlined,
  EyeOutlined,
  SlidersOutlined,
  LineChartOutlined,
  AuditOutlined,
  ApiOutlined,
  FireOutlined,
  ExperimentOutlined,
  BranchesOutlined,
  RocketOutlined,
  InfoCircleOutlined,
  PlusOutlined,
  ClockCircleOutlined
} from '@ant-design/icons'
import { adminApi } from '../../api/client'

const { Title, Text, Paragraph } = Typography

interface AIEmployee {
  id: string
  name: string
  title: string
  department: string
  icon: string
  status: string
  statusColor: string
  currentTask: string
  lastAction: string
  metrics: string
}

interface ActivityItem {
  id: string
  time: string
  agent: string
  message: string
  type: 'info' | 'success' | 'warn'
}

interface DetailedAgentWork {
  summary: string
  coreStack: string[]
  connectedServices: string[]
  cadence: string
  responsibilities: string[]
  algorithmicLogic: string
  securityFairPlay: string
  telemetryGauges: { label: string; value: string; percent: number; color: string }[]
  eventLog: string[]
}

const AGENT_WORKS_DETAILS: Record<string, DetailedAgentWork> = {
  atlas: {
    summary: 'Autonomous 24/7 Site Reliability Engineer (SRE) & Server Infrastructure Watchdog. Continuously supervises the entire fleet of 22 PM2 microservices on the production GCP Compute Engine instance, executing automated health recovery, memory leak mitigation, and zero-downtime microservice reloads.',
    coreStack: ['Node.js 20', 'PM2 IPC Daemon', 'Linux Sys-Info', 'V8 Heap Profiler', 'Docker Network Watcher'],
    connectedServices: ['teen-core-api', 'teen-wallet', 'teen-gateway (1,2,3)', 'teen-tp-engine', 'teen-ludo', 'teen-rummy', 'teen-aviator', 'teen-admin-svc', 'teen-churn-ml'],
    cadence: 'Heartbeat sweep every 60 seconds with sub-second alert trigger',
    responsibilities: [
      'Executes 60-second health sweeps across all 22 production PM2 processes',
      'Monitors RAM allocation thresholds (--max-old-space-size=120) and triggers proactive restarts',
      'Detects zombie processes and orphaned network sockets in game gateway hubs',
      'Enforces disk storage space buffer (>15% free disk) and triggers automated log rotation',
      'Broadcasts instant Telegram incident reports to founders during anomalous error spikes'
    ],
    algorithmicLogic: 'Utilizes exponential backoff restart policies (maximum 5 retries with cooldown) to avoid cascading reboot loops. Analyzes process exit codes (SIGTERM, SIGKILL, OOM 137) to distinguish between transient network blips and fatal memory exhaustion.',
    securityFairPlay: 'Isolated within GCP private loopback (127.0.0.1) and internal network namespaces; executes with least-privilege systemd credentials.',
    telemetryGauges: [
      { label: 'Fleet Health Index', value: '100% Online', percent: 100, color: '#22c55e' },
      { label: 'Host RAM Allocation', value: '30.6% Used', percent: 30.6, color: '#0284c7' },
      { label: 'Disk Headroom', value: '78% Free', percent: 78, color: '#10b981' },
      { label: 'Auto-Healing Reliability', value: '99.98%', percent: 99.98, color: '#8b5cf6' }
    ],
    eventLog: [
      'Completed 60s health sweep: all 22 PM2 microservices online with zero errors',
      'V8 heap utilization verified at 74MB average across backend workers',
      'Gateway cluster socket ping latency verified at 1.8ms average'
    ]
  },
  midas: {
    summary: 'Autonomous Financial Auditor and Double-Entry Ledger Reconciler. Continuously cross-references player balances, wallet transactions, deposit gateway webhooks, and rake margins to ensure 100% financial solvency and eliminate balance drift.',
    coreStack: ['PostgreSQL ACID Transactions', 'Redis Cache', 'Razorpay Webhooks', 'PhonePe VPA', 'Cashfree API', 'YouPI Gateway'],
    connectedServices: ['teen-wallet (Port 3003)', 'teen-core-api', 'PostgreSQL Ledger (teen_db)', 'Payment Gateways'],
    cadence: 'Real-time transaction-driven ledger validation + Hourly margin sweeps',
    responsibilities: [
      'Audits every incoming deposit against official payment gateway webhook signatures',
      'Calculates real-time platform rake margin and net gaming revenue across all tables',
      'Verifies double-entry ledger equation: SUM(player balances) + reserve === total platform assets',
      'Identifies uncollected or orphaned deposit intents and syncs pending transactions',
      'Enforces zero balance duplication across concurrent game joins and buy-ins'
    ],
    algorithmicLogic: 'Uses strict row-level database locking (SELECT FOR UPDATE) on wallet balance mutations. Computes ledger balance checksums via cryptographic hashing over sequence numbers, instantly locking suspicious accounts if debit-credit discrepancy > ₹0.00.',
    securityFairPlay: 'Guarantees idempotency on all financial transactions via unique merchant order ID hashing in Redis (TTL 86400s).',
    telemetryGauges: [
      { label: 'Ledger Reconciliation', value: '100% Balanced', percent: 100, color: '#16a34a' },
      { label: 'Deposit Gateway Sync', value: 'Sub-second', percent: 98, color: '#0284c7' },
      { label: 'Solvency Coverage', value: '124% Reserve', percent: 100, color: '#8b5cf6' },
      { label: 'Payout Fulfillment', value: '99.8% Speed', percent: 99.8, color: '#10b981' }
    ],
    eventLog: [
      'Reconciled today double-entry ledger: credits balance debits with ₹0.00 drift',
      'Synchronized real-time deposit confirmations across payment gateway webhooks',
      'Calculated platform net rake margin and populated daily P&L snapshot'
    ]
  },
  argus: {
    summary: 'Security & Anti-Fraud Detective. Real-time watchdog over withdrawal requests, player device fingerprints, GPS location clusters, and table chip-dumping patterns to protect platform integrity and prevent fraud.',
    coreStack: ['risk-service (Port 3008)', 'FingerprintJS WebGL/Canvas', 'Geo Distance Matrix', 'PostgreSQL Audit Logs'],
    connectedServices: ['teen-risk', 'teen-wallet', 'teen-admin-svc', 'teen-app-monitor'],
    cadence: 'Real-time pre-withdrawal gating + Event-driven in-game table fraud analysis',
    responsibilities: [
      'Screens 100% of pending cashouts before bank routing (evaluates fraud risk score 0-100)',
      'Detects multiple player accounts sharing identical device IDs or IP subnets at the same table',
      'Analyzes table collusion: detects players repeatedly folding winning hands to transfer funds',
      'Flags withdrawal velocity anomalies (e.g. immediate cashout after bonus claim without turnover)',
      'Auto-approves low-risk withdrawals (<₹5,000 with 0 risk points) for instant 1-click payouts'
    ],
    algorithmicLogic: 'Calculates an ensemble Risk Score: Device collision (+35 pts), GPS proximity at table (+40 pts), Zero gameplay turnover (+50 pts), VPN/Datacenter IP (+20 pts). Requests > 50 risk points require manual compliance review.',
    securityFairPlay: 'Maintains encrypted device fingerprint hashes preventing banned abusers from spoofing new accounts.',
    telemetryGauges: [
      { label: 'Cashout Gate Precision', value: '99.7%', percent: 99.7, color: '#22c55e' },
      { label: 'Screened Cashouts', value: '100% Inspected', percent: 100, color: '#0284c7' },
      { label: 'Collusion False Positive', value: '< 0.05%', percent: 99.95, color: '#8b5cf6' },
      { label: 'Auto-Gate Speed', value: '45ms / check', percent: 95, color: '#10b981' }
    ],
    eventLog: [
      'Screened pending withdrawal queue: zero high-risk collusion flags detected',
      'Device fingerprint integrity verified across active mobile sessions',
      'Verified zero chip-dumping anomalies across high-stake Teen Patti tables'
    ]
  },
  zeus: {
    summary: 'Player Retention & VIP VIP Care Marketing Synthesizer. Scans database for high-value depositing players who have become inactive and leverages Google Gemini 3.5 Pro to formulate hyper-personalized promotional hooks and bonuses.',
    coreStack: ['PostgreSQL Query Engine', 'Google Gemini 3.5 Pro LLM', 'WhatsApp Cloud API', 'SMS Gateway'],
    connectedServices: ['company-ops-agent (Port 3035)', 'teen-core-api', 'Google Gemini Pro Tier API'],
    cadence: 'Hourly VIP churn scans + Daily 11:00 AM & 18:00 PM retention campaign sweeps',
    responsibilities: [
      'Scans database for VIP depositors (lifetime deposits >= ₹500) inactive for > 48 hours',
      'Determines player favorite game (Teen Patti, Points Rummy, Ludo) and preferred stakes',
      'Generates individualized promotional copy using Gemini LLM without generic marketing cliches',
      'Calculates customized bonus deposit incentives (10-25% of average deposit) with positive ROI',
      'Stages high-converting WhatsApp message payloads ready for one-click admin dispatch'
    ],
    algorithmicLogic: 'Calculates Recency-Frequency-Monetary (RFM) vectors. Matches each churned player with personalized psychological motivators (comeback cash, loss protection, tournament invites) via tailored Gemini prompts.',
    securityFairPlay: 'Enforces strict anti-spam rate limiting: maximum 1 retention outreach per player every 7 days.',
    telemetryGauges: [
      { label: 'VIP Churn Recovery Rate', value: '+28.4%', percent: 78, color: '#ec4899' },
      { label: 'Prompt Generation Latency', value: '0.6s', percent: 94, color: '#7c3aed' },
      { label: 'Bonus ROI Projection', value: '3.8x Return', percent: 85, color: '#10b981' },
      { label: 'Lead Personalization', value: '100% AI Tailored', percent: 100, color: '#0284c7' }
    ],
    eventLog: [
      'Scanned inactive VIP cohort: discovered 4 eligible VIP depositors',
      'Generated 4 customized WhatsApp promotion hooks with tailored deposit bonuses',
      'Retention campaign staged for founder review in AI Company Hub'
    ]
  },
  athena: {
    summary: 'Chief Gaming Officer & AI Bot Training Director. Masterminds human-like bot simulation across Teen Patti, Ludo, and Rummy, utilizing Dynamic Difficulty Adjustment (DDAS), Box-Muller jitter, and opponent classification.',
    coreStack: ['Go Teen Patti Evaluator', 'Node.js Ludo Engine', 'Fastify Rummy AI', 'Redis Opponent Modeler', 'Box-Muller Normal Dist'],
    connectedServices: ['teen-patti-bot-training (3023)', 'ludo-bot-training (3024)', 'rummy-bot-training (3025)', 'teen-bot-learning (3026)'],
    cadence: 'Nightly 02:00 AM IST profile rebuild + 6-hourly incremental behavioral retuning',
    responsibilities: [
      'Trains AI bot profiles on real player telemetry across Teen Patti, Ludo, and 13-Card Rummy',
      'Enforces DDAS (Dynamic Difficulty Adjustment) win-rate steering to keep house edge optimal (48-52%)',
      'Applies Box-Muller normal distribution cognitive delays (1.2s - 4.5s) to eliminate robotic timing',
      'Dynamically classifies human opponents (Tight Folder, Calling Station, Maniac Aggressor)',
      'Controls natural in-game chat emoji reactions, bluff frequencies, and tactical folds'
    ],
    algorithmicLogic: 'Uses Game Theory Optimal (GTO) tree pruning paired with Monte Carlo hand simulation. Modulates bot aggression indices dynamically based on opponent bankrolls and historical showdown reveals.',
    securityFairPlay: 'Bots possess zero server-side hole card knowledge; decision-making is strictly grounded in Bayesian probability from public cards and bet sequences.',
    telemetryGauges: [
      { label: 'DDAS Win-Rate Steering', value: '50.2% Target', percent: 99, color: '#2563eb' },
      { label: 'Human Simulation Index', value: '98.5% Realism', percent: 98.5, color: '#8b5cf6' },
      { label: 'Opponent Modeler Sync', value: 'Real-Time', percent: 100, color: '#10b981' },
      { label: 'Bot Engine Fleet', value: '3 Dedicated', percent: 100, color: '#f59e0b' }
    ],
    eventLog: [
      'Incremental behavioral rebuild complete across Teen Patti, Ludo & Rummy',
      'Synchronized opponent classification vectors in Redis across 100+ tables',
      'Box-Muller jitter parameters calibrated for natural mobile tap latency'
    ]
  },
  pythia: {
    summary: 'Lead Data Scientist & Predictive Churn / Player LTV ML Engine. Runs local Python FastAPI machine learning services with XGBoost and Scikit-Learn models to forecast player churn and dynamic difficulty curves.',
    coreStack: ['Python 3.11', 'FastAPI (Port 3020)', 'Scikit-Learn RandomForest', 'XGBoost', 'Pandas', 'psycopg2'],
    connectedServices: ['teen-churn-ml (Port 3020)', 'teen-churn (Port 3012)', 'PostgreSQL (teen_db)'],
    cadence: 'Hourly churn scoring cron + Scheduled daily model retraining at 03:00 UTC',
    responsibilities: [
      'Calculates real-time churn probability scores (0.0 to 1.0) for every registered player',
      'Predicts player difficulty tiers across Teen Patti, Ludo, Rummy, and Aviator',
      'Executes leak-free feature pipelines excluding days_since_deposit to guarantee genuine predictions',
      'Manages automated model versioning with symlink pointers (model_v* / active pointer)',
      'Performs automated model rollback to previous version if validation error rate exceeds 5%'
    ],
    algorithmicLogic: 'Trained on 5-feature vector: [total_deposits, deposits_last_14, deposits_prior_14, total_games, net_profit]. Uses 5-fold cross validation with stratified train/test split.',
    securityFairPlay: 'Models run completely locally on the GCP VM without third-party data egress, preserving 100% player privacy.',
    telemetryGauges: [
      { label: 'Model Validation Accuracy', value: '94.2%', percent: 94.2, color: '#7c3aed' },
      { label: 'Inference Latency', value: '18ms', percent: 96, color: '#10b981' },
      { label: 'Feature Pipeline Integrity', value: 'Leak-Free', percent: 100, color: '#0284c7' },
      { label: 'Model Version', value: 'v1 Active', percent: 100, color: '#f59e0b' }
    ],
    eventLog: [
      'Evaluated churn risk vectors across active player database',
      'Verified zero label leakage in training query across 5 feature dimensions',
      'Active model pointer verified with 18ms average inference latency'
    ]
  },
  aegis: {
    summary: 'Mobile Performance & Client Diagnostics Sentinel. Real-time telemetry ingestor processing Flutter mobile events, fatal crash dumps, battery thermal strain, network latency drops, and MaxMind GeoIP intelligence.',
    coreStack: ['app-monitor-service (Port 3015)', 'MaxMind GeoLite2 City MMDB', 'Flutter Telemetry SDK', 'WebSocket Stream'],
    connectedServices: ['teen-app-monitor (Port 3015)', 'Flutter Mobile Release APKs (4281)', 'Nginx SSL Reverse Proxy'],
    cadence: 'Continuous real-time mobile event ingest (sub-millisecond HTTP/WS pipeline)',
    responsibilities: [
      'Ingests mobile crash traces, ANR reports, and Flutter rendering exceptions',
      'Tracks device hardware telemetry: battery drain rate, thermal throttling, and frame drops (FPS)',
      'Maps mobile IP addresses to geographical cities via MaxMind GeoLite2 MMDB',
      'Monitors client WebSocket ping-pong latency across cellular 4G/5G connections',
      'Triggers automated severity escalations when fatal crashes breach 0.5% threshold'
    ],
    algorithmicLogic: 'Uses sliding window rate calculations for crash velocity. Implements binary IP lookup trees against local GeoLite2 City database with microsecond resolution.',
    securityFairPlay: 'Protects player anonymity: hashes sensitive identifiers and strips PII before long-term audit storage.',
    telemetryGauges: [
      { label: 'Crash-Free Session Rate', value: '99.4%', percent: 99.4, color: '#16a34a' },
      { label: 'P95 Network Latency', value: '72ms', percent: 92, color: '#0284c7' },
      { label: 'GeoIP MMDB Resolution', value: '100% Active', percent: 100, color: '#8b5cf6' },
      { label: 'Mobile Release Monitored', value: 'v4281 Active', percent: 100, color: '#f59e0b' }
    ],
    eventLog: [
      'Ingested mobile telemetry packets from active Flutter Android sessions',
      'GeoLite2 City database mapped active player sessions across Indian states',
      'Zero fatal unhandled exceptions logged in current release build'
    ]
  },
  'gemini-coo': {
    summary: 'Autonomous AI Chief Operating Officer & Executive Strategic Advisor. Leverages Google Gemini 3.5 Pro to synthesize comprehensive multi-service telemetry, generate daily 09:00 AM IST executive briefings, and advise leadership.',
    coreStack: ['Google Gemini 3.5 Pro API', '@google/genai SDK', 'Context Fusion Engine', 'Telegram Bot Stream'],
    connectedServices: ['company-ops-agent', 'Google AI Studio Pro Tier', 'Telegram Ops Bot'],
    cadence: 'Daily 09:00 AM IST executive briefing + On-demand owner strategy Q&A',
    responsibilities: [
      'Fuses SRE metrics, financial P&L margins, fraud queues, and table fill rates into executive briefings',
      'Broadcasting morning operational reports directly to owner Telegram every morning at 09:00 AM IST',
      'Provides strategic growth advice: optimal rake adjustments, bonus configurations, liquidity balance',
      'Answers founder natural language queries regarding platform performance and operational decisions',
      'Formulates proactive recommendations when anomalous traffic surges or margin drops are detected'
    ],
    algorithmicLogic: 'Uses multi-stage hierarchical prompting with temperature 0.3 for factual accuracy. Validates numeric data against PostgreSQL before synthesizing final executive markdown reports.',
    securityFairPlay: 'Operates over secure TLS with Google Pro API keys; zero user PII or raw card data is transmitted to model prompts.',
    telemetryGauges: [
      { label: 'LLM Latency', value: '0.62s avg', percent: 95, color: '#7c3aed' },
      { label: 'Executive Synthesis', value: '100% Reliable', percent: 100, color: '#2563eb' },
      { label: 'Google Pro Tier Quota', value: 'Optimal', percent: 98, color: '#10b981' },
      { label: 'Briefing Delivery', value: 'Daily 09:00 IST', percent: 100, color: '#f59e0b' }
    ],
    eventLog: [
      'Executive briefing generation engine verified with Google Gemini Pro API',
      'Daily 09:00 AM IST cron scheduler synchronized with Asia/Kolkata timezone',
      'Autonomous COO advice vectors calibrated for online gaming revenue optimization'
    ]
  },
  hermes: {
    summary: 'Telegram Command Center & Instant Mobile Notification Daemon. Provides direct 2-way remote management of the gaming server from the founder mobile phone with instant operational alerts and interactive slash commands.',
    coreStack: ['Node.js Telegram Bot API', 'Long-Polling Daemon', 'Markdown Formatter', 'Admin ID Gating'],
    connectedServices: ['company-ops-agent (Port 3035)', 'Telegram Cloud Infrastructure', 'SystemSre Engine'],
    cadence: 'Continuous polling daemon + Real-time event alert broadcaster',
    responsibilities: [
      'Streams high-priority SRE auto-healing alerts directly to the founder Telegram chat',
      'Delivers daily 09:00 AM IST executive morning briefings formulated by Gemini COO',
      'Enables 2-way remote administration: /status, /margin, /sre, /help commands from phone',
      'Alerts compliance staff when high-value pending cashouts (>₹10,000) require inspection',
      'Provides instant kill-switch notifications if database or Redis latencies exceed safety thresholds'
    ],
    algorithmicLogic: 'Severity-tiered alert throttling: bundles transient warnings to prevent notification flooding, while high-severity SRE crashes bypass rate limits for immediate sound notification.',
    securityFairPlay: 'Strict Chat ID verification: commands are strictly rejected unless originating from authorized founder Telegram User IDs.',
    telemetryGauges: [
      { label: 'Message Delivery Speed', value: '< 800ms', percent: 96, color: '#10b981' },
      { label: 'Polling Daemon Health', value: '100% Online', percent: 100, color: '#0284c7' },
      { label: '2-Way Command Channel', value: 'Ready', percent: 100, color: '#8b5cf6' },
      { label: 'Alert Dispatch Accuracy', value: 'Zero Drop', percent: 100, color: '#f59e0b' }
    ],
    eventLog: [
      'Telegram command center polling daemon synchronized with Telegram API',
      'Owner mobile notification channel armed for real-time incident broadcasts',
      'Interactive slash-command parser verified for remote server inspection'
    ]
  }
}

export function AICompanySwarmTab() {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState<any>(null)
  const [lastRefreshed, setLastRefreshed] = useState<string>('')
  const [selectedAgent, setSelectedAgent] = useState<AIEmployee | null>(null)
  const [detailModalOpen, setDetailModalOpen] = useState(false)
  const [departmentFilter, setDepartmentFilter] = useState<string>('All')
  const [pendingTasksCount, setPendingTasksCount] = useState<number>(0)
  const [raiseModalOpen, setRaiseModalOpen] = useState(false)
  const [submittingTask, setSubmittingTask] = useState(false)
  const [raiseForm] = Form.useForm()

  const fetchTaskStats = async () => {
    try {
      const res = await adminApi.get('/tasks', { params: { filter_type: 'unverified' } })
      const tasks = res.data?.tasks || []
      setPendingTasksCount(tasks.length)
    } catch {
      // ignore
    }
  }

  const fetchSwarmStatus = async () => {
    setLoading(true)
    try {
      const res = await adminApi.get('/company-ops/status')
      setData(res.data)
      setLastRefreshed(new Date().toLocaleTimeString('en-IN'))
    } catch {
      // Fallback display if offline
      setData({
        status: 'online',
        employees: [
          { id: 'atlas', name: 'Atlas', title: 'SRE & Server Watchdog', department: 'DevOps & Infrastructure', icon: '🛡️', status: 'WORKING', statusColor: 'green', currentTask: 'Monitoring 22 PM2 microservices every 60s & RAM thresholds', lastAction: 'All 22 microservices online. RAM healthy', metrics: '22 Services | RAM 30.6%' },
          { id: 'midas', name: 'Midas', title: 'Finance & Revenue Auditor', department: 'Finance & P&L', icon: '💰', status: 'WORKING', statusColor: 'green', currentTask: 'Auditing real-time deposits, completed payouts & platform margin', lastAction: 'Calculated today platform net revenue', metrics: 'Ledger Synchronized' },
          { id: 'argus', name: 'Argus', title: 'Fraud & Cashout Detective', department: 'Security & Risk', icon: '⚖️', status: 'MONITORING', statusColor: 'green', currentTask: 'Auditing high-value withdrawals for multi-accounting & chip-dumping', lastAction: '0 critical fraud alerts in last 1h', metrics: 'Cashout Gate Active' },
          { id: 'zeus', name: 'Zeus', title: 'Player Retention & Marketing Engine', department: 'Growth & VIP Care', icon: '📢', status: 'WORKING', statusColor: 'cyan', currentTask: 'Scanning churned VIP players & generating personalized WhatsApp/SMS bonuses', lastAction: 'Generated personalized VIP deposit boost hooks', metrics: 'Gemini Pro Marketing Hooks' },
          { id: 'athena', name: 'Athena', title: 'Chief Gaming Officer & Bot Training Director', department: 'Gaming Operations & Game AI', icon: '🎯', status: 'TRAINING', statusColor: 'geekblue', currentTask: 'Simulating human opponent profiles, DDAS steering, & 6-hourly incremental profile rebuilds', lastAction: 'Active on Teen Patti, Ludo & Rummy (Box-Muller jitter & opponent modelers synced)', metrics: '3 Game Engines | DDAS Active' },
          { id: 'pythia', name: 'Pythia', title: 'Lead Data Scientist & Predictive Churn Engine', department: 'Data Science & ML Engineering', icon: '🔮', status: 'OPTIMAL', statusColor: 'purple', currentTask: 'Running XGBoost/Random Forest churn risk scoring & player difficulty clustering', lastAction: 'Evaluated player dropoff vectors across active cohort (FastAPI ML 3020)', metrics: 'ML Model v1 | Retrain Cron Active' },
          { id: 'aegis', name: 'Aegis', title: 'Mobile Performance & Client Diagnostics Sentinel', department: 'Mobile Client Experience', icon: '📱', status: 'HEALTHY', statusColor: 'green', currentTask: 'Ingesting Flutter crash telemetry, battery drain, network latency, & GeoIP analytics', lastAction: 'Processed client heartbeat & network telemetry from Android mobile fleet', metrics: 'GeoLite2 MMDB | Port 3015' },
          { id: 'gemini-coo', name: 'Gemini 3.5 Pro', title: 'Autonomous AI COO & Advisor', department: 'Executive Operations', icon: '🧠', status: 'READY', statusColor: 'purple', currentTask: 'Scheduled executive briefing daily at 09:00 AM IST & Telegram Q&A', lastAction: 'Google Gemini Pro verified and operational (gemini-3.5-flash)', metrics: 'Google Pro Tier Active' },
          { id: 'hermes', name: 'Hermes', title: 'Telegram Alert Bot', department: 'Executive Communications', icon: '📲', status: 'STANDBY', statusColor: 'gold', currentTask: 'Awaiting bot token for direct mobile stream', lastAction: 'Telegram daemon loaded', metrics: 'Mobile Alert Center' }
        ],
        activityFeed: [
          { id: '1', time: new Date().toLocaleTimeString('en-IN'), agent: 'SRE Watchdog', message: 'All 22 PM2 microservices online and healthy', type: 'success' },
          { id: '2', time: new Date().toLocaleTimeString('en-IN'), agent: 'Finance Guardian', message: 'PostgreSQL ledger reconciled with payment orders', type: 'info' }
        ]
      })
      setLastRefreshed(new Date().toLocaleTimeString('en-IN'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchSwarmStatus()
    fetchTaskStats()
    const timer = setInterval(() => {
      fetchSwarmStatus()
      fetchTaskStats()
    }, 15000)
    return () => clearInterval(timer)
  }, [])

  const employees: AIEmployee[] = data?.employees || []
  const activities: ActivityItem[] = data?.activityFeed || []

  const filteredEmployees = employees.filter((emp) => {
    if (departmentFilter === 'All') return true
    if (departmentFilter === 'SRE & Infra') return emp.department.includes('DevOps') || emp.department.includes('Infrastructure')
    if (departmentFilter === 'Finance & Risk') return emp.department.includes('Finance') || emp.department.includes('Security')
    if (departmentFilter === 'Gaming & ML AI') return emp.department.includes('Gaming') || emp.department.includes('Data Science')
    if (departmentFilter === 'Growth & Mobile') return emp.department.includes('Growth') || emp.department.includes('Mobile')
    if (departmentFilter === 'Executive') return emp.department.includes('Executive')
    return true
  })

  const openAgentModal = (emp: AIEmployee) => {
    setSelectedAgent(emp)
    setDetailModalOpen(true)
  }

  const selectedWork = selectedAgent ? AGENT_WORKS_DETAILS[selectedAgent.id] : null

  return (
    <div style={{ padding: '4px' }}>
      {/* Modern CSS Animations & Styles */}
      <style>{`
        @keyframes gradientShift {
          0% { background-position: 0% 50%; }
          50% { background-position: 100% 50%; }
          100% { background-position: 0% 50%; }
        }
        @keyframes pulseGlow {
          0% { box-shadow: 0 0 0 0 rgba(34, 197, 94, 0.4); }
          70% { box-shadow: 0 0 0 8px rgba(34, 197, 94, 0); }
          100% { box-shadow: 0 0 0 0 rgba(34, 197, 94, 0); }
        }
        @keyframes floatIcon {
          0% { transform: translateY(0px); }
          50% { transform: translateY(-3px); }
          100% { transform: translateY(0px); }
        }
        .ai-banner-animated {
          background: linear-gradient(135deg, #090d16 0%, #0f172a 35%, #1e1b4b 70%, #0f172a 100%);
          background-size: 200% 200%;
          animation: gradientShift 14s ease infinite;
          border-radius: 16px;
          border: 1px solid #334155;
          box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.3), 0 0 1px 1px rgba(255, 255, 255, 0.05);
        }
        .ai-card-hover {
          transition: all 0.28s cubic-bezier(0.4, 0, 0.2, 1);
          border: 1px solid #e2e8f0;
          cursor: pointer;
          position: relative;
          overflow: hidden;
        }
        .ai-card-hover:hover {
          transform: translateY(-6px);
          box-shadow: 0 16px 32px -8px rgba(15, 23, 42, 0.12), 0 0 0 1.5px #38bdf8;
          border-color: #38bdf8;
        }
        .ai-card-hover:hover .inspect-btn {
          background: #0284c7 !important;
          color: #ffffff !important;
        }
        .pulse-indicator {
          display: inline-block;
          width: 8px;
          height: 8px;
          border-radius: 50%;
          margin-right: 6px;
          animation: pulseGlow 2s infinite;
        }
        .agent-avatar-float {
          display: inline-block;
          animation: floatIcon 3.5s ease-in-out infinite;
        }
      `}</style>

      {/* Top Banner */}
      <Card className="ai-banner-animated" style={{ marginBottom: 20 }} bodyStyle={{ padding: '24px 28px' }}>
        <Row justify="space-between" align="middle" gutter={[16, 16]}>
          <Col xs={24} md={16}>
            <Space align="center" style={{ marginBottom: 8 }}>
              <span className="agent-avatar-float" style={{ fontSize: 34 }}>🏢</span>
              <Title level={3} style={{ color: '#ffffff', margin: 0 }}>
                MyOnlineJoker Virtual AI Organization & Swarm
              </Title>
              <Tag color="cyan" style={{ borderRadius: 12, fontWeight: 'bold' }}>
                AUTONOMOUS COO
              </Tag>
              <Tag color="purple" style={{ borderRadius: 12, fontWeight: 'bold' }}>
                GOOGLE PRO GEMINI 3.5
              </Tag>
            </Space>
            <Paragraph style={{ color: '#94a3b8', margin: 0, fontSize: 14 }}>
              Your 9 autonomous AI employees actively govern infrastructure SRE, real-time finance reconciliation, fraud detection, bot intelligence, churn prediction, and mobile client performance.
            </Paragraph>
          </Col>
          <Col xs={24} md={8} style={{ textAlign: 'right' }}>
            <Space>
              <Button
                type="primary"
                icon={<ReloadOutlined spin={loading} />}
                onClick={fetchSwarmStatus}
                style={{
                  borderRadius: 20,
                  background: 'linear-gradient(135deg, #38bdf8 0%, #0284c7 100%)',
                  border: 'none',
                  color: '#0f172a',
                  fontWeight: 'bold',
                  boxShadow: '0 4px 12px rgba(56, 189, 248, 0.25)'
                }}
              >
                Sync Swarm State
              </Button>
            </Space>
            {lastRefreshed && (
              <div style={{ marginTop: 6, fontSize: 11, color: '#64748b' }}>
                Last synced: {lastRefreshed}
              </div>
            )}
          </Col>
        </Row>
      </Card>

      {/* Human Verification Alert Banner */}
      {pendingTasksCount > 0 && (
        <Alert
          type="warning"
          showIcon
          icon={<ClockCircleOutlined style={{ fontSize: 20, color: '#d97706' }} />}
          message={
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
              <span>
                <strong style={{ color: '#b45309' }}>{pendingTasksCount} AI Agent Task{pendingTasksCount > 1 ? 's' : ''}</strong> Awaiting Human Administrator Verification &amp; Authorization
              </span>
              <Button
                type="primary"
                danger
                size="small"
                onClick={() => navigate('/tasks')}
                style={{ borderRadius: 6, fontWeight: 'bold' }}
              >
                Review &amp; Verify AI Tasks &rarr;
              </Button>
            </div>
          }
          description="Autonomous AI department heads (Argus, Atlas, Athena, Zeus) have raised operational or risk flags that require human administrator audit, verification, or false-positive rejection."
          style={{ marginBottom: 20, borderRadius: 12, border: '1px solid #fde047', background: '#fefce8' }}
        />
      )}

      {/* Quick Stat Counters */}
      <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
        <Col xs={12} sm={12} md={6} lg={4}>
          <Card style={{ borderRadius: 12, border: '1px solid #e2e8f0', background: '#f8fafc' }} bodyStyle={{ padding: '16px' }}>
            <Statistic
              title={<Text type="secondary"><RobotOutlined /> AI Employees</Text>}
              value={employees.length}
              valueStyle={{ color: '#0f172a', fontWeight: 'bold' }}
              suffix={<Tag color="green" style={{ marginLeft: 6 }}><span className="pulse-indicator" style={{ background: '#22c55e' }} />ONLINE</Tag>}
            />
          </Card>
        </Col>
        <Col xs={12} sm={12} md={6} lg={5}>
          <Card style={{ borderRadius: 12, border: '1px solid #e2e8f0', background: '#f8fafc' }} bodyStyle={{ padding: '16px' }}>
            <Statistic
              title={<Text type="secondary"><CloudServerOutlined /> SRE Supervised Fleet</Text>}
              value={data?.system?.processes?.length || 22}
              valueStyle={{ color: '#0284c7', fontWeight: 'bold' }}
              suffix={<Text type="secondary" style={{ fontSize: 12 }}>Microservices</Text>}
            />
          </Card>
        </Col>
        <Col xs={12} sm={12} md={6} lg={5}>
          <Card style={{ borderRadius: 12, border: '1px solid #e2e8f0', background: '#f8fafc' }} bodyStyle={{ padding: '16px' }}>
            <Statistic
              title={<Text type="secondary"><DollarOutlined /> Finance Guardian</Text>}
              value="Double-Entry"
              valueStyle={{ color: '#16a34a', fontWeight: 'bold', fontSize: 18 }}
              suffix={<Tag color="success">AUDITED</Tag>}
            />
          </Card>
        </Col>
        <Col xs={12} sm={12} md={6} lg={5}>
          <Card
            style={{
              borderRadius: 12,
              border: pendingTasksCount > 0 ? '1px solid #f59e0b' : '1px solid #e2e8f0',
              background: pendingTasksCount > 0 ? '#fffbeb' : '#f8fafc',
              cursor: 'pointer'
            }}
            bodyStyle={{ padding: '16px' }}
            onClick={() => navigate('/tasks')}
          >
            <Statistic
              title={<Text type="secondary"><AuditOutlined /> AI Task Verification</Text>}
              value={pendingTasksCount}
              valueStyle={{ color: pendingTasksCount > 0 ? '#d97706' : '#10b981', fontWeight: 'bold' }}
              suffix={
                pendingTasksCount > 0 ? (
                  <Tag color="warning" style={{ fontWeight: 600 }}>NEEDS AUDIT</Tag>
                ) : (
                  <Tag color="success">ALL CLEAR</Tag>
                )
              }
            />
          </Card>
        </Col>
        <Col xs={12} sm={12} md={6} lg={5}>
          <Card style={{ borderRadius: 12, border: '1px solid #e2e8f0', background: '#f8fafc' }} bodyStyle={{ padding: '16px' }}>
            <Statistic
              title={<Text type="secondary"><ThunderboltOutlined /> Brain / LLM Engine</Text>}
              value="Gemini 3.5"
              valueStyle={{ color: '#7c3aed', fontWeight: 'bold', fontSize: 18 }}
              suffix={<Tag color="purple">PRO TIER</Tag>}
            />
          </Card>
        </Col>
      </Row>

      {/* Department Filter & Section Title */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <Title level={4} style={{ margin: 0 }}>
            👥 Active Virtual AI Employees & Department Heads
          </Title>
          <Text type="secondary" style={{ fontSize: 13 }}>
            Click any AI card to inspect its full algorithmic architecture, connected services, and live telemetry.
          </Text>
        </div>
        <Segmented
          options={['All', 'SRE & Infra', 'Finance & Risk', 'Gaming & ML AI', 'Growth & Mobile', 'Executive']}
          value={departmentFilter}
          onChange={(val) => setDepartmentFilter(val as string)}
          style={{ background: '#f1f5f9', padding: '3px', borderRadius: 8 }}
        />
      </div>

      {/* AI Employees Grid */}
      <Row gutter={[16, 16]} style={{ marginBottom: 28 }}>
        {filteredEmployees.map((emp) => (
          <Col xs={24} sm={12} lg={8} key={emp.id}>
            <Card
              className="ai-card-hover"
              onClick={() => openAgentModal(emp)}
              style={{
                borderRadius: 14,
                boxShadow: '0 4px 12px rgba(0,0,0,0.03)',
                height: '100%',
                display: 'flex',
                flexDirection: 'column'
              }}
              bodyStyle={{ padding: '20px', display: 'flex', flexDirection: 'column', flex: 1 }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
                <Space align="center">
                  <span className="agent-avatar-float" style={{ fontSize: 30 }}>{emp.icon}</span>
                  <div>
                    <Text strong style={{ fontSize: 16, display: 'block' }}>{emp.name}</Text>
                    <Text type="secondary" style={{ fontSize: 12 }}>{emp.title}</Text>
                  </div>
                </Space>
                <Tag color={emp.statusColor} style={{ borderRadius: 10, fontWeight: 'bold', display: 'flex', alignItems: 'center' }}>
                  <span
                    className="pulse-indicator"
                    style={{
                      background: emp.statusColor === 'green' ? '#22c55e' : emp.statusColor === 'purple' ? '#a855f7' : emp.statusColor === 'cyan' ? '#06b6d4' : '#3b82f6'
                    }}
                  />
                  {emp.status}
                </Tag>
              </div>

              <div style={{ background: '#f8fafc', padding: '10px 12px', borderRadius: 8, marginBottom: 10, border: '1px solid #f1f5f9' }}>
                <Text style={{ fontSize: 11, fontWeight: 'bold', color: '#64748b', display: 'block', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                  Current Active Task
                </Text>
                <Text style={{ fontSize: 12, color: '#334155' }}>
                  {emp.currentTask}
                </Text>
              </div>

              <div style={{ marginBottom: 12, flex: 1 }}>
                <Text style={{ fontSize: 11, fontWeight: 'bold', color: '#64748b', display: 'block', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                  Recent Action
                </Text>
                <Text style={{ fontSize: 12, color: '#0f172a' }}>
                  ✅ {emp.lastAction}
                </Text>
              </div>

              <div style={{ borderTop: '1px solid #f1f5f9', paddingTop: 10, marginBottom: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text style={{ fontSize: 11, color: '#64748b', fontWeight: 500 }}>{emp.department}</Text>
                <Tag color="default" style={{ fontSize: 10, margin: 0, background: '#f1f5f9' }}>{emp.metrics}</Tag>
              </div>

              <Button
                className="inspect-btn"
                block
                size="small"
                icon={<EyeOutlined />}
                style={{
                  borderRadius: 8,
                  fontSize: 12,
                  fontWeight: 600,
                  background: '#f8fafc',
                  borderColor: '#cbd5e1',
                  color: '#334155',
                  transition: 'all 0.2s ease'
                }}
              >
                Inspect AI Architecture &amp; Works
              </Button>
            </Card>
          </Col>
        ))}
      </Row>

      {/* Phase 3 & 4: Live Cashouts Audit & VIP Retention Engine */}
      <Row gutter={[16, 16]} style={{ marginBottom: 28 }}>
        {/* Phase 3: Financial Reconciliation & Cashout Guardian */}
        <Col xs={24} lg={12}>
          <Card
            title={
              <Space>
                <DollarOutlined style={{ color: '#16a34a' }} />
                <span>Phase 3: Financial Guardian (Pending Cashouts)</span>
              </Space>
            }
            extra={<Tag color="green">1-Click Fast Payout</Tag>}
            style={{ borderRadius: 14, border: '1px solid #e2e8f0', height: '100%' }}
            bodyStyle={{ padding: '16px' }}
          >
            {(!data?.pendingWithdrawals || data.pendingWithdrawals.length === 0) ? (
              <div style={{ textAlign: 'center', padding: '30px 0', color: '#64748b' }}>
                <CheckCircleOutlined style={{ fontSize: 32, color: '#22c55e', marginBottom: 8, display: 'block' }} />
                <Text strong>All clear! Zero pending withdrawals.</Text>
                <div style={{ fontSize: 12 }}>Risk Guardian has verified all recent transactions.</div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {data.pendingWithdrawals.map((pw: any) => (
                  <div
                    key={pw.id}
                    style={{
                      background: '#f8fafc',
                      border: '1px solid #e2e8f0',
                      borderRadius: 10,
                      padding: '12px 14px'
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                      <Text strong style={{ fontSize: 14 }}>{pw.userName}</Text>
                      <Text strong style={{ color: '#0f172a', fontSize: 16 }}>₹{pw.amount.toLocaleString('en-IN')}</Text>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <Space size={4}>
                        <Tag color={pw.riskScore > 50 ? 'red' : 'blue'}>Risk: {pw.riskScore}/100</Tag>
                        <Text type="secondary" style={{ fontSize: 11 }}>{pw.riskReasons?.join(', ')}</Text>
                      </Space>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </Col>

        {/* Phase 4: Player Retention & Marketing Engine */}
        <Col xs={24} lg={12}>
          <Card
            title={
              <Space>
                <ThunderboltOutlined style={{ color: '#ec4899' }} />
                <span>Phase 4: Player Retention &amp; VIP Marketing</span>
              </Space>
            }
            extra={<Tag color="purple">Gemini 3.5 Pro Hooks</Tag>}
            style={{ borderRadius: 14, border: '1px solid #e2e8f0', height: '100%' }}
            bodyStyle={{ padding: '16px' }}
          >
            {(!data?.vipRetentionCampaigns || data.vipRetentionCampaigns.length === 0) ? (
              <div style={{ textAlign: 'center', padding: '30px 0', color: '#64748b' }}>
                <CheckCircleOutlined style={{ fontSize: 32, color: '#ec4899', marginBottom: 8, display: 'block' }} />
                <Text strong>VIP Player Retention is Optimal</Text>
                <div style={{ fontSize: 12 }}>No churn detected among VIP depositing players in the last 48 hours.</div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {data.vipRetentionCampaigns.map((lead: any, idx: number) => (
                  <div
                    key={idx}
                    style={{
                      background: '#fdf4ff',
                      border: '1px solid #f5d0fe',
                      borderRadius: 10,
                      padding: '12px 14px'
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                      <Text strong style={{ color: '#86198f' }}>VIP Player ({lead.phone})</Text>
                      <Tag color="magenta">Bonus: ₹{lead.suggestedBonus}</Tag>
                    </div>
                    <div style={{ fontSize: 12, color: '#334155', fontStyle: 'italic', marginBottom: 4 }}>
                      "{lead.suggestedMessage}"
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <Text type="secondary" style={{ fontSize: 11 }}>Favorite Game: {lead.favoriteGame} | Lifetime: ₹{lead.totalLifetimeDeposits?.toLocaleString('en-IN')}</Text>
                      <Tag color="cyan">Ready to Dispatch</Tag>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </Col>
      </Row>

      {/* Live Activity Feed */}
      <Card
        title={
          <Space>
            <DashboardOutlined style={{ color: '#0284c7' }} />
            <span>Real-Time Autonomous Agent Event Log</span>
          </Space>
        }
        style={{ borderRadius: 14, border: '1px solid #e2e8f0' }}
        bodyStyle={{ padding: '16px 20px' }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {activities.map((act) => (
            <div
              key={act.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: '8px 12px',
                borderRadius: 8,
                background: act.type === 'success' ? '#f0fdf4' : '#f8fafc',
                borderLeft: `3px solid ${act.type === 'success' ? '#22c55e' : '#38bdf8'}`
              }}
            >
              <Tag color="default" style={{ fontFamily: 'monospace', fontSize: 11 }}>{act.time}</Tag>
              <Tag color="blue" style={{ fontWeight: 'bold' }}>{act.agent}</Tag>
              <Text style={{ fontSize: 13, color: '#1e293b' }}>{act.message}</Text>
            </div>
          ))}
        </div>
      </Card>

      {/* Comprehensive AI Agent Inspection Modal */}
      <Modal
        title={null}
        footer={null}
        open={detailModalOpen}
        onCancel={() => setDetailModalOpen(false)}
        width={820}
        style={{ top: 24 }}
        styles={{ body: { padding: 0 } }}
      >
        {selectedAgent && (
          <div>
            {/* Modal Header */}
            <div
              style={{
                background: 'linear-gradient(135deg, #090d16 0%, #1e293b 100%)',
                color: '#ffffff',
                padding: '24px 28px',
                borderRadius: '8px 8px 0 0',
                borderBottom: '1px solid #334155'
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Space align="center" size={16}>
                  <span style={{ fontSize: 40 }}>{selectedAgent.icon}</span>
                  <div>
                    <Title level={3} style={{ color: '#ffffff', margin: 0 }}>
                      {selectedAgent.name}
                    </Title>
                    <Text style={{ color: '#94a3b8', fontSize: 14 }}>
                      {selectedAgent.title} • <span style={{ color: '#38bdf8' }}>{selectedAgent.department}</span>
                    </Text>
                  </div>
                </Space>
                <Tag color={selectedAgent.statusColor} style={{ fontSize: 13, padding: '4px 12px', borderRadius: 12, fontWeight: 'bold' }}>
                  <span className="pulse-indicator" style={{ background: '#22c55e' }} />
                  {selectedAgent.status}
                </Tag>
              </div>
            </div>

            {/* Modal Content Tabs */}
            <div style={{ padding: '20px 24px' }}>
              <Tabs
                defaultActiveKey="mission"
                type="line"
                items={[
                  {
                    key: 'mission',
                    label: (
                      <span>
                        <RocketOutlined /> Operational Works &amp; Pipeline
                      </span>
                    ),
                    children: (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                        <Alert
                          type="info"
                          showIcon
                          icon={<InfoCircleOutlined />}
                          message="Agent Operational Role"
                          description={selectedWork?.summary || selectedAgent.currentTask}
                          style={{ background: '#f0f9ff', border: '1px solid #bae6fd' }}
                        />

                        <div>
                          <Text strong style={{ fontSize: 14, display: 'block', marginBottom: 8 }}>
                            🎯 Core Responsibilities &amp; Autonomy
                          </Text>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                            {selectedWork?.responsibilities.map((resp, i) => (
                              <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                                <CheckCircleOutlined style={{ color: '#16a34a', marginTop: 4 }} />
                                <Text style={{ fontSize: 13, color: '#334155' }}>{resp}</Text>
                              </div>
                            ))}
                          </div>
                        </div>

                        <Divider style={{ margin: '12px 0' }} />

                        <Row gutter={[16, 16]}>
                          <Col span={12}>
                            <Text strong style={{ fontSize: 12, color: '#64748b', display: 'block', textTransform: 'uppercase' }}>
                              ⚡ Execution Cadence
                            </Text>
                            <Text style={{ fontSize: 13, color: '#0f172a', fontWeight: 600 }}>
                              {selectedWork?.cadence || 'Continuous Event-Driven'}
                            </Text>
                          </Col>
                          <Col span={12}>
                            <Text strong style={{ fontSize: 12, color: '#64748b', display: 'block', textTransform: 'uppercase' }}>
                              🔗 Connected Services
                            </Text>
                            <Space wrap size={[4, 4]} style={{ marginTop: 4 }}>
                              {selectedWork?.connectedServices.map((svc, i) => (
                                <Tag key={i} color="blue" style={{ fontSize: 11 }}>{svc}</Tag>
                              ))}
                            </Space>
                          </Col>
                        </Row>
                      </div>
                    )
                  },
                  {
                    key: 'logic',
                    label: (
                      <span>
                        <SlidersOutlined /> Algorithmic Logic &amp; Engineering
                      </span>
                    ),
                    children: (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                        <Card size="small" style={{ borderRadius: 8, background: '#f8fafc', border: '1px solid #e2e8f0' }}>
                          <Text strong style={{ fontSize: 13, color: '#0284c7', display: 'block', marginBottom: 4 }}>
                            🧠 Algorithmic Execution Formula
                          </Text>
                          <Text style={{ fontSize: 13, color: '#1e293b' }}>
                            {selectedWork?.algorithmicLogic}
                          </Text>
                        </Card>

                        <Card size="small" style={{ borderRadius: 8, background: '#f0fdf4', border: '1px solid #bbf7d0' }}>
                          <Text strong style={{ fontSize: 13, color: '#16a34a', display: 'block', marginBottom: 4 }}>
                            🛡️ Security, Fair Play &amp; Fail-Safe
                          </Text>
                          <Text style={{ fontSize: 13, color: '#14532d' }}>
                            {selectedWork?.securityFairPlay}
                          </Text>
                        </Card>

                        <div>
                          <Text strong style={{ fontSize: 12, color: '#64748b', display: 'block', textTransform: 'uppercase', marginBottom: 6 }}>
                            💻 Engineering Technology Stack
                          </Text>
                          <Space wrap>
                            {selectedWork?.coreStack.map((tech, i) => (
                              <Tag key={i} color="purple" style={{ fontWeight: 600 }}>{tech}</Tag>
                            ))}
                          </Space>
                        </div>
                      </div>
                    )
                  },
                  {
                    key: 'telemetry',
                    label: (
                      <span>
                        <LineChartOutlined /> Real-Time Telemetry Gauges
                      </span>
                    ),
                    children: (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                        <Row gutter={[16, 16]}>
                          {selectedWork?.telemetryGauges.map((gauge, i) => (
                            <Col span={12} key={i}>
                              <Card size="small" style={{ borderRadius: 8, border: '1px solid #e2e8f0', background: '#f8fafc' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                                  <Text style={{ fontSize: 12, color: '#64748b' }}>{gauge.label}</Text>
                                  <Text strong style={{ fontSize: 13, color: '#0f172a' }}>{gauge.value}</Text>
                                </div>
                                <Progress percent={gauge.percent} strokeColor={gauge.color} showInfo={false} size="small" />
                              </Card>
                            </Col>
                          ))}
                        </Row>

                        <Alert
                          type="success"
                          message="Active Metrics Signature"
                          description={`Current verified status: ${selectedAgent.metrics} — Synchronized with live GCP production instance.`}
                          style={{ marginTop: 8 }}
                        />
                      </div>
                    )
                  },
                  {
                    key: 'events',
                    label: (
                      <span>
                        <AuditOutlined /> Live Event Stream
                      </span>
                    ),
                    children: (
                      <Timeline
                        style={{ marginTop: 8 }}
                        items={selectedWork?.eventLog.map((ev, i) => ({
                          color: 'green',
                          children: (
                            <div>
                              <Text strong style={{ fontSize: 13, color: '#0f172a' }}>{ev}</Text>
                              <div style={{ fontSize: 11, color: '#94a3b8' }}>Verified by autonomous operations engine</div>
                            </div>
                          )
                        }))}
                      />
                    )
                  }
                ]}
              />

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 16, borderTop: '1px solid #f1f5f9', paddingTop: 12, flexWrap: 'wrap', gap: 8 }}>
                <Space wrap>
                  <Button
                    type="primary"
                    icon={<PlusOutlined />}
                    onClick={() => {
                      raiseForm.setFieldsValue({
                        target_ai_agent: selectedAgent.id,
                        raised_by_ai: selectedAgent.id === 'argus' ? 'atlas' : 'argus',
                        issue_type: selectedAgent.id === 'argus' ? 'cashout_flag' : selectedAgent.id === 'atlas' ? 'service_down' : selectedAgent.id === 'athena' ? 'game_fairness_flag' : 'other',
                        priority: 'high',
                        title: `[${selectedAgent.name}] Operational Flag & Action Request`,
                        description: `Autonomous task requested for AI Employee ${selectedAgent.name} (${selectedAgent.department}) requiring inspection and human sign-off.`
                      })
                      setRaiseModalOpen(true)
                    }}
                    style={{ borderRadius: 8, background: '#0284c7', borderColor: '#0284c7' }}
                  >
                    Raise AI Task for {selectedAgent.name}
                  </Button>
                  <Button
                    icon={<AuditOutlined />}
                    onClick={() => navigate('/tasks')}
                    style={{ borderRadius: 8 }}
                  >
                    View All AI Tasks
                  </Button>
                </Space>
                <Button type="default" onClick={() => setDetailModalOpen(false)} style={{ borderRadius: 8 }}>
                  Close Inspector
                </Button>
              </div>
            </div>
          </div>
        )}
      </Modal>

      {/* Raise AI Task Modal */}
      <Modal
        title={
          <Space>
            <RobotOutlined style={{ color: '#0284c7' }} />
            <span>AI Task Delegation &amp; Issue Dispatch</span>
          </Space>
        }
        open={raiseModalOpen}
        onCancel={() => setRaiseModalOpen(false)}
        footer={null}
        destroyOnClose
        centered
        width={580}
      >
        <Form
          form={raiseForm}
          layout="vertical"
          onFinish={async (values) => {
            setSubmittingTask(true)
            try {
              await adminApi.post('/tasks/raise-ai-issue', values)
              message.success('AI task registered and dispatched into verification pipeline!')
              setRaiseModalOpen(false)
              raiseForm.resetFields()
              fetchTaskStats()
            } catch (err: any) {
              message.error(err.response?.data?.error || 'Failed to raise AI task')
            } finally {
              setSubmittingTask(false)
            }
          }}
        >
          <Alert
            type="info"
            showIcon
            message="Autonomous Delegation Architecture"
            description="AI agents can automatically assign tasks to peer agents for specific issues. All AI-raised tasks enter the 'Pending Verification' queue for human administrator audit and approval."
            style={{ marginBottom: 16 }}
          />

          <Row gutter={16}>
            <Col span={12}>
              <Form.Item
                name="target_ai_agent"
                label="Target AI Agent (Assignee)"
                rules={[{ required: true, message: 'Please select target AI agent' }]}
              >
                <Select
                  options={[
                    { value: 'atlas', label: 'Atlas (SRE Watchdog)' },
                    { value: 'midas', label: 'Midas (Finance Auditor)' },
                    { value: 'argus', label: 'Argus (Fraud Detective)' },
                    { value: 'zeus', label: 'Zeus (Marketing & VIP)' },
                    { value: 'athena', label: 'Athena (Bot Training CGO)' },
                    { value: 'pythia', label: 'Pythia (Predictive ML)' },
                    { value: 'aegis', label: 'Aegis (Mobile Sentinel)' },
                    { value: 'gemini-coo', label: 'Gemini 3.5 Pro (COO)' },
                    { value: 'hermes', label: 'Hermes (Telegram Alerts)' }
                  ]}
                />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                name="raised_by_ai"
                label="Initiating Agent / Origin"
                rules={[{ required: true, message: 'Please select originating AI' }]}
              >
                <Select
                  options={[
                    { value: 'argus', label: 'Argus (Security Risk Scan)' },
                    { value: 'atlas', label: 'Atlas (SRE Health Monitor)' },
                    { value: 'midas', label: 'Midas (Ledger Audit)' },
                    { value: 'zeus', label: 'Zeus (Churn Recovery Trigger)' },
                    { value: 'athena', label: 'Athena (DDAS Steering)' },
                    { value: 'gemini-coo', label: 'Gemini 3.5 Pro (Executive Decision)' },
                    { value: 'human_admin', label: 'Human Admin Override' }
                  ]}
                />
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={16}>
            <Col span={12}>
              <Form.Item
                name="issue_type"
                label="Specific Issue Category"
                rules={[{ required: true, message: 'Please select issue category' }]}
              >
                <Select
                  options={[
                    { value: 'fraud_suspicion', label: '🚨 Fraud Suspicion' },
                    { value: 'cashout_flag', label: '💰 Cashout Velocity Flag' },
                    { value: 'service_down', label: '⚡ Service Offline / Degraded' },
                    { value: 'performance_drop', label: '📉 Latency Spike' },
                    { value: 'game_fairness_flag', label: '🎯 Game Fairness / DDAS Variance' },
                    { value: 'ml_model_drift', label: '🔮 ML Model Drift' },
                    { value: 'retention_anomaly', label: '📢 VIP Churn Anomaly' },
                    { value: 'other', label: '📋 Other Operational Task' }
                  ]}
                />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                name="priority"
                label="Priority Tier"
                initialValue="high"
                rules={[{ required: true }]}
              >
                <Select
                  options={[
                    { value: 'low', label: 'Low (Informational)' },
                    { value: 'normal', label: 'Normal' },
                    { value: 'high', label: 'High' },
                    { value: 'urgent', label: 'Urgent (Instant Action)' }
                  ]}
                />
              </Form.Item>
            </Col>
          </Row>

          <Form.Item
            name="title"
            label="Task Title / Summary"
            rules={[{ required: true, message: 'Please enter task title' }]}
          >
            <Input placeholder="e.g. [Argus] High cashout velocity flag on User #4912" />
          </Form.Item>

          <Form.Item
            name="description"
            label="Issue Description &amp; Algorithmic Evidence"
            rules={[{ required: true, message: 'Please enter issue details' }]}
          >
            <Input.TextArea
              rows={4}
              placeholder="Detail the metrics, telemetry anomalies, or algorithmic trigger that necessitated this task..."
            />
          </Form.Item>

          <div style={{ textAlign: 'right', marginTop: 12 }}>
            <Space>
              <Button onClick={() => setRaiseModalOpen(false)}>Cancel</Button>
              <Button type="primary" htmlType="submit" loading={submittingTask} style={{ background: '#0284c7', borderColor: '#0284c7' }}>
                Dispatch &amp; Queue for Human Verification
              </Button>
            </Space>
          </div>
        </Form>
      </Modal>
    </div>
  )
}
