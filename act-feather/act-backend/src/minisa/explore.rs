use std::fs::{self, File};
use std::io;
use std::path::{Path, PathBuf};

use std::collections::HashMap;

use serde_json::json;

use crate::ir::egraph::TensorOp;
use crate::ir::pii::PiiGraph;
use crate::minisa::dsu::Dsu;
use crate::minisa::emit;
use crate::minisa::mapper;
use crate::minisa::report;
use crate::minisa::spec;
use crate::minisa::util::{
    build_consumers, divisors, enum_variants, ivn_json, layout_from_ivn_meta,
    layout_from_ovn_meta, layout_from_wvn_meta, ovn_json, wvn_json, Dims, LayoutTuple,
};

#[derive(Debug, Clone, Copy)]
enum LayoutValue {
    Fixed(LayoutTuple),
    Flex(usize),
}

#[derive(Debug, Clone, Copy)]
enum LayerPlanKind {
    Execute { wvn: LayoutTuple },
    SoftMax,
}

#[derive(Debug, Clone)]
struct LayerPlan {
    node_idx: usize,
    layer_name: String,
    kind: LayerPlanKind,
    ivn: LayoutValue,
    ovn: LayoutValue,
}


pub struct ExploreOutput {
    pub generated_jsons: Vec<PathBuf>,
    pub mapped_jsons: Vec<PathBuf>,
    pub assembly_txts: Vec<PathBuf>,
    pub assembly_txt: PathBuf,
    pub variant_csv: PathBuf,
    pub best_variant_idx: usize,
    pub min_total_latency: u64,
    pub max_total_latency: u64,
}

pub fn explore_from_graph(
    graph: &PiiGraph,
    output_dir: &Path,
    json_name: &str,
) -> io::Result<ExploreOutput> {
    fs::create_dir_all(output_dir)?;

    let layout_variants_dir = output_dir.join("layout_variants");
    let layout_mapper_variants_dir = output_dir.join("layout_mapper_variants");
    let minisa_traces_dir = output_dir.join("minisa_traces");
    fs::create_dir_all(&layout_variants_dir)?;
    fs::create_dir_all(&layout_mapper_variants_dir)?;
    fs::create_dir_all(&minisa_traces_dir)?;

    let consumers = build_consumers(graph);

    let mut plan_nodes: Vec<usize> = graph
        .nodes
        .iter()
        .enumerate()
        .filter_map(|(idx, n)| {
            matches!(n.op, TensorOp::Execute(_) | TensorOp::SoftMax(_)).then_some(idx)
        })
        .collect();
    plan_nodes.sort_unstable();

    let mut node_to_plan: HashMap<usize, usize> = HashMap::new();
    for (i, node_idx) in plan_nodes.iter().enumerate() {
        node_to_plan.insert(*node_idx, i);
    }

    let mut plans: Vec<LayerPlan> = vec![];

    let mut var_dims: Vec<Dims> = vec![];
    let mut ivn_var: Vec<Option<usize>> = vec![None; plan_nodes.len()];
    let mut ovn_var: Vec<Option<usize>> = vec![None; plan_nodes.len()];

    for (plan_idx, node_idx) in plan_nodes.iter().enumerate() {
        let node = &graph.nodes[*node_idx];
        let layer_name = format!("L{}", plan_idx + 1);

        let in0 = *node
            .children
            .first()
            .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidData, "Plan node missing child0"))?;
        let in0_node = &graph.nodes[in0];

        let ivn_dims = Dims {
            dim0: in0_node.info.shape[0],
            dim1: in0_node.info.shape[1],
        };
        let out_dims = Dims {
            dim0: node.info.shape[0],
            dim1: node.info.shape[1],
        };

        let ivn = match &in0_node.op {
            TensorOp::LoadIVN(meta, _) if !meta.trim().is_empty() => {
                let fixed = layout_from_ivn_meta(meta, ivn_dims).ok_or_else(|| {
                    io::Error::new(io::ErrorKind::InvalidData, "invalid LoadIVN metadata")
                })?;
                LayoutValue::Fixed(fixed)
            }
            _ => {
                let id = var_dims.len();
                var_dims.push(ivn_dims);
                ivn_var[plan_idx] = Some(id);
                LayoutValue::Flex(id)
            }
        };

        let (kind, ovn) = match &node.op {
            TensorOp::Execute(_) => {
                let in1 = *node.children.get(1).ok_or_else(|| {
                    io::Error::new(io::ErrorKind::InvalidData, "Execute missing child1")
                })?;
                let in1_node = &graph.nodes[in1];
                let wvn_dims = Dims {
                    dim0: in1_node.info.shape[0],
                    dim1: in1_node.info.shape[1],
                };

                let wvn = match &in1_node.op {
                    // Execute child1 must be the WVN source node. SetWVN is emitted later from this layout.
                    TensorOp::LoadWVN(meta, _) if !meta.trim().is_empty() => {
                        layout_from_wvn_meta(meta, wvn_dims).ok_or_else(|| {
                            io::Error::new(io::ErrorKind::InvalidData, "invalid LoadWVN metadata")
                        })?
                    }
                    TensorOp::LoadWVN(_, _) => {
                        return Err(io::Error::new(
                            io::ErrorKind::InvalidData,
                            "Execute child1 is LoadWVN but metadata is empty; SetWVN layout cannot be inferred",
                        ));
                    }
                    _ => {
                        return Err(io::Error::new(
                            io::ErrorKind::InvalidData,
                            "Execute child1 must be LoadWVN (source for SetWVN)",
                        ));
                    }
                };

                let mut ovn_fixed: Option<LayoutTuple> = None;
                if let Some(users) = consumers.get(node_idx) {
                    for &u in users {
                        if let TensorOp::StoreOVN(meta, _) = &graph.nodes[u].op {
                            if !meta.trim().is_empty() {
                                ovn_fixed = layout_from_ovn_meta(meta, out_dims);
                                if ovn_fixed.is_some() {
                                    break;
                                }
                            }
                        }
                    }
                }

                let ovn = if let Some(fixed) = ovn_fixed {
                    LayoutValue::Fixed(fixed)
                } else {
                    let id = var_dims.len();
                    var_dims.push(out_dims);
                    ovn_var[plan_idx] = Some(id);
                    LayoutValue::Flex(id)
                };
                (LayerPlanKind::Execute { wvn }, ovn)
            }
            TensorOp::SoftMax(_) => {
                if ivn_dims.dim0 != out_dims.dim0 || ivn_dims.dim1 != out_dims.dim1 {
                    return Err(io::Error::new(
                        io::ErrorKind::InvalidData,
                        "SoftMax layout propagation requires input/output shapes to match",
                    ));
                }
                ovn_var[plan_idx] = ivn_var[plan_idx];
                (LayerPlanKind::SoftMax, ivn)
            }
            _ => {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidData,
                    "plan node must be Execute or SoftMax",
                ));
            }
        };

        plans.push(LayerPlan {
            node_idx: *node_idx,
            layer_name,
            kind,
            ivn,
            ovn,
        });
    }

    // Build dependencies for forward/backward propagation across plan nodes.
    let mut dsu = Dsu::new(var_dims.len());
    let mut fixed_by_root: HashMap<usize, LayoutTuple> = HashMap::new();

    for (layer_idx, plan) in plans.iter().enumerate() {
        let node = &graph.nodes[plan.node_idx];
        let in0 = *node
            .children
            .first()
            .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidData, "Plan node missing child0"))?;
        let src = &graph.nodes[in0];

        let producer_plan_idx = match src.op {
            TensorOp::Execute(_) | TensorOp::SoftMax(_) => node_to_plan.get(&in0).copied(),
            _ => None,
        };

        if let Some(prod_layer) = producer_plan_idx {
            let lhs = ovn_var[prod_layer];
            let rhs = ivn_var[layer_idx];

            match (lhs, rhs) {
                (Some(a), Some(b)) => {
                    if var_dims[a].dim0 != var_dims[b].dim0 || var_dims[a].dim1 != var_dims[b].dim1 {
                        return Err(io::Error::new(
                            io::ErrorKind::InvalidData,
                            "layout dependency conflict: incompatible dims between OVN and IVN",
                        ));
                    }
                    dsu.union(a, b);
                }
                (Some(a), None) => {
                    if let LayoutValue::Fixed(fixed) = plans[layer_idx].ivn {
                        let r = dsu.find(a);
                        if let Some(prev) = fixed_by_root.get(&r) {
                            if *prev != fixed {
                                return Err(io::Error::new(
                                    io::ErrorKind::InvalidData,
                                    "layout conflict while propagating fixed IVN",
                                ));
                            }
                        } else {
                            fixed_by_root.insert(r, fixed);
                        }
                    }
                }
                (None, Some(b)) => {
                    if let LayoutValue::Fixed(fixed) = plans[prod_layer].ovn {
                        let r = dsu.find(b);
                        if let Some(prev) = fixed_by_root.get(&r) {
                            if *prev != fixed {
                                return Err(io::Error::new(
                                    io::ErrorKind::InvalidData,
                                    "layout conflict while propagating fixed OVN",
                                ));
                            }
                        } else {
                            fixed_by_root.insert(r, fixed);
                        }
                    }
                }
                (None, None) => {
                    if let (LayoutValue::Fixed(a), LayoutValue::Fixed(b)) =
                        (plans[prod_layer].ovn, plans[layer_idx].ivn)
                    {
                        if a != b {
                            return Err(io::Error::new(
                                io::ErrorKind::InvalidData,
                                "fixed layout conflict between producer OVN and consumer IVN",
                            ));
                        }
                    }
                }
            }
        }
    }

    // Collapse variables into DSU components; each component shares one layout assignment.
    let mut comp_dims: HashMap<usize, Dims> = HashMap::new();
    for i in 0..var_dims.len() {
        let r = dsu.find(i);
        if let Some(d) = comp_dims.get(&r) {
            if d.dim0 != var_dims[i].dim0 || d.dim1 != var_dims[i].dim1 {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidData,
                    "layout dependency conflict: flex component has mixed dims",
                ));
            }
        } else {
            comp_dims.insert(r, var_dims[i]);
        }
    }

    let mut free_components: Vec<usize> = comp_dims
        .keys()
        .copied()
        .filter(|r| !fixed_by_root.contains_key(r))
        .collect();
    free_components.sort_unstable();

    let mut comp_to_flex_idx: HashMap<usize, usize> = HashMap::new();
    for (i, root) in free_components.iter().enumerate() {
        comp_to_flex_idx.insert(*root, i);
    }

    // Build each component's candidate domain.
    let mut comp_domains: Vec<Vec<LayoutTuple>> = vec![];
    for root in &free_components {
        let dims = comp_dims[root];
        let mut domain = vec![];
        let d1 = dims.dim1 / spec::VN_SIZE;
        for order in [0, 5] {
            for d0_l1 in divisors(dims.dim0) {
                let d0_l0 = dims.dim0 / d0_l1;
                domain.push(LayoutTuple {
                    order,
                    dim0_l1: d0_l1,
                    dim0_l0: d0_l0,
                    dim1_l1: d1,
                });
            }
        }
        comp_domains.push(domain);
    }

    // Enumerate cartesian product across component domains.
    let variants = enum_variants(&comp_domains);

    let mut generated_jsons = vec![];
    let mut mapped_jsons = vec![];
    let mut assembly_txts = vec![];
    let mut total_latencies = vec![];

    let stem = json_name.trim_end_matches(".json");
    let variant_csv = output_dir.join("variant_stats.csv");
    report::init_variant_stats_csv(&variant_csv)?;

    // Materialize each assignment into JSON, run mapper, then emit text immediately.
    for (vidx, assignment) in variants.iter().enumerate() {
        let mut layers = vec![];

        for plan in &plans {
            let mut resolve = |lv: LayoutValue| -> LayoutTuple {
                match lv {
                    LayoutValue::Fixed(v) => v,
                    LayoutValue::Flex(var_id) => {
                        let root = dsu.find(var_id);
                        if let Some(fixed) = fixed_by_root.get(&root) {
                            *fixed
                        } else {
                            let fidx = comp_to_flex_idx[&root];
                            assignment[fidx]
                        }
                    }
                }
            };

            let ivn_layout = resolve(plan.ivn);
            let ovn_layout = resolve(plan.ovn);

            let entries = match plan.kind {
                LayerPlanKind::Execute { wvn } => vec![
                    json!({"WVN": wvn_json(wvn)}),
                    json!({"IVN": ivn_json(ivn_layout)}),
                    json!({"OVN": ovn_json(ovn_layout)}),
                    json!({"ExecuteMapping": []}),
                    json!({"latency": "TBD"}),
                ],
                // SoftMax is used to propagate constraints, but is not emitted as a JSON layer.
                LayerPlanKind::SoftMax => continue,
            };

            layers.push(json!({
                plan.layer_name.clone(): entries
            }));
        }

        let payload = json!({
            "FEATHER_spec": spec::feather_spec(),
            "layer": layers
        });

        let generated_json = if variants.len() == 1 {
            layout_variants_dir.join(format!("{}.json", stem))
        } else {
            layout_variants_dir.join(format!("{}_v{}.json", stem, vidx))
        };
        fs::write(&generated_json, serde_json::to_string_pretty(&payload)?)?;

        let mapped_json = if variants.len() == 1 {
            layout_mapper_variants_dir.join(format!("mapped_{}.json", stem))
        } else {
            layout_mapper_variants_dir.join(format!("mapped_{}_v{}.json", stem, vidx))
        };
        let mapper_out = mapper::run_mapper(&generated_json, &mapped_json)?;
        report::append_variant_stats_csv(&variant_csv, vidx, &mapper_out.layers)?;

        let out_txt = minisa_traces_dir.join(format!("final_assembly_v{}.txt", vidx));
        let total = emit::emit_variant_text(graph, &mapped_json, &out_txt)?;
        assembly_txts.push(out_txt);
        total_latencies.push(total);

        generated_jsons.push(generated_json);
        mapped_jsons.push(mapped_json);
    }

    let mut best_variant_idx = 0usize;
    let mut min_total_latency = u64::MAX;
    let mut max_total_latency = 0u64;
    for (idx, total) in total_latencies.iter().enumerate() {
        if *total < min_total_latency {
            min_total_latency = *total;
            best_variant_idx = idx;
        }
        if *total > max_total_latency {
            max_total_latency = *total;
        }
    }

    // Tie-break on earliest variant by only updating best when strictly smaller.
    let assembly_txt = minisa_traces_dir.join("final_assembly.txt");
    if let Some(best_txt) = assembly_txts.get(best_variant_idx) {
        fs::copy(best_txt, &assembly_txt)?;
    } else {
        File::create(&assembly_txt)?;
        min_total_latency = 0;
    }

    Ok(ExploreOutput {
        generated_jsons,
        mapped_jsons,
        assembly_txts,
        assembly_txt,
        variant_csv,
        best_variant_idx,
        min_total_latency,
        max_total_latency,
    })
}
