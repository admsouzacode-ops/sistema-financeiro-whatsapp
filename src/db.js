const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

let db;

function initDb() {
  const dbPath = process.env.DATABASE_PATH || './data/financeiro.db';
  const dir = path.dirname(dbPath);

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      phone TEXT NOT NULL,
      name TEXT NOT NULL,
      display_name TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'debit' CHECK(type IN ('credit', 'debit')),
      balance REAL NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now', 'localtime')),
      UNIQUE(phone, name)
    );

    CREATE INDEX IF NOT EXISTS idx_accounts_phone ON accounts(phone);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      phone TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('income', 'expense', 'payment')),
      amount REAL NOT NULL CHECK(amount > 0),
      description TEXT,
      category TEXT DEFAULT 'Geral',
      account_id INTEGER,
      created_at TEXT DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (account_id) REFERENCES accounts(id)
    );

    CREATE INDEX IF NOT EXISTS idx_transactions_phone ON transactions(phone);
    CREATE INDEX IF NOT EXISTS idx_transactions_created ON transactions(created_at);
  `);

  try {
    const cols = db.prepare(`PRAGMA table_info(transactions)`).all();
    const hasAccountId = cols.some(c => c.name === 'account_id');
    if (!hasAccountId) {
      db.exec(`ALTER TABLE transactions ADD COLUMN account_id INTEGER`);
    }
  } catch (e) {}

  console.log('✅ Banco de dados inicializado:', dbPath);
  return db;
}

function getDb() {
  if (!db) throw new Error('Database not initialized. Call initDb() first.');
  return db;
}

// ==================== CONTAS ====================

function normalizeAccountName(name) {
  return String(name || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, '')
    .trim()
    .replace(/\s+/g, ' ');
}

function getOrCreateAccount(phone, rawName, type = 'debit') {
  const name = normalizeAccountName(rawName);
  if (!name) return null;

  let account = getDb().prepare(`
    SELECT * FROM accounts WHERE phone = ? AND name = ?
  `).get(phone, name);

  if (!account) {
    const display = rawName.trim().replace(/\b\w/g, l => l.toUpperCase());
    const result = getDb().prepare(`
      INSERT INTO accounts (phone, name, display_name, type, balance)
      VALUES (?, ?, ?, ?, 0)
    `).run(phone, name, display, type);

    account = getDb().prepare(`SELECT * FROM accounts WHERE id = ?`).get(result.lastInsertRowid);
  }

  return account;
}

function findAccount(phone, rawName) {
  const name = normalizeAccountName(rawName);
  if (!name) return null;
  return getDb().prepare(`
    SELECT * FROM accounts WHERE phone = ? AND name = ?
  `).get(phone, name);
}

function getAccounts(phone) {
  return getDb().prepare(`
    SELECT * FROM accounts
    WHERE phone = ?
    ORDER BY type DESC, display_name ASC
  `).all(phone);
}

function updateAccountBalance(accountId, delta) {
  getDb().prepare(`
    UPDATE accounts SET balance = balance + ? WHERE id = ?
  `).run(delta, accountId);
}

function setAccountBalance(accountId, value) {
  getDb().prepare(`
    UPDATE accounts SET balance = ? WHERE id = ?
  `).run(value, accountId);
}

// ==================== TRANSAÇÕES ====================

function addTransaction(phone, type, amount, description = '', category = 'Geral', accountId = null) {
  const stmt = getDb().prepare(`
    INSERT INTO transactions (phone, type, amount, description, category, account_id)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const result = stmt.run(
    phone,
    type,
    amount,
    description.trim(),
    category.trim() || 'Geral',
    accountId
  );
  return result.lastInsertRowid;
}

function getBalance(phone) {
  const row = getDb().prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END), 0) as income,
      COALESCE(SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END), 0) as expense
    FROM transactions
    WHERE phone = ?
  `).get(phone);

  return {
    income: row.income,
    expense: row.expense,
    balance: row.income - row.expense
  };
}

/**
 * Retorna o intervalo de datas de um mês
 * @param {'current'|'previous'} which
 */
function getMonthRange(which = 'current') {
  const now = new Date();
  let year = now.getFullYear();
  let month = now.getMonth(); // 0-11

  if (which === 'previous') {
    month -= 1;
    if (month < 0) {
      month = 11;
      year -= 1;
    }
  }

  const start = new Date(year, month, 1, 0, 0, 0);
  const end = new Date(year, month + 1, 0, 23, 59, 59); // último dia do mês

  const pad = (n) => String(n).padStart(2, '0');

  const startStr = `${start.getFullYear()}-${pad(start.getMonth() + 1)}-${pad(start.getDate())} 00:00:00`;
  const endStr = `${end.getFullYear()}-${pad(end.getMonth() + 1)}-${pad(end.getDate())} 23:59:59`;

  const monthNames = [
    'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
    'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
  ];

  return {
    start: startStr,
    end: endStr,
    label: `${monthNames[month]}/${year}`,
    month,
    year
  };
}

function getBalanceForPeriod(phone, start, end) {
  const row = getDb().prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END), 0) as income,
      COALESCE(SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END), 0) as expense
    FROM transactions
    WHERE phone = ?
      AND created_at >= ?
      AND created_at <= ?
  `).get(phone, start, end);

  return {
    income: row.income,
    expense: row.expense,
    balance: row.income - row.expense
  };
}

function getTransactionsForPeriod(phone, start, end, limit = 50) {
  return getDb().prepare(`
    SELECT t.id, t.type, t.amount, t.description, t.category, t.created_at,
           a.display_name as account_name
    FROM transactions t
    LEFT JOIN accounts a ON a.id = t.account_id
    WHERE t.phone = ?
      AND t.created_at >= ?
      AND t.created_at <= ?
    ORDER BY t.created_at DESC, t.id DESC
    LIMIT ?
  `).all(phone, start, end, limit);
}

function getTransactions(phone, limit = 10) {
  return getDb().prepare(`
    SELECT t.id, t.type, t.amount, t.description, t.category, t.created_at,
           a.display_name as account_name
    FROM transactions t
    LEFT JOIN accounts a ON a.id = t.account_id
    WHERE t.phone = ?
    ORDER BY t.created_at DESC, t.id DESC
    LIMIT ?
  `).all(phone, limit);
}

function getSummaryByCategory(phone) {
  return getDb().prepare(`
    SELECT
      category,
      type,
      SUM(amount) as total,
      COUNT(*) as count
    FROM transactions
    WHERE phone = ? AND type IN ('income', 'expense')
    GROUP BY category, type
    ORDER BY total DESC
  `).all(phone);
}

function deleteLastTransaction(phone) {
  const last = getDb().prepare(`
    SELECT id, type, amount, account_id
    FROM transactions
    WHERE phone = ?
    ORDER BY created_at DESC, id DESC
    LIMIT 1
  `).get(phone);

  if (!last) return null;

  if (last.account_id) {
    if (last.type === 'expense') {
      updateAccountBalance(last.account_id, -last.amount);
    } else if (last.type === 'payment') {
      updateAccountBalance(last.account_id, last.amount);
    } else if (last.type === 'income') {
      updateAccountBalance(last.account_id, -last.amount);
    }
  }

  getDb().prepare('DELETE FROM transactions WHERE id = ?').run(last.id);
  return last.id;
}

module.exports = {
  initDb,
  getDb,
  normalizeAccountName,
  getOrCreateAccount,
  findAccount,
  getAccounts,
  updateAccountBalance,
  setAccountBalance,
  addTransaction,
  getBalance,
  getBalanceForPeriod,
  getMonthRange,
  getTransactions,
  getTransactionsForPeriod,
  getSummaryByCategory,
  deleteLastTransaction
};
