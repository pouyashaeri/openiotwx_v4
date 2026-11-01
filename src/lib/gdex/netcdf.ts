/**
 * A small NetCDF-3 ("classic") writer and reader, with no dependencies.
 *
 * GDEX prefers CF-compliant NetCDF. The classic format is read by every NetCDF tool (ncdump, xarray,
 * NCL, MATLAB, scipy) and is simple enough to write exactly. This module only covers what a release
 * needs: fixed-size dimensions, typed attributes and variables of type char, short, int, float and
 * double. NetCDF-4 (compression, chunking) is produced from this file by
 * `infra/services/gdex_publisher/netcdf4_convert.py`.
 *
 * Format reference: https://docs.unidata.ucar.edu/netcdf-c/current/file_format_specifications.html
 */

export type NcType = "char" | "short" | "int" | "float" | "double";

/** A typed attribute. Plain strings are char attributes; plain numbers are doubles. */
export type NcAttr = string | number | number[] | { type: Exclude<NcType, "char">; value: number | number[] };

export type NcVariable = {
  name: string;
  type: NcType;
  dims: string[];
  attrs?: Record<string, NcAttr>;
  /** Numbers for numeric types; for `char`, one string per row of the leading dimension (or one string if 1-D). */
  data: ArrayLike<number> | string[] | string;
};

export type NcFile = {
  dims: Record<string, number>;
  attrs: Record<string, NcAttr>;
  vars: NcVariable[];
};

const TAG_DIMENSION = 0x0a;
const TAG_VARIABLE = 0x0b;
const TAG_ATTRIBUTE = 0x0c;

const TYPE_CODE: Record<NcType, number> = { short: 3, char: 2, int: 4, float: 5, double: 6 };
const TYPE_SIZE: Record<NcType, number> = { char: 1, short: 2, int: 4, float: 4, double: 8 };
const CODE_TYPE: Record<number, NcType> = { 2: "char", 3: "short", 4: "int", 5: "float", 6: "double" };

/** The NetCDF default fill value for a float, written explicitly as `_FillValue` so readers can mask it. */
export const FILL_FLOAT = 9.969209968386869e36;
export const FILL_DOUBLE = 9.969209968386869e36;

const pad4 = (n: number) => (n + 3) & ~3;

class Out {
  private chunks: Uint8Array[] = [];
  private size = 0;
  get length() {
    return this.size;
  }
  bytes(b: Uint8Array) {
    this.chunks.push(b);
    this.size += b.length;
  }
  int32(v: number) {
    const b = new Uint8Array(4);
    new DataView(b.buffer).setInt32(0, v, false);
    this.bytes(b);
  }
  int64(v: number) {
    const b = new Uint8Array(8);
    new DataView(b.buffer).setBigInt64(0, BigInt(v), false);
    this.bytes(b);
  }
  zeros(n: number) {
    if (n > 0) this.bytes(new Uint8Array(n));
  }
  /** A name or a char value: length, bytes, zero padding to 4. */
  name(s: string) {
    const b = new TextEncoder().encode(s);
    this.int32(b.length);
    this.bytes(b);
    this.zeros(pad4(b.length) - b.length);
  }
  finish(): Uint8Array {
    const all = new Uint8Array(this.size);
    let o = 0;
    for (const c of this.chunks) {
      all.set(c, o);
      o += c.length;
    }
    return all;
  }
}

function encodeValues(type: Exclude<NcType, "char">, values: ArrayLike<number>): Uint8Array {
  const size = TYPE_SIZE[type];
  const b = new Uint8Array(values.length * size);
  const dv = new DataView(b.buffer);
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (type === "double") dv.setFloat64(i * 8, v, false);
    else if (type === "float") dv.setFloat32(i * 4, v, false);
    else if (type === "int") dv.setInt32(i * 4, v, false);
    else dv.setInt16(i * 2, v, false);
  }
  return b;
}

function attrBytes(a: NcAttr): { code: number; count: number; payload: Uint8Array } {
  if (typeof a === "string") {
    const b = new TextEncoder().encode(a);
    return { code: TYPE_CODE.char, count: b.length, payload: b };
  }
  const type: Exclude<NcType, "char"> = typeof a === "number" || Array.isArray(a) ? "double" : a.type;
  const raw = typeof a === "number" ? [a] : Array.isArray(a) ? a : Array.isArray(a.value) ? a.value : [a.value];
  return { code: TYPE_CODE[type], count: raw.length, payload: encodeValues(type, raw) };
}

function writeAttrs(out: Out, attrs: Record<string, NcAttr> | undefined) {
  const entries = Object.entries(attrs ?? {});
  if (entries.length === 0) {
    out.int32(0);
    out.int32(0);
    return;
  }
  out.int32(TAG_ATTRIBUTE);
  out.int32(entries.length);
  for (const [k, v] of entries) {
    const { code, count, payload } = attrBytes(v);
    out.name(k);
    out.int32(code);
    out.int32(count);
    out.bytes(payload);
    out.zeros(pad4(payload.length) - payload.length);
  }
}

/** The bytes of one variable's data, padded to a 4-byte boundary. */
function variableData(v: NcVariable, dims: Record<string, number>): Uint8Array {
  const shape = v.dims.map((d) => {
    const n = dims[d];
    if (n === undefined) throw new Error(`Variable ${v.name} uses an undefined dimension ${d}`);
    return n;
  });
  const count = shape.reduce((a, b) => a * b, 1);
  let raw: Uint8Array;
  if (v.type === "char") {
    raw = new Uint8Array(count);
    const rows = typeof v.data === "string" ? [v.data] : (v.data as string[]);
    const width = shape.length > 1 ? shape[shape.length - 1] : count;
    rows.slice(0, shape.length > 1 ? shape[0] : 1).forEach((s, r) => {
      const b = new TextEncoder().encode(s).subarray(0, width);
      raw.set(b, r * width);
    });
  } else {
    const nums = v.data as ArrayLike<number>;
    if (nums.length !== count) throw new Error(`Variable ${v.name} has ${nums.length} values; its dimensions need ${count}`);
    raw = encodeValues(v.type, nums);
  }
  const padded = new Uint8Array(pad4(raw.length));
  padded.set(raw);
  return padded;
}

/** Write a NetCDF-3 classic file. Uses the 64-bit offset variant when the file would pass 2 GiB. */
export function writeNetcdf3(file: NcFile): Uint8Array {
  const dimNames = Object.keys(file.dims);
  const datas = file.vars.map((v) => variableData(v, file.dims));
  const total = datas.reduce((a, d) => a + d.length, 0);
  const offset64 = total > 0x7fff0000;

  const header = (begins: number[]) => {
    const out = new Uint8Array([0x43, 0x44, 0x46, offset64 ? 2 : 1]);
    const o = new Out();
    o.bytes(out);
    o.int32(0); // numrecs: there is no record dimension
    if (dimNames.length === 0) {
      o.int32(0);
      o.int32(0);
    } else {
      o.int32(TAG_DIMENSION);
      o.int32(dimNames.length);
      for (const d of dimNames) {
        o.name(d);
        o.int32(file.dims[d]);
      }
    }
    writeAttrs(o, file.attrs);
    if (file.vars.length === 0) {
      o.int32(0);
      o.int32(0);
    } else {
      o.int32(TAG_VARIABLE);
      o.int32(file.vars.length);
      file.vars.forEach((v, i) => {
        o.name(v.name);
        o.int32(v.dims.length);
        for (const d of v.dims) o.int32(dimNames.indexOf(d));
        writeAttrs(o, v.attrs);
        o.int32(TYPE_CODE[v.type]);
        o.int32(Math.min(datas[i].length, 0xfffffffc) | 0);
        if (offset64) o.int64(begins[i]);
        else o.int32(begins[i]);
      });
    }
    return o;
  };

  // The header length does not depend on the offsets' values, only on their width.
  const probe = header(file.vars.map(() => 0));
  let begin = probe.length;
  const begins = datas.map((d) => {
    const b = begin;
    begin += d.length;
    return b;
  });
  const final = header(begins);
  const out = new Out();
  out.bytes(final.finish());
  for (const d of datas) out.bytes(d);
  return out.finish();
}

// ── Reader (used to check our own files, and in tests) ──────────────────────

export type ParsedVariable = {
  name: string;
  type: NcType;
  dims: string[];
  attrs: Record<string, string | number | number[]>;
  begin: number;
  size: number;
};

export type ParsedNetcdf = {
  version: 1 | 2;
  dims: Record<string, number>;
  attrs: Record<string, string | number | number[]>;
  vars: ParsedVariable[];
  /** The numbers of a numeric variable, or the rows of a char variable as strings. */
  read(name: string): number[] | string[];
};

export function parseNetcdf3(buf: Uint8Array): ParsedNetcdf {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const dec = new TextDecoder();
  if (buf[0] !== 0x43 || buf[1] !== 0x44 || buf[2] !== 0x46) throw new Error("Not a NetCDF classic file");
  const version = buf[3];
  if (version !== 1 && version !== 2) throw new Error(`Unsupported NetCDF version ${version}`);
  let p = 4;
  const i32 = () => {
    const v = dv.getInt32(p, false);
    p += 4;
    return v;
  };
  const i64 = () => {
    const v = Number(dv.getBigInt64(p, false));
    p += 8;
    return v;
  };
  const nm = () => {
    const n = i32();
    const s = dec.decode(buf.subarray(p, p + n));
    p += pad4(n);
    return s;
  };
  i32(); // numrecs
  const dimNames: string[] = [];
  const dims: Record<string, number> = {};
  let tag = i32();
  let n = i32();
  if (tag === TAG_DIMENSION) {
    for (let i = 0; i < n; i++) {
      const name = nm();
      dimNames.push(name);
      dims[name] = i32();
    }
  }
  const readAttrs = () => {
    const attrs: Record<string, string | number | number[]> = {};
    const t = i32();
    const count = i32();
    if (t !== TAG_ATTRIBUTE) return attrs;
    for (let i = 0; i < count; i++) {
      const name = nm();
      const type = CODE_TYPE[i32()];
      const len = i32();
      if (type === "char") {
        attrs[name] = dec.decode(buf.subarray(p, p + len));
        p += pad4(len);
      } else {
        const vals: number[] = [];
        for (let k = 0; k < len; k++) {
          if (type === "double") vals.push(dv.getFloat64(p + k * 8, false));
          else if (type === "float") vals.push(dv.getFloat32(p + k * 4, false));
          else if (type === "int") vals.push(dv.getInt32(p + k * 4, false));
          else vals.push(dv.getInt16(p + k * 2, false));
        }
        p += pad4(len * TYPE_SIZE[type]);
        attrs[name] = len === 1 ? vals[0] : vals;
      }
    }
    return attrs;
  };
  const attrs = readAttrs();
  const vars: ParsedVariable[] = [];
  tag = i32();
  n = i32();
  if (tag === TAG_VARIABLE) {
    for (let i = 0; i < n; i++) {
      const name = nm();
      const nd = i32();
      const vd: string[] = [];
      for (let k = 0; k < nd; k++) vd.push(dimNames[i32()]);
      const vattrs = readAttrs();
      const type = CODE_TYPE[i32()];
      const size = i32();
      const begin = version === 2 ? i64() : i32();
      vars.push({ name, type, dims: vd, attrs: vattrs, begin, size });
    }
  }

  const read = (name: string): number[] | string[] => {
    const v = vars.find((x) => x.name === name);
    if (!v) throw new Error(`No variable ${name}`);
    const shape = v.dims.map((d) => dims[d]);
    const count = shape.reduce((a, b) => a * b, 1);
    if (v.type === "char") {
      const width = shape.length > 1 ? shape[shape.length - 1] : count;
      const rows = shape.length > 1 ? shape[0] : 1;
      const out: string[] = [];
      for (let r = 0; r < rows; r++) out.push(dec.decode(buf.subarray(v.begin + r * width, v.begin + (r + 1) * width)).replace(/\0+$/, ""));
      return out;
    }
    const out: number[] = [];
    const sz = TYPE_SIZE[v.type];
    for (let i = 0; i < count; i++) {
      const at = v.begin + i * sz;
      if (v.type === "double") out.push(dv.getFloat64(at, false));
      else if (v.type === "float") out.push(dv.getFloat32(at, false));
      else if (v.type === "int") out.push(dv.getInt32(at, false));
      else out.push(dv.getInt16(at, false));
    }
    return out;
  };
  return { version: version as 1 | 2, dims, attrs, vars, read };
}
