#!/bin/bash
# One-click script to build and start the RAIC JupyterHub
# Usage: ./start.sh
#
# Options:
#   --rebuild    Force rebuild the Docker image and restart container
#   --refresh    Update shared files to all users (no container restart)

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONTAINER_NAME="raic-jupyterhub"
IMAGE_NAME="raic-jupyterhub"
DATA_DIR="/work/zhang-capra/users/nz264/jupyterhub/raic-jupyterhub/data"
VITIS_HLS_DIR="/opt/xilinx/Xilinx_Vivado_Vitis_2022.1"

# Parse arguments
REBUILD=false
REFRESH=false
for arg in "$@"; do
    case $arg in
        --rebuild) REBUILD=true ;;
        --refresh) REFRESH=true ;;
    esac
done

# ──────────────────────────────────────────────────────────────
# --refresh: Pull latest repo and redistribute shared files
# to all user home directories without restarting the container.
# ──────────────────────────────────────────────────────────────
if $REFRESH; then
    echo "=== Refreshing shared files ==="

    # Pull latest repo on host
    if [ -d "$SCRIPT_DIR/feather_tutorial" ]; then
        echo "Pulling latest feather_tutorial..."
        cd "$SCRIPT_DIR/feather_tutorial"
        git fetch origin tutorials
        git checkout tutorials
        git pull origin tutorials
        git submodule update --init --recursive
        cd "$SCRIPT_DIR"
    fi

    # Check container is running
    if ! docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
        echo "Error: Container $CONTAINER_NAME is not running. Use ./start.sh (without --refresh) first."
        exit 1
    fi

    # Copy shared files to all user home directories
    echo "Copying shared files to all users..."
    docker exec "$CONTAINER_NAME" bash -c '
        SHARED_DIR="/srv/jupyterhub/shared"
        if [ -d "$SHARED_DIR" ]; then
            for user_home in /home/*/; do
                if [ -d "$user_home" ]; then
                    username=$(basename "$user_home")
                    cp -r --no-preserve=mode "$SHARED_DIR"/* "$user_home/" 2>/dev/null || true
                    chown -R "$username:$username" "$user_home/" 2>/dev/null || true
                    chmod -R 777 "$user_home/" 2>/dev/null || true
                    echo "  Updated $username"
                fi
            done
        fi
    '

    echo ""
    echo "=== Refresh complete! ==="
    echo "Users may need to reopen notebooks to see changes."
    exit 0
fi

# ──────────────────────────────────────────────────────────────
# Full start (default or --rebuild): build image, start container
# ──────────────────────────────────────────────────────────────
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

# Mount prebuilt LLVM if available (avoids 30+ min build inside container)
LLVM_BUILD_DIR="/work/shared/common/llvm-project-main"
if [ -d "$LLVM_BUILD_DIR" ]; then
    echo "Mounting prebuilt LLVM from $LLVM_BUILD_DIR"
    DOCKER_ARGS+=(-v "${LLVM_BUILD_DIR}:${LLVM_BUILD_DIR}:ro")
fi

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

# Wait for the entrypoint to finish and JupyterHub to start
echo "Waiting for JupyterHub to be ready (entrypoint runs git pull + cargo build)..."
echo "This may take a few minutes on first start..."
TIMEOUT=300
ELAPSED=0
while [ $ELAPSED -lt $TIMEOUT ]; do
    if docker exec "$CONTAINER_NAME" pgrep -f "jupyterhub" > /dev/null 2>&1; then
        echo "JupyterHub process detected!"
        break
    fi
    sleep 5
    ELAPSED=$((ELAPSED + 5))
    echo "  Still waiting... (${ELAPSED}s)"
done

if [ $ELAPSED -ge $TIMEOUT ]; then
    echo "Warning: Timed out waiting for JupyterHub. Check logs with: docker logs $CONTAINER_NAME"
fi

# Create users inside the container
echo "Creating users..."
docker exec "$CONTAINER_NAME" bash /srv/jupyterhub/create_users.sh

# Set up Allo environment
echo ""
echo "Setting up Allo (this may take a few minutes)..."
docker exec "$CONTAINER_NAME" bash /srv/jupyterhub/setup_allo.sh

echo ""
echo "=========================================="
echo " JupyterHub is running!"
echo " URL: https://zhang-capra-xcel.ece.cornell.edu"
echo ""
echo " To refresh shared files (no restart):"
echo "   ./start.sh --refresh"
echo ""
echo " To rebuild from scratch:"
echo "   ./start.sh --rebuild"
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
