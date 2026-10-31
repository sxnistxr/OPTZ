# Measure kernel memory per idle established TCP socket on loopback.
# Usage: python3 sockmem.py <pairs> [rcv/sndbuf bytes]. Counts both ends of each loopback pair.
import socket, resource, time, sys
from pathlib import Path
def mem():
    d={}
    for l in Path('/proc/meminfo').read_text().splitlines():
        k,v=l.split(':'); d[k]=int(v.split()[0])
    return d
def sockstat():
    return Path('/proc/net/sockstat').read_text().strip()
N=int(sys.argv[1]); rcv=int(sys.argv[2]) if len(sys.argv)>2 else 0
resource.setrlimit(resource.RLIMIT_NOFILE,(resource.getrlimit(resource.RLIMIT_NOFILE)[1],)*2)
ls=socket.socket(); ls.setsockopt(socket.SOL_SOCKET,socket.SO_REUSEADDR,1); ls.bind(('127.0.0.1',0)); ls.listen(4096)
addr=ls.getsockname()
time.sleep(0.5); m0=mem()
cs=[];ss=[]
for _ in range(N):
    c=socket.socket()
    c.connect(addr); s,_=ls.accept()
    if rcv:
        s.setsockopt(socket.SOL_SOCKET,socket.SO_RCVBUF,rcv); s.setsockopt(socket.SOL_SOCKET,socket.SO_SNDBUF,rcv)
    # one request/response round trip so both sides have exchanged data once
    c.send(b'x'*200); s.recv(4096); s.send(b'y'*4000); 
    got=0
    while got<4000: got+=len(c.recv(65536))
    cs.append(c); ss.append(s)
time.sleep(1); m1=mem()
slab=(m1['Slab']-m0['Slab']); used=(m0['MemAvailable']-m1['MemAvailable'])
print(f"N={N} sockets={2*N} rcv/sndbuf={rcv or 'default'}  slab delta {slab} KiB -> {slab*1024/(2*N):.0f} B/socket; MemAvailable delta {used*1024/(2*N):.0f} B/socket")
print(sockstat())
