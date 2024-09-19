//! Shared types.

#[derive(Clone, Debug)]
pub struct Rect {
	pub x: u32,
	pub y: u32,
	pub width: u32,
	pub height: u32,
}

impl Rect {
	/// Returns the area of the rect in pixels.
	pub fn area(&self) -> usize {
		// Area is a = wl
		(self.width * self.height) as usize
	}

	/// Returns a tuple containing the top-left point of the rectangle.
	pub fn top_left(&self) -> (u32, u32) {
		(self.x, self.y)
	}

	/// Returns a tuple containing the bottom-right point of the rectangle.
	pub fn bottom_right(&self) -> (u32, u32) {
		(self.x + self.width, self.y + self.height)
	}

	/// Returns a coordinate pair of the midpoint.
	pub fn midpoint(&self) -> (u32, u32) {
		let top_left_point = self.top_left();
		let bottom_right_point = self.bottom_right();

		// Add (tl.x + br.x) and (tl.y + br.y) together
		// then divide by 2 to get the midpoint
		let tmp = (
			top_left_point.0 + bottom_right_point.0,
			top_left_point.1 + bottom_right_point.1,
		);
		(tmp.0 / 2, tmp.1 / 2)
	}

	/// Union two rectangles. Produces a new rectangle.
	pub fn union(&self, other: &Self) -> Self {
		use std::cmp;
		let x1 = cmp::min(self.x, other.x);
		let x2 = cmp::max(self.x + self.width, other.x + other.width);
		let y1 = cmp::min(self.y, other.y);
		let y2 = cmp::max(self.y + self.height, other.y + other.height);


		let width = (x2 as i64 - x1 as i64);
		let height = (y2 as i64 - y1 as i64);

		Self {
			x: x1,
			y: y1,
			width: width as u32,
			height: height as u32,
		}
	}

	/// Returns the 2D [Euclidean distance](https://en.wikipedia.org/wiki/Euclidean_distance)
	/// between this rect and another one.
	pub fn euclidean_distance(&self, other: &Self) -> f32 {
		let q0 = (self.x as i64 - other.x as i64) as f32;
		let q1 = (self.y as i64 - other.y as i64) as f32;

		((q0 * q0) + (q1 * q1)).sqrt()
	}

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

		/* 
		let mut rect_queue = Vec::new();

		let _ = rects
			.windows(2)
			.map(|w| {
				let dist = w[0].euclidean_distance(&w[1]);

				if dist < 32.0 {
					let merged = w[0].union(&w[1]);


					println!(
						"merging and pushing bcos dist between r[0] and r[1]: {}. Merged is {:?}",
						dist, merged
					);

					rect_queue.push(merged);
				} else {
					rect_queue.push(w[0].clone());
					rect_queue.push(w[1].clone());
				}
			})
			.collect::<()>();
		*/

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
		//rects.extend(rect_queue);
		rects.push(batched_rect);

		println!("output rects: {:?}", rects);
	}

	/// Splits a input rectangle into multiple tiles recursively.
	#[cfg(feature = "multi_splat")]
	pub fn split_into_tiles(input_rect: &Self, tile_resolution: u32, output: &mut Vec<Self>) {
		if tile_resolution == 0 {
			return;
		}

		let mp = input_rect.midpoint();

		println!("Rect {:?} midpoint: {:?}", input_rect, mp);

		let rect = Rect {
			x: input_rect.x,
			y: input_rect.y,
			width: mp.0 / 2,
			height: mp.1 / 2,
		};

		output.push(rect.clone());

		// recurse
		Self::split_into_tiles(&rect, tile_resolution - 1, output);
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
