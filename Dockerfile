FROM node:20-bookworm-slim

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY package*.json ./

RUN npm ci --omit=dev --build-from-source=sqlite3

COPY server/ ./server/
COPY public/ ./public/

EXPOSE 3000

CMD ["npm", "start"]
