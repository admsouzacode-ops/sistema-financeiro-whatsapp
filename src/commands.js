const {
  addTransaction,
  getBalance,
  getTransactions,
  getSummaryByCategory,
  deleteLastTransaction
} = require('./db');
const { sendText, getMediaBase64 } = require('./evolution');
const { transcribeAudio } = require('./transcription');
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

🎤 *Você também pode enviar áudio!*
Ex: "gastei 50 no mercado" ou "entrada de 2000 do salário"

_Valores aceitam vírgula ou ponto (ex: 45,90 ou 45.90)_`;

async function handleWebhook(payload) {
  // Aceita tanto "messages.upsert" quanto "MESSAGES_UPSERT"
  const event = (payload.event || '').toLowerCase().replace(/_/g, '.');

  if (event !== 'messages.upsert') {
    return;
  }

  const data = payload.data;
  if (!data || !data.key) return;

  // Ignora mensagens enviadas por mim mesmo
  if (data.key.fromMe) return;

  // Ignora grupos
  const remoteJid = data.key.remoteJid || '';
  if (remoteJid.endsWith('@g.us')) return;

  const phone = normalizePhone(remoteJid);
  if (!phone) return;

  if (!isAllowed(phone)) {
    console.log(`Número não autorizado: ${phone}`);
    return;
  }

  // ===== ÁUDIO =====
  if (data.message?.audioMessage) {
    console.log(`[${phone}] 🎧 Áudio recebido`);

    // Avisa que está processando
    await sendText(phone, '🎧 Processando seu áudio, aguarde...');

    try {
      const media = await getMediaBase64(data.key);

      if (!media || !media.base64) {
        await sendText(phone, '❌ Não consegui baixar o áudio. Tente novamente.');
        return;
      }

      const transcribed = await transcribeAudio(media.base64, media.mimetype);

      if (!transcribed) {
        await sendText(phone, '❌ Não consegui entender o áudio. Tente falar mais claramente ou envie em texto.');
        return;
      }

      console.log(`[${phone}] Transcrito: ${transcribed}`);

      // Processa o texto transcrito como se fosse um comando normal
      const reply = await processCommand(phone, transcribed);

      if (reply) {
        // Mostra o que foi entendido + a resposta
        await sendText(phone, `🎤 *Entendi:* "${transcribed}"\n\n${reply}`);
      }
    } catch (err) {
      console.error('Erro ao processar áudio:', err);
      await sendText(phone, '❌ Ocorreu um erro ao processar o áudio. Tente novamente.');
    }

    return;
  }

  // ===== TEXTO =====
  let text = '';
  if (data.message?.conversation) {
    text = data.message.conversation;
  } else if (data.message?.extendedTextMessage?.text) {
    text = data.message.extendedTextMessage.text;
  } else {
    return; // Tipo de mensagem não suportado
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

    return `${emoji} *Seu saldo atual*\n\n` +
      `📥 Receitas: ${formatCurrency(income)}\n` +
      `📤 Despesas: ${formatCurrency(expense)}\n` +
      `━━━━━━━━━━━━━━\n` +
      `💰 *Saldo: ${formatCurrency(balance)}*`;
  }

  // ENTRADA / RECEITA (também aceita frases naturais do áudio)
  if (
    cmd.startsWith('entrada ') ||
    cmd.startsWith('receita ') ||
    cmd.startsWith('renda ') ||
    cmd.startsWith('recebi ') ||
    cmd.startsWith('ganhei ') ||
    cmd.includes('entrada de') ||
    cmd.includes('receita de')
  ) {
    // Tenta extrair valor e descrição de forma mais flexível
    let parts = text
      .replace(/^\/?entrada\s+|^\/?receita\s+|^\/?renda\s+/i, '')
      .replace(/^(recebi|ganhei)\s+/i, '')
      .replace(/entrada de\s+/i, '')
      .replace(/receita de\s+/i, '')
      .trim();

    const parsed = parseAmountAndDescription(parts);

    if (!parsed) {
      return '❌ Não consegui identificar o valor.\nExemplo: *entrada 2500 salário* ou diga "recebi 2500 do salário"';
    }

    const id = addTransaction(phone, 'income', parsed.amount, parsed.description);
    const { balance } = getBalance(phone);

    return `✅ *Receita registrada!*\n\n` +
      `💰 Valor: ${formatCurrency(parsed.amount)}\n` +
      `📝 ${parsed.description}\n` +
      `🆔 #${id}\n\n` +
      `Saldo atual: *${formatCurrency(balance)}*`;
  }

  // GASTO / DESPESA (aceita frases naturais)
  if (
    cmd.startsWith('gasto ') ||
    cmd.startsWith('despesa ') ||
    cmd.startsWith('saida ') ||
    cmd.startsWith('gastei ') ||
    cmd.startsWith('paguei ') ||
    cmd.includes('gastei ') ||
    cmd.includes('paguei ')
  ) {
    let parts = text
      .replace(/^\/?gasto\s+|^\/?despesa\s+|^\/?saida\s+/i, '')
      .replace(/^(gastei|paguei)\s+/i, '')
      .trim();

    const parsed = parseAmountAndDescription(parts);

    if (!parsed) {
      return '❌ Não consegui identificar o valor.\nExemplo: *gasto 45,90 almoço* ou diga "gastei 50 no mercado"';
    }

    const id = addTransaction(phone, 'expense', parsed.amount, parsed.description);
    const { balance } = getBalance(phone);

    return `✅ *Despesa registrada!*\n\n` +
      `💸 Valor: ${formatCurrency(parsed.amount)}\n` +
      `📝 ${parsed.description}\n` +
      `🆔 #${id}\n\n` +
      `Saldo atual: *${formatCurrency(balance)}*`;
  }

  // EXTRATO
  if (cmd === 'extrato' || cmd.startsWith('extrato ') || cmd.includes('extrato') || cmd.includes('últimas') || cmd.includes('ultimas')) {
    let limit = 10;
    const match = cmd.match(/(\d+)/);
    if (match) {
      limit = Math.min(Math.max(parseInt(match[1], 10), 1), 50);
    }

    const txs = getTransactions(phone, limit);

    if (txs.length === 0) {
      return '📭 Nenhuma transação encontrada.';
    }

    let msg = `📋 *Últimas ${txs.length} transações*\n\n`;

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

  // RESUMO
  if (cmd === 'resumo' || cmd === 'categorias' || cmd === 'relatorio' || cmd.includes('resumo')) {
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

  // DESFAZER
  if (cmd === 'desfazer' || cmd === 'undo' || cmd === 'apagar' || cmd.includes('desfazer') || cmd.includes('apagar última')) {
    const id = deleteLastTransaction(phone);
    if (!id) {
      return '📭 Nenhuma transação para desfazer.';
    }
    const { balance } = getBalance(phone);
    return `🗑️ Transação #${id} removida.\n\nSaldo atual: *${formatCurrency(balance)}*`;
  }

  // Comando não reconhecido
  return `❓ Não entendi o comando.\n\nDigite *ajuda* para ver os comandos disponíveis.\n\nOu envie um áudio dizendo por exemplo:\n• "gastei 50 no mercado"\n• "recebi 2000 do salário"`;
}

module.exports = {
  handleWebhook,
  processCommand
};
