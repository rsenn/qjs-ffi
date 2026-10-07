import { lazyProperty, memoize } from 'util';
import { dlopen, ptr, toArrayBuffer, toString } from 'ffi';

export { dlopen, ptr, toArrayBuffer, toString } from 'ffi';

const { symbols: pm } = dlopen('libportmidi.so', {
  Pm_Initialize: { args: [], returns: 'i32' },
  Pm_Terminate: { args: [], returns: 'i32' },
  Pm_HasHostError: { args: ['pointer'], returns: 'i32' },
  Pm_GetErrorText: { args: ['i32'], returns: 'cstring' },
  Pm_GetHostErrorText: { args: ['pointer', 'u32'], returns: 'void' },
  Pm_CountDevices: { args: [], returns: 'i32' },
  Pm_GetDefaultInputDeviceID: { args: [], returns: 'i32' },
  Pm_GetDefaultOutputDeviceID: { args: [], returns: 'i32' },
  Pm_GetDeviceInfo: { args: ['i32'], returns: 'pointer' },
  Pm_OpenInput: { args: ['pointer', 'i32', 'pointer', 'i32', 'pointer', 'pointer'], returns: 'i32' },
  Pm_OpenOutput: { args: ['pointer', 'i32', 'pointer', 'i32', 'pointer', 'pointer', 'i32'], returns: 'i32' },
  Pm_SetFilter: { args: ['pointer', 'i32'], returns: 'i32' },
  Pm_SetChannelMask: { args: ['pointer', 'i32'], returns: 'i32' },
  Pm_Abort: { args: ['pointer'], returns: 'i32' },
  Pm_Close: { args: ['pointer'], returns: 'i32' },
  Pm_Synchronize: { args: ['pointer'], returns: 'i32' },
  Pm_Read: { args: ['pointer', 'pointer', 'i32'], returns: 'i32' },
  Pm_Poll: { args: ['pointer'], returns: 'i32' },
  Pm_Write: { args: ['pointer', 'pointer', 'i32'], returns: 'i32' },
  Pm_WriteShort: { args: ['pointer', 'i32', 'i32'], returns: 'i32' },
  Pm_WriteSysEx: { args: ['pointer', 'i32', 'pointer'], returns: 'i32' },
});

/* the virtual ports exist only in newer portmidi: absent here, they throw when called */
let pmv = {};

const missing = name => () => {
  throw new Error(name + ' is not in this libportmidi');
};

try {
  pmv = dlopen('libportmidi.so', {
    Pm_CreateVirtualInput: { args: ['cstring', 'cstring', 'pointer'], returns: 'i32' },
    Pm_CreateVirtualOutput: { args: ['cstring', 'cstring', 'pointer'], returns: 'i32' },
  }).symbols;
} catch(e) {}

export function PmError(n) {
  return {
    [0]: 'pmNoError',
    [1]: 'pmGotData',
    [-10000]: 'pmHostError',
    [-9999]: 'pmInvalidDeviceId',
    [-9998]: 'pmInsufficientMemory',
    [-9997]: 'pmBufferTooSmall',
    [-9996]: 'pmBufferOverflow',
    [-9995]: 'pmBadPtr',
    [-9994]: 'pmBadData',
    [-9993]: 'pmInternalError',
    [-9992]: 'pmBufferMaxSize',
    [-9991]: 'pmNotImplemented',
    [-9990]: 'pmInterfaceNotSupported',
    [-9989]: 'pmNameConflict',
  }[n];
}

export function Pm_Message(status, data1, data2) {
  return ((data2 << 16) & 0xff0000) | ((data1 << 8) & 0xff00) | (status & 0xff);
}

Object.assign(PmError, {
  pmNoError: 0,
  pmNoData: 0,
  pmGotData: 1,
  pmHostError: -10000,
  pmInvalidDeviceId: -9999,
  pmInsufficientMemory: -9998,
  pmBufferTooSmall: -9997,
  pmBufferOverflow: -9996,
  pmBadPtr: -9995,
  pmBadData: -9994,
  pmInternalError: -9993,
  pmBufferMaxSize: -9992,
  pmNotImplemented: -9991,
  pmInterfaceNotSupported: -9990,
  pmNameConflict: -9989,
});

export class PmDeviceInfo extends ArrayBuffer {
  constructor(obj = {}) {
    super(40);
    Object.assign(this, obj);
  }

  /* 0: int structVersion */
  set structVersion(value) {
    if(typeof value == 'object' && value != null && value instanceof ArrayBuffer) value = ptr(value);
    new Int32Array(this, 0)[0] = value;
  }
  get structVersion() {
    return '0x' + new Uint32Array(this, 0)[0].toString(16);
  }

  get interf() {
    return toString(new BigUint64Array(this, 8)[0]);
  }

  get name() {
    return toString(new BigUint64Array(this, 16)[0]);
  }

  /* 24: int input */
  set input(value) {
    if(typeof value == 'object' && value != null && value instanceof ArrayBuffer) value = ptr(value);
    new Int32Array(this, 24)[0] = value;
  }
  get input() {
    return Boolean(new Int32Array(this, 24)[0]);
  }

  /* 28: int output */
  set output(value) {
    if(typeof value == 'object' && value != null && value instanceof ArrayBuffer) value = ptr(value);
    new Int32Array(this, 28)[0] = value;
  }
  get output() {
    return Boolean(new Int32Array(this, 28)[0]);
  }

  /* 32: int opened */
  set opened(value) {
    if(typeof value == 'object' && value != null && value instanceof ArrayBuffer) value = ptr(value);
    new Int32Array(this, 32)[0] = value;
  }
  get opened() {
    return Boolean(new Int32Array(this, 32)[0]);
  }

  /* 36: int is_virtual */
  set is_virtual(value) {
    if(typeof value == 'object' && value != null && value instanceof ArrayBuffer) value = ptr(value);
    new Int32Array(this, 36)[0] = value;
  }
  get is_virtual() {
    return Boolean(new Int32Array(this, 36)[0]);
  }

  static from(address) {
    let ret = toArrayBuffer(address, 0, 40).slice(0);
    return Object.setPrototypeOf(ret, PmDeviceInfo.prototype);
  }

  toString() {
    const { structVersion, interf, name, input, output, opened, is_virtual } = this;
    return `PmDeviceInfo {\n\t.structVersion = ${structVersion},\n\t.interf = 0x${interf.toString(16)},\n\t.name = 0x${name.toString(
      16,
    )},\n\t.input = ${input},\n\t.output = ${output},\n\t.opened = ${opened},\n\t.is_virtual = ${is_virtual}\n}`;
  }

  [Symbol.inspect]() {
    const { structVersion, interf, name, input, output, opened } = this;
    return `PmDeviceInfo` + Object.entries({ structVersion, interf, name, input, output, opened }).reduce((s, [k, v]) => (s ? s + '\n  ' : s + ' {\n  ') + `${k}: ${v}`, '') + '\n}';
  }
}

/**
 * @function Pm_Initialize
 *
 * @return   {Number}
 */
export function Pm_Initialize() {
  return pm.Pm_Initialize();
}

/**
 * @function Pm_Terminate
 *
 * @return   {Number}
 */
export function Pm_Terminate() {
  return pm.Pm_Terminate();
}

/**
 * @function Pm_HasHostError
 *
 * @param    {Number}        stream
 *
 * @return   {Number}
 */
export function Pm_HasHostError(stream) {
  return pm.Pm_HasHostError(stream);
}

/**
 * @function Pm_GetErrorText
 *
 * @param    {Number}        errnum
 *
 * @return   {String}
 */
export function Pm_GetErrorText(errnum) {
  return pm.Pm_GetErrorText(errnum);
}

/**
 * @function Pm_GetHostErrorText
 *
 * @param    {String}        msg
 * @param    {Number}        len
 */
export function Pm_GetHostErrorText(msg, len) {
  pm.Pm_GetHostErrorText(msg, len);
}

/**
 * @function Pm_CountDevices
 *
 * @return   {Number}
 */
export function Pm_CountDevices() {
  return pm.Pm_CountDevices();
}

/**
 * @function Pm_GetDefaultInputDeviceID
 *
 * @return   {Number}
 */
export function Pm_GetDefaultInputDeviceID() {
  return pm.Pm_GetDefaultInputDeviceID();
}

/**
 * @function Pm_GetDefaultOutputDeviceID
 *
 * @return   {Number}
 */
export function Pm_GetDefaultOutputDeviceID() {
  return pm.Pm_GetDefaultOutputDeviceID();
}

/**
 * @function Pm_GetDeviceInfo
 *
 * @param    {Number}        id
 *
 * @return   {Number}
 */
export function Pm_GetDeviceInfo(id) {
  const ptr = pm.Pm_GetDeviceInfo(id);

  return Object.setPrototypeOf(toArrayBuffer(ptr, 0, 40).slice(0), PmDeviceInfo.prototype);
}

/**
 * @function Pm_OpenInput
 *
 * @param    {Number}        stream
 * @param    {Number}        inputDevice
 * @param    {Number}        inputDriverInfo
 * @param    {Number}        bufferSize
 * @param    {Number}        time_proc
 * @param    {Number}        time_info
 *
 * @return   {Number}
 */
export function Pm_OpenInput(stream, inputDevice, inputDriverInfo = null, bufferSize = 0, time_proc = null, time_info = null) {
  let streamPtr = new BigUint64Array(1);
  let ret = pm.Pm_OpenInput(streamPtr.buffer, inputDevice, inputDriverInfo, bufferSize, time_proc, time_info);
  let ptr = Number(streamPtr[0]);
  let buf = toArrayBuffer(ptr, 0, 48).slice(0);
  if(typeof stream == 'function') stream(buf, ptr);
  else if('length' in stream) stream.splice(0, stream.length, buf, ptr);
  else throw new TypeError(`Pm_OpenInput argument 1 must be function or array`);

  return ret;
}

/**
 * @function Pm_OpenOutput
 *
 * @param    {Number}        stream
 * @param    {Number}        outputDevice
 * @param    {Number}        outputDriverInfo
 * @param    {Number}        bufferSize
 * @param    {Number}        time_proc
 * @param    {Number}        time_info
 * @param    {Number}        latency
 *
 * @return   {Number}
 */
export function Pm_OpenOutput(stream, outputDevice, outputDriverInfo = null, bufferSize = 0, time_proc = null, time_info = null, latency = 0) {
  let streamPtr = new BigUint64Array(1);
  let ret = pm.Pm_OpenOutput(streamPtr.buffer, outputDevice, outputDriverInfo, bufferSize, time_proc, time_info, latency);
  let ptr = Number(streamPtr[0]);
  let buf = toArrayBuffer(ptr, 0, 48).slice(0);
  if(typeof stream == 'function') stream(buf, ptr);
  else if('length' in stream) stream.splice(0, stream.length, buf, ptr);
  else throw new TypeError(`Pm_OpenOutput argument 1 must be function or array`);
  return ret;
}

/**
 * @function Pm_CreateVirtualInput
 *
 * @param    {String}        name
 * @param    {String}        interf
 *
 * @return   {Number}
 */
export function Pm_CreateVirtualInput(name, interf) {
  return (pmv.Pm_CreateVirtualInput || missing('Pm_CreateVirtualInput'))(name, interf, null);
}

/**
 * @function Pm_CreateVirtualOutput
 *
 * @param    {String}        name
 * @param    {String}        interf
 *
 * @return   {Number}
 */
export function Pm_CreateVirtualOutput(name, interf) {
  return (pmv.Pm_CreateVirtualOutput || missing('Pm_CreateVirtualOutput'))(name, interf, null);
}

/**
 * @function Pm_SetFilter
 *
 * @param    {Number}        stream
 * @param    {Number}        filters
 *
 * @return   {Number}
 */
export function Pm_SetFilter(stream, filters) {
  return pm.Pm_SetFilter(stream, filters);
}

/**
 * @function Pm_SetChannelMask
 *
 * @param    {Number}        stream
 * @param    {Number}        mask
 *
 * @return   {Number}
 */
export function Pm_SetChannelMask(stream, mask) {
  return pm.Pm_SetChannelMask(stream, mask);
}

/**
 * @function Pm_Abort
 *
 * @param    {Number}        stream
 *
 * @return   {Number}
 */
export function Pm_Abort(stream) {
  return pm.Pm_Abort(stream);
}

/**
 * @function Pm_Close
 *
 * @param    {Number}        stream
 *
 * @return   {Number}
 */
export function Pm_Close(stream) {
  return pm.Pm_Close(stream);
}

/**
 * @function Pm_Synchronize
 *
 * @param    {Number}        stream
 *
 * @return   {Number}
 */
export function Pm_Synchronize(stream) {
  return pm.Pm_Synchronize(stream);
}

/**
 * @function Pm_Read
 *
 * @param    {Number}        stream
 * @param    {Number}        buffer
 * @param    {Number}        length
 *
 * @return   {Number}
 */
export function Pm_Read(stream, buffer, length) {
  return pm.Pm_Read(stream, buffer, length);
}

/**
 * @function Pm_Poll
 *
 * @param    {Number}        stream
 *
 * @return   {Number}
 */
export function Pm_Poll(stream) {
  return pm.Pm_Poll(stream);
}

/**
 * @function Pm_Write
 *
 * @param    {Number}        stream
 * @param    {Number}        buffer
 * @param    {Number}        length
 *
 * @return   {Number}
 */
export function Pm_Write(stream, buffer, length) {
  length ??= buffer.byteLength >> 3;
  return pm.Pm_Write(stream, buffer, length);
}

/**
 * @function Pm_WriteShort
 *
 * @param    {Number}        stream
 * @param    {Number}        when
 * @param    {Number}        msg
 *
 * @return   {Number}
 */
export function Pm_WriteShort(stream, when, msg) {
  return pm.Pm_WriteShort(stream, when, msg);
}

/**
 * @function Pm_WriteSysEx
 *
 * @param    {Number}        stream
 * @param    {Number}        when
 * @param    {Number}        msg
 *
 * @return   {Number}
 */
export function Pm_WriteSysEx(stream, when, msg) {
  return pm.Pm_WriteSysEx(stream, when, msg);
}

/**
 * This class describes a midi device.
 *
 * @class      MIDIPort (name)
 */
export class MIDIPort {
  constructor(deviceId) {
    this.deviceId = deviceId;
    this.stream = new ArrayBuffer(8);

    lazyProperty(this, 'deviceInfo', () => Pm_GetDeviceInfo(deviceId), { enumerable: false });
  }

  get name() {
    const { deviceInfo } = this;
    return deviceInfo.name;
  }

  get type() {
    const { deviceInfo } = this;
    return deviceInfo.input ? 'input' : deviceInfo.output ? 'output' : null;
  }

  open() {}
}

/**
 * This class describes a midi input.
 *
 * @class      MIDIInput (name)
 */
export class MIDIInput extends MIDIPort {
  static inputs = memoize(deviceId => new MIDIInput(deviceId));

  constructor(deviceId) {
    super(deviceId);
  }

  static from(deviceId) {
    let input = MIDIInput.inputs(deviceId);
    console.log('MIDIInput.from', { deviceId, input });
    return input;
  }
}

/**
 * This class describes a midi output.
 *
 * @class      MIDIOutput (name)
 */
export class MIDIOutput extends MIDIPort {
  static outputs = memoize(deviceId => new MIDIOutput(deviceId));

  constructor(deviceId) {
    super(deviceId);
  }

  send(data) {}

  static from(deviceId) {
    let output = MIDIOutput.outputs(deviceId);
    return output;
  }
}

/**
 * This class describes a map of midi inputs.
 *
 * @class      MIDIInputMap (name)
 */
export class MIDIInputMap {
  constructor(arr) {
    this.devices = arr;
  }

  *values() {
    const { devices } = this;
    for(let deviceId of devices) yield MIDIInput.from(deviceId);
  }
}

/**
 * This class describes a map of midi outputs.
 *
 * @class      MIDIOutputMap (name)
 */
export class MIDIOutputMap {
  constructor(arr) {
    this.devices = arr;
  }

  *values() {
    const { devices } = this;
    for(let deviceId of devices) yield MIDIOutput.from(deviceId);
  }
}

let inputs, outputs;

/**
 * This class describes a midi access.
 *
 * @class      MIDIAccess (name)
 */
export class MIDIAccess {
  get devices() {
    let count = Pm_CountDevices();
    let ret = [];
    for(let i = 0; i < count; i++) ret[i] = Pm_GetDeviceInfo(i);
    return ret;
  }

  filter(fn = (id, info) => false) {
    const entries = [...this.devices.entries()].filter(([id, info]) => fn(id, info));
    return entries.map(([id]) => id);
  }

  get inputs() {
    inputs = new MIDIInputMap(this.filter((id, info) => info.input));
    return inputs;
  }

  get outputs() {
    outputs = new MIDIOutputMap(this.filter((id, info) => info.output));
    return outputs;
  }
}

MIDIInput.prototype[Symbol.toStringTag] = 'MIDIInput';
MIDIOutput.prototype[Symbol.toStringTag] = 'MIDIOutput';
MIDIInputMap.prototype[Symbol.toStringTag] = 'MIDIInputMap';
MIDIOutputMap.prototype[Symbol.toStringTag] = 'MIDIOutputMap';
MIDIAccess.prototype[Symbol.toStringTag] = 'MIDIAccess';
