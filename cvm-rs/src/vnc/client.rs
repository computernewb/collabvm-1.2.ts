//! this hacky pile of hacks is brought to you by lily

use super::surface::{Point, Rect, Size, Surface};

use std::{
	sync::{Arc, Mutex},
	time::Duration,
};

use tokio::{
	io::{AsyncRead, AsyncWrite},
	net::{TcpStream, UnixStream},
	sync::mpsc::{error::TryRecvError, Receiver, Sender},
};

use vnc::{
	ClientKeyEvent, ClientMouseEvent, PixelFormat, Rect as VncRect, VncConnector, VncEvent,
	X11Event,
};

pub enum Address {
	Tcp(std::net::SocketAddr),
	Unix(std::path::PathBuf),
}

/// Output message
#[derive(Debug)]
pub enum VncThreadMessageOutput {
	Connect,
	Disconnect,
	FramebufferUpdate(Vec<Rect>),
	FramebufferResized(Size),
}

#[derive(Debug)]
pub enum VncThreadMessageInput {
	KeyEvent { keysym: u32, pressed: bool },
	MouseEvent { pt: Point, buttons: u8 },
	Disconnect,
}

pub struct Client {
	surf: Arc<Mutex<Surface>>,

	out_tx: Sender<VncThreadMessageOutput>,
	in_rx: Receiver<VncThreadMessageInput>,
	rects_in_frame: Vec<Rect>,
}

impl Client {
	/// Creates a new VNC client.
	pub fn new(
		out_tx: Sender<VncThreadMessageOutput>,
		in_rx: Receiver<VncThreadMessageInput>,
		surface: Arc<Mutex<Surface>>,
	) -> Box<Self> {
		let client_obj = Box::new(Self {
			surf: surface,
			out_tx,
			in_rx,
			rects_in_frame: Vec::new(),
		});

		client_obj
	}

	pub async fn connect_and_run(&mut self, address: Address) -> anyhow::Result<()> {
		match address {
			Address::Tcp(addr) => {
				let stream = TcpStream::connect(addr).await?;
				self.connect_and_run_impl(stream).await?
			}
			Address::Unix(uds) => {
				let stream = UnixStream::connect(uds).await?;
				self.connect_and_run_impl(stream).await?
			}
		}

		Ok(())
	}

	async fn connect_and_run_impl<S>(&mut self, stream: S) -> anyhow::Result<()>
	where
		S: AsyncRead + AsyncWrite + Unpin + Send + Sync + 'static,
	{
		// the builder pattern should have stayed in java
		let vnc = VncConnector::new(stream)
			.set_auth_method(async move { Ok("".into()) })
			//.add_encoding(vnc::VncEncoding::Tight)
			//.add_encoding(vnc::VncEncoding::Zrle)
			//.add_encoding(vnc::VncEncoding::CopyRect)
			.add_encoding(vnc::VncEncoding::DesktopSizePseudo)
			.add_encoding(vnc::VncEncoding::Raw)
			.allow_shared(true)
			.set_pixel_format(PixelFormat::bgra())
			.build()?
			.try_start()
			.await?
			.finish()?;

		self.out_tx.send(VncThreadMessageOutput::Connect).await?;

		loop {
			// Pull a event and act on it. If none are there, it's fine and we can just move on to
			// advancing the vnc client, but if the channel is closed, that means we are to disconnect
			//
			// Note that we do not timeout because we will eventually wait for a event later
			// either way.
			match self.in_rx.try_recv() {
				Ok(val) => match val {
					VncThreadMessageInput::KeyEvent { keysym, pressed } => {
						vnc.input(X11Event::KeyEvent(ClientKeyEvent {
							keycode: keysym,
							down: pressed,
						}))
						.await?;
					}
					VncThreadMessageInput::MouseEvent { pt, buttons } => {
						vnc.input(X11Event::PointerEvent(ClientMouseEvent {
							position_x: pt.x as u16,
							position_y: pt.y as u16,
							bottons: buttons,
						}))
						.await?;
					}
					VncThreadMessageInput::Disconnect => break,
				},

				Err(TryRecvError::Empty) => {}

				// Close the connection
				Err(TryRecvError::Disconnected) => {
					println!("disconnected from rx");
					break;
				}
			}

			// pull events until there is no more event to pull

			match vnc.poll_event().await {
				Ok(Some(e)) => {
					// ...

					match e {
						VncEvent::SetResolution(res) => {
							{
								let mut lk = self.surf.lock().expect("FUCKer Gogle");
								lk.resize(Size {
									width: res.width as u32,
									height: res.height as u32,
								});
							}

							self.out_tx
								.send(VncThreadMessageOutput::FramebufferResized(Size {
									width: res.width as u32,
									height: res.height as u32,
								}))
								.await?;
						}

						VncEvent::Copy(dest_rect, src_rect) => {
							// TODO copy rect
						}

						VncEvent::RawImage(dest_rect, data) => {
							self.rects_in_frame.push(Rect::from(dest_rect));

							{
								let mut lk = self.surf.lock().expect("NO CHEESE");

								// blit onto the surface
								lk.blit_buffer(Rect::from(dest_rect), unsafe {
									std::slice::from_raw_parts(
										data.as_ptr() as *const u32,
										data.len() / core::mem::size_of::<u32>(),
									)
								});
							}
						}

						_ => {}
					}
				}

				// No events, so let's request some more and push what we got in the meantime
				Ok(None) => {
					vnc.input(X11Event::Refresh).await?;

					let batched = Rect::batch(&self.rects_in_frame);

					// send current update state
					if !self.rects_in_frame.is_empty() {
						self.out_tx
							.send(VncThreadMessageOutput::FramebufferUpdate(vec![batched]))
							.await?;

						self.rects_in_frame.clear();
					}
				}

				Err(e) => {
					break;
				}
			}

			// Sleep to give CPU time
			tokio::time::sleep(Duration::from_millis(2)).await;
		}

		// Disconnect if we exit. We don't care about errors in this path
		let _ = vnc.close().await;
		self.out_tx.send(VncThreadMessageOutput::Disconnect).await?;

		Ok(())
	}
}
