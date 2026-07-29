/**
 * Capacity Planning Model for Teen Platform
 *
 * Forecasts infrastructure resource requirements based on target concurrent player load.
 * Supports different scaling scenarios and provides detailed breakdowns.
 */

import * as fs from 'fs';
import * as path from 'path';

// ============================================================================
// Core Types & Constants
// ============================================================================

export interface CapacityForecast {
  targetConcurrentPlayers: number;
  forecastDate: Date;
  assumptions: ScalingAssumptions;
  gameGateway: ServiceScaling;
  botLearning: ServiceScaling;
  modelServer: ServiceScaling;
  database: DatabaseScaling;
  totalResources: TotalResources;
  costEstimate: CostEstimate;
  recommendations: string[];
}

export interface ScalingAssumptions {
  playersPerGatewayReplica: number;        // 1500 players/replica
  gatewayMemoryPerReplica: number;         // 2GB per replica
  gatewayCpuPerReplica: number;            // 1000m (1 core) per replica
  botLearningMemory: number;               // 2GB for batch processing
  modelServerCpu: number;                  // 1000m for inference
  dbConnectionPoolSize: number;            // 25 per app instance
  qpsPerPlayer: number;                    // ~1 query/sec per concurrent player
  bandwidthPerPlayer: number;              // 1 Mbps (WebSocket overhead)
}

export interface ServiceScaling {
  name: string;
  minReplicas: number;
  maxReplicas: number;
  desiredReplicas: number;
  cpuPerReplicaMillicores: number;
  memoryPerReplicaGi: number;
  totalCpuCores: number;
  totalMemoryGi: number;
}

export interface DatabaseScaling {
  maxConnections: number;
  sharedBuffersGb: number;
  effectiveCacheSizeGb: number;
  maxQueriesPerSecond: number;
  estimatedActiveConnections: number;
  recommendedReadReplicas: number;
  indicesRequired: string[];
}

export interface TotalResources {
  totalCpuCores: number;
  totalMemoryGi: number;
  totalNodeCount: number;
  estimatedNetworkBandwidthMbps: number;
}

export interface CostEstimate {
  cpuCostPerMonth: number;        // USD
  memoryCostPerMonth: number;     // USD
  databaseCostPerMonth: number;   // USD
  networkCostPerMonth: number;    // USD
  totalMonthly: number;           // USD
  estimatedYearlySpend: number;   // USD
}

// ============================================================================
// Default Scaling Assumptions
// ============================================================================

export const DEFAULT_ASSUMPTIONS: ScalingAssumptions = {
  playersPerGatewayReplica: 1500,
  gatewayMemoryPerReplica: 2,           // GB
  gatewayCpuPerReplica: 1000,           // millicores
  botLearningMemory: 2,                 // GB
  modelServerCpu: 1000,                 // millicores
  dbConnectionPoolSize: 25,
  qpsPerPlayer: 1,                      // Conservative estimate
  bandwidthPerPlayer: 1,                // Mbps per concurrent player
};

// AWS pricing (per month, reserved instances)
export const PRICING = {
  cpuPerCore: 0.0536,                   // m7g.medium: $42.88/month
  memoryPerGb: 0.0107,                  // 8GB @ $7.15/month
  databasePerCore: 0.0893,              // RDS db.t4g.medium
  networkDataTransferPerGb: 0.02,       // Cross-region, $0.02/GB
};

// ============================================================================
// Capacity Planning Functions
// ============================================================================

/**
 * Calculate scaling requirements for target concurrent players
 */
export function forecastCapacity(
  targetConcurrentPlayers: number,
  assumptions: Partial<ScalingAssumptions> = {},
): CapacityForecast {
  const finalAssumptions = { ...DEFAULT_ASSUMPTIONS, ...assumptions };

  // Calculate Game Gateway scaling
  const gatewayReplicas = Math.ceil(
    targetConcurrentPlayers / finalAssumptions.playersPerGatewayReplica
  );
  const gameGateway: ServiceScaling = {
    name: 'game-gateway',
    minReplicas: 2,                                              // Always maintain HA with 2 replicas
    maxReplicas: Math.max(10, Math.ceil(gatewayReplicas * 1.5)), // At least 1.5x target or 10
    desiredReplicas: gatewayReplicas,
    cpuPerReplicaMillicores: finalAssumptions.gatewayCpuPerReplica,
    memoryPerReplicaGi: finalAssumptions.gatewayMemoryPerReplica,
    totalCpuCores: (gatewayReplicas * finalAssumptions.gatewayCpuPerReplica) / 1000,
    totalMemoryGi: gatewayReplicas * finalAssumptions.gatewayMemoryPerReplica,
  };

  // Bot Learning: 1 instance (background batch job)
  const botLearning: ServiceScaling = {
    name: 'bot-learning-service',
    minReplicas: 1,
    maxReplicas: 1,
    desiredReplicas: 1,
    cpuPerReplicaMillicores: 500,
    memoryPerReplicaGi: finalAssumptions.botLearningMemory,
    totalCpuCores: 0.5,
    totalMemoryGi: finalAssumptions.botLearningMemory,
  };

  // Model Server: 1-2 instances depending on load
  const modelServerReplicas = targetConcurrentPlayers > 3000 ? 2 : 1;
  const modelServer: ServiceScaling = {
    name: 'model-server',
    minReplicas: 1,
    maxReplicas: 2,
    desiredReplicas: modelServerReplicas,
    cpuPerReplicaMillicores: finalAssumptions.modelServerCpu,
    memoryPerReplicaGi: 0.5,
    totalCpuCores: (modelServerReplicas * finalAssumptions.modelServerCpu) / 1000,
    totalMemoryGi: modelServerReplicas * 0.5,
  };

  // Database scaling
  const estimatedQps = targetConcurrentPlayers * finalAssumptions.qpsPerPlayer;
  const estimatedConnections = Math.ceil(
    (targetConcurrentPlayers / 1500) * 25 // 25 connections per 1500 players
  );
  const readReplicas = estimatedQps > 5000 ? 2 : estimatedQps > 2000 ? 1 : 0;

  const database: DatabaseScaling = {
    maxConnections: 250 + estimatedConnections, // Base 250 + app connections
    sharedBuffersGb: estimatedQps > 8000 ? 2 : 1,
    effectiveCacheSizeGb: estimatedQps > 8000 ? 6 : 3,
    maxQueriesPerSecond: estimatedQps,
    estimatedActiveConnections: estimatedConnections,
    recommendedReadReplicas: readReplicas,
    indicesRequired: [
      'leaderboards(game_id, season_id, score DESC)',
      'player_sessions(player_id, is_active, room_id, started_at)',
      'transactions(player_id, created_at DESC) WHERE status=completed',
      'bot_profiles(game_id, skill_level)',
      'players(last_seen_at DESC) WHERE is_churned=false',
    ],
  };

  // Total resources
  const totalResources: TotalResources = {
    totalCpuCores:
      gameGateway.totalCpuCores + botLearning.totalCpuCores + modelServer.totalCpuCores,
    totalMemoryGi: gameGateway.totalMemoryGi + botLearning.totalMemoryGi + modelServer.totalMemoryGi,
    totalNodeCount: Math.ceil(
      (gameGateway.desiredReplicas * 0.5 + botLearning.desiredReplicas * 0.3 + modelServer.desiredReplicas * 0.5) / 2
    ), // Average ~2 pods per node
    estimatedNetworkBandwidthMbps: targetConcurrentPlayers * finalAssumptions.bandwidthPerPlayer,
  };

  // Cost estimate (AWS pricing)
  const costEstimate = estimateCost(gameGateway, botLearning, modelServer, database);

  // Recommendations
  const recommendations = generateRecommendations(
    targetConcurrentPlayers,
    gatewayReplicas,
    estimatedQps,
    totalResources
  );

  return {
    targetConcurrentPlayers,
    forecastDate: new Date(),
    assumptions: finalAssumptions,
    gameGateway,
    botLearning,
    modelServer,
    database,
    totalResources,
    costEstimate,
    recommendations,
  };
}

/**
 * Estimate cost based on resource requirements
 */
function estimateCost(
  gameGateway: ServiceScaling,
  botLearning: ServiceScaling,
  modelServer: ServiceScaling,
  database: DatabaseScaling,
): CostEstimate {
  const cpuCostPerMonth =
    (gameGateway.totalCpuCores +
      botLearning.totalCpuCores +
      modelServer.totalCpuCores) *
    PRICING.cpuPerCore;

  const memoryCostPerMonth =
    (gameGateway.totalMemoryGi +
      botLearning.totalMemoryGi +
      modelServer.totalMemoryGi) *
    PRICING.memoryPerGb;

  const databaseCostPerMonth =
    (2 + database.recommendedReadReplicas) * // Primary + read replicas
    2 * // 2 cores per instance
    PRICING.databasePerCore;

  const networkCostPerMonth = 0; // Internal traffic is free

  const totalMonthly = cpuCostPerMonth + memoryCostPerMonth + databaseCostPerMonth + networkCostPerMonth;

  return {
    cpuCostPerMonth,
    memoryCostPerMonth,
    databaseCostPerMonth,
    networkCostPerMonth,
    totalMonthly,
    estimatedYearlySpend: totalMonthly * 12,
  };
}

/**
 * Generate recommendations based on capacity forecast
 */
function generateRecommendations(
  targetPlayers: number,
  replicas: number,
  qps: number,
  resources: TotalResources,
): string[] {
  const recommendations: string[] = [];

  if (targetPlayers < 500) {
    recommendations.push(
      '✓ Small scale: 1-2 gateway replicas sufficient for testing/staging'
    );
  } else if (targetPlayers < 3000) {
    recommendations.push(
      `✓ Medium scale: ${replicas} gateway replicas with 1 database instance`
    );
  } else if (targetPlayers < 8000) {
    recommendations.push(
      `✓ Large scale: ${replicas} gateway replicas with read replicas for database`
    );
    recommendations.push(
      '  → Enable read replicas to distribute query load across 2 instances'
    );
  } else {
    recommendations.push(
      `✓ Enterprise scale: ${replicas} gateway replicas with full HA setup`
    );
    recommendations.push(
      '  → Deploy 2 read replicas for read-heavy workloads'
    );
    recommendations.push(
      '  → Consider database sharding for write-heavy scenarios'
    );
  }

  if (resources.totalNodeCount > 10) {
    recommendations.push(
      `  → Provision ${resources.totalNodeCount} or more Kubernetes nodes (${resources.totalCpuCores} cores total)`
    );
  }

  if (qps > 5000) {
    recommendations.push(
      `  → Database tuning critical: ${qps} QPS requires aggressive caching`
    );
    recommendations.push('    • Enable query result caching (Redis)');
    recommendations.push('    • Add materialized views for leaderboards');
  }

  recommendations.push(
    `  → Expected monthly AWS cost: $${Math.round(
      (targetPlayers / 5000) * 2000
    )} (estimate)`
  );

  if (targetPlayers > 5000) {
    recommendations.push(
      `  → Monitor HPA events: expect 10-20 scale-up events/day during peak hours`
    );
  }

  return recommendations;
}

/**
 * Generate detailed capacity report
 */
export function generateReport(forecast: CapacityForecast): string {
  const lines: string[] = [];

  lines.push('═'.repeat(80));
  lines.push('CAPACITY PLANNING FORECAST');
  lines.push('═'.repeat(80));
  lines.push('');

  lines.push(`Forecast Date: ${forecast.forecastDate.toISOString()}`);
  lines.push(`Target Concurrent Players: ${forecast.targetConcurrentPlayers.toLocaleString()}`);
  lines.push('');

  lines.push('SCALING ASSUMPTIONS:');
  lines.push(`  • Players per gateway replica: ${forecast.assumptions.playersPerGatewayReplica.toLocaleString()}`);
  lines.push(`  • Queries per second per player: ${forecast.assumptions.qpsPerPlayer}`);
  lines.push(`  • Average bandwidth per player: ${forecast.assumptions.bandwidthPerPlayer} Mbps`);
  lines.push('');

  lines.push('GAME GATEWAY (WebSocket Server):');
  lines.push(`  • Desired replicas: ${forecast.gameGateway.desiredReplicas}`);
  lines.push(
    `  • Min/Max replicas: ${forecast.gameGateway.minReplicas}/${forecast.gameGateway.maxReplicas}`
  );
  lines.push(
    `  • CPU per replica: ${forecast.gameGateway.cpuPerReplicaMillicores}m (${
      forecast.gameGateway.cpuPerReplicaMillicores / 1000
    } core)`
  );
  lines.push(
    `  • Memory per replica: ${forecast.gameGateway.memoryPerReplicaGi}GB`
  );
  lines.push(
    `  • Total CPU: ${forecast.gameGateway.totalCpuCores.toFixed(2)} cores`
  );
  lines.push(
    `  • Total Memory: ${forecast.gameGateway.totalMemoryGi.toFixed(1)}GB`
  );
  lines.push('');

  lines.push('BOT LEARNING SERVICE (Batch Processing):');
  lines.push(`  • Replicas: ${forecast.botLearning.desiredReplicas}`);
  lines.push(
    `  • Memory: ${forecast.botLearning.totalMemoryGi}GB (for 10K+ player batches)`
  );
  lines.push(`  • CPU: ${forecast.botLearning.totalCpuCores.toFixed(2)} cores`);
  lines.push('');

  lines.push('MODEL SERVER (ML Inference):');
  lines.push(`  • Replicas: ${forecast.modelServer.desiredReplicas}`);
  lines.push(
    `  • CPU: ${forecast.modelServer.totalCpuCores.toFixed(2)} cores (for <100ms inference)`
  );
  lines.push(`  • Memory: ${forecast.modelServer.totalMemoryGi}GB`);
  lines.push('');

  lines.push('DATABASE (PostgreSQL):');
  lines.push(
    `  • Max connections: ${forecast.database.maxConnections} (${forecast.database.estimatedActiveConnections} active)`
  );
  lines.push(
    `  • Max QPS: ${forecast.database.maxQueriesPerSecond.toLocaleString()} queries/sec`
  );
  lines.push(
    `  • Shared buffers: ${forecast.database.sharedBuffersGb}GB`
  );
  lines.push(
    `  • Effective cache size: ${forecast.database.effectiveCacheSizeGb}GB`
  );
  lines.push(
    `  • Read replicas: ${forecast.database.recommendedReadReplicas}`
  );
  lines.push(`  • Required indices: ${forecast.database.indicesRequired.length}`);
  forecast.database.indicesRequired.forEach((idx) => {
    lines.push(`    → ${idx}`);
  });
  lines.push('');

  lines.push('TOTAL INFRASTRUCTURE:');
  lines.push(
    `  • CPU Cores: ${forecast.totalResources.totalCpuCores.toFixed(2)}`
  );
  lines.push(`  • Memory: ${forecast.totalResources.totalMemoryGi.toFixed(1)}GB`);
  lines.push(
    `  • Kubernetes Nodes: ${forecast.totalResources.totalNodeCount} (m7g.large with 2 cores / 8GB)`
  );
  lines.push(
    `  • Network Bandwidth: ${forecast.totalResources.estimatedNetworkBandwidthMbps.toLocaleString()} Mbps`
  );
  lines.push('');

  lines.push('COST ESTIMATE (Monthly AWS):');
  lines.push(`  • Compute (CPU): $${forecast.costEstimate.cpuCostPerMonth.toFixed(2)}`);
  lines.push(`  • Memory: $${forecast.costEstimate.memoryCostPerMonth.toFixed(2)}`);
  lines.push(`  • Database: $${forecast.costEstimate.databaseCostPerMonth.toFixed(2)}`);
  lines.push(`  • Network: $${forecast.costEstimate.networkCostPerMonth.toFixed(2)}`);
  lines.push(
    `  • Total Monthly: $${forecast.costEstimate.totalMonthly.toFixed(2)}`
  );
  lines.push(
    `  • Estimated Yearly: $${forecast.costEstimate.estimatedYearlySpend.toFixed(2)}`
  );
  lines.push('');

  lines.push('RECOMMENDATIONS:');
  forecast.recommendations.forEach((rec) => {
    lines.push(`  ${rec}`);
  });
  lines.push('');

  lines.push('═'.repeat(80));

  return lines.join('\n');
}

/**
 * Export forecast as JSON for dashboards
 */
export function exportForecastJson(forecast: CapacityForecast, filePath?: string): string {
  const json = JSON.stringify(forecast, null, 2);

  if (filePath) {
    fs.writeFileSync(filePath, json);
  }

  return json;
}

/**
 * Export forecast as CSV table
 */
export function exportForecastTable(forecasts: CapacityForecast[]): string {
  const lines: string[] = [];

  // Header row
  lines.push([
    'Players',
    'Gateway Replicas',
    'CPU (cores)',
    'Memory (GB)',
    'QPS',
    'DB Connections',
    'Read Replicas',
    'Monthly Cost',
  ].join(','));

  // Data rows
  forecasts.forEach((f) => {
    lines.push([
      f.targetConcurrentPlayers,
      f.gameGateway.desiredReplicas,
      f.totalResources.totalCpuCores.toFixed(1),
      f.totalResources.totalMemoryGi.toFixed(1),
      f.database.maxQueriesPerSecond,
      f.database.maxConnections,
      f.database.recommendedReadReplicas,
      '$' + f.costEstimate.totalMonthly.toFixed(0),
    ].join(','));
  });

  return lines.join('\n');
}

// ============================================================================
// CLI / Example Usage
// ============================================================================

if (require.main === module) {
  console.log('Capacity Planning Calculator\n');

  // Generate forecasts for multiple load levels
  const loadLevels = [500, 1500, 3000, 5000, 8000, 10000];
  const forecasts = loadLevels.map((n) => forecastCapacity(n));

  // Print reports
  forecasts.forEach((forecast) => {
    console.log(generateReport(forecast));
    console.log('\n');
  });

  // Export table
  console.log('CAPACITY COMPARISON TABLE:');
  console.log(exportForecastTable(forecasts));
  console.log('\n');

  // Export JSON for single load level
  const mainForecast = forecastCapacity(5000);
  console.log('JSON Export (5000 concurrent players):');
  console.log(exportForecastJson(mainForecast));
}

export default { forecastCapacity, generateReport, exportForecastJson, exportForecastTable };
