//! Native-side VNC client. This is usually run in another OS thread.

use super::surface::Surface;
use super::types::*;

use resize::Pixel::RGBA8;
use resize::Type::Triangle;
use rgb::FromSlice;
//use rgb::RGBA8;

use std::{
	sync::{Arc, Mutex},
	time::Duration,
};

use tokio::{
	io::{AsyncRead, AsyncWrite},
	net::{TcpStream, UnixStream},
	sync::mpsc::{error::TryRecvError, Receiver, Sender},
};

use vnc::{ClientKeyEvent, ClientMouseEvent, PixelFormat, VncConnector, VncEvent, X11Event};

pub enum Address {
	Tcp(std::net::SocketAddr),
	Unix(std::path::PathBuf),
}

#[derive(Debug)]
pub struct RectWithJpegData {
	pub rect: Rect,
	pub data: Vec<u8>,
}

/// Output message
#[derive(Debug)]
pub enum VncThreadMessageOutput {
	Connect,
	Disconnect,
	FramebufferUpdate(Vec<RectWithJpegData>),
	FramebufferResized(Size),

	// these allow
	ThumbnailProcessed(Vec<u8>),
	FullScreenProcessed(Vec<u8>),
}

#[derive(Debug)]
pub enum VncThreadMessageInput {
	KeyEvent { keysym: u32, pressed: bool },
	MouseEvent { pt: Point, buttons: u8 },
	Disconnect,

	Thumbnail,
	FullScreen,
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

					VncThreadMessageInput::Thumbnail => {
						use crate::jpeg_js;

						let mut surf = self.surf.lock().expect("could not lock Surface");
						let surf_size = surf.size.clone();
						let surf_data = surf.get_buffer();

						// SAFETY: Slice invariants are still held.
						let surf_slice = unsafe {
							std::slice::from_raw_parts(
								surf_data.as_ptr() as *const u8,
								surf_data.len() * 4,
							)
						};

						const THUMB_WIDTH: u32 = 400;
						const THUMB_HEIGHT: u32 = 300;

						let mut new_data: Vec<u8> =
							vec![0; (THUMB_WIDTH * THUMB_HEIGHT) as usize * 4];

						let mut resizer = resize::new(
							surf_size.width as usize,
							surf_size.height as usize,
							THUMB_WIDTH as usize,
							THUMB_HEIGHT as usize,
							RGBA8,
							Triangle,
						)?;

						resizer.resize(surf_slice.as_rgba(), new_data.as_rgba_mut())?;

						let data = jpeg_js::jpeg_encode_rs(
							// SAFETY: Like above, slice invariants are still held,
							// and this does not allow access to uninitalized
							// heap memory that is not a part of the Vec.
							unsafe {
								std::slice::from_raw_parts(
									new_data.as_ptr() as *const u32,
									new_data.len() / 4,
								)
							},
							THUMB_WIDTH,
							THUMB_HEIGHT,
							THUMB_WIDTH,
						);

						self.out_tx
							.send(VncThreadMessageOutput::ThumbnailProcessed(data))
							.await?
					}

					VncThreadMessageInput::FullScreen => {
						use crate::jpeg_js;

						let mut surf = self.surf.lock().expect("could not lock Surface");
						let surf_size = surf.size.clone();
						let surf_data = surf.get_buffer();

						let data = jpeg_js::jpeg_encode_rs(
							&surf_data,
							surf_size.width,
							surf_size.height,
							surf_size.width,
						);

						self.out_tx
							.send(VncThreadMessageOutput::FullScreenProcessed(data))
							.await?;
					}
				},

				Err(TryRecvError::Empty) => {}

				// On disconnection from the client input channel
				// we just give up and disconnect early.
				Err(TryRecvError::Disconnected) => {
					break;
				}
			}

			// pull events until there is no more event to pull
			match vnc.poll_event().await {
				Ok(Some(e)) => {
					match e {
						VncEvent::SetResolution(res) => {
							{
								let mut lk = self.surf.lock().expect("couldn't lock Surface");
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

						// TODO: implement copyrect support in Surface
						//VncEvent::Copy(dest_rect, src_rect) => {
						// TODO copy rect
						//}
						VncEvent::RawImage(rects) => {
							let mut lk = self.surf.lock().expect("couldn't lock Surface");

							for rect in rects.iter() {
								let cvm_rect = Rect::from(rect.rect);

								// blit onto the surface
								lk.blit_buffer(cvm_rect.clone(), unsafe {
									std::slice::from_raw_parts(
										rect.data.as_ptr() as *const u32,
										rect.data.len() / core::mem::size_of::<u32>(),
									)
								});

								self.rects_in_frame.push(cvm_rect);
							}
						}

						_ => {}
					}
				}

				// No events, so let's request some more and push what we got in the meantime
				Ok(None) => {
					vnc.input(X11Event::Refresh).await?;

					if !self.rects_in_frame.is_empty() {
						Rect::batch_set(&mut self.rects_in_frame);

						// send current update state
						if !self.rects_in_frame.is_empty() {
							let mut surf = self.surf.lock().expect("could not lock Surface");
							let surf_size = surf.size.clone();
							let surf_data = surf.get_buffer();

							let mut new_rects = Vec::new();

							use crate::jpeg_js;
							for r in self.rects_in_frame.iter() {
								let src_offset = (r.y * surf_size.width + r.x) as usize;
								let src_rect = &surf_data[src_offset..];

								let data = jpeg_js::jpeg_encode_rs(
									src_rect,
									r.width,
									r.height,
									surf_size.width,
								);

								new_rects.push(RectWithJpegData {
									rect: r.clone(),
									data: data,
								});
							}

							self.out_tx
								.send(VncThreadMessageOutput::FramebufferUpdate(new_rects))
								.await?;

							self.rects_in_frame.clear();
						}
					}
				}

				// TODO: we might want to pass this to js at some point
				Err(_e) => {
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
