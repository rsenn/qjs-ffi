// elfmap.js - list loaded ELF modules + .bss without reading /proc/self/maps.
// usage: qjsm elfmap.js [--verify]     (--verify compares against /proc/self/maps afterwards)
import * as std from "std";
import * as ffi from "ffi";

const dir = scriptArgs[0].replace(/[^/]*$/, "");
const {
  symbols: { elfmap },
} = ffi.cc({
  source: dir + "elfmap.c",
  symbols: { elfmap: { args: ["buffer", "i32"], returns: "i32" } },
});

const buf = new Uint8Array(1 << 20);
const t0 = Date.now();
const n = elfmap(buf, buf.length);
const dt = Date.now() - t0;
let text = "";
for(let i = 0; i < n; i += 4096) text += String.fromCharCode(...buf.subarray(i, Math.min(n, i + 4096)));

if(scriptArgs.includes("--raw")) console.log(text);
const hex = s => BigInt("0x" + s);
const h = v => "0x" + v.toString(16).padStart(12, "0");
const mods = [],
  segs = [],
  named = [];
let sys = 0;
for(const line of text.split("\n")) {
  const f = line.split(" ");
  if(f[0] == "M")
    mods.push({
      i: +f[1],
      bias: hex(f[2]),
      lo: hex(f[3]),
      hi: hex(f[4]),
      type: +f[5] == 2 ? "EXEC" : "DYN",
      mach: +f[6],
      via: f[7].slice(1) + (f[8] ?? "").replace(/^.*\]$/, ""),
      name: line.replace(/^M [^\[]*\[([^\]]*)\] /, ""),
      viaFull: line.match(/\[([^\]]*)\]/)[1],
      segs: [],
    });
  if(f[0] == "S") {
    const s = { m: +f[1], lo: hex(f[2]), hi: hex(f[3]), fl: f[4], r: +f[5], w: +f[6], np: +f[7], bl: hex(f[8]), bh: hex(f[9]) };
    segs.push(s);
    mods[s.m].segs.push(s);
  }
  if(f[0] == "N") named.push({ m: +f[1], addr: hex(f[2]), size: f[3], kind: f[4], name: f[5] });
  if(f[0] == "T") sys = +f[1];
}

mods.sort((a, b) => (a.lo < b.lo ? -1 : 1));
console.log(`found ${mods.length} ELF modules with ${sys} probe syscalls in ${dt} ms (no /proc, no link_map)\n`);
for(const m of mods) {
  console.log(`${h(m.lo)}-${h(m.hi)}  ${m.type.padEnd(4)}  ${(m.name || "-").padEnd(34)} via ${m.viaFull}`);
  for(const s of m.segs) {
    const prot = `${s.r == s.np ? "r" : s.r ? "r*" : "-"}${s.w == s.np ? "w" : s.w ? "w*" : "-"}`;
    const relro = s.fl[1] == "w" && s.w < s.np ? "  <- partly RELRO" : "";
    const bss = s.bh ? `  .bss ${h(s.bl)}..${h(s.bh)} (${s.bh - s.bl} B)` : "";
    console.log(`    seg ${h(s.lo)}-${h(s.hi)} ${s.fl} probed ${prot} (r ${s.r}/${s.np} pg, w ${s.w}/${s.np})${relro}${bss}`);
  }
}
if(named.length) {
  console.log("\nnamed .bss residents (from relocation symbols):");
  for(const x of named.slice(0, 20)) console.log(`  ${h(x.addr)} ${String(x.size).padStart(5)} B  ${x.kind.padEnd(5)} ${x.name}  [${mods[mods.findIndex(m => m.i == x.m)].name || "-"}]`);
}

if(scriptArgs.includes("--verify")) {
  const maps = (f => {
    const s = f.readAsString();
    f.close();
    return s;
  })(std.open("/proc/self/maps", "r"))
    .split("\n")
    .filter(Boolean)
    .map(l => {
      const [range, perms, , , , ...p] = l.split(/\s+/);
      const [a, b] = range.split("-").map(hex);
      return { a, b, path: p.join(" ") };
    });
  const found = new Set(mods.map(m => m.lo));
  let ok = 0,
    miss = [];
  const byPath = new Map();
  for(const m of maps) if(m.path.startsWith("/") && /\.so|\/qjs|\/ld-|\bqjsm/.test(m.path)) if (!byPath.has(m.path) || byPath.get(m.path) > m.a) byPath.set(m.path, m.a);
  for(const [path, lo] of byPath) found.has(lo) ? ok++ : miss.push(path);
  const vdso = maps.find(m => m.path == "[vdso]");
  console.log(`\nverify vs /proc/self/maps: ${ok}/${byPath.size} file-backed ELF mappings found${vdso ? ", vdso " + (found.has(vdso.a) ? "found" : "MISSED") : ""}`);
  for(const p of miss) console.log("  missed:", p);
  const known = new Set([...byPath.values(), vdso?.a]);
  for(const m of mods) if(!known.has(m.lo)) console.log("  extra (not a mapped file in /proc):", h(m.lo), m.name);
}
