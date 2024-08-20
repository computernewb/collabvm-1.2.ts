use napi::Env;
use napi_derive::napi;

use once_cell::sync::OnceCell;

use std::cell::RefCell;

use rayon::{ThreadPool, ThreadPoolBuilder};

use crate::jpeg_compressor::*;

/// Gives a Rayon thread pool we use for parallelism
fn rayon_pool() -> &'static ThreadPool {
	static RUNTIME: OnceCell<ThreadPool> = OnceCell::new();

	RUNTIME.get_or_init(|| {
		// spawn at least 4 threads
		let mut nr_threads = std::thread::available_parallelism().expect("??").get() / 8;
		if nr_threads == 0 {
			nr_threads = 4;
		}

		ThreadPoolBuilder::new()
			.num_threads(nr_threads)
			.thread_name(|index| format!("cvmrs_jpeg_{}", index + 1))
			.build()
			.unwrap()
	})
}

thread_local! {
	static COMPRESSOR: RefCell<JpegCompressor> = RefCell::new(JpegCompressor::new());
}

// TODO: We should probably allow passing an array of images to encode, which would
// increase parallelism heavily.

#[napi(object)]
pub struct JpegInputArgs {
	pub width: u32,
	pub height: u32,
	pub stride: u32,
	pub buffer: napi::JsBuffer,
}

#[napi(js_name = "jpegEncode")]
#[allow(unused)]
pub fn jpeg_encode(env: Env, input: JpegInputArgs) -> napi::Result<napi::JsObject> {
	let (deferred_resolver, promise) = env.create_deferred::<napi::JsUnknown, _>()?;
	let buf = input.buffer.into_ref()?;

	// Spawn a task on the rayon pool that encodes the JPEG and fufills the promise
	// once it is done encoding.
	rayon_pool().spawn_fifo(move || {
		let image: Image = Image {
			buffer: &buf,
			width: input.width as u32,
			height: input.height as u32,

			stride: (input.stride as u64 * 4u64) as u32,
			format: turbojpeg_sys::TJPF_TJPF_RGBA,
		};

		let vec = COMPRESSOR.with(|lazy| {
			let mut b = lazy.borrow_mut();
			b.set_quality(35);
			b.set_subsamp(turbojpeg_sys::TJSAMP_TJSAMP_420);
			b.compress_buffer(&image)
		});

		deferred_resolver.resolve(move |env| {
			let buffer = env
				.create_buffer_with_data(vec)
				.expect("Couldn't create node Buffer, things are probably very broken by this point");
			Ok(buffer.into_unknown())
		});
	});

	Ok(promise)
}
