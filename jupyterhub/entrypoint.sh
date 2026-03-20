#!/bin/bash
# Entrypoint script for RAIC JupyterHub container
# Runs at container startup to update feather and distribute shared files

set -e

echo "=== JupyterHub Entrypoint ==="

# --- Step 1: Pull latest feather_tutorial ---
if [ -d /opt/feather_tutorial/.git ]; then
    echo "Pulling latest feather_tutorial (tutorials branch)..."
    git config --global --add safe.directory '*'
    cd /opt/feather_tutorial
    git fetch origin tutorials
    git checkout tutorials
    git pull origin tutorials
    git submodule update --init --recursive
    cd /srv/jupyterhub
else
    echo "Warning: /opt/feather_tutorial is not a git repo, skipping pull"
fi

# --- Step 2: Build/install act-feather in /opt ---
echo "Building act-feather..."
cd /opt/feather_tutorial/act-feather/act-backend
cargo build --release
echo "act-feather installed at /opt/feather_tutorial/act-feather/act-backend/target/release/"

# Verify
act-feather --help > /dev/null 2>&1 && echo "act-feather is available on PATH" || echo "Warning: act-feather not found on PATH"

# --- Step 3: Copy shared/ to all user home directories ---
SHARED_DIR="/srv/jupyterhub/shared"
if [ -d "$SHARED_DIR" ]; then
    echo "Copying shared files to user home directories..."
    for user_home in /home/*/; do
        if [ -d "$user_home" ]; then
            username=$(basename "$user_home")
            cp -r "$SHARED_DIR"/* "$user_home/" 2>/dev/null || true
            chown -R "$username:$username" "$user_home/" 2>/dev/null || true
            echo "  Copied shared files to $user_home"
        fi
    done
else
    echo "Warning: $SHARED_DIR not found, skipping copy"
fi

cd /srv/jupyterhub

echo "=== Entrypoint complete, starting JupyterHub ==="

# Start JupyterHub
exec jupyterhub
