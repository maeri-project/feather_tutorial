# FEATHER Baseline Regression Report

**Date:** 2026-01-22
**Status:** PASSED

## Overview

This report documents the baseline verification of the FEATHER Allo implementation
before extending it to support MINISA.

## Test Configuration

- **Allo Version:** Current development branch
- **Test File:** `examples/feather-isa/tests/test_feather_baseline.py`
- **Reference:** `examples/feather/feather.py`

## FEATHER Architecture Summary

FEATHER is a reconfigurable accelerator with three main components:

1. **NEST (Neural Engine with Spatial forwarding and Temporal reduction)**
   - AH x AW PE array
   - Each PE performs AH-way dot products
   - Temporal local reduction within each PE

2. **BIRRD (Butterfly Interconnect for Reduction and Reordering)**
   - Multi-stage butterfly reduction network
   - Supports RIR (Reorder In Reduction)
   - Four switch operations: PS (Pass), AR (Add-Right), AL (Add-Left), SW (Swap)

3. **Output Buffer**
   - Collects reduced results from BIRRD

## Test Results

### Test 1: FEATHER AW=4 Baseline
- **Configuration:** AW=4, AH=4, int8 data type
- **BIRRD Stages:** P0=3, P1=2
- **Status:** PASSED
- **Notes:** Basic configuration with minimal array size

### Test 2: FEATHER AW=8 Baseline
- **Configuration:** AW=8, AH=8, int8 data type
- **BIRRD Stages:** P0=6, P1=4
- **Status:** PASSED
- **Notes:** Default configuration matching paper examples

### Test 3: FEATHER Tiled GEMM
- **Configuration:** AW=8, AH=8, M=8, N=8, K=16
- **Tile Sizes:** Mt=4, Kt=16, Nt=8
- **Status:** PASSED
- **Notes:** Verified tile reordering functions from gemm.py

## Allo Dataflow Verification

The baseline tests confirm:

1. **Dataflow Region:** `@df.region()` correctly instantiates the FEATHER top-level
2. **Kernel Mapping:**
   - `NEST` kernel with `mapping=[1]` executes serial PE array computation
   - `BIRRD` kernel with `mapping=[P0, P1]` creates P0*P1 parallel switch instances
3. **Stream Communication:**
   - `nest_out: Stream[TyPacked, AH]` connects NEST to bus
   - `connection: Stream[Ty, 1][P0+1, P1*2]` carries inter-stage BIRRD data
   - `inst_input: Stream[int8, 1][P0, P1]` distributes switch instructions
4. **Build Target:** `df.build(top, target="simulator")` produces working simulator

## Conclusion

The FEATHER Allo implementation is functional and ready for MINISA extension.
The dataflow graph builds correctly, kernels execute, and streams communicate
properly between pipeline stages.

## Test Execution Log

```
======================================================================
FEATHER BASELINE REGRESSION TESTS
======================================================================
FEATHER AW=4 baseline test:
  Input activations shape: (4, 4)
  Weights shape: (4, 4, 4)
  Output buffer shape: (4, 4)
  PASSED: FEATHER AW=4 baseline runs successfully

FEATHER AW=8 baseline test:
  Input activations shape: (8, 8)
  Weights shape: (8, 8, 8)
  Output buffer shape: (8, 8)
  PASSED: FEATHER AW=8 baseline runs successfully

FEATHER tiled GEMM test:
  Matrix A shape: (8, 16)
  Matrix B shape: (16, 8)
  Tile shapes: Mt=4, Kt=16, Nt=8
  PASSED: FEATHER tiled GEMM executes successfully

======================================================================
BASELINE TEST SUMMARY
======================================================================
  AW=4 baseline: PASS
  AW=8 baseline: PASS
  Tiled GEMM: PASS

All baseline tests PASSED
```
