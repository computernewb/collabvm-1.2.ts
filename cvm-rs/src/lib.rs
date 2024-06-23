mod guac;
mod guac_js;

mod jpeg_compressor;
mod jpeg_js;


use neon::prelude::*;


#[neon::main]
fn main(mut cx: ModuleContext) -> NeonResult<()> {
	// Mostly transitionary, later on API should change
    cx.export_function("jpegEncode", jpeg_js::jpeg_encode)?;

    cx.export_function("guacDecode", guac_js::guac_decode)?;
    cx.export_function("guacEncode", guac_js::guac_encode)?;
    Ok(())
}
