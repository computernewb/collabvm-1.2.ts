use neon::prelude::*;
use crate::guac;

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
            return cx.throw_error(format!("{}", e));
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

    Ok(cx.string(guac::encode_instruction(&elements)))
}

pub fn guac_decode(mut cx: FunctionContext) -> JsResult<JsArray> {
    guac_decode_impl(&mut cx)
}

pub fn guac_encode(mut cx: FunctionContext) -> JsResult<JsString> {
    guac_encode_impl(&mut cx)
}
