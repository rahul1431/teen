import paramiko
import sys
import io

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

host = "64.204.130.181"
user = "root"
pw = "4sXWo02f4WkNm8fM"

def run_fix():
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    try:
        client.connect(host, username=user, password=pw)
        print("Connected to VPS. Running update query to set match status to upcoming...")
        cmd = 'docker exec teen_postgres psql -U teen -d teen_db -c "UPDATE cricket_matches SET status = \'upcoming\', start_time = NOW() + INTERVAL \'1 day\' WHERE id = \'55c8c7db-115f-4d37-88f5-46ff85aa0001\';"'
        stdin, stdout, stderr = client.exec_command(cmd)
        print(stdout.read().decode('utf-8'))
        print(stderr.read().decode('utf-8'))
        
        # Reset leagues status just in case
        print("Resetting contest leagues status to open...")
        cmd2 = 'docker exec teen_postgres psql -U teen -d teen_db -c "UPDATE cricket_fantasy_leagues SET status = \'open\' WHERE match_id = \'55c8c7db-115f-4d37-88f5-46ff85aa0001\';"'
        stdin, stdout, stderr = client.exec_command(cmd2)
        print(stdout.read().decode('utf-8'))
        print(stderr.read().decode('utf-8'))
        
        # Clear any existing fantasy entries and teams for this match, to allow a clean test join
        print("Clearing prior fantasy entries and teams for this match to ensure clean draft joins...")
        cmd3 = 'docker exec teen_postgres psql -U teen -d teen_db -c "DELETE FROM cricket_fantasy_entries WHERE league_id IN (SELECT id FROM cricket_fantasy_leagues WHERE match_id = \'55c8c7db-115f-4d37-88f5-46ff85aa0001\');"'
        stdin, stdout, stderr = client.exec_command(cmd3)
        print(stdout.read().decode('utf-8'))
        
        cmd4 = 'docker exec teen_postgres psql -U teen -d teen_db -c "DELETE FROM user_fantasy_teams WHERE match_id = \'55c8c7db-115f-4d37-88f5-46ff85aa0001\';"'
        stdin, stdout, stderr = client.exec_command(cmd4)
        print(stdout.read().decode('utf-8'))

        print("Ensuring test user wallets have at least ₹5000 balance...")
        cmd5 = 'docker exec teen_postgres psql -U teen -d teen_db -c "UPDATE wallets SET real_balance = GREATEST(real_balance, 5000.00);"'
        stdin, stdout, stderr = client.exec_command(cmd5)
        print(stdout.read().decode('utf-8'))
        
        print("Successfully updated database status!")
    except Exception as e:
        print(f"Error: {e}")
    finally:
        client.close()

if __name__ == "__main__":
    run_fix()
