#!/bin/bash
# Create users inside the Docker container from credentials.csv
# Usage: docker exec -it raic-jupyterhub bash /srv/jupyterhub/create_users.sh

CSV_FILE="/srv/jupyterhub/credentials.csv"

if [ ! -f "$CSV_FILE" ]; then
    echo "Error: $CSV_FILE not found"
    exit 1
fi

# Skip header line, read each row
tail -n +2 "$CSV_FILE" | while IFS=',' read -r username password role; do
    useradd -m "$username" 2>/dev/null || true
    echo "$username:$password" | chpasswd
    echo "Created $username ($role) with password $password"
done
