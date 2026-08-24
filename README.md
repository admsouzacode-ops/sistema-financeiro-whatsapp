# 💰 Sistema Financeiro WhatsApp + Evolution API

Sistema financeiro **simples, funcional e completo** para controlar receitas e despesas diretamente pelo WhatsApp, usando a **Evolution API**.

Ideal para uso pessoal ou pequenos negócios. Tudo via mensagens de texto — sem aplicativo extra.

---

## ✨ Funcionalidades

| Comando | O que faz |
|---------|-----------|
| `saldo` | Mostra receitas, despesas e saldo atual |
| `entrada 2500 salário` | Registra uma receita |
| `gasto 45,90 almoço` | Registra uma despesa |
| `extrato` | Últimas 10 transações |
| `extrato 20` | Últimas 20 transações (máx. 50) |
| `resumo` | Resumo agrupado por categoria |
| `desfazer` | Remove a última transação |
| `ajuda` | Lista todos os comandos |

- Aceita valores com vírgula ou ponto (`45,90` ou `45.90`)
- Cada número de WhatsApp tem seu próprio extrato isolado
- Banco de dados SQLite (leve e sem configuração extra)
- Suporte a lista de números autorizados (opcional)

---

## 🛠️ Pré-requisitos

1. **Node.js** 18+ instalado (ou Docker)
2. Uma instância da **[Evolution API](https://github.com/EvolutionAPI/evolution-api)** rodando (self-hosted ou cloud)
3. Uma instância WhatsApp conectada na Evolution (com QR Code)

---

## 🚀 Instalação Rápida (local)

```bash
# 1. Clone o repositório
git clone https://github.com/admsouzacode-ops/sistema-financeiro-whatsapp.git
cd sistema-financeiro-whatsapp

# 2. Instale as dependências
npm install

# 3. Configure as variáveis de ambiente
cp .env.example .env
# Edite o .env com seus dados

# 4. Inicie o servidor
npm start
```

---

## 🐳 Deploy no Dokploy (recomendado)

O repositório já contém `Dockerfile` e `docker-compose.yml` prontos.

### Passo a passo no Dokploy:

1. Crie um novo aplicativo → **Compose**
2. Conecte o repositório: `admsouzacode-ops/sistema-financeiro-whatsapp`
3. Branch: `main`
4. No painel de **Environment Variables**, adicione:

| Variável | Exemplo |
|----------|---------|
| `EVOLUTION_API_URL` | `https://sua-evolution-api.com` |
| `EVOLUTION_API_KEY` | `sua-chave-api` |
| `EVOLUTION_INSTANCE` | `nome-da-instancia` |
| `ALLOWED_NUMBERS` | `5511999999999` (opcional) |

5. Clique em **Deploy**

O volume `financeiro-data` é criado automaticamente para persistir o banco SQLite.

---

## ⚙️ Configuração do `.env`

```env
PORT=3000

EVOLUTION_API_URL=https://sua-evolution-api.com
EVOLUTION_API_KEY=sua-chave-api
EVOLUTION_INSTANCE=nome-da-sua-instancia

# Opcional: só esses números podem usar (deixe vazio para qualquer um)
ALLOWED_NUMBERS=5511999999999,5511888888888

DATABASE_PATH=./data/financeiro.db
```

---

## 🔗 Configurando o Webhook na Evolution API

Você precisa apontar o webhook da sua instância para o seu servidor:

**URL do webhook:**
```
https://SEU-DOMINIO.com/webhook
```

**Eventos necessários:**
- `MESSAGES_UPSERT` (ou `messages.upsert`)

### Exemplo via API da Evolution:

```bash
curl -X POST "https://sua-evolution-api.com/webhook/set/SUA_INSTANCIA" \
  -H "apikey: SUA_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "enabled": true,
    "url": "https://SEU-DOMINIO.com/webhook",
    "webhookByEvents": false,
    "webhookBase64": false,
    "events": [
      "MESSAGES_UPSERT"
    ]
  }'
```

> **Dica:** Se estiver testando localmente, use o [ngrok](https://ngrok.com/) ou [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/).

```bash
ngrok http 3000
# Use a URL gerada no webhook
```

---

## 📱 Exemplos de uso no WhatsApp

```
Você: saldo
Bot: 🟢 Seu saldo atual
     📥 Receitas: R$ 3.500,00
     📤 Despesas: R$ 1.245,90
     ━━━━━━━━━━━━━━
     💰 Saldo: R$ 2.254,10

Você: gasto 89,90 mercado
Bot: ✅ Despesa registrada!
     💸 Valor: R$ 89,90
     📝 mercado
     🆔 #42
     Saldo atual: R$ 2.164,20

Você: entrada 1500 freelance site
Bot: ✅ Receita registrada!
     ...

Você: extrato
Bot: 📋 Últimas 10 transações
     📤 -R$ 89,90
        mercado
        24/08/2026 20:15 · #42
     ...
```

---

## 🏗️ Estrutura do Projeto

```
├── src/
│   ├── index.js          # Servidor Express + rotas
│   ├── commands.js       # Processamento de comandos do WhatsApp
│   ├── db.js             # Banco SQLite (transações)
│   ├── evolution.js      # Cliente da Evolution API
│   └── utils.js          # Helpers (formatação, parsing)
├── data/                 # Banco de dados (criado automaticamente)
├── Dockerfile
├── docker-compose.yml
├── .env.example
├── package.json
└── README.md
```

---

## ☁️ Outras opções de Deploy

- **Railway** / **Render** / **Fly.io**
- **VPS** (DigitalOcean, Contabo, Hetzner) + PM2
- **Docker** puro: `docker compose up -d --build`

Lembre-se de configurar as variáveis de ambiente e manter o volume persistente.

---

## 🔒 Segurança

- Use `ALLOWED_NUMBERS` em produção para restringir quem pode interagir com o bot.
- Nunca exponha sua `EVOLUTION_API_KEY` publicamente.
- Prefira HTTPS no webhook.

---

## 📝 Licença

MIT — fique à vontade para usar, modificar e distribuir.

---

Feito com ❤️ para facilitar o controle financeiro pelo WhatsApp.
