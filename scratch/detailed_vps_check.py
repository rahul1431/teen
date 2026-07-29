import paramiko
import sys
import io

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

host = "64.204.130.181"
user = "root"
pw = "4sXWo02f4WkNm8fM"

def main():
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    try:
        client.connect(host, username=user, password=pw)
        
        report = []
        
        def run_cmd(title, cmd):
            report.append("="*80)
            report.append(f"### {title}")
            report.append(f"Command: {cmd}")
            report.append("="*80)
            stdin, stdout, stderr = client.exec_command(cmd)
            out = stdout.read().decode('utf-8', errors='replace')
            err = stderr.read().decode('utf-8', errors='replace')
            if out:
                report.append(out)
            if err:
                report.append("ERROR OUTPUT:")
                report.append(err)
            report.append("\n")

        run_cmd("PM2 List", "pm2 list")
        run_cmd("Dev Admin web dir content", "ls -la /home/admin/web/dev.myonlinejoker.com/public_html/admin/")
        run_cmd("Prod Admin web dir content", "ls -la /home/admin/web/game.myonlinejoker.com/public_html/admin/")
        run_cmd("Dev Hestia nginx.conf", "cat /home/admin/conf/web/dev.myonlinejoker.com/nginx.conf")
        run_cmd("Dev Hestia nginx.ssl.conf", "cat /home/admin/conf/web/dev.myonlinejoker.com/nginx.ssl.conf")
        run_cmd("Prod Hestia nginx.conf", "cat /home/admin/conf/web/game.myonlinejoker.com/nginx.conf")
        run_cmd("Prod Hestia nginx.ssl.conf", "cat /home/admin/conf/web/game.myonlinejoker.com/nginx.ssl.conf")
        run_cmd("Prod Nginx conf_api", "cat /home/admin/conf/web/game.myonlinejoker.com/nginx.ssl.conf_api")
        
        with open("scratch/vps_report.txt", "w", encoding="utf-8") as f:
            f.write("\n".join(report))
            
        print("Report written to scratch/vps_report.txt successfully.")

    except Exception as e:
        print(f"Failed: {e}")
    finally:
        client.close()

if __name__ == "__main__":
    main()
