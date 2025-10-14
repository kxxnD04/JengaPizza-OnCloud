require('dotenv').config();
const mysql = require('mysql2');

const dbConfig = {
  host: process.env.RDS_HOSTNAME || process.env.DB_HOST || 'localhost',
  user: process.env.RDS_USER || process.env.DB_USER || 'root',
  password: process.env.RDS_PASSWORD || process.env.DB_PASSWORD,
  database: process.env.RDS_DB_NAME || process.env.DB_NAME || 'pizzeria',
  port: process.env.RDS_PORT || process.env.DB_PORT || 3306,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  charset: 'utf8mb4'
};

const pool = mysql.createPool(dbConfig);

// Get the promise-based version
const promisePool = pool.promise();

// Test connection
pool.getConnection((err, connection) => {
  if (err) {
    console.error('Error connecting to MySQL database:', err.message);
    return;
  }
  console.log('Successfully connected to MySQL database!');
  connection.release();
});

module.exports = {
  pool,
  promisePool,
  // Helper function to execute queries with callback style (similar to SQLite)
  query: (sql, params, callback) => {
    if (typeof params === 'function') {
      callback = params;
      params = [];
    }
    pool.query(sql, params, (error, results) => {
      if (callback) callback(error, results);
    });
  },
  // Helper function for single row queries (like db.get in SQLite)
  get: (sql, params, callback) => {
    if (typeof params === 'function') {
      callback = params;
      params = [];
    }
    pool.query(sql, params, (error, results) => {
      if (callback) {
        if (error) return callback(error, null);
        callback(null, results[0]); // Return first row only
      }
    });
  },
  // Helper function for multiple rows queries (like db.all in SQLite)
  all: (sql, params, callback) => {
    if (typeof params === 'function') {
      callback = params;
      params = [];
    }
    pool.query(sql, params, (error, results) => {
      if (callback) callback(error, results || []);
    });
  },
  // Helper function for insert/update/delete (like db.run in SQLite)
  run: (sql, params, callback) => {
    if (typeof params === 'function') {
      callback = params;
      params = [];
    }
    pool.query(sql, params, (error, results) => {
      if (callback) callback(error, results);
    });
  },
  // Helper function for executing multiple statements (like db.exec in SQLite)
  exec: (sql, callback) => {
    // Split by semicolon and execute each statement
    const statements = sql.split(';').filter(stmt => stmt.trim().length > 0);
    let completed = 0;
    let hasError = false;

    if (statements.length === 0) {
      if (callback) callback(null, []);
      return;
    }

    statements.forEach((statement, index) => {
      pool.query(statement.trim(), (error, results) => {
        if (error && !hasError) {
          hasError = true;
          if (callback) callback(error, null);
          return;
        }
        
        completed++;
        if (completed === statements.length && !hasError) {
          if (callback) callback(null, results);
        }
      });
    });
  }
};
