//! A rewrite of CollabVM 3.0's Surface (and other) primitives in Rust.
//! Note that thread safety has been removed from this implementation,
//! since Rust chooses a different type-based model for thread safety
//! that the implicit thread-safety surfaces used previously just wouldn't
//! be very well with.

use napi::Env;
use napi_derive::napi;

// These types should be in another shared module :(

#[napi(object)]
#[derive(Clone, Debug)]
pub struct Rect {
	pub x: u32,
	pub y: u32,
	pub width: u32,
	pub height: u32,
}

impl Rect {
	/// Check whether or not the given rect can safely fit inside this one.
	pub fn includes(&self, other: &Rect) -> bool {
		let width_inclusive = self.x <= other.x && (self.x + self.width) >= (other.x + other.width);
		let height_inclusive =
			self.y <= other.y && (self.y + self.height) >= (other.y + other.height);

		width_inclusive && height_inclusive
	}
}

#[napi(object)]
#[derive(Debug)]
pub struct Point {
	pub x: u32,
	pub y: u32,
}

#[napi(object)]
#[derive(Clone, Debug)]
pub struct Size {
	pub width: u32,
	pub height: u32,
}

impl Size {
	/// Returns the linear size.
	pub fn linear(&self) -> napi::Result<usize> {
		Ok((self.width * self.height) as usize)
	}
}

pub struct Surface {
	buffer: Vec<u32>,
	size: Size,
}

impl Surface {
	pub fn new() -> Self {
		Self {
			buffer: Vec::new(),
			size: Size {
				width: 0,
				height: 0,
			},
		}
	}

	pub fn resize(&mut self, size: Size) {
		self.buffer.resize(size.linear().expect("never fails"), 0);
		self.size = size;
	}

	pub fn get_buffer(&mut self) -> &mut Vec<u32> {
		&mut self.buffer
	}
	/* 

	/// Blits a buffer to this surface.
	pub fn blit_buffer(&mut self, src_at: Rect, data: &[u32]) {
		let mut off = 0;

		/*

		for(usize i = ((srcAt.x) + (srcAt.y * size.width)); i < (srcAt.y + srcAt.height) * size.width; i += size.width) {
			memcpy(this->pixelData.get() + i, src_buffer, srcAt.width * sizeof(Pixel));
			src_buffer += srcAt.width;
		}
		 */

		let start = ((src_at.y * self.size.width) + src_at.x);
		let end = (src_at.y + src_at.height) * self.size.width;

		for i in (start..end).step_by(self.size.width as usize) {
			let src = &data[off as usize..(off + src_at.width) as usize];
			let dest = &mut self.buffer[i as usize..(i + self.size.width) as usize];

			for (dest_ref, src_data) in dest.iter_mut().zip(src.iter()) {
				*dest_ref = *src_data;
			}

			off += src_at.width;
		}
	}

	/// Returns a cloned surface containing a portion of this surface.
	pub fn sub_surface(&self, at: Rect) -> Surface {
		let rect = Rect {
			x: 0,
			y: 0,
			width: self.size.width,
			height: self.size.height,
		};

		assert!(
			rect.includes(&at).expect("never fails"),
			"Surface::sub_surface() must be given a rectangle that can fit in {}x{} (got {}x{})",
			rect.width,
			rect.height,
			at.width,
			at.height
		);

		let mut surf = Surface::new();
		surf.resize(Size {
			width: at.width,
			height: at.height,
		});

		for y in 0..at.height {
			let src_line_off = y * self.size.width;
			let dest_line_off = y * at.width;

			// copy the data from us
			for x in 0..at.width {
				surf.buffer[(dest_line_off + x) as usize] = self.buffer[(src_line_off + x) as usize]
			}
		}

		surf
	}
	*/
}