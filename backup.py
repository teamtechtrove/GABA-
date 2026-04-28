import os
import subprocess
import datetime
import zipfile
from supabase import create_client

SUPABASE_URL = os.environ.get("SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY")
GITHUB_TOKEN = os.environ.get("GITHUB_TOKEN")
REPO = os.environ.get("GITHUB_REPO", "your-username/gaba-backup")  # set this in Secrets

if not SUPABASE_URL or not SUPABASE_KEY:
    print("ERROR: Supabase credentials missing")
    exit(1)

timestamp = datetime.datetime.utcnow().strftime("%Y%m%d_%H%M%S")
zip_name = f"gaba_backup_{timestamp}.zip"

# Create ZIP (exclude large / unnecessary)
with zipfile.ZipFile(zip_name, 'w') as zipf:
    for root, dirs, files in os.walk("."):
        if "__pycache__" in dirs:
            dirs.remove("__pycache__")
        if ".git" in dirs:
            dirs.remove(".git")
        if "venv" in dirs:
            dirs.remove("venv")
        for file in files:
            if file.endswith(".pyc") or file == zip_name:
                continue
            zipf.write(os.path.join(root, file))

# Upload to Supabase Storage
supabase = create_client(SUPABASE_URL, SUPABASE_KEY)
try:
    with open(zip_name, "rb") as f:
        supabase.storage.from_("backups").upload(zip_name, f)
    print(f"Uploaded to Supabase: {zip_name}")
except Exception as e:
    print(f"Supabase upload failed: {e}")

# Git push if token and repo set
if GITHUB_TOKEN and REPO and "your-username" not in REPO:
    try:
        # Configure git remote (assumes already initialized)
        remote_url = f"https://{GITHUB_TOKEN}@github.com/{REPO}.git"
        subprocess.run(["git", "remote", "set-url", "origin", remote_url], capture_output=True)
        subprocess.run(["git", "add", "."], capture_output=True)
        subprocess.run(["git", "commit", "-m", f"Auto backup {timestamp}"], capture_output=True)
        subprocess.run(["git", "push", "origin", "main"], capture_output=True)
        print("GitHub push successful")
    except Exception as e:
        print(f"Git push error: {e}")
else:
    print("GitHub backup skipped (missing token or repo)")

os.remove(zip_name)
print("Backup complete.")