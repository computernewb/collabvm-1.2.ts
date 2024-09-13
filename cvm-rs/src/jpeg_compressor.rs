use turbojpeg_sys::*;

use crate::util;

pub struct Image<'a> {
	pub buffer: &'a [u8],
	pub width: u32,
	pub height: u32,
	pub stride: u32,
	pub format: TJPF,
}

pub struct JpegCompressor {
	handle: tjhandle,
	subsamp: TJSAMP,
	quality: u32,
}

unsafe impl Send for JpegCompressor {}

impl JpegCompressor {
	pub fn new() -> Self {
		unsafe {
			let init = Self {
				handle: tjInitCompress(),
				subsamp: TJSAMP_TJSAMP_422,
				quality: 95,
			};
			return init;
		}
	}

	pub fn set_quality(&mut self, quality: u32) {
		self.quality = quality;
	}

	pub fn set_subsamp(&mut self, samp: TJSAMP) {
		self.subsamp = samp;
	}

	pub fn compress_buffer<'a>(&self, image: &Image<'a>) -> anyhow::Result<Box<[u8]>> {
		unsafe {
			let size: usize =
				tjBufSize(image.width as i32, image.height as i32, self.subsamp) as usize;
			let mut vec = util::alloc_boxed_slice(size);

			let mut ptr: *mut u8 = vec.as_mut_ptr();
			let mut size: libc::c_ulong = 0;

			let res = tjCompress2(
				self.handle,
				image.buffer.as_ptr(),
				image.width as i32,
				image.stride as i32,
				image.height as i32,
				image.format,
				std::ptr::addr_of_mut!(ptr),
				std::ptr::addr_of_mut!(size),
				self.subsamp,
				self.quality as i32,
				(TJFLAG_NOREALLOC) as i32,
			);

			// TODO: Result sex so we can actually notify failure
			if res == -1 {
				let err_str = std::ffi::CStr::from_ptr(tjGetErrorStr2(self.handle));
				let code = tjGetErrorCode(self.handle);

				return Err(anyhow::anyhow!(
					"ERROR: {} (code {})",
					err_str.to_str()?,
					code
				));
			}

			// Not strictly needed, but truncate to the proper size
			// by copying into another buffer (the larger buffer will be allowed to drop)
			let mut copied = util::alloc_boxed_slice(size as usize);
			{
				let src = &vec[0..(size as usize)];
				let dst = &mut copied[0..(size as usize)];
				dst.copy_from_slice(src);
			}

			Ok(copied)
		}
	}
}

impl Drop for JpegCompressor {
	fn drop(&mut self) {
		unsafe {
			tjDestroy(self.handle);
		}
	}
}
