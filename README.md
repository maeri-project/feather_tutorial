# FEATHER Tutorial

Tutorial materials for the FEATHER accelerator, presented at RAIC.

**Tutorial website:** https://maeri-project.github.io/feather_tutorial/FEATHER.html

## Overview

This repository contains the compiler backend and hardware design materials for the FEATHER tutorial. Participants work through compiling attention kernels (XLA-HLO IR) to FEATHER's MINISA instruction set using both the ACT compiler backend and the Allo hardware design framework.

## File Structure

```
feather_tutorial/
├── act-feather/       # FEATHER-specific patches for ACT-generated compiler backend
│   ├── act-backend/   # Rust compiler backend source
│   ├── hlo_variants/  # XLA-HLO IR inputs for various attention configurations
│   └── docker/        # Docker environment for running the compiler
├── allo-feather/      # Allo-implemented FEATHER accelerator
│   └── minisa/        # MINISA ISA definition, lowering, and trace parser
└── shared/            # Shared directory, automatically synced to JupyterHub
    ├── act/           # HLO scripts for the ACT tutorial
    └── allo/          # Allo tutorial Jupyter notebooks
```

## Getting Started

See the [tutorial website](https://maeri-project.github.io/feather_tutorial/FEATHER.html) for step-by-step instructions.

For the ACT compiler backend, refer to [`act-feather/README.md`](act-feather/README.md).
