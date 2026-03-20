FROM quay.io/jupyterhub/jupyterhub:latest

# Install system dependencies (includes bash-completion for tab completion)
RUN apt-get update && apt-get install -y \
    build-essential \
    gcc-12 g++-12 \
    ninja-build \
    passwd \
    python3-pip \
    python3-certbot \
    git \
    wget \
    curl \
    bash-completion \
    clang-14 \
    zlib1g-dev \
    libabsl-dev \
    graphviz \
    tree \
    vim \
    && rm -rf /var/lib/apt/lists/*

# Enable bash-completion for all users
RUN echo '\n# Enable bash completion\nif [ -f /etc/bash_completion ]; then\n    . /etc/bash_completion\nfi' >> /etc/bash.bashrc

# Install CMake
RUN wget -q https://github.com/Kitware/CMake/releases/download/v3.21.0/cmake-3.21.0-linux-x86_64.sh \
    && chmod +x cmake-3.21.0-linux-x86_64.sh \
    && ./cmake-3.21.0-linux-x86_64.sh --skip-license --prefix=/usr/local \
    && rm cmake-3.21.0-linux-x86_64.sh

# Install JupyterLab and notebook
RUN pip install jupyterlab notebook

# Install conda (miniforge)
RUN wget -q https://github.com/conda-forge/miniforge/releases/latest/download/Miniforge3-Linux-x86_64.sh -O /tmp/miniforge.sh \
    && bash /tmp/miniforge.sh -b -p /opt/conda \
    && rm /tmp/miniforge.sh

ENV PATH="/opt/conda/bin:$PATH"

# Create shared conda environment with Allo
RUN conda create -p /opt/conda-envs/allo python=3.12 -y \
    && /opt/conda-envs/allo/bin/pip install --upgrade pip setuptools wheel

# Install ipykernel in the allo env and register it
RUN /opt/conda-envs/allo/bin/pip install ipykernel \
    && /opt/conda-envs/allo/bin/python -m ipykernel install --prefix=/usr/local --name "python_allo" --display-name "Python (Allo)"

# Fix GLIBCXX issue
RUN conda install -p /opt/conda-envs/allo -c conda-forge libstdcxx-ng -y

# ============================================================
# FEATHER Tutorial Setup
# ============================================================

# Install Rust
ENV RUSTUP_HOME=/opt/rustup
ENV CARGO_HOME=/opt/cargo
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --default-toolchain stable
ENV PATH="/opt/cargo/bin:$PATH"

# Install OR-Tools v9.12
ENV ORTOOLS_DIR=/opt/ortools
RUN mkdir -p $ORTOOLS_DIR \
    && wget -q https://github.com/google/or-tools/releases/download/v9.12/or-tools_amd64_ubuntu-22.04_cpp_v9.12.4544.tar.gz -O /tmp/ortools.tar.gz \
    && tar -xzf /tmp/ortools.tar.gz -C $ORTOOLS_DIR --strip-components=1 \
    && rm /tmp/ortools.tar.gz
ENV LD_LIBRARY_PATH="$ORTOOLS_DIR/lib:$LD_LIBRARY_PATH"

# Install nlohmann/json v3.12.0
ENV NLOHMANN_JSON_DIR=/opt/nlohmann_json
RUN mkdir -p $NLOHMANN_JSON_DIR \
    && wget -q https://github.com/nlohmann/json/releases/download/v3.12.0/json.tar.xz -O /tmp/json.tar.xz \
    && tar -xJf /tmp/json.tar.xz -C $NLOHMANN_JSON_DIR --strip-components=1 \
    && rm /tmp/json.tar.xz

# Copy feather_tutorial (pre-cloned on host by start.sh)
COPY feather_tutorial/ /opt/feather_tutorial/

# Install Python dependencies for feather mapper
RUN pip install PyYAML==6.0.3 pandas numpy matplotlib

# Build the feather compiler
RUN cd /opt/feather_tutorial/act-feather/act-backend \
    && cargo build --release

# Add act-feather to PATH and set mapper env var
ENV PATH="/opt/feather_tutorial/act-feather/act-backend/target/release:$PATH"
ENV FEATHER_MAPPER_SCRIPT="/opt/feather_tutorial/act-feather/feather/compiler/ACT/launch_cost_model.py"

# Test: verify the compiler binary exists
RUN act-feather --help || true

# Make feather_tutorial readable by all users
RUN chmod -R a+rX /opt/feather_tutorial

# ============================================================
# Copy config and scripts
# ============================================================
COPY jupyterhub_config.py /srv/jupyterhub/jupyterhub_config.py
COPY create_users.sh /srv/jupyterhub/create_users.sh
COPY credentials.csv /srv/jupyterhub/credentials.csv
COPY clean_user_home.sh /srv/jupyterhub/clean_user_home.sh
COPY shared/ /srv/jupyterhub/shared/
COPY entrypoint.sh /srv/jupyterhub/entrypoint.sh

RUN chmod +x /srv/jupyterhub/create_users.sh /srv/jupyterhub/clean_user_home.sh /srv/jupyterhub/entrypoint.sh

WORKDIR /srv/jupyterhub

EXPOSE 443

ENTRYPOINT ["/srv/jupyterhub/entrypoint.sh"]
