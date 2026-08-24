FROM node:20-alpine

# Dependências necessárias para o better-sqlite3 + curl para healthcheck
RUN apk add --no-cache python3 make g++ curl

WORKDIR /app

# Copia apenas o package.json primeiro (melhor cache de layers)
COPY package*.json ./

RUN npm install --omit=dev

# Copia o restante do código
COPY . .

# Cria a pasta do banco de dados
RUN mkdir -p /app/data

# Variável de ambiente padrão
ENV NODE_ENV=production
ENV PORT=3000
ENV DATABASE_PATH=/app/data/financeiro.db

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD curl -f http://localhost:3000/health || exit 1

CMD ["node", "src/index.js"]
