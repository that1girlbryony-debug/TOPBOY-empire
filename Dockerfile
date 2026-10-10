FROM node:20-slim

# Install ffmpeg (required for GIF→MP4 conversion + music playback)
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files and install deps
COPY package*.json ./
RUN npm install --production

# Copy source
COPY . .

# Create auth directory (Baileys writes pairing session here)
RUN mkdir -p auth data

# Expose Express port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "require('http').get('http://localhost:3000/', r => process.exit(r.statusCode === 200 ? 0 : 1))" || exit 1

CMD ["node", "index.js"]
