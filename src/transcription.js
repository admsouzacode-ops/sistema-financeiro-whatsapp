const axios = require('axios');
const FormData = require('form-data');

/**
 * Transcreve áudio usando OpenAI Whisper
 * @param {string} base64Audio - Áudio em base64
 * @param {string} mimetype - Ex: audio/ogg
 * @returns {Promise<string|null>} Texto transcrito
 */
async function transcribeAudio(base64Audio, mimetype = 'audio/ogg') {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    console.error('❌ OPENAI_API_KEY não configurada');
    return null;
  }

  try {
    // Remove o prefixo data: se existir
    const cleanBase64 = base64Audio.replace(/^data:[^;]+;base64,/, '');

    const buffer = Buffer.from(cleanBase64, 'base64');

    // Determina a extensão pelo mimetype
    let filename = 'audio.ogg';
    if (mimetype.includes('mp4') || mimetype.includes('mpeg') || mimetype.includes('mp3')) {
      filename = 'audio.mp3';
    } else if (mimetype.includes('wav')) {
      filename = 'audio.wav';
    } else if (mimetype.includes('webm')) {
      filename = 'audio.webm';
    }

    const form = new FormData();
    form.append('file', buffer, {
      filename,
      contentType: mimetype
    });
    form.append('model', 'whisper-1');
    form.append('language', 'pt'); // Português
    form.append('response_format', 'text');

    const response = await axios.post(
      'https://api.openai.com/v1/audio/transcriptions',
      form,
      {
        headers: {
          ...form.getHeaders(),
          Authorization: `Bearer ${apiKey}`
        },
        timeout: 60000
      }
    );

    const text = (response.data || '').toString().trim();
    console.log(`🎧 Transcrição: "${text}"`);
    return text || null;
  } catch (error) {
    console.error('❌ Erro na transcrição Whisper:', error.response?.data || error.message);
    return null;
  }
}

module.exports = {
  transcribeAudio
};
