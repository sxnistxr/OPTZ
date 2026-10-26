---
title: The close that never closed
date: 2026-10-26
summary: io_uring direct descriptors on kernel 6.8, and why my server's refusals were silent.
---

My server keeps every connection as an io_uring *direct descriptor*: a slot in the ring's own file
table instead of a normal file descriptor. That's how it gets past the 65,535 open-file limit.

On my development machine (kernel 6.18) every test passed. On the real target, Ubuntu 24.04 with
kernel 6.8, one test hung: when the server refused a connection because it was full, the client
never found out.

## What was happening

Before kernel 6.13, removing a direct descriptor doesn't take effect right away. The kernel
waits until every *older* in-flight request on the ring has finished. An idle keep-alive
connection always has one request in flight: the multishot receive waiting for its next request.
With thousands of idle connections, that wait never ends, so the close never reached the client.

Closes started by the client still worked, which is why every other test passed.

## The fix

Shut the TCP connection down first, with an io_uring `shutdown` hard-linked to the close. Shutdown
acts on the socket straight away, whatever the descriptor table is doing. The close still happens
later, but the client sees the connection end immediately.

The lesson I keep relearning: test on the kernel you'll actually run on.
