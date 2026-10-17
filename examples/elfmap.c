/* elfmap.c - find loaded ELF modules and their .bss without /proc/self/maps.
 *
 * Probing: write(pipe, addr, 1) fails with EFAULT on an unreadable address, so
 * we can test any address without a signal handler. Writability is tested by
 * read(pipe, addr, 1) with the byte's own value (non-destructive).
 * Discovery: auxv seeds, ELF relocation slots (GOT), then a conservative
 * pointer scan over module data, heap and stack. ELF64 only. */
typedef unsigned long u64; typedef unsigned int u32; typedef unsigned short u16; typedef unsigned char u8; typedef long i64;
typedef struct { u8 id[16]; u16 type, machine; u32 version; u64 entry, phoff, shoff; u32 flags; u16 ehsize, phentsize, phnum, shentsize, shnum, shstrndx; } Ehdr;
typedef struct { u32 type, flags; u64 offset, vaddr, paddr, filesz, memsz, align; } Phdr;
typedef struct { i64 tag; u64 val; } Dyn;
typedef struct { u64 off, info; i64 addend; } Rela;
typedef struct { u32 name; u8 info, other; u16 shndx; u64 value, size; } Sym;

extern long write(int, const void *, unsigned long);
extern long read(int, void *, unsigned long);
extern int pipe2(int *, int);
extern void *sbrk(long);
extern unsigned long getauxval(unsigned long);

#define PG 4096UL
#define PGDN(a) ((a) & ~(PG - 1))
#define PGUP(a) (((a) + PG - 1) & ~(PG - 1))

static int pfd[2];
static u64 nsys, cpage = ~0UL;

/* ---- probing ---- */
static int okr(u64 a) {
  char c;
  if(PGDN(a) == cpage) return 1;
  nsys++;
  if(write(pfd[1], (void *)a, 1) != 1) return 0;
  read(pfd[0], &c, 1);
  cpage = PGDN(a);
  return 1;
}
static int okrange(u64 a, u64 n) {
  u64 p;
  for(p = PGDN(a); p < a + n; p += PG)
    if(!okr(p < a ? a : p)) return 0;
  return 1;
}
static int okw(u64 a) {
  char c, d;
  if(!okr(a)) return 0;
  c = *(volatile char *)a;
  write(pfd[1], &c, 1);
  nsys += 2;
  if(read(pfd[0], (void *)a, 1) != 1) {
    while(read(pfd[0], &d, 1) == 1) {}
    return 0;
  }
  return 1;
}
static void cpstr(char *dst, u64 src, int max) {
  int i;
  for(i = 0; i < max - 1; i++) {
    if(!okr(src + i)) break;
    dst[i] = *(char *)(src + i);
    if(!dst[i]) return;
  }
  dst[i] = 0;
}
static void scat(char *dst, int cap, const char *s) {
  int n = 0, i;
  while(dst[n]) n++;
  for(i = 0; s[i] && n + 1 < cap; i++) dst[n++] = s[i];
  dst[n] = 0;
}

/* ---- state ---- */
typedef struct {
  u64 bias, lo, hi, dyn, strtab, symtab, rela, relasz, jmprel, pltrelsz, ph, soname, bl[8], bh[8];
  u16 phnum, type, machine;
  int nb, rel, dat;
  char name[64], via[40];
} Mod;
static Mod M[64];
static int nm;
static u64 NL[256], NH[256];
static int nn;
typedef struct { int mod; u64 addr, size; char name[48], kind[8]; } Named;
static Named N[256];
static int nnamed;

static int in_mod(u64 a) {
  int i;
  for(i = 0; i < nm; i++)
    if(a >= M[i].lo && a < M[i].hi) return i;
  return -1;
}
static int in_neg(u64 a) {
  int i;
  for(i = 0; i < nn; i++)
    if(a >= NL[i] && a < NH[i]) return 1;
  return 0;
}
static u64 fx(Mod *m, u64 v) { return v < m->bias ? v + m->bias : v; }

static int try_module(u64 h, const char *via) {
  Ehdr *e;
  Phdr *p;
  Mod *m;
  u64 bias = 0, lo = ~0UL, hi = 0, dyn = 0, d;
  int i, have = 0, k;
  if(!okrange(h, 64)) return -1;
  e = (Ehdr *)h;
  if(e->id[0] != 0x7f || e->id[1] != 'E' || e->id[2] != 'L' || e->id[3] != 'F' || e->id[4] != 2) return -1;
  if((e->type != 2 && e->type != 3) || e->phentsize != 56 || e->phnum < 1 || e->phnum > 64) return -1;
  if(!okrange(h + e->phoff, 56UL * e->phnum)) return -1;
  p = (Phdr *)(h + e->phoff);
  for(i = 0; i < e->phnum; i++)
    if(p[i].type == 1 && p[i].offset == 0 && !have) { bias = h - p[i].vaddr; have = 1; }
  if(!have || nm >= 64) return -1;
  for(i = 0; i < e->phnum; i++) {
    if(p[i].type == 1) {
      u64 s = PGDN(bias + p[i].vaddr), t = PGUP(bias + p[i].vaddr + p[i].memsz);
      if(s < lo) lo = s;
      if(t > hi) hi = t;
    }
    if(p[i].type == 2) dyn = bias + p[i].vaddr;
  }
  m = &M[nm];
  m->bias = bias; m->lo = lo; m->hi = hi; m->dyn = dyn; m->ph = (u64)p; m->phnum = e->phnum;
  m->type = e->type; m->machine = e->machine;
  for(i = 0; i < e->phnum; i++)
    if(p[i].type == 1 && p[i].memsz > p[i].filesz && m->nb < 8) {
      m->bl[m->nb] = bias + p[i].vaddr + p[i].filesz;
      m->bh[m->nb] = bias + p[i].vaddr + p[i].memsz;
      m->nb++;
    }
  for(d = dyn, k = 0; dyn && k < 512; k++, d += 16) {
    Dyn *y;
    if(!okrange(d, 16)) break;
    y = (Dyn *)d;
    if(y->tag == 0) break;
    switch(y->tag) {
      case 5: m->strtab = fx(m, y->val); break;
      case 6: m->symtab = fx(m, y->val); break;
      case 7: m->rela = fx(m, y->val); break;
      case 8: m->relasz = y->val; break;
      case 23: m->jmprel = fx(m, y->val); break;
      case 2: m->pltrelsz = y->val; break;
      case 14: m->soname = y->val; break;
    }
  }
  if(m->strtab && m->soname) cpstr(m->name, m->strtab + m->soname, 64);
  m->via[0] = 0;
  scat(m->via, 40, via);
  return nm++;
}

static void discover(u64 v, const char *kind, int from) {
  char via[40];
  u64 p = PGDN(v), top = p;
  int n, r;
  via[0] = 0;
  scat(via, 40, kind);
  if(from >= 0) {
    char num[4] = { '#', '0' + from / 10 % 10, '0' + from % 10, 0 };
    scat(via, 40, "<-");
    scat(via, 40, num);
  }
  int gap = 0;
  if(!okr(v)) return; /* a target inside a module is readable in practice */
  for(n = 0; n < 16384 && p >= 0x10000; n++, p -= PG) {
    if(in_neg(p) || in_mod(p) >= 0) break;
    if(!okr(p)) { if(++gap > 1024) break; continue; }
    gap = 0;
    if(*(u32 *)p == 0x464c457f && (r = try_module(p, via)) >= 0) {
      /* a valid image; if v lies above it, the gap up to v holds no ELF header */
      if(v >= M[r].hi && nn < 256) { NL[nn] = M[r].hi; NH[nn] = top + PG; nn++; }
      return;
    }
  }
  if(nn < 256) { NL[nn] = p; NH[nn] = top + PG; nn++; }
}

static void cand(u64 v, const char *kind, int from) {
  if(v < 0x10000 || v >= 0x800000000000UL) return;
  if(in_mod(v) >= 0 || in_neg(v)) return;
  discover(v, kind, from);
}

static void scan_range(u64 lo, u64 hi, const char *kind, int from) {
  u64 a, pg = ~0UL;
  for(a = (lo + 7) & ~7UL; a + 8 <= hi; a += 8) {
    if(PGDN(a) != pg) { pg = PGDN(a); if(!okr(a)) { a = pg + PG - 8; continue; } }
    cand(*(u64 *)a, kind, from);
  }
}

static void scan_relocs(int i) {
  Mod *m = &M[i];
  u64 tabs[4];
  int t, b;
  tabs[0] = m->rela; tabs[1] = m->relasz; tabs[2] = m->jmprel; tabs[3] = m->pltrelsz;
  for(t = 0; t < 2; t++) {
    u64 tab = tabs[2 * t], n = tabs[2 * t + 1] / 24, j;
    for(j = 0; tab && j < n; j++) {
      Rela *r;
      u32 type;
      u64 sym, slot;
      if(!okrange(tab + 24 * j, 24)) break;
      r = (Rela *)(tab + 24 * j);
      type = (u32)r->info; sym = r->info >> 32; slot = m->bias + r->off;
      for(b = 0; b < m->nb; b++)
        if(sym && nnamed < 256 && m->symtab && m->strtab && slot >= m->bl[b] && slot < m->bh[b] && okrange(m->symtab + 24 * sym, 24)) {
          Sym *s = (Sym *)(m->symtab + 24 * sym);
          Named *nd = &N[nnamed++];
          nd->mod = i; nd->addr = slot; nd->size = s->size;
          nd->kind[0] = 0; scat(nd->kind, 8, type == 5 || type == 1024 ? "COPY" : "reloc");
          cpstr(nd->name, m->strtab + s->name, 48);
        }
      if((type == 1 || type == 6 || type == 7 || type == 257 || type == 1025 || type == 1026) && okrange(slot, 8))
        cand(*(u64 *)slot, "reloc", i);
    }
  }
}

static void scan_data(int i) {
  Mod *m = &M[i];
  Phdr *p = (Phdr *)m->ph;
  int k;
  for(k = 0; k < m->phnum; k++)
    if(p[k].type == 1 && (p[k].flags & 2))
      scan_range(m->bias + p[k].vaddr, m->bias + p[k].vaddr + p[k].memsz, "data", i);
}

/* ---- output ---- */
static char *o; static int ol, oc;
static void ps(const char *s) { while(*s && ol < oc - 1) o[ol++] = *s++; o[ol] = 0; }
static void px(u64 v) {
  char b[17]; int i = 16;
  b[16] = 0;
  do { b[--i] = "0123456789abcdef"[v & 15]; v >>= 4; } while(v);
  ps(b + i);
}
static void pd(u64 v) {
  char b[21]; int i = 20;
  b[20] = 0;
  do { b[--i] = '0' + v % 10; v /= 10; } while(v);
  ps(b + i);
}

int elfmap(char *out, int cap) {
  u64 a, st, brk, p;
  int i, k, progress, heapdone = 0, ex;
  char local;
  o = out; oc = cap; ol = 0; out[0] = 0;
  pipe2(pfd, 04000);
  cand(getauxval(3), "auxv.PHDR", -1);
  ex = in_mod(getauxval(3));
  cand(getauxval(7), "auxv.BASE", -1);
  cand(getauxval(33), "auxv.VDSO", -1);
  cand(getauxval(9), "auxv.ENTRY", -1);
  if(ex >= 0 && !M[ex].name[0]) cpstr(M[ex].name, getauxval(31), 64);
  if(ex >= 0) { char *t = M[ex].via; t[0] = 0; scat(t, 40, "auxv.PHDR (exe)"); }
  for(;;) {
    progress = 0;
    for(i = 0; i < nm; i++) if(!M[i].rel) { M[i].rel = 1; scan_relocs(i); progress = 1; }
    if(progress) continue;
    for(i = 0; i < nm; i++) if(!M[i].dat) { M[i].dat = 1; scan_data(i); progress = 1; }
    if(progress) continue;
    if(!heapdone) {
      heapdone = 1;
      brk = (u64)sbrk(0);
      for(p = PGDN(brk - 1), k = 0; k < 65536 && okr(p - PG); k++) p -= PG;
      ps("H "); px(p); ps(" "); px(brk); ps("\n");
      scan_range(p, brk, "heap", -1);
      a = (u64)&local;
      for(st = PGDN(a), k = 0; k < 2048 && okr(st + PG); k++) st += PG;
      ps("K "); px(a); ps(" "); px(st + PG); ps("\n");
      scan_range(a, st + PG, "stack", -1);
      continue;
    }
    break;
  }
  for(i = 0; i < nm; i++) {
    Mod *m = &M[i];
    Phdr *ph = (Phdr *)m->ph;
    ps("M "); pd(i); ps(" "); px(m->bias); ps(" "); px(m->lo); ps(" "); px(m->hi); ps(" "); pd(m->type); ps(" ");
    pd(m->machine); ps(" ["); ps(m->via); ps("] "); ps(m->name[0] ? m->name : "-"); ps("\n");
    for(k = 0; k < m->phnum; k++) {
      u64 s, e, q, np = 0, rp = 0, wp = 0;
      if(ph[k].type != 1) continue;
      s = PGDN(m->bias + ph[k].vaddr); e = PGUP(m->bias + ph[k].vaddr + ph[k].memsz);
      for(q = s; q < e; q += PG) { np++; if(okr(q)) { rp++; if(okw(q)) wp++; } }
      ps("S "); pd(i); ps(" "); px(s); ps(" "); px(e); ps(" ");
      ps(ph[k].flags & 4 ? "r" : "-"); ps(ph[k].flags & 2 ? "w" : "-"); ps(ph[k].flags & 1 ? "x" : "-");
      ps(" "); pd(rp); ps(" "); pd(wp); ps(" "); pd(np); ps(" ");
      if(ph[k].memsz > ph[k].filesz) { px(m->bias + ph[k].vaddr + ph[k].filesz); ps(" "); px(m->bias + ph[k].vaddr + ph[k].memsz); }
      else ps("0 0");
      ps("\n");
    }
  }
  for(i = 0; i < nnamed; i++) {
    ps("N "); pd(N[i].mod); ps(" "); px(N[i].addr); ps(" "); pd(N[i].size); ps(" "); ps(N[i].kind); ps(" "); ps(N[i].name); ps("\n");
  }
  ps("T "); pd(nsys); ps("\n");
  return ol;
}
