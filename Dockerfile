FROM node:20-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install --production

# Copy application source
COPY src ./src

# Create directories for mounted volumes
RUN mkdir -p /app/data /app/logs /app/src/config

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD wget -qO- http://localhost:3000/api/status || exit 1

# Start the application
CMD ["npm", "start"]
