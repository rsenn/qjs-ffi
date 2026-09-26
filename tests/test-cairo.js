import { tests, eq, assert } from './tinytest.js';
import * as std from 'std';
import * as os from 'os';
import { dlopen, toBuffer } from 'ffi';
import * as cairo from '../lib/cairo.js';
import { CAIRO_FORMAT_ARGB32, CAIRO_STATUS_SUCCESS, CAIRO_FONT_SLANT_NORMAL, CAIRO_FONT_WEIGHT_BOLD } from '../lib/cairo.js';

const WIDTH = 320,
  HEIGHT = 240;
const OUT_DIR = '.tmp';

// lib/cairo.js is generated from cairo.h only; SVG lives in cairo-svg.h.
const svg = dlopen('libcairo.so.2', {
  cairo_svg_surface_create: { args: ['cstring', 'f64', 'f64'], returns: 'pointer' },
}).symbols;

os.mkdir(OUT_DIR);

function draw(cr) {
  cairo.cairo_set_source_rgb(cr, 1, 1, 1);
  cairo.cairo_paint(cr);

  cairo.cairo_set_source_rgb(cr, 0.2, 0.4, 0.9);
  cairo.cairo_rectangle(cr, 20, 20, WIDTH - 40, HEIGHT - 40);
  cairo.cairo_fill(cr);

  cairo.cairo_set_source_rgba(cr, 1, 0.8, 0, 0.9);
  cairo.cairo_arc(cr, WIDTH / 2, HEIGHT / 2, 70, 0, 2 * Math.PI);
  cairo.cairo_fill(cr);

  const grad = cairo.cairo_pattern_create_linear(0, 0, WIDTH, 0);
  cairo.cairo_pattern_add_color_stop_rgb(grad, 0, 1, 0, 0);
  cairo.cairo_pattern_add_color_stop_rgb(grad, 1, 0, 0.6, 0);
  cairo.cairo_set_source(cr, grad);
  cairo.cairo_rectangle(cr, 40, HEIGHT - 60, WIDTH - 80, 16);
  cairo.cairo_fill(cr);
  cairo.cairo_pattern_destroy(grad);

  cairo.cairo_set_source_rgb(cr, 0, 0, 0);
  cairo.cairo_set_line_width(cr, 3);
  cairo.cairo_move_to(cr, 40, HEIGHT - 80);
  cairo.cairo_curve_to(cr, WIDTH / 3, 40, (2 * WIDTH) / 3, HEIGHT - 40, WIDTH - 40, 40);
  cairo.cairo_stroke(cr);

  cairo.cairo_select_font_face(cr, 'sans-serif', CAIRO_FONT_SLANT_NORMAL, CAIRO_FONT_WEIGHT_BOLD);
  cairo.cairo_set_font_size(cr, 28);
  cairo.cairo_set_source_rgb(cr, 1, 1, 1);
  cairo.cairo_move_to(cr, 30, 50);
  cairo.cairo_show_text(cr, 'qjs-ffi + cairo');
}

function readHead(path, n) {
  const f = std.open(path, 'rb');
  assert(f, 'cannot open ' + path);
  const buf = new Uint8Array(n);
  const got = f.read(buf.buffer, 0, n);
  f.close();
  return buf.subarray(0, got);
}

function fileSize(path) {
  const [st, err] = os.stat(path);
  eq(0, err, 'stat ' + path);
  return st.size;
}

await tests({
  'image surface: draw and read back pixels'() {
    const surface = cairo.cairo_image_surface_create(CAIRO_FORMAT_ARGB32, WIDTH, HEIGHT);
    eq(CAIRO_STATUS_SUCCESS, cairo.cairo_surface_status(surface));

    const cr = cairo.cairo_create(surface);
    eq(CAIRO_STATUS_SUCCESS, cairo.cairo_status(cr));
    draw(cr);
    eq(CAIRO_STATUS_SUCCESS, cairo.cairo_status(cr));
    cairo.cairo_surface_flush(surface);

    const stride = cairo.cairo_image_surface_get_stride(surface);
    const px = new Uint8Array(toBuffer(cairo.cairo_image_surface_get_data(surface), stride * HEIGHT));
    const at = (x, y) => Array.from(px.subarray(y * stride + x * 4, y * stride + x * 4 + 4));

    // ARGB32 is native-endian 0xAARRGGBB, i.e. B,G,R,A in memory (little-endian)
    eq('255,255,255,255', at(2, 2).join());
    eq('230,102,51,255', at(30, 120).join());
    // centre: 90% yellow over the blue rectangle, premultiplied
    const [b, g, r, a] = at(WIDTH / 2, HEIGHT / 2 + 40);
    eq(255, a);
    assert(r > 200 && g > 150 && b < 100, 'centre should be yellowish, got ' + [r, g, b]);

    cairo.cairo_destroy(cr);
    cairo.cairo_surface_destroy(surface);
  },

  'PNG output is a valid PNG file'() {
    const path = OUT_DIR + '/test-cairo.png';
    const surface = cairo.cairo_image_surface_create(CAIRO_FORMAT_ARGB32, WIDTH, HEIGHT);
    const cr = cairo.cairo_create(surface);
    draw(cr);

    eq(CAIRO_STATUS_SUCCESS, cairo.cairo_surface_write_to_png(surface, path));
    cairo.cairo_destroy(cr);
    cairo.cairo_surface_destroy(surface);

    eq('137,80,78,71,13,10,26,10', readHead(path, 8).join());
    assert(fileSize(path) > 1000, 'PNG suspiciously small');
  },

  'SVG output is a valid SVG file'() {
    const path = OUT_DIR + '/test-cairo.svg';
    const surface = svg.cairo_svg_surface_create(path, WIDTH, HEIGHT);
    eq(CAIRO_STATUS_SUCCESS, cairo.cairo_surface_status(surface));

    const cr = cairo.cairo_create(surface);
    draw(cr);
    eq(CAIRO_STATUS_SUCCESS, cairo.cairo_status(cr));
    cairo.cairo_destroy(cr);
    cairo.cairo_surface_finish(surface);
    cairo.cairo_surface_destroy(surface);

    const text = std.loadFile(path);
    assert(text.startsWith('<?xml'), 'missing XML prolog');
    assert(text.includes('<svg'), 'missing <svg> element');
    assert(text.includes('width="' + WIDTH), 'missing width');
    assert(text.includes('</svg>'), 'SVG not terminated');
  },

  'write_to_png reports failure for an unwritable path'() {
    const surface = cairo.cairo_image_surface_create(CAIRO_FORMAT_ARGB32, 4, 4);
    const status = cairo.cairo_surface_write_to_png(surface, '/no/such/dir/out.png');
    assert(status !== CAIRO_STATUS_SUCCESS, 'expected an error status');
    cairo.cairo_surface_destroy(surface);
  },
});
