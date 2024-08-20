use std::sync::{Arc, Mutex};

use neon::prelude::*;
use neon::types::buffer::TypedArray;

use once_cell::sync::OnceCell;

use std::cell::RefCell;

use rayon::{ThreadPool, ThreadPoolBuilder};

use crate::jpeg_compressor::*;

/// Gives a Rayon thread pool we use for parallelism
fn rayon_pool<'a, C: Context<'a>>(cx: &mut C) -> NeonResult<&'static ThreadPool> {
	static RUNTIME: OnceCell<ThreadPool> = OnceCell::new();

	RUNTIME
		.get_or_try_init(|| {
			// spawn at least 4 threads
			let mut nr_threads = std::thread::available_parallelism().expect("??").get() / 8;
			if nr_threads == 0 {
				nr_threads = 4;
			}

			ThreadPoolBuilder::new()
				.num_threads(nr_threads)
				.thread_name(|index| format!("cvmrs_jpeg_{}", index + 1))
				.build()
		})
		.or_else(|err| cx.throw_error(&err.to_string()))
}

thread_local! {
	static COMPRESSOR: RefCell<JpegCompressor> = RefCell::new(JpegCompressor::new());
}

// TODO: We should probably allow passing an array of images to encode, which would
// increase parallelism heavily.

fn jpeg_encode_impl<'a>(cx: &mut FunctionContext<'a>) -> JsResult<'a, JsPromise> {
	let input = cx.argument::<JsObject>(0)?;

	// Get our input arguments here
	let width: u64 = input.get::<JsNumber, _, _>(cx, "width")?.value(cx) as u64;
	let height: u64 = input.get::<JsNumber, _, _>(cx, "height")?.value(cx) as u64;
	let stride: u64 = input.get::<JsNumber, _, _>(cx, "stride")?.value(cx) as u64;
	let buffer: Handle<JsBuffer> = input.get(cx, "buffer")?;

	let (deferred, promise) = cx.promise();
	let channel = cx.channel();
	let pool = rayon_pool(cx)?;

	let buf = buffer.as_slice(cx);

	let copy: Arc<Mutex<Vec<u8>>> = Arc::new(Mutex::new(Vec::with_capacity(buf.len())));

	// Copy from the node buffer to our temporary buffer
	{
		let mut locked = copy.lock().unwrap();
		let cap = locked.capacity();
		locked.resize(cap, 0);
		locked.copy_from_slice(buf);
	}

	// Spawn a task on the rayon pool that encodes the JPEG and fufills the promise
	// once it is done encoding.
	pool.spawn_fifo(move || {
		let clone = Arc::clone(&copy);
		let locked = clone.lock().unwrap();

		let image: Image = Image {
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

pub fn jpeg_encode(mut cx: FunctionContext) -> JsResult<JsPromise> {
	jpeg_encode_impl(&mut cx)
}
