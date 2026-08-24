const axios = require('axios');

const api = axios.create({
  baseURL: process.env.EVOLUTION_API_URL?.replace(/\/$/, ''),
  headers: {
    apikey: process.env.EVOLUTION_API_KEY,
    'Content-Type': 'application/json'
  },
  timeout: 15000
});

/**
 * Envia mensagem de texto via Evolution API
 * @param {string} number - Número com DDI (ex: 5511999999999) ou com @s.whatsapp.net
 * @param {string} text - Texto da mensagem
 */
async function sendText(number, text) {
  if (!process.env.EVOLUTION_API_URL || !process.env.EVOLUTION_API_KEY || !process.env.EVOLUTION_INSTANCE) {
    console.error('❌ Variáveis de ambiente da Evolution API não configuradas');
    return;
  }

  const cleanNumber = String(number).replace(/\D/g, '');
  const instance = process.env.EVOLUTION_INSTANCE;

  try {
    await api.post(`/message/sendText/${instance}`, {
      number: cleanNumber,
      text: text
    });
    console.log(`✅ Mensagem enviada para ${cleanNumber}`);
  } catch (error) {
    const msg = error.response?.data || error.message;
    console.error('❌ Erro ao enviar mensagem:', msg);
    throw error;
  }
}

module.exports = {
  sendText
};
