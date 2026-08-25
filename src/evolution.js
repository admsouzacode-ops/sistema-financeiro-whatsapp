const axios = require('axios');

const api = axios.create({
  baseURL: process.env.EVOLUTION_API_URL?.replace(/\/$/, ''),
  headers: {
    apikey: process.env.EVOLUTION_API_KEY,
    'Content-Type': 'application/json'
  },
  timeout: 30000
});

/**
 * Envia mensagem de texto via Evolution API
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

/**
 * Baixa mídia (áudio, imagem, etc) em base64 a partir da mensagem
 */
async function getMediaBase64(messageKey) {
  const instance = process.env.EVOLUTION_INSTANCE;

  try {
    const response = await api.post(`/chat/getBase64FromMediaMessage/${instance}`, {
      message: {
        key: {
          id: messageKey.id
        }
      },
      convertToMp4: false
    });

    // A resposta pode vir de formas diferentes dependendo da versão da Evolution
    const data = response.data;

    if (data?.base64) {
      return {
        base64: data.base64,
        mimetype: data.mimetype || 'audio/ogg'
      };
    }

    // Algumas versões retornam o base64 direto no root
    if (typeof data === 'string') {
      return { base64: data, mimetype: 'audio/ogg' };
    }

    console.error('Resposta inesperada do getBase64FromMediaMessage:', data);
    return null;
  } catch (error) {
    console.error('❌ Erro ao baixar mídia:', error.response?.data || error.message);
    return null;
  }
}

module.exports = {
  sendText,
  getMediaBase64
};
