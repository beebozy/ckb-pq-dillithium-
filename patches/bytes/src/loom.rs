#[cfg(not(all(test, loom)))]
pub(crate) mod sync {
    pub(crate) mod atomic {
        // For bare-metal single-threaded targets (e.g. riscv64imac with -a),
        // replace atomic types with non-atomic equivalents using UnsafeCell.
        // This is safe because CKB-VM is strictly single-threaded.
        #[cfg(target_arch = "riscv64")]
        pub(crate) use self::single_thread::{AtomicPtr, AtomicUsize, Ordering};

        #[cfg(not(target_arch = "riscv64"))]
        pub(crate) use core::sync::atomic::{AtomicPtr, AtomicUsize, Ordering};

        #[cfg(feature = "extra-platforms")]
        pub(crate) use extra_platforms::{AtomicPtr, AtomicUsize, Ordering};

        pub(crate) trait AtomicMut<T> {
            fn with_mut<F, R>(&mut self, f: F) -> R
            where
                F: FnOnce(&mut *mut T) -> R;
        }

        impl<T> AtomicMut<T> for AtomicPtr<T> {
            fn with_mut<F, R>(&mut self, f: F) -> R
            where
                F: FnOnce(&mut *mut T) -> R,
            {
                f(self.get_mut())
            }
        }

        // Single-threaded atomic shims for bare-metal RISC-V
        #[cfg(target_arch = "riscv64")]
        mod single_thread {
            use core::cell::UnsafeCell;

            pub(crate) use core::sync::atomic::Ordering;

            pub(crate) struct AtomicUsize(UnsafeCell<usize>);

            unsafe impl Send for AtomicUsize {}
            unsafe impl Sync for AtomicUsize {}

            impl AtomicUsize {
                pub(crate) const fn new(v: usize) -> Self {
                    Self(UnsafeCell::new(v))
                }
                pub(crate) fn load(&self, _: Ordering) -> usize {
                    unsafe { *self.0.get() }
                }
                pub(crate) fn store(&self, v: usize, _: Ordering) {
                    unsafe { *self.0.get() = v }
                }
                pub(crate) fn fetch_add(&self, v: usize, _: Ordering) -> usize {
                    unsafe {
                        let old = *self.0.get();
                        *self.0.get() = old.wrapping_add(v);
                        old
                    }
                }
                pub(crate) fn fetch_sub(&self, v: usize, _: Ordering) -> usize {
                    unsafe {
                        let old = *self.0.get();
                        *self.0.get() = old.wrapping_sub(v);
                        old
                    }
                }
                pub(crate) fn compare_exchange(
                    &self, current: usize, new: usize,
                    _: Ordering, _: Ordering,
                ) -> Result<usize, usize> {
                    unsafe {
                        let old = *self.0.get();
                        if old == current {
                            *self.0.get() = new;
                            Ok(old)
                        } else {
                            Err(old)
                        }
                    }
                }
                pub(crate) fn get_mut(&mut self) -> &mut usize {
                    self.0.get_mut()
                }
            }

            pub(crate) struct AtomicPtr<T>(UnsafeCell<*mut T>);

            unsafe impl<T> Send for AtomicPtr<T> {}
            unsafe impl<T> Sync for AtomicPtr<T> {}

            impl<T> AtomicPtr<T> {
                pub(crate) const fn new(v: *mut T) -> Self {
                    Self(UnsafeCell::new(v))
                }
                pub(crate) fn load(&self, _: Ordering) -> *mut T {
                    unsafe { *self.0.get() }
                }
                pub(crate) fn store(&self, v: *mut T, _: Ordering) {
                    unsafe { *self.0.get() = v }
                }
                pub(crate) fn compare_exchange(
                    &self, current: *mut T, new: *mut T,
                    _: Ordering, _: Ordering,
                ) -> Result<*mut T, *mut T> {
                    unsafe {
                        let old = *self.0.get();
                        if old == current {
                            *self.0.get() = new;
                            Ok(old)
                        } else {
                            Err(old)
                        }
                    }
                }
                pub(crate) fn get_mut(&mut self) -> &mut *mut T {
                    self.0.get_mut()
                }
            }
        }
    }
}

#[cfg(all(test, loom))]
pub(crate) mod sync {
    pub(crate) mod atomic {
        pub(crate) use loom::sync::atomic::{AtomicPtr, AtomicUsize, Ordering};
        pub(crate) trait AtomicMut<T> {}
    }
}
