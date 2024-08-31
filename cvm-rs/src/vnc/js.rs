use super::{
	client::{self, *},
	surface::Surface,
	types::*,
};
use napi::{Env, JsObject};
use napi_derive::napi;

use std::sync::{Arc, Mutex};

use tokio::sync::mpsc::{channel, error::TryRecvError, Receiver, Sender};

#[napi(js_name = "ClientInnerImpl")]
pub struct JsClient {
	surf: Arc<Mutex<Surface>>,
	event_tx: Option<Sender<VncThreadMessageInput>>,
	event_rx: Option<Receiver<VncThreadMessageOutput>>,
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
	pub async fn send_key(&self, keysym: u32, pressed: bool) -> napi::Result<()> {
		if let Some(tx) = self.event_tx.as_ref() {
			let _ = tx
				.send(VncThreadMessageInput::KeyEvent { keysym, pressed })
				.await;
		}
		Ok(())
	}

	#[napi]
	pub async fn thumbnail(&self) -> napi::Result<()> {
		if let Some(tx) = self.event_tx.as_ref() {
			let _ = tx.send(VncThreadMessageInput::Thumbnail).await;
		}
		Ok(())
	}

	#[napi]
	pub async fn full_screen(&self) -> napi::Result<()> {
		if let Some(tx) = self.event_tx.as_ref() {
			let _ = tx.send(VncThreadMessageInput::FullScreen).await;
		}
		Ok(())
	}

	#[napi]
	pub fn disconnect(&mut self) -> napi::Result<()> {
		if let Some(tx) = self.event_tx.as_ref() {
			let _ = tx.blocking_send(VncThreadMessageInput::Disconnect);
		}
		Ok(())
	}

	fn reset_channels(&mut self) {
		// Destroy the channels after we recieve this
		self.event_tx = None;
		self.event_rx = None;
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

						self.reset_channels();

						return Ok(obj);
					}

					VncThreadMessageOutput::FramebufferResized(size) => {
						obj.set("event", "resize")?;
						obj.set("size", size)?;

						return Ok(obj);
					}

					VncThreadMessageOutput::FramebufferUpdate(rects) => {
						let mut arr = env.create_array(rects.len() as u32)?;

						// TODO: Make this not clone as much (or really at all)
						for i in 0..rects.len() {
							let mut rect_obj = env.create_object()?;
							rect_obj.set("rect", rects[i].rect.clone())?;
							rect_obj.set(
								"data",
								env.create_buffer_with_data(rects[i].data.clone())?
									.into_raw(),
							)?;
							arr.set(i as u32, rect_obj)?;
						}

						obj.set("event", "rects")?;
						obj.set("rects", arr)?;

						return Ok(obj);
					}

					VncThreadMessageOutput::ThumbnailProcessed(p) => {
						obj.set("event", "thumbnail")?;
						obj.set("data", env.create_buffer_with_data(p)?.into_raw())?;

						return Ok(obj);
					}

					VncThreadMessageOutput::FullScreenProcessed(p) => {
						obj.set("event", "screen")?;
						obj.set("data", env.create_buffer_with_data(p)?.into_raw())?;

						return Ok(obj);
					}
				},

				Err(TryRecvError::Empty) => {
					return Ok(obj);
				}

				Err(TryRecvError::Disconnected) => {
					return Ok(obj);
					//return Err(anyhow::anyhow!("Channel is disconnected").into());
				}
			}
		} else {
			Err(anyhow::anyhow!("No VNC engine is running for this client").into())
		}
	}

	#[napi]
	pub fn connect(&mut self, addr: String) -> napi::Result<()> {
		let (engine_output_tx, engine_output_rx) = channel(32);
		let (engine_input_tx, engine_input_rx) = channel(16);

		// It is used but I guess something is mad
		#[allow(unused_assignments)]
		let mut address: Option<client::Address> = None;

		self.reset_channels();

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
			.name("cvmrs-vnc-work".into())
			.spawn(move || {
				// Create a single-thread tokio runtime specifically for the VNC engine
				let rt = tokio::runtime::Builder::new_current_thread()
					.enable_all()
					.build()
					.unwrap();

				// Create the VNC engine itself
				let tx_clone = engine_output_tx.clone();
				let mut client =
					Client::new(engine_output_tx, engine_input_rx, surf_client_thread_clone);

				// run the VNC engine on the Tokio runtime
				let _ = rt.block_on(async {
					// Connect to the VNC server. This runs the main loop
					match client.connect_and_run(address.unwrap()).await {
						Ok(_) => {
							// No error occured
						}

						Err(e) => {
							// TODO: Marshal to javascript the error
							//println!("Error {:?}", e);
							let _ = tx_clone.send(VncThreadMessageOutput::Disconnect).await?;
							return Err(e);
						}
					}

					Ok(())
				});
			});

		return Ok(());
	}
}
