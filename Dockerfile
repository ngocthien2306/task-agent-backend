# Task Agent Backend Dockerfile (Node.js)
FROM node:18-alpine

# Set working directory
WORKDIR /app

# Install ffmpeg and required dependencies
RUN apk add --no-cache ffmpeg

# Copy package files
COPY package.json yarn.lock ./

# Install dependencies
RUN yarn install --production

# Copy application code
COPY . .

# Create audios directory
RUN mkdir -p audios

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3000/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})" || exit 1

# Run the application
CMD ["npm", "start"]
