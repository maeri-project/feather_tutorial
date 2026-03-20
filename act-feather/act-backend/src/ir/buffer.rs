use crate::ir::egraph::TensorOp;

#[derive(Debug, PartialEq, Clone, Copy)]
pub enum Buffer {
    HBM,
    D1,
    D2,
    ANY,
}

impl std::fmt::Display for Buffer {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Buffer::HBM => write!(f, "HBM"),
            Buffer::D1 => write!(f, "D1"),
            Buffer::D2 => write!(f, "D2"),
            Buffer::ANY => panic!("Buffer::ANY does not have a string representation"),
        }
    }
}

// Return buffer assignment for an instruction enode.
// Returns Some(vec![out_buf, in_buf1, in_buf2, ...]) or None if not applicable.
pub fn buffer_assignment(en: &TensorOp) -> Option<Vec<Buffer>> {
    match en {
        TensorOp::LoadIVN(_, _) => Some(vec![Buffer::D1, Buffer::HBM]),
        TensorOp::LoadWVN(_, _) => Some(vec![Buffer::D2, Buffer::HBM]),
        TensorOp::StoreOVN(_, _) => Some(vec![Buffer::HBM, Buffer::D1]),
        TensorOp::Execute(_) => Some(vec![Buffer::D1, Buffer::D1, Buffer::D2]),
        TensorOp::SoftMax(_) => Some(vec![Buffer::D1, Buffer::D1]),
        TensorOp::OpSlice(_, _) => Some(vec![Buffer::ANY, Buffer::ANY]),
        TensorOp::OpConcat(_, _) => Some(vec![Buffer::ANY, Buffer::ANY, Buffer::ANY]),
        TensorOp::DetectedConst(_) => Some(vec![Buffer::HBM]),
        TensorOp::Var(_) => Some(vec![Buffer::HBM]),
        _ => None,
    }
}
