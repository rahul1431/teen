import { FastifyInstance } from 'fastify'
import { Pool } from 'pg'
import { z } from 'zod'
import { DeploymentService } from './services/deployment.service'
import { randomUUID } from 'crypto'

export async function registerDeploymentRoutes(
  app: FastifyInstance,
  db: Pool,
  authenticate: any,
  requireRole: any,
  requireDevAdmin?: any
) {
  const notificationUrl = process.env.NOTIFICATION_SERVICE_URL || 'http://127.0.0.1:3001'
  const deploymentService = new DeploymentService(db, notificationUrl)

  // Use requireDevAdmin if provided, otherwise fallback
  const deploymentAccess = requireDevAdmin || requireRole('DevAdmin')

  // A git branch name interpolated into shell/ssh commands must be restricted
  // to a safe subset. Length checks alone let shell metacharacters through.
  const branchName = z
    .string()
    .min(1)
    .max(255)
    .regex(/^[A-Za-z0-9._/-]+$/, 'Invalid branch name')
    .refine((b) => !b.startsWith('-') && !b.includes('..') && !b.includes('//'), 'Invalid branch name')

  /**
   * POST /api/dev/deploy
   * Trigger a deployment (prod or dev)
   * Requires: DevAdmin or superadmin role (sensitive operation)
   * Body: { branch, commit_hash, environment?: 'dev'|'prod' }
   * Defaults to 'prod' if environment not specified (backwards compatible)
   */
  app.post(
    '/api/admin/dev/deploy',
    { onRequest: [authenticate, deploymentAccess] },
    async (req, reply) => {
      try {
        const body = z
          .object({
            branch: branchName,
            commit_hash: z.string().min(7).max(40),
            environment: z.enum(['dev', 'prod']).default('prod'),
          })
          .parse(req.body)

        const me = (req.user as any)?.sub
        if (!me) {
          return reply.code(401).send({ error: 'Unauthorized' })
        }

        // Run safety checks before deployment
        const safetyResults = await deploymentService.runSafetyChecks(body.branch, body.environment)

        if (!safetyResults.passed) {
          // Log failed safety check attempt
          await db.query(
            `INSERT INTO admin_audit_log (admin_id, action, target_type, details)
             VALUES ($1, 'deployment_blocked_safety_check', 'deployment', $2)`,
            [
              me,
              JSON.stringify({
                branch: body.branch,
                environment: body.environment,
                failures: safetyResults.blockingFailures,
              }),
            ]
          )

          return reply.code(400).send({
            success: false,
            error: 'Deployment blocked: safety checks failed',
            environment: body.environment,
            safety_checks: safetyResults,
          })
        }

        // Generate job ID
        const jobId = randomUUID()

        // Create deployment record
        await db.query(
          `INSERT INTO deployments (id, status, branch, commit_hash, created_by, environment)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [jobId, 'queued', body.branch, body.commit_hash, me, body.environment]
        )

        // Log audit trail
        await db.query(
          `INSERT INTO admin_audit_log (admin_id, action, target_type, target_id, details)
           VALUES ($1, 'deployment_triggered', 'deployment', $2, $3)`,
          [
            me,
            jobId,
            JSON.stringify({
              branch: body.branch,
              commit_hash: body.commit_hash,
              environment: body.environment,
            }),
          ]
        )

        // Start deployment asynchronously
        const result = await deploymentService.deployToEnvironment(
          jobId,
          body.branch,
          body.commit_hash,
          body.environment,
          me
        )

        return reply.code(202).send({
          success: true,
          job_id: result.jobId,
          environment: result.environment,
          tag: result.tag,
          message: `${result.tag} Deployment queued. Poll /api/admin/dev/deployment-status/${result.jobId} for progress`,
          safety_checks: safetyResults,
        })
      } catch (err: any) {
        if (err instanceof z.ZodError) {
          return reply.code(400).send({ error: 'Invalid request', details: err.errors })
        }
        return reply.code(500).send({ error: err.message || 'Deployment failed' })
      }
    }
  )

  /**
   * POST /api/dev/deployment-safety-check
   * Check if deployment is safe without actually deploying
   * Requires: DevAdmin or superadmin role
   * Body: { branch, environment?: 'dev'|'prod' }
   */
  app.post(
    '/api/admin/dev/deployment-safety-check',
    { onRequest: [authenticate, deploymentAccess] },
    async (req, reply) => {
      try {
        const body = z
          .object({
            branch: branchName,
            environment: z.enum(['dev', 'prod']).default('prod'),
          })
          .parse(req.body)

        const safetyResults = await deploymentService.runSafetyChecks(body.branch, body.environment)

        return reply.send({
          success: true,
          safe_to_deploy: safetyResults.passed,
          environment: body.environment,
          safety_checks: safetyResults,
        })
      } catch (err: any) {
        if (err instanceof z.ZodError) {
          return reply.code(400).send({ error: 'Invalid request', details: err.errors })
        }
        return reply.code(500).send({ error: err.message || 'Safety check failed' })
      }
    }
  )

  /**
   * GET /api/dev/deployment/safety-check/:env
   * Run environment-specific safety checks
   * Query params: branch (optional - if provided, includes git checks)
   * Requires: DevAdmin or superadmin role (runs commands against the VPS)
   */
  app.get(
    '/api/admin/dev/deployment/safety-check/:env',
    { onRequest: [authenticate, deploymentAccess] },
    async (req, reply) => {
      try {
        const { env } = req.params as any
        const branch = branchName.parse((req.query as any).branch ?? 'feature/deploy-check')

        if (!['dev', 'prod'].includes(env)) {
          return reply.code(400).send({ error: 'Invalid environment. Must be dev or prod.' })
        }

        const safetyResults = await deploymentService.runSafetyChecks(branch, env as 'dev' | 'prod')

        return reply.send({
          success: true,
          environment: env,
          passed: safetyResults.passed,
          checks: safetyResults.checks,
          blocking_issues: safetyResults.blockingFailures,
          warnings: safetyResults.warnings,
        })
      } catch (err: any) {
        if (err instanceof z.ZodError) {
          return reply.code(400).send({ error: 'Invalid request', details: err.errors })
        }
        return reply.code(500).send({ error: err.message || 'Safety check failed' })
      }
    }
  )

  /**
   * GET /api/admin/dev/deployment-status/:jobId
   * Poll deployment progress
   * Accessible to any authenticated admin
   */
  app.get(
    '/api/admin/dev/deployment-status/:jobId',
    { onRequest: [authenticate] },
    async (req, reply) => {
      try {
        const { jobId } = req.params as any

        if (!jobId || jobId.length < 10) {
          return reply.code(400).send({ error: 'Invalid job ID' })
        }

        const status = await deploymentService.getDeploymentStatus(jobId)
        return reply.send(status)
      } catch (err: any) {
        if (err.message.includes('not found')) {
          return reply.code(404).send({ error: 'Deployment not found' })
        }
        return reply.code(500).send({ error: err.message })
      }
    }
  )

  /**
   * GET /api/dev/deployments
   * List recent deployments (supports optional environment filter)
   * Accessible to all authenticated admins (read-only)
   * Query: limit, offset, environment (optional: 'dev'|'prod')
   */
  app.get(
    '/api/admin/dev/deployments',
    { onRequest: [authenticate] },
    async (req, reply) => {
      try {
        const { limit = '20', offset = '0', environment } = req.query as any
        const limitNum = Math.min(parseInt(limit) || 20, 100) // Cap at 100
        const offsetNum = Math.max(parseInt(offset) || 0, 0)

        let query = `SELECT id, status, branch, commit_hash, created_by, started_at, completed_at,
                            rollback_from, environment, created_at
                     FROM deployments`
        const params: any[] = []

        if (environment && ['dev', 'prod'].includes(environment)) {
          query += ` WHERE environment = $1`
          params.push(environment)
          query += ` ORDER BY created_at DESC LIMIT $2 OFFSET $3`
          params.push(limitNum, offsetNum)
        } else {
          query += ` ORDER BY created_at DESC LIMIT $1 OFFSET $2`
          params.push(limitNum, offsetNum)
        }

        const result = await db.query(query, params)
        return reply.send(result.rows)
      } catch (err: any) {
        return reply.code(500).send({ error: err.message })
      }
    }
  )

  /**
   * GET /api/dev/deployment-logs/:jobId
   * Get detailed logs for a deployment
   * Accessible to any authenticated admin
   */
  app.get(
    '/api/admin/dev/deployment-logs/:jobId',
    { onRequest: [authenticate] },
    async (req, reply) => {
      try {
        const { jobId } = req.params as any

        if (!jobId || jobId.length < 10) {
          return reply.code(400).send({ error: 'Invalid job ID' })
        }

        const result = await db.query(
          `SELECT message, level, created_at FROM deployment_logs
           WHERE deployment_id = $1 ORDER BY created_at ASC`,
          [jobId]
        )

        return reply.send({
          job_id: jobId,
          logs: result.rows,
          log_count: result.rows.length,
        })
      } catch (err: any) {
        return reply.code(500).send({ error: err.message })
      }
    }
  )

  /**
   * POST /api/admin/dev/deployment-status/:jobId/cancel
   * Cancel a queued deployment (only if status is 'queued')
   * Requires: DevAdmin or superadmin role
   */
  app.post(
    '/api/admin/dev/deployment-status/:jobId/cancel',
    { onRequest: [authenticate, deploymentAccess] },
    async (req, reply) => {
      try {
        const me = (req.user as any)?.sub
        const { jobId } = req.params as any

        if (!jobId || jobId.length < 10) {
          return reply.code(400).send({ error: 'Invalid job ID' })
        }

        // Check current status
        const result = await db.query('SELECT status FROM deployments WHERE id = $1', [jobId])

        if (!result.rows.length) {
          return reply.code(404).send({ error: 'Deployment not found' })
        }

        if (result.rows[0].status !== 'queued') {
          return reply
            .code(400)
            .send({ error: `Cannot cancel deployment in status '${result.rows[0].status}'` })
        }

        // Update status
        await db.query(
          `UPDATE deployments SET status = 'failed', completed_at = NOW() WHERE id = $1`,
          [jobId]
        )

        // Log cancellation
        await db.query(
          `INSERT INTO admin_audit_log (admin_id, action, target_type, target_id, details)
           VALUES ($1, 'deployment_cancelled', 'deployment', $2, $3)`,
          [me, jobId, JSON.stringify({ cancelled_by: me })]
        )

        await deploymentService.logDeployment(jobId, 'Deployment cancelled by admin', 'warn')

        return reply.send({ success: true, message: 'Deployment cancelled' })
      } catch (err: any) {
        return reply.code(500).send({ error: err.message })
      }
    }
  )

  /**
   * GET /api/dev/deployment-health
   * Quick health check to verify deployment infrastructure
   * Accessible to any authenticated admin
   */
  app.get(
    '/api/admin/dev/deployment-health',
    { onRequest: [authenticate] },
    async (_req, reply) => {
      try {
        // Check database connectivity
        const dbCheck = await db.query('SELECT 1')

        // Check SSH key exists
        const fs = await import('fs')
        const keyPath = process.env.SSH_KEY_PATH || '/root/.ssh/id_ed25519'
        const sshKeyExists = fs.existsSync(keyPath)

        return reply.send({
          status: 'healthy',
          database: dbCheck.rows.length > 0 ? 'connected' : 'failed',
          ssh_key: sshKeyExists ? 'present' : 'missing',
          vps_host: process.env.VPS_HOST || '64.204.130.181',
          warnings: sshKeyExists ? [] : ['SSH key not found at ' + keyPath],
        })
      } catch (err: any) {
        return reply.code(500).send({
          status: 'unhealthy',
          error: err.message,
        })
      }
    }
  )

  /**
   * POST /api/dev/rollback/:deploymentId
   * Rollback to a previous deployment (supports environment checking)
   * Requires: DevAdmin or superadmin role (git reset --hard + pm2 restart on the VPS)
   */
  app.post(
    '/api/admin/dev/rollback/:deploymentId',
    { onRequest: [authenticate, deploymentAccess] },
    async (req, reply) => {
      try {
        const me = (req.user as any)?.sub
        const { deploymentId } = req.params as any

        if (!me) {
          return reply.code(401).send({ error: 'Unauthorized' })
        }

        if (!deploymentId || deploymentId.length < 10) {
          return reply.code(400).send({ error: 'Invalid deployment ID' })
        }

        // Get deployment environment info for logging
        const deploymentResult = await db.query(
          `SELECT environment FROM deployments WHERE id = $1`,
          [deploymentId]
        )
        const environment = deploymentResult.rows[0]?.environment || 'prod'

        // Perform the rollback
        const result = await deploymentService.rollbackDeployment(deploymentId, me)

        // Log rollback with environment
        await db.query(
          `INSERT INTO admin_audit_log (admin_id, action, target_type, target_id, details)
           VALUES ($1, 'deployment_rolled_back', 'deployment', $2, $3)`,
          [
            me,
            deploymentId,
            JSON.stringify({
              environment,
              previous_commit: result.previousCommit,
              timestamp: result.timestamp,
            }),
          ]
        )

        return reply.code(200).send({
          success: result.success,
          message: result.message,
          environment,
          previous_deployment_id: result.previousDeploymentId,
          previous_commit: result.previousCommit,
          timestamp: result.timestamp,
        })
      } catch (err: any) {
        if (err.message.includes('not found')) {
          return reply.code(404).send({ error: 'Deployment not found' })
        }
        if (err.message.includes('Cannot rollback')) {
          return reply.code(400).send({ error: err.message })
        }
        if (err.message.includes('failed') || err.message.includes('Rollback failed')) {
          return reply.code(500).send({ error: err.message })
        }
        return reply.code(500).send({ error: err.message || 'Rollback failed' })
      }
    }
  )

  /**
   * POST /api/dev/deploy/dev
   * Trigger a deployment to DEV environment
   * Convenience endpoint for dev-specific deployments
   * Requires: DevAdmin or superadmin role
   */
  app.post(
    '/api/admin/dev/deploy/dev',
    { onRequest: [authenticate, deploymentAccess] },
    async (req, reply) => {
      try {
        const body = z
          .object({
            branch: branchName,
            commit_hash: z.string().min(7).max(40),
          })
          .parse(req.body)

        const me = (req.user as any)?.sub
        if (!me) {
          return reply.code(401).send({ error: 'Unauthorized' })
        }

        const safetyResults = await deploymentService.runSafetyChecks(body.branch, 'dev')
        if (!safetyResults.passed) {
          return reply.code(400).send({
            success: false,
            error: 'Deployment blocked: safety checks failed',
            environment: 'dev',
            safety_checks: safetyResults,
          })
        }

        const jobId = randomUUID()
        await db.query(
          `INSERT INTO deployments (id, status, branch, commit_hash, created_by, environment)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [jobId, 'queued', body.branch, body.commit_hash, me, 'dev']
        )

        const result = await deploymentService.deployToEnvironment(
          jobId,
          body.branch,
          body.commit_hash,
          'dev',
          me
        )

        return reply.code(202).send({
          success: true,
          job_id: result.jobId,
          environment: 'dev',
          message: '[DEV] Deployment queued',
          safety_checks: safetyResults,
        })
      } catch (err: any) {
        if (err instanceof z.ZodError) {
          return reply.code(400).send({ error: 'Invalid request', details: err.errors })
        }
        return reply.code(500).send({ error: err.message || 'Deployment failed' })
      }
    }
  )

  /**
   * POST /api/dev/deploy/prod
   * Trigger a deployment to PROD environment
   * Convenience endpoint for prod-specific deployments
   * Requires: DevAdmin or superadmin role
   */
  app.post(
    '/api/admin/dev/deploy/prod',
    { onRequest: [authenticate, deploymentAccess] },
    async (req, reply) => {
      try {
        const body = z
          .object({
            branch: branchName,
            commit_hash: z.string().min(7).max(40),
          })
          .parse(req.body)

        const me = (req.user as any)?.sub
        if (!me) {
          return reply.code(401).send({ error: 'Unauthorized' })
        }

        const safetyResults = await deploymentService.runSafetyChecks(body.branch, 'prod')
        if (!safetyResults.passed) {
          return reply.code(400).send({
            success: false,
            error: 'Deployment blocked: safety checks failed',
            environment: 'prod',
            safety_checks: safetyResults,
          })
        }

        const jobId = randomUUID()
        await db.query(
          `INSERT INTO deployments (id, status, branch, commit_hash, created_by, environment)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [jobId, 'queued', body.branch, body.commit_hash, me, 'prod']
        )

        const result = await deploymentService.deployToEnvironment(
          jobId,
          body.branch,
          body.commit_hash,
          'prod',
          me
        )

        return reply.code(202).send({
          success: true,
          job_id: result.jobId,
          environment: 'prod',
          message: '[PROD] Deployment queued',
          safety_checks: safetyResults,
        })
      } catch (err: any) {
        if (err instanceof z.ZodError) {
          return reply.code(400).send({ error: 'Invalid request', details: err.errors })
        }
        return reply.code(500).send({ error: err.message || 'Deployment failed' })
      }
    }
  )

  /**
   * GET /api/dev/deployments/environment/:env
   * List deployments filtered by environment
   * Query: limit, offset
   */
  app.get(
    '/api/admin/dev/deployments/environment/:env',
    { onRequest: [authenticate] },
    async (req, reply) => {
      try {
        const { env } = req.params as any
        const { limit = '20', offset = '0' } = req.query as any

        if (!['dev', 'prod'].includes(env)) {
          return reply.code(400).send({ error: 'Invalid environment. Must be dev or prod.' })
        }

        const limitNum = Math.min(parseInt(limit) || 20, 100)
        const offsetNum = Math.max(parseInt(offset) || 0, 0)

        const result = await db.query(
          `SELECT id, status, branch, commit_hash, created_by, started_at, completed_at,
                   rollback_from, environment, created_at
            FROM deployments
            WHERE environment = $1
            ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
          [env, limitNum, offsetNum]
        )

        return reply.send({
          environment: env,
          deployments: result.rows,
          count: result.rows.length,
        })
      } catch (err: any) {
        return reply.code(500).send({ error: err.message })
      }
    }
  )

  /**
   * GET /api/dev/deployment-config/:env
   * Get environment configuration for deployment UI
   * Returns port information and database config
   */
  app.get(
    '/api/admin/dev/deployment-config/:env',
    { onRequest: [authenticate] },
    async (req, reply) => {
      try {
        const { env } = req.params as any

        if (!['dev', 'prod'].includes(env)) {
          return reply.code(400).send({ error: 'Invalid environment. Must be dev or prod.' })
        }

        const configs: Record<string, any> = {
          dev: {
            name: 'Development',
            environment: 'dev',
            database: 'teen_db_dev',
            redis_port: 6380,
            ports: {
              core_api: 3201,
              wallet: 3203,
              gateway: 3204,
              gateway_alt1: 3221,
              gateway_alt2: 3222,
              aviator: 3205,
              ludo: 3211,
              tp_engine: 3210,
              admin: 3208,
              monitoring: 3217,
              risk: 3206,
              churn: 3213,
              churn_ml: 3220,
              app_monitor: 3215,
            },
            ecosystem_config: 'ecosystem.config.dev.js',
            env_file: '.env.dev',
          },
          prod: {
            name: 'Production',
            environment: 'prod',
            database: 'teen_db_prod',
            redis_port: 6379,
            ports: {
              core_api: 3001,
              wallet: 3003,
              gateway: 3004,
              gateway_alt1: 3021,
              gateway_alt2: 3022,
              aviator: 3005,
              ludo: 3011,
              tp_engine: 3010,
              admin: 3008,
              monitoring: 3017,
              risk: 3006,
              churn: 3013,
              churn_ml: 3020,
              app_monitor: 3015,
            },
            ecosystem_config: 'ecosystem.config.js',
            env_file: '.env',
          },
        }

        return reply.send(configs[env])
      } catch (err: any) {
        return reply.code(500).send({ error: err.message })
      }
    }
  )

  /**
   * POST /api/dev/rollback/:deploymentId/environment/:env
   * Initiate rollback to a previous deployment with environment awareness
   * Requires: DevAdmin role
   * Supports full progress tracking and safety checks
   */
  app.post(
    '/api/admin/dev/rollback/:deploymentId/environment/:env',
    { onRequest: [authenticate, deploymentAccess] },
    async (req, reply) => {
      try {
        const me = (req.user as any)?.sub
        const { deploymentId, env } = req.params as any
        const { reason } = req.body as any

        if (!me) {
          return reply.code(401).send({ error: 'Unauthorized' })
        }

        if (!deploymentId || deploymentId.length < 10) {
          return reply.code(400).send({ error: 'Invalid deployment ID' })
        }

        if (!['dev', 'prod'].includes(env)) {
          return reply.code(400).send({ error: 'Invalid environment. Must be dev or prod.' })
        }

        // For prod, require explicit double confirmation
        const { confirmRollback, doubleConfirm } = req.body as any

        if (env === 'prod' && (!confirmRollback || !doubleConfirm)) {
          return reply.code(400).send({
            error: 'Production rollback requires double confirmation',
            required_fields: ['confirmRollback', 'doubleConfirm'],
          })
        }

        // Perform rollback with environment
        const result = await deploymentService.rollbackDeploymentWithEnvironment(
          deploymentId,
          env as 'dev' | 'prod',
          me,
          reason
        )

        return reply.code(202).send({
          success: result.success,
          message: result.message,
          rollback_id: result.rollbackId,
          deployment_id: result.previousDeploymentId,
          previous_commit: result.previousCommit,
          environment: env,
          timestamp: result.timestamp,
        })
      } catch (err: any) {
        if (err.message.includes('not found')) {
          return reply.code(404).send({ error: 'Deployment not found' })
        }
        if (err.message.includes('Cannot rollback') || err.message.includes('Safety checks failed')) {
          return reply.code(400).send({ error: err.message })
        }
        if (err.message.includes('failed') || err.message.includes('Rollback failed')) {
          return reply.code(500).send({ error: err.message })
        }
        return reply.code(500).send({ error: err.message || 'Rollback failed' })
      }
    }
  )

  /**
   * GET /api/dev/rollback/:rollbackId/progress
   * Check rollback progress and step-by-step status
   * Accessible to any authenticated admin
   */
  app.get(
    '/api/admin/dev/rollback/:rollbackId/progress',
    { onRequest: [authenticate] },
    async (req, reply) => {
      try {
        const { rollbackId } = req.params as any

        if (!rollbackId || rollbackId.length < 10) {
          return reply.code(400).send({ error: 'Invalid rollback ID' })
        }

        const progress = await deploymentService.getRollbackProgress(rollbackId)

        return reply.send({
          rollback_id: progress.rollbackId,
          status: progress.status,
          environment: progress.environment,
          progress_percent: progress.progress,
          current_step: progress.currentStep,
          total_steps: progress.totalSteps,
          steps: progress.steps.map((step) => ({
            number: step.number,
            name: step.name,
            status: step.status,
            start_time: step.startTime,
            end_time: step.endTime,
            duration_ms: step.durationMs,
            error_message: step.errorMessage,
          })),
          started_at: progress.startedAt,
          completed_at: progress.completedAt,
        })
      } catch (err: any) {
        if (err.message.includes('not found')) {
          return reply.code(404).send({ error: 'Rollback not found' })
        }
        return reply.code(500).send({ error: err.message })
      }
    }
  )

  /**
   * POST /api/dev/rollback/:rollbackId/cancel
   * Cancel a rollback in progress
   * Requires: DevAdmin role
   */
  app.post(
    '/api/admin/dev/rollback/:rollbackId/cancel',
    { onRequest: [authenticate, deploymentAccess] },
    async (req, reply) => {
      try {
        const me = (req.user as any)?.sub
        const { rollbackId } = req.params as any

        if (!me) {
          return reply.code(401).send({ error: 'Unauthorized' })
        }

        if (!rollbackId || rollbackId.length < 10) {
          return reply.code(400).send({ error: 'Invalid rollback ID' })
        }

        const result = await deploymentService.cancelRollback(rollbackId, me)

        return reply.send({
          success: result.success,
          message: result.message,
        })
      } catch (err: any) {
        if (err.message.includes('not found')) {
          return reply.code(404).send({ error: 'Rollback not found' })
        }
        if (err.message.includes('Cannot cancel')) {
          return reply.code(400).send({ error: err.message })
        }
        return reply.code(500).send({ error: err.message })
      }
    }
  )

  /**
   * GET /api/dev/rollback-checks/:rollbackId
   * Get safety check results for a rollback
   * Accessible to any authenticated admin
   */
  app.get(
    '/api/admin/dev/rollback-checks/:rollbackId',
    { onRequest: [authenticate] },
    async (req, reply) => {
      try {
        const { rollbackId } = req.params as any

        if (!rollbackId || rollbackId.length < 10) {
          return reply.code(400).send({ error: 'Invalid rollback ID' })
        }

        const result = await db.query(
          `SELECT check_name, status, message, details, created_at
           FROM deployment_rollback_checks
           WHERE rollback_id = $1
           ORDER BY created_at ASC`,
          [rollbackId]
        )

        return reply.send({
          rollback_id: rollbackId,
          checks: result.rows.map((row: any) => ({
            check_name: row.check_name,
            status: row.status,
            message: row.message,
            details: row.details,
            created_at: row.created_at,
          })),
          check_count: result.rows.length,
          passed_count: result.rows.filter((r: any) => r.status === 'passed').length,
          failed_count: result.rows.filter((r: any) => r.status === 'failed').length,
          warning_count: result.rows.filter((r: any) => r.status === 'warning').length,
        })
      } catch (err: any) {
        return reply.code(500).send({ error: err.message })
      }
    }
  )
}
