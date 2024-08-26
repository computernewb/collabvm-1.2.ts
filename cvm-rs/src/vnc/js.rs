use super::{
	client::{self, *},
	surface::{Point, Rect, Surface},
};
use napi::{
	noop_finalize,
	threadsafe_function::{
		ErrorStrategy::{self, CalleeHandled},
		ThreadSafeCallContext, ThreadsafeFunction, ThreadsafeFunctionCallMode,
	},
	Env, JsBuffer, JsObject,
};
use napi_derive::napi;

use std::{
	sync::{Arc, Mutex},
	thread::Thread,
};

use tokio::sync::mpsc::{channel, error::TryRecvError, Receiver, Sender};

#[napi(js_name = "ClientInnerImpl")]
pub struct JsClient {
	surf: Arc<Mutex<Surface>>,
	event_tx: Option<Sender<VncThreadMessageInput>>,
	event_rx: Option<Receiver<VncThreadMessageOutput>>, //js_event_cb: napi::JsFunction,
}

// hack
unsafe impl Sync for JsClient {}

#[napi(object)]
pub struct JsRectEvent {
	pub event: String, // "rects"
	pub rects: Vec<Rect>,
}

#[napi]
impl JsClient {
	#[napi(constructor)]
	pub fn new() -> Self {
		Self {
			surf: Arc::new(Mutex::new(Surface::new())),
			event_tx: None,
			event_rx: None,
		}
	}

	/// call once on resize and discard on a new resize
	#[napi]
	pub fn get_surface_buffer(&self, nenv: Env) -> napi::Result<JsBuffer> {
		let mut surf = self.surf.lock().expect("fuck");
		let buffer = unsafe {
			let b = surf.get_buffer();
			nenv.create_buffer_with_borrowed_data(
				b.as_mut_ptr() as *mut u8,
				b.len() * core::mem::size_of::<u32>(),
				(),
				napi::noop_finalize,
			)
			.expect("fail")
		};

		Ok(buffer.into_raw())
	}

	#[napi]
	pub async fn send_mouse(&self, x: u32, y: u32, buttons: u8) -> napi::Result<()> {
		if let Some(tx) = self.event_tx.as_ref() {
			let _ = tx
				.send(VncThreadMessageInput::MouseEvent {
					pt: Point { x, y },
					buttons: buttons,
				})
				.await;
		}
		Ok(())
	}

	#[napi]
	pub fn disconnect(&mut self) -> napi::Result<()> {
		// This will drop the tx side of the VNC engine input,
		// which will make it close the connection
		self.event_tx = None;
		self.event_rx = None;
		Ok(())
	}

	#[napi]
	pub fn poll_event(&mut self, env: Env) -> napi::Result<JsObject> {
		let mut obj = env.create_object()?;

		if let Some(rx) = self.event_rx.as_mut() {
			match rx.try_recv() {
				Ok(val) => match val {
					VncThreadMessageOutput::Connect => {
						obj.set("event", "connect")?;

						return Ok(obj);
					}

					VncThreadMessageOutput::Disconnect => {
						obj.set("event", "disconnect")?;

						return Ok(obj);
					}

					VncThreadMessageOutput::FramebufferResized(size) => {
						obj.set("event", "resize")?;
						obj.set("size", size)?;

						return Ok(obj);
					}

					VncThreadMessageOutput::FramebufferUpdate(rects) => {
						obj.set("event", "rects")?;
						obj.set("rects", rects)?;

						return Ok(obj);
					}
				},

				Err(TryRecvError::Empty) => {
					return Ok(obj);
				}

				Err(TryRecvError::Disconnected) => {
					return Err(anyhow::anyhow!("disconnected..").into());
				}
			}
		} else {
			Err(anyhow::anyhow!("????").into())
		}
	}

	#[napi]
	pub fn connect(&mut self, addr: String) -> napi::Result<()> {
		let (engine_output_tx, engine_output_rx) = channel(32);
		let (engine_input_tx, engine_input_rx) = channel(32);

		let mut address: Option<client::Address> = None;


		self.event_tx = Some(engine_input_tx);
		self.event_rx = Some(engine_output_rx);

		// address parsing bullfuckery
		if addr.as_str().starts_with('/') {
			address = Some(client::Address::Unix(std::path::PathBuf::from(addr)));
		} else {
			// TODO hostname support.
			address = Some(client::Address::Tcp(addr.parse().expect("parse fail")));
		}

		// clone surface
		let surf_client_thread_clone = Arc::clone(&self.surf);

		// start the VNC engine thread
		let _ = std::thread::Builder::new()
			.name("vnc-engine".into())
			.spawn(move || {
				let tx_clone = engine_output_tx.clone();
				let mut client =
					Client::new(engine_output_tx, engine_input_rx, surf_client_thread_clone);

				// connect first. if this doesn't work we end the thread early and send a disconnect message to make that clear
				// to the async thread
				if client.connect(address.unwrap()) == false {
					let _ = tx_clone.blocking_send(VncThreadMessageOutput::Disconnect);
					return ();
				}

				loop {
					if client.run_one() == false {
						break;
					}
					// TODO: sleep here for an extended duration?
				}

				let _ = tx_clone.blocking_send(VncThreadMessageOutput::Disconnect);
			});


		return Ok(());
	}
}
