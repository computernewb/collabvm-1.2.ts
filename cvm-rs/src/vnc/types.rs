//! Shared types.

#[derive(Clone, Debug)]
pub struct Rect {
	pub x: u32,
	pub y: u32,
	pub width: u32,
	pub height: u32,
}

impl Rect {
	
	/// Batch a set of rectangles into a larger area.
	///
	/// TODO: This function should also split them into chunks
	/// for our encoding thread pool...
	pub fn batch_set(size: &Size, rects: &mut Vec<Self>) {
		// This rect contains the overall area.
		let mut batched_rect = Rect {
			x: size.width,
			y: size.height,
			width: 0,
			height: 0,
		};

		// Don't batch a single rect, just send it as is
		if rects.len() == 1 {
			return ();
		}

		for rect in rects.iter() {
			if rect.x < batched_rect.x {
				batched_rect.x = rect.x;
			}
			if rect.y < batched_rect.y {
				batched_rect.y = rect.y;
			}
		}

		for rect in rects.iter() {
			if rect.height + rect.y - batched_rect.y > batched_rect.height {
				batched_rect.height = rect.height + rect.y - batched_rect.y;
			}
			if rect.width + rect.x - batched_rect.x > batched_rect.width {
				batched_rect.width = rect.width + rect.x - batched_rect.x;
			}
		}

		rects.clear();
		rects.push(batched_rect);
	}

}

impl From<vnc::Rect> for Rect {
	fn from(value: vnc::Rect) -> Self {
		Self {
			x: value.x as u32,
			y: value.y as u32,
			width: value.width as u32,
			height: value.height as u32,
		}
	}
}

#[derive(Debug)]
pub struct Point {
	pub x: u32,
	pub y: u32,
}

#[derive(Clone, Debug)]
pub struct Size {
	pub width: u32,
	pub height: u32,
}

impl Size {
	/// Returns the linear size.
	pub fn linear(&self) -> usize {
		(self.width * self.height) as usize
	}
}
