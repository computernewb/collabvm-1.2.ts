mod vnc; // internal vnc client

mod guac;
mod guac_js;

mod jpeg_compressor;
mod jpeg_js;

mod util; // utilities

use tracing_subscriber::prelude::*;
use tracing_subscriber::{EnvFilter, Registry};

use neon::prelude::*;

#[neon::main]
fn main(mut cx: ModuleContext) -> NeonResult<()> {
	// Initalize tracing
	let env_filter = EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info"));
	let formatting_layer = tracing_sprout::TrunkLayer::new("libcvm-rs".to_string(), env!("CARGO_PKG_VERSION").to_string(), std::io::stdout);
let subscriber = Registry::default()
     .with(env_filter)
     .with(formatting_layer);

	tracing::subscriber::set_global_default(subscriber)
		.expect("fucked and over.");

	// export JS
	vnc::js::export(&mut cx)?;

	cx.export_function("guacDecode", guac_js::guac_decode)?;
	cx.export_function("guacEncode", guac_js::guac_encode)?;
	Ok(())
}
