#!/bin/bash
# Create users inside the Docker container from credentials.csv
# Usage: docker exec -it raic-jupyterhub bash /srv/jupyterhub/create_users.sh

CSV_FILE="/srv/jupyterhub/credentials.csv"

if [ ! -f "$CSV_FILE" ]; then
    echo "Error: $CSV_FILE not found"
    exit 1
fi

SHARED_DIR="/srv/jupyterhub/shared"

# Skip header line, read each row
tail -n +2 "$CSV_FILE" | while IFS=',' read -r username password role; do
    useradd -m -s /bin/bash "$username" 2>/dev/null || true
    echo "$username:$password" | chpasswd

    # Copy shared files to user home
    user_home="/home/$username"
    if [ -d "$SHARED_DIR" ] && [ -d "$user_home" ]; then
        # Copy with --no-preserve=mode so files get user's default permissions
        cp -r --no-preserve=mode "$SHARED_DIR"/* "$user_home/" 2>/dev/null || true
        chown -R "$username:$username" "$user_home/" 2>/dev/null || true
        chmod -R 777 "$user_home/" 2>/dev/null || true
    fi

    # Add env vars to user's .bashrc (for JupyterHub terminal sessions)
    if ! grep -q "FEATHER_MAPPER_SCRIPT" "$user_home/.bashrc" 2>/dev/null; then
        echo 'export FEATHER_MAPPER_SCRIPT="/opt/feather_tutorial/act-feather/feather/compiler/ACT/launch_cost_model.py"' >> "$user_home/.bashrc"
        echo 'export PATH="/opt/feather_tutorial/act-feather/act-backend/target/release:/opt/conda/bin:$PATH"' >> "$user_home/.bashrc"
        chown "$username:$username" "$user_home/.bashrc"
    fi

    echo "Created $username ($role) with password $password"
done
