use std::fs::{File, OpenOptions};
use std::io::{self, Write};
use std::path::Path;

use crate::minisa::mapper::MapperLayerStats;

fn csv_escape(s: &str) -> String {
    if s.contains(',') || s.contains('"') || s.contains('\n') {
        format!("\"{}\"", s.replace('"', "\"\""))
    } else {
        s.to_string()
    }
}

pub fn init_variant_stats_csv(path: &Path) -> io::Result<()> {
    let mut file = File::create(path)?;
    writeln!(
        file,
        "variant,layer,latency,execute_tiles,M,K,N,overall_utilization,compute_utilization"
    )?;
    Ok(())
}

pub fn append_variant_stats_csv(
    path: &Path,
    variant_idx: usize,
    layers: &[MapperLayerStats],
) -> io::Result<()> {
    let mut file = OpenOptions::new().append(true).create(true).open(path)?;

    for l in layers {
        writeln!(
            file,
            "{},{},{},{},{},{},{},{},{}",
            variant_idx,
            csv_escape(&l.layer_name),
            l.latency,
            l.execute_tiles,
            l.m,
            l.k,
            l.n,
            csv_escape(&l.overall_utilization),
            csv_escape(&l.compute_utilization),
        )?;
    }

    Ok(())
}
