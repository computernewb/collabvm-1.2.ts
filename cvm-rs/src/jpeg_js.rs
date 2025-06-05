use napi::Env;
use napi_derive::napi;

use once_cell::sync::OnceCell;

use std::cell::RefCell;

use rayon::{ThreadPool, ThreadPoolBuilder};

use crate::jpeg_compressor::*;


use resize::Pixel::RGBA8;
use resize::Type::Triangle;
use rgb::FromSlice;


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
	pub quality: u32,
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
			format: turbojpeg_sys::TJPF_TJPF_RGBA,
		};

		let vec = COMPRESSOR.with(|lazy| {
			let mut b = lazy.borrow_mut();
			b.set_quality(input.quality);
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

#[napi(object)]
pub struct JpegResizeInputArgs {
	pub width: u32,
	pub height: u32,
	pub desired_width: u32,
	pub desired_height: u32,
	pub buffer: napi::JsBuffer,
	pub quality: u32,
}

#[napi(js_name = "jpegResizeEncode")]
#[allow(unused)]
pub fn jpeg_resize_and_encode(
	env: Env,
	input: JpegResizeInputArgs,
) -> napi::Result<napi::JsObject> {
	let (deferred_resolver, promise) = env.create_deferred::<napi::JsBuffer, _>()?;
	let mut buf = input.buffer.into_ref()?;

	// Spawn a task on the rayon pool that encodes the JPEG and fufills the promise
	// once it is done encoding.
	rayon_pool().spawn_fifo(move || {
		let mut new_data: Vec<u8> =
			vec![0; (input.desired_width * input.desired_height) as usize * 4];

		let mut resizer = resize::new(
			input.width as usize,
			input.height as usize,
			input.desired_width as usize,
			input.desired_height as usize,
			RGBA8,
			Triangle,
		)
		.expect("Could not create resizer");

		resizer
			.resize(&buf.as_rgba(), new_data.as_rgba_mut())
			.expect("Resize operation failed");

		// then just jpeg encode. Ideally this would be shared :(
		let image = Image {
			buffer: &new_data,
			width: input.desired_width as u32,
			height: input.desired_height as u32,
			stride: (input.desired_width as u64 * 4u64) as u32,
			format: turbojpeg_sys::TJPF_TJPF_RGBA,
		};

		let vec = COMPRESSOR.with(|lazy| {
			let mut b = lazy.borrow_mut();
			b.set_quality(input.quality);
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
