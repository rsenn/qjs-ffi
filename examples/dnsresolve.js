import { read } from 'os';
import { FD_CLR } from '../lib/fd_set.js';
import { FD_ISSET } from '../lib/fd_set.js';
import { fd_set } from '../lib/fd_set.js';
import { FD_SET } from '../lib/fd_set.js';
import { FD_ZERO } from '../lib/fd_set.js';
import { AF_INET } from '../lib/socket.js';
import { IPPROTO_UDP } from '../lib/socket.js';
import { select } from '../lib/socket.js';
import { SOCK_DGRAM } from '../lib/socket.js';
import { SockAddr } from '../lib/socket.js';
import { Socket } from '../lib/socket.js';
import socklen_t from '../lib/socklen_t.js';
import { errno } from 'ffi';
import { pointerSize } from 'ffi';
import { toArrayBuffer } from 'ffi';
import { toPointer } from 'ffi';
import { toString } from 'ffi';
import { err } from 'std';
import { exit } from 'std';
import { loadFile } from 'std';
import { open } from 'std';
import { out } from 'std';
import { strerror } from 'std';
console.log('socklen_t', 1);

function not(n) {
  return ~n >>> 0;
}

const STDIN_FILENO = 0,
  STDOUT_FILENO = 1,
  STDERR_FILENO = 2;

let log = err;

function debug(fmt, ...args) {
  log.printf(fmt + '\n', ...args);
  log.flush();
}

function FromDomain(buffer) {
  let s = '',
    i = 0,
    u8 = new Uint8Array(buffer);
  for(;;) {
    let len = u8[i++];
    if(len == 0) return s;
    if(s != '') s += '.';
    while(len--) s += String.fromCharCode(u8[i++]);
  }
}

function ToDomain(str, alpha = false) {
  return str
    .split('.')
    .reduce(
      alpha
        ? (a, s) => a + String.fromCharCode(s.length) + s
        : (a, s) => a.concat([s.length, ...s.split('').map(ch => ch.charCodeAt(0))]),
      alpha ? '' : []
    );
}

function DNSQuery(domain) {
  let type = 0x01;
  if(/^([0-9]+\.?){4}$/.test(domain)) {
    domain = domain.split('.').reverse().join('.') + '.in-addr.arpa';
    type = 0x0c;
  }
  console.log('DNSQuery', domain);

  let outBuf = new Uint8Array([
    0xff,
    0xff,
    0x01,
    0x00,
    0x00,
    0x01,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
    ...ToDomain(domain),
    0x00,
    0x00,
    type,
    0x00,
    0x01
  ]).buffer;
  new DataView(outBuf).setUint16(0, outBuf.byteLength - 2, false);
  console.log('DNSQuery', outBuf);
  return outBuf;
}

function DNSResponse(buffer) {
  let u8 = new Uint8Array(buffer);
  let header = new DataView(buffer, 0, 12);
  debug('Num queries: %u', header.getUint16(6, false));
  let ofs = 2 + header.getUint16(0, false);

  header = new DataView(buffer, ofs, 12);
  debug('Num answers: %u', header.getUint16(6, false));
  //   ofs += 2 + header.getUint16(0, false);
  console.log(
    'Response header:',
    ArrayToBytes(u8.slice(ofs, ofs + 12))
    //new Uint16Array(header.buffer, header.byteOffset, 6).map((v, i) => header.getUint16(i * 2, false))
  );
  let type = header.getUint16(2, false);
  console.log('Response type:', type);

  ofs += 12;

  debug('Offset: %u', ofs);
  debug('Packet data [%d] at %d: %s', u8.slice(ofs).length, ofs, ArrayToString(u8.slice(ofs)));

  let addr;
  if(type == 0x0c) {
    addr = FromDomain(buffer.slice(ofs));
  } else {
    addr = u8.slice(-4).join('.');
  }

  return addr;
}

function main(...args) {
  if(/^-o/.test(args[0])) {
    let arg = args[0].length == 2 ? (args.shift(), args.shift()) : args.shift().slice(2);
    log = open(arg, 'a+');
  } else {
    log = open('debug.log', 'a+');
  }

  debug('%s started (%s) [%s]', scriptArgs[0].replace(/.*\//g, ''), args, new Date().toISOString());

  const resolvConf = loadFile('/etc/resolv.conf');
  const servers = resolvConf
    .split(/\n/g)
    .filter(l => /^\s*nameserver/.test(l))
    .map(l => l.replace(/^\s*nameserver\s*([^\s]+).*/g, '$1'));

  debug('servers: %s', servers.join('\n'));

  const addr = servers[0],
    port = 53;

  debug('addr: %s, port: %u', addr, port);

  for(let arg of args) {
    out.printf('%s -> %s\n', arg, lookup(arg));
  }

  function lookup(domain) {
    console.log('lookup', domain);
    let local = new SockAddr(AF_INET, Math.floor(Math.random() * 65535 - 1024) + 1024, '0.0.0.0');

    let remote = new SockAddr(AF_INET);

    remote.family = AF_INET;
    remote.port = port;
    remote.addr = addr;

    console.log('addr', addr);

    let sock = new Socket(AF_INET, SOCK_DGRAM, IPPROTO_UDP);
    console.log('socket() fd =', +sock);
    debug('socket() fd = %d', +sock);

    let ret = sock.bind(local);
    ReturnValue(ret, `sock.bind(${local})`);

    /*ret = sock.connect(addr, port);

        ReturnValue(ret, `sock.connect(${addr}, ${port})`);*/

    let inLen = 0,
      inBuf = new ArrayBuffer(128);
    let query = DNSQuery(domain);

    const rfds = new fd_set();
    const wfds = new fd_set();

    do {
      FD_ZERO(rfds);
      FD_ZERO(wfds);
      FD_CLR(+sock, wfds);
      FD_SET(+sock, rfds);

      if(query) FD_SET(+sock, wfds);
      else if(inLen < inBuf.byteLength) FD_SET(+sock, rfds);

      const timeout = new Uint32Array([5, 0]).buffer;
      // console.log('select:', sock + 1, { rfds, wfds, timeout });

      ret = select(sock + 1, rfds, wfds, null, timeout);

      if(FD_ISSET(+sock, wfds)) {
        /*   const out = outBuf.slice(0, outLen);
        const len = Math.min(outLen, outBuf.byteLength);*/
        if(query && query.byteLength) {
          //console.log(`outLen ${outLen} outBuf '${BufferToString(outBuf)}'`);
          //console.log('sendto', { out, len, remote });
          if(sock.sendto(query, 0, query.byteLength, 0, remote) > 0) {
            query = null;
          }
        }
      }

      if(FD_ISSET(+sock, rfds)) {
        let length;
        debug('socket readable %s %u', remote, remote.byteLength);

        console.log(`remote =`, remote);

        const addr = new SockAddr();

        const data = new ArrayBuffer(1024);
        const slen = new socklen_t(remote.byteLength);

        length = sock.recvfrom(data, 0, data.byteLength, 0, remote, slen);

        let u8 = new Uint8Array(data.slice(0, length));

        if(length > 0) {
          let addr = DNSResponse(u8.buffer);
          debug(
            'Received %d bytes from socket: %s',
            length,
            '"' + ArrayToBytes(u8, '').replace(/0x/g, '\\x').slice(1, -1) + '"'
          );

          sock.close();
          return addr;
        }
        console.log(`Received ${length} bytes from socket`);
      }
    } while(!sock.destroyed);
  }

  debug('end');
}

function ReturnValue(ret, ...args) {
  const r = [-1, 0].indexOf(ret) != -1 ? ret + '' : '0x' + NumberToHex(ret, pointerSize * 2);
  debug('%s ret = %s%s%s', args, r, ...(ret == -1 ? [' errno =', errno(), ' error =', strerror(errno())] : ['', '']));
}

function NumberToHex(n, b = 2) {
  let s = (+n).toString(16);
  return '0'.repeat(Math.ceil(s.length / b) * b - s.length) + s;
}

/*
function EscapeString(str) {
    let r = '';
    let codeAt = typeof str == 'string' ? i => str.charCodeAt(i) : i => str[i];
    for(let i = 0; i < str.length; i++) {
        const code = codeAt(i);

        if(code == 0x0a) r += '\\n';
        else if(code == 0x0d) r += '\\r';
        else if(code == 0x09) r += '\\t';
        else if(code <= 3) r += '\\0';
        else if(code < 32 || code >= 128)
            r += `\\${('00' + code.toString(8)).slice(-3)}`;
        else r += str[i];
    }
    return r;
}

*/
function BufferToArray(buf, offset, length) {
  let len,
    arr = new Uint8Array(buf, offset !== undefined ? offset : 0, length !== undefined ? length : buf.byteLength);
  //   arr = [...arr];
  if((len = arr.indexOf(0)) != -1) arr = arr.slice(0, len);
  return arr;
}

function BufferToString(buf, offset, length) {
  return BufferToArray(buf, offset, length).reduce((s, code) => (s + code ? String.fromCharCode(code) : '\\0'), '');
}

function BufferToBytes(buf, offset = 0, len) {
  const u8 = new Uint8Array(buf, typeof offset == 'number' ? offset : 0, typeof len == 'number' ? len : buf.byteLength);
  return ArrayToBytes(u8);
}

function ArrayToBytes(arr, delim = ', ', bytes = 1) {
  return (
    '[' +
    arr.reduce(
      (s, code) => (s != '' ? s + delim : '') + '0x' + ('000000000000000' + code.toString(16)).slice(-(bytes * 2)),
      ''
    ) +
    ']'
  );
}

function ArrayToString(arr, bytes = 1) {
  const toHex = code => '\\x' + ('000000000000000' + code.toString(16)).slice(-(bytes * 2));
  const toChar = code => (code < 0x20 || code > 0x7f ? toHex(code) : String.fromCharCode(code));

  return '"' + arr.reduce((s, code) => s + toChar(code), '') + '"';
}

function AvailableBytes(buf, numBytes) {
  return buf.byteLength - numBytes;
}

function Copy(dst, src, len) {
  if(len === undefined) len = src.length;
  if(dst.length < len) throw new RangeError(`dst.length (${dst.length}) < len (${len})`);
  for(let i = 0; i < len; i++) dst[i] = src[i];
  return len;
}

function Append(buf, numBytes, ...chars) {
  let n = chars.reduce((a, c) => (typeof c == 'number' ? a + 1 : a + c.length), 0);
  if(AvailableBytes(buf, numBytes) < n) buf = CloneBuf(buf, numBytes + n);
  let a = new Uint8Array(buf, numBytes, n);
  let p = 0;
  for(let i = 0; i < chars.length; i++) {
    if(typeof chars[i] == 'number') {
      a[p++] = chars[i];
    } else if(typeof chars[i] == 'string') {
      const s = chars[i];
      const m = s.length;
      for(let j = 0; j < m; j++) a[p++] = s[j].charCodeAt(0);
    }
  }
  return [buf, numBytes + n];
}

function Dump(buf, numBytes) {
  return BufferToBytes(numBytes !== undefined ? buf.slice(0, numBytes) : buf);
} /*

function CloneBuf(buf, newLen) {
    let n = newLen !== undefined ? newLen : buf.byteLength;
    let p = toPointer(buf);
    return toArrayBuffer(p, n);
}

function Once(fn, thisArg) {
    let ran = false;
    let ret;

    return function(...args) {
        if(!ran) {
            ret = fn.call(thisArg, ...args);
            ran = true;
        }
        return ret;
    };
}

*/
function StringToBuffer(str) {
  return Uint8Array.from(str.split('').map(ch => ch.charCodeAt(0))).buffer;
}

const runMain = () => {
  try {
    main(...scriptArgs.slice(1));
    std.exit(0);
  } catch(error) {
    console.log('ERROR:', error);
  }
};
import('console') .catch(runMain) .then( ({ Console }) => ( (globalThis.console = new Console({ inspectOptions: { numberBase: 16, maxStringLength: 512, maxArrayLength: 512 } })), runMain() ) );