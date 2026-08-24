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
    CREATE TABLE IF NOT EXISTS transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      phone TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('income', 'expense')),
      amount REAL NOT NULL CHECK(amount > 0),
      description TEXT,
      category TEXT DEFAULT 'Geral',
      created_at TEXT DEFAULT (datetime('now', 'localtime'))
    );

    CREATE INDEX IF NOT EXISTS idx_transactions_phone ON transactions(phone);
    CREATE INDEX IF NOT EXISTS idx_transactions_created ON transactions(created_at);
  `);

  console.log('✅ Banco de dados inicializado:', dbPath);
  return db;
}

function getDb() {
  if (!db) throw new Error('Database not initialized. Call initDb() first.');
  return db;
}

function addTransaction(phone, type, amount, description = '', category = 'Geral') {
  const stmt = getDb().prepare(`
    INSERT INTO transactions (phone, type, amount, description, category)
    VALUES (?, ?, ?, ?, ?)
  `);
  const result = stmt.run(phone, type, amount, description.trim(), category.trim() || 'Geral');
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

function getTransactions(phone, limit = 10) {
  return getDb().prepare(`
    SELECT id, type, amount, description, category, created_at
    FROM transactions
    WHERE phone = ?
    ORDER BY created_at DESC, id DESC
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
    WHERE phone = ?
    GROUP BY category, type
    ORDER BY total DESC
  `).all(phone);
}

function deleteLastTransaction(phone) {
  const last = getDb().prepare(`
    SELECT id FROM transactions
    WHERE phone = ?
    ORDER BY created_at DESC, id DESC
    LIMIT 1
  `).get(phone);

  if (!last) return null;

  getDb().prepare('DELETE FROM transactions WHERE id = ?').run(last.id);
  return last.id;
}

module.exports = {
  initDb,
  getDb,
  addTransaction,
  getBalance,
  getTransactions,
  getSummaryByCategory,
  deleteLastTransaction
};
