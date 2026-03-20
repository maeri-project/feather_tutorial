# RAIC JupyterHub

Docker-based JupyterHub for the RAIC tutorial, running on `zhang-capra-xcel.ece.cornell.edu`.

Includes two tutorials:
- **Allo** — Python-based hardware accelerator design (shared conda env at `/opt/conda-envs/allo`)
- **Feather** — MAERI/FEATHER accelerator compiler (`act-feather` binary, globally installed)

## Quick Start

```bash
./start.sh           # Build image, start container, create users
./start.sh --rebuild  # Force rebuild the Docker image
```

JupyterHub will be available at `https://zhang-capra-xcel.ece.cornell.edu`.

## User Management

User credentials are stored in `credentials.csv`:

```csv
username,password,role
user1,monza-sp1,user
jianming,ferrari-250gto,admin
```

To update users, edit `credentials.csv` and restart:

```bash
./start.sh --rebuild
```

## Post-Start Setup

### Install Allo (required for Allo tutorial)

```bash
docker exec -it raic-jupyterhub bash /srv/jupyterhub/setup_allo.sh
```

This clones and builds Allo + MLIR in `/opt/allo` (~30 min).

### Feather Tutorial

The Feather compiler is pre-installed. Users can run:

```bash
cd /opt/feather_tutorial
act-feather --input attention_q_sliced.hlo --log ./log/
```

### Shared Notebooks

Place `.ipynb` files in the `shared/` directory. They are automatically copied to each user's home directory on login.

## SSL Certificate

The SSL certificate is managed via Let's Encrypt (certbot). To renew:

```bash
docker stop raic-jupyterhub
# Run certbot in a temporary container
docker run --rm -p 80:80 \
  -v "$(pwd)/certs:/etc/letsencrypt" \
  raic-jupyterhub bash -c \
  "pip install --upgrade certbot pyOpenSSL cryptography && \
   certbot certonly --standalone -d zhang-capra-xcel.ece.cornell.edu \
   --non-interactive --agree-tos --register-unsafely-without-email"
./start.sh
```

## Container Management

```bash
docker exec -it raic-jupyterhub bash    # Enter the container
docker logs -f raic-jupyterhub          # View logs
docker stop raic-jupyterhub             # Stop
docker restart raic-jupyterhub          # Restart
```
