import paramiko
import sys
import io

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

host = "64.204.130.181"
user = "root"
pw = "4sXWo02f4WkNm8fM"

def check_db_state():
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    try:
        client.connect(host, username=user, password=pw)
        print("Connected to VPS. Querying DB status...")
        
        # Check matches
        print("\n=== MATCHES ===")
        stdin, stdout, stderr = client.exec_command('docker exec teen_postgres psql -U teen -d teen_db -c "SELECT id, series, team_a, team_b, status FROM cricket_matches;"')
        print(stdout.read().decode('utf-8'))
        
        # Check leagues
        print("\n=== LEAGUES ===")
        stdin, stdout, stderr = client.exec_command('docker exec teen_postgres psql -U teen -d teen_db -c "SELECT id, match_id, name, entry_fee, current_entries, max_entries FROM cricket_fantasy_leagues;"')
        print(stdout.read().decode('utf-8'))
        
        # Check player counts
        print("\n=== PLAYER COUNTS ===")
        stdin, stdout, stderr = client.exec_command('docker exec teen_postgres psql -U teen -d teen_db -c "SELECT team_name, COUNT(*) FROM cricket_fantasy_players GROUP BY team_name;"')
        print(stdout.read().decode('utf-8'))

        # Check match players mapped
        print("\n=== MATCH PLAYERS MAPPED ===")
        stdin, stdout, stderr = client.exec_command('docker exec teen_postgres psql -U teen -d teen_db -c "SELECT match_id, COUNT(*) FROM cricket_match_players GROUP BY match_id;"')
        print(stdout.read().decode('utf-8'))
        
    except Exception as e:
        print(f"Error: {e}")
    finally:
        client.close()

if __name__ == "__main__":
    check_db_state()
