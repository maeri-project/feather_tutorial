#!/bin/bash
# Install Allo in the shared conda environment inside the container.
# Usage: docker exec -it raic-jupyterhub bash /srv/jupyterhub/setup_allo.sh
#
# This script should be run AFTER the container is up.
# It clones and builds Allo + MLIR in /opt/allo.

set -e

CONDA_ENV=/opt/conda-envs/allo
export PATH="$CONDA_ENV/bin:$PATH"

echo "=== Installing Allo ==="

# Clone Allo
if [ ! -d /opt/allo ]; then
    git clone https://github.com/cornell-zhang/allo.git /opt/allo
fi

cd /opt/allo

# Build MLIR (this takes a while)
if [ ! -d /opt/allo/mlir/build ]; then
    echo "Building MLIR... (this may take 30+ minutes)"
    bash build.sh
fi

# Install Allo into the conda env
$CONDA_ENV/bin/pip install -e .

# Install PAST bindings
$CONDA_ENV/bin/pip install https://github.com/cornell-zhang/past-python-bindings/releases/download/65f989b/past-0.7.2-cp312-cp312-linux_x86_64.whl

echo "=== Allo installation complete ==="
echo "Test with: $CONDA_ENV/bin/python -c 'import allo; print(allo.__version__)'"
