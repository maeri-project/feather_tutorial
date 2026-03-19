use std::env;
use std::io;
use std::path::{Path, PathBuf};
use std::process::Command;

#[derive(Debug, Clone)]
pub struct MapperLayerStats {
    pub layer_name: String,
    pub m: u64,
    pub k: u64,
    pub n: u64,
    pub latency: u64,
    pub execute_tiles: usize,
    pub overall_utilization: String,
    pub compute_utilization: String,
}

#[derive(Debug, Clone)]
pub struct MapperRunOutput {
    pub stdout: String,
    pub layers: Vec<MapperLayerStats>,
}

fn parse_key_value_u64(part: &str) -> Option<(&str, u64)> {
    let (k, v) = part.split_once('=')?;
    let value = v.trim().parse::<u64>().ok()?;
    Some((k.trim(), value))
}

fn parse_mapper_stdout(stdout: &str) -> Vec<MapperLayerStats> {
    let mut layers = Vec::new();
    let mut current: Option<MapperLayerStats> = None;

    for raw_line in stdout.lines() {
        let line = raw_line.trim();

        if let Some(rest) = line.strip_prefix("Processing layer ") {
            if let Some(prev) = current.take() {
                layers.push(prev);
            }

            current = Some(MapperLayerStats {
                layer_name: rest.trim_end_matches("...").trim().to_string(),
                m: 0,
                k: 0,
                n: 0,
                latency: 0,
                execute_tiles: 0,
                overall_utilization: String::new(),
                compute_utilization: String::new(),
            });
            continue;
        }

        let Some(layer) = current.as_mut() else {
            continue;
        };

        if let Some(rest) = line.strip_prefix("GEMM dimensions:") {
            for part in rest.split(',') {
                if let Some((k, v)) = parse_key_value_u64(part.trim()) {
                    match k {
                        "M" => layer.m = v,
                        "K" => layer.k = v,
                        "N" => layer.n = v,
                        _ => {}
                    }
                }
            }
        } else if let Some(rest) = line.strip_prefix("Total latency:") {
            let token = rest.split_whitespace().next().unwrap_or("0");
            layer.latency = token.parse::<u64>().unwrap_or(0);
        } else if let Some(rest) = line.strip_prefix("Overall utilization:") {
            layer.overall_utilization = rest.trim().to_string();
        } else if let Some(rest) = line.strip_prefix("Compute-only utilization:") {
            layer.compute_utilization = rest.trim().to_string();
        } else if let Some(rest) = line.strip_prefix("ExecuteMapping instructions:") {
            layer.execute_tiles = rest.trim().parse::<usize>().unwrap_or(0);
        }
    }

    if let Some(last) = current {
        layers.push(last);
    }
    layers
}

fn find_mapper_script() -> io::Result<(PathBuf, PathBuf)> {
    if let Ok(script_from_env) = env::var("FEATHER_MAPPER_SCRIPT") {
        let script = PathBuf::from(script_from_env);
        if script.exists() {
            let feather_root = script
                .parent()
                .and_then(Path::parent)
                .and_then(Path::parent)
                .map(Path::to_path_buf)
                .ok_or_else(|| {
                    io::Error::new(
                        io::ErrorKind::InvalidInput,
                        "FEATHER_MAPPER_SCRIPT must point to feather/compiler/ACT/launch_cost_model.py",
                    )
                })?;
            return Ok((script, feather_root));
        }
    }

    let cwd = env::current_dir()?;
    for ancestor in cwd.ancestors() {
        let candidate = ancestor.join("feather/compiler/ACT/launch_cost_model.py");
        if candidate.exists() {
            return Ok((candidate, ancestor.join("feather")));
        }

        let candidate = ancestor.join("compiler/ACT/launch_cost_model.py");
        if candidate.exists() {
            return Ok((candidate, ancestor.to_path_buf()));
        }
    }

    Err(io::Error::new(
        io::ErrorKind::NotFound,
        "Could not find launch_cost_model.py. Set FEATHER_MAPPER_SCRIPT or run under act-feather/.",
    ))
}

pub fn run_mapper(input_json: &Path, output_json: &Path) -> io::Result<MapperRunOutput> {
    let (script, working_dir) = find_mapper_script()?;
    let input_abs = input_json.canonicalize()?;
    let output_abs = if output_json.is_absolute() {
        output_json.to_path_buf()
    } else {
        env::current_dir()?.join(output_json)
    };

    let output = Command::new("python3")
        .current_dir(&working_dir)
        .arg(&script)
        .arg("-i")
        .arg(&input_abs)
        .arg("-o")
        .arg(&output_abs)
        .output()?;

    let stderr = String::from_utf8_lossy(&output.stderr);
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();

    if output.status.success() {
        let layers = parse_mapper_stdout(&stdout);
        Ok(MapperRunOutput { stdout, layers })
    } else {
        Err(io::Error::new(
            io::ErrorKind::Other,
            format!(
                "mapper command failed (cwd={}, script={})\nstdout:\n{}\nstderr:\n{}",
                working_dir.display(),
                script.display(),
                stdout,
                stderr
            ),
        ))
    }
}
