import urllib.request
import json
import sys

def fetch_github_runs():
    # Since the repository is public, we can fetch runs anonymously.
    # We pass a User-Agent to avoid getting blocked by GitHub.
    url = "https://api.github.com/repos/rahul1431/teen/actions/runs?per_page=30"
    req = urllib.request.Request(url)
    req.add_header("User-Agent", "Python-urllib")
    req.add_header("Accept", "application/vnd.github.v3+json")
    
    try:
        with urllib.request.urlopen(req, timeout=15) as response:
            data = json.loads(response.read().decode('utf-8'))
            return data
    except Exception as e:
        print(f"Error fetching GitHub runs: {e}")
        return None

def main():
    runs_data = fetch_github_runs()
    if not runs_data or 'workflow_runs' not in runs_data:
        print("Failed to fetch workflow runs or empty response.")
        sys.exit(1)
        
    print("\nLATEST GITHUB ACTIONS RUNS:")
    print("=" * 80)
    
    # Filter for Flutter build workflow or print all mobile-related runs
    for run in runs_data['workflow_runs']:
        name = run.get('name', 'Unknown')
        event = run.get('event', 'push')
        status = run.get('status', 'unknown')
        conclusion = run.get('conclusion', 'pending')
        html_url = run.get('html_url', '')
        branch = run.get('head_branch', '')
        created_at = run.get('created_at', '')
        commit_message = run.get('head_commit', {}).get('message', '').split('\n')[0]
        
        # We are interested in "Build Flutter APK" or general mobile app checks
        print(f"Workflow Name: {name}")
        print(f"Branch:        {branch}")
        print(f"Commit Msg:    {commit_message}")
        print(f"Status:        {status}")
        print(f"Conclusion:    {conclusion}")
        print(f"URL:           {html_url}")
        print(f"Created At:    {created_at}")
        print("-" * 80)

if __name__ == '__main__':
    main()
