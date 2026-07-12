import { execSync } from 'child_process'
import { Pool, QueryResult } from 'pg'
import axios from 'axios'
import fs from 'fs'
import path from 'path'

/**
 * Deployment statuses
 */
type DeploymentStatus = 'queued' | 'deploying' | 'success' | 'failed' | 'rolled_back'

/**
 * Deployment log level
 */
type LogLevel = 'info' | 'warn' | 'error' | 'success'

/**
 * Rollback status
 */
type RollbackStatus = 'pending' | 'in_progress' | 'success' | 'failed' | 'cancelled'

/**
 * Rollback step status
 */
type RollbackStepStatus = 'pending' | 'in_progress' | 'complete' | 'failed'

/**
 * Safety check status
 */
type SafetyCheckStatus = 'passed' | 'failed' | 'warning'

/**
 * Rollback step definition
 */
interface RollbackStep {
  number: number
  name: string
  description: string
}

/**
 * Rollback progress information
 */
interface RollbackProgress {
  rollbackId: string
  status: RollbackStatus
  environment: 'dev' | 'prod'
  progress: number
  currentStep: number
  totalSteps: number
  steps: Array<{
    number: number
    name: string
    status: RollbackStepStatus
    startTime?: Date
    endTime?: Date
    durationMs?: number
    errorMessage?: string
  }>
  startedAt?: Date
  completedAt?: Date
}

/**
 * Rollback safety check result
 */
interface RollbackSafetyCheck {
  checkName: string
  status: SafetyCheckStatus
  message: string
  details?: string
}

/**
 * Configuration for VPS SSH connection
 */
interface VPSConfig {
  host: string
  port: number
  username: string
  keyPath: string
  projectPath: string
}

/**
 * Service health check result
 */
interface ServiceHealthResult {
  service: string
  healthy: boolean
  status: number
  message: string
}

/**
 * Safety check result
 */
interface SafetyCheckResult {
  name: string
  status: 'passed' | 'failed' | 'warning'
  message: string
}

/**
 * Safety checks response
 */
interface SafetyChecksResponse {
  passed: boolean
  checks: SafetyCheckResult[]
  blockingFailures: number
  warnings: number
}

/**
 * Environment-specific configuration
 */
interface EnvironmentConfig {
  name: 'dev' | 'prod'
  ports: {
    coreApi: number
    wallet: number
    gateway: number
    gatewayAlt1: number
    gatewayAlt2: number
    aviator: number
    ludo: number
    tpEngine: number
    admin: number
    monitoring: number
    risk: number
    churn: number
    churnMl: number
    appMonitor: number
  }
  database: {
    url: string
    name: string
  }
  redis: {
    port: number
    host: string
  }
  envFile: string
  ecosystemConfig: string
  tag: string
  // Where the built admin-panel SPA is actually served from. Dev serves
  // straight out of the vite build output (alias in nginx.ssl.conf_api);
  // prod serves from a plain Hestia static docroot that's NOT the build
  // output path, so its files must be synced there after every build.
  frontendDocroot: string
}

const ENV_CONFIGS: Record<'dev' | 'prod', EnvironmentConfig> = {
  dev: {
    name: 'dev',
    ports: {
      coreApi: 3201,
      wallet: 3203,
      gateway: 3204,
      gatewayAlt1: 3221,
      gatewayAlt2: 3222,
      aviator: 3205,
      ludo: 3211,
      tpEngine: 3210,
      admin: 3208,
      monitoring: 3217,
      risk: 3206,
      churn: 3213,
      churnMl: 3220,
      appMonitor: 3215,
    },
    database: {
      url: 'teen_db_dev',
      name: 'teen_db_dev',
    },
    redis: {
      port: 6380,
      host: '127.0.0.1',
    },
    envFile: '.env.dev',
    ecosystemConfig: 'ecosystem.config.dev.js',
    tag: '[DEV]',
    frontendDocroot: '/opt/teen-dev/admin-panel/dist',
  },
  prod: {
    name: 'prod',
    ports: {
      coreApi: 3001,
      wallet: 3003,
      gateway: 3004,
      gatewayAlt1: 3021,
      gatewayAlt2: 3022,
      aviator: 3005,
      ludo: 3011,
      tpEngine: 3010,
      admin: 3008,
      monitoring: 3017,
      risk: 3006,
      churn: 3013,
      churnMl: 3020,
      appMonitor: 3015,
    },
    database: {
      // The real prod DB is named plain `teen_db` (predates the dev/prod
      // split — confirmed via `docker exec teen_postgres psql -U teen -l`
      // and prod admin-service's own DATABASE_URL). Do not "fix" this to
      // teen_db_prod without an actual DB rename + every service's .env.
      url: 'teen_db',
      name: 'teen_db',
    },
    redis: {
      port: 6379,
      host: '127.0.0.1',
    },
    envFile: '.env',
    ecosystemConfig: 'ecosystem.config.js',
    tag: '[PROD]',
    frontendDocroot: '/home/admin/web/game.myonlinejoker.com/public_html/admin',
  },
}

/**
 * Deployment Service
 * Handles production and development deployments with automatic rollback capabilities
 */
export class DeploymentService {
  private db: Pool
  private notificationUrl: string
  private vpsConfig: VPSConfig
  private deploymentTimeout = 5 * 60 * 1000 // 5 minutes in milliseconds

  constructor(db: Pool, notificationUrl: string = 'http://127.0.0.1:3001') {
    this.db = db
    this.notificationUrl = notificationUrl
    this.vpsConfig = {
      host: process.env.VPS_HOST || '64.204.130.181',
      port: process.env.VPS_PORT ? parseInt(process.env.VPS_PORT) : 22,
      username: process.env.VPS_USERNAME || 'root',
      keyPath: process.env.SSH_KEY_PATH || '/root/.ssh/id_ed25519',
      projectPath: process.env.VPS_PROJECT_PATH || '/opt/teen',
    }
  }

  private getProjectPath(environment?: 'dev' | 'prod'): string {
    if (environment) {
      return environment === 'dev' ? '/opt/teen-dev' : '/opt/teen-prod';
    }
    return process.cwd().includes('teen-dev') ? '/opt/teen-dev' : '/opt/teen-prod';
  }

  /**
   * Get environment configuration
   */
  private getEnvConfig(environment: 'dev' | 'prod'): EnvironmentConfig {
    return ENV_CONFIGS[environment]
  }

  /**
   * Reject any branch name that could break out of the shell command it is
   * interpolated into (runSSHCommand builds `ssh root@vps "... ${branch} ..."`).
   * Git ref names are already restricted to a safe subset; enforce it here as
   * the trust boundary so a crafted `branch` can never run arbitrary commands
   * as root on the VPS.
   */
  private assertSafeBranch(branch: string): void {
    if (
      typeof branch !== 'string' ||
      branch.length === 0 ||
      branch.length > 255 ||
      !/^[A-Za-z0-9._/-]+$/.test(branch) ||
      branch.startsWith('-') ||
      branch.includes('..') ||
      branch.includes('//')
    ) {
      throw new Error('Invalid branch name')
    }
  }

  /**
   * Run environment-specific safety checks before deployment
   * Validates infrastructure, services, backups based on target environment
   */
  async runSafetyChecks(
    branch: string,
    environment: 'dev' | 'prod' = 'prod'
  ): Promise<SafetyChecksResponse> {
    this.assertSafeBranch(branch)
    const envConfig = this.getEnvConfig(environment)
    const startTime = Date.now()
    const checks: SafetyCheckResult[] = []

    // Run all checks in parallel for efficiency
    const allCheckPromises = [
      this.checkGitClean(branch, environment),
      this.checkValidBranch(branch),
      this.checkTestsPassed(environment),
      this.checkDatabaseConnectivity(environment),
      this.checkRedisConnectivity(environment),
      this.checkServicesHealth(environment),
      this.checkDiskSpace(environment),
      this.checkDatabaseBackups(environment),
      this.checkBranchUpdated(branch, environment),
      this.checkDatabaseMigrations(environment),
      this.checkPreviousDeploymentStatus(environment),
    ]

    if (environment === 'prod') {
      // Production-specific checks
      allCheckPromises.push(this.checkGatewayInstances(environment))
    }

    const checkResults = await Promise.allSettled(allCheckPromises)

    // Collect results and handle timeouts
    for (const result of checkResults) {
      if (result.status === 'fulfilled' && result.value) {
        checks.push(result.value)
      }
    }

    // Log safety check results
    const blockingFailures = checks.filter((c) => c.status === 'failed').length
    const warnings = checks.filter((c) => c.status === 'warning').length
    const passed = blockingFailures === 0
    const duration = Date.now() - startTime

    await this.logDeployment(
      `safety-check-${environment}`,
      `${envConfig.tag} Safety checks completed in ${duration}ms. Passed: ${passed}, Failures: ${blockingFailures}, Warnings: ${warnings}`,
      passed ? 'info' : 'warn'
    ).catch(() => {
      // Ignore logging errors
    })

    return {
      passed,
      checks,
      blockingFailures,
      warnings,
    }
  }

  /**
   * Check if git working tree is clean
   */
  private async checkGitClean(branch: string, environment?: 'dev' | 'prod'): Promise<SafetyCheckResult | null> {
    try {
      const projectPath = this.getProjectPath(environment)
      const gitStatus = await this.runSSHCommand(
        `cd ${projectPath} && git status --porcelain`,
        10000
      )
      if (gitStatus.trim().length > 0) {
        return {
          name: 'Git Clean',
          status: 'failed',
          message: 'Uncommitted changes found. Commit before deploying.',
        }
      } else {
        return {
          name: 'Git Clean',
          status: 'passed',
          message: 'Working tree clean',
        }
      }
    } catch (err: any) {
      return {
        name: 'Git Clean',
        status: 'failed',
        message: `Failed to check git status: ${err.message}`,
      }
    }
  }

  /**
   * Check if branch is valid for deployment
   */
  private async checkValidBranch(branch: string): Promise<SafetyCheckResult | null> {
    const forbiddenBranches = ['main', 'master']
    if (forbiddenBranches.includes(branch)) {
      return {
        name: 'Valid Branch',
        status: 'failed',
        message: `Cannot deploy from ${branch} branch. Use feature branches.`,
      }
    } else if (branch.startsWith('feature/') || branch === 'develop' || branch === 'staging') {
      return {
        name: 'Valid Branch',
        status: 'passed',
        message: `Branch ${branch} is allowed`,
      }
    } else {
      return {
        name: 'Valid Branch',
        status: 'warning',
        message: `Branch ${branch} is not a standard feature/develop/staging branch. Proceed with caution.`,
      }
    }
  }

  /**
   * Check if tests pass
   */
  private async checkTestsPassed(environment?: 'dev' | 'prod'): Promise<SafetyCheckResult | null> {
    try {
      const projectPath = this.getProjectPath(environment)
      await this.runSSHCommand(
        `cd ${projectPath} && npm test -- --passWithNoTests --maxWorkers=2 2>&1`,
        2 * 60 * 1000 // 2 minute timeout
      )
      return {
        name: 'Tests Pass',
        status: 'passed',
        message: 'All tests passed',
      }
    } catch (err: any) {
      const errorMsg = err.message || 'Tests failed'
      return {
        name: 'Tests Pass',
        status: 'failed',
        message: `Tests failed: ${errorMsg.substring(0, 100)}...`,
      }
    }
  }

  /**
   * Check database connectivity
   */
  private async checkDatabaseConnectivity(environment: 'dev' | 'prod'): Promise<SafetyCheckResult | null> {
    try {
      const envConfig = this.getEnvConfig(environment)
      const result = await this.db.query('SELECT 1')
      return {
        name: 'Database Connectivity',
        status: 'passed',
        message: `Connected to ${envConfig.database.name}`,
      }
    } catch (err: any) {
      return {
        name: 'Database Connectivity',
        status: 'failed',
        message: `Database unreachable: ${err.message.substring(0, 50)}`,
      }
    }
  }

  /**
   * Check Redis connectivity
   */
  private async checkRedisConnectivity(environment: 'dev' | 'prod'): Promise<SafetyCheckResult | null> {
    try {
      const envConfig = this.getEnvConfig(environment)
      const port = envConfig.redis.port
      await this.runSSHCommand(`redis-cli -p ${port} ping 2>&1`, 5000)
      return {
        name: 'Redis Connectivity',
        status: 'passed',
        message: `Redis on port ${port} is accessible`,
      }
    } catch (err: any) {
      return {
        name: 'Redis Connectivity',
        status: 'failed',
        message: `Redis unreachable: ${err.message.substring(0, 50)}`,
      }
    }
  }

  /**
   * Check services health for environment
   */
  private async checkServicesHealth(environment: 'dev' | 'prod'): Promise<SafetyCheckResult | null> {
    try {
      const envConfig = this.getEnvConfig(environment)
      const p = envConfig.ports

      const criticalServices = [
        { name: 'teen-core-api', url: `http://127.0.0.1:${p.coreApi}/health` },
        { name: 'teen-gateway', url: `http://127.0.0.1:${p.gateway}/health` },
        { name: 'teen-admin-svc', url: `http://127.0.0.1:${p.admin}/health` },
      ]

      const downServices: string[] = []
      for (const svc of criticalServices) {
        try {
          const response = await axios.get(svc.url, { timeout: 5000 })
          if (response.status !== 200) {
            downServices.push(svc.name)
          }
        } catch (err) {
          downServices.push(svc.name)
        }
      }

      if (downServices.length > 0) {
        return {
          name: 'Services Health',
          status: 'failed',
          message: `Critical services offline: ${downServices.join(', ')}`,
        }
      }

      return {
        name: 'Services Health',
        status: 'passed',
        message: `All critical services are online`,
      }
    } catch (err: any) {
      return {
        name: 'Services Health',
        status: 'warning',
        message: `Could not verify services: ${err.message.substring(0, 50)}`,
      }
    }
  }

  /**
   * Check disk space (stricter for prod)
   */
  private async checkDiskSpace(environment: 'dev' | 'prod'): Promise<SafetyCheckResult | null> {
    try {
      const minSpace = environment === 'prod' ? 10 : 5 // GB
      const projectPath = this.getProjectPath(environment)
      const diskOutput = await this.runSSHCommand(
        `df ${projectPath} | tail -1 | awk '{print $4}'`,
        10000
      )
      const freeKB = parseInt(diskOutput.trim()) || 0
      const freeGB = freeKB / 1024 / 1024

      if (freeGB < minSpace) {
        return {
          name: 'Disk Space',
          status: 'failed',
          message: `Only ${freeGB.toFixed(1)}GB free (need ${minSpace}GB)`,
        }
      }

      if (freeGB < minSpace * 1.5) {
        return {
          name: 'Disk Space',
          status: 'warning',
          message: `${freeGB.toFixed(1)}GB free (recommended ${minSpace * 1.5}GB)`,
        }
      }

      return {
        name: 'Disk Space',
        status: 'passed',
        message: `${freeGB.toFixed(1)}GB free (minimum ${minSpace}GB required)`,
      }
    } catch (err: any) {
      return {
        name: 'Disk Space',
        status: 'warning',
        message: `Could not check disk space: ${err.message.substring(0, 50)}`,
      }
    }
  }

  /**
   * Check database backups (stricter for prod)
   */
  private async checkDatabaseBackups(environment: 'dev' | 'prod'): Promise<SafetyCheckResult | null> {
    try {
      const hoursBack = environment === 'prod' ? 24 : 48
      const backupResult = await this.db.query(
        `SELECT COUNT(*) as count, MAX(created_at) as latest
         FROM database_backups
         WHERE created_at > NOW() - INTERVAL '${hoursBack} hours'
         LIMIT 1`
      )

      const hasRecentBackup = backupResult.rows[0]?.count > 0
      if (!hasRecentBackup) {
        return {
          name: 'Database Backups',
          status: environment === 'prod' ? 'failed' : 'warning',
          message: `No database backup in last ${hoursBack} hours${environment === 'prod' ? '. Run backup first.' : '. Consider running backup.'}`,
        }
      }

      const latestBackup = backupResult.rows[0]?.latest
      const hoursAgo = Math.floor((Date.now() - new Date(latestBackup).getTime()) / (1000 * 60 * 60))

      return {
        name: 'Database Backups',
        status: 'passed',
        message: `Recent backup exists (${hoursAgo} hours ago)`,
      }
    } catch (err: any) {
      return {
        name: 'Database Backups',
        status: 'warning',
        message: `Could not verify backups: ${err.message.substring(0, 50)}`,
      }
    }
  }

  /**
   * Check if branch is up to date with main
   */
  private async checkBranchUpdated(branch: string, environment?: 'dev' | 'prod'): Promise<SafetyCheckResult | null> {
    try {
      const projectPath = this.getProjectPath(environment)
      const behindMain = await this.runSSHCommand(
        `cd ${projectPath} && git rev-list --left-only --count main...${branch} 2>/dev/null || echo 0`,
        10000
      )
      const commitsBehind = parseInt(behindMain.trim()) || 0
      if (commitsBehind > 0) {
        return {
          name: 'Branch Updated',
          status: 'warning',
          message: `Branch is ${commitsBehind} commits behind main. Consider merging.`,
        }
      } else {
        return {
          name: 'Branch Updated',
          status: 'passed',
          message: 'Branch is up to date with main',
        }
      }
    } catch (err: any) {
      return {
        name: 'Branch Updated',
        status: 'warning',
        message: 'Could not check branch status',
      }
    }
  }

  /**
   * Report how many infra/db/migrations/*.sql files are pending for this
   * environment's actual database. Informational only (status is never
   * 'failed') — real enforcement happens in apply-migrations.sh during the
   * deploy itself, which halts the deploy if a migration errors. Queries
   * over SSH against the target environment's own DB rather than `this.db`,
   * since `this.db` is whichever DB *this* admin-service instance connects
   * to (dev when the push is initiated from the dev admin panel), not
   * necessarily the environment being deployed to.
   */
  private async checkDatabaseMigrations(environment: 'dev' | 'prod'): Promise<SafetyCheckResult | null> {
    try {
      const envConfig = this.getEnvConfig(environment)
      const projectPath = this.getProjectPath(environment)
      const migrationsDir = `${projectPath}/infra/db/migrations`

      // Ensure the tracking table exists (quietly — `-q` suppresses the
      // CREATE TABLE tag so it can't pollute the count below), then diff
      // on-disk filenames against tracked ones directly. Comparing raw
      // COUNT(*) instead would be wrong the moment history has any drift
      // (a renamed/removed migration leaves a stale tracked row that
      // inflates the count and can mask a real pending migration).
      await this.runSSHCommand(
        `docker exec -i teen_postgres psql -U teen -d ${envConfig.database.name} -q -c ` +
          `"CREATE TABLE IF NOT EXISTS schema_migrations (filename TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())"`,
        10000
      )
      const pendingOutput = await this.runSSHCommand(
        `comm -23 <(ls ${migrationsDir}/*.sql | xargs -n1 basename | sort) ` +
          `<(docker exec -i teen_postgres psql -U teen -d ${envConfig.database.name} -tAc "SELECT filename FROM schema_migrations" | sort)`,
        10000
      )
      const pendingFiles = pendingOutput.trim().split('\n').filter(Boolean)

      return {
        name: 'Database Migrations',
        status: 'passed',
        message: pendingFiles.length > 0
          ? `${pendingFiles.length} pending migration(s) will be applied during this deploy: ${pendingFiles.join(', ')}`
          : 'No pending migrations',
      }
    } catch (err: any) {
      return {
        name: 'Database Migrations',
        status: 'warning',
        message: `Could not check migration status: ${err.message?.substring(0, 80)}`,
      }
    }
  }

  /**
   * Check if previous deployment completed successfully (prod only)
   */
  private async checkPreviousDeploymentStatus(environment: 'dev' | 'prod'): Promise<SafetyCheckResult | null> {
    if (environment !== 'prod') return null

    try {
      const prevDeployment = await this.db.query(
        `SELECT status, created_at FROM deployments
         WHERE environment = $1
         ORDER BY created_at DESC
         LIMIT 1`,
        [environment]
      )

      if (prevDeployment.rows.length === 0) {
        return {
          name: 'Previous Deployment',
          status: 'passed',
          message: 'No previous deployments found',
        }
      }

      const lastStatus = prevDeployment.rows[0].status
      const lastTime = new Date(prevDeployment.rows[0].created_at)
      const minsAgo = Math.floor((Date.now() - lastTime.getTime()) / (1000 * 60))

      if (lastStatus === 'deploying') {
        return {
          name: 'Previous Deployment',
          status: 'failed',
          message: `Previous deployment still in progress (${minsAgo} mins). Check manually.`,
        }
      }

      if (lastStatus === 'failed') {
        return {
          name: 'Previous Deployment',
          status: 'warning',
          message: `Previous deployment failed. Review logs before proceeding.`,
        }
      }

      return {
        name: 'Previous Deployment',
        status: 'passed',
        message: `Last deployment successful (${minsAgo} mins ago)`,
      }
    } catch (err: any) {
      return {
        name: 'Previous Deployment',
        status: 'warning',
        message: 'Could not check previous deployment status',
      }
    }
  }

  /**
   * Check if all gateway instances are online (prod only - redundancy check)
   */
  private async checkGatewayInstances(environment: 'dev' | 'prod'): Promise<SafetyCheckResult | null> {
    if (environment !== 'prod') return null

    try {
      const envConfig = this.getEnvConfig(environment)
      const p = envConfig.ports

      const gateways = [
        { name: 'Gateway 1', url: `http://127.0.0.1:${p.gateway}/health` },
        { name: 'Gateway 2', url: `http://127.0.0.1:${p.gatewayAlt1}/health` },
        { name: 'Gateway 3', url: `http://127.0.0.1:${p.gatewayAlt2}/health` },
      ]

      let onlineCount = 0
      for (const gw of gateways) {
        try {
          const response = await axios.get(gw.url, { timeout: 5000 })
          if (response.status === 200) {
            onlineCount++
          }
        } catch (err) {
          // Gateway offline
        }
      }

      if (onlineCount < 3) {
        return {
          name: 'Gateway Instances',
          status: 'failed',
          message: `Only ${onlineCount}/3 gateways online. Need all 3 for redundancy.`,
        }
      }

      return {
        name: 'Gateway Instances',
        status: 'passed',
        message: `All 3 gateway instances are online`,
      }
    } catch (err: any) {
      return {
        name: 'Gateway Instances',
        status: 'warning',
        message: `Could not verify gateways: ${err.message.substring(0, 50)}`,
      }
    }
  }

  /**
   * Main deployment function supporting both dev and prod environments
   * Starts deployment asynchronously and returns jobId immediately for frontend polling
   */
  async deployToEnvironment(
    jobId: string,
    branch: string,
    commitHash: string,
    environment: 'dev' | 'prod',
    userId: string
  ): Promise<{ jobId: string; environment: string; tag: string }> {
    this.assertSafeBranch(branch)
    const envConfig = this.getEnvConfig(environment)

    // Log start to database immediately
    await this.logDeployment(
      jobId,
      `${envConfig.tag} Deployment queued (environment: ${environment})`,
      'info'
    )
    await this.updateDeploymentStatus(jobId, 'queued', environment)

    // Start deployment asynchronously (don't wait for completion)
    this.runDeploymentAsync(jobId, branch, commitHash, environment, userId).catch((err) => {
      this.logDeployment(jobId, `${envConfig.tag} Unhandled error: ${err.message}`, 'error').catch(
        console.error
      )
    })

    return {
      jobId,
      environment,
      tag: envConfig.tag,
    }
  }

  /**
   * Legacy function for production deployments (backwards compatible)
   */
  async deployToProduction(
    jobId: string,
    branch: string,
    commitHash: string,
    userId: string
  ): Promise<{ jobId: string }> {
    const result = await this.deployToEnvironment(jobId, branch, commitHash, 'prod', userId)
    return { jobId: result.jobId }
  }

  /**
   * Internal async deployment runner (fires and forgets from the API)
   * Supports both dev and prod environments with environment isolation
   */
  private async runDeploymentAsync(
    jobId: string,
    branch: string,
    commitHash: string,
    environment: 'dev' | 'prod',
    userId: string
  ): Promise<void> {
    const envConfig = this.getEnvConfig(environment)
    const startTime = Date.now()
    let previousCommit: string | null = null

    try {
      await this.updateDeploymentStatus(jobId, 'deploying', environment)
      await this.logDeployment(
        jobId,
        `${envConfig.tag} Starting deployment of ${branch} (${commitHash})`,
        'info'
      )

      const projectPath = this.getProjectPath(environment)
      // Get the previous commit hash for rollback
      previousCommit = await this.getPreviousCommit(environment)
      await this.logDeployment(jobId, `${envConfig.tag} Previous commit saved: ${previousCommit}`, 'info')

      // Step 1: Git pull
      await this.logDeployment(jobId, `${envConfig.tag} Running: git pull origin ${branch}`, 'info')
      const gitOutput = await this.runSSHCommand(
        `cd ${projectPath} && git pull origin ${branch}`
      )
      await this.logDeployment(
        jobId,
        `${envConfig.tag} Git pull completed: ${gitOutput.substring(0, 200)}...`,
        'info'
      )

      // Step 2: Verify commit hash
      const currentCommit = await this.runSSHCommand(
        `cd ${projectPath} && git rev-parse HEAD`
      )
      if (!currentCommit.includes(commitHash)) {
        throw new Error(`Commit mismatch: expected ${commitHash}, got ${currentCommit}`)
      }
      await this.logDeployment(jobId, `${envConfig.tag} Verified commit hash: ${commitHash}`, 'info')

      // Step 2.5: Apply any pending database migrations. Must run before
      // npm install/restart — new code that expects a new column/table
      // should never come up against an un-migrated schema. A migration
      // failure throws here, which the outer catch turns into an automatic
      // code rollback (see autoRollback below); the migration itself is
      // simply left unrecorded in schema_migrations and retried next deploy.
      await this.logDeployment(jobId, `${envConfig.tag} Applying database migrations...`, 'info')
      const migrationOutput = await this.runSSHCommand(
        `bash ${projectPath}/infra/db/apply-migrations.sh ${envConfig.database.name}`,
        2 * 60 * 1000 // 2 minute timeout
      )
      await this.logDeployment(jobId, `${envConfig.tag} ${migrationOutput}`, 'info')

      // Step 3-5: npm install (+ tsc build where applicable) for root and
      // services. Plain `npm install` does NOT run `tsc` — there's no
      // postinstall/prepare hook in either package.json — so without an
      // explicit build here, PM2 would restart against whatever dist/ was
      // last compiled by hand, silently ignoring the code that was just
      // pulled. `npm run build` is added for every service that has one.
      const services = [
        { path: '', build: false },
        { path: 'services/game-gateway', build: true },
        { path: 'services/admin-service', build: true },
      ]
      for (const { path: svc, build } of services) {
        const svcPath = svc ? `${projectPath}/${svc}` : projectPath
        const svcName = svc || 'root'
        await this.logDeployment(
          jobId,
          `${envConfig.tag} Installing dependencies for ${svcName}...`,
          'info'
        )
        const output = await this.runSSHCommand(`cd ${svcPath} && npm install --production=false 2>&1`)
        await this.logDeployment(
          jobId,
          `${envConfig.tag} npm install completed for ${svcName}`,
          'info'
        )

        if (build) {
          await this.logDeployment(jobId, `${envConfig.tag} Building ${svcName}...`, 'info')
          await this.runSSHCommand(`cd ${svcPath} && npm run build 2>&1`, 3 * 60 * 1000)
          await this.logDeployment(jobId, `${envConfig.tag} Build completed for ${svcName}`, 'info')
        }
      }

      // Step 5.5: Build and deploy the admin-panel frontend. The deploy
      // pipeline never touched this before — a "successful" deploy could
      // still be running yesterday's frontend. Dev serves straight out of
      // the build output; prod serves from a separate static docroot
      // (Hestia's public_html/admin, per nginx.ssl.conf_admin — NOT the
      // build output path) that has to be synced after every build.
      await this.logDeployment(jobId, `${envConfig.tag} Installing admin-panel dependencies...`, 'info')
      await this.runSSHCommand(`cd ${projectPath}/admin-panel && npm install --production=false 2>&1`, 3 * 60 * 1000)
      await this.logDeployment(jobId, `${envConfig.tag} Building admin-panel...`, 'info')
      await this.runSSHCommand(`cd ${projectPath}/admin-panel && npm run build 2>&1`, 3 * 60 * 1000)
      const buildOutputPath = `${projectPath}/admin-panel/dist`
      if (envConfig.frontendDocroot !== buildOutputPath) {
        await this.logDeployment(
          jobId,
          `${envConfig.tag} Syncing admin-panel build to ${envConfig.frontendDocroot}...`,
          'info'
        )
        // --chown keeps ownership as admin:admin (matching Hestia's existing
        // web-user convention there) instead of leaving root-owned files
        // behind from this SSH session running as root.
        await this.runSSHCommand(`rsync -a --delete --chown=admin:admin ${buildOutputPath}/ ${envConfig.frontendDocroot}/`)
      }
      await this.logDeployment(jobId, `${envConfig.tag} admin-panel deployed to ${envConfig.frontendDocroot}`, 'info')

      // Step 6: Restart PM2 with environment-specific config
      await this.logDeployment(
        jobId,
        `${envConfig.tag} Restarting services with PM2 (${envConfig.ecosystemConfig})...`,
        'info'
      )
      await this.runSSHCommand(`pm2 delete ${envConfig.ecosystemConfig} || true`)
      const pm2Output = await this.runSSHCommand(
        `cd ${projectPath} && pm2 start ${envConfig.ecosystemConfig} && pm2 save`
      )
      await this.logDeployment(jobId, `${envConfig.tag} PM2 started`, 'info')

      // Step 7: Wait 5 seconds for services to stabilize
      await this.logDeployment(jobId, `${envConfig.tag} Waiting 5 seconds for services to stabilize...`, 'info')
      await this.sleep(5000)

      // Step 8: Health checks for environment-specific ports
      await this.logDeployment(jobId, `${envConfig.tag} Running health checks...`, 'info')
      const healthResults = await this.checkServiceHealthForEnvironment(environment)

      let allHealthy = true
      for (const result of healthResults) {
        const status = result.healthy ? 'success' : 'error'
        await this.logDeployment(
          jobId,
          `${envConfig.tag} Health check ${result.service}: ${result.message}`,
          status === 'error' ? 'error' : 'info'
        )
        if (!result.healthy) {
          allHealthy = false
        }
      }

      // Step 9: Handle failure with rollback
      if (!allHealthy) {
        throw new Error('Health checks failed')
      }

      // Step 10: Success
      await this.updateDeploymentStatus(jobId, 'success', environment)
      await this.logDeployment(
        jobId,
        `${envConfig.tag} Deployment successful! Duration: ${Date.now() - startTime}ms`,
        'success'
      )

      // Step 11: Send notification
      await this.sendNotification(
        jobId,
        userId,
        'success',
        `${envConfig.tag} Deployment completed successfully to ${environment} environment`
      )

      // Step 12: Log deployment metadata
      await this.db.query(
        `UPDATE deployments SET environment = $1 WHERE id = $2`,
        [environment, jobId]
      )
    } catch (error: any) {
      // Step 13: Rollback on failure
      await this.logDeployment(jobId, `${envConfig.tag} Deployment failed: ${error.message}`, 'error')
      await this.logDeployment(jobId, `${envConfig.tag} Starting automatic rollback...`, 'warn')

      try {
        await this.autoRollback(jobId, previousCommit, environment)
        await this.updateDeploymentStatus(jobId, 'rolled_back', environment)
        await this.sendNotification(
          jobId,
          userId,
          'rolled_back',
          `${envConfig.tag} Deployment failed and rolled back: ${error.message}`
        )
      } catch (rollbackError: any) {
        await this.logDeployment(
          jobId,
          `${envConfig.tag} Rollback failed: ${rollbackError.message}`,
          'error'
        )
        await this.updateDeploymentStatus(jobId, 'failed', environment)
        await this.sendNotification(
          jobId,
          userId,
          'failed',
          `${envConfig.tag} Deployment failed and rollback also failed: ${error.message}`
        )
      }
    }
  }

  /**
   * Execute SSH command on VPS
   * Throws on timeout or SSH error
   */
  private async runSSHCommand(command: string, timeoutMs: number = this.deploymentTimeout): Promise<string> {
    return new Promise((resolve, reject) => {
      try {
        // Use SSH key-based authentication with ssh command
        const sshCmd = `ssh -i "${this.vpsConfig.keyPath}" -p ${this.vpsConfig.port} ${this.vpsConfig.username}@${this.vpsConfig.host} "${command}"`

        const timeout = setTimeout(() => {
          reject(new Error(`SSH command timeout after ${timeoutMs}ms: ${command}`))
        }, timeoutMs)

        try {
          const output = execSync(sshCmd, {
            encoding: 'utf8',
            stdio: ['pipe', 'pipe', 'pipe'],
            maxBuffer: 10 * 1024 * 1024, // 10MB buffer
          })
          clearTimeout(timeout)
          resolve(output.trim())
        } catch (err: any) {
          clearTimeout(timeout)
          reject(new Error(`SSH command failed: ${err.message}\nCommand: ${command}`))
        }
      } catch (err: any) {
        reject(err)
      }
    })
  }

  /**
   * Check health of key services (legacy - uses production ports)
   */
  private async checkServiceHealth(): Promise<ServiceHealthResult[]> {
    return this.checkServiceHealthForEnvironment('prod')
  }

  /**
   * Check health of key services for specific environment
   * Uses environment-specific ports and configuration
   */
  private async checkServiceHealthForEnvironment(
    environment: 'dev' | 'prod'
  ): Promise<ServiceHealthResult[]> {
    const envConfig = this.getEnvConfig(environment)
    const p = envConfig.ports // Shorthand for ports

    const services = [
      { name: 'teen-core-api', url: `http://127.0.0.1:${p.coreApi}/health` },
      { name: 'teen-gateway', url: `http://127.0.0.1:${p.gateway}/health` },
      { name: 'teen-gateway-2', url: `http://127.0.0.1:${p.gatewayAlt1}/health` },
      { name: 'teen-gateway-3', url: `http://127.0.0.1:${p.gatewayAlt2}/health` },
      { name: 'teen-admin-svc', url: `http://127.0.0.1:${p.admin}/health` },
      { name: 'teen-wallet', url: `http://127.0.0.1:${p.wallet}/health` },
      { name: 'teen-aviator', url: `http://127.0.0.1:${p.aviator}/health` },
      { name: 'teen-ludo', url: `http://127.0.0.1:${p.ludo}/health` },
      { name: 'teen-tp-engine', url: `http://127.0.0.1:${p.tpEngine}/health` },
      { name: 'teen-monitoring', url: `http://127.0.0.1:${p.monitoring}/health` },
      { name: 'teen-risk', url: `http://127.0.0.1:${p.risk}/health` },
      { name: 'teen-churn', url: `http://127.0.0.1:${p.churn}/health` },
      { name: 'teen-churn-ml', url: `http://127.0.0.1:${p.churnMl}/health` },
      { name: 'teen-app-monitor', url: `http://127.0.0.1:${p.appMonitor}/health` },
    ]

    const results: ServiceHealthResult[] = []

    for (const svc of services) {
      try {
        const response = await axios.get(svc.url, { timeout: 5000 })
        results.push({
          service: svc.name,
          healthy: response.status === 200,
          status: response.status,
          message: `Service healthy (status ${response.status})`,
        })
      } catch (error: any) {
        results.push({
          service: svc.name,
          healthy: false,
          status: error.response?.status || 0,
          message: error.message || 'Service unreachable',
        })
      }
    }

    return results
  }

  /**
   * Get the previous commit hash for rollback
   */
  private async getPreviousCommit(environment?: 'dev' | 'prod'): Promise<string> {
    const projectPath = this.getProjectPath(environment)
    const commit = await this.runSSHCommand(
      `cd ${projectPath} && git rev-parse HEAD`
    )
    return commit.trim()
  }

  /**
   * Automatic rollback to previous commit
   * Supports environment-specific config
   */
  private async autoRollback(
    jobId: string,
    previousCommit: string | null,
    environment: 'dev' | 'prod'
  ): Promise<void> {
    const envConfig = this.getEnvConfig(environment)

    if (!previousCommit) {
      throw new Error('No previous commit available for rollback')
    }

    await this.logDeployment(jobId, `${envConfig.tag} Rolling back to commit ${previousCommit}...`, 'warn')

    // Git reset to previous commit
    await this.runSSHCommand(
      `cd ${this.vpsConfig.projectPath} && git reset --hard ${previousCommit}`
    )
    await this.logDeployment(jobId, `${envConfig.tag} Git reset completed`, 'info')

    // npm install for previous commit dependencies
    const services = ['', 'services/game-gateway', 'services/admin-service']
    for (const svc of services) {
      const svcPath = svc ? `${this.vpsConfig.projectPath}/${svc}` : this.vpsConfig.projectPath
      const svcName = svc || 'root'
      await this.runSSHCommand(`cd ${svcPath} && npm install --production=false 2>&1`)
    }
    await this.logDeployment(jobId, `${envConfig.tag} Dependencies reinstalled`, 'info')

    // Restart services with environment-specific config
    await this.runSSHCommand('pm2 kill')
    await this.runSSHCommand(
      `cd ${this.vpsConfig.projectPath} && pm2 start ${envConfig.ecosystemConfig} && pm2 save`
    )
    await this.logDeployment(jobId, `${envConfig.tag} Services restarted`, 'info')

    // Wait and verify
    await this.sleep(5000)
    const healthResults = await this.checkServiceHealthForEnvironment(environment)
    const allHealthy = healthResults.every((r) => r.healthy)

    if (!allHealthy) {
      throw new Error('Services unhealthy after rollback')
    }

    await this.logDeployment(jobId, `${envConfig.tag} Rollback completed and verified`, 'success')
  }

  /**
   * Update deployment status in database
   * Optionally includes environment tag in log message
   */
  private async updateDeploymentStatus(
    jobId: string,
    status: DeploymentStatus,
    environment?: 'dev' | 'prod'
  ): Promise<void> {
    try {
      const updates: string[] = ['status = $1', 'updated_at = NOW()']
      const params: any[] = [status, jobId]

      if (environment) {
        updates.push(`environment = $${updates.length + 1}`)
        params.push(environment)
      }

      const query = `UPDATE deployments SET ${updates.join(', ')} WHERE id = $${params.length}`
      params.push(jobId)

      await this.db.query(query, params)
    } catch (err: any) {
      console.error(`Failed to update deployment status: ${err.message}`)
      // Don't throw — continue deployment even if logging fails
    }
  }

  /**
   * Log deployment message to database
   */
  async logDeployment(jobId: string, message: string, level: LogLevel = 'info'): Promise<void> {
    try {
      await this.db.query(
        `INSERT INTO deployment_logs (deployment_id, message, level, created_at)
         VALUES ($1, $2, $3, NOW())`,
        [jobId, message, level]
      )
    } catch (err: any) {
      console.error(`Failed to log deployment message: ${err.message}`)
      // Continue even if logging fails
    }
  }

  /**
   * Send notification email/Slack
   */
  private async sendNotification(
    jobId: string,
    userId: string,
    status: 'success' | 'failed' | 'rolled_back',
    message: string
  ): Promise<void> {
    try {
      await axios.post(
        `${this.notificationUrl}/api/notifications/send`,
        {
          user_id: userId,
          type: 'deployment_' + status,
          title: `Deployment ${status === 'success' ? 'Successful' : 'Failed'}`,
          message,
          metadata: { deployment_id: jobId },
        },
        { timeout: 5000 }
      )
    } catch (err: any) {
      console.error(`Failed to send notification: ${err.message}`)
      // Don't fail the deployment if notification fails
    }
  }

  /**
   * Get deployment status and logs
   */
  async getDeploymentStatus(jobId: string): Promise<any> {
    const result = await this.db.query(
      `SELECT id, status, branch, commit_hash, created_by, started_at, completed_at, rollback_from, created_at
       FROM deployments WHERE id = $1`,
      [jobId]
    )

    if (!result.rows.length) {
      throw new Error('Deployment not found')
    }

    const deployment = result.rows[0]

    // Get logs
    const logsResult = await this.db.query(
      `SELECT message, level, created_at FROM deployment_logs WHERE deployment_id = $1 ORDER BY created_at ASC`,
      [jobId]
    )

    return {
      ...deployment,
      logs: logsResult.rows,
    }
  }

  /**
   * List recent deployments
   */
  async listDeployments(limit: number = 20, offset: number = 0): Promise<any[]> {
    const result = await this.db.query(
      `SELECT id, status, branch, commit_hash, created_by, started_at, completed_at, rollback_from, created_at
       FROM deployments ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
      [limit, offset]
    )

    return result.rows
  }

  /**
   * Rollback to a previous deployment
   * Gets the commit hash from the previous deployment and checks it out on the VPS
   */
  async rollbackDeployment(
    previousDeploymentId: string,
    userId: string
  ): Promise<{ success: boolean; message: string; previousDeploymentId: string; previousCommit: string; timestamp: Date }> {
    const startTime = Date.now()
    let previousCommitHash: string = ''
    let currentCommitHash: string = ''

    try {
      // Step 1: Get the previous deployment details
      const prevDeploymentResult = await this.db.query(
        `SELECT id, commit_hash, status FROM deployments WHERE id = $1`,
        [previousDeploymentId]
      )

      if (!prevDeploymentResult.rows.length) {
        throw new Error('Previous deployment not found')
      }

      const prevDeployment = prevDeploymentResult.rows[0]

      // Verify the previous deployment was successful
      if (prevDeployment.status !== 'success') {
        throw new Error(`Cannot rollback to deployment with status '${prevDeployment.status}'. Only successful deployments can be rolled back to.`)
      }

      previousCommitHash = prevDeployment.commit_hash.trim()

      const projectPath = this.getProjectPath('prod')
      // Get the current commit hash to use for the rollback reference
      const currentCommitResult = await this.runSSHCommand(
        `cd ${projectPath} && git rev-parse HEAD`
      )
      currentCommitHash = currentCommitResult.trim()

      // Step 2: Checkout previous commit
      await this.runSSHCommand(
        `cd ${projectPath} && git checkout ${previousCommitHash}`
      )

      await this.runSSHCommand(
        `cd ${projectPath} && git reset --hard ${previousCommitHash}`
      )

      // Step 3: Reinstall dependencies
      const services = ['', 'services/game-gateway', 'services/admin-service']
      for (const svc of services) {
        const svcPath = svc ? `${projectPath}/${svc}` : projectPath
        await this.runSSHCommand(`cd ${svcPath} && npm install --production=false 2>&1`)
      }

      // Step 4: Restart services
      await this.runSSHCommand(`pm2 delete ecosystem.config.js || true`)
      await this.runSSHCommand(
        `cd ${projectPath} && pm2 start ecosystem.config.js && pm2 save`
      )

      // Step 5: Wait for services to start
      await this.sleep(5000)

      // Step 6: Health check
      const healthResults = await this.checkServiceHealth()
      const allHealthy = healthResults.every((r) => r.healthy)

      if (!allHealthy) {
        // Auto-rollback the rollback if services fail
        await this.runSSHCommand(
          `cd ${projectPath} && git reset --hard ${currentCommitHash}`
        )
        await this.runSSHCommand(`pm2 delete ecosystem.config.js || true`)
        await this.runSSHCommand(
          `cd ${projectPath} && pm2 start ecosystem.config.js && pm2 save`
        )
        await this.sleep(5000)

        throw new Error('Rollback failed. Services not coming online. Reverted to original version.')
      }

      // Step 7: Log rollback to database
      const { randomUUID } = await import('crypto')
      const rollbackJobId = randomUUID()

      await this.db.query(
        `INSERT INTO deployments (id, status, branch, commit_hash, created_by, rollback_from, completed_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
        [rollbackJobId, 'rolled_back', 'manual-rollback', previousCommitHash, userId, previousDeploymentId]
      )

      // Log rollback messages
      await this.db.query(
        `INSERT INTO deployment_logs (deployment_id, message, level, created_at)
         VALUES ($1, $2, $3, NOW())`,
        [rollbackJobId, `Rolled back to commit ${previousCommitHash}`, 'success']
      )

      await this.db.query(
        `INSERT INTO deployment_logs (deployment_id, message, level, created_at)
         VALUES ($1, $2, $3, NOW())`,
        [rollbackJobId, `Rolled back from deployment ${previousDeploymentId}`, 'info']
      )

      // Log to audit trail
      await this.db.query(
        `INSERT INTO admin_audit_log (admin_id, action, target_type, target_id, details)
         VALUES ($1, 'deployment_rolled_back', 'deployment', $2, $3)`,
        [userId, previousDeploymentId, JSON.stringify({ rolled_back_by: userId, new_deployment_id: rollbackJobId, previous_commit: previousCommitHash })]
      )

      // Step 8: Send notification
      await this.sendNotification(rollbackJobId, userId, 'rolled_back', `Deployment rolled back to commit ${previousCommitHash}`)

      return {
        success: true,
        message: `Successfully rolled back to deployment ${previousDeploymentId}`,
        previousDeploymentId,
        previousCommit: previousCommitHash,
        timestamp: new Date(),
      }
    } catch (error: any) {
      // Log rollback failure
      await this.db.query(
        `INSERT INTO admin_audit_log (admin_id, action, target_type, target_id, details)
         VALUES ($1, 'deployment_rollback_failed', 'deployment', $2, $3)`,
        [userId, previousDeploymentId, JSON.stringify({ error: error.message })]
      )

      throw error
    }
  }

  /**
   * Enhanced rollback with environment-specific support and full progress tracking
   * Safely reverts deployments with step-by-step tracking and safety checks
   */
  async rollbackDeploymentWithEnvironment(
    previousDeploymentId: string,
    environment: 'dev' | 'prod',
    userId: string,
    reason?: string
  ): Promise<{ success: boolean; message: string; previousDeploymentId: string; previousCommit: string; timestamp: Date; rollbackId: string }> {
    const { randomUUID } = await import('crypto')
    const rollbackId = randomUUID()
    const envConfig = this.getEnvConfig(environment)

    try {
      // STEP 0: Create rollback record
      await this.db.query(
        `INSERT INTO deployment_rollbacks (id, deployment_id, rolled_back_to_deployment_id, environment, status, triggered_by, reason, total_steps)
         VALUES ($1, (SELECT id FROM deployments WHERE environment = $2 ORDER BY created_at DESC LIMIT 1), $3, $4, 'pending', $5, $6, $7)`,
        [rollbackId, environment, previousDeploymentId, environment, userId, reason || '', 8]
      )

      await this.logDeploymentRollback(rollbackId, `${envConfig.tag} Rollback initiated for environment ${environment}`, 'info')

      // STEP 1: Run safety checks
      await this.updateRollbackStep(rollbackId, 1, 'Safety Checks', 'in_progress')
      const safetyChecks = await this.runRollbackSafetyChecks(rollbackId, previousDeploymentId, environment)

      const failedChecks = safetyChecks.filter((c) => c.status === 'failed')
      if (failedChecks.length > 0) {
        const errors = failedChecks.map((c) => c.message).join('; ')
        await this.updateRollbackStep(rollbackId, 1, 'Safety Checks', 'failed', `Failed checks: ${errors}`)
        await this.updateRollbackStatus(rollbackId, 'failed', 1, 8)

        throw new Error(`Safety checks failed: ${errors}`)
      }

      await this.updateRollbackStep(rollbackId, 1, 'Safety Checks', 'complete')
      await this.updateRollbackProgress(rollbackId, 2, 8)

      // STEP 2: Get deployment info and backup current state
      await this.updateRollbackStep(rollbackId, 2, 'Backup Current State', 'in_progress')
      const prevDeployment = await this.getDeploymentInfo(previousDeploymentId)
      const projectPath = this.getProjectPath(environment)
      const currentCommit = await this.runSSHCommand(`cd ${projectPath} && git rev-parse HEAD`)
      const currentCommitTrimmed = currentCommit.trim()

      await this.db.query(
        `UPDATE deployment_rollbacks SET previous_commit_hash = $1, new_commit_hash = $2 WHERE id = $3`,
        [prevDeployment.commit_hash, currentCommitTrimmed, rollbackId]
      )

      await this.updateRollbackStep(rollbackId, 2, 'Backup Current State', 'complete')
      await this.updateRollbackProgress(rollbackId, 3, 8)

      // STEP 3: Stop services gracefully
      await this.updateRollbackStep(rollbackId, 3, 'Stop Services', 'in_progress')
      await this.stopServicesGracefully(environment, 30000)
      await this.updateRollbackStep(rollbackId, 3, 'Stop Services', 'complete')
      await this.updateRollbackProgress(rollbackId, 4, 8)

      // STEP 4: Restore previous code
      await this.updateRollbackStep(rollbackId, 4, 'Restore Code', 'in_progress')
      await this.restorePreviousCode(environment, prevDeployment.commit_hash, rollbackId)
      await this.updateRollbackStep(rollbackId, 4, 'Restore Code', 'complete')
      await this.updateRollbackProgress(rollbackId, 5, 8)

      // STEP 5: Restore dependencies
      await this.updateRollbackStep(rollbackId, 5, 'Restore Dependencies', 'in_progress')
      await this.restoreDependencies(environment, rollbackId)
      await this.updateRollbackStep(rollbackId, 5, 'Restore Dependencies', 'complete')
      await this.updateRollbackProgress(rollbackId, 6, 8)

      // STEP 6: Start services
      await this.updateRollbackStep(rollbackId, 6, 'Start Services', 'in_progress')
      await this.startServicesForEnvironment(environment, rollbackId)
      await this.sleep(5000)
      await this.updateRollbackStep(rollbackId, 6, 'Start Services', 'complete')
      await this.updateRollbackProgress(rollbackId, 7, 8)

      // STEP 7: Health checks
      await this.updateRollbackStep(rollbackId, 7, 'Health Checks', 'in_progress')
      const healthResults = await this.checkServiceHealthForEnvironment(environment)
      const allHealthy = healthResults.every((r) => r.healthy)

      if (!allHealthy) {
        const unhealthyServices = healthResults.filter((r) => !r.healthy).map((r) => r.service).join(', ')
        await this.updateRollbackStep(rollbackId, 7, 'Health Checks', 'failed', `Unhealthy services: ${unhealthyServices}`)

        // Auto-rollback the rollback
        await this.logDeploymentRollback(rollbackId, `${envConfig.tag} Services unhealthy after rollback, reverting to ${currentCommitTrimmed}`, 'error')
        await this.restorePreviousCode(environment, currentCommitTrimmed, rollbackId)
        await this.startServicesForEnvironment(environment, rollbackId)
        await this.sleep(5000)

        await this.updateRollbackStatus(rollbackId, 'failed', 7, 8)
        throw new Error(`Services unhealthy after rollback: ${unhealthyServices}`)
      }

      await this.updateRollbackStep(rollbackId, 7, 'Health Checks', 'complete')
      await this.updateRollbackProgress(rollbackId, 8, 8)

      // STEP 8: Verify endpoints
      await this.updateRollbackStep(rollbackId, 8, 'Verify Endpoints', 'in_progress')
      const verification = await this.verifyEndpoints(environment)

      if (!verification.allResponding) {
        const failedEndpoints = verification.results.filter((r) => !r.responding).map((r) => r.endpoint).join(', ')
        await this.updateRollbackStep(rollbackId, 8, 'Verify Endpoints', 'failed', `Failed endpoints: ${failedEndpoints}`)
        await this.updateRollbackStatus(rollbackId, 'failed', 8, 8)

        throw new Error(`Endpoints not responding: ${failedEndpoints}`)
      }

      await this.updateRollbackStep(rollbackId, 8, 'Verify Endpoints', 'complete')

      // Mark rollback as successful
      await this.updateRollbackStatus(rollbackId, 'success', 8, 8)
      await this.logDeploymentRollback(
        rollbackId,
        `${envConfig.tag} Rollback completed successfully to ${previousDeploymentId}`,
        'success'
      )

      // Log audit trail
      await this.db.query(
        `INSERT INTO admin_audit_log (admin_id, action, target_type, target_id, details)
         VALUES ($1, 'deployment_rolled_back', 'deployment', $2, $3)`,
        [
          userId,
          previousDeploymentId,
          JSON.stringify({
            rollback_id: rollbackId,
            environment,
            previous_commit: prevDeployment.commit_hash,
            reason: reason || 'Manual rollback',
          }),
        ]
      )

      // Send notification
      await this.sendNotification(
        rollbackId,
        userId,
        'rolled_back',
        `${envConfig.tag} Deployment rolled back to ${previousDeploymentId}`
      )

      return {
        success: true,
        message: `${envConfig.tag} Successfully rolled back to deployment ${previousDeploymentId}`,
        previousDeploymentId,
        previousCommit: prevDeployment.commit_hash,
        timestamp: new Date(),
        rollbackId,
      }
    } catch (error: any) {
      // Update rollback status to failed
      await this.updateRollbackStatus(rollbackId, 'failed', 0, 8)
      await this.logDeploymentRollback(rollbackId, `${envConfig.tag} Rollback failed: ${error.message}`, 'error')

      // Log audit trail for failure
      await this.db.query(
        `INSERT INTO admin_audit_log (admin_id, action, target_type, target_id, details)
         VALUES ($1, 'deployment_rollback_failed', 'deployment', $2, $3)`,
        [userId, previousDeploymentId, JSON.stringify({ rollback_id: rollbackId, error: error.message })]
      )

      throw error
    }
  }

  /**
   * Get rollback progress
   */
  async getRollbackProgress(rollbackId: string): Promise<RollbackProgress> {
    const result = await this.db.query(
      `SELECT id, status, environment, progress_percent, current_step, total_steps, started_at, completed_at
       FROM deployment_rollbacks WHERE id = $1`,
      [rollbackId]
    )

    if (!result.rows.length) {
      throw new Error('Rollback not found')
    }

    const rollback = result.rows[0]

    // Get steps
    const stepsResult = await this.db.query(
      `SELECT step_number, step_name, status, start_time, end_time, duration_ms, error_message
       FROM deployment_rollback_steps WHERE rollback_id = $1 ORDER BY step_number ASC`,
      [rollbackId]
    )

    const steps = stepsResult.rows.map((row: any) => ({
      number: row.step_number,
      name: row.step_name,
      status: row.status as RollbackStepStatus,
      startTime: row.start_time,
      endTime: row.end_time,
      durationMs: row.duration_ms,
      errorMessage: row.error_message,
    }))

    return {
      rollbackId,
      status: rollback.status as RollbackStatus,
      environment: rollback.environment,
      progress: rollback.progress_percent,
      currentStep: rollback.current_step,
      totalSteps: rollback.total_steps,
      steps,
      startedAt: rollback.started_at,
      completedAt: rollback.completed_at,
    }
  }

  /**
   * Cancel a rollback in progress
   */
  async cancelRollback(rollbackId: string, userId: string): Promise<{ success: boolean; message: string }> {
    const result = await this.db.query(
      `SELECT status, environment FROM deployment_rollbacks WHERE id = $1`,
      [rollbackId]
    )

    if (!result.rows.length) {
      throw new Error('Rollback not found')
    }

    const rollback = result.rows[0]
    const envConfig = this.getEnvConfig(rollback.environment)

    if (rollback.status !== 'in_progress' && rollback.status !== 'pending') {
      throw new Error(`Cannot cancel rollback with status '${rollback.status}'`)
    }

    await this.db.query(`UPDATE deployment_rollbacks SET status = 'cancelled' WHERE id = $1`, [rollbackId])

    await this.logDeploymentRollback(rollbackId, `${envConfig.tag} Rollback cancelled by ${userId}`, 'warn')

    // Log audit trail
    await this.db.query(
      `INSERT INTO admin_audit_log (admin_id, action, target_type, target_id, details)
       VALUES ($1, 'rollback_cancelled', 'deployment', $2, $3)`,
      [userId, rollbackId, JSON.stringify({ cancelled_by: userId })]
    )

    return {
      success: true,
      message: `${envConfig.tag} Rollback cancelled`,
    }
  }

  /**
   * Run safety checks before rollback
   */
  private async runRollbackSafetyChecks(
    rollbackId: string,
    deploymentId: string,
    environment: 'dev' | 'prod'
  ): Promise<RollbackSafetyCheck[]> {
    const checks: RollbackSafetyCheck[] = []

    // Check 1: Previous deployment exists and is successful
    const prevDeployResult = await this.db.query(
      `SELECT status FROM deployments WHERE id = $1`,
      [deploymentId]
    )

    if (!prevDeployResult.rows.length) {
      checks.push({
        checkName: 'Previous Deployment Exists',
        status: 'failed',
        message: 'Previous deployment not found',
      })
    } else if (prevDeployResult.rows[0].status !== 'success') {
      checks.push({
        checkName: 'Previous Deployment Success',
        status: 'failed',
        message: `Cannot rollback to failed deployment (status: ${prevDeployResult.rows[0].status})`,
      })
    } else {
      checks.push({
        checkName: 'Previous Deployment Valid',
        status: 'passed',
        message: 'Previous deployment found and was successful',
      })
    }

    // Check 2: Services are currently responding
    try {
      const healthResults = await this.checkServiceHealthForEnvironment(environment)
      const allHealthy = healthResults.every((r) => r.healthy)

      if (allHealthy) {
        checks.push({
          checkName: 'Current Services Responding',
          status: 'passed',
          message: `All ${healthResults.length} services are currently online`,
        })
      } else {
        checks.push({
          checkName: 'Current Services Responding',
          status: 'warning',
          message: `${healthResults.filter((r) => !r.healthy).length} services are offline`,
        })
      }
    } catch (err: any) {
      checks.push({
        checkName: 'Current Services Responding',
        status: 'warning',
        message: `Could not verify service health: ${err.message.substring(0, 100)}`,
      })
    }

    // Check 3: Disk space available
    try {
      const projectPath = this.getProjectPath(environment)
      const diskOutput = await this.runSSHCommand(`df ${projectPath} | tail -1 | awk '{print $4}'`)
      const availableKb = parseInt(diskOutput.trim())
      const availableGb = availableKb / 1024 / 1024

      if (availableGb > 5) {
        checks.push({
          checkName: 'Disk Space',
          status: 'passed',
          message: `${availableGb.toFixed(2)}GB available disk space`,
        })
      } else {
        checks.push({
          checkName: 'Disk Space',
          status: 'failed',
          message: `Only ${availableGb.toFixed(2)}GB available (need >5GB)`,
        })
      }
    } catch (err: any) {
      checks.push({
        checkName: 'Disk Space',
        status: 'warning',
        message: 'Could not verify disk space',
      })
    }

    // Check 4: Max consecutive rollback limit (2)
    try {
      const consecutiveResult = await this.db.query(
        `SELECT COUNT(*) as count FROM deployments
         WHERE environment = $1 AND status = 'rolled_back'
         AND created_at > NOW() - INTERVAL '24 hours'
         ORDER BY created_at DESC LIMIT 2`,
        [environment]
      )

      const count = parseInt(consecutiveResult.rows[0]?.count) || 0

      if (count >= 2) {
        checks.push({
          checkName: 'Max Consecutive Rollbacks',
          status: 'warning',
          message: `${count} rollbacks in last 24 hours. Consider investigating root cause.`,
          details: `Limit: max 2 consecutive rollbacks for safety`,
        })
      } else {
        checks.push({
          checkName: 'Max Consecutive Rollbacks',
          status: 'passed',
          message: `${count} rollbacks in last 24 hours`,
        })
      }
    } catch (err: any) {
      checks.push({
        checkName: 'Max Consecutive Rollbacks',
        status: 'warning',
        message: 'Could not verify rollback history',
      })
    }

    // Check 5: Backups available
    try {
      const backupResult = await this.db.query(
        `SELECT COUNT(*) as count FROM database_backups
         WHERE created_at > NOW() - INTERVAL '24 hours'`
      )

      if (backupResult.rows[0]?.count > 0) {
        checks.push({
          checkName: 'Database Backups',
          status: 'passed',
          message: `${backupResult.rows[0].count} recent backup(s) available`,
        })
      } else {
        checks.push({
          checkName: 'Database Backups',
          status: 'warning',
          message: 'No recent database backups found',
        })
      }
    } catch (err: any) {
      checks.push({
        checkName: 'Database Backups',
        status: 'warning',
        message: 'Could not verify backups',
      })
    }

    // Store checks in database
    for (const check of checks) {
      await this.db.query(
        `INSERT INTO deployment_rollback_checks (rollback_id, check_name, status, message, details)
         VALUES ($1, $2, $3, $4, $5)`,
        [rollbackId, check.checkName, check.status, check.message, check.details || null]
      )
    }

    return checks
  }

  /**
   * Stop services gracefully with timeout
   */
  private async stopServicesGracefully(environment: 'dev' | 'prod', timeoutMs: number): Promise<void> {
    const envConfig = this.getEnvConfig(environment)

    await this.logDeploymentRollback(
      'temp',
      `${envConfig.tag} Stopping services with ${timeoutMs}ms grace period...`,
      'info'
    )

    try {
      await this.runSSHCommand(`pm2 stop ${envConfig.ecosystemConfig}`, timeoutMs)
      await this.sleep(2000)
    } catch (err) {
      await this.logDeploymentRollback('temp', `${envConfig.tag} Warning: graceful stop timed out, forcing delete`, 'warn')
      try {
        await this.runSSHCommand(`pm2 delete ${envConfig.ecosystemConfig}`, 10000)
      } catch (killErr) {
        await this.logDeploymentRollback('temp', `${envConfig.tag} Warning: could not delete PM2 processes`, 'warn')
      }
    }
  }

  /**
   * Restore previous code from git
   */
  private async restorePreviousCode(environment: 'dev' | 'prod', commitHash: string, rollbackId?: string): Promise<void> {
    const envConfig = this.getEnvConfig(environment)
    const projectPath = this.getProjectPath(environment)

    await this.runSSHCommand(
      `cd ${projectPath} && git fetch origin && git checkout ${commitHash}`
    )

    await this.runSSHCommand(
      `cd ${projectPath} && git reset --hard ${commitHash}`
    )

    await this.logDeploymentRollback(rollbackId || 'temp', `${envConfig.tag} Restored code to commit ${commitHash}`, 'info')
  }

  /**
   * Restore dependencies
   */
  private async restoreDependencies(environment: 'dev' | 'prod', rollbackId?: string): Promise<void> {
    const envConfig = this.getEnvConfig(environment)
    const projectPath = this.getProjectPath(environment)
    const services = ['', 'services/game-gateway', 'services/admin-service']

    for (const svc of services) {
      const svcPath = svc ? `${projectPath}/${svc}` : projectPath
      const svcName = svc || 'root'

      await this.runSSHCommand(`cd ${svcPath} && npm install --production=false 2>&1`)
    }

    await this.logDeploymentRollback(rollbackId || 'temp', `${envConfig.tag} Dependencies restored`, 'info')
  }

  /**
   * Start services for environment
   */
  private async startServicesForEnvironment(environment: 'dev' | 'prod', rollbackId?: string): Promise<void> {
    const envConfig = this.getEnvConfig(environment)
    const projectPath = this.getProjectPath(environment)

    await this.runSSHCommand(`pm2 delete ${envConfig.ecosystemConfig} || true`)
    await this.runSSHCommand(
      `cd ${projectPath} && pm2 start ${envConfig.ecosystemConfig} && pm2 save`
    )

    await this.logDeploymentRollback(rollbackId || 'temp', `${envConfig.tag} Services started with ${envConfig.ecosystemConfig}`, 'info')
  }

  /**
   * Verify all endpoints are responding
   */
  private async verifyEndpoints(
    environment: 'dev' | 'prod'
  ): Promise<{ allResponding: boolean; results: Array<{ endpoint: string; responding: boolean; status?: number }> }> {
    const envConfig = this.getEnvConfig(environment)
    const p = envConfig.ports

    const endpoints = [
      `http://127.0.0.1:${p.coreApi}/health`,
      `http://127.0.0.1:${p.gateway}/health`,
      `http://127.0.0.1:${p.admin}/health`,
      `http://127.0.0.1:${p.wallet}/health`,
    ]

    const results = []

    for (const endpoint of endpoints) {
      try {
        const response = await axios.get(endpoint, { timeout: 5000 })
        results.push({
          endpoint,
          responding: response.status === 200,
          status: response.status,
        })
      } catch (err: any) {
        results.push({
          endpoint,
          responding: false,
          status: err.response?.status,
        })
      }
    }

    const allResponding = results.every((r) => r.responding)

    return {
      allResponding,
      results,
    }
  }

  /**
   * Get deployment info
   */
  private async getDeploymentInfo(deploymentId: string): Promise<any> {
    const result = await this.db.query(
      `SELECT id, commit_hash, status, branch FROM deployments WHERE id = $1`,
      [deploymentId]
    )

    if (!result.rows.length) {
      throw new Error('Deployment not found')
    }

    return result.rows[0]
  }

  /**
   * Update rollback status
   */
  private async updateRollbackStatus(
    rollbackId: string,
    status: RollbackStatus,
    currentStep: number,
    totalSteps: number
  ): Promise<void> {
    const progressPercent = Math.round((currentStep / totalSteps) * 100)

    await this.db.query(
      `UPDATE deployment_rollbacks
       SET status = $1, current_step = $2, progress_percent = $3, updated_at = NOW()
       ${status === 'in_progress' ? ', started_at = COALESCE(started_at, NOW())' : ''}
       ${['success', 'failed', 'cancelled'].includes(status) ? ', completed_at = NOW()' : ''}
       WHERE id = $4`,
      [status, currentStep, progressPercent, rollbackId]
    )
  }

  /**
   * Update rollback progress
   */
  private async updateRollbackProgress(rollbackId: string, currentStep: number, totalSteps: number): Promise<void> {
    const progressPercent = Math.round((currentStep / totalSteps) * 100)

    await this.db.query(
      `UPDATE deployment_rollbacks
       SET current_step = $1, progress_percent = $2, status = 'in_progress', started_at = COALESCE(started_at, NOW())
       WHERE id = $3`,
      [currentStep, progressPercent, rollbackId]
    )
  }

  /**
   * Update rollback step
   */
  private async updateRollbackStep(
    rollbackId: string,
    stepNumber: number,
    stepName: string,
    status: RollbackStepStatus,
    errorMessage?: string
  ): Promise<void> {
    const startTime = new Date()

    // Check if step exists
    const existingResult = await this.db.query(
      `SELECT id FROM deployment_rollback_steps WHERE rollback_id = $1 AND step_number = $2`,
      [rollbackId, stepNumber]
    )

    if (existingResult.rows.length > 0) {
      if (status === 'complete' || status === 'failed') {
        const endTime = new Date()
        const durationMs = endTime.getTime() - startTime.getTime()

        await this.db.query(
          `UPDATE deployment_rollback_steps
           SET status = $1, end_time = $2, duration_ms = $3, error_message = $4
           WHERE rollback_id = $5 AND step_number = $6`,
          [status, endTime, durationMs, errorMessage || null, rollbackId, stepNumber]
        )
      } else {
        await this.db.query(
          `UPDATE deployment_rollback_steps
           SET status = $1, start_time = $2, error_message = $3
           WHERE rollback_id = $4 AND step_number = $5`,
          [status, status === 'in_progress' ? startTime : null, errorMessage || null, rollbackId, stepNumber]
        )
      }
    } else {
      await this.db.query(
        `INSERT INTO deployment_rollback_steps (rollback_id, step_number, step_name, status, start_time, error_message)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [rollbackId, stepNumber, stepName, status, status === 'in_progress' ? startTime : null, errorMessage || null]
      )
    }
  }

  /**
   * Log rollback message to deployment_logs
   */
  private async logDeploymentRollback(rollbackId: string, message: string, level: LogLevel): Promise<void> {
    try {
      if (rollbackId !== 'temp') {
        await this.db.query(
          `INSERT INTO deployment_logs (deployment_id, message, level, created_at)
           VALUES ($1, $2, $3, NOW())`,
          [rollbackId, message, level]
        )
      }
    } catch (err) {
      console.error(`Failed to log rollback message: ${err}`)
    }
  }

  /**
   * Helper: sleep utility
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
}

/**
 * Create and export a singleton instance
 */
export function createDeploymentService(db: Pool, notificationUrl?: string): DeploymentService {
  return new DeploymentService(db, notificationUrl)
}

/**
 * Export types for use in other modules
 */
export type {
  SafetyCheckResult,
  SafetyChecksResponse,
  RollbackProgress,
  RollbackSafetyCheck,
  RollbackStatus,
  RollbackStepStatus,
  SafetyCheckStatus,
}
