//! A rewrite of CollabVM 3.0's Surface primitive in Rust.
//! Note that thread safety has been removed from this implementation,
//! since Rust chooses a different type-based model for thread safety
//! that the implicit thread-safety surfaces used previously just wouldn't
//! be very well with.

use super::types::*;
use std::alloc;

/// Allocates a boxed slice. 
/// Unlike a [Vec<_>], this can't grow,
/// but is just as safe to use, and slightly more predictable.
// TODO: Stick in a util module?
pub fn alloc_boxed_slice<T: Sized>(len: usize) -> Box<[T]> {
    assert_ne!(len, 0, "length cannot be 0");
    let layout = alloc::Layout::array::<T>(len).expect("?");

    let ptr = unsafe { alloc::alloc_zeroed(layout) as *mut T };

    let slice = core::ptr::slice_from_raw_parts_mut(ptr, len);

    unsafe { Box::from_raw(slice) }
}

/// A BGRA-format surface.
pub struct Surface {
    buffer: Option<Box<[u32]>>,
    pub size: Size,
}

impl Surface {
    pub fn new() -> Self {
        Self {
            buffer: None,
            size: Size {
                width: 0,
                height: 0,
            },
        }
    }

    pub fn resize(&mut self, size: Size) {
        self.size = size;
        
		self.buffer = Some(alloc_boxed_slice(self.size.linear()));
    }

    pub fn get_buffer(&mut self) -> &mut [u32] {
        let buf = self.buffer.as_mut().unwrap();
        &mut *buf
    }

    /// Blits a buffer to this surface.
    pub fn blit_buffer(&mut self, src_at: Rect, data: &[u32]) {
        let mut off = 0;

		let buf = self.buffer.as_mut().unwrap();
		let buf_slice = &mut *buf;

        for y in src_at.y..src_at.y + src_at.height {
            let src = &data[off..off + src_at.width as usize];
            let dest_start_offset = (y as usize * self.size.width as usize) + src_at.x as usize;

            let dest =
                &mut buf_slice[dest_start_offset..dest_start_offset + src_at.width as usize];

            // This forces alpha to always be 0xff. I *could* probably do this in a clearer way though :(
            for (dest, src_item) in dest.iter_mut().zip(src.iter()) {
                *dest = ((*src_item) & 0x00ffffff) | 0xff000000;
            }

            off += src_at.width as usize;
        }
    }
}
