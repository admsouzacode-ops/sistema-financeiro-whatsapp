FROM node:20-alpine

# Dependências necessárias para o better-sqlite3
RUN apk add --no-cache python3 make g++

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

CMD ["node", "src/index.js"]
