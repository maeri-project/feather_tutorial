use std::collections::HashMap;
use std::fs;
use std::io::{self, Write};
use std::path::Path;

use serde_json::Value;

use crate::ir::egraph::TensorOp;
use crate::ir::pii::PiiGraph;
use crate::minisa::util::parse_metadata_map;

fn format_fields(v: &Value, preferred: &[&str]) -> String {
    let Some(obj) = v.as_object() else {
        return String::new();
    };

    let mut out = vec![];
    for k in preferred {
        if let Some(val) = obj.get(*k) {
            out.push(format!("{} = {}", k, val));
        }
    }
    for (k, val) in obj {
        if preferred.iter().any(|pk| pk == &k.as_str()) {
            continue;
        }
        out.push(format!("{} = {}", k, val));
    }
    out.join(", ")
}

fn addr_for_load_input(graph: &PiiGraph, load_node_idx: usize) -> i32 {
    let node = &graph.nodes[load_node_idx];
    let child_idx = match node.children.first() {
        Some(v) => *v,
        None => return node.hbm_offset.unwrap_or(-1),
    };
    graph.nodes[child_idx].hbm_offset.unwrap_or(-1)
}

#[derive(Clone)]
struct ExecuteLayerInfo {
    ovn: Value,
    execute_mapping: Value,
    latency: u64,
}

fn parse_execute_layers(mapped: &Value) -> io::Result<Vec<ExecuteLayerInfo>> {
    let mut out = vec![];
    let layers = mapped
        .get("layer")
        .and_then(Value::as_array)
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidData, "mapped json missing 'layer'"))?;

    for layer in layers {
        let obj = layer.as_object().ok_or_else(|| {
            io::Error::new(io::ErrorKind::InvalidData, "layer entry is not an object")
        })?;
        if obj.is_empty() {
            continue;
        }
        let (_name, entries) = obj
            .iter()
            .next()
            .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidData, "empty layer object"))?;
        let entries = entries.as_array().ok_or_else(|| {
            io::Error::new(io::ErrorKind::InvalidData, "layer entries is not an array")
        })?;

        let mut ovn = Value::Null;
        let mut execute_mapping = Value::Null;
        let mut latency = 0u64;

        for e in entries {
            if let Some(v) = e.get("OVN") {
                ovn = v.clone();
            } else if let Some(v) = e.get("ExecuteMapping") {
                execute_mapping = v.clone();
            } else if let Some(v) = e.get("latency") {
                latency = v.as_u64().unwrap_or(0);
            }
        }

        out.push(ExecuteLayerInfo {
            ovn,
            execute_mapping,
            latency,
        });
    }
    Ok(out)
}

fn setivn_from_load_metadata(meta: &str) -> String {
    let m = parse_metadata_map(meta);
    format!(
        "order = {}, M_L1 = {}, M_L0 = {}, J_L1 = {}",
        m.get("order").copied().unwrap_or(0),
        m.get("M_L1").copied().unwrap_or(1),
        m.get("M_L0").copied().unwrap_or(1),
        m.get("J_L1").copied().unwrap_or(1)
    )
}

fn setwvn_from_load_metadata(meta: &str) -> String {
    let m = parse_metadata_map(meta);
    format!(
        "order = {}, N_L1 = {}, N_L0 = {}, K_L1 = {}",
        m.get("order").copied().unwrap_or(0),
        m.get("N_L1").copied().unwrap_or(1),
        m.get("N_L0").copied().unwrap_or(1),
        m.get("K_L1").copied().unwrap_or(1)
    )
}

pub fn emit_variant_text(graph: &PiiGraph, mapped_json: &Path, out_txt: &Path) -> io::Result<u64> {
    let mapped_text = fs::read_to_string(mapped_json)?;
    let mapped: Value = serde_json::from_str(&mapped_text)?;
    let execute_layers = parse_execute_layers(&mapped)?;

    let mut f = fs::File::create(out_txt)?;

    let mut execute_nodes: Vec<usize> = graph
        .nodes
        .iter()
        .enumerate()
        .filter_map(|(idx, n)| matches!(n.op, TensorOp::Execute(_)).then_some(idx))
        .collect();
    execute_nodes.sort_unstable();

    if execute_nodes.len() != execute_layers.len() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            format!(
                "execute layer count mismatch: pii has {}, mapped has {}",
                execute_nodes.len(),
                execute_layers.len()
            ),
        ));
    }

    let mut execute_info_by_node: HashMap<usize, ExecuteLayerInfo> = HashMap::new();
    for (node_idx, info) in execute_nodes.iter().zip(execute_layers.iter()) {
        execute_info_by_node.insert(*node_idx, info.clone());
    }

    let total_latency: u64 = execute_layers.iter().map(|l| l.latency).sum();

    for (node_idx, node) in graph.nodes.iter().enumerate() {
        match &node.op {
            TensorOp::LoadIVN(meta, _) => {
                let addr = addr_for_load_input(graph, node_idx);
                writeln!(f, "SetIVNLayout({})", setivn_from_load_metadata(meta))?;
                writeln!(f, "LoadIVN(addr = {})", addr)?;
            }
            TensorOp::LoadWVN(meta, _) => {
                let addr = addr_for_load_input(graph, node_idx);
                writeln!(f, "SetWVNLayout({})", setwvn_from_load_metadata(meta))?;
                writeln!(f, "LoadWVN(addr = {})", addr)?;
            }
            TensorOp::Execute(_) => {
                let info = execute_info_by_node.get(&node_idx).ok_or_else(|| {
                    io::Error::new(
                        io::ErrorKind::InvalidData,
                        format!("missing mapped execute info for node t{}", node_idx),
                    )
                })?;

                writeln!(
                    f,
                    "SetOVNLayout({})",
                    format_fields(&info.ovn, &["order", "P_L1", "P_L0", "Q_L1"])
                )?;

                if let Some(tiles) = info.execute_mapping.as_array() {
                    for t in tiles {
                        writeln!(
                            f,
                            "ExecuteMapping({})",
                            format_fields(t, &["G_c", "G_r", "r_0", "c_0", "s_r", "s_c"])
                        )?;
                    }
                }
            }
            TensorOp::SoftMax(_) => {
                let src = node.children.first().copied();
                let layout = src
                    .and_then(|s| execute_info_by_node.get(&s).map(|x| x.ovn.clone()))
                    .unwrap_or(Value::Null);
                writeln!(
                    f,
                    "SoftMax({})",
                    format_fields(
                        &layout,
                        &["order", "P_L1", "P_L0", "Q_L1", "M_L1", "M_L0", "J_L1"]
                    )
                )?;
            }
            TensorOp::StoreOVN(_, _) => {
                writeln!(f, "StoreOVN(addr = {})", node.hbm_offset.unwrap_or(-1))?;
            }
            _ => {}
        }
    }

    Ok(total_latency)
}
