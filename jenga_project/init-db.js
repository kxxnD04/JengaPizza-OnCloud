require('dotenv').config();
const mysql = require('mysql2');
const fs = require('fs');
const path = require('path');

// Create connection
const connection = mysql.createConnection({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT || 3306,
  multipleStatements: true,
  charset: 'utf8mb4'
});

connection.connect((err) => {
  if (err) {
    console.error('Error connecting to MySQL:', err.message);
    process.exit(1);
  }
  console.log('Connected to MySQL server');

  // Step 1: Create database if not exists
  const createDbQuery = `CREATE DATABASE IF NOT EXISTS ${process.env.DB_NAME || 'pizzeria'} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`;
  
  connection.query(createDbQuery, (error) => {
    if (error) {
      console.error('Error creating database:', error.message);
      connection.end();
      process.exit(1);
    }
    
    console.log(`✅ Database '${process.env.DB_NAME || 'pizzeria'}' created or already exists`);
    
    // Step 2: Use the database
    connection.query(`USE ${process.env.DB_NAME || 'pizzeria'};`, (error) => {
      if (error) {
        console.error('Error selecting database:', error.message);
        connection.end();
        process.exit(1);
      }
      
      console.log(`✅ Using database '${process.env.DB_NAME || 'pizzeria'}'`);
      
      // Step 3: Read and execute SQL file
      const sqlFilePath = path.join(__dirname, 'data', 'pizzeria.sql');
      const sql = fs.readFileSync(sqlFilePath, 'utf8');

      connection.query(sql, (error, results) => {
        if (error) {
          console.error('Error executing SQL file:', error.message);
          connection.end();
          process.exit(1);
        }
        
        console.log('✅ Tables created successfully!');
        console.log('✅ Initial data imported successfully!');
        console.log('\n🎉 Database initialization completed!');
        console.log(`\n📝 You can now start your server with: npm run start_oven`);
        
        connection.end((err) => {
          if (err) {
            console.error('Error closing connection:', err.message);
          } else {
            console.log('Connection closed');
          }
          process.exit(0);
        });
      });
    });
  });
});
