require('dotenv').config();

const express = require('express');
const { initDb } = require('./db');
const { handleWebhook } = require('./commands');

const app = express();

// Aceita JSON grande (alguns payloads da Evolution podem ser maiores)
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true }));

// Inicializa banco
initDb();

// Health check
app.get('/', (req, res) => {
  res.json({
    status: 'online',
    service: 'Sistema Financeiro WhatsApp',
    version: '1.0.0',
    timestamp: new Date().toISOString()
  });
});

app.get('/health', (req, res) => {
  res.status(200).send('OK');
});

// Webhook da Evolution API
app.post('/webhook', async (req, res) => {
  // Responde imediatamente para a Evolution não reenviar
  res.status(200).json({ received: true });

  try {
    await handleWebhook(req.body);
  } catch (err) {
    console.error('Erro no processamento do webhook:', err);
  }
});

// Rota alternativa caso a Evolution envie por evento
app.post('/webhook/messages-upsert', async (req, res) => {
  res.status(200).json({ received: true });
  try {
    // Simula o formato esperado
    const body = {
      event: 'messages.upsert',
      data: req.body?.data || req.body
    };
    await handleWebhook(body);
  } catch (err) {
    console.error('Erro no webhook messages-upsert:', err);
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🚀 Sistema Financeiro WhatsApp');
  console.log(`📡 Servidor rodando na porta ${PORT}`);
  console.log(`🔗 Webhook: http://localhost:${PORT}/webhook`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
});
