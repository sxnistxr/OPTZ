//! An io_uring provided-buffer ring (IORING_REGISTER_PBUF_RING).
//!
//! Multishot receives pick a buffer from this ring when data arrives, so an idle connection
//! holds no receive buffer at all. The event loop parses each buffer in place and returns it
//! in the same iteration; `commit` publishes all returned buffers with one release store.

use io_uring::Submitter;
use io_uring::types::BufRingEntry;
use std::io;
use std::sync::atomic::{AtomicU16, Ordering};

pub struct BufRing {
    ring: *mut BufRingEntry,
    ring_bytes: usize,
    data: *mut u8,
    data_bytes: usize,
    entries: u16,
    buf_size: usize,
    /// Local tail; published to the kernel by `commit`.
    tail: u16,
}

fn mmap(len: usize) -> io::Result<*mut u8> {
    let p = unsafe {
        libc::mmap(std::ptr::null_mut(), len, libc::PROT_READ | libc::PROT_WRITE, libc::MAP_PRIVATE | libc::MAP_ANONYMOUS, -1, 0)
    };
    if p == libc::MAP_FAILED { Err(io::Error::last_os_error()) } else { Ok(p.cast()) }
}

impl BufRing {
    /// `entries` must be a power of two. Registers the ring as buffer group `bgid`.
    pub fn new(sub: &Submitter<'_>, bgid: u16, entries: u16, buf_size: usize) -> io::Result<BufRing> {
        assert!(entries.is_power_of_two());
        let ring_bytes = entries as usize * std::mem::size_of::<BufRingEntry>();
        let data_bytes = entries as usize * buf_size;
        let ring = mmap(ring_bytes)?.cast::<BufRingEntry>();
        let data = mmap(data_bytes)?;
        let mut br = BufRing { ring, ring_bytes, data, data_bytes, entries, buf_size, tail: 0 };
        // SAFETY: both mappings live until Drop, which happens after the ring is torn down
        // (the owning Shard drops its BufRing after its IoUring).
        unsafe { sub.register_buf_ring_with_flags(ring as u64, entries, bgid, 0)? };
        for bid in 0..entries {
            br.push(bid);
        }
        br.commit();
        Ok(br)
    }

    /// The first `len` bytes of buffer `bid`. Valid until the buffer is pushed back.
    pub fn get(&self, bid: u16, len: usize) -> &[u8] {
        assert!((bid as usize) < self.entries as usize && len <= self.buf_size);
        unsafe { std::slice::from_raw_parts(self.data.add(bid as usize * self.buf_size), len) }
    }

    /// Hands buffer `bid` back to the kernel (visible after `commit`).
    pub fn push(&mut self, bid: u16) {
        let idx = (self.tail & (self.entries - 1)) as usize;
        unsafe {
            let e = &mut *self.ring.add(idx);
            e.set_addr(self.data.add(bid as usize * self.buf_size) as u64);
            e.set_len(self.buf_size as u32);
            e.set_bid(bid);
        }
        self.tail = self.tail.wrapping_add(1);
    }

    pub fn commit(&mut self) {
        // The tail shares memory with entry 0's reserved field; the kernel reads it with acquire.
        unsafe {
            let tail = BufRingEntry::tail(self.ring) as *const AtomicU16;
            (*tail).store(self.tail, Ordering::Release);
        }
    }
}

impl Drop for BufRing {
    fn drop(&mut self) {
        unsafe {
            libc::munmap(self.ring.cast(), self.ring_bytes);
            libc::munmap(self.data.cast(), self.data_bytes);
        }
    }
}
