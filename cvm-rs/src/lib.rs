mod vnc; // internal vnc client

mod guac;
mod guac_js;

mod jpeg_compressor;
mod jpeg_js;


use neon::prelude::*;

#[neon::main]
fn main(mut cx: ModuleContext) -> NeonResult<()> {
	// export JS
	vnc::js::export(&mut cx)?;

	cx.export_function("guacDecode", guac_js::guac_decode)?;
	cx.export_function("guacEncode", guac_js::guac_encode)?;
	Ok(())
}
