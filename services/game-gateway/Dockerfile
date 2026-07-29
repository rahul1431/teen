FROM node:20-alpine

WORKDIR /app

# Copy package files
COPY services/game-gateway/package*.json ./

# Install dependencies
RUN npm ci

# Copy source code
COPY services/game-gateway/src ./src
COPY services/game-gateway/tsconfig.json ./

# Build TypeScript
RUN npm run build

# Health check
HEALTHCHECK --interval=5s --timeout=2s --retries=3 \
  CMD node -e "require('http').get('http://localhost:' + (process.env.PORT || 3004) + '/health', (res) => process.exit(res.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

# Start the application
CMD ["npm", "start"]
