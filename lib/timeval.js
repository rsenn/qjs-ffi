const number = globalThis.BigFloat ?? globalThis.BigDecimal ?? Number;
const thousand = number(1000);

export class timeval extends ArrayBuffer {
  #array = null;

  constructor(sec, usec) {
    super(16);

    if(sec !== undefined) this.toArray()[0] = BigInt(sec | 0);
    if(usec !== undefined) this.toArray()[1] = BigInt(usec | 0);
  }

  get sec() {
    return this.toArray()[0];
  }
  set sec(v) {
    this.toArray()[0] = BigInt(v);
  }
  get usec() {
    return this.toArray()[1];
  }
  set usec(v) {
    this.toArray()[1] = BigInt(v);
  }

  toArray() {
    if(this.#array == null) this.#array = new BigUint64Array(this);

    return this.#array;
  }

  [Symbol.toPrimitive](hint) {
    //console.log('timeval.toPrimitive', hint);
    const [sec, usec] = this.toArray();
    switch (hint) {
      case 'number':
        return Number(number(sec) * thousand + number(usec) / thousand);
    }
    return `${sec}s ${usec}us`;
  }

  valueOf() {
    const [sec, usec] = this.toArray();
    return number(sec) * thousand + number(usec) / thousand;
  }

  [Symbol.inspect](options) {
    return `\x1b[1;31mstruct timeval\x1b[0m { ` + this.toArray().join(', ') + ` }`;
  }
}

timeval.prototype[Symbol.toStrinTag] = 'struct timeval';

export default timeval;
