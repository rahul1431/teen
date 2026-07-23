import paramiko
import sys
import io
import re

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

host = "64.204.130.181"
user = "root"
pw = "4sXWo02f4WkNm8fM"

def main():
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    try:
        client.connect(host, username=user, password=pw)
        print("Connected to VPS. Starting Step 1: Generate .env.dev files...")
        
        # 1. Update ecosystem.config.dev.js on the VPS if needed
        sftp = client.open_sftp()
        try:
            config_content = sftp.open("/opt/teen/ecosystem.config.dev.js").read().decode('utf-8')
            if "env_file: ENV_FILE('churn-ml-service')" not in config_content:
                print("Updating ecosystem.config.dev.js to support env_file for churn-ml-service...")
                target = """    // ── Churn ML: Local Python FastAPI Server ──
    {
      name: 'teen-churn-ml-dev',
      cwd: `${BASE}/churn-ml-service`,
      script: 'venv/bin/uvicorn',
      args: 'main:app --host 127.0.0.1 --port 3220',
      instances: 1,
      exec_mode: 'fork',
      watch: false,
      interpreter: 'none',
      env: {
        DATABASE_URL: process.env.DATABASE_URL
      }
    },"""
                replacement = """    // ── Churn ML: Local Python FastAPI Server ──
    {
      name: 'teen-churn-ml-dev',
      cwd: `${BASE}/churn-ml-service`,
      script: 'venv/bin/uvicorn',
      args: 'main:app --host 127.0.0.1 --port 3220',
      env_file: ENV_FILE('churn-ml-service'),
      instances: 1,
      exec_mode: 'fork',
      watch: false,
      interpreter: 'none',
      env: {
        NODE_ENV: 'development'
      }
    },"""
                config_content = config_content.replace(target, replacement)
                # If the exact match fails (whitespace etc.), do a more robust replace
                if "env_file: ENV_FILE('churn-ml-service')" not in config_content:
                    config_content = re.sub(
                        r"name:\s*'teen-churn-ml-dev',\s*cwd:\s*\`\$\{BASE\}/churn-ml-service\`,\s*script:\s*'venv/bin/uvicorn',\s*args:\s*'main:app\s+--host\s+127.0.0.1\s+--port\s+3220',",
                        "name: 'teen-churn-ml-dev',\n      cwd: `${BASE}/churn-ml-service`,\n      script: 'venv/bin/uvicorn',\n      args: 'main:app --host 127.0.0.1 --port 3220',\n      env_file: ENV_FILE('churn-ml-service'),",
                        config_content
                    )
                
                f = sftp.open("/opt/teen/ecosystem.config.dev.js", "w")
                f.write(config_content)
                f.close()
                print("ecosystem.config.dev.js updated successfully.")
            else:
                print("ecosystem.config.dev.js already updated.")
        except Exception as e:
            print(f"Error updating ecosystem.config.dev.js: {e}")

        # 2. Services mapping
        services_ports = {
            "core-api-service": 3201,
            "wallet-service": 3203,
            "admin-service": 3208,
            "game-gateway": 3204,
            "game-engines/aviator": 3205,
            "game-engines/ludo": 3211,
            "game-engines/teen-patti": 3210,
            "monitoring-service": 3217,
            "risk-service": 3206,
            "churn-service": 3213,
            "app-monitor-service": 3215,
            "bot-learning-service": 3214
        }
        
        # We will loop through the services, copy their .env to .env.dev, and modify it
        for svc, port in services_ports.items():
            print(f"\nProcessing {svc}...")
            env_path = f"/opt/teen/services/{svc}/.env"
            env_dev_path = f"/opt/teen/services/{svc}/.env.dev"
            
            try:
                # Read prod env
                prod_env = sftp.open(env_path).read().decode('utf-8')
            except IOError:
                print(f"Prod .env not found for {svc}. Creating new .env.dev...")
                prod_env = ""
            
            lines = prod_env.split("\n")
            dev_lines = []
            
            # Keep track of keys we've written/modified
            keys_processed = set()
            
            for line in lines:
                stripped = line.strip()
                if not stripped or stripped.startswith("#"):
                    dev_lines.append(line)
                    continue
                
                if "=" in stripped:
                    k, v = stripped.split("=", 1)
                    k = k.strip()
                    v = v.strip()
                    keys_processed.add(k)
                    
                    # Apply transformations
                    if k == "NODE_ENV":
                        v = "development"
                    elif k == "DATABASE_URL":
                        # Replace database name teen_db with teen_db_dev
                        v = v.replace("/teen_db", "/teen_db_dev")
                    elif k == "REDIS_URL":
                        # Replace redis port 6379 with 6380
                        v = v.replace(":6379", ":6380")
                    elif k == "REDIS_PORT":
                        v = "6380"
                    elif k == "PORT":
                        v = str(port)
                    elif k == "APP_URL":
                        v = "https://dev.myonlinejoker.com"
                    else:
                        # Replace internal service urls
                        # replace wallet
                        v = re.sub(r":3003\b", ":3203", v)
                        # replace core-api / notifications / auth / users / betting / support
                        v = re.sub(r":3001\b", ":3201", v)
                        # replace admin-svc
                        v = re.sub(r":3008\b", ":3208", v)
                        # replace gateway
                        v = re.sub(r":3004\b", ":3204", v)
                        # replace aviator
                        v = re.sub(r":3005\b", ":3205", v)
                        # replace ludo
                        v = re.sub(r":3011\b", ":3211", v)
                        # replace tp-engine
                        v = re.sub(r":3010\b", ":3210", v)
                        # replace churn ml
                        v = re.sub(r":3020\b", ":3220", v)
                    
                    dev_lines.append(f"{k}={v}")
                else:
                    dev_lines.append(line)
            
            # Ensure essential keys are present
            if "NODE_ENV" not in keys_processed:
                dev_lines.append("NODE_ENV=development")
            if "PORT" not in keys_processed and port:
                dev_lines.append(f"PORT={port}")
            if "DATABASE_URL" not in keys_processed:
                # Get DB URL from admin-service or core-api-service if possible
                dev_lines.append("DATABASE_URL=postgresql://teen:4f27e37a4251d17033741c22@localhost:5432/teen_db_dev")
            if "REDIS_URL" not in keys_processed:
                dev_lines.append("REDIS_URL=redis://localhost:6380")
                
            # Write to env.dev
            dev_env_content = "\n".join(dev_lines)
            f_dev = sftp.open(env_dev_path, "w")
            f_dev.write(dev_env_content)
            f_dev.close()
            print(f"Successfully wrote {env_dev_path}")
            
        # Special case: churn-ml-service has no .env. Write a new one.
        print("\nProcessing churn-ml-service...")
        churn_ml_dev_env = """DATABASE_URL=postgresql://teen:4f27e37a4251d17033741c22@localhost:5432/teen_db_dev
REDIS_URL=redis://localhost:6380
PORT=3220
NODE_ENV=development
"""
        f_churn_ml = sftp.open("/opt/teen/services/churn-ml-service/.env.dev", "w")
        f_churn_ml.write(churn_ml_dev_env)
        f_churn_ml.close()
        print("Successfully wrote /opt/teen/services/churn-ml-service/.env.dev")
        
        sftp.close()
        print("\nStep 1 completed successfully.")

    except Exception as e:
        print(f"Step 1 failed: {e}")
    finally:
        client.close()

if __name__ == "__main__":
    main()
