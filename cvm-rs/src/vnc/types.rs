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
	/// Batch a set of rectangles into a larger area, which is split into at least
	/// 4 (currently) seperate rectangles (whos area ultimately adds up to the same).
	pub fn batch_set(rects: &mut Vec<Self>) {
		// This rect contains the overall area. It is split into pieces later.
		let mut batched_rect = Rect {
			x: 0,
			y: 0,
			width: 0,
			height: 0,
		};

		// Don't batch. Maybe split these too?
		if rects.len() == 1 {
			//let r = rects[0].clone();
			//Self::split_into(&r, 4, rects);
			return ();
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

		Self::split_into(&batched_rect, 4, rects);
	}

	/// Splits a input rectangle into multiple which will
	/// add into the same space as the input.
	pub fn split_into(rect: &Self, depth: u32, output: &mut Vec<Self>) {
		//println!("batched rect: {:?}", rect);

		output.clear();

		let columns = ((depth as f32).sqrt()).ceil() as u32;

		let rows = depth / columns;
		let nr_orphans = depth % columns;

		let width = rect.width / columns;
		let height = rect.height / if nr_orphans == 0 { rows } else { rows + 1 };

		for y in 0..rows {
			for x in 0..columns {
				let splat = Self {
					x: x * width,
					y: y * height,
					width: width,
					height: height,
				};
				output.push(splat);
			}
		}

		if nr_orphans > 0 {
			let orphan_width = rect.width / nr_orphans;

			for x in 0..nr_orphans {
				// don't think this is entirely correct,
				// because it causes some graphical glitches
				let splat = Self {
					x: x * orphan_width,
					y: rows * height,
					width: orphan_width,
					height: height,
				};
				output.push(splat);
			}
		}

		// doesn't work properly, but it looks cool
		/*

		let mut rect_x = rect.x / depth;
		let mut rect_y = rect.y / depth;

		if rect_x == 0 {
			rect_x = (rect.width / depth);
		}

		if rect_y == 0 {
			rect_y = (rect.height / depth);
		}

		for i in 0..depth {
			let splat = Self {
				x: rect_x * i,
				y: rect_y * i,
				width: (rect.width / depth),
				height: (rect.height / depth),
			};

			output.push(splat);
		}
		*/

		//println!("out: {:?}", output);
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
