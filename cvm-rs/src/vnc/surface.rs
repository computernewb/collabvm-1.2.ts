//! A rewrite of CollabVM 3.0's Surface primitive in Rust.
//! Note that thread safety has been removed from this implementation,
//! since Rust chooses a different type-based model for thread safety
//! that the implicit thread-safety surfaces used previously just wouldn't
//! be very well with.

use super::types::*;

/// A BGRA-format surface.
pub struct Surface {
	buffer: Vec<u32>,
	pub size: Size,
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
		self.size = size;
		self.buffer.resize(self.size.linear(), 0);
	}

	pub fn get_buffer(&mut self) -> &mut Vec<u32> {
		&mut self.buffer
	}

	/// Blits a buffer to this surface.
	pub fn blit_buffer(&mut self, src_at: Rect, data: &[u32]) {
		let mut off = 0;

		for y in src_at.y..src_at.y + src_at.height {
			let src = &data[off..off + src_at.width as usize];
			let dest_start_offset = (y as usize * self.size.width as usize) + src_at.x as usize;

			let dest =
				&mut self.buffer[dest_start_offset..dest_start_offset + src_at.width as usize];

			// This forces alpha to always be 0xff. I *could* probably do this in a clearer way though :(
			for (dest, src_item) in dest.iter_mut().zip(src.iter()) {
				*dest = ((*src_item) & 0x00ffffff) | 0xff000000;
			}

			off += src_at.width as usize;
		}
	}

}
