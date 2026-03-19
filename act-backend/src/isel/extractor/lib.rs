use std::collections::HashSet;
use std::time::Instant;

use egg::{EGraph, Id};

use crate::ir::egraph::{TensorInfo, TensorOp};
use crate::ir::pii::PiiGraph;

use crate::isel::extractor::slow::extract_slow;

use crate::SLOW_LIMIT_CUTOFF;

pub fn extract(
    egraph: &mut EGraph<TensorOp, TensorInfo>,
    root: Id,
    inputs: &HashSet<Id>,
    hbm_offsets: &Vec<(Option<Id>, i32)>,
    limit: usize,
) -> Vec<PiiGraph> {
    let nodes = egraph.total_number_of_nodes();

    let effective_limit = std::cmp::min(limit, SLOW_LIMIT_CUTOFF);
    let start = Instant::now();
    let piis_slow = extract_slow(egraph, root, &inputs, &hbm_offsets, effective_limit);

    println!("Slow Extractor Algorithm over #nodes={}", nodes);
    println!(
        "Limit used: {} (requested {}, cutoff {})",
        effective_limit, limit, SLOW_LIMIT_CUTOFF
    );
    println!("Number of PII graphs extracted: {}", piis_slow.len());
    println!("Extraction time: {:?}", start.elapsed());

    println!();

    piis_slow
}
