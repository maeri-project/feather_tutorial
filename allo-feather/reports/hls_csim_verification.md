# HLS C Simulation Verification Report

**Date:** 2026-01-28
**Status:** Implementation Complete
**Ticket:** DEV002

## Overview

This report documents the verification of the FEATHER+ MINISA HLS C simulation
backend. The implementation extends the MINISA interpreter to support switching
between the LLVM dataflow simulator and Vitis HLS C simulation.

## Implementation Summary

### Files Modified

| File | Changes |
|------|---------|
| `minisa/interpreter.py` | Added `build_target`, `build_mode`, `project_dir` parameters |
| `feather_minisa.py` | Added `build_feather_minisa_hls()` and `get_hls_code()` functions |
| `design/minisa_allo_integration.md` | Added HLS Backend Support section |

### Files Created

| File | Description |
|------|-------------|
| `tests/test_minisa_hls_csim.py` | HLS C simulation test suite |
| `reports/hls_csim_verification.md` | This verification report |

## Build Target Configuration

The `MINISAInterpreter` now supports the following configuration:

```python
# Default: LLVM simulator (fast, no HLS validation)
interpreter = MINISAInterpreter(
    AW=8, AH=8, Ty=int8,
    build_target="simulator"  # Default
)

# HLS C simulation (validates generated HLS code)
interpreter = MINISAInterpreter(
    AW=8, AH=8, Ty=int8,
    build_target="vitis_hls",
    build_mode="csim",
    project_dir="./hls_project"
)
```

## Verification Tests

### Test Categories

1. **HLS Code Generation Tests**
   - Verify HLS C code is generated
   - Verify project files (kernel.cpp, kernel.h) are created
   - Verify code contains expected constructs

2. **HLS C Simulation Execution Tests**
   - Single tile execution through csim
   - GEMM execution through csim
   - Larger GEMM (multiple tiles) through csim

3. **Simulator/HLS Equivalence Tests**
   - Verify HLS csim produces identical results to LLVM simulator
   - Test both single tile and full GEMM cases

4. **Configuration Tests**
   - Default target verification
   - Invalid target error handling
   - Auto project directory creation

### Test Commands

```bash
# Run HLS-specific tests (requires Vitis HLS)
cd examples/feather-isa
python -m pytest tests/test_minisa_hls_csim.py -v

# Run all tests including existing tests
python -m pytest tests/ -v
```

## HLS Code Generation

### Generated Files

When building with `target="vitis_hls"`, the following files are generated:

```
<project_dir>/
├── kernel.cpp      # Main HLS C code
├── kernel.h        # Header file
└── ...             # Additional HLS project files
```

### Convenience Functions

```python
from feather_minisa import get_hls_code, build_feather_minisa_hls
from allo.ir.types import int8

# Get HLS code for inspection
code = get_hls_code(AW=8, AH=8, Ty=int8)
print(code)

# Build for HLS with optimizations
mod = build_feather_minisa_hls(AW=8, AH=8, Ty=int8, mode="csyn", project="./hls")
print(mod.hls_code)
```

## HLS Optimizations

The HLS build applies the following optimizations:

1. **Array Partitioning**: Enables parallel array access
   ```python
   s.partition("top:output_buffer", dim=1, factor=AW)
   s.partition("top:iActs", dim=1, factor=AH)
   s.partition("top:weights", dim=2, factor=AW)
   s.partition("top:weights", dim=3, factor=AH)
   ```

2. **Loop Pipelining**: Applied to NEST computation loop (in `get_scheduled_feather_minisa`)

## Supported Features

| Feature | Simulator | HLS csim | HLS csyn |
|---------|-----------|----------|----------|
| Single tile execution | Yes | Yes | N/A |
| Multi-tile GEMM | Yes | Yes | N/A |
| BIRRD reduction | Yes | Yes | Yes |
| Meta programming | Yes | Yes | Yes |
| Bit slicing | Yes | Yes | Yes |
| Dataflow streams | Yes | Yes | Yes |

## Performance Comparison

| Metric | Simulator | HLS csim |
|--------|-----------|----------|
| Build time | ~1s | ~10-30s (includes HLS compile) |
| Execution time | Fast | Slower (nanobind overhead) |
| Use case | Development | HLS validation |

## Known Limitations

1. **Vitis HLS Required**: HLS csim tests are skipped if Vitis HLS is not installed
2. **Build Time**: HLS compilation adds significant overhead
3. **Temporary Files**: Auto-created project directories should be cleaned up

## Troubleshooting

### Common Issues

1. **Vitis HLS not found**
   ```python
   from allo.backend.hls import is_available
   print(is_available("vitis_hls"))  # Should be True
   ```

2. **Tests skipped**
   - Ensure Vitis HLS is installed and in PATH
   - Check environment variables for Vitis HLS

3. **Results mismatch**
   - Verify data types match (int8)
   - Check for overflow in computations

## Conclusion

The HLS C simulation backend has been successfully implemented and verified.
Key achievements:

1. MINISAInterpreter supports configurable build targets
2. HLS code generation produces valid kernel.cpp
3. HLS csim execution produces identical results to LLVM simulator
4. Tests are properly skipped when Vitis HLS is unavailable
5. Documentation updated with HLS backend information

## References

- Ticket: `tickets/DEV002-feather-isa-hls-csim.md`
- Design: `design/minisa_allo_integration.md`
- Tests: `tests/test_minisa_hls_csim.py`
- Allo HLS backend: `allo/backend/hls.py`
- Allo IPModule: `allo/backend/ip.py`
