import 'dotenv/config';
import Fastify from 'fastify';
import Redis from 'ioredis';
import { Pool } from 'pg';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer } from 'http';
import { EventProcessor } from './event-processor';
import pino from 'pino';

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
});

// Initialize Redis
const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
const redisPub = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');

// Initialize PostgreSQL
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://teen:password@localhost:5432/teen_db',
});

// Initialize Fastify
const fastify = Fastify({ logger: logger as any });

// Event processor
const processor = new EventProcessor(redis, pool, logger);

// WebSocket server for receiving events from game-gateway
const wsServer = new WebSocketServer({ noServer: true });
const connectedClients = new Set<WebSocket>();

// Store metrics
let eventCounts = {
  joinMatchmaking: 0,
  leaveMatchmaking: 0,
  roomJoined: 0,
  gameAction: 0,
  gameResult: 0,
  roomChat: 0,
  error: 0,
};

// Handle WebSocket connections
wsServer.on('connection', (ws: WebSocket) => {
  logger.info('WebSocket client connected');
  connectedClients.add(ws);

  ws.on('message', async (data: Buffer) => {
    try {
      const event = JSON.parse(data.toString());
      await handleIncomingEvent(event);
    } catch (err) {
      logger.error({ err }, 'Failed to parse WebSocket message');
    }
  });

  ws.on('close', () => {
    logger.info('WebSocket client disconnected');
    connectedClients.delete(ws);
  });

  ws.on('error', (err: Error) => {
    logger.error({ err }, 'WebSocket error');
  });
});

// Handle incoming game events
async function handleIncomingEvent(event: any) {
  try {
    // Normalize event
    const normalized = processor.normalizeEvent(event);

    // Log to Redis Streams (for real-time consumers)
    await redis.xadd(
      `events:${normalized.game_type}`,
      '*',
      JSON.stringify(normalized)
    );

    // Also log to global stream
    await redis.xadd('events:all', '*', JSON.stringify(normalized));

    // Persist to PostgreSQL (async, non-blocking)
    processor.persistEvent(normalized).catch((err) => {
      logger.error({ err }, 'Failed to persist event to PostgreSQL');
    });

    // Update in-memory metrics
    if (normalized.event_type in eventCounts) {
      eventCounts[normalized.event_type as keyof typeof eventCounts]++;
    }

    logger.debug({ event: normalized }, 'Event processed');
  } catch (err) {
    logger.error({ err }, 'Error handling incoming event');
    eventCounts.error++;
  }
}

// HTTP endpoint for metrics
fastify.get('/metrics/events', async (request, reply) => {
  const gameType = (request.query as any)?.game_type || 'all';
  const interval = (request.query as any)?.interval || 'hour'; // minute, hour, day

  try {
    // Fetch aggregated metrics from Redis
    const metrics = await processor.getAggregatedMetrics(gameType, interval);
    return { success: true, data: metrics };
  } catch (err) {
    logger.error({ err }, 'Failed to get metrics');
    return { success: false, error: 'Failed to fetch metrics' };
  }
});

// HTTP endpoint for live event stream (Server-Sent Events)
fastify.get('/events/stream', async (request, reply) => {
  const gameType = ((request.query as any)?.game_type as string) || 'all';

  reply.raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  // Subscribe to Redis Pub/Sub
  const subscriber = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
  const channel = `events:${gameType}`;

  logger.info({ channel }, 'SSE client connected');

  subscriber.subscribe(channel, (err) => {
    if (err) {
      logger.error({ err }, 'Failed to subscribe to Redis channel');
      reply.raw.end();
    }
  });

  subscriber.on('message', (channel, message) => {
    try {
      reply.raw.write(`data: ${message}\n\n`);
    } catch (err) {
      logger.error({ err }, 'Failed to send SSE message');
    }
  });

  // Cleanup on disconnect
  request.raw.on('close', () => {
    logger.info({ channel }, 'SSE client disconnected');
    subscriber.disconnect();
  });
});

// HTTP endpoint for event counts
fastify.get('/metrics/status', async (request, reply) => {
  return {
    success: true,
    data: {
      uptime: process.uptime(),
      connectedWebSocketClients: connectedClients.size,
      eventCounts,
      timestamp: new Date().toISOString(),
    },
  };
});

// HTTP endpoint to get recent events from Redis Streams
fastify.get('/events/recent', async (request, reply) => {
  const gameType = ((request.query as any)?.game_type as string) || 'all';
  const limit = Math.min(parseInt((request.query as any)?.limit as string) || 100, 1000);

  try {
    const streamKey = `events:${gameType}`;
    const events = await redis.xrevrange(streamKey, '+', '-', 'COUNT', limit);

    const formatted = events.map(([id, data]) => {
      const obj: any = {};
      for (let i = 0; i < data.length; i += 2) {
        obj[data[i]] = data[i + 1];
      }
      return { stream_id: id, ...obj };
    });

    return { success: true, data: formatted.reverse() };
  } catch (err) {
    logger.error({ err }, 'Failed to fetch recent events');
    return { success: false, error: 'Failed to fetch events' };
  }
});

// Health check endpoint
fastify.get('/health', async (request, reply) => {
  try {
    // Check Redis
    await redis.ping();

    // Check PostgreSQL
    const result = await pool.query('SELECT NOW()');

    return {
      success: true,
      data: {
        redis: 'connected',
        postgres: 'connected',
        timestamp: result.rows[0].now,
      },
    };
  } catch (err) {
    logger.error({ err }, 'Health check failed');
    return {
      success: false,
      error: 'Service health check failed',
    };
  }
});

// Handle HTTP upgrade for WebSocket
fastify.server.on('upgrade', (request, socket, head) => {
  if (request.url === '/ws') {
    wsServer.handleUpgrade(request, socket, head, (ws: any) => {
      wsServer.emit('connection', ws, request);
    });
  } else {
    socket.destroy();
  }
});

// Start server
const PORT = parseInt(process.env.PORT || '3005');

fastify.listen({ port: PORT, host: '0.0.0.0' }, (err, address) => {
  if (err) {
    logger.error(err);
    process.exit(1);
  }
  logger.info(`Monitoring service listening at ${address}`);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, shutting down gracefully');
  await fastify.close();
  redis.disconnect();
  redisPub.disconnect();
  await pool.end();
  process.exit(0);
});
