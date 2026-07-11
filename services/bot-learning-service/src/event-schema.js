"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EventRecordJsonSchema = exports.EventSchema = void 0;
exports.validateEvent = validateEvent;
const zod_1 = require("zod");
/**
 * EventRecord - Kafka event schema for game events and profile updates
 * Validated with Zod and compatible with JSON Schema
 */
exports.EventSchema = zod_1.z.object({
    event_type: zod_1.z.enum(['game-complete', 'profile-update', 'anomaly-detection']),
    player_id: zod_1.z.string().min(1, 'player_id is required'),
    game_type: zod_1.z.string().optional(),
    outcome: zod_1.z.enum(['win', 'loss', 'draw']).optional(),
    win_rate: zod_1.z.number().min(0).max(1).optional(),
    timestamp: zod_1.z.string().datetime(),
    // Additional optional fields for extensibility
    metadata: zod_1.z.record(zod_1.z.any()).optional(),
});
/**
 * JSON Schema representation for EventRecord
 * Can be used for validation outside of Zod context
 */
exports.EventRecordJsonSchema = {
    $schema: 'http://json-schema.org/draft-07/schema#',
    type: 'object',
    required: ['event_type', 'player_id', 'timestamp'],
    properties: {
        event_type: {
            type: 'string',
            enum: ['game-complete', 'profile-update', 'anomaly-detection'],
            description: 'Type of event',
        },
        player_id: {
            type: 'string',
            description: 'Unique player identifier',
            minLength: 1,
        },
        game_type: {
            type: 'string',
            description: 'Type of game played (teen-patti, aviator, etc.)',
        },
        outcome: {
            type: 'string',
            enum: ['win', 'loss', 'draw'],
            description: 'Result of the game',
        },
        win_rate: {
            type: 'number',
            minimum: 0,
            maximum: 1,
            description: 'Player win rate at time of event',
        },
        timestamp: {
            type: 'string',
            format: 'date-time',
            description: 'ISO 8601 timestamp when event occurred',
        },
        metadata: {
            type: 'object',
            description: 'Additional contextual data',
        },
    },
};
/**
 * Validate EventRecord against schema
 */
function validateEvent(data) {
    try {
        exports.EventSchema.parse(data);
        return { valid: true };
    }
    catch (error) {
        if (error instanceof zod_1.z.ZodError) {
            return { valid: false, error: error.errors[0]?.message || 'Validation failed' };
        }
        return { valid: false, error: 'Unknown validation error' };
    }
}
