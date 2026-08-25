/**
 * Formata valor monetário em Real Brasileiro
 */
function formatCurrency(value) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL'
  }).format(value || 0);
}

/**
 * Limpa e converte string de valor brasileiro para número
 * Aceita: 2644,03 | 2.644,03 | 2.644.03 | 2644.03 | R$ 2.644,03
 */
function parseBrazilianNumber(str) {
  if (!str) return null;

  let cleaned = String(str)
    .replace(/R\$\s*/gi, '')
    .replace(/reais?/gi, '')
    .replace(/\s/g, '')
    .trim();

  // Se tem vírgula e ponto → assume formato BR (ponto = milhar, vírgula = decimal)
  if (cleaned.includes(',') && cleaned.includes('.')) {
    cleaned = cleaned.replace(/\./g, '').replace(',', '.');
  }
  // Só vírgula → decimal BR
  else if (cleaned.includes(',')) {
    cleaned = cleaned.replace(',', '.');
  }
  // Só ponto → pode ser decimal ou milhar. Se tiver mais de 2 dígitos depois do ponto, trata como milhar
  else if (cleaned.includes('.')) {
    const parts = cleaned.split('.');
    if (parts.length > 2 || (parts[1] && parts[1].length === 3 && parts.length === 2)) {
      // milhar: 2.644 ou 1.234.567
      cleaned = cleaned.replace(/\./g, '');
    }
    // senão deixa como decimal (2644.03)
  }

  const amount = parseFloat(cleaned);
  return isNaN(amount) || amount <= 0 ? null : amount;
}

/**
 * Extrai valor + descrição de textos variados
 * Exemplos que agora funcionam:
 * - "45,90 almoço"
 * - "R$ 2.644,03 no Nubank"
 * - "gastei 200 no mercado"
 * - "2.644,03 Nubank"
 */
function parseAmountAndDescription(text) {
  if (!text) return null;

  const cleaned = text.trim();

  // Procura o primeiro número (com possível R$ na frente)
  const match = cleaned.match(/(?:R\$\s*)?([\d.,]+)\s*(.*)$/i);

  if (!match) return null;

  const amount = parseBrazilianNumber(match[1]);
  if (!amount) return null;

  let description = (match[2] || '').trim();

  // Remove palavras de comando que sobraram
  description = description
    .replace(/^(gastei|gasto|despesa|paguei|recebi|entrada|receita|no|na|do|da|em|de)\s+/i, '')
    .trim();

  if (!description) description = 'Sem descrição';

  return { amount, description };
}

/**
 * Extrai apenas o valor de qualquer lugar da frase
 */
function extractAmount(text) {
  if (!text) return null;

  const match = text.match(/(?:R\$\s*)?([\d.,]+)/i);
  if (!match) return null;

  return parseBrazilianNumber(match[1]);
}

/**
 * Normaliza o número de telefone
 */
function normalizePhone(jid) {
  if (!jid) return '';
  return String(jid).split('@')[0].replace(/\D/g, '');
}

/**
 * Verifica se o número está autorizado
 */
function isAllowed(phone) {
  const allowed = process.env.ALLOWED_NUMBERS;
  if (!allowed || allowed.trim() === '') return true;

  const list = allowed.split(',').map(n => n.replace(/\D/g, '').trim()).filter(Boolean);
  return list.includes(phone);
}

/**
 * Formata data amigável
 */
function formatDate(dateStr) {
  try {
    const d = new Date(dateStr);
    return d.toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  } catch {
    return dateStr;
  }
}

/**
 * Tenta extrair nome de conta/cartão do texto
 */
function extractAccountFromText(text) {
  const lower = text.toLowerCase();

  const patterns = [
    /(?:no|na|do|da|em|pelo|pela)\s+([a-z0-9\s]{2,30}?)(?:\s|$|,|\.|!|\?)/i,
    /cart[aã]o\s+([a-z0-9\s]{2,20})/i,
    /conta\s+([a-z0-9\s]{2,20})/i
  ];

  for (const pattern of patterns) {
    const match = lower.match(pattern);
    if (match && match[1]) {
      let name = match[1].trim();
      name = name.replace(/\b(reais?|real|r\$|de|do|da|no|na|em|com|para|por)\b/gi, '').trim();
      if (name.length >= 2) return name;
    }
  }

  return null;
}

module.exports = {
  formatCurrency,
  parseBrazilianNumber,
  parseAmountAndDescription,
  extractAmount,
  normalizePhone,
  isAllowed,
  formatDate,
  extractAccountFromText
};
