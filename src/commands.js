const {
  addTransaction,
  getBalance,
  getBalanceForPeriod,
  getMonthRange,
  getTransactions,
  getTransactionsForPeriod,
  getSummaryByCategory,
  deleteLastTransaction,
  getOrCreateAccount,
  findAccount,
  getAccounts,
  updateAccountBalance
} = require('./db');
const { sendText, getMediaBase64 } = require('./evolution');
const { transcribeAudio } = require('./transcription');
const {
  formatCurrency,
  parseAmountAndDescription,
  extractAmount,
  normalizePhone,
  isAllowed,
  formatDate,
  extractAccountFromText
} = require('./utils');

const HELP_TEXT = `📊 *Sistema Financeiro — MEI*

*Comandos principais:*

💰 *saldo* — Visão geral (todo o histórico)
📅 *mês* — Resumo do mês atual
📅 *mês passado* — Resumo do mês anterior
📋 *extrato* — Últimas movimentações
📋 *extrato mês* — Movimentações deste mês
🏦 *contas* — Todas as contas e cartões
💳 *cartões* — Só os cartões e dívidas

*Registrar:*
📥 *entrada 2500 salário*
📤 *gastei 45,90 almoço*
📤 *gastei 200 no Nubank*

*Cartões:*
• "gastei 50 no Nubank" → soma na dívida
• "paguei o Nubank" → quita a dívida
• "paguei 1000 do Nubank" → pagamento parcial

🗑️ *desfazer* — Remove a última movimentação

🎤 *Pode mandar áudio também!*`;

async function handleWebhook(payload) {
  const event = (payload.event || '').toLowerCase().replace(/_/g, '.');
  if (event !== 'messages.upsert') return;

  const data = payload.data;
  if (!data || !data.key) return;
  if (data.key.fromMe) return;

  const remoteJid = data.key.remoteJid || '';
  if (remoteJid.endsWith('@g.us')) return;

  const phone = normalizePhone(remoteJid);
  if (!phone || !isAllowed(phone)) return;

  // ÁUDIO
  if (data.message?.audioMessage) {
    console.log(`[${phone}] 🎧 Áudio recebido`);
    await sendText(phone, '🎧 Processando seu áudio...');

    try {
      const media = await getMediaBase64(data.key);
      if (!media?.base64) {
        await sendText(phone, '❌ Não consegui baixar o áudio.');
        return;
      }

      const transcribed = await transcribeAudio(media.base64, media.mimetype);
      if (!transcribed) {
        await sendText(phone, '❌ Não consegui entender o áudio. Tente de novo ou mande em texto.');
        return;
      }

      console.log(`[${phone}] Transcrito: ${transcribed}`);
      const reply = await processCommand(phone, transcribed);
      if (reply) {
        await sendText(phone, `🎤 *Entendi:* "${transcribed}"\n\n${reply}`);
      }
    } catch (err) {
      console.error('Erro áudio:', err);
      await sendText(phone, '❌ Erro ao processar o áudio.');
    }
    return;
  }

  // TEXTO
  let text = data.message?.conversation || data.message?.extendedTextMessage?.text || '';
  text = text.trim();
  if (!text) return;

  console.log(`[${phone}] ${text}`);
  const reply = await processCommand(phone, text);
  if (reply) await sendText(phone, reply);
}

async function processCommand(phone, text) {
  const lower = text.toLowerCase().trim();
  const cmd = lower.startsWith('/') ? lower.slice(1) : lower;

  // Ignora mensagens muito curtas que são claramente respostas de outras automações
  // (ex: "1", "2", "3", "sim", "não")
  if (/^\d{1,2}$/.test(cmd) || ['sim', 'não', 'nao', 'ok', 's', 'n'].includes(cmd)) {
    return null; // não responde nada
  }

  // AJUDA
  if (['ajuda', 'help', 'menu', 'comandos', 'inicio', 'start'].includes(cmd)) {
    return HELP_TEXT;
  }

  // ===== MÊS ATUAL =====
  if (
    cmd === 'mês' || cmd === 'mes' ||
    cmd === 'esse mês' || cmd === 'esse mes' ||
    cmd === 'mês atual' || cmd === 'mes atual' ||
    cmd === 'este mês' || cmd === 'este mes' ||
    cmd.includes('resumo do mês') || cmd.includes('resumo do mes') ||
    cmd.includes('quanto gastei esse mês') || cmd.includes('quanto gastei esse mes')
  ) {
    return formatMonthSummary(phone, 'current');
  }

  // ===== MÊS PASSADO =====
  if (
    cmd === 'mês passado' || cmd === 'mes passado' ||
    cmd === 'mês anterior' || cmd === 'mes anterior' ||
    cmd.includes('mês passado') || cmd.includes('mes passado')
  ) {
    return formatMonthSummary(phone, 'previous');
  }

  // ===== EXTRATO DO MÊS =====
  if (
    cmd === 'extrato mês' || cmd === 'extrato mes' ||
    cmd === 'extrato do mês' || cmd === 'extrato do mes' ||
    cmd.includes('extrato mês') || cmd.includes('extrato mes')
  ) {
    return formatMonthExtrato(phone, 'current');
  }

  // ===== CONTAS / CARTÕES =====
  if (cmd === 'contas' || cmd === 'conta' || cmd.includes('minhas contas')) {
    return formatAccountsList(phone);
  }

  if (cmd === 'cartões' || cmd === 'cartoes' || cmd === 'cartão' || cmd === 'cartao' || cmd.includes('meus cartões') || cmd.includes('meus cartoes')) {
    return formatCardsList(phone);
  }

  // Criar conta / cartão
  if (cmd.startsWith('criar cartão ') || cmd.startsWith('criar cartao ') || cmd.startsWith('novo cartão ') || cmd.startsWith('novo cartao ')) {
    const name = text.replace(/^(criar|novo)\s+cart[aã]o\s+/i, '').trim();
    if (!name) return '❌ Diga o nome do cartão.\nEx: *criar cartão Nubank*';

    const account = getOrCreateAccount(phone, name, 'credit');
    return `✅ Cartão *${account.display_name}* criado!\n\nAgora é só falar:\n• "gastei 100 no ${account.display_name}"\n• "paguei o ${account.display_name}"`;
  }

  if (cmd.startsWith('criar conta ') || cmd.startsWith('nova conta ')) {
    const name = text.replace(/^(criar|nova)\s+conta\s+/i, '').trim();
    if (!name) return '❌ Diga o nome da conta.\nEx: *criar conta Inter*';

    const account = getOrCreateAccount(phone, name, 'debit');
    return `✅ Conta *${account.display_name}* criada!`;
  }

  // ===== PAGAR CARTÃO =====
  if (cmd.startsWith('paguei ') || cmd.startsWith('pagar ') || cmd.startsWith('paguei o ') || cmd.startsWith('paguei a ')) {
    return handlePayment(phone, text);
  }

  // ===== SALDO GERAL =====
  if (cmd === 'saldo' || cmd === 'balance' || cmd.includes('meu saldo') || cmd.includes('qual meu saldo') || cmd.includes('qual é o meu saldo')) {
    return formatFullBalance(phone);
  }

  // ===== ENTRADA / RECEITA =====
  if (
    cmd.startsWith('entrada ') || cmd.startsWith('receita ') || cmd.startsWith('renda ') ||
    cmd.startsWith('recebi ') || cmd.startsWith('ganhei ') ||
    cmd.includes('entrada de') || cmd.includes('receita de')
  ) {
    return handleIncome(phone, text);
  }

  // ===== GASTO / DESPESA (só com palavras-chave claras) =====
  if (
    cmd.startsWith('gasto ') || cmd.startsWith('despesa ') || cmd.startsWith('saida ') ||
    cmd.startsWith('gastei ') || cmd.includes('gastei ')
  ) {
    return handleExpense(phone, text);
  }

  // Frases naturais de gasto (agora bem mais rigoroso)
  const naturalExpense = tryNaturalExpense(phone, text);
  if (naturalExpense) return naturalExpense;

  // ===== EXTRATO GERAL =====
  if (cmd === 'extrato' || cmd.startsWith('extrato ') || cmd.includes('extrato') || cmd.includes('últimas') || cmd.includes('ultimas')) {
    let limit = 10;
    const match = cmd.match(/(\d+)/);
    if (match) limit = Math.min(Math.max(parseInt(match[1], 10), 1), 50);

    const txs = getTransactions(phone, limit);
    if (txs.length === 0) return '📭 Nenhuma movimentação ainda.';

    let msg = `📋 *Últimas ${txs.length} movimentações*\n\n`;
    for (const tx of txs) {
      const icon = tx.type === 'income' ? '📥' : tx.type === 'payment' ? '💳' : '📤';
      const sign = tx.type === 'income' ? '+' : '-';
      msg += `${icon} ${sign}${formatCurrency(tx.amount)}`;
      if (tx.account_name) msg += ` · ${tx.account_name}`;
      msg += `\n   ${tx.description}\n`;
      msg += `   ${formatDate(tx.created_at)} · #${tx.id}\n\n`;
    }

    const { balance } = getBalance(phone);
    msg += `━━━━━━━━━━━━━━\n💰 Saldo geral: *${formatCurrency(balance)}*`;
    return msg;
  }

  // ===== RESUMO =====
  if (cmd === 'resumo' || cmd === 'categorias' || cmd === 'relatorio' || cmd.includes('resumo')) {
    const summary = getSummaryByCategory(phone);
    if (summary.length === 0) return '📭 Nenhuma movimentação para resumir.';

    let msg = '📊 *Resumo por categoria*\n\n';
    const incomes = summary.filter(s => s.type === 'income');
    const expenses = summary.filter(s => s.type === 'expense');

    if (incomes.length) {
      msg += '*Receitas:*\n';
      for (const s of incomes) msg += `📥 ${s.category}: ${formatCurrency(s.total)} (${s.count}x)\n`;
      msg += '\n';
    }
    if (expenses.length) {
      msg += '*Despesas:*\n';
      for (const s of expenses) msg += `📤 ${s.category}: ${formatCurrency(s.total)} (${s.count}x)\n`;
    }

    const { balance } = getBalance(phone);
    msg += `\n━━━━━━━━━━━━━━\n💰 Saldo: *${formatCurrency(balance)}*`;
    return msg;
  }

  // ===== DESFAZER =====
  if (cmd === 'desfazer' || cmd === 'undo' || cmd === 'apagar' || cmd.includes('desfazer')) {
    const id = deleteLastTransaction(phone);
    if (!id) return '📭 Nenhuma movimentação para desfazer.';
    const { balance } = getBalance(phone);
    return `🗑️ Movimentação #${id} removida.\n\nSaldo geral: *${formatCurrency(balance)}*`;
  }

  // Mensagens que não são comandos → não responde (evita interferir em outras conversas)
  return null;
}

// ==================== HELPERS ====================

function formatMonthSummary(phone, which = 'current') {
  const range = getMonthRange(which);
  const { income, expense, balance } = getBalanceForPeriod(phone, range.start, range.end);

  const title = which === 'current' ? '📅 *Mês Atual*' : '📅 *Mês Passado*';

  let msg = `${title} — ${range.label}\n\n`;
  msg += `📥 Receitas: ${formatCurrency(income)}\n`;
  msg += `📤 Despesas: ${formatCurrency(expense)}\n`;
  msg += `━━━━━━━━━━━━━━\n`;

  const emoji = balance >= 0 ? '🟢' : '🔴';
  msg += `${emoji} *Resultado do mês: ${formatCurrency(balance)}*`;

  const txs = getTransactionsForPeriod(phone, range.start, range.end, 1000);
  if (txs.length > 0) {
    msg += `\n\n📋 ${txs.length} movimentação(ões) neste mês`;
  } else {
    msg += `\n\n📭 Nenhuma movimentação neste mês ainda.`;
  }

  return msg;
}

function formatMonthExtrato(phone, which = 'current') {
  const range = getMonthRange(which);
  const txs = getTransactionsForPeriod(phone, range.start, range.end, 30);

  if (txs.length === 0) {
    return `📭 Nenhuma movimentação em *${range.label}*.`;
  }

  let msg = `📋 *Extrato — ${range.label}*\n\n`;

  for (const tx of txs) {
    const icon = tx.type === 'income' ? '📥' : tx.type === 'payment' ? '💳' : '📤';
    const sign = tx.type === 'income' ? '+' : '-';
    msg += `${icon} ${sign}${formatCurrency(tx.amount)}`;
    if (tx.account_name) msg += ` · ${tx.account_name}`;
    msg += `\n   ${tx.description}\n`;
    msg += `   ${formatDate(tx.created_at)} · #${tx.id}\n\n`;
  }

  const { income, expense, balance } = getBalanceForPeriod(phone, range.start, range.end);
  msg += `━━━━━━━━━━━━━━\n`;
  msg += `📥 ${formatCurrency(income)}  📤 ${formatCurrency(expense)}\n`;
  msg += `💰 Resultado: *${formatCurrency(balance)}*`;

  return msg;
}

function formatFullBalance(phone) {
  const { income, expense, balance } = getBalance(phone);
  const accounts = getAccounts(phone);
  const currentMonth = getMonthRange('current');
  const monthData = getBalanceForPeriod(phone, currentMonth.start, currentMonth.end);

  let msg = `💰 *Visão Geral*\n\n`;
  msg += `📥 Receitas (total): ${formatCurrency(income)}\n`;
  msg += `📤 Despesas (total): ${formatCurrency(expense)}\n`;
  msg += `━━━━━━━━━━━━━━\n`;
  msg += `💵 *Saldo geral: ${formatCurrency(balance)}*\n`;

  msg += `\n📅 *${currentMonth.label}*\n`;
  msg += `   Receitas: ${formatCurrency(monthData.income)}\n`;
  msg += `   Despesas: ${formatCurrency(monthData.expense)}\n`;
  msg += `   Resultado: *${formatCurrency(monthData.balance)}*\n`;

  if (accounts.length > 0) {
    msg += `\n🏦 *Contas & Cartões*\n`;
    for (const acc of accounts) {
      if (acc.type === 'credit') {
        const debt = acc.balance;
        msg += debt > 0
          ? `💳 ${acc.display_name}: *deve ${formatCurrency(debt)}*\n`
          : `💳 ${acc.display_name}: sem dívida\n`;
      } else {
        msg += `🏦 ${acc.display_name}: ${formatCurrency(acc.balance)}\n`;
      }
    }
  }

  return msg;
}

function formatAccountsList(phone) {
  const accounts = getAccounts(phone);
  if (accounts.length === 0) {
    return '📭 Nenhuma conta cadastrada ainda.\n\nCrie com:\n• *criar cartão Nubank*\n• *criar conta Inter*\n\nOu simplesmente fale "gastei 50 no Nubank" que ele cria sozinho.';
  }

  let msg = '🏦 *Suas Contas & Cartões*\n\n';
  for (const acc of accounts) {
    if (acc.type === 'credit') {
      msg += acc.balance > 0
        ? `💳 *${acc.display_name}* → deve ${formatCurrency(acc.balance)}\n`
        : `💳 *${acc.display_name}* → sem dívida\n`;
    } else {
      msg += `🏦 *${acc.display_name}* → ${formatCurrency(acc.balance)}\n`;
    }
  }
  return msg;
}

function formatCardsList(phone) {
  const accounts = getAccounts(phone).filter(a => a.type === 'credit');
  if (accounts.length === 0) {
    return '📭 Nenhum cartão cadastrado.\n\nCrie com: *criar cartão Nubank*\nOu fale "gastei 100 no Nubank".';
  }

  let msg = '💳 *Seus Cartões*\n\n';
  let totalDebt = 0;
  for (const acc of accounts) {
    totalDebt += acc.balance;
    msg += acc.balance > 0
      ? `• *${acc.display_name}*: deve ${formatCurrency(acc.balance)}\n`
      : `• *${acc.display_name}*: sem dívida\n`;
  }
  msg += `\n━━━━━━━━━━━━━━\n💸 *Total em dívidas: ${formatCurrency(totalDebt)}*`;
  return msg;
}

function handleExpense(phone, text) {
  let cleanText = text
    .replace(/^(gastei|gasto|despesa|saida)\s+/i, '')
    .replace(/^R\$\s*/i, '')
    .trim();

  const parsed = parseAmountAndDescription(cleanText) || parseAmountAndDescription(text);
  if (!parsed) {
    return '❌ Não identifiquei o valor.\nEx: *gastei 45,90 almoço* ou *gastei 200 no Nubank*';
  }

  return registerExpense(phone, parsed, text);
}

function registerExpense(phone, parsed, originalText) {
  const accountName = extractAccountFromText(originalText) || extractAccountFromText(parsed.description);
  let account = null;

  if (accountName) {
    const isLikelyCredit = /nubank|inter|c6|neon|will|picpay|cart[aã]o|credit|ita[uú]|bradesco|santander|bb|caixa/i.test(accountName) ||
                           /nubank|inter|c6|neon|will|picpay|cart[aã]o|credit/i.test(originalText);
    account = getOrCreateAccount(phone, accountName, isLikelyCredit ? 'credit' : 'debit');
  }

  const id = addTransaction(phone, 'expense', parsed.amount, parsed.description, 'Geral', account?.id || null);

  if (account && account.type === 'credit') {
    updateAccountBalance(account.id, parsed.amount);
  } else if (account && account.type === 'debit') {
    updateAccountBalance(account.id, -parsed.amount);
  }

  const { balance } = getBalance(phone);
  let msg = `✅ *Despesa registrada!*\n\n💸 ${formatCurrency(parsed.amount)}\n📝 ${parsed.description}`;

  if (account) {
    msg += `\n🏦 ${account.display_name}`;
    if (account.type === 'credit') {
      const updated = findAccount(phone, account.name);
      msg += ` (dívida agora: ${formatCurrency(updated.balance)})`;
    }
  }

  msg += `\n🆔 #${id}\n\nSaldo geral: *${formatCurrency(balance)}*`;
  return msg;
}

function handleIncome(phone, text) {
  let cleanText = text
    .replace(/^(entrada|receita|renda|recebi|ganhei)\s+/i, '')
    .replace(/entrada de\s+/i, '')
    .replace(/receita de\s+/i, '')
    .replace(/^R\$\s*/i, '')
    .trim();

  const parsed = parseAmountAndDescription(cleanText) || parseAmountAndDescription(text);
  if (!parsed) {
    return '❌ Não identifiquei o valor.\nEx: *entrada 2500 salário* ou *recebi 1800 do cliente*';
  }

  const accountName = extractAccountFromText(text) || extractAccountFromText(parsed.description);
  let account = null;
  if (accountName) {
    account = getOrCreateAccount(phone, accountName, 'debit');
  }

  const id = addTransaction(phone, 'income', parsed.amount, parsed.description, 'Geral', account?.id || null);

  if (account) {
    updateAccountBalance(account.id, parsed.amount);
  }

  const { balance } = getBalance(phone);
  let msg = `✅ *Receita registrada!*\n\n💰 ${formatCurrency(parsed.amount)}\n📝 ${parsed.description}`;
  if (account) msg += `\n🏦 ${account.display_name}`;
  msg += `\n🆔 #${id}\n\nSaldo geral: *${formatCurrency(balance)}*`;
  return msg;
}

function handlePayment(phone, text) {
  const amount = extractAmount(text);
  let accountName = extractAccountFromText(text);

  if (!accountName) {
    const cleaned = text
      .toLowerCase()
      .replace(/paguei|pagar|o|a|do|da|cart[aã]o|conta|de|reais?|r\$/gi, '')
      .replace(/[\d.,]/g, '')
      .trim();
    if (cleaned.length >= 2) accountName = cleaned;
  }

  if (!accountName) {
    return '❌ Não identifiquei o cartão/conta.\nEx: *paguei o Nubank* ou *paguei 1500 do Nubank*';
  }

  let account = findAccount(phone, accountName);
  if (!account) {
    account = getOrCreateAccount(phone, accountName, 'credit');
  }

  if (account.type !== 'credit') {
    return `ℹ️ *${account.display_name}* não é um cartão de crédito.\nUse "gastei" ou "entrada" para movimentar contas normais.`;
  }

  const currentDebt = account.balance;

  if (currentDebt <= 0) {
    return `✅ O cartão *${account.display_name}* não tem dívida no momento.`;
  }

  const payAmount = amount && amount > 0 ? Math.min(amount, currentDebt) : currentDebt;

  const id = addTransaction(
    phone,
    'payment',
    payAmount,
    `Pagamento ${account.display_name}`,
    'Pagamento Cartão',
    account.id
  );

  updateAccountBalance(account.id, -payAmount);

  const remaining = currentDebt - payAmount;

  let msg = `✅ *Pagamento registrado!*\n\n💳 ${account.display_name}\n💸 ${formatCurrency(payAmount)}`;
  if (remaining > 0) {
    msg += `\n\nAinda resta: *${formatCurrency(remaining)}*`;
  } else {
    msg += `\n\n🎉 *Cartão quitado!*`;
  }
  msg += `\n🆔 #${id}`;

  return msg;
}

/**
 * Só aceita gasto natural se tiver INTENÇÃO CLARA:
 * - Tem R$ ou "reais"
 * - Ou tem indicação de conta/cartão ("no Nubank")
 * - E NÃO é só um número isolado
 */
function tryNaturalExpense(phone, text) {
  const trimmed = text.trim();

  // Bloqueia números isolados (1, 2, 3, 50, 100...)
  if (/^[\d.,]+$/.test(trimmed)) {
    return null;
  }

  // Bloqueia mensagens muito curtas sem contexto
  if (trimmed.length < 5) {
    return null;
  }

  const parsed = parseAmountAndDescription(text);
  if (!parsed) return null;

  const hasAccountHint = /\b(no|na|do|da|em|cart[aã]o|nubank|inter|c6|neon|will|picpay)\b/i.test(text);
  const hasCurrency = /R\$|reais?/i.test(text);
  const hasExpenseWord = /gastei|gasto|despesa|paguei|comprei|foi/i.test(text);

  // Só registra se tiver pelo menos uma indicação clara de intenção
  if (!hasAccountHint && !hasCurrency && !hasExpenseWord) {
    return null;
  }

  return registerExpense(phone, parsed, text);
}

module.exports = {
  handleWebhook,
  processCommand
};
