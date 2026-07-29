import paramiko
import sys
import io

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

host = "64.204.130.181"
user = "root"
pw = "4sXWo02f4WkNm8fM"

def run_db_test():
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    try:
        client.connect(host, username=user, password=pw)
        print("Connected to VPS. Running Satta Matka backend integration test...")
        
        # 1. Setup a test market if none exists
        setup_sql = """
        INSERT INTO matka_markets (id, name, open_time, close_time, is_active) VALUES
          ('aa77c7db-115f-4d37-88f5-46ff85aa0001', 'TEST KALYAN', '12:00:00', '22:00:00', true)
        ON CONFLICT (id) DO NOTHING;
        """
        client.exec_command(f'docker exec teen_postgres psql -U teen -d teen_db -c "{setup_sql}"')

        # 2. Get a test user ID from the database
        stdin, stdout, stderr = client.exec_command('docker exec teen_postgres psql -U teen -d teen_db -t -c "SELECT id FROM users LIMIT 1;"')
        user_id = stdout.read().decode('utf-8').replace('\r', '').replace('\n', '').strip()
        if not user_id:
            print("Error: No users found in database.")
            return
        print(f"Using Test User ID: {user_id}")

        # 3. Create a clean test draw for today
        clear_sql = """
        DELETE FROM matka_bets WHERE draw_id IN (SELECT id FROM matka_draws WHERE market_id = 'aa77c7db-115f-4d37-88f5-46ff85aa0001');
        DELETE FROM matka_draws WHERE market_id = 'aa77c7db-115f-4d37-88f5-46ff85aa0001';
        """
        client.exec_command(f'docker exec teen_postgres psql -U teen -d teen_db -c "{clear_sql}"')
        
        create_draw_sql = """
        INSERT INTO matka_draws (id, market_id, draw_date, status) VALUES
          ('bb77c7db-115f-4d37-88f5-46ff85aa0001', 'aa77c7db-115f-4d37-88f5-46ff85aa0001', CURRENT_DATE, 'open')
        RETURNING id;
        """
        stdin, stdout, stderr = client.exec_command(f'docker exec teen_postgres psql -U teen -d teen_db -t -c "{create_draw_sql}"')
        draw_id = stdout.read().decode('utf-8').replace('\r', '').replace('\n', '').strip()
        print(f"Created Test Draw ID: {draw_id}")

        # 4. Insert test bets for various types:
        # - Single (Open): Ank 5 (potential winner if Open Panna is 113 -> sum 5)
        # - Jodi: 51 (potential winner if Open Panna is 113 -> Open Ank 5, Close Panna 245 -> Close Ank 1 -> Jodi 51)
        # - Half Sangam A: 1131 (Open Panna 113, Close Ank 1)
        # - Full Sangam: 113245 (Open Panna 113, Close Panna 245)
        bets_sql = f"""
        INSERT INTO matka_bets (id, user_id, draw_id, bet_type, session, number, amount, multiplier, potential_payout) VALUES
          ('c177c7db-115f-4d37-88f5-46ff85aa0001', '{user_id}', '{draw_id}', 'single', 'open', '5', 10.0, 9.5, 95.0),
          ('c277c7db-115f-4d37-88f5-46ff85aa0002', '{user_id}', '{draw_id}', 'jodi', 'close', '51', 10.0, 95.0, 950.0),
          ('c377c7db-115f-4d37-88f5-46ff85aa0003', '{user_id}', '{draw_id}', 'half_sangam_a', 'close', '1131', 10.0, 1000.0, 10000.0),
          ('c477c7db-115f-4d37-88f5-46ff85aa0004', '{user_id}', '{draw_id}', 'full_sangam', 'close', '113245', 10.0, 10000.0, 100000.0);
        """
        # 5. Write the JS script to the project folder via SFTP
        db_url = get_db_url(client).replace('\r', '').replace('\n', '').strip()
        js_content = f"""
        const {{ Pool }} = require('pg');
        const {{ settleMatkaSession }} = require('./dist/helpers/matka');

        const pool = new Pool({{
          connectionString: '{db_url}'
        }});

        async function main() {{
          const drawId = '{draw_id}';
          console.log('SETTLING OPEN...');
          const r1 = await settleMatkaSession(pool, drawId, 'open', '113');
          console.log('OPEN RESULT:', r1);

          console.log('SETTLING CLOSE...');
          const r2 = await settleMatkaSession(pool, drawId, 'close', '245');
          console.log('CLOSE RESULT:', r2);

          await pool.end();
        }}
        main().catch(console.error);
        """
        
        sftp = client.open_sftp()
        js_file = sftp.open("/opt/teen/services/core-api-service/test_matka.js", "w")
        js_file.write(js_content)
        js_file.close()
        print("Wrote test script to core-api-service/test_matka.js")

        # 6. Execute the test script on the VPS
        stdin, stdout, stderr = client.exec_command("cd /opt/teen/services/core-api-service && node test_matka.js")
        print("=== JS TEST OUTPUT ===")
        print(stdout.read().decode('utf-8'))
        print("=== JS TEST ERRORS ===")
        print(stderr.read().decode('utf-8'))

        # Clean up the test file
        sftp.remove("/opt/teen/services/core-api-service/test_matka.js")
        sftp.close()

        # 7. Check Jodi, Half Sangam, Full Sangam status and payouts in DB
        print("\n=== FINAL BETS STATUS IN DB ===")
        stdin, stdout, stderr = client.exec_command(f'docker exec teen_postgres psql -U teen -d teen_db -c "SELECT id, bet_type, number, status, payout FROM matka_bets WHERE draw_id = \'{draw_id}\';"')
        print(stdout.read().decode('utf-8'))

        print("Verification completed successfully!")

    except Exception as e:
        print(f"Error during test: {e}")
    finally:
        client.close()

def get_db_url(client):
    stdin, stdout, stderr = client.exec_command('cat /opt/teen/services/core-api-service/.env')
    content = stdout.read().decode('utf-8')
    import re
    db_url = re.search(r"DATABASE_URL=(.+)", content)
    return db_url.group(1).strip() if db_url else "postgresql://teen:password@127.0.0.1:5432/teen_db"

if __name__ == "__main__":
    run_db_test()
