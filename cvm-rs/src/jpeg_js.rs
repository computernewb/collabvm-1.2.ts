//! This module's name is historical and will be changed upon merge
use std::cell::RefCell;

use crate::jpeg_compressor::*;
use once_cell::sync::OnceCell;

use rayon::{ThreadPool, ThreadPoolBuilder};

use tokio::sync::oneshot;

/// Gives a Rayon thread pool we use for parallelism
fn rayon_pool() -> &'static ThreadPool {
	static RUNTIME: OnceCell<ThreadPool> = OnceCell::new();

	RUNTIME.get_or_init(|| {
		// spawn at least 4 threads for JPEG work
		let mut nr_threads = std::thread::available_parallelism().expect("??").get() / 8;
		if nr_threads == 0 {
			nr_threads = 4;
		}

		println!("cvm-rs: Using {nr_threads} Rayon threads for JPEG encoding pool");

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

pub async fn jpeg_encode_rs(
	src: &[u32],
	width: u32,
	height: u32,
	stride: u32,
	quality: u32,
) -> anyhow::Result<Box<[u8]>> {
	// SAFETY: The slice invariants are still upheld, we just cast to &[u8] since
	// that's what we want here.
	//
	// FIXME: use util::slice_primitive_cast() here. I can't seem to currently because of a compile error
	let buf = unsafe {
		std::slice::from_raw_parts(
			src.as_ptr() as *const u8,
			src.len() * core::mem::size_of::<u32>(),
		)
	};

	let (tx, rx) = oneshot::channel();

	rayon_pool().spawn(move || {
		let image: Image = Image {
			buffer: buf,
			width: width as u32,
			height: height as u32,

			stride: (stride as u64 * 4u64) as u32,
			format: turbojpeg_sys::TJPF_TJPF_BGRA,
		};

		let vec = COMPRESSOR.with(|lazy| {
			let mut jpeg_encoder = lazy.borrow_mut();
			jpeg_encoder.set_quality(quality);
			jpeg_encoder.set_subsamp(turbojpeg_sys::TJSAMP_TJSAMP_420);
			jpeg_encoder.compress_buffer(&image)
		});

		tx.send(vec).expect("somehow rx closed before we spawned or something..? (this is more than likely impossible and signs of worse problems)");
	});

	rx.await.expect("piss")
}
