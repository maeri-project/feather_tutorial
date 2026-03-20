#!/bin/bash
# One-click script to build and start the RAIC JupyterHub
# Usage: ./start.sh
#
# Options:
#   --rebuild    Force rebuild the Docker image

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONTAINER_NAME="raic-jupyterhub"
IMAGE_NAME="raic-jupyterhub"
DATA_DIR="/work/zhang-capra/users/nz264/jupyterhub/raic-jupyterhub/data"
VITIS_HLS_DIR="/opt/xilinx/Xilinx_Vivado_Vitis_2022.1"

# Parse arguments
REBUILD=false
for arg in "$@"; do
    case $arg in
        --rebuild) REBUILD=true ;;
    esac
done

echo "=== RAIC JupyterHub Launcher ==="

# Create persistent data directory
mkdir -p "$DATA_DIR"

# Stop and remove existing container if running
if docker ps -a --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
    echo "Stopping existing container..."
    docker stop "$CONTAINER_NAME" 2>/dev/null || true
    docker rm "$CONTAINER_NAME" 2>/dev/null || true
fi

# Clone or update feather_tutorial
if [ ! -d "$SCRIPT_DIR/feather_tutorial" ]; then
    echo "Cloning feather_tutorial..."
    git clone https://github.com/maeri-project/feather_tutorial.git "$SCRIPT_DIR/feather_tutorial"
    cd "$SCRIPT_DIR/feather_tutorial"
    git checkout tutorials
    git submodule update --init --recursive
    cd "$SCRIPT_DIR"
else
    echo "Pulling latest feather_tutorial..."
    cd "$SCRIPT_DIR/feather_tutorial"
    git fetch origin tutorials
    git checkout tutorials
    git pull origin tutorials
    git submodule update --init --recursive
    cd "$SCRIPT_DIR"
fi

# Build image if needed
if $REBUILD || ! docker images --format '{{.Repository}}' | grep -q "^${IMAGE_NAME}$"; then
    echo "Building Docker image..."
    docker build -t "$IMAGE_NAME" "$SCRIPT_DIR"
fi

# Compose docker run command
DOCKER_ARGS=(
    run -d
    --name "$CONTAINER_NAME"
    -p 443:443
    -v "${DATA_DIR}:/srv/jupyterhub/data"
    -v "${SCRIPT_DIR}/feather_tutorial/shared:/srv/jupyterhub/shared"
    -v "${SCRIPT_DIR}/feather_tutorial:/opt/feather_tutorial"
    -v "${SCRIPT_DIR}/certs:/etc/letsencrypt"
)

# Mount Vitis HLS if available
if [ -d "$VITIS_HLS_DIR" ]; then
    echo "Mounting Vitis HLS from $VITIS_HLS_DIR"
    DOCKER_ARGS+=(-v "${VITIS_HLS_DIR}:${VITIS_HLS_DIR}:ro")
fi

DOCKER_ARGS+=("$IMAGE_NAME")

echo "Starting container..."
docker "${DOCKER_ARGS[@]}"

echo ""
echo "=== Container started! ==="
echo ""

# Create users inside the container
echo "Creating users..."
docker exec "$CONTAINER_NAME" bash /srv/jupyterhub/create_users.sh

echo ""
echo "=========================================="
echo " JupyterHub is running!"
echo " URL: https://zhang-capra-xcel.ece.cornell.edu"
echo ""
echo " To set up Allo:"
echo "   docker exec -it $CONTAINER_NAME bash /srv/jupyterhub/setup_allo.sh"
echo ""
echo " To set up SSL:"
echo "   docker exec -it $CONTAINER_NAME bash /srv/jupyterhub/setup_ssl.sh"
echo ""
echo " To enter the container:"
echo "   docker exec -it $CONTAINER_NAME bash"
echo ""
echo " To stop:"
echo "   docker stop $CONTAINER_NAME"
echo ""
echo " To view logs:"
echo "   docker logs -f $CONTAINER_NAME"
echo "=========================================="
