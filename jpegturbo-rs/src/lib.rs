use std::sync::{Arc, Mutex};

use neon::prelude::*;
use neon::types::buffer::TypedArray;

use once_cell::sync::OnceCell;
use tokio::runtime::Runtime;

use std::cell::RefCell;

mod jpeg_compressor;

fn runtime<'a, C: Context<'a>>(cx: &mut C) -> NeonResult<&'static Runtime> {
    static RUNTIME: OnceCell<Runtime> = OnceCell::new();

    RUNTIME
        .get_or_try_init(Runtime::new)
        .or_else(|err| cx.throw_error(&err.to_string()))
}

thread_local! {
    static COMPRESSOR: RefCell<jpeg_compressor::JpegCompressor> = RefCell::new(jpeg_compressor::JpegCompressor::new());
}

fn jpeg_encode_impl<'a>(cx: &mut FunctionContext<'a>) -> JsResult<'a, JsPromise> {
    let input = cx.argument::<JsObject>(0)?;

    // Get our input arguments here
    let width: u64 = input.get::<JsNumber, _, _>(cx, "width")?.value(cx) as u64;
    let height: u64 = input.get::<JsNumber, _, _>(cx, "height")?.value(cx) as u64;
    let stride: u64 = input.get::<JsNumber, _, _>(cx, "stride")?.value(cx) as u64;
    let buffer: Handle<JsBuffer> = input.get(cx, "buffer")?;

    let (deferred, promise) = cx.promise();
    let channel = cx.channel();
    let runtime = runtime(cx)?;

    let buf = buffer.as_slice(cx);

    let copy: Arc<Mutex<Vec<u8>>> = Arc::new(Mutex::new(Vec::with_capacity(buf.len())));

	// Copy from the node buffer to our temporary buffer
    {
        let mut locked = copy.lock().unwrap();
        let cap = locked.capacity();
        locked.resize(cap, 0);
        locked.copy_from_slice(buf);
    }

	// Spawn off a tokio blocking pool thread that will do the work for us
	runtime.spawn_blocking(move || {
        let clone = Arc::clone(&copy);
        let locked = clone.lock().unwrap();

        let image: jpeg_compressor::Image = jpeg_compressor::Image {
            buffer: locked.as_slice(),
            width: width as u32,
            height: height as u32,

            stride: (stride * 4u64) as u32, // I think?
            format: turbojpeg_sys::TJPF_TJPF_RGBA,
        };

        let vec = COMPRESSOR.with(|lazy| {
            let mut b = lazy.borrow_mut();
            b.set_quality(35);
            b.set_subsamp(turbojpeg_sys::TJSAMP_TJSAMP_420);
            b.compress_buffer(&image)
        });

		// Fulfill the Javascript promise with our encoded buffer
        deferred.settle_with(&channel, move |mut cx| {
            let mut buf = cx.buffer(vec.len())?;
            let slice = buf.as_mut_slice(&mut cx);
            slice.copy_from_slice(vec.as_slice());
            Ok(buf)
        });
    });

    Ok(promise)
}

fn jpeg_encode(mut cx: FunctionContext) -> JsResult<JsPromise> {
    jpeg_encode_impl(&mut cx)
}

#[neon::main]
fn main(mut cx: ModuleContext) -> NeonResult<()> {
    cx.export_function("jpegEncode", jpeg_encode)?;
    Ok(())
}
