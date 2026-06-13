FROM node:20-slim

# Set working directory
WORKDIR /app

# Copy package files and install production dependencies
COPY package*.json ./
RUN npm ci --only=production

# Copy application source files
COPY server/ ./server/
COPY public/ ./public/

# Set environment variables defaults
ENV PORT=3000
ENV DATABASE_PATH=/app/data/music.db
ENV MUSIC_LIBRARY_PATH=/music

# Expose app port
EXPOSE 3000

# Start command
CMD ["node", "server/src/index.js"]
