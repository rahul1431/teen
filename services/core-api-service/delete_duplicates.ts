import { Pool } from 'pg';

async function run() {
  const pool = new Pool({
    connectionString: 'postgres://teen:teen_secret_2024@localhost:5432/teen_db'
  });

  try {
    const res = await pool.query('SELECT * FROM matka_markets');
    console.log(`Found ${res.rows.length} total markets.`);

    const seen = new Set<string>();
    for (const row of res.rows) {
      if (seen.has(row.name)) {
        console.log(`Deleting duplicate market: ${row.name} (ID: ${row.id})`);
        await pool.query('DELETE FROM matka_markets WHERE id = $1', [row.id]);
      } else {
        seen.add(row.name);
      }
    }
    console.log('Duplicate markets removed.');

    const drawRes = await pool.query('SELECT * FROM matka_draws');
    const drawSeen = new Set<string>();
    for (const row of drawRes.rows) {
      const key = `${row.market_id}_${row.draw_date}`;
      if (drawSeen.has(key)) {
        console.log(`Deleting duplicate draw: ${row.id} for market ${row.market_id} on ${row.draw_date}`);
        await pool.query('DELETE FROM matka_draws WHERE id = $1', [row.id]);
      } else {
        drawSeen.add(key);
      }
    }
    console.log('Duplicate draws removed.');

  } catch (err) {
    console.error(err);
  } finally {
    await pool.end();
  }
}

run();
