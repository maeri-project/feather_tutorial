#!/bin/bash
# Set up SSL certificate inside the container.
# Usage: docker exec -it raic-jupyterhub bash /srv/jupyterhub/setup_ssl.sh
#
# IMPORTANT: Before running this, the container must have port 80 exposed
# and the domain must resolve to this server.
# After running, uncomment the ssl_cert/ssl_key lines in jupyterhub_config.py
# and restart the container.

set -e

DOMAIN="zhang-capra-xcel.ece.cornell.edu"

echo "=== Setting up SSL for $DOMAIN ==="

pip install --upgrade certbot pyOpenSSL cryptography

# Stop jupyterhub temporarily so certbot can use port 80
# (certbot --standalone needs port 80)
certbot certonly --standalone -d "$DOMAIN"

echo "=== SSL certificate obtained ==="
echo ""
echo "Next steps:"
echo "1. Uncomment the ssl_cert and ssl_key lines in jupyterhub_config.py"
echo "2. Restart the container: docker restart raic-jupyterhub"
