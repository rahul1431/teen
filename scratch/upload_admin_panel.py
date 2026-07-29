import paramiko
import sys
import io
import os

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

host = "64.204.130.181"
user = "root"
pw = "4sXWo02f4WkNm8fM"

def sftp_upload_dir(sftp, local_dir, remote_dir):
    """Recursively upload a directory via SFTP."""
    try:
        sftp.stat(remote_dir)
    except FileNotFoundError:
        sftp.mkdir(remote_dir)
    
    for item in os.listdir(local_dir):
        local_path = os.path.join(local_dir, item)
        remote_path = remote_dir + '/' + item
        if os.path.isdir(local_path):
            sftp_upload_dir(sftp, local_path, remote_path)
        else:
            sftp.put(local_path, remote_path)

def main():
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    try:
        client.connect(host, username=user, password=pw)
        print("Connected to VPS.")
        
        sftp = client.open_sftp()
        print("Uploading admin-panel/dist to /opt/teen-dev/admin-panel/dist...")
        sftp_upload_dir(sftp, "admin-panel/dist", "/opt/teen-dev/admin-panel/dist")
        print("Upload to teen-dev done.")
        
        sftp_upload_dir(sftp, "admin-panel/dist", "/opt/teen-prod/admin-panel/dist")
        print("Upload to teen-prod done.")
        
        sftp.close()
        print("Done uploading frontend builds to both environments.")
        
    except Exception as e:
        print(f"Failed: {e}")
        import traceback
        traceback.print_exc()
    finally:
        client.close()

if __name__ == "__main__":
    main()
