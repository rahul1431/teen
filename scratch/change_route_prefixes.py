import io
import sys

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

def main():
    filepath = "services/admin-service/src/deployment-routes.ts"
    print(f"Reading {filepath}...")
    with open(filepath, "r", encoding="utf-8") as f:
        code = f.read()

    # Replace route definitions '/api/dev' with '/api/admin/dev'
    # Use both single quotes and double quotes or slash prefixes to be comprehensive
    modified = code.replace("'/api/dev", "'/api/admin/dev")
    modified = modified.replace('"/api/dev', '"/api/admin/dev')
    # Also replace in string logs / comments if appropriate
    modified = modified.replace("/api/dev/deployment-status/", "/api/admin/dev/deployment-status/")

    with open(filepath, "w", encoding="utf-8") as f:
        f.write(modified)
    print("Successfully updated route prefixes in deployment-routes.ts.")

if __name__ == "__main__":
    main()
