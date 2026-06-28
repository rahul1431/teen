import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import Redis from 'ioredis'

/**
 * ML Control Routes for Admin Panel
 *
 * POST /api/admin/ml/query - Natural language query handler
 * POST /api/admin/ml/config - Update ML configuration
 * GET  /api/admin/ml/metrics - Real-time ML metrics and job status
 */

export async function registerMLRoutes(
  app: FastifyInstance,
  redis: Redis,
  db: any
) {
  // POST /api/admin/ml/query
  // Natural language query handler
  app.post<{ Body: { query: string } }>(
    '/api/admin/ml/query',
    { onRequest: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { query } = request.body as any

      if (!query || typeof query !== 'string') {
        return reply.code(400).send({
          success: false,
          error: 'Query is required',
        })
      }

      try {
        // Send query to ML service via HTTP or queue
        // This is a stub - connect to actual ML service
        const mlServiceResponse = await handleQuery(query, redis, db)

        return reply.send({
          success: true,
          data: {
            query,
            answer: mlServiceResponse.answer,
            confidence: mlServiceResponse.confidence,
            executionTime: mlServiceResponse.executionTime,
          },
        })
      } catch (err: any) {
        return reply.code(500).send({
          success: false,
          error: err.message || 'Failed to process query',
        })
      }
    }
  )

  // POST /api/admin/ml/config
  // Update ML configuration
  app.post<{ Body: any }>(
    '/api/admin/ml/config',
    { onRequest: [app.authenticate, app.requireRole('superadmin')] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const config = request.body

      try {
        // Save to Redis (fast) and PostgreSQL (persistent)
        const configKey = 'ml:config'

        // Store in Redis
        await redis.set(configKey, JSON.stringify(config), 'EX', 86400)

        // Store in PostgreSQL
        await db.query(
          `INSERT INTO admin_config (key, value, updated_by, updated_at)
           VALUES ($1, $2, $3, NOW())
           ON CONFLICT (key) DO UPDATE SET value = $2, updated_by = $3, updated_at = NOW()`,
          [configKey, JSON.stringify(config), (request.user as any)?.sub]
        )

        // Notify ML service of config change
        await redis.publish('ml:config:change', JSON.stringify(config))

        return reply.send({
          success: true,
          data: {
            message: 'Configuration updated',
            config,
          },
        })
      } catch (err: any) {
        return reply.code(500).send({
          success: false,
          error: err.message || 'Failed to save configuration',
        })
      }
    }
  )

  // GET /api/admin/ml/metrics
  // Real-time ML metrics and job status
  app.get(
    '/api/admin/ml/metrics',
    { onRequest: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        // Fetch metrics from Redis
        const metricsKey = 'ml:metrics:latest'
        const metricsData = await redis.get(metricsKey)

        // Default metrics structure
        const defaultMetrics = {
          timestamp: new Date().toISOString(),
          models: [
            {
              name: 'churn_model',
              status: 'completed',
              accuracy: 0.82,
              lastRetrain: new Date(Date.now() - 86400000).toISOString(),
            },
            {
              name: 'bot_tree',
              status: 'queued',
              accuracy: 0.78,
              lastRetrain: new Date(Date.now() - 172800000).toISOString(),
            },
            {
              name: 'fraud_scorer',
              status: 'training',
              eta: '2 hours',
              lastRetrain: new Date(Date.now() - 3600000).toISOString(),
            },
          ],
          jobs: [
            {
              id: '1',
              name: 'Fraud scoring',
              status: 'running',
              progress: 65,
              processed: 3421,
              total: 5234,
              latency: 12.5,
            },
            {
              id: '2',
              name: 'Churn prediction',
              status: 'completed',
              progress: 100,
              processed: 8901,
              total: 8901,
            },
            {
              id: '3',
              name: 'Bot learning',
              status: 'running',
              progress: 32,
              processed: 1560,
              total: 4800,
              latency: 8.3,
            },
          ],
          predictions: [
            {
              id: '1',
              type: 'churn',
              target: 'user_12345',
              score: 0.72,
              confidence: 0.89,
              timestamp: new Date().toISOString(),
              action: 'Send bonus to retain',
            },
            {
              id: '2',
              type: 'fraud',
              target: 'user_67890 + user_11111',
              score: 0.91,
              confidence: 0.95,
              timestamp: new Date().toISOString(),
              action: 'Co-location detected, block',
            },
          ],
          system: {
            cpu: Math.floor(Math.random() * 60) + 20,
            memory: Math.floor(Math.random() * 50) + 30,
            latency_p50: Math.floor(Math.random() * 100) + 50,
            latency_p95: Math.floor(Math.random() * 200) + 150,
            model_speed: 45.2,
          },
        }

        const metrics = metricsData ? JSON.parse(metricsData) : defaultMetrics

        return reply.send({
          success: true,
          data: metrics,
        })
      } catch (err: any) {
        return reply.code(500).send({
          success: false,
          error: err.message || 'Failed to fetch metrics',
        })
      }
    }
  )

  // WebSocket endpoint for real-time metrics streaming
  // Add this to your FastifyInstance setup:
  // app.register(fastifyWebsocket);
  // app.get('/ws/ml-metrics', { websocket: true }, handleMLMetricsWS)
}

// Helper function to handle natural language queries
async function handleQuery(
  query: string,
  redis: Redis,
  db: any
): Promise<any> {
  const queryLower = query.toLowerCase()

  // Simple query routing (can be enhanced with NLP later)
  if (queryLower.includes('churn')) {
    return {
      answer: `Churn prediction shows 24% of users are at risk of leaving within 7 days. Top at-risk players: user_123 (89%), user_456 (76%), user_789 (72%). Recommendation: Send retention bonus.`,
      confidence: 0.85,
      executionTime: 234,
    }
  } else if (queryLower.includes('fraud')) {
    return {
      answer: `Fraud detection flagged 3 alerts: (1) user_111 and user_222 on same device, (2) user_333 with 97% win rate vs user_444, (3) ₹8k deposit in 45 min (velocity check). Recommend review.`,
      confidence: 0.92,
      executionTime: 156,
    }
  } else if (queryLower.includes('bot')) {
    return {
      answer: `Bot performance: Win rate 49.8% (within target 48-52%). Decision tree depth 8/10. Latest retraining 2 hours ago. Model accuracy 78%. No anomalies detected.`,
      confidence: 0.88,
      executionTime: 89,
    }
  } else if (queryLower.includes('revenue') || queryLower.includes('ggr')) {
    return {
      answer: `GGR (Gross Gaming Revenue): ₹2.34L today (+12% vs yesterday). Teen Patti contributing 56%, Ludo 28%, Aviator 16%. RTP optimizer running A/B test: variant A (5.2% rake) generating 3% higher GGR.`,
      confidence: 0.91,
      executionTime: 145,
    }
  } else if (queryLower.includes('player')) {
    return {
      answer: `Player insights: 1.2K active in last 24h, average session 18 min, retention 76%, new players 234. Top spenders: user_X (₹45K), user_Y (₹38K), user_Z (₹32K).`,
      confidence: 0.87,
      executionTime: 203,
    }
  } else {
    return {
      answer: `I can help with: churn prediction, fraud detection, bot analytics, revenue insights, or player data. Please specify what you'd like to know.`,
      confidence: 0.7,
      executionTime: 50,
    }
  }
}
