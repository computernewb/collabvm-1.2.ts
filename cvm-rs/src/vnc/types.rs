//! Shared types.

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
	/// Returns the area of the rect in pixels.
	//pub fn area(&self) -> usize {
	// a = wl
	//	(self.width * self.height) as usize
	//}

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

		// Don't batch.
		if rects.len() == 1 {
			//let r = rects[0].clone();

			// Split rects that have a large enough area
			// (currently, at least 240 * 240)
			// This introduces graphical glitches so I'm disabling it for now
			//if r.area() >= 57600 {
			//	println!("splitting {:?}, its area is {}", r, r.area());
			//	Self::split_into(&r, 2, rects);
			//}

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

		rects.clear();
		rects.push(batched_rect);

		//Self::split_into(&batched_rect, 4, rects);
	}

	/// Splits a input rectangle into multiple which will add into the same area as the input.
	/// The provided split amount **MUST** be a power of 2.
	#[allow(unused)] // Needs a lot of refinement
	pub fn split_into(input_rect: &Self, split_amount: u32, output: &mut Vec<Self>) {
		debug_assert!(
			split_amount.is_power_of_two(),
			"input split_amount {} is not pow2",
			split_amount
		);

		println!("in: {:?}", input_rect);

		output.clear();

		let columns = ((split_amount as f32).sqrt()).ceil() as u32;

		let rows = split_amount / columns;
		let width = input_rect.width / (rows*columns);
		// This is a total bodge but it seemingly works.
		let height = (input_rect.height / (rows * columns)) + 1;

		println!("rows {}, columns {}, {}x{}", columns, rows, width, height);

		for y in 0..rows {
			for x in 0..columns {
				let splat = Self {
					x: x * width,
					y: y * height,
					width: width / if x == 0 { 1 } else { x },
					height: height / if y == 0 { 1 } else { y },
				};
				output.push(splat);
			}
		}

		println!("out: {:?}", output);
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
