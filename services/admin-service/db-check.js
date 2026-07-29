const { Client } = require('pg');

const client = new Client({
  user: 'teen',
  password: 'teen_secret_2024',
  host: 'localhost',
  port: 5432,
  database: 'teen_db'
});

async function runChecks() {
  try {
    await client.connect();
    console.log('Connected to database');

    const results = {
      tables_checked: 0,
      tables_ok: 0,
      schema_issues: [],
      data_integrity_issues: [],
      backup_status: 'UNKNOWN',
      assessment: 'OK'
    };

    // Check required tables
    const requiredTables = ['users', 'sessions', 'games', 'transactions'];
    const allTablesQuery = `
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
      ORDER BY table_name
    `;

    const allTablesResult = await client.query(allTablesQuery);
    const existingTables = allTablesResult.rows.map(r => r.table_name);
    console.log('\nAll existing tables:', existingTables);

    // Check for required tables
    for (const table of requiredTables) {
      results.tables_checked++;
      if (existingTables.includes(table)) {
        results.tables_ok++;
        console.log(`✓ Table '${table}' exists`);
      } else {
        console.log(`✗ Table '${table}' MISSING`);
        results.schema_issues.push(`Required table '${table}' not found`);
      }
    }

    // Check critical tables from the schema
    const criticalTables = ['users', 'wallets', 'wallet_transactions', 'payment_orders', 'game_rooms', 'game_participants'];
    for (const table of criticalTables) {
      if (existingTables.includes(table)) {
        results.tables_checked++;
        results.tables_ok++;
        console.log(`✓ Critical table '${table}' exists`);
      }
    }

    // Check indexes on critical columns
    console.log('\n=== CHECKING INDEXES ===');
    const indexQuery = `
      SELECT
        t.relname as table_name,
        i.relname as index_name,
        a.attname as column_name
      FROM
        pg_index idx
        JOIN pg_class i ON i.oid = idx.indexrelid
        JOIN pg_class t ON t.oid = idx.indrelid
        JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(idx.indkey)
      WHERE
        t.relkind = 'r' AND i.relkind = 'i'
      ORDER BY
        t.relname, i.relname
    `;

    const indexResult = await client.query(indexQuery);
    console.log('Indexes found:', indexResult.rows.length);

    const criticalIndexes = {
      'users.phone': false,
      'users.status': false,
      'wallets.user_id': false,
      'wallet_transactions.user_id': false,
      'wallet_transactions.created_at': false,
      'game_rooms.game_type': false,
      'game_rooms.status': false,
      'game_participants.room_id': false,
      'game_participants.user_id': false
    };

    for (const row of indexResult.rows) {
      const key = `${row.table_name}.${row.column_name}`;
      if (key in criticalIndexes) {
        criticalIndexes[key] = true;
      }
    }

    for (const [key, exists] of Object.entries(criticalIndexes)) {
      if (!exists) {
        console.log(`⚠ Missing critical index on ${key}`);
        results.schema_issues.push(`Missing index on ${key}`);
      }
    }

    // Check foreign key constraints
    console.log('\n=== CHECKING FOREIGN KEY CONSTRAINTS ===');
    const fkQuery = `
      SELECT
        constraint_name,
        table_name,
        column_name,
        referenced_table_name,
        referenced_column_name
      FROM
        information_schema.key_column_usage
      WHERE
        referenced_table_name IS NOT NULL
      ORDER BY
        table_name
    `;

    const fkResult = await client.query(fkQuery);
    console.log('Foreign keys found:', fkResult.rows.length);

    if (fkResult.rows.length === 0) {
      results.schema_issues.push('No foreign key constraints found');
    }

    // Check table row counts
    console.log('\n=== TABLE SIZE CHECK ===');
    for (const table of existingTables.slice(0, 20)) {
      const countQuery = `SELECT COUNT(*) as count FROM "${table}"`;
      const countResult = await client.query(countQuery);
      const rowCount = countResult.rows[0].count;
      console.log(`${table}: ${rowCount} rows`);
    }

    // Check for orphaned records - users without wallet
    console.log('\n=== DATA INTEGRITY CHECKS ===');
    if (existingTables.includes('users') && existingTables.includes('wallets')) {
      const orphanedQuery = `
        SELECT COUNT(*) as orphaned_count
        FROM users u
        LEFT JOIN wallets w ON u.id = w.user_id
        WHERE w.id IS NULL
      `;
      const orphanedResult = await client.query(orphanedQuery);
      const orphanedCount = orphanedResult.rows[0].orphaned_count;
      console.log(`Users without wallet: ${orphanedCount}`);

      if (orphanedCount > 0) {
        results.data_integrity_issues.push(`${orphanedCount} users found without corresponding wallet entry`);
      }
    }

    // Check for negative balances (shouldn't exist with CHECK constraints)
    if (existingTables.includes('wallets')) {
      const negativeQuery = `
        SELECT COUNT(*) as negative_count
        FROM wallets
        WHERE real_balance < 0 OR bonus_balance < 0 OR locked_balance < 0
      `;
      const negativeResult = await client.query(negativeQuery);
      const negativeCount = negativeResult.rows[0].negative_count;
      console.log(`Wallets with negative balance: ${negativeCount}`);

      if (negativeCount > 0) {
        results.data_integrity_issues.push(`${negativeCount} wallets found with negative balance`);
      }
    }

    // Check for NULL required fields
    if (existingTables.includes('users')) {
      const nullQuery = `
        SELECT COUNT(*) as null_count
        FROM users
        WHERE password_hash IS NULL
      `;
      const nullResult = await client.query(nullQuery);
      const nullCount = nullResult.rows[0].null_count;
      console.log(`Users with NULL password_hash: ${nullCount}`);

      if (nullCount > 0) {
        results.data_integrity_issues.push(`${nullCount} users found with NULL password_hash`);
      }
    }

    // Check database version and settings
    console.log('\n=== DATABASE INFO ===');
    const versionQuery = 'SELECT version()';
    const versionResult = await client.query(versionQuery);
    console.log('Version:', versionResult.rows[0].version);

    // Check backup status (if available from pg_stat_archiver)
    try {
      const backupQuery = `
        SELECT
          CASE
            WHEN pg_is_in_recovery() THEN 'In Recovery (Standby/Replica)'
            ELSE 'Primary - Check archive_mode'
          END as backup_mode,
          pg_postmaster_start_time() as start_time
      `;
      const backupResult = await client.query(backupQuery);
      const backupInfo = backupResult.rows[0];
      results.backup_status = backupInfo.backup_mode;
      console.log('Backup status:', results.backup_status);
    } catch (e) {
      results.backup_status = 'Unable to determine';
    }

    // Determine assessment
    if (results.schema_issues.length > 5 || results.data_integrity_issues.length > 3) {
      results.assessment = 'CRITICAL';
    } else if (results.schema_issues.length > 0 || results.data_integrity_issues.length > 0) {
      results.assessment = 'WARNING';
    } else if (results.tables_ok < results.tables_checked) {
      results.assessment = 'WARNING';
    } else {
      results.assessment = 'OK';
    }

    console.log('\n=== FINAL ASSESSMENT ===');
    console.log(JSON.stringify(results, null, 2));

    await client.end();
    process.exit(0);
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

runChecks();
