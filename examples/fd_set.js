export const FD_SETSIZE = 1024;

export class fd_set extends ArrayBuffer {
  #array = null;

  constructor() {
    super(FD_SETSIZE / 8);
  }

  get size() {
    return this.byteLength * 8;
  }

  get maxfd() {
    const a = this.toArray();
    return a[a.length - 1];
  }

  toArray() {
    const a = (this.#array ??= new Uint8Array(this));
    const n = a.byteLength;
    const r = [];
    for(let i = 0; i < n; i++) for (let j = 0; j < 8; j++) if(a[i] & (1 << j)) r.push(i * 8 + j);
    return r;
  }

  get [Symbol.toStringTag]() {
    return 'fd_set';
  }

  [Symbol.inspect]() {
    return `\x1b[1;31mfd_set\x1b[0m ` + inspect(this.toArray(), { color: true });
  }
}

export function FD_SET(fd, set) {
  const byte = fd >> 3,
    shift = fd & 0b111;
  new Uint8Array(set, byte, 1)[0] |= 1 << shift;
}

export function FD_CLR(fd, set) {
  const byte = fd >> 3,
    shift = fd & 0b111;
  new Uint8Array(set, byte, 1)[0] &= ~(1 << shift);
}

export function FD_ISSET(fd, set) {
  const byte = fd >> 3,
    shift = fd & 0b111;
  return !!(new Uint8Array(set, byte, 1)[0] & (1 << shift));
}

export function FD_ZERO(fd, set) {
  const a = new Uint8Array(set);
  const n = a.length;
  for(let i = 0; i < n; i++) a[i] = 0;
}

export default { FD_SETSIZE, fd_set, FD_SET, FD_CLR, FD_ISSET, FD_ZERO };
