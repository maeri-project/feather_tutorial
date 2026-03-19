use egg::{EGraph, Id};

use crate::ir::dtype::Dtype;
use crate::ir::egraph::{TensorInfo, TensorOp};
use crate::minisa::spec;

fn fp32_matrix_shape(info: &TensorInfo) -> Option<(i32, i32)> {
    if info.dtype == Dtype::FP32 && info.shape.len() == 2 {
        Some((info.shape[0], info.shape[1]))
    } else {
        None
    }
}

fn matches_u8_bytes(info: &TensorInfo, bytes: i32) -> bool {
    info.dtype == Dtype::U8 && info.shape == vec![bytes] && !info.is_const
}

fn matches_u8_reshape(info: &TensorInfo, rows: i32, cols: i32) -> bool {
    info.dtype == Dtype::U8 && info.shape == vec![rows, cols, 4] && !info.is_const
}

pub fn precond_load_ivn(egraph: &EGraph<TensorOp, TensorInfo>, lhs_eclasses: &Vec<Id>) -> bool {
    assert_eq!(lhs_eclasses.len(), 3);
    let lhs_metadata: Vec<TensorInfo> = lhs_eclasses
        .iter()
        .map(|id| egraph[*id].data.clone())
        .collect();

    let Some((m, n)) = fp32_matrix_shape(&lhs_metadata[2]) else {
        return false;
    };
    let bytes = m * n * 4;

    matches_u8_bytes(&lhs_metadata[0], bytes)
        && matches_u8_reshape(&lhs_metadata[1], m, n)
        && !lhs_metadata[2].is_const
}

pub fn metadata_load_ivn(
    egraph: &EGraph<TensorOp, TensorInfo>,
    lhs_eclasses: &Vec<Id>,
    _lhs_enodes: &Vec<Option<TensorOp>>,
) -> Vec<Option<String>> {
    assert_eq!(lhs_eclasses.len(), 3);
    let out = egraph[*lhs_eclasses.last().unwrap()].data.clone();
    let m = out.shape[0];
    let j = out.shape[1];
    let metadata = format!(
        "order=5, M_L1:{}, M_L0:1, J_L1:{}",
        m,
        j / spec::VN_SIZE
    );
    vec![None, Some(metadata)]
}

pub fn set_shapes_load_ivn(
    egraph: &mut EGraph<TensorOp, TensorInfo>,
    lhs_eclasses: &Vec<Id>,
    rhs_eclasses: &Vec<Id>,
) {
    assert_eq!(lhs_eclasses.len(), 3);
    assert_eq!(rhs_eclasses.len(), 2);
    let out = egraph[*lhs_eclasses.last().unwrap()].data.clone();

    egraph.set_analysis_data(*rhs_eclasses.last().unwrap(), out);
}

pub fn precond_load_wvn(egraph: &EGraph<TensorOp, TensorInfo>, lhs_eclasses: &Vec<Id>) -> bool {
    assert_eq!(lhs_eclasses.len(), 4);
    let lhs_metadata: Vec<TensorInfo> = lhs_eclasses
        .iter()
        .map(|id| egraph[*id].data.clone())
        .collect();

    let Some((m, n)) = fp32_matrix_shape(&lhs_metadata[2]) else {
        return false;
    };
    let Some((mt, nt)) = fp32_matrix_shape(&lhs_metadata[3]) else {
        return false;
    };
    let bytes = m * n * 4;

    matches_u8_bytes(&lhs_metadata[0], bytes)
        && matches_u8_reshape(&lhs_metadata[1], m, n)
        && mt == n
        && nt == m
        && !lhs_metadata[2].is_const
        && !lhs_metadata[3].is_const
}

pub fn metadata_load_wvn(
    egraph: &EGraph<TensorOp, TensorInfo>,
    lhs_eclasses: &Vec<Id>,
    _lhs_enodes: &Vec<Option<TensorOp>>,
) -> Vec<Option<String>> {
    assert_eq!(lhs_eclasses.len(), 4);
    let out = egraph[*lhs_eclasses.last().unwrap()].data.clone();
    let k = out.shape[0];
    let n = out.shape[1];
    let metadata = format!(
        "order=5, N_L1:{}, N_L0:1, K_L1:{}",
        n,
        k / spec::VN_SIZE
    );
    vec![None, Some(metadata)]
}

pub fn set_shapes_load_wvn(
    egraph: &mut EGraph<TensorOp, TensorInfo>,
    lhs_eclasses: &Vec<Id>,
    rhs_eclasses: &Vec<Id>,
) {
    assert_eq!(lhs_eclasses.len(), 4);
    assert_eq!(rhs_eclasses.len(), 2);
    let out = egraph[*lhs_eclasses.last().unwrap()].data.clone();

    egraph.set_analysis_data(*rhs_eclasses.last().unwrap(), out);
}

pub fn precond_store_ovn(egraph: &EGraph<TensorOp, TensorInfo>, lhs_eclasses: &Vec<Id>) -> bool {
    assert_eq!(lhs_eclasses.len(), 3);
    let lhs_metadata: Vec<TensorInfo> = lhs_eclasses
        .iter()
        .map(|id| egraph[*id].data.clone())
        .collect();

    let Some((m, n)) = fp32_matrix_shape(&lhs_metadata[0]) else {
        return false;
    };
    let bytes = m * n * 4;

    matches_u8_reshape(&lhs_metadata[1], m, n)
        && matches_u8_bytes(&lhs_metadata[2], bytes)
        && !lhs_metadata[0].is_const
}

pub fn metadata_store_ovn(
    egraph: &EGraph<TensorOp, TensorInfo>,
    lhs_eclasses: &Vec<Id>,
    _lhs_enodes: &Vec<Option<TensorOp>>,
) -> Vec<Option<String>> {
    assert_eq!(lhs_eclasses.len(), 3);
    let in_tensor = egraph[lhs_eclasses[0]].data.clone();
    let p = in_tensor.shape[0];
    let q = in_tensor.shape[1];
    let metadata = format!(
        "order=0, P_L1:{}, P_L0:1, Q_L1:{}",
        p,
        q / spec::VN_SIZE
    );
    vec![None, Some(metadata)]
}

pub fn set_shapes_store_ovn(
    egraph: &mut EGraph<TensorOp, TensorInfo>,
    lhs_eclasses: &Vec<Id>,
    rhs_eclasses: &Vec<Id>,
) {
    assert_eq!(lhs_eclasses.len(), 3);
    assert_eq!(rhs_eclasses.len(), 2);
    let out = egraph[*lhs_eclasses.last().unwrap()].data.clone();

    egraph.set_analysis_data(*rhs_eclasses.last().unwrap(), out);
}

pub fn precond_execute(egraph: &EGraph<TensorOp, TensorInfo>, lhs_eclasses: &Vec<Id>) -> bool {
    assert_eq!(lhs_eclasses.len(), 3);
    let lhs_metadata: Vec<TensorInfo> = lhs_eclasses
        .iter()
        .map(|id| egraph[*id].data.clone())
        .collect();

    let Some((m, k)) = fp32_matrix_shape(&lhs_metadata[0]) else {
        return false;
    };
    let Some((k2, n)) = fp32_matrix_shape(&lhs_metadata[1]) else {
        return false;
    };
    let Some((m2, n2)) = fp32_matrix_shape(&lhs_metadata[2]) else {
        return false;
    };

    k == k2 && m == m2 && n == n2
}

pub fn metadata_execute(
    _egraph: &EGraph<TensorOp, TensorInfo>,
    _lhs_eclasses: &Vec<Id>,
    _lhs_enodes: &Vec<Option<TensorOp>>,
) -> Vec<Option<String>> {
    vec![None; 3]
}

pub fn set_shapes_execute(
    egraph: &mut EGraph<TensorOp, TensorInfo>,
    lhs_eclasses: &Vec<Id>,
    rhs_eclasses: &Vec<Id>,
) {
    assert_eq!(lhs_eclasses.len(), 3);
    assert_eq!(rhs_eclasses.len(), 3);
    let out = egraph[*lhs_eclasses.last().unwrap()].data.clone();

    egraph.set_analysis_data(*rhs_eclasses.last().unwrap(), out);
}

pub fn precond_softmax(egraph: &EGraph<TensorOp, TensorInfo>, lhs_eclasses: &Vec<Id>) -> bool {
    assert_eq!(lhs_eclasses.len(), 7);
    let lhs_metadata: Vec<TensorInfo> = lhs_eclasses
        .iter()
        .map(|id| egraph[*id].data.clone())
        .collect();

    let Some((rows, cols)) = fp32_matrix_shape(&lhs_metadata[6]) else {
        return false;
    };

    for idx in [0_usize, 1, 2, 3, 5] {
        let Some((r, c)) = fp32_matrix_shape(&lhs_metadata[idx]) else {
            return false;
        };
        if r != rows || c != cols {
            return false;
        }
    }

    lhs_metadata[4].dtype == Dtype::FP32
        && lhs_metadata[4].shape == vec![rows]
        && !lhs_metadata[4].is_const
}

pub fn metadata_softmax(
    _egraph: &EGraph<TensorOp, TensorInfo>,
    _lhs_eclasses: &Vec<Id>,
    _lhs_enodes: &Vec<Option<TensorOp>>,
) -> Vec<Option<String>> {
    vec![None; 2]
}

pub fn set_shapes_softmax(
    egraph: &mut EGraph<TensorOp, TensorInfo>,
    lhs_eclasses: &Vec<Id>,
    rhs_eclasses: &Vec<Id>,
) {
    assert_eq!(lhs_eclasses.len(), 7);
    assert_eq!(rhs_eclasses.len(), 2);
    let out = egraph[*lhs_eclasses.last().unwrap()].data.clone();

    egraph.set_analysis_data(*rhs_eclasses.last().unwrap(), out);
}
