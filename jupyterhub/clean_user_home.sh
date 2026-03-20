#!/bin/bash
# Clean all user home directories inside the Docker container
# Usage: docker exec -it raic-jupyterhub bash /srv/jupyterhub/clean_user_home.sh

CSV_FILE="/srv/jupyterhub/credentials.csv"

tail -n +2 "$CSV_FILE" | while IFS=',' read -r username password role; do
    home_dir="/home/$username"
    if [ -d "$home_dir" ]; then
        echo "Cleaning home directory of $username..."
        rm -rf "$home_dir"/*
    else
        echo "Home directory for $username does not exist, skipping..."
    fi
done

echo "Cleanup complete."
