use napi::Env;
use napi_derive::napi;

use std::{
	cell::RefCell,
	sync::Mutex, time::Duration,
};

use once_cell::sync::Lazy;
use crate::jpeg_compressor::*;

use std::sync::mpsc;

thread_local! {
	static COMPRESSOR: RefCell<JpegCompressor> = RefCell::new(JpegCompressor::new());
}

static ENCODE_THREAD: Mutex<Lazy<JpegEncodeThread>> = Mutex::new(Lazy::new(JpegEncodeThread::new));

enum JpegEncodeThreadInput {
	// maybe I should just use crossbeam
	Buffer {
		buf: Vec<u8>,
		width: u32,
		height: u32,
		stride: Option<u32>,
	},
}

pub type JpegEncodeThreadOutput = Vec<u8>;

pub struct JpegEncodeThread {
	input_tx: mpsc::SyncSender<JpegEncodeThreadInput>,
	output_rx: mpsc::Receiver<JpegEncodeThreadOutput>,
}

impl JpegEncodeThread {
	fn new() -> Self {
		let (input_tx, input_rx) = mpsc::sync_channel(32);
		let (output_tx, output_rx) = mpsc::sync_channel(32);

		std::thread::Builder::new()
			.name("cvmrs-jpeg-work".into())
			.spawn(move || loop {
				match input_rx.try_recv() {
					Ok(input_message) => match input_message {
						JpegEncodeThreadInput::Buffer {
							buf,
							width,
							height,
							stride,
						} => {
							let image: Image = Image {
								buffer: &buf,
								width: width as u32,
								height: height as u32,

								stride: (stride.unwrap_or(width as u32) as u64 * 4u64) as u32,
								format: turbojpeg_sys::TJPF_TJPF_BGRA,
							};

							let buffer = COMPRESSOR.with(|lazy| {
								let mut b = lazy.borrow_mut();
								b.set_quality(30);
								b.set_subsamp(turbojpeg_sys::TJSAMP_TJSAMP_420);
								b.compress_buffer(&image)
							});

							let _ = output_tx.send(buffer);
						}
					},

					Err(mpsc::TryRecvError::Empty) => {
						std::thread::sleep(Duration::from_millis(10));
					}

					Err(mpsc::TryRecvError::Disconnected) => break,
				}
			}).expect("cvm-rs couldn't start JPEG thread.");

		Self {
			input_tx,
			output_rx,
		}
	}
}

pub fn jpeg_encode_rs(src: &[u32], width: u32, height: u32, stride: u32) -> Vec<u8> {
	// SAFETY: The slice invariants are still upheld, we just cast to &[u8] since
	// that's what we want here.
	let s = unsafe {
		std::slice::from_raw_parts(
			src.as_ptr() as *const u8,
			src.len() * core::mem::size_of::<u32>(),
		)
	};

	let encoder = ENCODE_THREAD.lock().expect("???");

	// send off a encode req and recv the response
	encoder
		.input_tx
		.send(JpegEncodeThreadInput::Buffer {
			buf: s.to_vec(),
			width: width,
			height: height,
			stride: if stride == width { None } else { Some(stride) },
		})
		.expect("boom");

	encoder.output_rx.recv().expect("BOOM")
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
	Err(anyhow::anyhow!("This function is no longer supported").into())
}
