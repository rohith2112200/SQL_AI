require('dotenv').config();
const mysql = require('mysql2/promise');

async function setupAuth() {
    console.log('🔌 Connecting to MySQL...');
    try {
        // Connect to Server (no DB selected yet to allow CREATE DATABASE)
        const connection = await mysql.createConnection({
            host: process.env.DB_HOST,
            user: process.env.DB_USER,
            password: process.env.DB_PASS
        });

        console.log('🛠️ Creating Database `sql_ai` if not exists...');
        await connection.query(`CREATE DATABASE IF NOT EXISTS sql_ai`);

        console.log('📂 Switching to `sql_ai`...');
        await connection.changeUser({ database: 'sql_ai' });

        console.log('📝 Creating `users` table...');
        await connection.query(`
            CREATE TABLE IF NOT EXISTS users (
                id INT AUTO_INCREMENT PRIMARY KEY,
                username VARCHAR(50) NOT NULL UNIQUE,
                email VARCHAR(100) NOT NULL UNIQUE,
                password_hash VARCHAR(255) NOT NULL,
                security_question VARCHAR(255),
                security_answer_hash VARCHAR(255),
                full_name VARCHAR(100),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        console.log('📝 Creating `user_connections` table...');
        await connection.query(`
            CREATE TABLE IF NOT EXISTS user_connections (
                id INT AUTO_INCREMENT PRIMARY KEY,
                user_id INT NOT NULL,
                name VARCHAR(100) NOT NULL,
                host VARCHAR(255) NOT NULL,
                port INT DEFAULT 3306,
                db_user VARCHAR(255) NOT NULL,
                db_pass VARCHAR(255) NOT NULL, 
                default_schema VARCHAR(255),
                db_type VARCHAR(50) DEFAULT 'mysql',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            )
        `);

        console.log('🔄 Checking for schema updates...');
        try {
            await connection.query(`ALTER TABLE users ADD COLUMN security_question VARCHAR(255)`);
            await connection.query(`ALTER TABLE users ADD COLUMN security_answer_hash VARCHAR(255)`);
            console.log('✅ Added security columns.');
        } catch (e) {
            // Ignore if columns exist
            console.log('ℹ️ Security columns likely exist.');
        }

        console.log('✅ Auth Database Setup Complete!');
        await connection.end();
    } catch (err) {
        console.error('❌ Error setting up auth DB:', err);
    }
}

setupAuth();
