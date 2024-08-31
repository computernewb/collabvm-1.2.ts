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


pub fn jpeg_encode_rs(src: &[u32], width: u32, height: u32, stride: u32) -> Vec<u8> {
	let mut opt: Option<Vec<u8>> = None;

	rayon_pool().scope(|s| {
		s.spawn(|_| {
			let image: Image = Image {
				buffer: unsafe {
					std::slice::from_raw_parts(
						src.as_ptr() as *const u8,
						src.len() * core::mem::size_of::<u32>(),
					)
				},
				width: width as u32,
				height: height as u32,

				stride: (stride as u64 * 4u64) as u32,
				format: turbojpeg_sys::TJPF_TJPF_BGRA,
			};

			opt = Some(COMPRESSOR.with(|lazy| {
				let mut b = lazy.borrow_mut();
				b.set_quality(35);
				b.set_subsamp(turbojpeg_sys::TJSAMP_TJSAMP_420);
				b.compress_buffer(&image)
			}));
		});
	});

	opt.expect("what")
}


// TODO: These APIs will be dropped, probably should make a 0.3.0 to force rebuild or something

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
	let (deferred_resolver, promise) = env.create_deferred::<napi::JsBuffer, _>()?;
	let mut buf = input.buffer.into_ref()?;

	// Spawn a task on the rayon pool that encodes the JPEG and fufills the promise
	// once it is done encoding.
	rayon_pool().spawn_fifo(move || {
		let image: Image = Image {
			buffer: &buf,
			width: input.width as u32,
			height: input.height as u32,

			stride: (input.stride as u64 * 4u64) as u32,
			format: turbojpeg_sys::TJPF_TJPF_BGRA,
		};

		let vec = COMPRESSOR.with(|lazy| {
			let mut b = lazy.borrow_mut();
			b.set_quality(35);
			b.set_subsamp(turbojpeg_sys::TJSAMP_TJSAMP_420);
			b.compress_buffer(&image)
		});

		deferred_resolver.resolve(move |env| {
			let buffer = env.create_buffer_with_data(vec).expect(
				"Couldn't create node Buffer, things are probably very broken by this point",
			);
			// no longer need the input buffer
			buf.unref(env)?;
			Ok(buffer.into_raw())
		});
	});

	Ok(promise)
}
