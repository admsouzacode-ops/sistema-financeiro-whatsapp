const {
  addTransaction,
  getBalance,
  getTransactions,
  getSummaryByCategory,
  deleteLastTransaction
} = require('./db');
const { sendText } = require('./evolution');
const {
  formatCurrency,
  parseAmountAndDescription,
  normalizePhone,
  isAllowed,
  formatDate
} = require('./utils');

const HELP_TEXT = `📊 *Sistema Financeiro WhatsApp*

Comandos disponíveis:

💰 *saldo* — Ver saldo atual

📥 *entrada <valor> <descrição>*
Ex: entrada 2500 salário
Ex: receita 150 freelance

📤 *gasto <valor> <descrição>*
Ex: gasto 45,90 almoço
Ex: despesa 100 uber

📋 *extrato* — Últimas 10 transações
📋 *extrato 20* — Últimas 20 transações

📊 *resumo* — Resumo por categoria

🗑️ *desfazer* — Remove a última transação

ℹ️ *ajuda* — Mostra esta mensagem

_Valores aceitam vírgula ou ponto (ex: 45,90 ou 45.90)_`;

async function handleWebhook(payload) {
  // Aceita tanto "messages.upsert" quanto "MESSAGES_UPSERT"
  const event = (payload.event || '').toLowerCase().replace(/_/g, '.');

  if (event !== 'messages.upsert') {
    return; // Ignora outros eventos
  }

  const data = payload.data;
  if (!data || !data.key) return;

  // Ignora mensagens enviadas por mim mesmo
  if (data.key.fromMe) return;

  // Ignora grupos (opcional — remova se quiser suportar grupos)
  const remoteJid = data.key.remoteJid || '';
  if (remoteJid.endsWith('@g.us')) return;

  const phone = normalizePhone(remoteJid);
  if (!phone) return;

  if (!isAllowed(phone)) {
    console.log(`Número não autorizado: ${phone}`);
    return;
  }

  // Extrai o texto da mensagem
  let text = '';
  if (data.message?.conversation) {
    text = data.message.conversation;
  } else if (data.message?.extendedTextMessage?.text) {
    text = data.message.extendedTextMessage.text;
  } else {
    return; // Não é texto
  }

  text = text.trim();
  if (!text) return;

  console.log(`[${phone}] ${text}`);

  const reply = await processCommand(phone, text);
  if (reply) {
    await sendText(phone, reply);
  }
}

async function processCommand(phone, text) {
  const lower = text.toLowerCase().trim();

  // Remove / se existir
  const cmd = lower.startsWith('/') ? lower.slice(1) : lower;

  // AJUDA
  if (['ajuda', 'help', 'menu', 'comandos', 'inicio', 'start'].includes(cmd) || cmd === '') {
    return HELP_TEXT;
  }

  // SALDO
  if (cmd === 'saldo' || cmd === 'balance') {
    const { income, expense, balance } = getBalance(phone);
    const emoji = balance >= 0 ? '🟢' : '🔴';

    return `${emoji} *Seu saldo atual*

` +
      `📥 Receitas: ${formatCurrency(income)}
` +
      `📤 Despesas: ${formatCurrency(expense)}
` +
      `━━━━━━━━━━━━━━
` +
      `💰 *Saldo: ${formatCurrency(balance)}*`;
  }

  // ENTRADA / RECEITA
  if (cmd.startsWith('entrada ') || cmd.startsWith('receita ') || cmd.startsWith('renda ')) {
    const parts = text.replace(/^\/?entrada\s+|^\/?receita\s+|^\/?renda\s+/i, '').trim();
    const parsed = parseAmountAndDescription(parts);

    if (!parsed) {
      return '❌ Formato inválido.\nUse: *entrada 2500 salário*';
    }

    const id = addTransaction(phone, 'income', parsed.amount, parsed.description);
    const { balance } = getBalance(phone);

    return `✅ *Receita registrada!*

` +
      `💰 Valor: ${formatCurrency(parsed.amount)}
` +
      `📝 ${parsed.description}
` +
      `🆔 #${id}

` +
      `Saldo atual: *${formatCurrency(balance)}*`;
  }

  // GASTO / DESPESA
  if (cmd.startsWith('gasto ') || cmd.startsWith('despesa ') || cmd.startsWith('saida ')) {
    const parts = text.replace(/^\/?gasto\s+|^\/?despesa\s+|^\/?saida\s+/i, '').trim();
    const parsed = parseAmountAndDescription(parts);

    if (!parsed) {
      return '❌ Formato inválido.\nUse: *gasto 45,90 almoço*';
    }

    const id = addTransaction(phone, 'expense', parsed.amount, parsed.description);
    const { balance } = getBalance(phone);

    return `✅ *Despesa registrada!*

` +
      `💸 Valor: ${formatCurrency(parsed.amount)}
` +
      `📝 ${parsed.description}
` +
      `🆔 #${id}

` +
      `Saldo atual: *${formatCurrency(balance)}*`;
  }

  // EXTRATO
  if (cmd === 'extrato' || cmd.startsWith('extrato ')) {
    let limit = 10;
    const match = cmd.match(/extrato\s+(\d+)/);
    if (match) {
      limit = Math.min(Math.max(parseInt(match[1], 10), 1), 50);
    }

    const txs = getTransactions(phone, limit);

    if (txs.length === 0) {
      return '📭 Nenhuma transação encontrada.';
    }

    let msg = `📋 *Últimas ${txs.length} transações*

`;

    for (const tx of txs) {
      const icon = tx.type === 'income' ? '📥' : '📤';
      const sign = tx.type === 'income' ? '+' : '-';
      msg += `${icon} ${sign}${formatCurrency(tx.amount)}\n`;
      msg += `   ${tx.description}\n`;
      msg += `   ${formatDate(tx.created_at)} · #${tx.id}\n\n`;
    }

    const { balance } = getBalance(phone);
    msg += `━━━━━━━━━━━━━━\n💰 Saldo: *${formatCurrency(balance)}*`;

    return msg;
  }

  // RESUMO POR CATEGORIA
  if (cmd === 'resumo' || cmd === 'categorias' || cmd === 'relatorio') {
    const summary = getSummaryByCategory(phone);

    if (summary.length === 0) {
      return '📭 Nenhuma transação para resumir.';
    }

    let msg = '📊 *Resumo por categoria*\n\n';

    const incomes = summary.filter(s => s.type === 'income');
    const expenses = summary.filter(s => s.type === 'expense');

    if (incomes.length) {
      msg += '*Receitas:*\n';
      for (const s of incomes) {
        msg += `📥 ${s.category}: ${formatCurrency(s.total)} (${s.count}x)\n`;
      }
      msg += '\n';
    }

    if (expenses.length) {
      msg += '*Despesas:*\n';
      for (const s of expenses) {
        msg += `📤 ${s.category}: ${formatCurrency(s.total)} (${s.count}x)\n`;
      }
    }

    const { balance } = getBalance(phone);
    msg += `\n━━━━━━━━━━━━━━\n💰 Saldo: *${formatCurrency(balance)}*`;

    return msg;
  }

  // DESFAZER última
  if (cmd === 'desfazer' || cmd === 'undo' || cmd === 'apagar') {
    const id = deleteLastTransaction(phone);
    if (!id) {
      return '📭 Nenhuma transação para desfazer.';
    }
    const { balance } = getBalance(phone);
    return `🗑️ Transação #${id} removida.\n\nSaldo atual: *${formatCurrency(balance)}*`;
  }

  // Comando não reconhecido
  return `❓ Comando não reconhecido.\n\nDigite *ajuda* para ver os comandos disponíveis.`;
}

module.exports = {
  handleWebhook,
  processCommand
};
