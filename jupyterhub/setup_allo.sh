#!/bin/bash
# Install Allo in the shared conda environment inside the container.
# Usage: docker exec -it raic-jupyterhub bash /srv/jupyterhub/setup_allo.sh
#
# This script should be run AFTER the container is up.
# It clones Allo and either uses the prebuilt LLVM (if mounted from host)
# or builds LLVM from source (~30+ minutes).

set -e

CONDA_ENV=/opt/conda-envs/allo
export PATH="$CONDA_ENV/bin:/usr/local/bin:/usr/bin:/bin"

echo "=== Installing Allo ==="

# --- LLVM/MLIR Setup ---
PREBUILT_LLVM="/work/shared/common/llvm-project-main"
if [ -d "$PREBUILT_LLVM/build/bin" ]; then
    echo "Using prebuilt LLVM from $PREBUILT_LLVM"
    export LLVM_BUILD_DIR="$PREBUILT_LLVM/build"
    export PATH="$LLVM_BUILD_DIR/bin:$PATH"
    # No need for --recursive clone since we use prebuilt LLVM
    if [ ! -d /opt/allo ]; then
        git clone https://github.com/cornell-zhang/allo.git /opt/allo
    fi
else
    # No prebuilt LLVM available, clone with submodules and build from source
    if [ ! -d /opt/allo ]; then
        git clone --recursive https://github.com/cornell-zhang/allo.git /opt/allo
    fi
    cd /opt/allo
    if [ ! -f /opt/allo/externals/llvm-project/build/bin/mlir-opt ]; then
        echo "Building LLVM/MLIR from source... (this may take 30+ minutes)"
        cd /opt/allo/externals/llvm-project
        mkdir -p build && cd build
        cmake -G Ninja ../llvm \
            -DLLVM_ENABLE_PROJECTS="clang;mlir;openmp" \
            -DLLVM_BUILD_EXAMPLES=ON \
            -DLLVM_TARGETS_TO_BUILD="host" \
            -DCMAKE_BUILD_TYPE=Release \
            -DLLVM_ENABLE_ASSERTIONS=ON \
            -DLLVM_INSTALL_UTILS=ON \
            -DMLIR_ENABLE_BINDINGS_PYTHON=ON \
            -DPython3_EXECUTABLE=$(which python3)
        ninja
    fi
    export LLVM_BUILD_DIR=/opt/allo/externals/llvm-project/build
    export PATH="$LLVM_BUILD_DIR/bin:$PATH"
fi

cd /opt/allo

echo "LLVM_BUILD_DIR=$LLVM_BUILD_DIR"

# Install nanobind (needed for MLIR Python bindings build)
$CONDA_ENV/bin/pip install nanobind

# Pre-build MLIR Python bindings with cmake+ninja
# This avoids issues with pip's build isolation polluting PATH
echo "Building Allo MLIR bindings..."
rm -rf mlir/build
mkdir -p mlir/build && cd mlir/build
NANOBIND_DIR=$($CONDA_ENV/bin/python3 -c "import nanobind; print(nanobind.cmake_dir())")
cmake -G Ninja /opt/allo/mlir \
    -DMLIR_DIR=$LLVM_BUILD_DIR/lib/cmake/mlir \
    -DPython3_EXECUTABLE=$CONDA_ENV/bin/python3 \
    -Dnanobind_DIR=$NANOBIND_DIR \
    -DMLIR_BINDINGS_PYTHON_NB_DOMAIN=allo
ninja
cd /opt/allo

# Install Allo into the conda env
$CONDA_ENV/bin/python3 -m pip install -e .

# Install PAST bindings
$CONDA_ENV/bin/pip install https://github.com/cornell-zhang/past-python-bindings/releases/download/65f989b/past-0.7.2-cp312-cp312-linux_x86_64.whl

# Update the Jupyter kernel spec to include LLVM env vars
KERNEL_JSON=/usr/local/share/jupyter/kernels/python_allo/kernel.json
python3 -c "
import json
with open('$KERNEL_JSON') as f:
    k = json.load(f)
k['env'] = k.get('env', {})
k['env']['LLVM_BUILD_DIR'] = '$LLVM_BUILD_DIR'
k['env']['PATH'] = '$LLVM_BUILD_DIR/bin:$CONDA_ENV/bin:/usr/local/bin:/usr/bin:/bin'
with open('$KERNEL_JSON', 'w') as f:
    json.dump(k, f, indent=1)
print('Updated kernel.json with LLVM_BUILD_DIR=' + '$LLVM_BUILD_DIR')
"

# Make allo readable by all users
chmod -R a+rX /opt/allo

echo "=== Allo installation complete ==="
echo "Test with: $CONDA_ENV/bin/python -c 'import allo as allo; import allo.ir as air'"
