use crate::guac;

use napi_derive::napi;

#[napi(js_name = "guacDecode")]
#[allow(unused)]
pub fn guac_decode(input: String) -> napi::anyhow::Result<Vec<String>> {
	match guac::decode_instruction(&input) {
		Ok(elements) => Ok(elements),

		Err(err) => Err(anyhow::anyhow!("Error decoding Guacamole frame: {}", err)),
	}
}

// ... this is ugly, but works
#[napi(js_name = "guacEncodeImpl")]
#[allow(unused)]
pub fn guac_encode(items: Vec<String>) -> napi::anyhow::Result<String> {
	Ok(guac::encode_instruction(&items))
}
