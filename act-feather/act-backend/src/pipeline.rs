use std::cell::RefCell;
use std::env;
use std::io;
use std::path::Path;
use std::process;
use std::rc::Rc;
use std::thread::sleep;
use std::time::Instant;

use egg::{Runner, StopReason};

pub use act_feather::{ir, isel};
pub use act_feather::{N, PROCESSED, SLEEP_TIME, SLOW_LIMIT_CUTOFF, SLOW_LIMIT_START, TIME_LIMIT};

fn parse_i32_arg(args: &[String], flag: &str) -> Option<i32> {
    let idx = args.iter().position(|x| x == flag)? + 1;
    if idx >= args.len() {
        return None;
    }
    args[idx].parse::<i32>().ok()
}

fn default_layout_config(program_name: &str) -> (i32, i32, i32) {
    if program_name.contains("mini") {
        (4, 4, 4)
    } else {
        (16, 16, 16)
    }
}

fn dump_pii_and_run_minisa(
    pii: &ir::pii::PiiGraph,
    pii_id: usize,
    log_dir: &Path,
) -> io::Result<()> {
    let pii_dir = log_dir.join(format!("pii_{}", pii_id));
    std::fs::create_dir_all(&pii_dir)?;

    let pii_path = pii_dir.join(format!("{}.pii", pii_id));
    pii.save(&pii_path);

    let explore_out =
        act_feather::minisa::explore::explore_from_graph(pii, &pii_dir, &format!("pii_{}", pii_id))?;

    println!(
        "Explored PII #{}: {} candidate(s), min latency {}, max latency {}, ACT-eqsat {} ms, FEATHER-mapper {} ms, total {} ms",
        pii_id,
        explore_out.assembly_txts.len(),
        explore_out.min_total_latency,
        explore_out.max_total_latency,
        explore_out.non_mapper_time_ms,
        explore_out.mapper_time_ms,
        explore_out.total_time_ms,
    );

    Ok(())
}

fn print_help(program_name: String) {
    if program_name == "cargo" {
        // When run via `cargo run -- ...`, the first argument is "cargo"
        println!("Usage: cargo run -- --input <hlo_path> [--log <log_dir>]");
    } else {
        println!(
            "Usage: {} --input <hlo_path> [--log <log_dir>]",
            program_name
        );
    }
    println!();
    println!("Description:");
    println!("  This program compiles an .hlo file into candidate .pii graphs.");
    println!("  All extracted candidates are dumped in the specified log directory.");
    println!();
    println!("Options:");
    println!("  --help       Print this help message");
    println!("  --input      Specify the input .hlo file path");
    println!("               (required, must have .hlo extension)");
    println!("  --log        Specify the log directory");
    println!("               (optional, defaults to /tmp/log if not provided)");
    println!("  --vn-size    Override VN size for layout exploration");
    println!("               (optional, defaults by binary: 16 for act-feather, 4 for act-feather-mini)");
    println!("  --ah         Override FEATHER AH in generated mapper input");
    println!("               (optional, defaults by binary: 16 for act-feather, 4 for act-feather-mini)");
    println!("  --aw         Override FEATHER AW in generated mapper input");
    println!("               (optional, defaults by binary: 16 for act-feather, 4 for act-feather-mini)");
    println!();
}

fn main() {
    let args: Vec<String> = env::args().collect();

    let (mut vn_size, mut ah, mut aw) = default_layout_config(&args[0]);
    if let Some(v) = parse_i32_arg(&args, "--vn-size") {
        vn_size = v;
    }
    if let Some(v) = parse_i32_arg(&args, "--ah") {
        ah = v;
    }
    if let Some(v) = parse_i32_arg(&args, "--aw") {
        aw = v;
    }
    act_feather::minisa::spec::set_layout_config(vn_size, ah, aw);

    if args.contains(&"--help".to_string()) || !args.contains(&"--input".to_string()) {
        print_help(args[0].clone());
        process::exit(0);
    }

    // Process input file
    let input_index = args.iter().position(|x| x == "--input").unwrap() + 1;
    if input_index >= args.len() {
        eprintln!("Error: Missing file name after --input");
        process::exit(1);
    }

    let hlo_path_arg = &args[input_index];
    let current_dir = env::current_dir().expect("Failed to get current directory");
    let hlo_path = current_dir.join(hlo_path_arg);

    if hlo_path.extension().and_then(|s| s.to_str()) != Some("hlo") {
        eprintln!(
            "Error: Input file '{}' is not an .hlo file.",
            hlo_path.display()
        );
        process::exit(1);
    }

    if !hlo_path.exists() {
        eprintln!("Error: Input file '{}' does not exist.", hlo_path.display());
        process::exit(1);
    }

    println!("Input file: {}", hlo_path.display());
    println!("MINISA config: VN_SIZE={}, AH={}, AW={}", vn_size, ah, aw);

    // Process log directory
    let log_dir_arg: String = if args.contains(&"--log".to_string()) {
        let log_index = args.iter().position(|x| x == "--log").unwrap() + 1;
        if log_index >= args.len() {
            eprintln!("Error: Missing directory after --log");
            process::exit(1);
        }
        args[log_index].clone()
    } else {
        "/tmp/log".to_string()
    };
    println!("Log directory: {}", log_dir_arg);

    let log_dir = std::path::PathBuf::from(log_dir_arg);
    if log_dir.exists() {
        std::fs::remove_dir_all(&log_dir).expect("Failed to remove existing log directory");
    }
    std::fs::create_dir_all(&log_dir).expect("Failed to create log directory");

    println!("PII graphs dumped to: {}", log_dir.display());
    println!();

    let pii_counter: Rc<RefCell<usize>> = Rc::new(RefCell::new(0));

    // Start processing the input file
    let start = Instant::now();

    println!("Starting Phase 1: Instruction Selection...");
    println!();

    println!("Starting Phase 1 Module 1: E-Graph Initializer...");
    println!();

    let (init_egraph, hbm_offsets, root, inputs, metadata) =
        isel::initializer::parse_hlo_module_to_egraph(&hlo_path).unwrap();

    println!("HBM Offsets: {:?}", hbm_offsets);
    println!("Root ID: {:?}", root);
    println!("Inputs: {:?}", inputs);
    println!();

    let metadata_path = log_dir.join("metadata.json");
    metadata.save(&metadata_path);

    let mut limit: usize = SLOW_LIMIT_START;

    let rules = isel::rewrites::get_rewrites();
    let inputs_for_hook = inputs.clone();
    let hbm_offsets_for_hook = hbm_offsets.clone();

    let log_dir_for_hook = log_dir.clone();

    let runner = {
        // clone the Rcs
        let pii_counter = pii_counter.clone();

        Runner::default()
            .with_egraph(init_egraph)
            .with_node_limit(5000)
            .with_time_limit(TIME_LIMIT)
            .with_hook(move |runner| {
                PROCESSED.lock().unwrap().clear();
                if runner.iterations.len() % N == 0 && runner.iterations.len() > 0 {
                    println!(
                        "Starting Phase 1 Module 3: Graph Extractor (limit {})",
                        limit
                    );
                    println!();

                    let piis = isel::extractor::extract(
                        &mut runner.egraph.clone(),
                        root,
                        &inputs_for_hook,
                        &hbm_offsets_for_hook,
                        limit,
                    );
                    limit += 1; // Increment limit to allow for more extraction next time
                    let found_count = piis.len();

                    for pii in piis {
                        println!("Processing PII #{}", *pii_counter.borrow());

                        let pii_id = *pii_counter.borrow();
                        dump_pii_and_run_minisa(&pii, pii_id, &log_dir_for_hook)
                            .expect("Failed to write per-PII outputs");

                        *pii_counter.borrow_mut() += 1;
                    }

                    println!("Completed extraction checkpoint, returning to rewrites");
                    println!();

                    if found_count > 0 {
                        println!(
                            "Found {} PII graph(s) in this checkpoint. Exiting early.",
                            found_count
                        );
                        println!(
                            "Dumped {} PII graph(s) under {}",
                            *pii_counter.borrow(),
                            log_dir_for_hook.display()
                        );
                        process::exit(0);
                    }
                }

                println!(
                    "Starting Phase 1 Module 2: Rewrite Applier (iteration {})",
                    runner.iterations.len() + 1
                );
                println!();
                sleep(SLEEP_TIME);

                Ok(())
            })
            .run(&rules.clone())
    };

    // Logic based on the stop reason:
    // 1. TimeLimit: No more extraction, just return.
    // 2. NodeLimit, Saturated: Run extraction until time limit is hit.
    // 3. IterationLimit: Should not have happened. Recheck if there is a default limit.
    // 4. Other: Should not have happened. Requires investigation.

    match runner.stop_reason.as_ref().unwrap() {
        StopReason::TimeLimit(_) => {
            println!("Info: Reached time limit. No further extraction.");
            println!();
        }
        StopReason::NodeLimit(_) | StopReason::Saturated => {
            println!("Info: Reached node limit or saturated. Running extraction until time limit is hit.");
            println!();

            while start.elapsed() < TIME_LIMIT {
                println!(
                    "Starting Phase 1 Module 3: Graph Extractor (limit {})",
                    limit
                );
                println!();

                let piis = isel::extractor::extract(
                    &mut runner.egraph.clone(),
                    root,
                    &inputs,
                    &hbm_offsets,
                    limit,
                );
                limit += 1; // Increment limit to allow for more extraction next time
                let found_count = piis.len();

                for pii in piis {
                    println!("Dumping PII #{}", *pii_counter.borrow());

                    let pii_id = *pii_counter.borrow();
                    dump_pii_and_run_minisa(&pii, pii_id, &log_dir)
                        .expect("Failed to write per-PII outputs");

                    *pii_counter.borrow_mut() += 1;
                }

                println!("Completed extraction checkpoint, returning to rewrites");
                println!();

                if found_count > 0 {
                    println!(
                        "Found {} PII graph(s) in this checkpoint. Exiting early.",
                        found_count
                    );
                    break;
                }

                sleep(SLEEP_TIME);
            }
            println!("Info: Reached time limit. No further extraction.");
        }
        StopReason::IterationLimit(_) => {
            eprintln!("Error: Reached iteration limit. This should not happen.");
            process::exit(1);
        }
        StopReason::Other(_) => {
            eprintln!("Error: Stopped for an unexpected reason. Requires investigation.");
            process::exit(1);
        }
    }

    println!("Total time: {:?}", start.elapsed());
    println!(
        "Dumped {} PII graph(s) under {}",
        *pii_counter.borrow(),
        log_dir.display()
    );
}
