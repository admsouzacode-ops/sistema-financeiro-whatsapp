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
 * Extrai número e descrição de textos como:
 * "45,90 almoço"
 * "100.50 uber para o aeroporto"
 * "2500"
 */
function parseAmountAndDescription(text) {
  const cleaned = text.trim();
  // Captura número no início (aceita 1.234,56 ou 1234.56 ou 1234,56)
  const match = cleaned.match(/^([\d.,]+)\s*(.*)$/);

  if (!match) return null;

  let amountStr = match[1]
    .replace(/\./g, '') // remove pontos de milhar
    .replace(',', '.'); // troca vírgula decimal por ponto

  const amount = parseFloat(amountStr);
  if (isNaN(amount) || amount <= 0) return null;

  const description = (match[2] || '').trim() || 'Sem descrição';

  return { amount, description };
}

/**
 * Normaliza o número de telefone (remove tudo que não é dígito)
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

module.exports = {
  formatCurrency,
  parseAmountAndDescription,
  normalizePhone,
  isAllowed,
  formatDate
};
