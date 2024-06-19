mod guac;

use neon::prelude::*;

fn guac_decode_impl<'a>(cx: &mut FunctionContext<'a>) -> JsResult<'a, JsArray> {
    let input = cx.argument::<JsString>(0)?.value(cx);

    match guac::decode_instruction(&input) {
        Ok(data) => {
            let array = JsArray::new(cx, data.len());

            let conv = data
                .iter()
                .map(|v| cx.string(v))
                .collect::<Vec<Handle<JsString>>>();

            for (i, str) in conv.iter().enumerate() {
                array.set(cx, i as u32, *str)?;
            }

            return Ok(array);
        }

        Err(e) => {
            let err = cx.string(format!("Error decoding guacamole: {}", e));
            return cx.throw(err);
        }
    }
}

fn guac_encode_impl<'a>(cx: &mut FunctionContext<'a>) -> JsResult<'a, JsString> {
    let mut elements: Vec<String> = Vec::with_capacity(cx.len());

    // Capture varadic arguments
    for i in 0..cx.len() {
        let input = cx.argument::<JsString>(i)?.value(cx);
        elements.push(input);
    }

    // old array stuff
    /*
    let input = cx.argument::<JsArray>(0)?;
    let raw_elements = input.to_vec(cx)?;

    // bleh
    let vecres: Result<Vec<_>, _> = raw_elements
        .iter()
        .map(|item| match item.to_string(cx) {
            Ok(s) => {
                return Ok(s.value(cx));
            }

            Err(e) => {
                return Err(e);
            }
        })
        .collect();

    let vec = vecres?;
    */

    Ok(cx.string(guac::encode_instruction(&elements)))
}

fn guac_decode(mut cx: FunctionContext) -> JsResult<JsArray> {
    guac_decode_impl(&mut cx)
}

fn guac_encode(mut cx: FunctionContext) -> JsResult<JsString> {
    guac_encode_impl(&mut cx)
}

#[neon::main]
fn main(mut cx: ModuleContext) -> NeonResult<()> {
    cx.export_function("guacDecode", guac_decode)?;
    cx.export_function("guacEncode", guac_encode)?;
    Ok(())
}
