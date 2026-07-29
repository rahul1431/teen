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
        print("Connected to VPS. Running Step 5: Configure Nginx custom files for Dev...")
        
        # 1. Define custom api configuration content for dev
        dev_api_conf = """# HestiaCP Nginx Custom Configuration for Dev
# File placed at: /home/admin/conf/web/dev.myonlinejoker.com/nginx.conf_api
#                 /home/admin/conf/web/dev.myonlinejoker.com/nginx.ssl.conf_api

# ── Auth ──
location /api/auth/ {
    rewrite ^/api/auth/(.*) /auth/$1 break;
    proxy_pass http://127.0.0.1:3201;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}

# ── Users ──
location /api/users/ {
    rewrite ^/api/users/(.*) /users/$1 break;
    proxy_pass http://127.0.0.1:3201;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}

# ── Wallet ──
location /api/wallet/ {
    rewrite ^/api/wallet/(.*) /wallet/$1 break;
    proxy_pass http://127.0.0.1:3203;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-Proto $scheme;
}

# ── Leaderboard ──
location /api/leaderboard/ {
    rewrite ^/api/leaderboard/(.*) /leaderboard/$1 break;
    proxy_pass http://127.0.0.1:3201;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
}

# ── Notifications ──
location /api/notifications/ {
    rewrite ^/api/notifications/(.*) /notifications/$1 break;
    proxy_pass http://127.0.0.1:3201;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
}

# ── Support ──
location /api/support/ {
    rewrite ^/api/support/(.*) /support/$1 break;
    proxy_pass http://127.0.0.1:3201;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}

# ── Admin Service ──
location /api/admin/ {
    proxy_pass http://127.0.0.1:3208;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-Proto $scheme;
}

# ── Public app version endpoint ──
location /api/app/ {
    proxy_pass http://127.0.0.1:3208;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
}

# ── App Monitor SDK ──
location /api/monitor/ {
    proxy_pass http://127.0.0.1:3215;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-Proto $scheme;
}

# ── Betting (Matka, Lottery, Cricket) → core-api ──
location /api/betting/ {
    rewrite ^/api/betting/(.*) /$1 break;
    proxy_pass http://127.0.0.1:3201;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-Proto $scheme;
}

# ── WebSocket: Aviator Engine ──
location /ws/aviator {
    proxy_pass http://127.0.0.1:3205;
    proxy_http_version 1.1;
    proxy_pass_header Upgrade;
    proxy_pass_header Connection;
    proxy_pass_header Sec-WebSocket-Accept;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_read_timeout 86400s;
    proxy_send_timeout 86400s;
    proxy_buffering off;
}

# ── WebSocket: Game Gateway ──
location /ws {
    proxy_pass http://dev_game_backend;
    proxy_http_version 1.1;
    proxy_pass_header Upgrade;
    proxy_pass_header Connection;
    proxy_pass_header Sec-WebSocket-Accept;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_read_timeout 86400s;
    proxy_send_timeout 86400s;
    proxy_buffering off;
}

# ── Admin Panel (React SPA) ──
location /admin {
    alias /opt/teen/admin-panel/dist;
    try_files $uri $uri/ /admin/index.html;
    add_header Cache-Control "no-cache";
}

# ── User uploads ──
location /uploads/ {
    alias /opt/teen/uploads/;
    expires 7d;
    add_header Cache-Control "public";
    location /uploads/kyc/ {
        deny all;
        return 403;
    }
}

# ── Static resources ──
location /resources/ {
    alias /opt/teen/resources/;
    expires 1h;
}

# ── Block internal routes ──
location /internal/ {
    deny all;
    return 403;
}
"""
        
        # Write nginx.conf_api and nginx.ssl.conf_api
        sftp = client.open_sftp()
        dev_conf_dir = "/home/admin/conf/web/dev.myonlinejoker.com"
        
        print("Writing nginx.conf_api...")
        f_conf = sftp.open(f"{dev_conf_dir}/nginx.conf_api", "w")
        f_conf.write(dev_api_conf)
        f_conf.close()
        
        print("Writing nginx.ssl.conf_api...")
        f_ssl = sftp.open(f"{dev_conf_dir}/nginx.ssl.conf_api", "w")
        f_ssl.write(dev_api_conf)
        f_ssl.close()
        
        # 2. Modify dev Nginx config files to remove nested locations and match production layout
        target_location_block = """\tlocation / {
\t\tproxy_pass http://dev_game_backend;

\t\tlocation ~* ^.+\\.(css|htm|html|js|mjs|json|xml|apng|avif|bmp|cur|gif|ico|jfif|jpg|jpeg|pjp|pjpeg|png|svg|tif|tiff|webp|aac|caf|flac|m4a|midi|mp3|ogg|opus|wav|3gp|av1|avi|m4v|mkv|mov|mpg|mpeg|mp4|mp4v|webm|otf|ttf|woff|woff2|doc|docx|odf|odp|ods|odt|pdf|ppt|pptx|rtf|txt|xls|xlsx|7z|bz2|gz|rar|tar|tgz|zip|apk|appx|bin|dmg|exe|img|iso|jar|msi|webmanifest)$ {
\t\t\ttry_files  $uri @fallback;

\t\t\troot       /home/admin/web/dev.myonlinejoker.com/public_html;
\t\t\taccess_log /var/log/apache2/domains/dev.myonlinejoker.com.log combined;
\t\t\taccess_log /var/log/apache2/domains/dev.myonlinejoker.com.bytes bytes;

\t\t\texpires    max;
\t\t}
\t}"""
        
        def clean_nginx_conf(filepath):
            print(f"Cleaning main config file: {filepath}")
            content = sftp.open(filepath).read().decode('utf-8')
            
            # We want to replace everything from "location / {" to the matching closing bracket
            # inside the server {} block.
            # In Nginx config, Hestia puts comments and then nested blocks.
            # Let's find "location / {" and replace it with our target clean block.
            # Since the nested block can be large, we can replace the range from "location / {"
            # up to "location @fallback {" or "location /error/ {" (since error/ location follows it).
            pattern = r"location / \{[\s\S]*?(?=location @fallback \{|location /error/ \{)"
            if re.search(pattern, content):
                content = re.sub(pattern, target_location_block + "\n\n\t", content)
                f = sftp.open(filepath, "w")
                f.write(content)
                f.close()
                print(f"Successfully cleaned {filepath}")
            else:
                print(f"Pattern not found in {filepath}. Checking if already clean.")
                if "alias /opt/teen/admin-panel/dist" in content:
                    print(f"WARNING: could not clean {filepath} automatically. Direct rewrite required.")
                    
        clean_nginx_conf(f"{dev_conf_dir}/nginx.conf")
        clean_nginx_conf(f"{dev_conf_dir}/nginx.ssl.conf")
        
        sftp.close()
        
        # 3. Test and reload Nginx
        cmds = [
            "nginx -t",
            "systemctl reload nginx"
        ]
        for cmd in cmds:
            print(f"\nExecuting: {cmd}")
            stdin, stdout, stderr = client.exec_command(cmd)
            out = stdout.read().decode('utf-8', errors='replace')
            err = stderr.read().decode('utf-8', errors='replace')
            if out:
                print(out.strip())
            if err:
                print("ERROR / STDERR:")
                print(err.strip())
                
        print("\nStep 5 completed successfully.")

    except Exception as e:
        print(f"Failed: {e}")
    finally:
        client.close()

if __name__ == "__main__":
    main()
