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
