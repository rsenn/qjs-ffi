export class timeval extends ArrayBuffer {
  constructor(sec,usec) {
    super(16);

    if(sec !== undefined)
      new Uint64Array(this)[0] = sec | 0;
    if(usec !== undefined)
      new Uint64Array(this)[1] = usec | 0;
  }

  [Symbol.toPrimitive](hint) {
    return new Uint64Array(this);
  }
  valueOf() {
    return new Uint64Array(this);
  }

  get [Symbol.toStringTag]() {
    return 'struct timeval';
  }

  [Symbol.inspect]() {
    return `\x1b[1;31mstruct timeval\x1b[0m [` + this.valueOf() + `]`;
  }
}

export default timeval;
