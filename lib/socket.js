import { close, read, write } from 'os';
import { F_GETFL, F_SETFL, fcntl, O_NONBLOCK } from './fcntl.js';
import { socklen_t } from './socklen_t.js';
import { call, define, dlsym, errno, RTLD_DEFAULT, toString } from 'ffi';
import { Error, strerror } from 'std';

export { errno } from 'ffi';
function foreign(name, ret, ...params) {
  let fp = dlsym(RTLD_DEFAULT, name);
  define(name, fp, null, ret, ...params);
  return (...args) => {
    // console.log(name, params.map((p,i)=> [p, args[i]]));
    return call(name, ...args);
  };
}

export let FD_SETSIZE = 1024;

export const SOCK_STREAM = 1; /* stream (connection) socket */
export const SOCK_DGRAM = 2; /* datagram (conn.less) socket  */
export const SOCK_RAW = 3; /* raw socket	 */
export const SOCK_RDM = 4; /* reliably-delivered message */
export const SOCK_SEQPACKET = 5; /* sequential packet socket */
export const SOCK_DCCP = 6; /* Datagram Congestion Control Protocol socket */
export const SOCK_PACKET = 10; /* linux specific way of  */

export const AF_UNIX = 1; /* Unix domain sockets		  */
export const AF_LOCAL = 1; /* POSIX name for AF_UNIX	   */
export const AF_INET = 2; /* Internet IP Protocol		 */
export const AF_AX25 = 3; /* Amateur Radio AX.25		  */
export const AF_IPX = 4; /* Novell IPX				   */
export const AF_APPLETALK = 5; /* AppleTalk DDP				*/
export const AF_NETROM = 6; /* Amateur Radio NET/ROM		*/
export const AF_BRIDGE = 7; /* Multiprotocol bridge		 */
export const AF_ATMPVC = 8; /* ATM PVCs					 */
export const AF_X25 = 9; /* Reserved for X.25 project	*/
export const AF_INET6 = 10; /* IP version 6				 */

export const IPPROTO_ROUTING = 43; /* IPv6 routing header	*/
export const IPPROTO_FRAGMENT = 44; /* IPv6 fragmentation header  */
export const IPPROTO_ICMPV6 = 58; /* ICMPv6	 */
export const IPPROTO_NONE = 59; /* IPv6 no next header	*/
export const IPPROTO_DSTOPTS = 60; /* IPv6 destination options */

export const IPPROTO_IP = 0;
export const IPPROTO_ICMP = 1; /* Internet Control Message Protocol  */
export const IPPROTO_IGMP = 2; /* Internet Group Management Protocol */
export const IPPROTO_IPIP = 4; /* IPIP tunnels (older KA9Q tunnels use 94) */
export const IPPROTO_TCP = 6; /* Transmission Control Protocol  */
export const IPPROTO_EGP = 8; /* Exterior Gateway Protocol	*/
export const IPPROTO_PUP = 12; /* PUP protocol	   */
export const IPPROTO_UDP = 17; /* User Datagram Protocol   */
export const IPPROTO_IDP = 22; /* XNS IDP protocol	 */
export const IPPROTO_RSVP = 46; /* RSVP protocol	  */
export const IPPROTO_GRE = 47; /* Cisco GRE tunnels (rfc 1701,1702)  */
export const IPPROTO_IPV6 = 41; /* IPv6-in-IPv4 tunnelling	*/
export const IPPROTO_PIM = 103; /* Protocol Independent Multicast */
export const IPPROTO_ESP = 50; /* Encapsulation Security Payload protocol */
export const IPPROTO_AH = 51; /* Authentication Header protocol	   */
export const IPPROTO_COMP = 108; /* Compression Header protocol */
export const IPPROTO_SCTP = 132; /* Stream Control Transmission Protocol.  */
export const IPPROTO_UDPLITE = 136; /* UDP-Lite protocol.  */
export const IPPROTO_RAW = 255; /* Raw IP packets	 */

export const EPERM = 1;
export const ENOENT = 2;
export const EINTR = 4;
export const EBADF = 9;
export const EAGAIN = 11;
export const ENOMEM = 12;
export const EACCES = 13;
export const EFAULT = 14;
export const ENOTDIR = 20;
export const EINVAL = 22;
export const ENFILE = 23;
export const EMFILE = 24;
export const EROFS = 30;
export const ENAMETOOLONG = 36;
export const ELOOP = 40;
export const ENOTSOCK = 88;
export const EPROTOTYPE = 91;
export const EPROTONOSUPPORT = 93;
export const EOPNOTSUPP = 95;
export const EAFNOSUPPORT = 97;
export const EADDRINUSE = 98;
export const EADDRNOTAVAIL = 99;
export const ENETUNREACH = 101;
export const ENOBUFS = 105;
export const EISCONN = 106;
export const ETIMEDOUT = 110;
export const ECONNREFUSED = 111;
export const EALREADY = 114;
export const EINPROGRESS = 115;

export const SO_DEBUG = 1;
export const SO_REUSEADDR = 2;
export const SO_TYPE = 3;
export const SO_ERROR = 4;
export const SO_DONTROUTE = 5;
export const SO_BROADCAST = 6;
export const SO_SNDBUF = 7;
export const SO_RCVBUF = 8;
export const SO_KEEPALIVE = 9;
export const SO_OOBINLINE = 10;
export const SO_NO_CHECK = 11;
export const SO_PRIORITY = 12;
export const SO_LINGER = 13;
export const SO_BSDCOMPAT = 14;
export const SO_REUSEPORT = 15;
export const SO_PASSCRED = 16;
export const SO_PEERCRED = 17;
export const SO_RCVLOWAT = 18;
export const SO_SNDLOWAT = 19;
export const SO_RCVTIMEO = 20;
export const SO_SNDTIMEO = 21;
export const SO_ACCEPTCONN = 30;
export const SO_SECURITY_AUTHENTICATION = 22;
export const SO_SECURITY_ENCRYPTION_TRANSPORT = 23;
export const SO_SECURITY_ENCRYPTION_NETWORK = 24;
export const SO_BINDTODEVICE = 25;
export const SO_ATTACH_FILTER = 26;
export const SO_DETACH_FILTER = 27;
export const SO_PEERNAME = 28;
export const SO_TIMESTAMP = 29;

export const SOL_SOCKET = 1;

const syscall = {
  socket: foreign('socket', 'int', 'int', 'int', 'int'),
  select: foreign('select', 'int', 'int', 'void *', 'void *', 'void *', 'void *'),
  connect: foreign('connect', 'int', 'int', 'void *', 'size_t'),
  bind: foreign('bind', 'int', 'int', 'void *', 'size_t'),
  listen: foreign('listen', 'int', 'int', 'int'),
  accept: foreign('accept', 'int', 'int', 'buffer', 'buffer'),
  getsockopt: foreign('getsockopt', 'int', 'int', 'int', 'int', 'void *', 'buffer'),
  setsockopt: foreign('setsockopt', 'int', 'int', 'int', 'int', 'void *', 'size_t'),
  recv: foreign('recv', 'int', 'int', 'buffer', 'size_t', 'int'),
  recvfrom: foreign('recvfrom', 'int', 'int', 'buffer', 'size_t', 'int', 'buffer', 'buffer'),
  send: foreign('send', 'int', 'int', 'buffer', 'size_t', 'int'),
  sendto: foreign('sendto', 'int', 'int', 'buffer', 'size_t', 'int', 'buffer', 'size_t')
};

export const errnos = Object.fromEntries(Object.getOwnPropertyNames(Error).map(name => [Error[name], name]));

export function socket(af = AF_INET, type = SOCK_STREAM, proto = IPPROTO_IP) {
  return syscall.socket(af, type, proto);
}

export function ndelay(fd, on = true) {
  let flags = fcntl(+fd, F_GETFL);

  if(on) flags |= O_NONBLOCK;
  else flags &= ~O_NONBLOCK;

  return fcntl(+fd, F_SETFL, flags);
}

export function connect(fd, addr, addrlen) {
  addrlen = typeof addrlen == 'number' ? addrlen : addr.byteLength;

  return syscall.connect(+fd, addr, addrlen);
}

export function bind(fd, addr, addrlen) {
  addrlen = typeof addrlen == 'number' ? addrlen : addr.byteLength;

  return syscall.bind(+fd, addr, addrlen);
}

export function accept(fd, addr, addrlen) {
  if(addr === undefined) addr = null;
  if(addrlen === undefined) addrlen = null;

  return syscall.accept(+fd, addr, addrlen);
}

export function listen(fd, backlog = 5) {
  return syscall.listen(+fd, backlog);
}

export function recv(fd, buf, offset, len, flags = 0) {
  if(typeof buf == 'object' && typeof buf.buffer == 'object') buf = buf.buffer;
  if(offset === undefined) offset = 0;
  if(len === undefined) len = buf.byteLength;
  return syscall.recv(+fd, buf, offset, len, flags);
}

export function send(fd, buf, offset, len, flags = 0) {
  if(typeof buf == 'string') buf = StringToArrayBuffer(buf);
  else if(typeof buf.buffer == 'object') buf = buf.buffer;
  if(offset === undefined) offset = 0;
  if(len === undefined) len = buf.byteLength;
  return syscall.send(+fd, buf, offset, len, flags);
}

export function select(nfds, readfds = null, writefds = null, exceptfds = null, timeout = null) {
  if(!(typeof nfds == 'number')) {
    let maxfd = Math.max(...[readfds, writefds, exceptfds].filter(s => s instanceof fd_set).map(s => s.maxfd));
    nfds = maxfd + 1;
  }
  return syscall.select(nfds, readfds, writefds, exceptfds, timeout);
}

export function getsockopt(sockfd, level, optname, optval, optlen) {
  return syscall.getsockopt(sockfd, level, optname, optval, optlen || optval.byteLength);
}

export function setsockopt(sockfd, level, optname, optval, optlen) {
  console.log('setsockopt', { sockfd, level, optname, optval, optlen });
  return syscall.setsockopt(sockfd, level, optname, optval, optlen || optval.byteLength);
}

export class SockAddr extends ArrayBuffer {
  constructor(family, addr, port) {
    super(16);

    this.sin_family = family;
    this.sin_addr = addr;
    this.sin_port = port;
  }

  get family() {
    return this.sin_family;
  }
  set family(af) {
    this.sin_family = af;
  }
  get addr() {
    return this.sin_addr;
  }
  set addr(a) {
    this.sin_addr = a;
  }
  get port() {
    return this.sin_port;
  }
  set port(p) {
    this.sin_port = p;
  }

  [Symbol.toPrimitive](hint) {
    return this.toString();
  }

  [Symbol.for('quickjs.inspect.custom')](options) {
    const { sin_family, sin_port, sin_addr } = this;
    return Object.setPrototypeOf({ sin_family, sin_port, sin_addr }, SockAddr.prototype);
  }

  toString() {
    return `${this.sin_addr}:${this.sin_port}`;
  }

  get [Symbol.toStringTag]() {
    return 'SockAddr';
  }
}

Object.defineProperties(SockAddr.prototype, {
  sin_family: {
    set(af) {
      new Uint16Array(this)[0] = af;
    },
    get() {
      return new Uint16Array(this)[0];
    },
    enumerable: true
  },
  sin_port: {
    set(port) {
      new DataView(this, 2).setUint16(0, port, false);
    },
    get() {
      const [hi, lo] = new Uint8Array(this, 2, 2);
      return (hi << 8) | lo;
      //return new DataView(this, 2).getUint16(0, false);
    },
    enumerable: true
  },
  sin_addr: {
    set(addr) {
      // console.log('SockAddr.set sin_addr', addr);
      if(typeof addr == 'string') addr = addr.split(/[.:]/).map(n => +n);
      if(addr instanceof Array) {
        let a = new Uint8Array(this, 4);
        a[0] = addr[0];
        a[1] = addr[1];
        a[2] = addr[2];
        a[3] = addr[3];
      } else {
        new DataView(this, 4).setUint32(0, addr, false);
      }
    },
    get() {
      return new Uint8Array(this, 4, 4).join('.');
    },
    enumerable: true
  }
});

export class Socket {
  constructor(family, type, proto = IPPROTO_IP) {
    // console.log('Socket.constructor', { family, type, proto });
    this.family = family;
    this.type =
      typeof type == 'number' ? type : [IPPROTO_UDP, IPPROTO_TCP].indexOf(proto) != -1 ? SOCK_DGRAM : SOCK_STREAM;
    this.remote = new SockAddr(this.family);
    this.local = new SockAddr(this.family);
    this.pending = true;
    //console.log('socket', { family, type: this.type, proto });
    this.fd = socket(this.family, this.type, proto);
    if(this.fd < 0) {
      this.errno = errno();
      this.error = strerror(this.errno);

      throw new globalThis.Error(`syscall error: ${this.error} (${this.errno})`);
    }
  }

  set remoteFamily(family) {
    this.remote.sin_family = family;
  }
  get remoteFamily() {
    return this.remote.sin_family;
  }
  set remoteAddress(a) {
    this.remote.sin_addr = a;
  }
  get remoteAddress() {
    return this.remote.sin_addr;
  }
  set remotePort(n) {
    this.remote.sin_port = n;
  }
  get remotePort() {
    return this.remote.sin_port;
  }
  set localFamily(family) {
    this.local.sin_family = family;
  }
  get localFamily() {
    return this.local.sin_family;
  }
  set localAddress(a) {
    this.local.sin_addr = a;
  }
  get localAddress() {
    return this.local.sin_addr;
  }
  set localPort(n) {
    this.local.sin_port = n;
  }
  get localPort() {
    return this.local.sin_port;
  }

  connect(remote) {
    let ret;
    this.remote = remote;
    //console.log('remote', Object.setPrototypeOf(remote.slice(), ArrayBuffer.prototype));
    if((ret = connect(this.fd, this.remote, this.remote.byteLength)) == -1) {
      this.errno = syscall.errno;
      if(this.errno == EINPROGRESS) this.connecting = true;
    }
    return ret;
  }

  bind(addr, port) {
    let ret;
    if(addr != undefined) this.localAddress = addr;
    if(port != undefined) this.localPort = port;
    setsockopt(this.fd, SOL_SOCKET, SO_REUSEADDR, new socklen_t(1));
    if((ret = bind(this.fd, this.local, this.local.byteLength)) == -1) this.errno = syscall.errno;
    return ret;
  }

  listen(backlog = 5) {
    let ret;
    if((ret = listen(this.fd, backlog)) == -1) this.errno = syscall.errno;
    return ret;
  }

  accept(remote = new SockAddr(this.family)) {
    let len = new socklen_t(remote.byteLength);
    let ret = accept(this.fd, remote, len);

    if(ret == -1) this.errno = syscall.errno;
    else
      ret = Object.create(Socket.prototype, {
        fd: { v: ret, enumerable: true },
        local: { v: this.local, enumerable: true },
        remote: { v: remote, enumerable: true }
      });
    return ret;
  }

  read(...args) {
    let ret;
    const [buf, offset, len] = args;
    if(args.length == 0 || typeof buf != 'object') {
      let data = new ArrayBuffer(typeof buf == 'number' ? buf : 1024);
      if((ret = this.read(data)) > 0) return data.slice(0, ret);
    } else if((ret = read(this.fd, buf, offset, len)) <= 0) {
      if(ret < 0) this.errno = syscall.errno;
      else if(ret == 0) this.close();
    }
    return ret;
  }

  write(buf, offset, len) {
    let ret;
    if((ret = write(this.fd, buf, offset, len)) == -1) this.errno = syscall.errno;
    return ret;
  }

  recv(buf, offset, len, flags = 0) {
    if(offset) buf = buf.slice(offset);
    return syscall.recv(this.fd, buf, len, flags);
  }

  recvfrom(buf, offset, len, flags = 0, src_addr = null, addrlen = null) {
    if(offset) buf = buf.slice(offset);
    return syscall.recvfrom(this.fd, buf, len, flags, src_addr, addrlen);
  }

  send(buf, offset, len, flags = 0) {
    if(offset) buf = buf.slice(offset);
    return syscall.send(this.fd, buf, len, flags);
  }

  sendto(buf, offset, len, flags = 0, dest_addr = null, addrlen) {
    if(offset) buf = buf.slice(offset);
    return syscall.sendto(this.fd, buf, len, flags, dest_addr, addrlen === undefined ? dest_addr.byteLength : addrlen);
  }

  close() {
    close(this.fd);
    this.destroyed = true;
  }

  valueOf() {
    return this.fd;
  }
}

Object.assign(Socket.prototype, {
  family: AF_INET,
  connecting: false,
  destroyed: false,
  pending: false,
  remote: null,
  local: null
});