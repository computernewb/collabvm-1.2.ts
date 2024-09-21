use super::{
	client::{self, *},
	surface::Surface,
	types::*,
};

use neon::{prelude::*, types::buffer::TypedArray};

use std::cell::RefCell;
use std::sync::{Arc, Mutex};

use tokio::net;
use tokio::sync::mpsc::{channel, error::TryRecvError, Receiver, Sender};

pub struct JsClient {
	surf: Arc<Mutex<Surface>>,
	event_tx: Option<Sender<VncThreadMessageInput>>,
	event_rx: Option<Receiver<VncThreadMessageOutput>>,
}

impl JsClient {
	pub fn new() -> Self {
		Self {
			surf: Arc::new(Mutex::new(Surface::new())),
			event_tx: None,
			event_rx: None,
		}
	}

	pub fn send_mouse(&self, x: u32, y: u32, buttons: u8) -> NeonResult<()> {
		if let Some(tx) = self.event_tx.as_ref() {
			let _ = tx.blocking_send(VncThreadMessageInput::MouseEvent {
				pt: Point { x, y },
				buttons: buttons,
			});
		}
		Ok(())
	}

	pub fn send_key(&self, keysym: u32, pressed: bool) -> NeonResult<()> {
		if let Some(tx) = self.event_tx.as_ref() {
			let _ = tx.blocking_send(VncThreadMessageInput::KeyEvent { keysym, pressed });
		}
		Ok(())
	}

	pub fn thumbnail(&self) -> NeonResult<()> {
		if let Some(tx) = self.event_tx.as_ref() {
			let _ = tx.blocking_send(VncThreadMessageInput::Thumbnail);
		}
		Ok(())
	}

	pub fn full_screen(&self) -> NeonResult<()> {
		if let Some(tx) = self.event_tx.as_ref() {
			let _ = tx.blocking_send(VncThreadMessageInput::FullScreen);
		}
		Ok(())
	}

	pub fn disconnect(&self) -> NeonResult<()> {
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

	pub fn poll_event<'a>(&mut self, mut cx: FunctionContext<'a>) -> JsResult<'a, JsObject> {
		if let Some(rx) = self.event_rx.as_mut() {
			let obj = cx.empty_object();

			match rx.try_recv() {
				Ok(val) => match val {
					VncThreadMessageOutput::Connect => {
						let event = cx.string("connect");
						obj.set(&mut cx, "event", event)?;
					}

					VncThreadMessageOutput::Disconnect => {
						let event = cx.string("disconnect");
						obj.set(&mut cx, "event", event)?;
						self.reset_channels();
					}

					VncThreadMessageOutput::FramebufferResized(size) => {
						let size_obj = cx.empty_object();
						let size_width = cx.number(size.width);
						let size_height = cx.number(size.height);
						size_obj.set(&mut cx, "width", size_width)?;
						size_obj.set(&mut cx, "height", size_height)?;

						let event = cx.string("resize");

						obj.set(&mut cx, "event", event)?;
						obj.set(&mut cx, "size", size_obj)?;
					}

					VncThreadMessageOutput::FramebufferUpdate(rects) => {
						let arr = cx.empty_array();

						// TODO: Make this not clone as much (or really at all)
						for i in 0..rects.len() {
							let rect_obj = cx.empty_object();

							let rect_inner_rect_obj = cx.empty_object();
							let rect_x = cx.number(rects[i].rect.x);
							let rect_y = cx.number(rects[i].rect.y);
							let rect_width = cx.number(rects[i].rect.width);
							let rect_height = cx.number(rects[i].rect.height);
							rect_inner_rect_obj.set(&mut cx, "x", rect_x)?;
							rect_inner_rect_obj.set(&mut cx, "y", rect_y)?;
							rect_inner_rect_obj.set(&mut cx, "width", rect_width)?;
							rect_inner_rect_obj.set(&mut cx, "height", rect_height)?;

							// clone rect data into a node buffer
							let mut rect_data_buffer = cx.buffer(rects[i].data.len())?;
							rect_data_buffer
								.as_mut_slice(&mut cx)
								.copy_from_slice(&rects[i].data[..]);

							rect_obj.set(&mut cx, "rect", rect_inner_rect_obj)?;
							rect_obj.set(&mut cx, "data", rect_data_buffer)?;
							arr.set(&mut cx, i as u32, rect_obj)?;
						}

						let event = cx.string("rects");
						obj.set(&mut cx, "event", event)?;
						obj.set(&mut cx, "rects", arr)?;
					}

					VncThreadMessageOutput::ThumbnailProcessed(p) => {
						let event = cx.string("thumbnail");
						obj.set(&mut cx, "event", event)?;

						// copy into node buffer :)
						let mut buffer = cx.buffer(p.len())?;
						buffer.as_mut_slice(&mut cx).copy_from_slice(&p[..]);
						obj.set(&mut cx, "data", buffer)?;
					}

					VncThreadMessageOutput::FullScreenProcessed(p) => {
						let event = cx.string("screen");
						obj.set(&mut cx, "event", event)?;

						let mut buffer = cx.buffer(p.len())?;
						buffer.as_mut_slice(&mut cx).copy_from_slice(&p[..]);
						obj.set(&mut cx, "data", buffer)?;
					}
				},

				Err(TryRecvError::Empty) => {}

				Err(TryRecvError::Disconnected) => {
					//return Ok(cx.empty_object());
					//return Err(anyhow::anyhow!("Channel is disconnected").into());
					return cx.throw_error("No VNC engine is running for this client");
				}
			}

			Ok(obj)
		} else {
			return cx.throw_error("No VNC engine is running for this client");
		}
	}

	pub fn set_jpeg_quality<'a>(
		&mut self,
		mut cx: FunctionContext<'a>,
	) -> JsResult<'a, JsUndefined> {
		if let Some(tx) = self.event_tx.as_mut() {
			let jpeg_quality = cx.argument::<JsNumber>(1)?.value(&mut cx) as u32;
			let _ = tx.blocking_send(VncThreadMessageInput::SetJpegQuality(jpeg_quality));
			Ok(cx.undefined())
		} else {
			cx.throw_error("No VNC engine is running for this client")
		}
	}

	pub fn connect(&mut self, addr: String) -> NeonResult<()> {
		// Channels used to communicate between JS and the VNC thread
		let (engine_output_tx, engine_output_rx) = channel(32);
		let (engine_input_tx, engine_input_rx) = channel(16);

		self.reset_channels();

		self.event_tx = Some(engine_input_tx);
		self.event_rx = Some(engine_output_rx);

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

				// address parsing:
				// if the path starts with / then it's assumed to be a Unix domain socket.
				// otherwise it's assumed to be a TCP host, either a DNS name or IP address.
				//
				// We use the first record returned by DNS which probably isn't a good idea but
				// it works I guess
				let mut address: Option<client::Address> = None;

				rt.block_on(async {
					if addr.as_str().starts_with('/') {
						address = Some(client::Address::Unix(std::path::PathBuf::from(addr)));
					} else {
						let mut names = net::lookup_host(&addr).await.expect("DNS failure");

						let addr = names.next().unwrap_or_else(|| {
							(&addr).parse().expect("Failed to parse SocketAddr")
						});

						address = Some(client::Address::Tcp(addr));
					}
				});

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

// JavaScript (Neon) bindings

// JsClient does not store any reference to JavaScript owned objects
// therefore the default impl of [Finalize::finalize] is good enough.
impl Finalize for JsClient {}

type BoxedClient = JsBox<RefCell<JsClient>>;

fn vnc_new(mut cx: FunctionContext) -> JsResult<BoxedClient> {
	let client = RefCell::new(JsClient::new());
	Ok(cx.boxed(client))
}

fn vnc_connect(mut cx: FunctionContext) -> JsResult<JsUndefined> {
	let client = &**cx.argument::<BoxedClient>(0)?;

	let addr = cx.argument::<JsString>(1)?;

	client.borrow_mut().connect(addr.value(&mut cx))?;

	Ok(cx.undefined())
}

fn vnc_poll_event(mut cx: FunctionContext) -> JsResult<JsObject> {
	let client = &**cx.argument::<BoxedClient>(0)?;
	let ev = client.borrow_mut().poll_event(cx)?;
	Ok(ev)
}

fn vnc_send_key(mut cx: FunctionContext) -> JsResult<JsUndefined> {
	let client = &**cx.argument::<BoxedClient>(0)?;

	let keysym = cx.argument::<JsNumber>(1)?.value(&mut cx) as u32;
	let pressed = cx.argument::<JsBoolean>(2)?.value(&mut cx);

	client.borrow().send_key(keysym, pressed)?;

	Ok(cx.undefined())
}

fn vnc_send_mouse(mut cx: FunctionContext) -> JsResult<JsUndefined> {
	let client = &**cx.argument::<BoxedClient>(0)?;

	let x = cx.argument::<JsNumber>(1)?.value(&mut cx) as u32;
	let y = cx.argument::<JsNumber>(2)?.value(&mut cx) as u32;
	let buttons = cx.argument::<JsNumber>(3)?.value(&mut cx) as u8;

	client.borrow().send_mouse(x, y, buttons)?;

	Ok(cx.undefined())
}

fn vnc_disconnect(mut cx: FunctionContext) -> JsResult<JsUndefined> {
	let client = &**cx.argument::<BoxedClient>(0)?;
	client.borrow().disconnect()?;

	Ok(cx.undefined())
}

fn vnc_thumbnail(mut cx: FunctionContext) -> JsResult<JsUndefined> {
	let client = &**cx.argument::<BoxedClient>(0)?;
	client.borrow().thumbnail()?;

	Ok(cx.undefined())
}

fn vnc_full_screen(mut cx: FunctionContext) -> JsResult<JsUndefined> {
	let client = &**cx.argument::<BoxedClient>(0)?;
	client.borrow().full_screen()?;

	Ok(cx.undefined())
}

fn vnc_set_jpeg_quality(mut cx: FunctionContext) -> JsResult<JsUndefined> {
	let client = &**cx.argument::<BoxedClient>(0)?;
	let res = client.borrow_mut().set_jpeg_quality(cx);
	res
}

/// binds the VNC engine to rust
pub fn export(cx: &mut ModuleContext) -> NeonResult<()> {
	cx.export_function("vncNew", vnc_new)?;
	cx.export_function("vncConnect", vnc_connect)?;
	cx.export_function("vncPollEvent", vnc_poll_event)?;
	cx.export_function("vncSendKey", vnc_send_key)?;
	cx.export_function("vncSendMouse", vnc_send_mouse)?;
	cx.export_function("vncThumbnail", vnc_thumbnail)?;
	cx.export_function("vncFullScreen", vnc_full_screen)?;
	cx.export_function("vncSetJPEGQuality", vnc_set_jpeg_quality)?;
	cx.export_function("vncDisconnect", vnc_disconnect)?;
	Ok(())
}
