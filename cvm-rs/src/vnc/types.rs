//! Shared types
use napi_derive::napi;

#[napi(object)]
#[derive(Clone, Debug)]
pub struct Rect {
	pub x: u32,
	pub y: u32,
	pub width: u32,
	pub height: u32,
}

impl Rect {
	/// cvmts rect batcher
	pub fn batch(rects: &Vec<Self>) -> Self {
		let mut batched_rect = Rect {
			x: 0,
			y: 0,
			width: 0,
			height: 0,
		};

		if rects.len() == 1 {
			return rects[0].clone();
		}

		for rect in rects.into_iter() {
			if rect.x < batched_rect.x {
				batched_rect.x = rect.x;
			}
			if rect.y < batched_rect.y {
				batched_rect.y = rect.y;
			}
		}

		for rect in rects.into_iter() {
			if rect.height + rect.y - batched_rect.y > batched_rect.height {
				batched_rect.height = rect.height + rect.y - batched_rect.y;
			}
			if rect.width + rect.x - batched_rect.x > batched_rect.width {
				batched_rect.width = rect.width + rect.x - batched_rect.x;
			}
		}

		batched_rect
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
	pub fn linear(&self) -> usize {
		(self.width * self.height) as usize
	}
}
