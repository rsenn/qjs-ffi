import { dlopen, PmError, Pm_Message, PmDeviceInfo, Pm_Initialize, Pm_Terminate, Pm_HasHostError, Pm_GetErrorText, Pm_GetHostErrorText, Pm_CountDevices, Pm_GetDefaultInputDeviceID, Pm_GetDefaultOutputDeviceID, Pm_GetDeviceInfo, Pm_OpenInput, Pm_OpenOutput, Pm_CreateVirtualInput, Pm_CreateVirtualOutput, Pm_SetFilter, Pm_SetChannelMask, Pm_Abort, Pm_Close, Pm_Synchronize, Pm_Read, Pm_Poll, Pm_Write, Pm_WriteShort, Pm_WriteSysEx, MIDIInput, MIDIOutput, MIDIInputMap, MIDIOutputMap, MIDIAccess } from './examples/portmidi.js';
import { Console } from 'console';

function Test_PmApi() {
  let err = Pm_Initialize();
  let count;
  let inputId, outputId, inputInfo, outputInfo, deviceIDs;

  console.log('err', err);

  let vinId = Pm_CreateVirtualInput('vin', null);
  let voutId = Pm_CreateVirtualOutput('vout', null);
  console.log('virt', { vinId, voutId });

  count = Pm_CountDevices();
  console.log('count', count);

  inputId = Pm_GetDefaultInputDeviceID();
  console.log('inputId', inputId);

  outputId = Pm_GetDefaultOutputDeviceID();
  console.log('outputId', outputId);

  deviceIDs = [inputId, outputId];
  const deviceInfo = {};

  for(let id of deviceIDs) {
    let info;
    deviceInfo[id] = info = Pm_GetDeviceInfo(id);

    let arr = new Uint32Array(info, 0, 1);
    console.log('arr', arr);
  }

  console.log('deviceInfo', deviceInfo);
  let input, output;
  err = Pm_OpenInput((st, ptr) => {
    input = ptr;
    console.log('0x' + ptr.toString(16));
    console.log('st', st);
  }, inputId);
  console.log('Pm_OpenInput', { input, err });
  err = Pm_OpenOutput((st, ptr) => {
    output = ptr;
    console.log('0x' + ptr.toString(16));
    console.log('st', st);
  }, outputId);
  console.log('Pm_OpenOutput', { output, err });

  err = Pm_SetFilter(input, 0);
  console.log('Pm_SetFilter', { err });

  err = Pm_Poll(input);
  console.log('Pm_Poll', { err: PmError(err) });

  let msg = new Uint32Array(2);
  msg[1] = Date.now();
  err = Pm_Read(input, msg.buffer, 1);
  console.log('Pm_Read', { err: PmError(err) });
  msg[0] = Pm_Message(0x90, 60, 100);

  err = Pm_Write(output, msg.buffer, 1);
  console.log('Pm_Write', { err: PmError(err), msg, buf: msg.buffer });
  err = Pm_Close(input);
  console.log('Pm_Close', { err });

  err = Pm_Close(output);
  console.log('Pm_Close', { err });

  err = Pm_Terminate();
}

function main() {
  globalThis.console = new Console({ inspectOptions: { depth: Infinity, compact: 0, customInspect: true } });

  Test_PmApi();

  let midi = new MIDIAccess();

  console.log('midi', midi);
  console.log('midi.devices', midi.devices);

  let [input] = [...midi.inputs.values()];
  let [output] = [...midi.outputs.values()];

  console.log('input', input);
  console.log('input.name', input.name);
  console.log('input.deviceInfo', input.deviceInfo);
  console.log('output', output);
  console.log('output.name', output.name);
  console.log('output.deviceInfo', output.deviceInfo);
}

main();
