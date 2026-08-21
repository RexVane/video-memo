var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __esm = (fn, res, err) => function __init() {
  if (err) throw err[0];
  try {
    return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
  } catch (e) {
    throw err = [e], e;
  }
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// node_modules/smol-toml/dist/date.js
var DATE_TIME_RE, TomlDate;
var init_date = __esm({
  "node_modules/smol-toml/dist/date.js"() {
    DATE_TIME_RE = /^(\d{4}-\d{2}-\d{2})?[T ]?(?:(\d{2}):\d{2}(?::\d{2}(?:\.\d+)?)?)?(Z|[-+]\d{2}:\d{2})?$/i;
    TomlDate = class _TomlDate extends Date {
      #hasDate = false;
      #hasTime = false;
      #offset = null;
      constructor(date) {
        let hasDate = true;
        let hasTime = true;
        let offset = "Z";
        if (typeof date === "string") {
          let match = date.match(DATE_TIME_RE);
          if (match) {
            if (!match[1]) {
              hasDate = false;
              date = `0000-01-01T${date}`;
            }
            hasTime = !!match[2];
            hasTime && date[10] === " " && (date = date.replace(" ", "T"));
            if (match[2] && +match[2] > 23) {
              date = "";
            } else {
              offset = match[3] || null;
              date = date.toUpperCase();
              if (!offset && hasTime)
                date += "Z";
            }
          } else {
            date = "";
          }
        }
        super(date);
        if (!isNaN(this.getTime())) {
          this.#hasDate = hasDate;
          this.#hasTime = hasTime;
          this.#offset = offset;
        }
      }
      isDateTime() {
        return this.#hasDate && this.#hasTime;
      }
      isLocal() {
        return !this.#hasDate || !this.#hasTime || !this.#offset;
      }
      isDate() {
        return this.#hasDate && !this.#hasTime;
      }
      isTime() {
        return this.#hasTime && !this.#hasDate;
      }
      isValid() {
        return this.#hasDate || this.#hasTime;
      }
      toISOString() {
        let iso = super.toISOString();
        if (this.isDate())
          return iso.slice(0, 10);
        if (this.isTime())
          return iso.slice(11, 23);
        if (this.#offset === null)
          return iso.slice(0, -1);
        if (this.#offset === "Z")
          return iso;
        let offset = +this.#offset.slice(1, 3) * 60 + +this.#offset.slice(4, 6);
        offset = this.#offset[0] === "-" ? offset : -offset;
        let offsetDate = new Date(this.getTime() - offset * 6e4);
        return offsetDate.toISOString().slice(0, -1) + this.#offset;
      }
      static wrapAsOffsetDateTime(jsDate, offset = "Z") {
        let date = new _TomlDate(jsDate);
        date.#offset = offset;
        return date;
      }
      static wrapAsLocalDateTime(jsDate) {
        let date = new _TomlDate(jsDate);
        date.#offset = null;
        return date;
      }
      static wrapAsLocalDate(jsDate) {
        let date = new _TomlDate(jsDate);
        date.#hasTime = false;
        date.#offset = null;
        return date;
      }
      static wrapAsLocalTime(jsDate) {
        let date = new _TomlDate(jsDate);
        date.#hasDate = false;
        date.#offset = null;
        return date;
      }
    };
  }
});

// node_modules/smol-toml/dist/error.js
function getLineColFromPtr(string, ptr) {
  let lines = string.slice(0, ptr).split(/\r\n|\n|\r/g);
  return [lines.length, lines.pop().length + 1];
}
function makeCodeBlock(string, line, column) {
  let lines = string.split(/\r\n|\n|\r/g);
  let codeblock = "";
  let numberLen = (Math.log10(line + 1) | 0) + 1;
  for (let i = line - 1; i <= line + 1; i++) {
    let l = lines[i - 1];
    if (!l)
      continue;
    codeblock += i.toString().padEnd(numberLen, " ");
    codeblock += ":  ";
    codeblock += l;
    codeblock += "\n";
    if (i === line) {
      codeblock += " ".repeat(numberLen + column + 2);
      codeblock += "^\n";
    }
  }
  return codeblock;
}
var TomlError;
var init_error = __esm({
  "node_modules/smol-toml/dist/error.js"() {
    TomlError = class extends Error {
      line;
      column;
      codeblock;
      constructor(message, options) {
        const [line, column] = getLineColFromPtr(options.toml, options.ptr);
        const codeblock = makeCodeBlock(options.toml, line, column);
        super(`Invalid TOML document: ${message}

${codeblock}`, options);
        this.line = line;
        this.column = column;
        this.codeblock = codeblock;
      }
    };
  }
});

// node_modules/smol-toml/dist/util.js
function indexOfNewline(str, start = 0) {
  let idx = str.indexOf("\n", start);
  if (str.charCodeAt(idx - 1) === 13)
    idx--;
  return idx;
}
function skipComment(ctx) {
  for (; ctx.p < ctx.s.length; ctx.p++) {
    let c = ctx.s.charCodeAt(ctx.p);
    if (c === 10)
      break;
    if (c === 13 && ctx.s.charCodeAt(ctx.p + 1) === 10) {
      ctx.p++;
      break;
    }
    if (c < 32 && c !== 9 || c === 127) {
      throw new TomlError("control characters are not allowed in comments", {
        toml: ctx.s,
        ptr: ctx.p
      });
    }
  }
}
function skipVoid(ctx, banNewLines, banComments) {
  let c;
  while (1) {
    while ((c = ctx.s.charCodeAt(ctx.p)) === 32 || c === 9 || !banNewLines && (c === 10 || c === 13 && ctx.s.charCodeAt(ctx.p + 1) === 10))
      ctx.p++;
    if (banComments || c !== 35)
      break;
    skipComment(ctx);
  }
}
function skipUntil(ctx, sep, end) {
  let ptr = ctx.p;
  if (!end) {
    ptr = indexOfNewline(ctx.s, ptr);
    ctx.p = ptr < 0 ? ctx.s.length : ptr;
    return;
  }
  for (; ctx.p < ctx.s.length; ctx.p++) {
    let c = ctx.s.charCodeAt(ctx.p);
    if (c === 35) {
      skipComment(ctx);
    } else if (c === end || c === sep) {
      return;
    }
  }
  throw new TomlError("cannot find end of structure", {
    toml: ctx.s,
    ptr
  });
}
var init_util = __esm({
  "node_modules/smol-toml/dist/util.js"() {
    init_error();
  }
});

// node_modules/smol-toml/dist/primitive.js
function parseString(ctx) {
  let start = ctx.p;
  let c = ctx.s.charCodeAt(ctx.p++);
  let first = c;
  let isLiteral = c === 39;
  let isMultiline = c === ctx.s.charCodeAt(ctx.p) && c === ctx.s.charCodeAt(ctx.p + 1);
  if (isMultiline) {
    if ((c = ctx.s.charCodeAt(ctx.p += 2)) === 10)
      ctx.p++;
    else if (c === 13 && ctx.s.charCodeAt(ctx.p + 1) === 10)
      ctx.p += 2;
  }
  let parsed = "";
  let sliceStart = ctx.p;
  let state = 0;
  for (; ctx.p < ctx.s.length; ctx.p++) {
    c = ctx.s.charCodeAt(ctx.p);
    if (isMultiline && (c === 10 || c === 13 && ctx.s.charCodeAt(ctx.p + 1) === 10)) {
      state = state && 3;
    } else if (c < 32 && c !== 9 || c === 127) {
      throw new TomlError("control characters are not allowed in strings", {
        toml: ctx.s,
        ptr: ctx.p
      });
    } else if ((!state || state === 3) && c === first && (!isMultiline || ctx.s.charCodeAt(ctx.p + 1) === first && ctx.s.charCodeAt(ctx.p + 2) === first)) {
      if (isMultiline) {
        if (ctx.s.charCodeAt(ctx.p + 3) === first)
          ctx.p++;
        if (ctx.s.charCodeAt(ctx.p + 3) === first)
          ctx.p++;
      }
      if (!state)
        parsed += ctx.s.slice(sliceStart, ctx.p);
      ctx.p += isMultiline ? 3 : 1;
      return parsed;
    } else if (!state) {
      if (!isLiteral && c === 92) {
        parsed += ctx.s.slice(sliceStart, sliceStart = ctx.p);
        state = 1;
      }
    } else if (state === 1) {
      if (c === 120 || c === 117 || c === 85) {
        let value = 0;
        let len = c === 120 ? 2 : c === 117 ? 4 : 8;
        for (let j = 0; j < len; j++, ctx.p++) {
          let hex = ctx.s.charCodeAt(ctx.p + 1);
          let digit = (
            /* 0-9 */
            hex >= 48 && hex <= 57 ? hex - 48 : (
              /* A-F */
              hex >= 65 && hex <= 70 ? hex - 65 + 10 : (
                /* a-f */
                hex >= 97 && hex <= 102 ? hex - 97 + 10 : -1
              )
            )
          );
          if (digit < 0)
            throw new TomlError("invalid non-hex character in unicode escape", { toml: ctx.s, ptr: ctx.p + 1 });
          value = value << 4 | digit;
        }
        if (value < 0 || value > 1114111 || value >= 55296 && value <= 57343) {
          throw new TomlError("invalid unicode escape", { toml: ctx.s, ptr: ctx.p });
        }
        parsed += String.fromCodePoint(value);
        sliceStart = ctx.p + 1;
        state = 0;
      } else if (c === 32 || c === 9) {
        state = 2;
      } else {
        if (c === 98)
          parsed += "\b";
        else if (c === 116)
          parsed += "	";
        else if (c === 110)
          parsed += "\n";
        else if (c === 102)
          parsed += "\f";
        else if (c === 114)
          parsed += "\r";
        else if (c === 101)
          parsed += "\x1B";
        else if (c === 34)
          parsed += '"';
        else if (c === 92)
          parsed += "\\";
        else
          throw new TomlError("unrecognized escape sequence", { toml: ctx.s, ptr: ctx.p });
        sliceStart = ctx.p + 1;
        state = 0;
      }
    } else if (c !== 32 && c !== 9) {
      if (state === 2) {
        throw new TomlError("invalid escape: only line-ending whitespace may be escaped", {
          toml: ctx.s,
          ptr: sliceStart
        });
      }
      state = !isLiteral && c === 92 ? 1 : 0;
      sliceStart = ctx.p;
    }
  }
  throw new TomlError("unfinished string", { toml: ctx.s, ptr: start });
}
function sliceAndTrimEndOf(ctx, start, end) {
  let value = ctx.s.slice(start, end);
  let commentIdx = value.indexOf("#");
  if (commentIdx > 0) {
    skipComment({ s: value, p: commentIdx, d: 0 });
    value = value.slice(0, commentIdx);
  }
  return value.trimEnd();
}
function parseValue(ctx, integersAsBigInt, end) {
  let ptr = ctx.p;
  let err = { toml: ctx.s, ptr };
  skipUntil(ctx, 44, end);
  let value = sliceAndTrimEndOf(ctx, ptr, ctx.p);
  if (!value)
    throw new TomlError("incomplete declaration: value expected", err);
  if (value === "-inf")
    return -Infinity;
  if (value === "inf" || value === "+inf")
    return Infinity;
  if (value === "nan" || value === "+nan" || value === "-nan")
    return NaN;
  if (value === "-0")
    return integersAsBigInt ? 0n : 0;
  let isInt = INT_REGEX.test(value);
  if (isInt || FLOAT_REGEX.test(value)) {
    if (LEADING_ZERO.test(value)) {
      throw new TomlError("leading zeroes are not allowed", err);
    }
    value = value.replace(/_/g, "");
    let numeric = +value;
    if (isNaN(numeric)) {
      throw new TomlError("invalid number", err);
    }
    if (isInt) {
      if ((isInt = !Number.isSafeInteger(numeric)) && !integersAsBigInt) {
        throw new TomlError("integer value cannot be represented losslessly", err);
      }
      if (isInt || integersAsBigInt === true)
        numeric = BigInt(value);
    }
    return numeric;
  }
  const date = new TomlDate(value);
  if (!date.isValid())
    throw new TomlError("invalid value", err);
  return date;
}
var INT_REGEX, FLOAT_REGEX, LEADING_ZERO;
var init_primitive = __esm({
  "node_modules/smol-toml/dist/primitive.js"() {
    init_date();
    init_error();
    init_util();
    INT_REGEX = /^((0x[0-9a-fA-F](_?[0-9a-fA-F])*)|(([+-]|0[ob])?\d(_?\d)*))$/;
    FLOAT_REGEX = /^[+-]?\d(_?\d)*(\.\d(_?\d)*)?([eE][+-]?\d(_?\d)*)?$/;
    LEADING_ZERO = /^[+-]?0[0-9_]/;
  }
});

// node_modules/smol-toml/dist/extract.js
function extractValue(ctx, end, integersAsBigInt) {
  let ptr = ctx.p;
  let c = ctx.s.charCodeAt(ptr);
  if (c === 91 || c === 123) {
    if (!ctx.d--) {
      throw new TomlError("document contains excessively nested structures. aborting.", {
        toml: ctx.s,
        ptr
      });
    }
    let value = c === 91 ? parseArray(ctx, integersAsBigInt) : parseInlineTable(ctx, integersAsBigInt);
    ctx.d++;
    return value;
  }
  if (c === 34 || c === 39) {
    return parseString(ctx);
  }
  if (c === 116) {
    if (ctx.s.charCodeAt(++ctx.p) !== 114 || ctx.s.charCodeAt(++ctx.p) !== 117 || ctx.s.charCodeAt(++ctx.p) !== 101)
      throw new TomlError("invalid value", { toml: ctx.s, ptr });
    ctx.p++;
    return true;
  }
  if (c === 102) {
    if (ctx.s.charCodeAt(++ctx.p) !== 97 || ctx.s.charCodeAt(++ctx.p) !== 108 || ctx.s.charCodeAt(++ctx.p) !== 115 || ctx.s.charCodeAt(++ctx.p) !== 101)
      throw new TomlError("invalid value", { toml: ctx.s, ptr });
    ctx.p++;
    return false;
  }
  return parseValue(ctx, integersAsBigInt, end);
}
var init_extract = __esm({
  "node_modules/smol-toml/dist/extract.js"() {
    init_primitive();
    init_struct();
    init_error();
  }
});

// node_modules/smol-toml/dist/struct.js
function parseKey(ctx, end = "=") {
  let start = ctx.p;
  let dot = start - 1;
  let parsed = [];
  let endPtr = ctx.s.indexOf(end, start);
  if (endPtr < 0) {
    throw new TomlError("incomplete key-value: cannot find end of key", {
      toml: ctx.s,
      ptr: start
    });
  }
  do {
    let c = ctx.s.charCodeAt(ctx.p = ++dot);
    if (c !== 32 && c !== 9) {
      if (c === 34 || c === 39) {
        if (c === ctx.s.charCodeAt(ctx.p + 1) && c === ctx.s.charCodeAt(ctx.p + 2)) {
          throw new TomlError("multiline strings are not allowed in keys", {
            toml: ctx.s,
            ptr: ctx.p
          });
        }
        let part = parseString(ctx);
        dot = ctx.s.indexOf(".", ctx.p);
        let strEnd = ctx.s.slice(ctx.p, dot < 0 || dot > endPtr ? endPtr : dot);
        let newLine = indexOfNewline(strEnd);
        if (newLine > -1) {
          throw new TomlError("newlines are not allowed in keys", {
            toml: ctx.s,
            ptr: newLine
          });
        }
        if (strEnd.trimStart()) {
          throw new TomlError("found extra tokens after the string part", {
            toml: ctx.s,
            ptr: ctx.p
          });
        }
        if (endPtr < ctx.p) {
          endPtr = ctx.s.indexOf(end, ctx.p);
          if (endPtr < 0) {
            throw new TomlError("incomplete key-value: cannot find end of key", {
              toml: ctx.s,
              ptr: start
            });
          }
        }
        parsed.push(part);
      } else {
        dot = ctx.s.indexOf(".", ctx.p);
        let part = ctx.s.slice(ctx.p, dot < 0 || dot > endPtr ? endPtr : dot);
        if (!KEY_PART_RE.test(part)) {
          throw new TomlError("only letter, numbers, dashes and underscores are allowed in keys", {
            toml: ctx.s,
            ptr: ctx.p
          });
        }
        parsed.push(part.trimEnd());
      }
    }
  } while (dot + 1 && dot < endPtr);
  ctx.p = endPtr + 1;
  skipVoid(ctx, true, true);
  return parsed;
}
function parseInlineTable(ctx, integersAsBigInt) {
  let res = {};
  let seen = /* @__PURE__ */ new Set();
  let c;
  ctx.p++;
  while (ctx.p < ctx.s.length) {
    skipVoid(ctx);
    if ((c = ctx.s.charCodeAt(ctx.p)) === 125) {
      ctx.p++;
      return res;
    }
    let k;
    let t = res;
    let hasOwn = false;
    let p = ctx.p;
    let key = parseKey(ctx);
    for (let i = 0; i < key.length; i++) {
      if (i)
        t = hasOwn ? t[k] : t[k] = {};
      k = key[i];
      if ((hasOwn = Object.hasOwn(t, k)) && (typeof t[k] !== "object" || seen.has(t[k]))) {
        throw new TomlError("trying to redefine an already defined value", {
          toml: ctx.s,
          ptr: p
        });
      }
      if (!hasOwn && k === "__proto__") {
        Object.defineProperty(t, k, { enumerable: true, configurable: true, writable: true });
      }
    }
    if (hasOwn) {
      throw new TomlError("trying to redefine an already defined value", {
        toml: ctx.s,
        ptr: ctx.p
      });
    }
    let value = extractValue(ctx, 125, integersAsBigInt);
    seen.add(t[k] = value);
    skipVoid(ctx);
    if ((c = ctx.s.charCodeAt(ctx.p++)) === 125) {
      return res;
    }
    if (c !== 44) {
      throw new TomlError("expected comma or end of structure", { toml: ctx.s, ptr: ctx.p - 1 });
    }
  }
  throw new TomlError("unfinished table encountered", {
    toml: ctx.s,
    ptr: ctx.p
  });
}
function parseArray(ctx, integersAsBigInt) {
  let res = [];
  let c;
  ctx.p++;
  while (ctx.p < ctx.s.length) {
    skipVoid(ctx);
    if ((c = ctx.s.charCodeAt(ctx.p)) === 93) {
      ctx.p++;
      return res;
    }
    res.push(extractValue(ctx, 93, integersAsBigInt));
    skipVoid(ctx);
    if ((c = ctx.s.charCodeAt(ctx.p++)) === 93) {
      return res;
    }
    if (c !== 44) {
      throw new TomlError("expected comma or end of structure", { toml: ctx.s, ptr: ctx.p - 1 });
    }
  }
  throw new TomlError("unfinished array encountered", {
    toml: ctx.s,
    ptr: ctx.p
  });
}
var KEY_PART_RE;
var init_struct = __esm({
  "node_modules/smol-toml/dist/struct.js"() {
    init_primitive();
    init_extract();
    init_util();
    init_error();
    KEY_PART_RE = /^[a-zA-Z0-9-_]+[ \t]*$/;
  }
});

// node_modules/smol-toml/dist/parse.js
function peekTable(key, table, meta, type) {
  let t = table;
  let m = meta;
  let k;
  let hasOwn = false;
  let state;
  for (let i = 0; i < key.length; i++) {
    if (i) {
      t = hasOwn ? t[k] : t[k] = {};
      m = (state = m[k]).c;
      if (type === 0 && (state.t === 1 || state.t === 2)) {
        return null;
      }
      if (state.t === 2) {
        let l = t.length - 1;
        t = t[l];
        m = m[l].c;
      }
    }
    k = key[i];
    if ((hasOwn = Object.hasOwn(t, k)) && m[k]?.t === 0 && m[k]?.d) {
      return null;
    }
    if (!hasOwn) {
      if (k === "__proto__") {
        Object.defineProperty(t, k, { enumerable: true, configurable: true, writable: true });
        Object.defineProperty(m, k, { enumerable: true, configurable: true, writable: true });
      }
      m[k] = {
        t: i < key.length - 1 && type === 2 ? 3 : type,
        d: false,
        i: 0,
        c: {}
      };
    }
  }
  state = m[k];
  if (state.t !== type && !(type === 1 && state.t === 3)) {
    return null;
  }
  if (type === 2) {
    if (!state.d) {
      state.d = true;
      t[k] = [];
    }
    t[k].push(t = {});
    state.c[state.i++] = state = { t: 1, d: false, i: 0, c: {} };
  }
  if (state.d) {
    return null;
  }
  state.d = true;
  if (type === 1) {
    t = hasOwn ? t[k] : t[k] = {};
  } else if (type === 0 && hasOwn) {
    return null;
  }
  return [k, t, state.c];
}
function parse(toml, { maxDepth = 1e3, integersAsBigInt } = {}) {
  let ctx = { s: toml, p: 0, d: maxDepth };
  let res = {};
  let meta = {};
  let tmp;
  let tbl = res;
  let m = meta;
  skipVoid(ctx);
  while (ctx.p < toml.length) {
    if (toml.charCodeAt(ctx.p) === 91) {
      let isTableArray = toml.charCodeAt(++ctx.p) === 91;
      tmp = ctx.p += +isTableArray;
      let k = parseKey(ctx, "]");
      if (isTableArray) {
        if (toml.charCodeAt(ctx.p - 1) !== 93) {
          throw new TomlError("expected end of table declaration", {
            toml,
            ptr: ctx.p - 1
          });
        }
        ctx.p++;
      }
      let p = peekTable(
        k,
        res,
        meta,
        isTableArray ? 2 : 1
        /* Type.EXPLICIT */
      );
      if (!p) {
        throw new TomlError("trying to redefine an already defined table or value", {
          toml,
          ptr: tmp
        });
      }
      m = p[2];
      tbl = p[1];
    } else {
      tmp = ctx.p;
      let k = parseKey(ctx);
      let p = peekTable(
        k,
        tbl,
        m,
        0
        /* Type.DOTTED */
      );
      if (!p) {
        throw new TomlError("trying to redefine an already defined table or value", {
          toml,
          ptr: tmp
        });
      }
      p[1][p[0]] = extractValue(ctx, void 0, integersAsBigInt);
    }
    skipVoid(ctx, true);
    if (ctx.p < toml.length && (tmp = toml.charCodeAt(ctx.p)) !== 10 && tmp !== 13) {
      throw new TomlError("each key-value declaration must be followed by an end-of-line", {
        toml,
        ptr: ctx.p
      });
    }
    skipVoid(ctx);
  }
  return res;
}
var init_parse = __esm({
  "node_modules/smol-toml/dist/parse.js"() {
    init_struct();
    init_extract();
    init_util();
    init_error();
  }
});

// node_modules/smol-toml/dist/stringify.js
var init_stringify = __esm({
  "node_modules/smol-toml/dist/stringify.js"() {
  }
});

// node_modules/smol-toml/dist/index.js
var init_dist = __esm({
  "node_modules/smol-toml/dist/index.js"() {
    init_parse();
    init_stringify();
    init_date();
    init_error();
  }
});

// src/ccswitch.ts
var ccswitch_exports = {};
__export(ccswitch_exports, {
  defaultCcSwitchDbPath: () => defaultCcSwitchDbPath,
  fetchCcSwitchProviderModels: () => fetchCcSwitchProviderModels,
  fetchOpenAiCompatibleModels: () => fetchOpenAiCompatibleModels,
  loadCcSwitchProviders: () => loadCcSwitchProviders,
  normalizeApiFormat: () => normalizeApiFormat,
  normalizeOpenAiBaseUrl: () => normalizeOpenAiBaseUrl,
  openAiModelsUrl: () => openAiModelsUrl,
  probeOpenAiCompatibleModel: () => probeOpenAiCompatibleModel,
  resolveCcSwitchDbPath: () => resolveCcSwitchDbPath,
  resolveCcSwitchProviderRuntime: () => resolveCcSwitchProviderRuntime
});
function asRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value : null;
}
function textValue(value) {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "bigint") {
    return String(value);
  }
  return "";
}
function numberValue(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "bigint") {
    const converted = Number(value);
    return Number.isSafeInteger(converted) ? converted : null;
  }
  return null;
}
function normalizeKey(value) {
  return value.replaceAll("-", "").replaceAll("_", "").toLowerCase();
}
function keyMatches(normalizedKey, acceptedKeys) {
  if (acceptedKeys.has(normalizedKey)) return true;
  if (acceptedKeys.has("baseurl") && normalizedKey.endsWith("baseurl")) {
    return true;
  }
  return acceptedKeys.has("model") && normalizedKey.endsWith("model");
}
function findTextByKey(root, acceptedKeys) {
  const record = asRecord(root);
  if (!record) return "";
  for (const [key, value] of Object.entries(record)) {
    if (keyMatches(normalizeKey(key), acceptedKeys)) {
      const candidate = textValue(value);
      if (candidate) return candidate;
    }
  }
  for (const value of Object.values(record)) {
    const nested = findTextByKey(value, acceptedKeys);
    if (nested) return nested;
  }
  return "";
}
function isSecretValueKey(key) {
  const normalized = normalizeKey(key);
  if (normalized.endsWith("envkey")) return false;
  return [
    "apikey",
    "authtoken",
    "accesstoken",
    "bearertoken",
    "password",
    "secret",
    "token"
  ].some((suffix) => normalized.endsWith(suffix));
}
function findSecretValue(root) {
  const record = asRecord(root);
  if (!record) return "";
  for (const [key, value] of Object.entries(record)) {
    if (isSecretValueKey(key)) {
      const candidate = textValue(value);
      if (candidate) return candidate;
    }
  }
  for (const value of Object.values(record)) {
    const nested = findSecretValue(value);
    if (nested) return nested;
  }
  return "";
}
function findEnvironmentSecret(root) {
  const record = asRecord(root);
  if (!record) return "";
  for (const [key, value] of Object.entries(record)) {
    if (normalizeKey(key).endsWith("envkey")) {
      const environmentName = textValue(value);
      if (environmentName) {
        const secret = process.env[environmentName]?.trim();
        if (secret) return secret;
      }
    }
  }
  for (const value of Object.values(record)) {
    const nested = findEnvironmentSecret(value);
    if (nested) return nested;
  }
  return "";
}
function parseJsonRecord(value) {
  if (typeof value !== "string") return null;
  try {
    return asRecord(JSON.parse(value));
  } catch {
    return null;
  }
}
function parseTomlRecord(value) {
  if (!value.trim()) return {};
  try {
    return asRecord(parse(value)) ?? {};
  } catch {
    return {};
  }
}
function selectedCodexProvider(toml) {
  const providers = asRecord(toml.model_providers);
  if (!providers) return null;
  const selectedName = textValue(toml.model_provider);
  const selected = selectedName ? asRecord(providers[selectedName]) : null;
  if (selected) return selected;
  return Object.values(providers).map(asRecord).find((provider) => findTextByKey(provider, BASE_URL_KEYS)) ?? null;
}
function selectedGrokModel(toml) {
  const models = asRecord(toml.models);
  const modelName = textValue(models?.default);
  const modelTable = asRecord(toml.model);
  return {
    model: modelName,
    config: modelName && modelTable ? asRecord(modelTable[modelName]) : null
  };
}
function collectMaskedEnvironment(settings) {
  const result = {};
  for (const sectionName of ["env", "auth"]) {
    const section = asRecord(settings[sectionName]);
    if (!section) continue;
    for (const [key, rawValue] of Object.entries(section)) {
      const value = textValue(rawValue);
      if (!value) continue;
      result[key] = isSecretValueKey(key) ? "******" : normalizeKey(key).endsWith("baseurl") ? sanitizeUrlForDisplay(value) : value;
    }
  }
  return result;
}
function extractProviderConfig(settingsRaw, metadataRaw, appType) {
  const settings = parseJsonRecord(settingsRaw);
  const parsedSettings = settings ?? {};
  const metadata = parseJsonRecord(metadataRaw) ?? {};
  const toml = parseTomlRecord(textValue(parsedSettings.config));
  const codexProvider = selectedCodexProvider(toml);
  const grokModel = selectedGrokModel(toml);
  const apiKeySources = [
    parsedSettings,
    codexProvider,
    grokModel.config,
    toml
  ];
  const directApiKey = apiKeySources.map(findSecretValue).find(Boolean) ?? "";
  const environmentApiKey = apiKeySources.map(findEnvironmentSecret).find(Boolean) ?? "";
  const apiKey = directApiKey || environmentApiKey;
  const preferredConfigSources = [codexProvider, grokModel.config, parsedSettings];
  const baseUrl = [...preferredConfigSources, toml].map((value) => findTextByKey(value, BASE_URL_KEYS)).find(Boolean) ?? "";
  const model = textValue(toml.model) || grokModel.model || findTextByKey(parsedSettings, MODEL_KEYS) || findTextByKey(codexProvider, MODEL_KEYS);
  const apiFormat = normalizeApiFormat(
    findTextByKey(metadata, FORMAT_KEYS) || findTextByKey(codexProvider, FORMAT_KEYS) || findTextByKey(grokModel.config, FORMAT_KEYS) || findTextByKey(parsedSettings, FORMAT_KEYS) || (appType.toLowerCase().startsWith("claude") ? "anthropic_messages" : "chat_completions")
  );
  return {
    apiKey,
    baseUrl,
    model,
    apiFormat,
    maskedEnv: collectMaskedEnvironment(parsedSettings),
    parseError: Boolean(settingsRaw.trim() && !settings)
  };
}
function safeConfigSummary(config) {
  return JSON.stringify({
    baseUrl: sanitizeUrlForDisplay(config.baseUrl) || null,
    model: config.model || null,
    apiFormat: config.apiFormat,
    environment: config.maskedEnv,
    apiKeyConfigured: Boolean(config.apiKey)
  });
}
function sanitizeUrlForDisplay(value) {
  try {
    const url = new URL(value);
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return value ? "[configured URL]" : "";
  }
}
function tryNormalizeBaseUrl(value) {
  try {
    return normalizeOpenAiBaseUrl(value);
  } catch {
    return "";
  }
}
function normalizeApiFormat(value) {
  if (typeof value !== "string") return "chat_completions";
  const normalized = value.trim().toLowerCase().replaceAll("-", "_");
  if (["anthropic", "anthropic_messages", "messages"].includes(normalized)) {
    return "anthropic_messages";
  }
  if (["openai_responses", "response", "responses"].includes(normalized)) {
    return "responses";
  }
  return "chat_completions";
}
function defaultCcSwitchDbPath() {
  return (0, import_node_path.join)((0, import_node_os.homedir)(), ".cc-switch", "cc-switch.db");
}
function resolveCcSwitchDbPath(configuredPath) {
  const configured = configuredPath.trim();
  const expanded = configured.startsWith("~") ? (0, import_node_path.join)((0, import_node_os.homedir)(), configured.slice(1).replace(/^[/\\]+/, "")) : configured;
  return (0, import_node_path.resolve)(expanded || defaultCcSwitchDbPath());
}
function loadNodeSqlite() {
  try {
    return require("node:sqlite");
  } catch {
    throw new Error(
      "\u5F53\u524D Obsidian \u8FD0\u884C\u65F6\u4E0D\u652F\u6301 node:sqlite\uFF1B\u8BF7\u5207\u6362\u5230\u81EA\u5B9A\u4E49\u4F9B\u5E94\u5546\u6216\u5347\u7EA7 Obsidian"
    );
  }
}
function openDatabase(configuredPath) {
  const path = resolveCcSwitchDbPath(configuredPath);
  if ((0, import_node_path.extname)(path).toLowerCase() !== ".db") {
    throw new Error("cc-switch \u6570\u636E\u5E93\u8DEF\u5F84\u5FC5\u987B\u6307\u5411 .db \u6587\u4EF6");
  }
  if (!(0, import_node_fs.existsSync)(path)) {
    throw new Error("\u672A\u627E\u5230 cc-switch \u6570\u636E\u5E93");
  }
  const { DatabaseSync } = loadNodeSqlite();
  return {
    db: new DatabaseSync(path, { readOnly: true, timeout: 15e3 }),
    path
  };
}
function loadCcSwitchProviders(configuredPath = "") {
  const { db, path } = openDatabase(configuredPath);
  try {
    const rows = db.prepare("SELECT * FROM providers").all();
    const providers = rows.map((row) => {
      const appType = textValue(row.app_type);
      const config = extractProviderConfig(
        textValue(row.settings_config),
        textValue(row.meta),
        appType
      );
      const baseUrl = tryNormalizeBaseUrl(config.baseUrl);
      return {
        id: textValue(row.id),
        appType,
        name: textValue(row.name) || textValue(row.id),
        category: textValue(row.category) || null,
        websiteUrl: sanitizeUrlForDisplay(textValue(row.website_url)) || null,
        notes: textValue(row.notes) || null,
        sortIndex: numberValue(row.sort_index),
        createdAt: numberValue(row.created_at),
        isCurrent: Number(row.is_current) === 1,
        baseUrl: baseUrl || null,
        model: config.model || null,
        apiFormat: config.apiFormat,
        maskedEnv: config.maskedEnv,
        configParseError: config.parseError,
        redactedSettingsConfig: safeConfigSummary(config),
        providerType: textValue(row.provider_type) || null,
        usable: Boolean(baseUrl && config.apiKey)
      };
    });
    providers.sort((left, right) => {
      const appTypeOrder = left.appType.localeCompare(right.appType, "en", {
        sensitivity: "base"
      });
      if (appTypeOrder !== 0) return appTypeOrder;
      const leftIndex = left.sortIndex ?? Number.MAX_SAFE_INTEGER;
      const rightIndex = right.sortIndex ?? Number.MAX_SAFE_INTEGER;
      if (leftIndex !== rightIndex) return leftIndex - rightIndex;
      return left.name.localeCompare(right.name, "zh-CN", {
        numeric: true,
        sensitivity: "base"
      });
    });
    return { dbPath: path, providers };
  } finally {
    db.close();
  }
}
function resolveCcSwitchProviderRuntime(options) {
  const { db } = openDatabase(options.dbPath ?? "");
  try {
    const rows = db.prepare("SELECT * FROM providers WHERE app_type = ?").all(options.appType);
    const row = options.followCurrent ? rows.find((item) => Number(item.is_current) === 1) : rows.find((item) => textValue(item.id) === (options.providerId ?? ""));
    if (!row) throw new Error("\u672A\u627E\u5230\u6240\u9009\u4F9B\u5E94\u5546");
    const appType = textValue(row.app_type);
    const config = extractProviderConfig(
      textValue(row.settings_config),
      textValue(row.meta),
      appType
    );
    const baseUrl = normalizeOpenAiBaseUrl(config.baseUrl);
    if (!config.apiKey) throw new Error("\u4F9B\u5E94\u5546\u7F3A\u5C11\u53EF\u7528\u7684 API Key");
    return {
      id: textValue(row.id),
      appType,
      name: textValue(row.name) || textValue(row.id),
      baseUrl,
      model: config.model || null,
      apiFormat: config.apiFormat,
      apiKey: config.apiKey
    };
  } finally {
    db.close();
  }
}
function normalizeOpenAiBaseUrl(value) {
  const trimmed = value.trim();
  if (!trimmed) throw new Error("\u4F9B\u5E94\u5546\u7F3A\u5C11 Base URL");
  let url;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error("\u4F9B\u5E94\u5546 Base URL \u65E0\u6548");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("\u4F9B\u5E94\u5546 Base URL \u5FC5\u987B\u4F7F\u7528 HTTP \u6216 HTTPS");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error("\u4F9B\u5E94\u5546 Base URL \u4E0D\u80FD\u5305\u542B\u51ED\u636E\u3001\u67E5\u8BE2\u53C2\u6570\u6216\u951A\u70B9");
  }
  const path = url.pathname.replace(/\/+$/, "");
  if (/\/(?:chat\/completions|responses|messages|models)$/i.test(path)) {
    throw new Error("\u4F9B\u5E94\u5546 Base URL \u5E94\u586B\u5199 API \u6839\u5730\u5740");
  }
  url.pathname = path || "/";
  return url.toString().replace(/\/$/, "");
}
function apiEndpoint(baseUrl, resource) {
  const base = normalizeOpenAiBaseUrl(baseUrl);
  return /\/v1$/i.test(base) ? `${base}/${resource}` : `${base}/v1/${resource}`;
}
function openAiModelsUrl(baseUrl) {
  return apiEndpoint(baseUrl, "models");
}
function authenticationHeaders(apiKey, apiFormat) {
  return apiFormat === "anthropic_messages" ? { "x-api-key": apiKey, "anthropic-version": "2023-06-01" } : { Authorization: `Bearer ${apiKey}` };
}
function modelIdsFromPayload(payload) {
  const record = asRecord(payload);
  const candidates = Array.isArray(payload) ? payload : Array.isArray(record?.data) ? record.data : Array.isArray(record?.models) ? record.models : [];
  const models = candidates.map((item) => {
    if (typeof item === "string") return item.trim();
    const model = asRecord(item);
    return textValue(model?.id) || textValue(model?.name) || textValue(model?.model);
  }).filter((model) => model.length > 0 && model.length <= 200);
  return [...new Set(models)].sort(
    (left, right) => left.localeCompare(right, "en", { numeric: true, sensitivity: "base" })
  );
}
function requestError() {
  return new Error("\u4F9B\u5E94\u5546\u8BF7\u6C42\u5931\u8D25\uFF0C\u8BF7\u68C0\u67E5\u7F51\u7EDC\u4E0E\u914D\u7F6E");
}
async function fetchOpenAiCompatibleModels(options) {
  const endpoint = openAiModelsUrl(options.baseUrl);
  const apiFormat = normalizeApiFormat(options.apiFormat);
  try {
    const response = await (0, import_obsidian.requestUrl)({
      url: endpoint,
      method: "GET",
      headers: {
        Accept: "application/json",
        ...authenticationHeaders(options.apiKey, apiFormat)
      },
      throw: false
    });
    if (response.status < 200 || response.status >= 300) throw requestError();
    const models = modelIdsFromPayload(response.json);
    return { endpoint, models };
  } catch {
    throw requestError();
  }
}
async function fetchCcSwitchProviderModels(options) {
  const runtime = resolveCcSwitchProviderRuntime({
    ...options,
    followCurrent: false
  });
  return fetchOpenAiCompatibleModels({
    baseUrl: runtime.baseUrl,
    apiKey: runtime.apiKey,
    apiFormat: normalizeApiFormat(runtime.apiFormat)
  });
}
async function probeOpenAiCompatibleModel(options) {
  const endpoint = options.apiFormat === "anthropic_messages" ? apiEndpoint(options.baseUrl, "messages") : options.apiFormat === "responses" ? apiEndpoint(options.baseUrl, "responses") : apiEndpoint(options.baseUrl, "chat/completions");
  const body = options.apiFormat === "anthropic_messages" ? {
    model: options.model,
    max_tokens: 1,
    messages: [{ role: "user", content: "ping" }]
  } : options.apiFormat === "responses" ? { model: options.model, input: "ping", max_output_tokens: 16 } : {
    model: options.model,
    messages: [{ role: "user", content: "ping" }],
    max_tokens: 1
  };
  try {
    const response = await (0, import_obsidian.requestUrl)({
      url: endpoint,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...authenticationHeaders(options.apiKey, options.apiFormat)
      },
      body: JSON.stringify(body),
      throw: false
    });
    if (response.status < 200 || response.status >= 300) throw requestError();
    return { endpoint, model: options.model };
  } catch {
    throw requestError();
  }
}
var import_node_fs, import_node_os, import_node_path, import_obsidian, BASE_URL_KEYS, MODEL_KEYS, FORMAT_KEYS;
var init_ccswitch = __esm({
  "src/ccswitch.ts"() {
    import_node_fs = require("node:fs");
    import_node_os = require("node:os");
    import_node_path = require("node:path");
    import_obsidian = require("obsidian");
    init_dist();
    BASE_URL_KEYS = /* @__PURE__ */ new Set(["baseurl", "apiurl", "endpoint"]);
    MODEL_KEYS = /* @__PURE__ */ new Set(["model", "defaultmodel"]);
    FORMAT_KEYS = /* @__PURE__ */ new Set(["apiformat", "wireapi", "protocol"]);
  }
});

// src/main.ts
var main_exports = {};
__export(main_exports, {
  default: () => VideoMemoPlugin
});
module.exports = __toCommonJS(main_exports);
var import_node_child_process = require("node:child_process");
var import_node_fs2 = require("node:fs");
var import_node_readline = require("node:readline");
var import_node_path2 = require("node:path");
var import_obsidian6 = require("obsidian");
init_ccswitch();

// src/run-progress.ts
var import_obsidian2 = require("obsidian");
var STATUS_KICKER = {
  running: "\u6B63\u5728\u5904\u7406",
  success: "\u5DF2\u5B8C\u6210",
  error: "\u5904\u7406\u5931\u8D25",
  cancelled: "\u5DF2\u53D6\u6D88"
};
var STATUS_BADGE = {
  running: "",
  success: "\u2713 \u5B8C\u6210",
  error: "\u2717 \u5931\u8D25",
  cancelled: "\u5DF2\u53D6\u6D88"
};
var RunProgressModal = class extends import_obsidian2.Modal {
  options;
  kickerEl = null;
  fillEl = null;
  percentEl = null;
  statusBadgeEl = null;
  stageEl = null;
  logEl = null;
  errorContainerEl = null;
  footerEl = null;
  renderedLogCount = 0;
  renderedStatus = null;
  constructor(app, options) {
    super(app);
    this.options = options;
  }
  onOpen() {
    this.modalEl.addClass("video-memo-shell");
    this.contentEl.addClass(
      "video-memo-modal",
      "video-memo-progress-modal"
    );
    const state = this.options.state;
    const titleRow = this.contentEl.createDiv({
      cls: "video-memo-title-row"
    });
    const titleCopy = titleRow.createDiv({ cls: "video-memo-title-copy" });
    this.kickerEl = titleCopy.createDiv({ cls: "video-memo-modal-kicker" });
    titleCopy.createEl("h2", {
      cls: "video-memo-progress-source",
      text: state.source,
      attr: { title: state.source }
    });
    titleCopy.createDiv({
      cls: "video-memo-modal-subtitle",
      text: state.providerLabel
    });
    const block = this.contentEl.createDiv({
      cls: "video-memo-progress-block"
    });
    const track = block.createDiv({ cls: "video-memo-progress-track" });
    this.fillEl = track.createDiv({ cls: "video-memo-progress-fill" });
    const meta = block.createDiv({ cls: "video-memo-progress-meta" });
    this.percentEl = meta.createSpan({ cls: "video-memo-progress-percent" });
    this.statusBadgeEl = meta.createSpan({ cls: "video-memo-progress-status" });
    this.stageEl = this.contentEl.createDiv({
      cls: "video-memo-progress-stage"
    });
    this.logEl = this.contentEl.createDiv({
      cls: "video-memo-progress-log",
      attr: { "aria-label": "\u8FD0\u884C\u65E5\u5FD7" }
    });
    this.errorContainerEl = this.contentEl.createDiv();
    this.footerEl = this.contentEl.createDiv({
      cls: "video-memo-progress-footer"
    });
    this.refresh();
  }
  refresh() {
    const state = this.options.state;
    if (!this.fillEl || !this.percentEl || !this.statusBadgeEl || !this.kickerEl || !this.stageEl || !this.logEl) {
      return;
    }
    this.kickerEl.setText(STATUS_KICKER[state.status]);
    const percent = Math.round(Math.max(0, Math.min(1, state.progress)) * 100);
    this.fillEl.style.width = `${percent}%`;
    this.fillEl.toggleClass("is-success", state.status === "success");
    this.fillEl.toggleClass("is-error", state.status === "error");
    this.fillEl.toggleClass("is-cancelled", state.status === "cancelled");
    this.percentEl.setText(`${percent}%`);
    this.statusBadgeEl.setText(STATUS_BADGE[state.status]);
    this.statusBadgeEl.toggleClass("is-success", state.status === "success");
    this.statusBadgeEl.toggleClass("is-error", state.status === "error");
    this.stageEl.setText(state.stage || "\u5904\u7406\u4E2D\u2026");
    this.appendNewLogLines(state);
    if (this.renderedStatus !== state.status) {
      this.renderedStatus = state.status;
      this.renderErrorBox(state);
      this.renderFooter(state);
    }
  }
  appendNewLogLines(state) {
    const logEl = this.logEl;
    if (!logEl) return;
    if (this.renderedLogCount > state.log.length) {
      logEl.empty();
      this.renderedLogCount = 0;
    }
    if (this.renderedLogCount === state.log.length) return;
    const nearBottom = logEl.scrollHeight - logEl.scrollTop - logEl.clientHeight < 48;
    for (const line of state.log.slice(this.renderedLogCount)) {
      logEl.createDiv({ cls: "video-memo-progress-log-line", text: line });
    }
    this.renderedLogCount = state.log.length;
    if (nearBottom) logEl.scrollTop = logEl.scrollHeight;
  }
  renderErrorBox(state) {
    const container = this.errorContainerEl;
    if (!container) return;
    container.empty();
    if (state.status !== "error" || !state.errorDetail.trim()) return;
    const box = container.createDiv({ cls: "video-memo-progress-error" });
    const head = box.createDiv({ cls: "video-memo-progress-error-head" });
    head.createSpan({ text: "\u9519\u8BEF\u8BE6\u60C5" });
    const copyButton = head.createEl("button", {
      cls: "clickable-icon",
      attr: { type: "button", "aria-label": "\u590D\u5236\u9519\u8BEF\u4FE1\u606F" }
    });
    (0, import_obsidian2.setIcon)(copyButton, "copy");
    copyButton.addEventListener("click", () => {
      void navigator.clipboard.writeText(state.errorDetail).then(() => new import_obsidian2.Notice("\u9519\u8BEF\u4FE1\u606F\u5DF2\u590D\u5236")).catch(() => new import_obsidian2.Notice("\u590D\u5236\u5931\u8D25\uFF0C\u8BF7\u624B\u52A8\u9009\u62E9\u9519\u8BEF\u4FE1\u606F"));
    });
    box.createEl("pre", { text: state.errorDetail.trim() });
  }
  renderFooter(state) {
    const footer = this.footerEl;
    if (!footer) return;
    footer.empty();
    const addButton = (label, onClick, variant = "") => {
      const button = footer.createEl("button", {
        text: label,
        attr: { type: "button" }
      });
      if (variant === "cta") button.addClass("mod-cta");
      if (variant === "warning") button.addClass("mod-warning");
      button.addEventListener("click", onClick);
      return button;
    };
    if (state.status === "running") {
      addButton("\u540E\u53F0\u8FD0\u884C", () => this.close());
      addButton("\u53D6\u6D88\u4EFB\u52A1", () => this.options.onCancel(), "warning");
      return;
    }
    if (state.status === "success" && state.notePath) {
      addButton("\u5173\u95ED", () => this.close());
      addButton(
        "\u6253\u5F00\u7B14\u8BB0",
        () => {
          this.options.onOpenNote();
          this.close();
        },
        "cta"
      );
      return;
    }
    addButton("\u5173\u95ED", () => this.close(), state.status === "success" ? "cta" : "");
  }
  onClose() {
    this.contentEl.empty();
    this.options.onClosed();
  }
};

// src/settings.ts
init_ccswitch();
var DEFAULT_SETTINGS = {
  projectPath: "",
  providerSource: "ccswitch",
  ccSwitchDbPath: "",
  ccSwitchAppType: "codex",
  ccSwitchFollowCurrent: true,
  ccSwitchProviderId: "",
  model: "",
  customProviders: [],
  activeCustomProviderId: "",
  targetFolder: "",
  cleanupMedia: false
};
function normalizeCustomProviders(raw) {
  if (!Array.isArray(raw)) return [];
  const seen = /* @__PURE__ */ new Set();
  const result = [];
  for (let index = 0; index < raw.length; index++) {
    const item = raw[index];
    if (!item || typeof item !== "object") continue;
    const name = typeof item.name === "string" ? item.name : "";
    const baseUrl = typeof item.baseUrl === "string" ? item.baseUrl : "";
    const apiKey = typeof item.apiKey === "string" ? item.apiKey : "";
    const model = typeof item.model === "string" ? item.model : "";
    const apiFormat = normalizeApiFormat(item.apiFormat);
    let id = typeof item.id === "string" && item.id ? item.id : `cp_${Date.now()}_${index}`;
    if (seen.has(id)) id = `${id}_${index}`;
    seen.add(id);
    result.push({ id, name, baseUrl, apiKey, model, apiFormat });
  }
  return result;
}
function sanitizeTargetFolder(value) {
  if (typeof value !== "string") return DEFAULT_SETTINGS.targetFolder;
  const cleaned = value.trim().replace(/[\\]+/g, "/").split("/").map((part) => part.trim()).filter((part) => part && part !== "." && part !== "..").join("/");
  if (!cleaned || /^[A-Za-z]:/.test(cleaned)) return DEFAULT_SETTINGS.targetFolder;
  return cleaned;
}
function normalizeSettings(stored) {
  const stringValue = (value, fallback) => typeof value === "string" ? value : fallback;
  const storedProviderSource = stored?.providerSource;
  const providerSource = storedProviderSource === "custom" ? "custom" : "ccswitch";
  let customProviders = normalizeCustomProviders(stored?.customProviders);
  const legacy = stored;
  const legacyBaseUrl = typeof legacy?.customProviderBaseUrl === "string" ? legacy.customProviderBaseUrl : "";
  const legacyApiKey = typeof legacy?.customProviderApiKey === "string" ? legacy.customProviderApiKey : "";
  if (customProviders.length === 0 && (legacyBaseUrl.trim() || legacyApiKey.trim())) {
    const migrated = {
      id: `cp_migrated_${Date.now()}`,
      name: typeof legacy?.customProviderName === "string" ? legacy.customProviderName : "\u5DF2\u8FC1\u79FB\u4F9B\u5E94\u5546",
      baseUrl: legacyBaseUrl,
      apiKey: legacyApiKey,
      model: typeof legacy?.customProviderModel === "string" ? legacy.customProviderModel : "",
      apiFormat: normalizeApiFormat(legacy?.customProviderApiFormat)
    };
    customProviders = [migrated];
  }
  const activeCustomProviderId = stringValue(
    stored?.activeCustomProviderId,
    customProviders[0]?.id ?? ""
  );
  const activeIdIsValid = customProviders.some((p) => p.id === activeCustomProviderId);
  return {
    projectPath: stringValue(stored?.projectPath, DEFAULT_SETTINGS.projectPath),
    providerSource,
    ccSwitchDbPath: stringValue(stored?.ccSwitchDbPath, DEFAULT_SETTINGS.ccSwitchDbPath),
    ccSwitchAppType: stringValue(stored?.ccSwitchAppType, DEFAULT_SETTINGS.ccSwitchAppType),
    ccSwitchFollowCurrent: typeof stored?.ccSwitchFollowCurrent === "boolean" ? stored.ccSwitchFollowCurrent : DEFAULT_SETTINGS.ccSwitchFollowCurrent,
    ccSwitchProviderId: stringValue(
      stored?.ccSwitchProviderId,
      DEFAULT_SETTINGS.ccSwitchProviderId
    ),
    model: stringValue(stored?.model, DEFAULT_SETTINGS.model),
    customProviders,
    activeCustomProviderId: activeIdIsValid ? activeCustomProviderId : customProviders[0]?.id ?? "",
    targetFolder: sanitizeTargetFolder(stored?.targetFolder),
    cleanupMedia: typeof stored?.cleanupMedia === "boolean" ? stored.cleanupMedia : DEFAULT_SETTINGS.cleanupMedia
  };
}
function activeCustomProvider(settings) {
  const list = settings.customProviders;
  if (list.length === 0) return null;
  return list.find((p) => p.id === settings.activeCustomProviderId) ?? list[0] ?? null;
}
function describeProviderSelection(settings) {
  if (settings.providerSource === "custom") {
    const provider = activeCustomProvider(settings);
    if (!provider) return "\u81EA\u5B9A\u4E49 \xB7 \u5C1A\u672A\u6DFB\u52A0\u4F9B\u5E94\u5546";
    const name = provider.name.trim() || "\u672A\u547D\u540D\u4F9B\u5E94\u5546";
    const model = provider.model.trim();
    if (!provider.baseUrl.trim() || !provider.apiKey.trim()) {
      return `\u81EA\u5B9A\u4E49 \xB7 ${name} \xB7 \u914D\u7F6E\u9700\u8981\u68C0\u67E5`;
    }
    return model ? `\u81EA\u5B9A\u4E49 \xB7 ${name} \xB7 \u6A21\u578B ${model}` : `\u81EA\u5B9A\u4E49 \xB7 ${name} \xB7 \u5C1A\u672A\u9009\u62E9\u6A21\u578B`;
  }
  try {
    const providers = loadCcSwitchProviders(settings.ccSwitchDbPath).providers;
    const provider = settings.ccSwitchFollowCurrent ? providers.find(
      (item) => item.appType === settings.ccSwitchAppType && item.isCurrent
    ) : providers.find(
      (item) => item.appType === settings.ccSwitchAppType && item.id === settings.ccSwitchProviderId
    );
    if (!provider) {
      return `cc-switch \xB7 ${settings.ccSwitchAppType} \xB7 \u914D\u7F6E\u9700\u8981\u68C0\u67E5`;
    }
    const mode = settings.ccSwitchFollowCurrent ? "\u8DDF\u968F\u5168\u5C40\u5F53\u524D" : "\u5DF2\u56FA\u5B9A";
    const model = settings.model || provider.model;
    return model ? `cc-switch \xB7 ${provider.name} \xB7 ${mode} \xB7 \u6A21\u578B ${model}` : `cc-switch \xB7 ${provider.name} \xB7 ${mode}`;
  } catch {
    return "cc-switch \xB7 \u65E0\u6CD5\u8BFB\u53D6\u6570\u636E\u5E93";
  }
}

// src/settings-tab.ts
var import_obsidian4 = require("obsidian");

// src/ccswitch-settings.ts
var import_obsidian3 = require("obsidian");
init_ccswitch();
var maskedKey = (value) => value.trim() ? `\u2022\u2022\u2022\u2022 ${value.trim().slice(-4)}` : "\u672A\u586B\u5199";
var freshId = () => `cp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
var displayBaseUrl = (value) => {
  try {
    const url = new URL(value);
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return value ? "\u5DF2\u914D\u7F6E\u5730\u5740" : "\u672A\u8BC6\u522B Base URL";
  }
};
var ProviderEditorModal = class extends import_obsidian3.Modal {
  constructor(app, provider, save) {
    super(app);
    this.save = save;
    this.draft = provider ? { ...provider } : {
      id: freshId(),
      name: "",
      baseUrl: "",
      apiKey: "",
      model: "",
      apiFormat: "chat_completions"
    };
  }
  save;
  draft;
  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("video-memo-provider-editor");
    contentEl.createEl("h2", {
      text: this.draft.name ? "\u7F16\u8F91\u4F9B\u5E94\u5546" : "\u6DFB\u52A0\u4F9B\u5E94\u5546"
    });
    new import_obsidian3.Setting(contentEl).setName("\u540D\u79F0").addText(
      (x) => x.setValue(this.draft.name).onChange((v) => {
        this.draft.name = v.trim();
      })
    );
    new import_obsidian3.Setting(contentEl).setName("Base URL").addText(
      (x) => x.setPlaceholder("https://api.example.com").setValue(this.draft.baseUrl).onChange((v) => {
        this.draft.baseUrl = v.trim();
      })
    );
    new import_obsidian3.Setting(contentEl).setName("\u534F\u8BAE").addDropdown(
      (x) => x.addOptions({
        chat_completions: "Chat Completions",
        responses: "Responses",
        anthropic_messages: "Anthropic Messages"
      }).setValue(this.draft.apiFormat).onChange((v) => {
        this.draft.apiFormat = normalizeApiFormat(v);
      })
    );
    new import_obsidian3.Setting(contentEl).setName("API Key").setDesc(`\u5F53\u524D\uFF1A${maskedKey(this.draft.apiKey)}`).addText((x) => {
      x.inputEl.type = "password";
      x.setPlaceholder(
        this.draft.apiKey ? "\u8F93\u5165\u65B0\u503C\u6216\u4FDD\u7559\u73B0\u503C" : "\u8F93\u5165\u5BC6\u94A5"
      ).onChange((v) => {
        if (v) this.draft.apiKey = v.trim();
      });
    });
    const modelSetting = new import_obsidian3.Setting(contentEl).setName("\u6A21\u578B").addText(
      (x) => x.setValue(this.draft.model).onChange((v) => {
        this.draft.model = v.trim();
      })
    );
    const results = contentEl.createDiv({
      cls: "video-memo-provider-model-results"
    });
    new import_obsidian3.Setting(contentEl).addButton(
      (button) => button.setButtonText("\u53D1\u73B0\u6A21\u578B").onClick(async () => {
        button.setDisabled(true);
        results.empty();
        try {
          const response = await fetchOpenAiCompatibleModels(this.draft);
          if (!response.models.length) {
            results.setText("\u670D\u52A1\u672A\u8FD4\u56DE\u6A21\u578B\u5217\u8868");
            return;
          }
          new import_obsidian3.Setting(results).setName("\u53EF\u7528\u6A21\u578B").addDropdown((dropdown) => {
            dropdown.addOption("", "\u9009\u62E9\u6A21\u578B");
            for (const model of response.models)
              dropdown.addOption(model, model);
            dropdown.onChange((value) => {
              if (value) {
                this.draft.model = value;
                const input = modelSetting.controlEl.querySelector("input");
                if (input) input.value = value;
              }
            });
          });
        } catch {
          new import_obsidian3.Notice("\u6A21\u578B\u53D1\u73B0\u5931\u8D25\uFF0C\u8BF7\u68C0\u67E5\u914D\u7F6E");
        } finally {
          button.setDisabled(false);
        }
      })
    ).addButton(
      (button) => button.setButtonText("\u6D4B\u8BD5\u8FDE\u63A5").onClick(async () => {
        if (!this.valid()) return;
        button.setDisabled(true);
        try {
          await probeOpenAiCompatibleModel(this.draft);
          new import_obsidian3.Notice("\u8FDE\u63A5\u6D4B\u8BD5\u6210\u529F");
        } catch {
          new import_obsidian3.Notice("\u8FDE\u63A5\u6D4B\u8BD5\u5931\u8D25\uFF0C\u8BF7\u68C0\u67E5\u914D\u7F6E");
        } finally {
          button.setDisabled(false);
        }
      })
    );
    new import_obsidian3.Setting(contentEl).addButton((b) => b.setButtonText("\u53D6\u6D88").onClick(() => this.close())).addButton(
      (b) => b.setCta().setButtonText("\u4FDD\u5B58").onClick(async () => {
        if (!this.valid()) return;
        b.setDisabled(true);
        await this.save({ ...this.draft });
        this.close();
      })
    );
  }
  valid() {
    if (!this.draft.name || !this.draft.baseUrl || !this.draft.apiKey || !this.draft.model) {
      new import_obsidian3.Notice("\u8BF7\u586B\u5199\u540D\u79F0\u3001Base URL\u3001API Key \u548C\u6A21\u578B");
      return false;
    }
    try {
      const u = new URL(this.draft.baseUrl);
      if (u.protocol !== "https:" && u.hostname !== "localhost" && u.hostname !== "127.0.0.1")
        throw new Error();
    } catch {
      new import_obsidian3.Notice("Base URL \u5FC5\u987B\u662F HTTPS\uFF0C\u6216\u672C\u673A\u5730\u5740");
      return false;
    }
    return true;
  }
  onClose() {
    this.contentEl.empty();
  }
};
var CcSwitchProviderSettingsView = class {
  constructor(options) {
    this.options = options;
  }
  options;
  showProviderList() {
  }
  render(parent) {
    parent.addClass("video-memo-provider-view");
    const settings = this.options.getSettings();
    new import_obsidian3.Setting(parent).setClass("video-memo-provider-header").setName("\u4F9B\u5E94\u5546\u8BBE\u7F6E").addExtraButton(
      (b) => b.setIcon("arrow-left").setTooltip("\u8FD4\u56DE").onClick(this.options.onBack)
    );
    new import_obsidian3.Setting(parent).setName("\u914D\u7F6E\u6765\u6E90").setClass("video-memo-provider-source").addDropdown(
      (d) => d.addOptions({
        ccswitch: "cc-switch \u6570\u636E\u5E93",
        custom: "\u81EA\u5B9A\u4E49\u4F9B\u5E94\u5546"
      }).setValue(settings.providerSource).onChange(async (v) => {
        await this.options.updateSettings({
          providerSource: v
        });
        this.options.rerender();
      })
    );
    if (settings.providerSource === "custom")
      this.renderCustom(parent, settings);
    else this.renderCcSwitch(parent, settings);
    return true;
  }
  renderCustom(parent, settings) {
    new import_obsidian3.Setting(parent).setClass("video-memo-provider-custom-toolbar").setName("\u81EA\u5B9A\u4E49\u4F9B\u5E94\u5546").setDesc("\u5BC6\u94A5\u4EC5\u4EE5\u63A9\u7801\u663E\u793A").addButton(
      (b) => b.setButtonText("\u6DFB\u52A0").onClick(() => this.openEditor(null))
    );
    if (!settings.customProviders.length) {
      parent.createEl("p", {
        cls: "video-memo-provider-empty",
        text: "\u5C1A\u672A\u6DFB\u52A0\u4F9B\u5E94\u5546\u3002"
      });
      return;
    }
    for (const provider of settings.customProviders) {
      const active = provider.id === settings.activeCustomProviderId;
      new import_obsidian3.Setting(parent).setClass("video-memo-provider-custom-row").setName(`${active ? "\u5F53\u524D \xB7 " : ""}${provider.name || "\u672A\u547D\u540D"}`).setDesc(
        `${provider.model || "\u672A\u9009\u6A21\u578B"} \xB7 ${displayBaseUrl(provider.baseUrl)} \xB7 ${maskedKey(provider.apiKey)}`
      ).addButton(
        (b) => b.setButtonText(active ? "\u5DF2\u9009\u62E9" : "\u9009\u62E9").setDisabled(active).onClick(async () => {
          await this.options.updateSettings({
            activeCustomProviderId: provider.id
          });
          this.options.rerender();
        })
      ).addExtraButton(
        (b) => b.setIcon("pencil").setTooltip("\u7F16\u8F91").onClick(() => this.openEditor(provider))
      ).addExtraButton(
        (b) => b.setIcon("trash").setTooltip("\u5220\u9664").onClick(async () => {
          const list = settings.customProviders.filter(
            (x) => x.id !== provider.id
          );
          await this.options.updateSettings({
            customProviders: list,
            activeCustomProviderId: list[0]?.id || ""
          });
          this.options.rerender();
        })
      );
    }
  }
  openEditor(provider) {
    new ProviderEditorModal(this.options.app, provider, async (value) => {
      const settings = this.options.getSettings();
      const exists = settings.customProviders.some((x) => x.id === value.id);
      const customProviders = exists ? settings.customProviders.map((x) => x.id === value.id ? value : x) : [...settings.customProviders, value];
      await this.options.updateSettings({
        customProviders,
        activeCustomProviderId: settings.activeCustomProviderId || value.id
      });
      this.options.rerender();
    }).open();
  }
  renderCcSwitch(parent, settings) {
    new import_obsidian3.Setting(parent).setClass("video-memo-provider-database").setName("\u6570\u636E\u5E93\u6587\u4EF6").setDesc("\u7559\u7A7A\u4F7F\u7528 ~/.cc-switch/cc-switch.db").addText(
      (x) => x.setPlaceholder("\u9ED8\u8BA4\u8DEF\u5F84").setValue(settings.ccSwitchDbPath).onChange(async (v) => {
        await this.options.updateSettings({ ccSwitchDbPath: v.trim() });
      })
    );
    let providers;
    try {
      providers = loadCcSwitchProviders(settings.ccSwitchDbPath).providers;
    } catch {
      parent.createEl("p", {
        cls: "video-memo-provider-error",
        text: "\u65E0\u6CD5\u8BFB\u53D6\u6570\u636E\u5E93\u3002\u8BF7\u68C0\u67E5\u8DEF\u5F84\u6216 Obsidian \u7248\u672C\u3002"
      });
      return;
    }
    const appTypes = [...new Set(providers.map((x) => x.appType))];
    const appType = appTypes.includes(settings.ccSwitchAppType) ? settings.ccSwitchAppType : appTypes[0] || settings.ccSwitchAppType;
    new import_obsidian3.Setting(parent).setClass("video-memo-provider-app-type").setName("\u5E94\u7528\u7C7B\u578B").addDropdown((d) => {
      for (const v of appTypes) d.addOption(v, v);
      d.setValue(appType).onChange(async (v) => {
        await this.options.updateSettings({
          ccSwitchAppType: v,
          ccSwitchProviderId: "",
          model: ""
        });
        this.options.rerender();
      });
    });
    new import_obsidian3.Setting(parent).setClass("video-memo-provider-follow-current").setName("\u8DDF\u968F\u5168\u5C40\u5F53\u524D").addToggle(
      (t) => t.setValue(settings.ccSwitchFollowCurrent).onChange(async (v) => {
        await this.options.updateSettings({ ccSwitchFollowCurrent: v });
        this.options.rerender();
      })
    );
    const list = providers.filter((x) => x.appType === appType);
    if (!settings.ccSwitchFollowCurrent)
      new import_obsidian3.Setting(parent).setClass("video-memo-provider-fixed-selection").setName("\u56FA\u5B9A\u4F9B\u5E94\u5546").addDropdown((d) => {
        d.addOption("", "\u8BF7\u9009\u62E9");
        for (const p of list) d.addOption(p.id, p.name);
        d.setValue(settings.ccSwitchProviderId).onChange(async (v) => {
          await this.options.updateSettings({
            ccSwitchProviderId: v,
            model: ""
          });
          this.options.rerender();
        });
      });
    const selected = settings.ccSwitchFollowCurrent ? list.find((x) => x.isCurrent) : list.find((x) => x.id === settings.ccSwitchProviderId);
    if (!selected) {
      parent.createEl("p", {
        cls: "video-memo-provider-empty",
        text: "\u5F53\u524D\u6761\u4EF6\u4E0B\u6CA1\u6709\u53EF\u7528\u4F9B\u5E94\u5546\u3002"
      });
      return;
    }
    new import_obsidian3.Setting(parent).setClass("video-memo-provider-summary").setName(selected.name).setDesc(
      `${displayBaseUrl(selected.baseUrl || "")} \xB7 ${selected.model || "\u9ED8\u8BA4\u6A21\u578B"} \xB7 API Key ${selected.usable ? "\u5DF2\u914D\u7F6E" : "\u7F3A\u5931"}`
    );
    new import_obsidian3.Setting(parent).setClass("video-memo-provider-model").setName("\u6A21\u578B\u8986\u76D6\uFF08\u53EF\u9009\uFF09").addText(
      (x) => x.setValue(settings.model).setPlaceholder(selected.model || "\u4F7F\u7528\u4F9B\u5E94\u5546\u9ED8\u8BA4\u6A21\u578B").onChange(async (v) => {
        await this.options.updateSettings({ model: v.trim() });
      })
    ).addButton(
      (b) => b.setButtonText("\u53D1\u73B0\u6A21\u578B").onClick(async () => {
        b.setDisabled(true);
        try {
          const runtime = await Promise.resolve().then(() => (init_ccswitch(), ccswitch_exports));
          const r = await runtime.fetchCcSwitchProviderModels({
            dbPath: settings.ccSwitchDbPath,
            appType,
            providerId: selected.id
          });
          if (r.models.length)
            new ModelPickerModal(
              this.options.app,
              r.models,
              async (model) => {
                await this.options.updateSettings({ model });
                this.options.rerender();
              }
            ).open();
          else new import_obsidian3.Notice("\u670D\u52A1\u672A\u8FD4\u56DE\u6A21\u578B\u5217\u8868");
        } catch {
          new import_obsidian3.Notice("\u6A21\u578B\u53D1\u73B0\u5931\u8D25\uFF0C\u8BF7\u68C0\u67E5\u914D\u7F6E");
        } finally {
          b.setDisabled(false);
        }
      })
    );
  }
};
var ModelPickerModal = class extends import_obsidian3.Modal {
  constructor(app, models, choose) {
    super(app);
    this.models = models;
    this.choose = choose;
  }
  models;
  choose;
  onOpen() {
    this.contentEl.addClass("video-memo-provider-model-picker");
    this.contentEl.createEl("h2", { text: "\u9009\u62E9\u6A21\u578B" });
    for (const model of this.models)
      new import_obsidian3.Setting(this.contentEl).setName(model).addButton(
        (b) => b.setButtonText("\u9009\u62E9").onClick(async () => {
          await this.choose(model);
          this.close();
        })
      );
  }
  onClose() {
    this.contentEl.empty();
  }
};

// src/settings-tab.ts
var VideoMemoSettingTab = class extends import_obsidian4.PluginSettingTab {
  plugin;
  providerView;
  page = "settings";
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
    this.providerView = new CcSwitchProviderSettingsView({
      app,
      getSettings: () => this.plugin.settings,
      // Never reject: dozens of call sites chain .then() without .catch(), so a
      // failed write must surface as a Notice here instead of becoming an
      // unhandled rejection that also skips the caller's re-render.
      updateSettings: async (patch) => {
        Object.assign(this.plugin.settings, patch);
        await this.persist();
      },
      rerender: () => this.display(),
      onBack: () => {
        this.page = "settings";
        this.display();
      }
    });
  }
  async persist() {
    try {
      await this.plugin.saveData(this.plugin.settings);
    } catch (error) {
      console.error("VideoMemo: failed to save settings", error);
      new import_obsidian4.Notice("VideoMemo \u8BBE\u7F6E\u4FDD\u5B58\u5931\u8D25\uFF0C\u8BF7\u68C0\u67E5 Vault \u662F\u5426\u53EF\u5199");
    }
  }
  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.removeClass("video-memo-settings-tab");
    containerEl.addClass("video-memo-settings-host");
    containerEl.addClass("video-memo-settings-active");
    const settingsEl = containerEl.createDiv({ cls: "video-memo-settings-tab" });
    if (this.page === "providers") {
      this.providerView.render(settingsEl);
      return;
    }
    const intro = settingsEl.createDiv({ cls: "video-memo-settings-intro" });
    const introMark = intro.createDiv({ cls: "video-memo-settings-mark" });
    (0, import_obsidian4.setIcon)(introMark, "video");
    const introCopy = intro.createDiv({ cls: "video-memo-settings-intro-copy" });
    introCopy.createEl("h2", { text: "VideoMemo" });
    const openProviders = () => {
      this.page = "providers";
      this.providerView.showProviderList();
      this.display();
    };
    const providerSetting = new import_obsidian4.Setting(settingsEl).setName("\u4F9B\u5E94\u5546").setDesc(describeProviderSelection(this.plugin.settings)).addExtraButton(
      (button) => button.setIcon("chevron-right").setTooltip("\u6253\u5F00\u4F9B\u5E94\u5546\u8BBE\u7F6E").onClick(openProviders)
    );
    providerSetting.settingEl.addClass("video-memo-navigation-setting");
    providerSetting.settingEl.setAttribute("role", "button");
    providerSetting.settingEl.tabIndex = 0;
    providerSetting.settingEl.addEventListener("click", (event) => {
      if (event.target.closest("button")) return;
      openProviders();
    });
    providerSetting.settingEl.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      openProviders();
    });
    settingsEl.createDiv({
      cls: "video-memo-settings-section-label",
      text: "\u8FD0\u884C\u73AF\u5883"
    });
    new import_obsidian4.Setting(settingsEl).setName("\u9879\u76EE\u76EE\u5F55").setDesc("\u5305\u542B src/pipeline.py \u7684 VideoMemo \u76EE\u5F55").addText(
      (text) => text.setPlaceholder("D:\\AIApp\\video-memo").setValue(this.plugin.settings.projectPath).onChange(async (value) => {
        this.plugin.settings.projectPath = value.trim();
        await this.persist();
        this.display();
      })
    );
    const projectPath = this.plugin.settings.projectPath.trim();
    const pythonPath = projectPath ? this.plugin.resolvePython(projectPath) : "";
    new import_obsidian4.Setting(settingsEl).setName("Python \u8DEF\u5F84").setDesc("\u81EA\u52A8\u68C0\u6D4B\u9879\u76EE .venv\uFF0C\u672A\u627E\u5230\u65F6\u4F7F\u7528\u7CFB\u7EDF PATH \u4E2D\u7684 python").addText((text) => {
      text.setPlaceholder("\u586B\u5199\u9879\u76EE\u76EE\u5F55\u540E\u81EA\u52A8\u8BC6\u522B").setValue(pythonPath).inputEl.disabled = true;
    });
    settingsEl.createDiv({
      cls: "video-memo-settings-section-label",
      text: "\u8F93\u51FA"
    });
    new import_obsidian4.Setting(settingsEl).setName("Vault \u76EE\u6807\u6587\u4EF6\u5939\uFF08\u53EF\u9009\uFF09").setDesc("\u7559\u7A7A\uFF1A\u6309\u89C6\u9891\u5185\u5BB9\u81EA\u52A8\u521B\u5EFA\u4E3B\u9898\u6587\u4EF6\u5939\uFF08\u5982 Git/\uFF09\uFF1B\u586B\u5199\uFF1A\u56FA\u5B9A\u653E\u5230 Vault \u5185\u8BE5\u76F8\u5BF9\u8DEF\u5F84\uFF08\u4E0D\u5141\u8BB8\u7EDD\u5BF9\u8DEF\u5F84\u6216 .. \u7247\u6BB5\uFF09").addText(
      (text) => text.setPlaceholder("\u7559\u7A7A = \u81EA\u52A8\u6309\u4E3B\u9898\u5F52\u7C7B").setValue(this.plugin.settings.targetFolder).onChange(async (value) => {
        this.plugin.settings.targetFolder = sanitizeTargetFolder(value);
        await this.persist();
      })
    );
    new import_obsidian4.Setting(settingsEl).setName("\u5B8C\u6210\u540E\u6E05\u7406\u5A92\u4F53").setDesc("\u5220\u9664\u8F93\u51FA\u76EE\u5F55\u4E2D\u7684\u4E0B\u8F7D\u5A92\u4F53\u548C\u97F3\u8F68\uFF0C\u4E0D\u5220\u9664\u672C\u5730\u8F93\u5165\u6587\u4EF6").addToggle(
      (toggle) => toggle.setValue(this.plugin.settings.cleanupMedia).onChange(async (value) => {
        this.plugin.settings.cleanupMedia = value;
        await this.persist();
      })
    );
  }
  showHome() {
    this.page = "settings";
    this.providerView.showProviderList();
  }
  showProviders() {
    this.page = "providers";
    this.providerView.showProviderList();
  }
  hide() {
    this.showHome();
  }
};

// src/source-modal.ts
var import_obsidian5 = require("obsidian");
var MEDIA_ACCEPT = [
  ".mp4",
  ".mkv",
  ".webm",
  ".mov",
  ".avi",
  ".flv",
  ".m4v",
  ".ts",
  ".mpg",
  ".mpeg",
  ".wmv",
  ".mp3",
  ".wav",
  ".m4a",
  ".flac",
  ".aac",
  ".ogg",
  ".opus",
  ".wma",
  ".amr",
  ".aiff"
].join(",");
var TextPromptModal = class extends import_obsidian5.Modal {
  titleText;
  fieldName;
  placeholder;
  providerBadge;
  onSubmit;
  onOpenSettings;
  showMediaPicker;
  constructor(app, options) {
    super(app);
    this.titleText = options.title;
    this.fieldName = options.fieldName;
    this.placeholder = options.placeholder;
    this.providerBadge = options.providerBadge ?? "";
    this.onSubmit = options.onSubmit;
    this.onOpenSettings = options.onOpenSettings ?? null;
    this.showMediaPicker = options.showMediaPicker ?? false;
  }
  onOpen() {
    this.modalEl.addClass("video-memo-shell");
    this.contentEl.addClass("video-memo-modal");
    const titleRow = this.contentEl.createDiv({
      cls: "video-memo-title-row"
    });
    const titleCopy = titleRow.createDiv({ cls: "video-memo-title-copy" });
    titleCopy.createDiv({
      cls: "video-memo-modal-kicker",
      text: this.showMediaPicker ? "\u65B0\u5EFA\u4EFB\u52A1" : "\u5DF2\u6709\u8FD0\u884C\u76EE\u5F55"
    });
    titleCopy.createEl("h2", { text: this.titleText });
    titleCopy.createDiv({
      cls: "video-memo-modal-subtitle",
      text: this.showMediaPicker ? "\u89C6\u9891\u94FE\u63A5 \xB7 \u672C\u5730\u5A92\u4F53" : "\u5DF2\u6709\u8F6C\u5199 \xB7 \u91CD\u65B0\u751F\u6210"
    });
    if (this.providerBadge || this.onOpenSettings) {
      const badgeRow = this.contentEl.createDiv({
        cls: "video-memo-badge-row"
      });
      if (this.providerBadge) {
        const badge = badgeRow.createDiv({
          cls: "video-memo-provider-badge",
          attr: { "aria-label": "\u5F53\u524D\u4EFB\u52A1\u4F7F\u7528\u7684\u4F9B\u5E94\u5546" }
        });
        const badgeIcon = badge.createSpan({
          cls: "video-memo-provider-badge-icon"
        });
        (0, import_obsidian5.setIcon)(badgeIcon, "server");
        badge.createSpan({
          cls: "video-memo-provider-badge-text",
          text: this.providerBadge
        });
      }
      if (this.onOpenSettings) {
        const settingsButton = badgeRow.createEl("button", {
          cls: "clickable-icon video-memo-settings-button",
          attr: {
            type: "button",
            "aria-label": "\u6253\u5F00 VideoMemo \u8BBE\u7F6E"
          }
        });
        (0, import_obsidian5.setIcon)(settingsButton, "settings");
        settingsButton.addEventListener("click", () => {
          this.close();
          this.onOpenSettings?.();
        });
      }
    }
    let value = "";
    let linkValue = "";
    let fileValue = "";
    let sourceMode = "link";
    const submit = () => {
      const normalized = (this.showMediaPicker ? sourceMode === "link" ? linkValue : fileValue : value).trim();
      if (!normalized) {
        const missing = this.showMediaPicker ? sourceMode === "link" ? "\u8BF7\u8F93\u5165\u89C6\u9891\u94FE\u63A5" : "\u8BF7\u9009\u62E9\u672C\u5730\u6587\u4EF6" : `${this.fieldName}\u4E0D\u80FD\u4E3A\u7A7A`;
        new import_obsidian5.Notice(missing);
        return;
      }
      this.close();
      this.onSubmit(normalized);
    };
    if (this.showMediaPicker) {
      let setSourceMode = function(mode) {
        sourceMode = mode;
        linkButton.toggleClass("is-active", mode === "link");
        fileButton.toggleClass("is-active", mode === "file");
        linkSetting.settingEl.toggleClass("is-hidden", mode !== "link");
        fileSetting.settingEl.toggleClass("is-hidden", mode !== "file");
        window.setTimeout(
          () => (mode === "link" ? linkInput : fileInputElement)?.focus(),
          0
        );
      };
      const modeSwitch = this.contentEl.createDiv({
        cls: "video-memo-mode-switch",
        attr: { "aria-label": "\u8F93\u5165\u7C7B\u578B" }
      });
      const createModeButton = (label, icon, mode) => {
        const button = modeSwitch.createEl("button", {
          cls: "video-memo-mode-button",
          attr: { type: "button" }
        });
        const iconElement = button.createSpan({
          cls: "video-memo-mode-icon"
        });
        (0, import_obsidian5.setIcon)(iconElement, icon);
        button.createSpan({ text: label });
        button.addEventListener("click", () => setSourceMode(mode));
        return button;
      };
      let linkInput = null;
      let fileControl = null;
      let fileInputElement = null;
      const linkSetting = new import_obsidian5.Setting(this.contentEl).setClass("video-memo-input-setting").setName("\u89C6\u9891\u94FE\u63A5").addText((text) => {
        linkInput = text.inputEl;
        text.setPlaceholder("https://...").onChange((next) => {
          linkValue = next;
        });
        text.inputEl.addEventListener("keydown", (event) => {
          if (event.key === "Enter") submit();
        });
      });
      const fileSetting = new import_obsidian5.Setting(this.contentEl).setClass("video-memo-input-setting").setName("\u672C\u5730\u89C6\u9891\u6216\u5F55\u97F3").addText((text) => {
        fileControl = text;
        fileInputElement = text.inputEl;
        text.setPlaceholder("\u9009\u62E9\u6587\u4EF6\uFF0C\u6216\u7C98\u8D34\u672C\u5730\u8DEF\u5F84").onChange((next) => {
          fileValue = next;
        });
        text.inputEl.addEventListener("keydown", (event) => {
          if (event.key === "Enter") submit();
        });
      });
      const fileInput = this.contentEl.createEl("input", {
        cls: "video-memo-native-file",
        attr: { type: "file", accept: MEDIA_ACCEPT }
      });
      fileInput.addEventListener("change", () => {
        const file = fileInput.files?.[0];
        if (!file) return;
        const electron = require("electron");
        const selectedPath = electron.webUtils?.getPathForFile(file) ?? file.path ?? "";
        if (!selectedPath) {
          new import_obsidian5.Notice("\u65E0\u6CD5\u8BFB\u53D6\u6240\u9009\u6587\u4EF6\u7684\u672C\u5730\u8DEF\u5F84");
          return;
        }
        fileValue = selectedPath;
        fileControl?.setValue(selectedPath);
      });
      fileSetting.addButton(
        (button) => button.setButtonText("\u9009\u62E9\u6587\u4EF6\u2026").setTooltip("\u9009\u62E9\u672C\u5730\u89C6\u9891\u6216\u5F55\u97F3").onClick(() => fileInput.click())
      );
      const linkButton = createModeButton("\u89C6\u9891\u94FE\u63A5", "link", "link");
      const fileButton = createModeButton("\u672C\u5730\u6587\u4EF6", "folder-open", "file");
      setSourceMode("link");
    } else {
      new import_obsidian5.Setting(this.contentEl).setClass("video-memo-input-setting").setName(this.fieldName).addText((text) => {
        text.setPlaceholder(this.placeholder).onChange((next) => {
          value = next;
        });
        text.inputEl.addEventListener("keydown", (event) => {
          if (event.key === "Enter") submit();
        });
        window.setTimeout(() => text.inputEl.focus(), 0);
      });
    }
    new import_obsidian5.Setting(this.contentEl).setClass("video-memo-actions").addButton((button) => button.setButtonText("\u53D6\u6D88").onClick(() => this.close())).addButton(
      (button) => button.setButtonText("\u5F00\u59CB").setCta().onClick(submit)
    );
  }
  onClose() {
    this.contentEl.empty();
  }
};

// src/main.ts
var EVENT_PREFIX = "@@VIDEOMEMO@@";
var MAX_LOG_LINES = 500;
var NOTE_OPEN_ATTEMPTS = 12;
var NOTE_OPEN_INTERVAL_MS = 250;
var VideoMemoPlugin = class extends import_obsidian6.Plugin {
  settings = DEFAULT_SETTINGS;
  activeProcess = null;
  statusEl = null;
  stderrTail = "";
  activeProviderSecret = "";
  taskState = null;
  progressModal = null;
  async onload() {
    const stored = await this.loadData();
    this.settings = normalizeSettings(stored);
    if (this.settings.targetFolder === "Video Memos") {
      this.settings.targetFolder = "";
    }
    if (!stored || JSON.stringify(stored) !== JSON.stringify(this.settings)) {
      await this.saveData(this.settings);
    }
    this.statusEl = this.addStatusBarItem();
    this.statusEl.addClass("video-memo-status");
    this.statusEl.setAttribute("aria-label", "\u70B9\u51FB\u67E5\u770B\u4EFB\u52A1\u8FDB\u5EA6");
    this.setStatus("VideoMemo: \u5C31\u7EEA");
    this.registerDomEvent(this.statusEl, "click", () => this.openProgressModal());
    const settingTab = new VideoMemoSettingTab(this.app, this);
    this.addSettingTab(settingTab);
    this.addRibbonIcon("video", "\u603B\u7ED3\u89C6\u9891\u6216\u5F55\u97F3", () => this.openSourceModal());
    this.addCommand({
      id: "summarize-video-or-audio",
      name: "\u603B\u7ED3\u89C6\u9891\u94FE\u63A5\u6216\u672C\u5730\u97F3\u89C6\u9891",
      callback: () => this.openSourceModal()
    });
    this.addCommand({
      id: "regenerate-report",
      name: "\u4ECE\u5DF2\u6709\u8FD0\u884C\u76EE\u5F55\u91CD\u65B0\u751F\u6210\u62A5\u544A",
      callback: () => this.openRegenerateModal()
    });
    this.addCommand({
      id: "cancel-active-task",
      name: "\u53D6\u6D88\u5F53\u524D\u603B\u7ED3\u4EFB\u52A1",
      checkCallback: (checking) => {
        if (!this.activeProcess) return false;
        if (!checking) this.cancelActiveTask();
        return true;
      }
    });
    this.addCommand({
      id: "open-settings",
      name: "\u6253\u5F00\u63D2\u4EF6\u8BBE\u7F6E",
      callback: () => {
        this.openPluginSettings();
        window.setTimeout(() => {
          settingTab.showHome();
          settingTab.display();
        }, 0);
      }
    });
    this.addCommand({
      id: "open-provider-settings",
      name: "\u6253\u5F00\u4F9B\u5E94\u5546\u8BBE\u7F6E",
      callback: () => {
        this.openPluginSettings();
        window.setTimeout(() => {
          settingTab.showProviders();
          settingTab.display();
        }, 0);
      }
    });
  }
  onunload() {
    this.cancelActiveTask(false);
    this.progressModal?.close();
  }
  openSourceModal() {
    new TextPromptModal(this.app, {
      title: "\u603B\u7ED3\u89C6\u9891\u6216\u5F55\u97F3",
      fieldName: "\u94FE\u63A5\u6216\u672C\u5730\u6587\u4EF6\u8DEF\u5F84",
      placeholder: "https://... \u6216 D:\\Media\\course.mp4",
      providerBadge: describeProviderSelection(this.settings),
      showMediaPicker: true,
      onOpenSettings: () => this.openPluginSettings(),
      onSubmit: (value) => this.startEngine([value])
    }).open();
  }
  openRegenerateModal() {
    new TextPromptModal(this.app, {
      title: "\u91CD\u65B0\u751F\u6210\u62A5\u544A",
      fieldName: "\u8FD0\u884C\u76EE\u5F55",
      placeholder: "D:\\video-memo\\output\\20260717_...",
      providerBadge: describeProviderSelection(this.settings),
      onOpenSettings: () => this.openPluginSettings(),
      onSubmit: (value) => this.startEngine(["--regenerate", value])
    }).open();
  }
  vaultPath() {
    const adapter = this.app.vault.adapter;
    if (!(adapter instanceof import_obsidian6.FileSystemAdapter)) {
      new import_obsidian6.Notice("VideoMemo \u4EC5\u652F\u6301\u684C\u9762\u6587\u4EF6\u7CFB\u7EDF Vault");
      return null;
    }
    return adapter.getBasePath();
  }
  resolvePython(projectPath) {
    const virtualEnvPython = (0, import_node_path2.join)(
      projectPath,
      ".venv",
      process.platform === "win32" ? "Scripts/python.exe" : "bin/python"
    );
    return (0, import_node_fs2.existsSync)(virtualEnvPython) ? virtualEnvPython : "python";
  }
  openPluginSettings() {
    const app = this.app;
    app.setting.open();
    app.setting.openTabById(this.manifest.id);
  }
  redactProviderSecrets(value) {
    let redacted = value;
    if (this.activeProviderSecret) {
      redacted = redacted.replaceAll(this.activeProviderSecret, "***");
    }
    return redacted.replace(/(authorization\s*:\s*bearer\s+)[^\s,;]+/gi, "$1***").replace(/((?:api[_-]?key|token|secret|password)\s*[=:]\s*)[^\s,;]+/gi, "$1***");
  }
  setStatus(text) {
    this.statusEl?.setText(text);
    this.statusEl?.toggleClass("is-clickable", this.taskState !== null);
  }
  openProgressModal() {
    if (!this.taskState || this.progressModal) return;
    const modal = new RunProgressModal(this.app, {
      state: this.taskState,
      onCancel: () => this.cancelActiveTask(),
      onOpenNote: () => void this.openGeneratedNote(),
      onClosed: () => {
        if (this.progressModal === modal) this.progressModal = null;
      }
    });
    this.progressModal = modal;
    modal.open();
  }
  startEngine(sourceArgs) {
    if (this.activeProcess) {
      new import_obsidian6.Notice("\u5DF2\u6709\u603B\u7ED3\u4EFB\u52A1\u6B63\u5728\u8FD0\u884C");
      this.openProgressModal();
      return;
    }
    const projectPath = this.settings.projectPath.trim();
    const pipelinePath = (0, import_node_path2.join)(projectPath, "src", "pipeline.py");
    if (!projectPath || !(0, import_node_fs2.existsSync)(pipelinePath)) {
      new import_obsidian6.Notice("\u8BF7\u5148\u5728\u63D2\u4EF6\u8BBE\u7F6E\u4E2D\u914D\u7F6E VideoMemo \u9879\u76EE\u76EE\u5F55");
      return;
    }
    const vaultPath = this.vaultPath();
    if (!vaultPath) return;
    const sourceValue = sourceArgs[0] === "--regenerate" ? sourceArgs[1] : sourceArgs[0];
    if (!sourceValue || sourceArgs[0] !== "--regenerate" && sourceValue.startsWith("-")) {
      new import_obsidian6.Notice("\u8F93\u5165\u4E0D\u80FD\u4EE5\u8FDE\u5B57\u7B26\u5F00\u5934\uFF0C\u8BF7\u9009\u62E9\u6709\u6548 URL \u6216\u672C\u5730\u6587\u4EF6");
      return;
    }
    const engineEnv = { ...process.env, PYTHONUTF8: "1" };
    let selectedModel = this.settings.model.trim();
    let providerBaseUrl = "";
    let providerLabel = "\u4F9B\u5E94\u5546\u914D\u7F6E";
    this.activeProviderSecret = "";
    try {
      if (this.settings.providerSource === "ccswitch") {
        const runtime = resolveCcSwitchProviderRuntime({
          dbPath: this.settings.ccSwitchDbPath,
          appType: this.settings.ccSwitchAppType,
          followCurrent: this.settings.ccSwitchFollowCurrent,
          providerId: this.settings.ccSwitchProviderId
        });
        providerBaseUrl = runtime.baseUrl;
        selectedModel = selectedModel || runtime.model || "";
        providerLabel = selectedModel ? `${runtime.name} \xB7 ${selectedModel}` : `${runtime.name} \xB7 \u9ED8\u8BA4\u6A21\u578B`;
        this.activeProviderSecret = runtime.apiKey;
        engineEnv.LLM_API_KEY = runtime.apiKey;
        engineEnv.LLM_BASE_URL = runtime.baseUrl;
        engineEnv.LLM_API_FORMAT = runtime.apiFormat || "chat_completions";
        if (!selectedModel) delete engineEnv.LLM_MODEL;
      } else if (this.settings.providerSource === "custom") {
        const provider = activeCustomProvider(this.settings);
        if (!provider) throw new Error("\u8BF7\u5148\u6DFB\u52A0\u5E76\u9009\u62E9\u4E00\u4E2A\u81EA\u5B9A\u4E49\u4F9B\u5E94\u5546");
        const name = provider.name.trim();
        const apiKey = provider.apiKey.trim();
        selectedModel = provider.model.trim();
        providerBaseUrl = normalizeOpenAiBaseUrl(provider.baseUrl);
        if (!name) throw new Error("\u8BF7\u586B\u5199\u81EA\u5B9A\u4E49\u4F9B\u5E94\u5546\u540D\u79F0");
        if (!apiKey) throw new Error("\u8BF7\u586B\u5199\u81EA\u5B9A\u4E49\u4F9B\u5E94\u5546 API Key");
        if (!selectedModel) throw new Error("\u8BF7\u9009\u62E9\u81EA\u5B9A\u4E49\u4F9B\u5E94\u5546\u6A21\u578B");
        providerLabel = `\u81EA\u5B9A\u4E49 \xB7 ${name} \xB7 ${selectedModel}`;
        this.activeProviderSecret = apiKey;
        engineEnv.LLM_API_KEY = apiKey;
        engineEnv.LLM_BASE_URL = providerBaseUrl;
        engineEnv.LLM_API_FORMAT = provider.apiFormat;
        delete engineEnv.LLM_MODEL;
      }
    } catch (error) {
      const message = this.redactProviderSecrets(
        error instanceof Error ? error.message : String(error)
      );
      new import_obsidian6.Notice(`\u65E0\u6CD5\u4F7F\u7528\u6240\u9009\u4F9B\u5E94\u5546
${message}`, 8e3);
      this.openPluginSettings();
      return;
    }
    const args = [
      pipelinePath,
      ...sourceArgs,
      "--obsidian-vault",
      vaultPath,
      "--obsidian-folder",
      sanitizeTargetFolder(this.settings.targetFolder),
      "--json-progress"
    ];
    if (selectedModel) args.push("--llm-model", selectedModel);
    if (providerBaseUrl) args.push("--api-base-url", providerBaseUrl);
    const isRegenerate = sourceArgs[0] === "--regenerate";
    if (this.settings.cleanupMedia && !isRegenerate) {
      args.push("--cleanup-media");
    }
    this.progressModal?.close();
    this.stderrTail = "";
    this.taskState = {
      kicker: isRegenerate ? "\u91CD\u65B0\u751F\u6210" : "\u65B0\u5EFA\u4EFB\u52A1",
      source: (isRegenerate ? sourceArgs[1] : sourceArgs[0]) ?? "",
      providerLabel,
      status: "running",
      progress: 0,
      stage: "\u542F\u52A8 Python \u5F15\u64CE\u2026",
      log: [],
      errorDetail: "",
      notePath: null
    };
    this.setStatus("VideoMemo: \u542F\u52A8\u4E2D");
    const child = (0, import_node_child_process.spawn)(this.resolvePython(projectPath), args, {
      cwd: projectPath,
      env: engineEnv,
      shell: false,
      windowsHide: true,
      // Own a process group on POSIX so cancellation can reach yt-dlp/ffmpeg
      // grandchildren; Windows uses `taskkill /T` for the same effect.
      detached: process.platform !== "win32"
    });
    this.activeProcess = child;
    this.openProgressModal();
    const outputLines = (0, import_node_readline.createInterface)({ input: child.stdout });
    outputLines.on("line", (line) => {
      this.handleOutputLine(line, vaultPath);
    });
    child.once("close", () => outputLines.close());
    child.stderr.on("data", (chunk) => {
      this.stderrTail = this.redactProviderSecrets(
        (this.stderrTail + chunk.toString("utf8")).slice(-4e3)
      );
    });
    child.on("error", (error) => {
      this.finishTask(false, this.redactProviderSecrets(`\u65E0\u6CD5\u542F\u52A8 Python: ${error.message}`));
    });
    child.on("close", (code) => {
      if (this.activeProcess !== child) return;
      if (code === 0) {
        this.finishTask(true);
      } else {
        const detail = this.stderrTail.trim() || `Python \u9000\u51FA\u7801 ${code ?? "\u672A\u77E5"}`;
        this.finishTask(false, detail);
      }
    });
  }
  handleOutputLine(line, vaultPath) {
    const marker = line.indexOf(EVENT_PREFIX);
    if (marker < 0) return;
    try {
      const event = JSON.parse(line.slice(marker + EVENT_PREFIX.length));
      const state = this.taskState;
      if (state && state.status !== "running") return;
      if (event.type === "progress" && state) {
        state.progress = Math.max(0, Math.min(1, event.progress ?? 0));
        const message = (event.message ?? "").replace(/\s+$/, "");
        const lines = message.split("\n").map((item) => item.replace(/\s+$/, "")).filter((item) => item.trim().length > 0);
        const lastLine = lines.at(-1)?.trim() ?? "";
        if (lastLine) state.stage = lastLine;
        state.log.push(...lines);
        if (state.log.length > MAX_LOG_LINES) {
          state.log.splice(0, state.log.length - MAX_LOG_LINES);
        }
        const percent = Math.round(state.progress * 100);
        this.setStatus(`VideoMemo: ${percent}% ${lastLine || "\u5904\u7406\u4E2D"}`);
        this.progressModal?.refresh();
      } else if (event.type === "artifact" && event.kind === "obsidian_note") {
        if (state && event.path && (0, import_node_path2.isAbsolute)(event.path)) {
          const absoluteNote = (0, import_node_path2.resolve)(event.path);
          const absoluteVault = (0, import_node_path2.resolve)(vaultPath);
          const vaultRelative = (0, import_node_path2.relative)(absoluteVault, absoluteNote);
          if (vaultRelative && vaultRelative !== ".." && !vaultRelative.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) && !(0, import_node_path2.isAbsolute)(vaultRelative)) {
            state.notePath = (0, import_obsidian6.normalizePath)(vaultRelative);
          }
        }
      }
    } catch {
    }
  }
  finishTask(success, errorMessage) {
    this.activeProcess = null;
    const state = this.taskState;
    if (!success) {
      if (state) {
        state.status = "error";
        state.errorDetail = errorMessage ?? "\u672A\u77E5\u9519\u8BEF";
        state.stage = "\u4EFB\u52A1\u5931\u8D25";
      }
      this.setStatus("VideoMemo: \u5931\u8D25");
      this.progressModal?.refresh();
      new import_obsidian6.Notice(`\u89C6\u9891\u603B\u7ED3\u5931\u8D25
${errorMessage ?? "\u672A\u77E5\u9519\u8BEF"}`, 1e4);
      return;
    }
    if (state) {
      state.status = "success";
      state.progress = 1;
      state.stage = "\u89C6\u9891\u603B\u7ED3\u5DF2\u751F\u6210";
    }
    this.setStatus("VideoMemo: \u5B8C\u6210");
    this.progressModal?.refresh();
    new import_obsidian6.Notice("\u89C6\u9891\u603B\u7ED3\u5DF2\u751F\u6210");
    void this.openGeneratedNote();
  }
  /**
   * The engine writes the note straight to disk, so Obsidian may not have
   * indexed it yet when the process exits. Retry briefly before giving up.
   */
  async openGeneratedNote() {
    const path = this.taskState?.notePath;
    if (!path) return;
    for (let attempt = 0; attempt < NOTE_OPEN_ATTEMPTS; attempt++) {
      const note = this.app.vault.getAbstractFileByPath(path);
      if (note instanceof import_obsidian6.TFile) {
        await this.app.workspace.getLeaf(false).openFile(note);
        return;
      }
      await new Promise((resolve3) => window.setTimeout(resolve3, NOTE_OPEN_INTERVAL_MS));
    }
  }
  cancelActiveTask(showNotice = true) {
    const child = this.activeProcess;
    if (!child) return;
    this.activeProcess = null;
    if (process.platform === "win32" && child.pid) {
      (0, import_node_child_process.spawn)("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
        windowsHide: true
      });
    } else if (child.pid) {
      try {
        process.kill(-child.pid, "SIGTERM");
      } catch {
        child.kill("SIGTERM");
      }
    } else {
      child.kill("SIGTERM");
    }
    if (this.taskState) {
      this.taskState.status = "cancelled";
      this.taskState.stage = "\u4EFB\u52A1\u5DF2\u53D6\u6D88";
    }
    this.setStatus("VideoMemo: \u5DF2\u53D6\u6D88");
    this.progressModal?.refresh();
    if (showNotice) new import_obsidian6.Notice("\u5DF2\u53D6\u6D88\u89C6\u9891\u603B\u7ED3\u4EFB\u52A1");
  }
};
/*! Bundled license information:

smol-toml/dist/date.js:
smol-toml/dist/error.js:
smol-toml/dist/util.js:
smol-toml/dist/primitive.js:
smol-toml/dist/extract.js:
smol-toml/dist/struct.js:
smol-toml/dist/parse.js:
smol-toml/dist/stringify.js:
smol-toml/dist/index.js:
  (*!
   * Copyright (c) Squirrel Chat et al., All rights reserved.
   * SPDX-License-Identifier: BSD-3-Clause
   *
   * Redistribution and use in source and binary forms, with or without
   * modification, are permitted provided that the following conditions are met:
   *
   * 1. Redistributions of source code must retain the above copyright notice, this
   *    list of conditions and the following disclaimer.
   * 2. Redistributions in binary form must reproduce the above copyright notice,
   *    this list of conditions and the following disclaimer in the
   *    documentation and/or other materials provided with the distribution.
   * 3. Neither the name of the copyright holder nor the names of its contributors
   *    may be used to endorse or promote products derived from this software without
   *    specific prior written permission.
   *
   * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
   * ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
   * WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
   * DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
   * FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
   * DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
   * SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
   * CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
   * OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
   * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
   *)
*/
