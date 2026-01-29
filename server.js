require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const { createObjectCsvStringifier } = require('csv-writer');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const mysql = require('mysql2/promise');
const bcrypt = require('bcrypt');
const session = require('express-session');
const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';
const KEY = Buffer.from(process.env.ENCRYPTION_KEY, 'hex');

function encrypt(text) {
    if (!text) return null;
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv(ALGORITHM, KEY, iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const tag = cipher.getAuthTag().toString('hex');
    return `${iv.toString('hex')}:${encrypted}:${tag}`;
}

function decrypt(text) {
    if (!text) return null;
    try {
        const parts = text.split(':');
        if (parts.length < 3) return text; // Plain text fallback

        const [ivHex, encrypted, tagHex] = parts;
        const iv = Buffer.from(ivHex, 'hex');
        const tag = Buffer.from(tagHex, 'hex');
        const decipher = crypto.createDecipheriv(ALGORITHM, KEY, iv);
        decipher.setAuthTag(tag);
        let decrypted = decipher.update(encrypted, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        return decrypted;
    } catch (e) {
        console.error('Decryption failed. Returning raw value.');
        return text;
    }
}

// DB Drivers
let pg, mssql, oracledb;
try { pg = require('pg'); } catch (e) { console.log('PG driver not found'); }
try { mssql = require('mssql'); } catch (e) { console.log('MSSQL driver not found'); }
try { oracledb = require('oracledb'); if (oracledb) oracledb.outFormat = oracledb.OUT_FORMAT_OBJECT; } catch (e) { console.log('Oracle driver not found'); }

const app = express();
const PORT = process.env.PORT || 3001; // Default to 3001 to avoid conflict with existing app on 3000

app.use(cors());
app.use(bodyParser.json());

// Session Configuration
app.use(session({
    secret: process.env.SESSION_SECRET || 'super_secret_key_change_me',
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: false,
        maxAge: 24 * 60 * 60 * 1000
    }
}));

// Root Route Protection
app.get('/', (req, res) => {
    if (!req.session.userId) {
        return res.redirect('/login.html');
    }
    res.sendFile(__dirname + '/public/index.html');
});

// Static Files
app.use(express.static('public', { index: false }));

// Auth Middleware
function isAuthenticated(req, res, next) {
    if (req.session && req.session.userId) {
        return next();
    }
    res.status(401).json({ error: 'Unauthorized' });
}

// ---------------------------------------------------------
// 1. Database Connection (Dynamic Pool Manager)
// ---------------------------------------------------------
const pools = new Map();

// Helper: Get or Create Pool (Adapter Pattern)
function getPool(dbName, config = null) {
    let dbType = 'mysql';
    let poolKey = dbName;

    if (config) {
        dbType = config.db_type || 'mysql';
        // USE DECRYPTED PASSWORD FOR REAL CONNECTION
        // But use the raw config for the cache key to avoid key collisions or leakage
        poolKey = `${dbType}:${config.host}:${config.user}:${dbName || 'DEFAULT'}:${config.password ? config.password.length : 'NOPASS'}`;
    } else {
        // Default Local MySQL (Main App DB)
        poolKey = `DEFAULT:${dbName}`;
        config = {
            host: process.env.DB_HOST,
            user: process.env.DB_USER,
            password: process.env.DB_PASS,
            port: 3306,
            db_type: 'mysql'
        };
    }

    if (pools.has(poolKey)) return pools.get(poolKey);

    // DECRYPT PASSWORD FOR THE ACTUAL CONNECTION DRIVER
    const connectionPassword = decrypt(config.password);

    console.log(`🔌 Initializing new ${dbType} pool for: ${poolKey}`);
    let newPool;

    if (dbType === 'mysql' || dbType === 'mariadb') {
        newPool = mysql.createPool({
            host: config.host,
            user: config.user,
            password: connectionPassword,
            port: config.port || 3306,
            database: dbName,
            waitForConnections: true,
            connectionLimit: 10
        });
    }
    else if (dbType === 'postgres') {
        if (!pg) throw new Error('Postgres driver missing');
        const pool = new pg.Pool({
            user: config.user,
            host: config.host,
            database: dbName || config.database,
            password: connectionPassword,
            port: config.port || 5432,
        });
        newPool = {
            execute: async (sql, params = []) => {
                let i = 1;
                const pgSql = sql.replace(/\?/g, () => `$${i++}`);
                const res = await pool.query(pgSql, params);
                return [res.rows];
            },
            end: () => pool.end()
        };
    }
    else if (dbType === 'oracle') {
        if (!oracledb) throw new Error('Oracle driver missing');
        newPool = {
            execute: async (sql, params = []) => {
                // CRITICAL FIX: For Oracle, dbName arg is Target Schema, NOT Service Name.
                // Always connect to the configured Service Name (e.g. 'orcl').
                const serviceName = config.database || 'orcl';

                const conn = await oracledb.getConnection({
                    user: config.user,
                    password: connectionPassword,
                    connectString: `${config.host}:${config.port}/${serviceName}`
                });
                try {
                    const result = await conn.execute(sql, params, {
                        autoCommit: true,
                        outFormat: (oracledb ? oracledb.OUT_FORMAT_OBJECT : 4002)
                    });
                    return [result.rows];
                } finally {
                    await conn.close();
                }
            },
            end: () => { }
        };
    }
    else if (dbType === 'sqlserver') {
        if (!mssql) throw new Error('MSSQL driver missing');
        const sqlConfig = {
            user: config.user,
            password: connectionPassword,
            server: config.host,
            port: parseInt(config.port) || 1433,
            database: dbName,
            options: { encrypt: false, trustServerCertificate: true }
        };
        const poolPromise = new mssql.ConnectionPool(sqlConfig).connect();
        newPool = {
            execute: async (sql, params = []) => {
                const pool = await poolPromise;
                const result = await pool.request().query(sql);
                return [result.recordset];
            },
            end: async () => (await poolPromise).close()
        };
    }

    pools.set(poolKey, newPool);
    return newPool;
}

// ---------------------------------------------------------
// 2. Dynamic Schema Extraction
// ---------------------------------------------------------
const schemaCache = new Map(); // Key: "dbName-user", Value: { schema: string, timestamp: number }
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 Minutes

async function getDatabaseSchema(dbName, config = null) {
    // Unique key including host/port to avoid cross-connection desync
    const connectionKey = config ? `${config.host}:${config.port}` : 'default';
    const cacheKey = `${connectionKey}-${dbName}-${config?.user || 'default'}`;
    const cached = schemaCache.get(cacheKey);

    // Return cached if valid
    if (cached && (Date.now() - cached.timestamp < CACHE_TTL_MS)) {
        console.log(`⚡ Using cached schema for ${dbName}`);
        return cached.schema;
    }

    try {
        const pool = getPool(dbName, config);
        const dbType = config ? config.db_type : 'mysql';

        let query, queryParams;
        if (dbType === 'oracle') {
            query = `
                SELECT table_name as TABLE_NAME, column_name as COLUMN_NAME, data_type as DATA_TYPE 
                FROM all_tab_columns 
                WHERE owner = :1 
                AND table_name NOT LIKE 'BIN$%'
                ORDER BY table_name, column_id
            `;
            queryParams = [dbName ? dbName.toUpperCase() : (config.user ? config.user.toUpperCase() : '')];
        } else {
            query = `
                SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE 
                FROM INFORMATION_SCHEMA.COLUMNS 
                WHERE TABLE_SCHEMA = ? 
                ORDER BY TABLE_NAME, ORDINAL_POSITION
            `;
            queryParams = [dbName];
        }

        const [rows] = await pool.execute(query, queryParams);

        const tables = {};
        rows.forEach(row => {
            let tableName = row.TABLE_NAME;
            // CRITICAL: Fully qualify Oracle tables to avoid ORA-00942 (cross-schema access)
            if (dbType === 'oracle' && dbName) {
                tableName = `"${dbName.toUpperCase()}"."${row.TABLE_NAME}"`;
            }

            if (!tables[tableName]) {
                tables[tableName] = [];
            }
            tables[tableName].push(`${row.COLUMN_NAME} (${row.DATA_TYPE})`);
        });

        // 2a. Fetch Foreign Keys (Relationships)
        let relationships = [];
        try {
            if (dbType === 'mysql' || dbType === 'mariadb') {
                const fkQuery = `
                    SELECT TABLE_NAME, COLUMN_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME
                    FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
                    WHERE TABLE_SCHEMA = ? AND REFERENCED_TABLE_NAME IS NOT NULL
                `;
                const [fks] = await pool.execute(fkQuery, [dbName]);
                relationships = fks.map(fk => `${fk.TABLE_NAME}.${fk.COLUMN_NAME} -> ${fk.REFERENCED_TABLE_NAME}.${fk.REFERENCED_COLUMN_NAME}`);
            }
        } catch (fkError) {
            console.warn("Failed to fetch foreign keys:", fkError.message);
        }

        let schemaString = `Real Database Schema (${dbName}):\n`;
        for (const [table, cols] of Object.entries(tables)) {
            schemaString += `- ${table}(${cols.join(', ')})\n`;
        }

        // 2b. Heuristic Relationships (Smart Guessing)
        if (relationships.length === 0) {
            const columnMap = {};

            // Helper to get clean name (strip quotes/schema)
            const getCleanName = (t) => t.replace(/"/g, '').split('.').pop();

            for (const [fullTable, cols] of Object.entries(tables)) {
                cols.forEach(colStr => {
                    const colName = colStr.split(' ')[0]; // "CampaignID"
                    // Filter for likely keys
                    if (colName.toLowerCase().endsWith('id') || colName.toLowerCase().endsWith('code')) {
                        if (!columnMap[colName]) columnMap[colName] = [];
                        columnMap[colName].push(fullTable);
                    }
                });
            }

            // Synthesize links
            for (const [col, tList] of Object.entries(columnMap)) {
                if (tList.length > 1) {
                    let parentTable = tList[0];
                    // Clean matching: does "CampaignID" exist in "Campaign" table?
                    const matches = tList.filter(t => {
                        const clean = getCleanName(t).toLowerCase();
                        return col.toLowerCase().includes(clean) || clean.includes(col.replace(/id|code/i, '').toLowerCase());
                    });

                    if (matches.length > 0) parentTable = matches[0];

                    tList.forEach(childTable => {
                        if (childTable !== parentTable) {
                            relationships.push(`${childTable}.${col} -> ${parentTable}.${col} (Guessed)`);
                        }
                    });
                }
            }
        }

        if (relationships.length > 0) {
            schemaString += `\nRelationships (Foreign Keys):\n` + relationships.map(r => `- ${r}`).join('\n') + `\n`;
        } else {
            schemaString += `\nRelationships:\n- Use JOINs based on matching column names (e.g. CampaignID = CampaignID).`;
        }

        // SAVE TO CACHE
        schemaCache.set(cacheKey, { schema: schemaString, timestamp: Date.now() });
        console.log(`💾 Cached schema for ${dbName} (TTL: 10m)`);

        return schemaString;
    } catch (error) {
        console.error(`Error fetching schema for ${dbName}:`, error.message);
        return "Schema unavailable.";
    }
}

// ---------------------------------------------------------
// 3. Helpers
// ---------------------------------------------------------
function validateSafety(sql) {
    const forbidden = ['DELETE', 'DROP', 'ALTER', 'INSERT', 'UPDATE', 'TRUNCATE', 'GRANT', 'REVOKE'];
    const lowerSql = sql.toLowerCase();
    const violations = forbidden.filter(word => {
        const regex = new RegExp(`\\b${word}\\b`, 'i');
        return regex.test(sql);
    });

    if (violations.length > 0) {
        return { isSafe: false, reason: `Policy Violation: Query contains prohibited keywords (${violations.join(', ')})` };
    }
    return { isSafe: true, reason: 'Query is read-only and safe.' };
}

function explainQuery(sql) {
    if (!sql) return 'No query generated.';
    return "Query executed successfully.";
}

// ---------------------------------------------------------
// 4. API Routes
// ---------------------------------------------------------

// Register
app.post('/api/auth/register', async (req, res) => {
    const { username, email, password, fullName, securityQuestion, securityAnswer } = req.body;
    if (!username || !email || !password || !securityQuestion || !securityAnswer) {
        return res.status(400).json({ error: 'Missing fields' });
    }
    try {
        const pool = getPool('sql_ai');
        const hash = await bcrypt.hash(password, 10);
        const answerHash = await bcrypt.hash(securityAnswer.trim().toLowerCase(), 10);
        await pool.execute(
            'INSERT INTO users (username, email, password_hash, security_question, security_answer_hash, full_name) VALUES (?, ?, ?, ?, ?, ?)',
            [username, email, hash, securityQuestion, answerHash, fullName || '']
        );
        res.json({ message: 'Registration successful' });
    } catch (error) {
        console.error('Registration Error:', error);
        res.status(500).json({ error: 'Registration failed' });
    }
});

// Login
app.post('/api/auth/login', async (req, res) => {
    const { username, password } = req.body;
    try {
        const pool = getPool('sql_ai');
        const [rows] = await pool.execute('SELECT * FROM users WHERE username = ?', [username]);
        if (rows.length === 0) return res.status(401).json({ error: 'Invalid credentials' });
        const user = rows[0];
        const match = await bcrypt.compare(password, user.password_hash);
        if (!match) return res.status(401).json({ error: 'Invalid credentials' });
        req.session.userId = user.id;
        req.session.username = user.username;
        res.json({ message: 'Login successful', user: { id: user.id, username: user.username } });
    } catch (error) {
        console.error('Login Error:', error);
        res.status(500).json({ error: 'Login failed' });
    }
});

// Logout
app.post('/api/auth/logout', (req, res) => {
    req.session.destroy(err => {
        if (err) return res.status(500).json({ error: 'Logout failed' });
        res.clearCookie('connect.sid');
        res.json({ message: 'Logged out' });
    });
});

// Check Session
app.get('/api/auth/me', (req, res) => {
    if (req.session && req.session.userId) {
        res.json({
            authenticated: true,
            user: { id: req.session.userId, username: req.session.username },
            activeConnection: req.session.activeConnection || null
        });
    } else {
        res.json({ authenticated: false });
    }
});

// Discovery: Get All Databases
app.get('/api/databases', isAuthenticated, async (req, res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    try {
        const activeConn = req.session.activeConnection;
        if (activeConn && activeConn.config) {
            const pool = getPool(null, activeConn.config);
            const dbType = activeConn.config.db_type;
            let query = 'SHOW DATABASES';

            if (dbType === 'oracle') {
                query = `SELECT username as "Database" FROM all_users 
                          WHERE username NOT IN ('SYS','SYSTEM','ANONYMOUS','XDB','CTXSYS','MDSYS','ORDSYS') 
                          ORDER BY username`;
            } else if (dbType === 'postgres') {
                query = 'SELECT datname as "Database" FROM pg_database WHERE datistemplate = false';
            } else if (dbType === 'sqlserver') {
                query = 'SELECT name as "Database" FROM sys.databases';
            }

            const [rows] = await pool.execute(query);
            console.log(`🔍 Raw Discovery Rows for ${activeConn.name}:`, JSON.stringify(rows));

            const systemDbs = ['information_schema', 'mysql', 'performance_schema', 'sys', 'sql_ai', 'master', 'tempdb', 'model', 'msdb'];
            const databases = rows
                .map(row => row.Database || row.DATABASE || row.database || row.USERNAME || Object.values(row)[0])
                .filter(db => db && !systemDbs.includes(db));

            console.log(`📋 Found ${databases.length} visible schemas.`);
            res.json({ databases, connectedTo: activeConn.name });
        } else {
            // STRICT MODE: Return NOTHING if no connection selected
            res.json({ databases: [], connectedTo: null });
        }
    } catch (error) {
        console.error('Database Discovery Failed:', error);
        res.status(500).json({ error: error.message, databases: [] });
    }
});

// Generate SQL via LLM
app.post('/api/generate-sql', isAuthenticated, async (req, res) => {
    const { input, database } = req.body;
    const activeConn = req.session.activeConnection;

    if (!activeConn) {
        return res.json({
            sql: "-- No Active Connection",
            explanation: "Select a database connection in Settings first.",
            safety: { isSafe: false, reason: "No Connection" }
        });
    }

    const activeDb = database || (activeConn ? activeConn.config.database : process.env.DB_NAME);
    const config = activeConn ? activeConn.config : { user: process.env.DB_USER, password: process.env.DB_PASSWORD, db_type: 'mysql' }; // Fallback

    const apiKey = process.env.GEMINI_API_KEY;
    const genAI = apiKey ? new GoogleGenerativeAI(apiKey) : null;

    if (!genAI) {
        return res.json({ sql: "SELECT 'Error: No API Key'", explanation: "Missing API Key", safety: { isSafe: false } });
    }

    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

    try {
        console.time('PROFILE: Schema Fetch');
        const realSchema = await getDatabaseSchema(activeDb, config);
        console.timeEnd('PROFILE: Schema Fetch');

        console.log('📜 Generated Schema for AI:\n', realSchema.substring(0, 500) + '...'); // Debug Log

        // DB-Specific Parsing Logic
        let dbParsingRules = "";
        if (config.db_type === 'oracle') {
            dbParsingRules = `
            5. **For Text Duration (e.g. '30 mins'):**
               - Use: \`TO_NUMBER(REGEXP_SUBSTR(col, '\\d+'))\`.
               - Filter: \`LOWER(col) LIKE '%mins%'\`.`;
        } else if (config.db_type === 'postgres') {
            dbParsingRules = `
            5. **For Text Duration (e.g. '30 mins'):**
               - Use: \`CAST(SUBSTRING(col FROM '\\d+') AS INTEGER)\`.
               - Filter: \`col ILIKE '%mins%'\`.`;
        } else {
            // MySQL / MariaDB / MSSQL
            dbParsingRules = `
            5. **For Text Duration (e.g. '30 mins'):**
               - **MySQL/MariaDB**: Use Implicit Cast: \`(col + 0)\`. 
                 (e.g., \`'30 mins' + 0\` returns \`30\`. This is safer than Regex).
               - Filter: \`col LIKE '%mins%'\`.
               - MSSQL: Use \`CAST(SUBSTRING(col, PATINDEX('%[0-9]%', col), LEN(col)) AS INT)\`.`;
        }

        const prompt = `
            You are an expert SQL generator for a ${config.db_type} database.
            Target Database/Schema: ${activeDb}
            
            ${realSchema}
            
            Convert this natural language request into safe, valid SQL: "${input}"
            
            CRITICAL RULES:
            1. Use **EXACT** table names from the schema above. 
               - If the schema says "- "Owner"."Table"...", you MUST write "FROM "Owner"."Table"".
               - Do NOT simplify or remove quotes/schema prefixes.
            2. Use **EXACT** column names.
            3. **Prefer LEFT JOIN** to ensure data visibility.
            4. **For text filtering, use LIKE '%value%' or LOWER(col) = LOWER('value')** (Case Insensitive).
            ${dbParsingRules}
            6. **Display vs Calculate:** 
               - If asked to "Display X", just SELECT X. 
               - If asked to "Calculate Y based on X", SELECT formula AS Y.
            7. SELECT only (no INSERT, UPDATE, DELETE).
            8. NO MARKDOWN. NO COMMENTS. NO EXPLANATIONS.
            9. Start directly with "SELECT".
            10. Use ${config.db_type} syntax.
            11. If searching for dates, cast them appropriate for ${config.db_type}.
            
            Generate only the SQL query.
        `;

        console.time('PROFILE: LLM Generation');
        const result = await model.generateContent(prompt);
        console.timeEnd('PROFILE: LLM Generation');

        const response = await result.response;
        // Check for truncation / finishReason if needed (omitted for brevity)
        let sql = response.text().replace(/```sql|```/g, '').trim();

        console.log('🤖 GENERATED SQL:\n', sql); // Debug Log

        // Safety Filter (No INSERT/UPDATE/DELETE)
        const safety = validateSafety(sql);
        if (!safety.isSafe) {
            return res.json({ error: safety.reason, safety });
        }

        res.json({ sql, safety });
    } catch (error) {
        console.error('Gemini API Error:', error);

        let status = 500;
        let message = 'AI Service Unavailable';

        // Check for Quota Exceeded (429)
        const errString = JSON.stringify(error, null, 2);
        if (errString.includes('429') || errString.includes('quota') || error.status === 429) {
            status = 429;
            message = 'AI Quota Exceeded (Free Tier). Please wait a moment or check your Google Cloud Console.';
        } else {
            message = error.message || 'AI processing failed';
        }

        res.status(status).json({ error: message });
    }
});

// Execute Query
app.post('/api/execute-query', isAuthenticated, async (req, res) => {
    let { sql, database } = req.body;
    const activeConn = req.session.activeConnection;
    if (!activeConn) return res.status(400).json({ error: "No active connection", results: [] });

    const safety = validateSafety(sql);
    if (!safety.isSafe) return res.status(400).json({ error: safety.reason, results: [] });

    try {
        const pool = getPool(database || activeConn.config.database, activeConn.config);

        console.log(`🔌 Executing Query on [${database || activeConn.config.database}]...`);

        // Oracle (and others) do not support trailing semicolons in execute/query usually
        if (sql.trim().endsWith(';')) {
            sql = sql.trim().slice(0, -1);
        }

        // SMART EXECUTION STRATEGY:
        // - MySQL2 'pool.query': Uses Text Protocol (Fixes casting/zero-row issues).
        // - Oracle/Postgres Wrappers: Only implement 'execute'.
        let rows;
        if (typeof pool.query === 'function') {
            // Standard MySQL2 Pool
            [rows] = await pool.query(sql);
        } else {
            // Custom Wrappers (Oracle, Postgres, MSSQL)
            [rows] = await pool.execute(sql);
        }

        console.log(`✅ Query returned ${rows ? rows.length : 0} rows.`);

        // INTELLIGENT DEBUG: If 0 rows, check if table is actually empty
        let debugInfo = null;
        if (rows.length === 0) {
            try {
                // Regex to find first table in FROM clause (handles "Schema"."Table" or Table)
                const match = sql.match(/FROM\s+("?[\w.]+"?)/i);
                if (match && match[1]) {
                    const tableName = match[1];
                    const [countRows] = await pool.execute(`SELECT COUNT(*) as CNT FROM ${tableName}`);
                    const totalRows = countRows[0].CNT || countRows[0].cnt || 0;
                    debugInfo = {
                        tableName,
                        totalRows,
                        message: totalRows > 0
                            ? `Table ${tableName} has ${totalRows} rows. Your filters might be too strict.`
                            : `Table ${tableName} is empty.`
                    };
                }
            } catch (err) {
                console.warn('Debug count failed:', err.message);
            }
        }

        res.json({ results: rows, debug: debugInfo, sqlExecuted: sql });
    } catch (error) {
        console.error('❌ EXECUTE QUERY ERROR:', error);
        res.status(500).json({ error: error.message, stack: error.stack, results: [], sql: sql });
    }
});

// Connection Crud
app.post('/api/connections/test', isAuthenticated, async (req, res) => {
    const { host, port, db_user, db_pass, default_schema, db_type } = req.body;
    const config = { host, port: parseInt(port), user: db_user, password: db_pass, database: default_schema, db_type: db_type || 'mysql' };
    try {
        const pool = getPool(config.database, config);
        let query = 'SELECT 1';
        if (config.db_type === 'oracle') query = 'SELECT 1 FROM DUAL';
        await pool.execute(query);
        res.json({ message: 'Connection Successful!' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/connections', isAuthenticated, async (req, res) => {
    try {
        const pool = getPool('sql_ai');
        const [rows] = await pool.execute('SELECT id, name, host, port, db_user, default_schema, db_type FROM user_connections WHERE user_id = ?', [req.session.userId]);
        res.json({ connections: rows });
    } catch (error) {
        console.error('Get Connections Error:', error);
        res.status(500).json({ error: error.message, connections: [] });
    }
});

app.post('/api/connections', isAuthenticated, async (req, res) => {
    const { name, host, port, db_user, db_pass, default_schema, db_type } = req.body;
    try {
        const encryptedPass = encrypt(db_pass);
        const pool = getPool('sql_ai');
        await pool.execute('INSERT INTO user_connections (user_id, name, host, port, db_user, db_pass, default_schema, db_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [req.session.userId, name, host, port, db_user, encryptedPass, default_schema, db_type || 'mysql']);
        res.json({ message: 'Saved' });
    } catch (error) {
        console.error('Save Connection Error:', error);
        res.status(500).json({ error: error.message });
    }
});

app.delete('/api/connections/:id', isAuthenticated, async (req, res) => {
    try {
        const pool = getPool('sql_ai');
        await pool.execute('DELETE FROM user_connections WHERE id = ? AND user_id = ?', [req.params.id, req.session.userId]);
        res.json({ message: 'Deleted' });
    } catch (error) {
        console.error('Delete Connection Error:', error);
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/connect', isAuthenticated, async (req, res) => {
    const { connectionId } = req.body;
    try {
        const pool = getPool('sql_ai');
        const [rows] = await pool.execute('SELECT * FROM user_connections WHERE id = ? AND user_id = ?', [connectionId, req.session.userId]);
        if (rows.length === 0) return res.status(404).json({ error: 'Not found' });
        const conn = rows[0];
        req.session.activeConnection = { id: conn.id, name: conn.name, config: { host: conn.host, port: conn.port, user: conn.db_user, password: conn.db_pass, database: conn.default_schema, db_type: conn.db_type } };

        // DEEP RESET: Force Real-Time Discovery
        schemaCache.clear();

        // Purge pools for this connection to bypass driver-level caching of schema lists
        for (const [key, pool] of pools.entries()) {
            // Strictly exclude only the internal app DB; recycle everything else
            if (key !== 'DEFAULT:sql_ai') {
                if (pool.end) try { pool.end(); } catch (e) { }
                pools.delete(key);
            }
        }
        console.log(`🧹 Full Reset: Discovery for ${conn.name} will be 100% fresh.`);

        res.json({ message: `Connected to ${conn.name}`, activeConnection: conn.name });
    } catch (error) {
        console.error('Connect Error:', error);
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/export-csv', async (req, res) => {
    const { data } = req.body;
    if (!data || data.length === 0) return res.status(400).send('No data');
    const headers = Object.keys(data[0]).map(id => ({ id, title: id.toUpperCase() }));
    const csvStringifier = createObjectCsvStringifier({ header: headers });
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="export.csv"');
    res.send(csvStringifier.getHeaderString() + csvStringifier.stringifyRecords(data));
});

app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
