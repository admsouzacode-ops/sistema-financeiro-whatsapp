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

  // Tabela de contas / cartões
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

  // Transações (com suporte a conta)
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

  // Migração segura: adiciona account_id se a tabela antiga existir sem ela
  try {
    const cols = db.prepare(`PRAGMA table_info(transactions)`).all();
    const hasAccountId = cols.some(c => c.name === 'account_id');
    if (!hasAccountId) {
      db.exec(`ALTER TABLE transactions ADD COLUMN account_id INTEGER`);
    }

    // Garante que o CHECK aceite 'payment'
    // (SQLite não permite alterar CHECK facilmente, então só documentamos)
  } catch (e) {
    // ignora
  }

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
  // Saldo geral (só income e expense, payments não contam de novo)
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

  // Reverte o efeito na conta se houver
  if (last.account_id) {
    if (last.type === 'expense') {
      // era despesa em cartão → reduz a dívida
      updateAccountBalance(last.account_id, -last.amount);
    } else if (last.type === 'payment') {
      // era pagamento → aumenta a dívida de volta
      updateAccountBalance(last.account_id, last.amount);
    } else if (last.type === 'income') {
      // receita em conta débito → reduz o saldo da conta
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
  getTransactions,
  getSummaryByCategory,
  deleteLastTransaction
};
