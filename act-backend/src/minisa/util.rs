use std::collections::HashMap;

use serde_json::{json, Map, Value};

use crate::ir::pii::PiiGraph;
use crate::minisa::spec;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct LayoutTuple {
    pub order: i32,
    pub dim0_l1: i32,
    pub dim0_l0: i32,
    pub dim1_l1: i32,
}

#[derive(Debug, Clone, Copy)]
pub struct Dims {
    pub dim0: i32,
    pub dim1: i32,
}

pub fn flip_order(order: i32) -> i32 {
    5 - order
}

pub fn parse_metadata_map(meta: &str) -> HashMap<String, i32> {
    let mut map = HashMap::new();
    for tok in meta.split(',') {
        let t = tok.trim();
        if t.is_empty() {
            continue;
        }
        let kv = if let Some((k, v)) = t.split_once(':') {
            Some((k.trim(), v.trim()))
        } else if let Some((k, v)) = t.split_once('=') {
            Some((k.trim(), v.trim()))
        } else {
            None
        };

        if let Some((k, v)) = kv {
            if let Ok(parsed) = v.parse::<i32>() {
                map.insert(k.to_string(), parsed);
            }
        }
    }
    map
}

pub fn layout_from_ivn_meta(meta: &str, dims: Dims) -> Option<LayoutTuple> {
    let m = parse_metadata_map(meta);
    let out = LayoutTuple {
        order: *m.get("order")?,
        dim0_l1: *m.get("M_L1")?,
        dim0_l0: *m.get("M_L0")?,
        dim1_l1: *m.get("J_L1")?,
    };
    if out.dim0_l1 * out.dim0_l0 != dims.dim0 || out.dim1_l1 != dims.dim1 / spec::VN_SIZE {
        return None;
    }
    Some(out)
}

pub fn layout_from_ovn_meta(meta: &str, dims: Dims) -> Option<LayoutTuple> {
    let m = parse_metadata_map(meta);
    let out = LayoutTuple {
        order: flip_order(*m.get("order")?),
        dim0_l1: *m.get("P_L1")?,
        dim0_l0: *m.get("P_L0")?,
        dim1_l1: *m.get("Q_L1")?,
    };
    if out.dim0_l1 * out.dim0_l0 != dims.dim0 || out.dim1_l1 != dims.dim1 / spec::VN_SIZE {
        return None;
    }
    Some(out)
}

pub fn layout_from_wvn_meta(meta: &str, dims: Dims) -> Option<LayoutTuple> {
    let m = parse_metadata_map(meta);
    let out = LayoutTuple {
        order: *m.get("order")?,
        dim0_l1: *m.get("N_L1")?,
        dim0_l0: *m.get("N_L0")?,
        dim1_l1: *m.get("K_L1")?,
    };
    // For WVN: dim0 is K, dim1 is N in tensor shape [K, N].
    if out.dim0_l1 * out.dim0_l0 != dims.dim1 || out.dim1_l1 != dims.dim0 / spec::VN_SIZE {
        return None;
    }
    Some(out)
}

pub fn build_consumers(graph: &PiiGraph) -> HashMap<usize, Vec<usize>> {
    let mut consumers: HashMap<usize, Vec<usize>> = HashMap::new();
    for (idx, node) in graph.nodes.iter().enumerate() {
        for &child in &node.children {
            consumers.entry(child).or_default().push(idx);
        }
    }
    consumers
}

pub fn divisors(n: i32) -> Vec<i32> {
    let mut d = vec![];
    let mut i = 1;
    while i * i <= n {
        if n % i == 0 {
            d.push(i);
            if i != n / i {
                d.push(n / i);
            }
        }
        i += 1;
    }
    d.sort_unstable();
    d
}

pub fn ivn_json(layout: LayoutTuple) -> Map<String, Value> {
    let mut obj = Map::new();
    obj.insert("order".to_string(), json!(layout.order));
    obj.insert("M_L1".to_string(), json!(layout.dim0_l1));
    obj.insert("M_L0".to_string(), json!(layout.dim0_l0));
    obj.insert("J_L1".to_string(), json!(layout.dim1_l1));
    obj
}

pub fn ovn_json(layout: LayoutTuple) -> Map<String, Value> {
    let mut obj = Map::new();
    obj.insert("order".to_string(), json!(flip_order(layout.order)));
    obj.insert("P_L1".to_string(), json!(layout.dim0_l1));
    obj.insert("P_L0".to_string(), json!(layout.dim0_l0));
    obj.insert("Q_L1".to_string(), json!(layout.dim1_l1));
    obj
}

pub fn wvn_json(layout: LayoutTuple) -> Map<String, Value> {
    let mut obj = Map::new();
    obj.insert("order".to_string(), json!(layout.order));
    obj.insert("N_L1".to_string(), json!(layout.dim0_l1));
    obj.insert("N_L0".to_string(), json!(layout.dim0_l0));
    obj.insert("K_L1".to_string(), json!(layout.dim1_l1));
    obj
}

pub fn enum_variants(domains: &[Vec<LayoutTuple>]) -> Vec<Vec<LayoutTuple>> {
    fn rec(
        idx: usize,
        domains: &[Vec<LayoutTuple>],
        cur: &mut Vec<LayoutTuple>,
        out: &mut Vec<Vec<LayoutTuple>>,
    ) {
        if idx == domains.len() {
            out.push(cur.clone());
            return;
        }
        for v in &domains[idx] {
            cur.push(*v);
            rec(idx + 1, domains, cur, out);
            cur.pop();
        }
    }

    if domains.is_empty() {
        return vec![vec![]];
    }
    let mut out = vec![];
    rec(0, domains, &mut vec![], &mut out);
    out
}
