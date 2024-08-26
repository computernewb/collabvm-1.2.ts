//! this hacky pile of hacks is brought to you by lily

use super::surface::{Point, Rect, Size, Surface};

use std::{
	ops::Add,
	sync::{Arc, Mutex},
};

use tokio::sync::mpsc::{channel, error::TryRecvError, Receiver, Sender};

use libvnc_sys::rfb::bindings as vnc;

pub enum Address {
	Tcp(std::net::SocketAddr),
	Unix(std::path::PathBuf),
}

/// Output message
#[derive(Debug)]
pub enum VncThreadMessageOutput {
	Disconnect,
	FramebufferUpdate(Vec<Rect>),
	FramebufferResized(Size),
}

#[derive(Debug)]
pub enum VncThreadMessageInput {
	KeyEvent { keysym: u32, pressed: bool },

	MouseEvent { pt: Point, buttons: u8 },
}

pub struct Client {
	surf: Arc<Mutex<Surface>>,
	vnc: *mut vnc::rfbClient,
	out_tx: Sender<VncThreadMessageOutput>,
	in_rx: Receiver<VncThreadMessageInput>,
	rects_in_frame: Vec<Rect>,
}

/// Our userdata tag. Try and guess what this says as a fourcc :)
const VNC_TAG: u32 = 0x796C694C;

#[repr(i8)]
enum RfbBool {
	False = vnc::FALSE as i8,
	True = vnc::TRUE as i8,
}

/// Initializes a RFB pixel format for CVM surfaces
fn init_rfb_pixel_format(pf: &mut vnc::rfbPixelFormat) {
	pf.bigEndian = 0;
	pf.bitsPerPixel = 32;
	pf.depth = 24;

	// Shift
	pf.redShift = 16;
	pf.greenShift = 8;
	pf.blueShift = 0;

	pf.redMax = 255;
	pf.greenMax = 255;
	pf.blueMax = 255;
}

impl Client {
	/// Creates a new VNC client.
	pub fn new(
		out_tx: Sender<VncThreadMessageOutput>,
		in_rx: Receiver<VncThreadMessageInput>,
		surface: Arc<Mutex<Surface>>,
	) -> Box<Self> {
		let vnc = Self::rfb_create_client();

		assert!(!vnc.is_null(), "client shouldn't be null!");

		let mut client_obj = Box::new(Self {
			surf: surface,
			vnc: vnc,
			out_tx,
			in_rx,
			rects_in_frame: Vec::new(),
		});

		// set client userdata ptr
		unsafe {
			let ptr: *mut Client = client_obj.as_mut();
			vnc::rfbClientSetClientData(
				vnc,
				VNC_TAG as *mut std::ffi::c_void,
				ptr as *mut std::ffi::c_void,
			);
		}

		client_obj
	}

	// TODO result
	pub fn connect(&mut self, address: Address) -> bool {
		// fake argv
		const FAKE_ARGC: usize = 1;

		let mut argc = FAKE_ARGC as i32;
		let mut argv: [*const std::ffi::c_char; FAKE_ARGC] =
			[b"CvmRsRFBClient\0".as_ptr() as *const i8];

		// do the thing!
		unsafe {
			// set the program name, mostly for vanity
			(*self.vnc).programName = b"CvmRsRFBClient\0".as_ptr() as *const i8;

			/*
			if vnc::rfbInitClient(self.vnc, &mut argc, std::mem::transmute(&mut argv))
				== RfbBool::False as i8
			{
				return false;
			}
			*/
			match address {
				Address::Tcp(addr) => {
					let str = std::ffi::CString::new(addr.ip().to_string()).expect("penis");
					return self.connect_impl(&str, Some(addr.port() as i32));
					/*
					if vnc::ConnectToRFBServer(self.vnc, str.as_ptr(), addr.port() as i32)
						== RfbBool::False as i8
					{
						return false;
					}
					*/
				}
				Address::Unix(uds) => {
					panic!("FUCKS YOU VNC NOT SUPORT UNX YET");
				}
			}
		}

		true
	}

	fn connect_impl(&mut self, addr: &std::ffi::CString, port: Option<i32>) -> bool {
		// Inspired by rfbInitConnection, however with some caveats
		// - repeater support is removed
		// - scale is removed
		//
		// I mostly wrote this because I don't want to deal with libvncclients world's most
		// shakiest ownership, and doing it the Real Way with rfbInitClient() makes you do exactly that
		unsafe {
			if vnc::ConnectToRFBServer(self.vnc, addr.as_ptr(), port.unwrap_or(0))
				== RfbBool::False as i8
			{
				return false;
			}

			if vnc::InitialiseRFBConnection(self.vnc) == RfbBool::False as i8 {
				return false;
			}

			(*self.vnc).width = (*self.vnc).si.framebufferWidth as i32;
			(*self.vnc).height = (*self.vnc).si.framebufferHeight as i32;

			// N.B: This should always be set by either libvncclient or user code so it is Fine
			// to expect it to always be a Some
			//
			// If it ever is *not* set, that more than likely indicates there is a bug in
			// either my code (the more likely option) or libvncclient.
			let malloc_frame_buffer = (*self.vnc).MallocFrameBuffer.unwrap();
			if malloc_frame_buffer(self.vnc) == RfbBool::False as i8 {
				return false;
			}

			let update_rect = &mut (*self.vnc).updateRect;

			if (*self.vnc).updateRect.x < 0 {
				update_rect.x = 0;
				update_rect.y = 0;
				update_rect.w = (*self.vnc).width;
				update_rect.h = (*self.vnc).height;
				(*self.vnc).isUpdateRectManagedByLib = RfbBool::True as i8;
			}

			if vnc::SetFormatAndEncodings(self.vnc) == RfbBool::False as i8 {
				return false;
			}

			if vnc::SendFramebufferUpdateRequest(
				self.vnc,
				update_rect.x,
				update_rect.y,
				update_rect.w,
				update_rect.h,
				RfbBool::False as i8,
			) == RfbBool::False as i8
			{
				return false;
			}

			return true;
		}
	}

	// Runs one loop.
	pub fn run_one(&mut self) -> bool {
		let mut done = false;

		loop {
			// Pull a event and act on it. If none are there, it's fine and we can just move on to
			// advancing the vnc client, but if the channel is closed, that means we are to disconnect
			//
			// Note that we do not timeout because the libvnc loop implicitly will sleep for us due
			// to calling select/poll.
			match self.in_rx.try_recv() {
				Ok(val) => match val {
					VncThreadMessageInput::KeyEvent { keysym, pressed } => {
						self.keyboard_event(keysym, pressed);
					}
					VncThreadMessageInput::MouseEvent { pt, buttons } => {
						self.mouse_event(pt, buttons);
					}
				},

				Err(TryRecvError::Empty) => {}

				// Close the connection
				Err(TryRecvError::Disconnected) => {
					self.cleanup();
					done = true;
					break;
				}
			}

			// Run the VNC client until there are no more messages
			unsafe {
				let res = vnc::WaitForMessage(self.vnc, 500);

				// TODO: return a Error and cleanup
				if res.is_negative() {
					done = true;
					break;
				}

				// No message in this time frame, break out
				// (WaitForMessage simply returns the result of select/poll,
				//	so we can reasonably assume that 0 means there was no activity yet)
				if res == 0 {
					break;
				}

				// 0/rfbBool false == failure to handle a message
				if vnc::HandleRFBServerMessage(self.vnc) == RfbBool::False as i8 {
					done = true;
					break;
				}
			}
		}

		if done {
			let _ = self
				.out_tx
				.blocking_send(VncThreadMessageOutput::Disconnect);
			return false;
		} else {
			// send current update state
			if !self.rects_in_frame.is_empty() {
				let _ = self
					.out_tx
					.blocking_send(VncThreadMessageOutput::FramebufferUpdate(
						self.rects_in_frame.clone(),
					));

				self.rects_in_frame.clear();
			}
		}

		true
	}

	// higher level stuff

	fn keyboard_event(&mut self, keysym: u32, pressed: bool) {
		unsafe {
			vnc::SendKeyEvent(
				self.vnc,
				keysym,
				if pressed {
					RfbBool::True as i8
				} else {
					RfbBool::False as i8
				},
			);
		}
	}

	fn mouse_event(&mut self, pt: Point, buttons: u8) {
		unsafe {
			vnc::SendPointerEvent(self.vnc, pt.x as i32, pt.y as i32, buttons as i32);
		}
	}

	fn malloc_frame_buffer(&mut self) {
		let size: Size = unsafe {
			let ptr = self.vnc;
			Size {
				width: (*ptr).width as u32,
				height: (*ptr).height as u32,
			}
		};

		let mut surf = self.surf.lock().expect("failed to lock");

		surf.resize(size.clone());

		unsafe {
			(*self.vnc).frameBuffer = surf.get_buffer().as_mut_ptr() as *mut u8;
		}

		let _ = self
			.out_tx
			.blocking_send(VncThreadMessageOutput::FramebufferResized(size));
	}

	fn framebuffer_update(&mut self, rect: Rect) {
		self.rects_in_frame.push(rect);
	}

	// libvnc hellscape

	/// creates a rfb client
	fn rfb_create_client() -> *mut vnc::rfbClient {
		unsafe {
			let client = vnc::rfbGetClient(8, 3, 4);

			(*client).MallocFrameBuffer = Some(Self::rfb_malloc_frame_buffer_cb);
			(*client).canHandleNewFBSize = RfbBool::True as i32;
			(*client).GotFrameBufferUpdate = Some(Self::rfb_framebuffer_update_cb);

			init_rfb_pixel_format(&mut (*client).format);

			client
		}
	}

	/// grabs the client pointer from libvnc client
	/// SAFETY: the client must have been initalized with [Self::rfb_create_client]
	unsafe fn rfb_get_client_ptr_from_libvnc(client_ptr: *mut vnc::rfbClient) -> *mut Client {
		vnc::rfbClientGetClientData(client_ptr, VNC_TAG as *mut std::ffi::c_void) as *mut Client
	}

	unsafe extern "C" fn rfb_framebuffer_update_cb(
		client_ptr: *mut vnc::rfbClient,
		x: i32,
		y: i32,
		w: i32,
		h: i32,
	) {
		let client = Self::rfb_get_client_ptr_from_libvnc(client_ptr);
		(*client).framebuffer_update(Rect {
			x: x as u32,
			y: y as u32,
			width: w as u32,
			height: h as u32,
		});
	}

	unsafe extern "C" fn rfb_malloc_frame_buffer_cb(
		client_ptr: *mut vnc::rfbClient,
	) -> vnc::rfbBool {
		unsafe {
			let client = Self::rfb_get_client_ptr_from_libvnc(client_ptr);
			(*client).malloc_frame_buffer();
			RfbBool::True as vnc::rfbBool
		}
	}

	pub fn cleanup(&mut self) {
		unsafe {
			println!("Client::cleanup() called");
			if self.vnc != std::ptr::null_mut() {
				// clean up the client
				vnc::rfbClientCleanup(self.vnc);
				self.vnc = std::ptr::null_mut();
			}
		}
	}
}

impl Drop for Client {
	fn drop(&mut self) {
		println!("Client drop()ed");
		self.cleanup();
	}
}
