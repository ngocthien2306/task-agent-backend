# Task Agent Backend Dockerfile (Node.js)
FROM node:18-slim

# Set working directory
WORKDIR /app

# Install ffmpeg and required dependencies for Rhubarb
RUN apt-get update && apt-get install -y \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# Copy package files
COPY package.json yarn.lock ./

# Install dependencies
RUN yarn install --production

# Copy application code
COPY . .

# Create audios directory and ensure rhubarb binary has execute permission
RUN mkdir -p audios && \
    chmod +x bin/rhubarb

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3000/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})" || exit 1

# Run the application
CMD ["npm", "start"]
