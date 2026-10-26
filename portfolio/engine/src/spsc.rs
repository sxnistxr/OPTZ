//! A bounded lock-free single-producer / single-consumer queue.
//!
//! The producer owns `tail`, the consumer owns `head`; each publishes its index with Release and
//! reads the other's with Acquire, which is all the synchronisation a SPSC ring needs.

use std::cell::UnsafeCell;
use std::mem::MaybeUninit;
use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};

#[repr(align(64))]
struct Padded(AtomicUsize);

struct Ring<T> {
    head: Padded,
    tail: Padded,
    mask: usize,
    slots: Box<[UnsafeCell<MaybeUninit<T>>]>,
}

unsafe impl<T: Send> Sync for Ring<T> {}
unsafe impl<T: Send> Send for Ring<T> {}

pub struct Producer<T> {
    ring: Arc<Ring<T>>,
}
pub struct Consumer<T> {
    ring: Arc<Ring<T>>,
}

/// `capacity` is rounded up to a power of two.
pub fn channel<T>(capacity: usize) -> (Producer<T>, Consumer<T>) {
    let cap = capacity.next_power_of_two();
    let ring = Arc::new(Ring {
        head: Padded(AtomicUsize::new(0)),
        tail: Padded(AtomicUsize::new(0)),
        mask: cap - 1,
        slots: (0..cap).map(|_| UnsafeCell::new(MaybeUninit::uninit())).collect(),
    });
    (Producer { ring: ring.clone() }, Consumer { ring })
}

impl<T> Producer<T> {
    /// Returns the value back if the queue is full.
    pub fn push(&mut self, v: T) -> Result<(), T> {
        let r = &*self.ring;
        let tail = r.tail.0.load(Ordering::Relaxed);
        if tail - r.head.0.load(Ordering::Acquire) > r.mask {
            return Err(v);
        }
        unsafe { (*r.slots[tail & r.mask].get()).write(v) };
        r.tail.0.store(tail + 1, Ordering::Release);
        Ok(())
    }
}

impl<T> Consumer<T> {
    pub fn pop(&mut self) -> Option<T> {
        let r = &*self.ring;
        let head = r.head.0.load(Ordering::Relaxed);
        if head == r.tail.0.load(Ordering::Acquire) {
            return None;
        }
        let v = unsafe { (*r.slots[head & r.mask].get()).assume_init_read() };
        r.head.0.store(head + 1, Ordering::Release);
        Some(v)
    }

    pub fn is_empty(&self) -> bool {
        let r = &*self.ring;
        r.head.0.load(Ordering::Relaxed) == r.tail.0.load(Ordering::Acquire)
    }
}

impl<T> Drop for Ring<T> {
    fn drop(&mut self) {
        let (mut h, t) = (*self.head.0.get_mut(), *self.tail.0.get_mut());
        while h != t {
            unsafe { self.slots[h & self.mask].get_mut().assume_init_drop() };
            h += 1;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fifo_across_threads() {
        let (mut p, mut c) = channel::<u64>(64);
        let t = std::thread::spawn(move || {
            for i in 0..100_000u64 {
                let mut v = i;
                while let Err(back) = p.push(v) {
                    v = back;
                    std::hint::spin_loop();
                }
            }
        });
        let mut want = 0;
        while want < 100_000 {
            if let Some(v) = c.pop() {
                assert_eq!(v, want);
                want += 1;
            }
        }
        t.join().unwrap();
        assert!(c.pop().is_none());
    }

    #[test]
    fn full_and_drop() {
        let (mut p, _c) = channel::<String>(2);
        p.push("a".into()).unwrap();
        p.push("b".into()).unwrap();
        assert!(p.push("c".into()).is_err());
    }
}
