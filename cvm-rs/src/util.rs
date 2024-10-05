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

/// Safely casts a slice of *primitive* values to a new slice of
/// another primitive value type.
///
/// # Safety
/// This function should only be used with slices of primitive types,
/// as described in the documentation and name of the function. 
/// 
/// Doing otherwise risks undefined
/// behavior and generally just isn't a great idea.
pub const fn slice_primitive_cast<'a, T: Sized, T2: Sized>(slice: &'a [T2]) -> &'a [T] {
	let source_byte_length = core::mem::size_of::<T2>() * slice.len();

	// SAFETY: We ensure that the slice will not access memory out of bounds.
	unsafe {
		std::slice::from_raw_parts(
			slice.as_ptr() as *const T,
			source_byte_length / core::mem::size_of::<T>(),
		)
	}
}
