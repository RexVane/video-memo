var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
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

// src/ccswitch.ts
var import_node_fs = require("node:fs");
var import_node_os = require("node:os");
var import_node_path = require("node:path");
var import_obsidian = require("obsidian");

// node_modules/smol-toml/dist/date.js
var DATE_TIME_RE = /^(\d{4}-\d{2}-\d{2})?[T ]?(?:(\d{2}):\d{2}(?::\d{2}(?:\.\d+)?)?)?(Z|[-+]\d{2}:\d{2})?$/i;
var TomlDate = class _TomlDate extends Date {
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
var TomlError = class extends Error {
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

// node_modules/smol-toml/dist/primitive.js
var INT_REGEX = /^((0x[0-9a-fA-F](_?[0-9a-fA-F])*)|(([+-]|0[ob])?\d(_?\d)*))$/;
var FLOAT_REGEX = /^[+-]?\d(_?\d)*(\.\d(_?\d)*)?([eE][+-]?\d(_?\d)*)?$/;
var LEADING_ZERO = /^[+-]?0[0-9_]/;
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

// node_modules/smol-toml/dist/struct.js
var KEY_PART_RE = /^[a-zA-Z0-9-_]+[ \t]*$/;
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

// src/ccswitch.ts
var SECRET_MARKERS = ["token", "key", "secret", "auth", "password"];
var SECRET_ASSIGNMENT = /((?:"?[\w.-]*(?:token|key|secret|auth|password)[\w.-]*"?\s*[:=]\s*))(?:(?:"(?:\\.|[^"])*")|(?:'(?:\\.|[^'])*')|(?:[^,\s}\r\n#]+))/gi;
var BEARER_SECRET = /(bearer\s+)[A-Za-z0-9._~+/=-]+/gi;
var BASE_URL_KEYS = [
  "OPENAI_BASE_URL",
  "OPENAI_API_BASE",
  "CODEX_BASE_URL",
  "BASE_URL",
  "API_BASE",
  "ENDPOINT",
  "URL"
];
var SECRET_KEYS = [
  "OPENAI_API_KEY",
  "OPENAI_AUTH_TOKEN",
  "CODEX_API_KEY",
  "CODEX_AUTH_TOKEN",
  "API_KEY",
  "AUTH_TOKEN"
];
function normalizeApiFormat(value) {
  if (typeof value !== "string") return "chat_completions";
  const normalized = value.trim().toLowerCase().replace("-", "_");
  if (normalized === "anthropic_messages" || normalized === "anthropic" || normalized === "messages") {
    return "anthropic_messages";
  }
  if (normalized === "responses" || normalized === "response" || normalized === "openai_responses") {
    return "responses";
  }
  return "chat_completions";
}
function asRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value : null;
}
function textValue(value) {
  if (typeof value === "string") return value.trim() || null;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return null;
}
function normalizeKey(value) {
  return value.trim().replaceAll("-", "_").toUpperCase();
}
function findTextByKeyMatcher(value, matcher) {
  const record = asRecord(value);
  if (!record) return null;
  for (const [key, candidate] of Object.entries(record)) {
    if (matcher(key)) {
      const text = textValue(candidate);
      if (text) return text;
    }
  }
  for (const candidate of Object.values(record)) {
    const nested = findTextByKeyMatcher(candidate, matcher);
    if (nested) return nested;
  }
  return null;
}
function findTextByKeyPatterns(value, exact, suffixes) {
  const normalizedExact = exact.map(normalizeKey);
  const exactMatch = findTextByKeyMatcher(
    value,
    (key) => normalizedExact.includes(normalizeKey(key))
  );
  if (exactMatch) return exactMatch;
  const normalizedSuffixes = suffixes.map(normalizeKey);
  return findTextByKeyMatcher(
    value,
    (key) => normalizedSuffixes.some((suffix) => normalizeKey(key).endsWith(suffix))
  );
}
function isSecretKey(key) {
  const lower = key.toLowerCase();
  return SECRET_MARKERS.some((marker) => lower.includes(marker));
}
function maskSecret(value) {
  const characters = [...value];
  if (characters.length <= 12) return "***";
  return `${characters.slice(0, 4).join("")}...${characters.slice(-4).join("")}`;
}
function redactEmbeddedSecrets(value) {
  return value.replace(SECRET_ASSIGNMENT, '$1"***"').replace(BEARER_SECRET, "$1***");
}
function collectMaskedEnv(config) {
  const result = {};
  for (const sectionName of ["env", "auth"]) {
    const section = asRecord(config[sectionName]);
    if (!section) continue;
    for (const [key, value] of Object.entries(section)) {
      const text = textValue(value) ?? JSON.stringify(value);
      result[key] = isSecretKey(key) ? maskSecret(text) : text;
    }
  }
  return result;
}
function redactSecrets(value, parentKey = "") {
  if (isSecretKey(parentKey)) {
    const text = textValue(value);
    return text ? maskSecret(text) : "***";
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactSecrets(item));
  }
  if (typeof value === "string") {
    return redactEmbeddedSecrets(value);
  }
  const record = asRecord(value);
  if (!record) return value;
  return Object.fromEntries(
    Object.entries(record).map(([key, item]) => [key, redactSecrets(item, key)])
  );
}
function parseMeta(raw) {
  try {
    return asRecord(JSON.parse(raw || "{}")) ?? {};
  } catch {
    return {};
  }
}
function parseTomlConfig(raw) {
  if (!raw.trim()) return { baseUrl: null, model: null, apiFormat: null };
  try {
    const parsed = asRecord(parse(raw)) ?? {};
    const selectedName = textValue(parsed.model_provider);
    const providers = asRecord(parsed.model_providers);
    let selectedProvider = selectedName && providers ? asRecord(providers[selectedName]) : null;
    if (!selectedProvider && providers) {
      selectedProvider = Object.values(providers).map(asRecord).find((provider) => textValue(provider?.base_url)) ?? null;
    }
    return {
      baseUrl: textValue(selectedProvider?.base_url),
      model: textValue(parsed.model),
      apiFormat: textValue(selectedProvider?.wire_api)
    };
  } catch {
    const model = raw.match(/^\s*model\s*=\s*["']([^"']+)["']/m)?.[1] ?? null;
    const baseUrl = raw.match(/^\s*base_url\s*=\s*["']([^"']+)["']/m)?.[1] ?? null;
    const apiFormat = raw.match(/^\s*wire_api\s*=\s*["']([^"']+)["']/m)?.[1] ?? null;
    return { baseUrl, model, apiFormat };
  }
}
function parseProviderConfig(settingsConfig, metaRaw) {
  try {
    const parsed = asRecord(JSON.parse(settingsConfig));
    if (!parsed) throw new Error("provider settings must be an object");
    const env = asRecord(parsed.env);
    const auth = asRecord(parsed.auth);
    const toml = parseTomlConfig(textValue(parsed.config) ?? "");
    const baseUrl = findTextByKeyPatterns(env, BASE_URL_KEYS, ["_BASE_URL", "_API_BASE", "_ENDPOINT"]) ?? findTextByKeyPatterns(
      parsed,
      ["openai_base_url", "chatgpt_base_url", "base_url", "api_base", "endpoint"],
      ["_BASE_URL", "_API_BASE", "_ENDPOINT"]
    ) ?? toml.baseUrl;
    const model = findTextByKeyPatterns(env, ["OPENAI_MODEL", "CODEX_MODEL", "MODEL"], ["_MODEL"]) ?? textValue(parsed.model) ?? toml.model;
    const apiKey = findTextByKeyPatterns(env, SECRET_KEYS, ["_API_KEY", "_AUTH_TOKEN", "_ACCESS_TOKEN", "_TOKEN"]) ?? findTextByKeyPatterns(auth, SECRET_KEYS, ["_API_KEY", "_AUTH_TOKEN", "_ACCESS_TOKEN", "_TOKEN"]) ?? findTextByKeyPatterns(parsed, SECRET_KEYS, ["_API_KEY", "_AUTH_TOKEN", "_ACCESS_TOKEN", "_TOKEN"]);
    const meta = parseMeta(metaRaw);
    const apiFormat = textValue(meta.apiFormat) ?? toml.apiFormat;
    return {
      baseUrl,
      model,
      apiFormat,
      apiKey,
      maskedEnv: collectMaskedEnv(parsed),
      redactedSettingsConfig: JSON.stringify(redactSecrets(parsed), null, 2),
      parseError: false
    };
  } catch {
    return {
      baseUrl: null,
      model: null,
      apiFormat: null,
      apiKey: null,
      maskedEnv: {},
      redactedSettingsConfig: "\u914D\u7F6E\u89E3\u6790\u5931\u8D25\u3002\u4E3A\u907F\u514D\u6CC4\u9732 API Key\uFF0C\u539F\u59CB\u914D\u7F6E\u5DF2\u9690\u85CF\u3002",
      parseError: true
    };
  }
}
function providerFromRow(row) {
  const parsed = parseProviderConfig(row.settings_config, row.meta);
  const openAiCompatible = !parsed.apiFormat?.toLowerCase().includes("anthropic");
  return {
    id: String(row.id),
    appType: String(row.app_type),
    name: String(row.name),
    category: row.category ? String(row.category) : null,
    websiteUrl: row.website_url ? String(row.website_url) : null,
    notes: row.notes ? String(row.notes) : null,
    sortIndex: row.sort_index === null ? null : Number(row.sort_index),
    createdAt: row.created_at === null ? null : Number(row.created_at),
    isCurrent: Boolean(Number(row.is_current)),
    baseUrl: parsed.baseUrl,
    model: parsed.model,
    apiFormat: parsed.apiFormat,
    maskedEnv: parsed.maskedEnv,
    configParseError: parsed.parseError,
    redactedSettingsConfig: parsed.redactedSettingsConfig,
    providerType: row.provider_type ? String(row.provider_type) : null,
    usable: Boolean(parsed.baseUrl && parsed.apiKey && openAiCompatible)
  };
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
      "\u5F53\u524D Obsidian \u8FD0\u884C\u65F6\u4E0D\u652F\u6301 node:sqlite\u3002\u8BF7\u5347\u7EA7 Obsidian\uFF0C\u6216\u5207\u6362\u5230\u73AF\u5883\u914D\u7F6E\u3002"
    );
  }
}
function openDatabase(configuredPath) {
  const path = resolveCcSwitchDbPath(configuredPath);
  if ((0, import_node_path.extname)(path).toLowerCase() !== ".db") {
    throw new Error("cc-switch \u6570\u636E\u5E93\u8DEF\u5F84\u5FC5\u987B\u6307\u5411 .db \u6587\u4EF6");
  }
  if (!(0, import_node_fs.existsSync)(path)) {
    throw new Error(`\u672A\u627E\u5230 cc-switch \u6570\u636E\u5E93: ${path}`);
  }
  const { DatabaseSync } = loadNodeSqlite();
  return {
    db: new DatabaseSync(path, { readOnly: true, timeout: 15e3 }),
    path
  };
}
var PROVIDER_QUERY = `
  SELECT id, app_type, name, settings_config, website_url, category, notes,
         sort_index, created_at, is_current, meta, provider_type
  FROM providers
`;
function loadCcSwitchProviders(configuredPath = "") {
  const { db, path } = openDatabase(configuredPath);
  try {
    const rows = db.prepare(`${PROVIDER_QUERY} ORDER BY app_type, sort_index, name`).all();
    return { dbPath: path, providers: rows.map(providerFromRow) };
  } finally {
    db.close();
  }
}
function resolveCcSwitchProviderRuntime(options) {
  const { db } = openDatabase(options.dbPath ?? "");
  try {
    const row = options.followCurrent ? db.prepare(`${PROVIDER_QUERY} WHERE app_type = ? AND is_current = 1 LIMIT 1`).get(options.appType) : db.prepare(`${PROVIDER_QUERY} WHERE app_type = ? AND id = ? LIMIT 1`).get(options.appType, options.providerId ?? "");
    if (!row) {
      throw new Error(
        options.followCurrent ? `cc-switch \u672A\u8BBE\u7F6E ${options.appType} \u7684\u5168\u5C40\u5F53\u524D\u4F9B\u5E94\u5546` : "\u56FA\u5B9A\u7684 cc-switch \u4F9B\u5E94\u5546\u5DF2\u4E0D\u5B58\u5728\uFF0C\u8BF7\u91CD\u65B0\u9009\u62E9"
      );
    }
    const providerRow = row;
    const parsed = parseProviderConfig(providerRow.settings_config, providerRow.meta);
    if (!parsed.baseUrl) throw new Error("\u8BE5\u4F9B\u5E94\u5546\u7F3A\u5C11 OpenAI \u517C\u5BB9 Base URL");
    if (!parsed.apiKey) throw new Error("\u8BE5\u4F9B\u5E94\u5546\u7F3A\u5C11 API Key \u6216 Token");
    if (parsed.apiFormat?.toLowerCase().includes("anthropic")) {
      throw new Error("\u8BE5\u4F9B\u5E94\u5546\u4F7F\u7528 Anthropic \u539F\u751F\u534F\u8BAE\uFF0C\u4E0D\u80FD\u7528\u4E8E\u5F53\u524D\u603B\u7ED3\u5F15\u64CE");
    }
    return {
      id: String(providerRow.id),
      appType: String(providerRow.app_type),
      name: String(providerRow.name),
      baseUrl: parsed.baseUrl,
      model: parsed.model,
      apiFormat: parsed.apiFormat,
      apiKey: parsed.apiKey
    };
  } finally {
    db.close();
  }
}
function normalizeOpenAiBaseUrl(baseUrl) {
  const url = new URL(baseUrl.trim());
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("\u6A21\u578B\u63A5\u53E3 Base URL \u5FC5\u987B\u4F7F\u7528 http \u6216 https");
  }
  if (url.username || url.password) {
    throw new Error("\u6A21\u578B\u63A5\u53E3 Base URL \u4E0D\u80FD\u5305\u542B\u7528\u6237\u540D\u6216\u5BC6\u7801");
  }
  if (url.search || url.hash) {
    throw new Error("\u6A21\u578B\u63A5\u53E3 Base URL \u4E0D\u80FD\u5305\u542B\u67E5\u8BE2\u53C2\u6570\u6216\u951A\u70B9");
  }
  const path = url.pathname.replace(/\/+$/, "");
  if (/\/(?:chat\/completions|responses|messages)$/i.test(path)) {
    throw new Error("\u6A21\u578B\u63A5\u53E3 Base URL \u4E0D\u80FD\u4EE5 /chat/completions\u3001/responses \u6216 /messages \u7ED3\u5C3E");
  }
  url.pathname = path || "/";
  return url.toString();
}
function openAiModelsUrl(baseUrl) {
  const url = new URL(normalizeOpenAiBaseUrl(baseUrl));
  const path = url.pathname.replace(/\/+$/, "");
  if (!path) {
    url.pathname = "/v1/models";
  } else if (!/\/models$/i.test(path)) {
    url.pathname = `${path}/models`;
  }
  return url.toString();
}
function modelIdsFromResponse(payload) {
  const record = asRecord(payload);
  const candidates = Array.isArray(payload) ? payload : Array.isArray(record?.data) ? record.data : Array.isArray(record?.models) ? record.models : [];
  const models = candidates.map((item) => {
    if (typeof item === "string") return item.trim();
    const model = asRecord(item);
    return textValue(model?.id) ?? textValue(model?.name) ?? textValue(model?.model) ?? "";
  }).filter((model) => model.length > 0 && model.length <= 200);
  return [...new Set(models)].sort(
    (left, right) => left.localeCompare(right, "en", { numeric: true, sensitivity: "base" })
  );
}
function responseErrorDetail(text) {
  try {
    const payload = asRecord(JSON.parse(text));
    const error = asRecord(payload?.error);
    const detail = textValue(error?.message) ?? textValue(payload?.message);
    return detail?.slice(0, 240) ?? "";
  } catch {
    return "";
  }
}
async function fetchOpenAiCompatibleModels(options) {
  const endpoint = openAiModelsUrl(options.baseUrl);
  const isAnthropic = normalizeApiFormat(options.apiFormat) === "anthropic_messages";
  const headers = { Accept: "application/json" };
  if (isAnthropic) {
    headers["x-api-key"] = options.apiKey;
    headers["anthropic-version"] = "2023-06-01";
  } else {
    headers.Authorization = `Bearer ${options.apiKey}`;
  }
  let timeout;
  try {
    const response = await Promise.race([
      (0, import_obsidian.requestUrl)({
        url: endpoint,
        method: "GET",
        headers,
        throw: false
      }),
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error("\u6A21\u578B\u63A5\u53E3\u8BF7\u6C42\u8D85\u65F6\uFF0815 \u79D2\uFF09")), 15e3);
      })
    ]);
    if (response.status < 200 || response.status >= 300) {
      const label = response.status === 401 ? "\u6A21\u578B\u63A5\u53E3\u9274\u6743\u5931\u8D25" : response.status === 403 ? "\u6A21\u578B\u63A5\u53E3\u8BF7\u6C42\u88AB\u62D2\u7EDD" : response.status === 404 ? "\u672A\u627E\u5230\u6A21\u578B\u63A5\u53E3" : "\u6A21\u578B\u63A5\u53E3\u8BF7\u6C42\u5931\u8D25";
      const detail = responseErrorDetail(response.text);
      throw new Error(`${label} (HTTP ${response.status})${detail ? `\uFF1A${detail}` : ""}`);
    }
    let payload;
    try {
      payload = JSON.parse(response.text);
    } catch {
      throw new Error("\u6A21\u578B\u63A5\u53E3\u6CA1\u6709\u8FD4\u56DE\u6709\u6548 JSON");
    }
    const models = modelIdsFromResponse(payload);
    if (models.length === 0) {
      throw new Error("\u6A21\u578B\u63A5\u53E3\u8FD4\u56DE\u6210\u529F\uFF0C\u4F46\u5217\u8868\u4E3A\u7A7A");
    }
    return { endpoint, models };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(message.replaceAll(options.apiKey, "***"));
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
async function fetchCcSwitchProviderModels(options) {
  const runtime = resolveCcSwitchProviderRuntime({
    dbPath: options.dbPath,
    appType: options.appType,
    followCurrent: false,
    providerId: options.providerId
  });
  return fetchOpenAiCompatibleModels({
    baseUrl: runtime.baseUrl,
    apiKey: runtime.apiKey
  });
}
function openAiEndpointUrl(baseUrl, suffix) {
  const url = new URL(normalizeOpenAiBaseUrl(baseUrl));
  const path = url.pathname.replace(/\/+$/, "");
  url.pathname = path ? `${path}/${suffix}` : `v1/${suffix}`;
  return url.toString();
}
function httpStatusLabel(status) {
  if (status === 401) return "\u9274\u6743\u5931\u8D25";
  if (status === 403) return "\u8BF7\u6C42\u88AB\u62D2\u7EDD";
  if (status === 404) return "\u6A21\u578B\u6216\u63A5\u53E3\u4E0D\u5B58\u5728";
  if (status === 429) return "\u8BF7\u6C42\u9891\u7387\u8D85\u9650";
  if (status >= 500) return "\u670D\u52A1\u7AEF\u4E0D\u53EF\u7528";
  return "\u8BF7\u6C42\u5931\u8D25";
}
async function probeOpenAiCompatibleModel(options) {
  const format = normalizeApiFormat(options.apiFormat);
  const isAnthropic = format === "anthropic_messages";
  const isResponses = format === "responses";
  const endpoint = openAiEndpointUrl(
    options.baseUrl,
    isAnthropic ? "messages" : isResponses ? "responses" : "chat/completions"
  );
  const body = isAnthropic ? {
    model: options.model,
    max_tokens: 8,
    messages: [{ role: "user", content: "ping" }]
  } : isResponses ? { model: options.model, input: "ping" } : {
    model: options.model,
    messages: [{ role: "user", content: "ping" }],
    max_tokens: 8
  };
  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json"
  };
  if (isAnthropic) {
    headers["x-api-key"] = options.apiKey;
    headers["anthropic-version"] = "2023-06-01";
  } else {
    headers.Authorization = `Bearer ${options.apiKey}`;
  }
  let timeout;
  try {
    const response = await Promise.race([
      (0, import_obsidian.requestUrl)({
        url: endpoint,
        method: "POST",
        headers,
        body: JSON.stringify(body),
        throw: false
      }),
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error("\u6A21\u578B\u8BF7\u6C42\u8D85\u65F6\uFF0830 \u79D2\uFF09")), 3e4);
      })
    ]);
    if (response.status < 200 || response.status >= 300) {
      const detail = responseErrorDetail(response.text);
      const label = httpStatusLabel(response.status);
      throw new Error(`${label} (HTTP ${response.status})${detail ? `\uFF1A${detail}` : ""}`);
    }
    return { endpoint, model: options.model };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(message.replaceAll(options.apiKey, "***"));
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

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
function icon(parent, name, className = "") {
  const element = parent.createSpan({ cls: className });
  (0, import_obsidian3.setIcon)(element, name);
  return element;
}
function actionButton(parent, options) {
  const button = parent.createEl("button", {
    cls: `ccswitch-action${options.primary ? " is-primary" : ""}`,
    attr: {
      type: "button",
      ...options.tooltip ? { "aria-label": options.tooltip } : {}
    }
  });
  icon(button, options.icon, "ccswitch-action-icon");
  button.createSpan({ text: options.label });
  button.disabled = options.disabled ?? false;
  button.addEventListener("click", options.onClick);
  return button;
}
function badge(parent, label, tone) {
  parent.createSpan({
    cls: `ccswitch-badge is-${tone}`,
    text: label
  });
}
function metadataField(parent, label, value, iconName) {
  const field = parent.createDiv({ cls: "ccswitch-meta-field" });
  const labelRow = field.createDiv({ cls: "ccswitch-meta-label" });
  icon(labelRow, iconName);
  labelRow.createSpan({ text: label });
  field.createDiv({
    cls: `ccswitch-meta-value${value ? "" : " is-empty"}`,
    text: value || "\u672A\u914D\u7F6E"
  });
}
function providerSubtitle(provider) {
  return provider.category || provider.model || provider.appType;
}
var CcSwitchProviderSettingsView = class {
  options;
  selectedAppType = "codex";
  selectedProviderId = "";
  visibleSource = null;
  configTab = "parsed";
  rawDetailExpanded = false;
  providerModelStates = /* @__PURE__ */ new Map();
  customModelStates = /* @__PURE__ */ new Map();
  customDraft = null;
  modelRequestId = 0;
  constructor(options) {
    this.options = options;
  }
  showProviderList() {
    this.selectedProviderId = "";
    this.visibleSource = null;
    this.customDraft = null;
    this.customModelStates.clear();
    this.configTab = "parsed";
    this.rawDetailExpanded = false;
  }
  customModelStateKey(draftId) {
    return draftId ?? "__new_custom_provider__";
  }
  customModelStateFor(draftId) {
    return this.customModelStates.get(this.customModelStateKey(draftId)) ?? null;
  }
  setCustomModelState(draftId, state) {
    this.customModelStates.set(this.customModelStateKey(draftId), state);
  }
  render(parent) {
    const settings = this.options.getSettings();
    const source = this.visibleSource ?? settings.providerSource;
    const section = parent.createDiv({ cls: "ccswitch-section" });
    let response = null;
    let loadError = "";
    if (source === "ccswitch") {
      try {
        response = loadCcSwitchProviders(settings.ccSwitchDbPath);
      } catch (error) {
        loadError = error instanceof Error ? error.message : String(error);
      }
    }
    const selectedProvider = response?.providers.find(
      (provider) => provider.id === this.selectedProviderId
    );
    if (selectedProvider && response) {
      this.selectedAppType = selectedProvider.appType;
      this.renderDetailNavigation(section, selectedProvider);
      const modelOptions = response.providers.filter((provider) => provider.appType === selectedProvider.appType).map((provider) => provider.model).filter((model) => Boolean(model));
      const modelState = this.ensureProviderModels(selectedProvider);
      const detail = section.createDiv({ cls: "ccswitch-provider-detail" });
      this.renderProviderDetail(detail, selectedProvider, settings, modelOptions, modelState);
      return true;
    }
    if (this.selectedProviderId) this.selectedProviderId = "";
    const back = section.createDiv({ cls: "ccswitch-page-back" });
    actionButton(back, {
      label: "\u8FD4\u56DE\u8BBE\u7F6E",
      icon: "arrow-left",
      onClick: () => {
        this.showProviderList();
        this.options.onBack();
      }
    });
    const heading = section.createDiv({ cls: "ccswitch-heading" });
    const headingCopy = heading.createDiv();
    headingCopy.createEl("h2", { text: "\u4F9B\u5E94\u5546" });
    const sourceSwitch = heading.createDiv({
      cls: "ccswitch-source-switch",
      attr: { "aria-label": "\u4F9B\u5E94\u5546\u914D\u7F6E\u6765\u6E90" }
    });
    this.renderSourceButton(sourceSwitch, "cc-switch", "database", "ccswitch", source);
    this.renderSourceButton(sourceSwitch, "\u81EA\u5B9A\u4E49", "sliders-horizontal", "custom", source);
    if (source === "custom") {
      this.renderCustomProvider(section, settings);
      return false;
    }
    this.renderDatabaseCard(section, response?.dbPath ?? null, loadError);
    if (!response) {
      this.renderError(section, loadError);
      return false;
    }
    const counts = /* @__PURE__ */ new Map();
    for (const provider of response.providers) {
      counts.set(provider.appType, (counts.get(provider.appType) ?? 0) + 1);
    }
    const appTypes = [...counts.keys()].sort((left, right) => {
      if (left === "codex") return -1;
      if (right === "codex") return 1;
      return left.localeCompare(right);
    });
    if (!appTypes.includes(this.selectedAppType)) {
      this.selectedAppType = appTypes.includes(settings.ccSwitchAppType) ? settings.ccSwitchAppType : appTypes[0] ?? "codex";
    }
    this.renderTypeTabs(section, appTypes, counts);
    const visibleProviders = response.providers.filter(
      (provider) => provider.appType === this.selectedAppType
    );
    section.createDiv({
      cls: "ccswitch-provider-count",
      text: `\u5171 ${visibleProviders.length} \u4E2A\u4F9B\u5E94\u5546`
    });
    if (visibleProviders.length === 0) {
      const empty = section.createDiv({ cls: "ccswitch-empty" });
      icon(empty, "package-open");
      empty.createSpan({ text: "\u8BE5\u7C7B\u578B\u4E0B\u6CA1\u6709\u4F9B\u5E94\u5546" });
      return false;
    }
    const list = section.createDiv({ cls: "ccswitch-provider-list" });
    for (const provider of visibleProviders) {
      this.renderProviderRow(list, provider, settings);
    }
    return false;
  }
  renderDetailNavigation(parent, provider) {
    const navigation = parent.createDiv({ cls: "ccswitch-detail-navigation" });
    actionButton(navigation, {
      label: "\u8FD4\u56DE\u4F9B\u5E94\u5546",
      icon: "arrow-left",
      onClick: () => {
        this.showProviderList();
        this.options.rerender();
      }
    });
    const copy = navigation.createDiv({ cls: "ccswitch-detail-navigation-copy" });
    copy.createEl("h2", { text: provider.name });
    copy.createDiv({ text: `${provider.appType} \u4F9B\u5E94\u5546\u914D\u7F6E` });
  }
  renderSourceButton(parent, label, iconName, source, visibleSource) {
    const active = visibleSource === source;
    const button = parent.createEl("button", {
      cls: `ccswitch-source-button${active ? " is-active" : ""}`,
      attr: { type: "button", "aria-pressed": String(active) }
    });
    icon(button, iconName);
    button.createSpan({ text: label });
    button.addEventListener("click", () => {
      this.selectedProviderId = "";
      this.visibleSource = source;
      if (source === "custom") {
        this.customDraft = null;
        void this.options.updateSettings({ providerSource: "custom" }).then(() => {
          this.options.rerender();
        });
        return;
      }
      void this.options.updateSettings({ providerSource: source }).then(() => {
        this.options.rerender();
      });
    });
  }
  customDraftFromSettings() {
    const settings = this.options.getSettings();
    const active = settings.customProviders.find((p) => p.id === settings.activeCustomProviderId) ?? settings.customProviders[0];
    if (active) {
      return {
        id: active.id,
        name: active.name,
        baseUrl: active.baseUrl,
        apiKey: active.apiKey,
        model: active.model,
        apiFormat: active.apiFormat
      };
    }
    return {
      id: null,
      name: "",
      baseUrl: "",
      apiKey: "",
      model: "",
      apiFormat: "chat_completions"
    };
  }
  renderCustomProvider(parent, settings) {
    const card = parent.createDiv({ cls: "ccswitch-custom-card" });
    const heading = card.createDiv({ cls: "ccswitch-custom-heading" });
    const title = heading.createDiv({ cls: "ccswitch-section-title" });
    icon(title, "sliders-horizontal");
    title.createSpan({ text: "\u81EA\u5B9A\u4E49\u4F9B\u5E94\u5546" });
    actionButton(heading, {
      label: "\u6DFB\u52A0\u4F9B\u5E94\u5546",
      icon: "plus",
      onClick: () => {
        this.customModelStates.delete(this.customModelStateKey(null));
        this.customDraft = {
          id: null,
          name: "",
          baseUrl: "",
          apiKey: "",
          model: "",
          apiFormat: "chat_completions"
        };
        this.options.rerender();
      }
    });
    const providers = settings.customProviders;
    if (providers.length > 0) {
      const list = card.createDiv({ cls: "ccswitch-custom-provider-list" });
      for (const provider of providers) {
        this.renderCustomProviderRow(list, provider, settings);
      }
    }
    const draft = this.customDraft ?? this.customDraftFromSettings();
    this.renderCustomProviderForm(card, draft, settings);
  }
  renderCustomProviderRow(parent, provider, settings) {
    const row = parent.createDiv({ cls: "ccswitch-custom-provider-entry" });
    const isActive = settings.providerSource === "custom" && settings.activeCustomProviderId === provider.id;
    const copy = row.createDiv({ cls: "ccswitch-custom-provider-entry-copy" });
    copy.createDiv({
      cls: "ccswitch-custom-provider-entry-name",
      text: provider.name.trim() || "\u672A\u547D\u540D\u4F9B\u5E94\u5546"
    });
    const subtitle = provider.model.trim() || "\u5C1A\u672A\u9009\u62E9\u6A21\u578B";
    const formatLabel = provider.apiFormat === "anthropic_messages" ? "Anthropic" : provider.apiFormat === "responses" ? "Responses" : "Chat";
    copy.createDiv({
      cls: "ccswitch-custom-provider-entry-sub",
      text: `${subtitle} \xB7 ${formatLabel}`
    });
    if (isActive) badge(row, "\u4F7F\u7528\u4E2D", "accent");
    const trailing = row.createDiv({ cls: "ccswitch-custom-provider-entry-actions" });
    actionButton(trailing, {
      label: isActive ? "\u4F7F\u7528\u4E2D" : "\u4F7F\u7528",
      icon: isActive ? "check" : "play",
      primary: !isActive,
      disabled: isActive,
      onClick: () => this.activateExistingProvider(provider.id)
    });
    actionButton(trailing, {
      label: "\u7F16\u8F91",
      icon: "pencil",
      onClick: () => {
        this.customDraft = {
          id: provider.id,
          name: provider.name,
          baseUrl: provider.baseUrl,
          apiKey: provider.apiKey,
          model: provider.model,
          apiFormat: provider.apiFormat
        };
        this.options.rerender();
      }
    });
    actionButton(trailing, {
      label: "\u5220\u9664",
      icon: "trash-2",
      onClick: () => this.deleteCustomProvider(provider.id)
    });
    row.addEventListener("click", (event) => {
      if (event.target.closest("button")) return;
      this.customDraft = {
        id: provider.id,
        name: provider.name,
        baseUrl: provider.baseUrl,
        apiKey: provider.apiKey,
        model: provider.model,
        apiFormat: provider.apiFormat
      };
      this.options.rerender();
    });
  }
  renderCustomProviderForm(parent, draft, settings) {
    const form = parent.createDiv({ cls: "ccswitch-custom-form" });
    const formTitle = form.createDiv({ cls: "ccswitch-custom-form-title" });
    formTitle.createSpan({
      text: draft.id ? "\u7F16\u8F91\u4F9B\u5E94\u5546" : "\u65B0\u4F9B\u5E94\u5546"
    });
    const modelState = this.customModelStateFor(draft.id);
    const status = form.createDiv({
      cls: `ccswitch-custom-status${modelState?.status === "loaded" ? " is-success" : modelState?.status === "error" ? " is-error" : ""}`,
      text: this.customStatusText(draft.id)
    });
    let discoveredModelSelect = null;
    const invalidateTest = () => {
      this.customModelStates.delete(this.customModelStateKey(draft.id));
      status.className = "ccswitch-custom-status is-warning";
      status.setText("\u914D\u7F6E\u5DF2\u66F4\u6539\uFF0C\u8BF7\u91CD\u65B0\u6D4B\u8BD5\u8FDE\u63A5");
      if (discoveredModelSelect) {
        discoveredModelSelect.empty();
        discoveredModelSelect.createEl("option", {
          value: "",
          text: "\u5237\u65B0\u540E\u53EF\u9009\u62E9\u6A21\u578B"
        });
        discoveredModelSelect.value = "";
        discoveredModelSelect.disabled = true;
      }
    };
    this.renderCustomTextField(form, {
      label: "\u4F9B\u5E94\u5546\u540D\u79F0",
      value: draft.name,
      placeholder: "\u4F8B\u5982\uFF1AMy API",
      onInput: (value) => {
        draft.name = value;
      }
    });
    this.renderCustomTextField(form, {
      label: "API Base URL",
      value: draft.baseUrl,
      placeholder: "https://example.com/v1",
      onInput: (value) => {
        draft.baseUrl = value;
        invalidateTest();
      }
    });
    if (this.isUntrustedHttpUrl(draft.baseUrl)) {
      form.createDiv({
        cls: "ccswitch-custom-status is-warning",
        text: "\u8FDC\u7A0B HTTP \u4F1A\u660E\u6587\u4F20\u8F93 API Key\uFF1B\u8BF7\u6539\u7528\u53EF\u4FE1 HTTPS\u3002localhost HTTP \u4E0D\u53D7\u6B64\u9650\u5236\u3002"
      });
    }
    const keyField = form.createDiv({ cls: "ccswitch-custom-field" });
    keyField.createEl("label", { text: "API Key" });
    const keyRow = keyField.createDiv({ cls: "ccswitch-custom-password-row" });
    const keyInput = keyRow.createEl("input", {
      attr: {
        type: "password",
        value: draft.apiKey,
        placeholder: "sk-...",
        autocomplete: "off",
        "aria-label": "\u81EA\u5B9A\u4E49\u4F9B\u5E94\u5546 API Key"
      }
    });
    keyInput.addEventListener("input", () => {
      draft.apiKey = keyInput.value;
      invalidateTest();
    });
    const reveal = keyRow.createEl("button", {
      cls: "clickable-icon ccswitch-custom-key-toggle",
      attr: { type: "button", "aria-label": "\u663E\u793A API Key", "aria-pressed": "false" }
    });
    (0, import_obsidian3.setIcon)(reveal, "eye");
    reveal.addEventListener("click", () => {
      const visible = keyInput.type === "text";
      keyInput.type = visible ? "password" : "text";
      reveal.setAttribute("aria-label", visible ? "\u663E\u793A API Key" : "\u9690\u85CF API Key");
      reveal.setAttribute("aria-pressed", String(!visible));
      (0, import_obsidian3.setIcon)(reveal, visible ? "eye" : "eye-off");
    });
    keyField.createDiv({
      cls: "ccswitch-custom-hint is-warning",
      text: "API Key \u4F1A\u660E\u6587\u4FDD\u5B58\u5728\u5F53\u524D Vault \u7684\u63D2\u4EF6 data.json\uFF1B\u4E0D\u4F1A\u5199\u5165\u65E5\u5FD7\u6216\u547D\u4EE4\u884C\u3002"
    });
    const formatField = form.createDiv({ cls: "ccswitch-custom-field" });
    formatField.createEl("label", { text: "API \u683C\u5F0F" });
    const formatSelect = formatField.createEl("select", {
      cls: "dropdown ccswitch-custom-select",
      attr: { "aria-label": "\u9009\u62E9 API \u683C\u5F0F" }
    });
    formatSelect.createEl("option", { value: "anthropic_messages", text: "Anthropic Messages" });
    formatSelect.createEl("option", { value: "chat_completions", text: "Chat Completions" });
    formatSelect.createEl("option", { value: "responses", text: "Responses API" });
    formatSelect.value = draft.apiFormat;
    formatSelect.addEventListener("change", () => {
      draft.apiFormat = normalizeApiFormat(formatSelect.value);
      invalidateTest();
    });
    const modelField = form.createDiv({ cls: "ccswitch-custom-field" });
    modelField.createEl("label", { text: "\u6A21\u578B" });
    const modelRow = modelField.createDiv({ cls: "ccswitch-custom-model-controls" });
    const models = modelState?.status === "loaded" ? modelState.models : [];
    const modelSelect = modelRow.createEl("select", {
      cls: "dropdown ccswitch-custom-model-select",
      attr: { "aria-label": "\u9009\u62E9\u5DF2\u53D1\u73B0\u6A21\u578B" }
    });
    discoveredModelSelect = modelSelect;
    modelSelect.createEl("option", {
      value: "",
      text: models.length > 0 ? "\u9009\u62E9\u5DF2\u53D1\u73B0\u6A21\u578B\u2026" : "\u5237\u65B0\u540E\u53EF\u9009\u62E9\u6A21\u578B"
    });
    for (const model of models) {
      modelSelect.createEl("option", { value: model, text: model });
    }
    modelSelect.disabled = models.length === 0;
    modelSelect.value = models.includes(draft.model) ? draft.model : "";
    const modelInput = modelRow.createEl("input", {
      cls: "ccswitch-custom-model-input",
      attr: {
        type: "text",
        value: draft.model,
        placeholder: "\u4E5F\u53EF\u624B\u52A8\u8F93\u5165\u6A21\u578B\u540D\u79F0",
        "aria-label": "\u624B\u52A8\u8F93\u5165\u81EA\u5B9A\u4E49\u4F9B\u5E94\u5546\u6A21\u578B"
      }
    });
    modelSelect.addEventListener("change", () => {
      if (!modelSelect.value) return;
      draft.model = modelSelect.value;
      modelInput.value = modelSelect.value;
    });
    modelInput.addEventListener("input", () => {
      draft.model = modelInput.value;
      modelSelect.value = models.includes(modelInput.value) ? modelInput.value : "";
    });
    const actions = form.createDiv({ cls: "ccswitch-custom-action-row" });
    const loading = modelState?.status === "loading";
    actionButton(actions, {
      label: loading ? "\u8FDE\u63A5\u4E2D..." : "\u5237\u65B0\u6A21\u578B",
      icon: loading ? "loader-circle" : "refresh-cw",
      disabled: loading,
      onClick: () => this.startCustomModelRequest(false)
    });
    actionButton(actions, {
      label: loading ? "\u6D4B\u8BD5\u4E2D..." : "\u6D4B\u8BD5\u8FDE\u63A5",
      icon: loading ? "loader-circle" : "plug-zap",
      disabled: loading,
      onClick: () => this.startCustomModelRequest(true)
    });
    actionButton(actions, {
      label: draft.id ? "\u4FDD\u5B58\u5E76\u4F7F\u7528" : "\u6DFB\u52A0\u5E76\u4F7F\u7528",
      icon: "check",
      primary: true,
      onClick: () => this.saveCustomProvider()
    });
  }
  renderCustomTextField(parent, options) {
    const field = parent.createDiv({ cls: "ccswitch-custom-field" });
    field.createEl("label", { text: options.label });
    const input = field.createEl("input", {
      attr: { type: "text", value: options.value, placeholder: options.placeholder }
    });
    input.addEventListener("input", () => options.onInput(input.value));
  }
  isUntrustedHttpUrl(value) {
    try {
      const url = new URL(value.trim());
      if (url.protocol !== "http:") return false;
      return !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname.toLowerCase());
    } catch {
      return false;
    }
  }
  customStatusText(draftId) {
    const state = this.customModelStateFor(draftId);
    if (!state) return "\u5C1A\u672A\u6D4B\u8BD5\u8FDE\u63A5";
    if (state.status === "loading") return "\u6B63\u5728\u83B7\u53D6\u6A21\u578B\u5217\u8868...";
    if (state.status === "error") return `\u6A21\u578B\u5217\u8868\u83B7\u53D6\u5931\u8D25\uFF1A${state.error}`;
    if (state.probeStatus === "probing") return "\u6B63\u5728\u53D1\u9001\u771F\u5B9E\u6A21\u578B\u8BF7\u6C42...";
    if (state.probeStatus === "probe_error") return `\u6A21\u578B\u8C03\u7528\u5931\u8D25\uFF1A${state.probeError}`;
    if (state.probeStatus === "probed") return `\u6A21\u578B\u8C03\u7528\u6210\u529F\uFF1A\u53D1\u73B0 ${state.models.length} \u4E2A\u6A21\u578B\uFF0C\u6A21\u578B\u53EF\u6B63\u5E38\u8C03\u7528`;
    return `\u6A21\u578B\u63A5\u53E3\u53EF\u7528\uFF1A\u53D1\u73B0 ${state.models.length} \u4E2A\u6A21\u578B\uFF08\u672A\u6D4B\u8BD5\u6A21\u578B\u8C03\u7528\uFF09`;
  }
  startCustomModelRequest(showNotice) {
    const draft = this.customDraft ??= this.customDraftFromSettings();
    const draftId = draft.id;
    if (!draft.baseUrl.trim() || !draft.apiKey.trim()) {
      const message = "\u8BF7\u5148\u586B\u5199 API Base URL \u548C API Key";
      this.setCustomModelState(draftId, {
        requestId: ++this.modelRequestId,
        status: "error",
        models: [],
        endpoint: "",
        error: message,
        probeStatus: "idle",
        probeError: ""
      });
      if (showNotice) new import_obsidian3.Notice(message);
      this.options.rerender();
      return;
    }
    const requestId = ++this.modelRequestId;
    this.setCustomModelState(draftId, {
      requestId,
      status: "loading",
      models: [],
      endpoint: "",
      error: "",
      probeStatus: "idle",
      probeError: ""
    });
    this.options.rerender();
    void fetchOpenAiCompatibleModels({
      baseUrl: draft.baseUrl,
      apiKey: draft.apiKey,
      apiFormat: draft.apiFormat
    }).then((response) => {
      const current = this.customModelStateFor(draftId);
      if (current?.requestId !== requestId) return;
      this.setCustomModelState(draftId, {
        requestId,
        status: "loaded",
        models: response.models,
        endpoint: response.endpoint,
        error: "",
        probeStatus: "idle",
        probeError: ""
      });
      if (!draft.model && response.models.length > 0) draft.model = response.models[0];
      if (showNotice) {
        this.probeModel(draft, requestId);
      } else {
        new import_obsidian3.Notice(`\u5237\u65B0\u6210\u529F\uFF0C\u53D1\u73B0 ${response.models.length} \u4E2A\u6A21\u578B`);
        this.options.rerender();
      }
    }).catch((error) => {
      const current = this.customModelStateFor(draftId);
      if (current?.requestId !== requestId) return;
      const message = error instanceof Error ? error.message : String(error);
      this.setCustomModelState(draftId, {
        requestId,
        status: "error",
        models: [],
        endpoint: "",
        error: message,
        probeStatus: "idle",
        probeError: ""
      });
      if (showNotice) new import_obsidian3.Notice(`\u8FDE\u63A5\u5931\u8D25
${message}`, 8e3);
      this.options.rerender();
    });
  }
  probeModel(draft, listRequestId) {
    const draftId = draft.id;
    const model = draft.model.trim();
    if (!model) {
      const current2 = this.customModelStateFor(draftId);
      if (current2?.requestId === listRequestId) {
        this.setCustomModelState(draftId, {
          ...current2,
          probeStatus: "probe_error",
          probeError: "\u8BF7\u5148\u9009\u62E9\u6216\u8F93\u5165\u6A21\u578B\u540D\u79F0"
        });
        new import_obsidian3.Notice("\u8BF7\u5148\u9009\u62E9\u6216\u8F93\u5165\u6A21\u578B\u540D\u79F0", 8e3);
        this.options.rerender();
      }
      return;
    }
    const current = this.customModelStateFor(draftId);
    if (current?.requestId === listRequestId) {
      this.setCustomModelState(draftId, { ...current, probeStatus: "probing" });
      this.options.rerender();
    }
    void probeOpenAiCompatibleModel({
      baseUrl: draft.baseUrl,
      apiKey: draft.apiKey,
      model,
      apiFormat: draft.apiFormat
    }).then(() => {
      const state = this.customModelStateFor(draftId);
      if (state?.requestId !== listRequestId) return;
      this.setCustomModelState(draftId, { ...state, probeStatus: "probed", probeError: "" });
      new import_obsidian3.Notice(`\u8FDE\u63A5\u6210\u529F\uFF0C\u6A21\u578B ${model} \u53EF\u6B63\u5E38\u8C03\u7528`);
      this.options.rerender();
    }).catch((error) => {
      const state = this.customModelStateFor(draftId);
      if (state?.requestId !== listRequestId) return;
      const message = error instanceof Error ? error.message : String(error);
      this.setCustomModelState(draftId, { ...state, probeStatus: "probe_error", probeError: message });
      new import_obsidian3.Notice(`\u6A21\u578B\u8C03\u7528\u5931\u8D25
${message}`, 8e3);
      this.options.rerender();
    });
  }
  saveCustomProvider() {
    const draft = this.customDraft ??= this.customDraftFromSettings();
    try {
      const name = draft.name.trim();
      const baseUrl = normalizeOpenAiBaseUrl(draft.baseUrl);
      const apiKey = draft.apiKey.trim();
      const model = draft.model.trim();
      if (!name) throw new Error("\u8BF7\u586B\u5199\u4F9B\u5E94\u5546\u540D\u79F0");
      if (!apiKey) throw new Error("\u8BF7\u586B\u5199 API Key");
      if (!model) throw new Error("\u8BF7\u9009\u62E9\u6216\u8F93\u5165\u6A21\u578B\u540D\u79F0");
      const settings = this.options.getSettings();
      const isNew = draft.id === null;
      const previousStateKey = this.customModelStateKey(draft.id);
      let providers;
      let activeId;
      if (draft.id) {
        providers = settings.customProviders.map(
          (p) => p.id === draft.id ? { id: p.id, name, baseUrl, apiKey, model, apiFormat: draft.apiFormat } : p
        );
        activeId = draft.id;
      } else {
        const newId = `cp_${Date.now()}`;
        providers = [
          ...settings.customProviders,
          { id: newId, name, baseUrl, apiKey, model, apiFormat: draft.apiFormat }
        ];
        activeId = newId;
        draft.id = newId;
        const pendingState = this.customModelStates.get(previousStateKey);
        if (pendingState) {
          this.customModelStates.set(newId, pendingState);
          this.customModelStates.delete(previousStateKey);
        }
      }
      void this.options.updateSettings({
        providerSource: "custom",
        customProviders: providers,
        activeCustomProviderId: activeId
      }).then(() => {
        this.customDraft = this.customDraftFromSettings();
        new import_obsidian3.Notice(isNew ? "\u5DF2\u6DFB\u52A0\u4F9B\u5E94\u5546" : "\u5DF2\u4FDD\u5B58\u4F9B\u5E94\u5546");
        this.options.rerender();
      });
    } catch (error) {
      new import_obsidian3.Notice(error instanceof Error ? error.message : String(error), 8e3);
    }
  }
  activateExistingProvider(providerId) {
    void this.options.updateSettings({
      providerSource: "custom",
      activeCustomProviderId: providerId
    }).then(() => {
      new import_obsidian3.Notice("\u5DF2\u5207\u6362\u4F9B\u5E94\u5546");
      this.options.rerender();
    });
  }
  deleteCustomProvider(providerId) {
    const settings = this.options.getSettings();
    const providers = settings.customProviders.filter((p) => p.id !== providerId);
    let activeId = settings.activeCustomProviderId;
    if (activeId === providerId) {
      activeId = providers[0]?.id ?? "";
    }
    void this.options.updateSettings({
      customProviders: providers,
      activeCustomProviderId: activeId
    }).then(() => {
      this.customModelStates.delete(providerId);
      this.customDraft = null;
      new import_obsidian3.Notice("\u5DF2\u5220\u9664\u4F9B\u5E94\u5546");
      this.options.rerender();
    });
  }
  renderDatabaseCard(parent, connectedPath, loadError) {
    const settings = this.options.getSettings();
    const card = parent.createDiv({ cls: "ccswitch-database-card" });
    const top = card.createDiv({ cls: "ccswitch-database-top" });
    const identity = top.createDiv({ cls: "ccswitch-database-identity" });
    const tile = identity.createDiv({ cls: "ccswitch-icon-tile" });
    icon(tile, "database");
    const copy = identity.createDiv({ cls: "ccswitch-database-copy" });
    const title = copy.createDiv({ cls: "ccswitch-database-title" });
    title.createSpan({ text: "cc-switch \u6570\u636E\u5E93" });
    badge(title, connectedPath ? "\u5DF2\u8FDE\u63A5" : "\u672A\u8FDE\u63A5", connectedPath ? "accent" : "neutral");
    copy.createDiv({
      cls: "ccswitch-database-description",
      text: "\u53EA\u8BFB\u89E3\u6790\u4F9B\u5E94\u5546\u914D\u7F6E\uFF1B\u5BC6\u94A5\u5DF2\u8131\u654F\uFF0C\u7559\u7A7A\u4F7F\u7528\u9ED8\u8BA4\u8DEF\u5F84\u3002"
    });
    const controls = top.createDiv({ cls: "ccswitch-database-controls" });
    const fileInput = card.createEl("input", {
      cls: "ccswitch-hidden-input",
      attr: { type: "file", accept: ".db" }
    });
    fileInput.addEventListener("change", () => {
      const file = fileInput.files?.[0];
      if (!file) return;
      const electron = require("electron");
      const path = electron.webUtils?.getPathForFile(file) ?? file.path ?? "";
      if (!path) {
        new import_obsidian3.Notice("\u65E0\u6CD5\u8BFB\u53D6\u6240\u9009\u6570\u636E\u5E93\u7684\u672C\u5730\u8DEF\u5F84");
        return;
      }
      void this.options.updateSettings({ ccSwitchDbPath: path }).then(() => {
        this.selectedProviderId = "";
        this.providerModelStates.clear();
        this.options.rerender();
      });
    });
    actionButton(controls, {
      label: "\u9009\u62E9\u6587\u4EF6",
      icon: "folder-open",
      onClick: () => fileInput.click()
    });
    if (settings.ccSwitchDbPath) {
      actionButton(controls, {
        label: "\u9ED8\u8BA4\u8DEF\u5F84",
        icon: "undo-2",
        onClick: () => {
          void this.options.updateSettings({ ccSwitchDbPath: "" }).then(() => {
            this.selectedProviderId = "";
            this.providerModelStates.clear();
            this.options.rerender();
          });
        }
      });
    }
    actionButton(controls, {
      label: "\u5237\u65B0",
      icon: "refresh-cw",
      onClick: () => {
        this.providerModelStates.clear();
        this.options.rerender();
      }
    });
    card.createEl("code", {
      cls: "ccswitch-database-path",
      text: connectedPath ?? (settings.ccSwitchDbPath || defaultCcSwitchDbPath()),
      attr: { title: loadError || connectedPath || "" }
    });
  }
  renderError(parent, message) {
    const error = parent.createDiv({ cls: "ccswitch-error" });
    icon(error, "triangle-alert");
    const text = error.createDiv();
    text.createEl("strong", { text: "\u65E0\u6CD5\u8BFB\u53D6 cc-switch" });
    text.createDiv({ text: message || "\u672A\u77E5\u9519\u8BEF" });
  }
  renderTypeTabs(parent, appTypes, counts) {
    const tabs = parent.createDiv({ cls: "ccswitch-type-tabs" });
    for (const appType of appTypes) {
      const button = tabs.createEl("button", {
        cls: `ccswitch-type-tab${appType === this.selectedAppType ? " is-active" : ""}`,
        text: `${appType} (${counts.get(appType) ?? 0})`,
        attr: { type: "button" }
      });
      button.addEventListener("click", () => {
        this.selectedAppType = appType;
        this.selectedProviderId = "";
        this.options.rerender();
      });
    }
  }
  isProviderActive(provider, settings) {
    if (settings.providerSource !== "ccswitch") return false;
    if (settings.ccSwitchAppType !== provider.appType) return false;
    return settings.ccSwitchFollowCurrent ? provider.isCurrent : provider.id === settings.ccSwitchProviderId;
  }
  renderProviderRow(parent, provider, settings) {
    const active = this.isProviderActive(provider, settings);
    const row = parent.createEl("button", {
      cls: `ccswitch-provider-row${active ? " is-active" : ""}`,
      attr: { type: "button", "aria-label": `\u67E5\u770B ${provider.name} \u914D\u7F6E` }
    });
    const tile = row.createDiv({ cls: "ccswitch-provider-icon" });
    icon(tile, provider.usable ? "server" : "server-off");
    const copy = row.createDiv({ cls: "ccswitch-provider-row-copy" });
    copy.createDiv({ cls: "ccswitch-provider-name", text: provider.name });
    copy.createDiv({ cls: "ccswitch-provider-subtitle", text: providerSubtitle(provider) });
    const trailing = row.createDiv({ cls: "ccswitch-provider-trailing" });
    if (active) badge(trailing, "\u4F7F\u7528\u4E2D", "accent");
    else if (provider.isCurrent) badge(trailing, "\u5168\u5C40\u5F53\u524D", "neutral");
    icon(trailing, "chevron-right");
    row.addEventListener("click", () => {
      this.selectedProviderId = provider.id;
      this.configTab = "parsed";
      this.rawDetailExpanded = false;
      this.providerModelStates.delete(this.providerModelKey(provider));
      this.options.rerender();
    });
  }
  renderProviderDetail(parent, provider, settings, modelOptions, modelState) {
    const hero = parent.createDiv({ cls: "ccswitch-detail-hero" });
    const heroMain = hero.createDiv({ cls: "ccswitch-detail-main" });
    const tile = heroMain.createDiv({ cls: "ccswitch-detail-icon" });
    icon(tile, "boxes");
    const copy = heroMain.createDiv({ cls: "ccswitch-detail-copy" });
    const title = copy.createDiv({ cls: "ccswitch-detail-title" });
    title.createEl("h3", { text: provider.name });
    if (provider.isCurrent) badge(title, "\u5168\u5C40\u5F53\u524D", "accent");
    if (!provider.usable) badge(title, "\u914D\u7F6E\u4E0D\u53EF\u7528", "danger");
    copy.createDiv({
      cls: "ccswitch-detail-notes",
      text: provider.notes || provider.websiteUrl || "\u6765\u81EA cc-switch \u7684\u4F9B\u5E94\u5546\u914D\u7F6E"
    });
    const actions = hero.createDiv({ cls: "ccswitch-detail-actions" });
    const pinned = settings.providerSource === "ccswitch" && !settings.ccSwitchFollowCurrent && settings.ccSwitchAppType === provider.appType && settings.ccSwitchProviderId === provider.id;
    actionButton(actions, {
      label: pinned ? "\u5DF2\u56FA\u5B9A\u6B64\u4F9B\u5E94\u5546" : "\u56FA\u5B9A\u4F7F\u7528\u6B64\u4F9B\u5E94\u5546",
      icon: pinned ? "check" : "pin",
      primary: !pinned,
      disabled: pinned || !provider.usable,
      onClick: () => {
        void this.options.updateSettings({
          providerSource: "ccswitch",
          ccSwitchAppType: provider.appType,
          ccSwitchFollowCurrent: false,
          ccSwitchProviderId: provider.id
        }).then(() => this.options.rerender());
      }
    });
    actionButton(actions, {
      label: "\u8DDF\u968F\u5168\u5C40\u5F53\u524D",
      icon: "refresh-cw",
      disabled: settings.providerSource === "ccswitch" && settings.ccSwitchFollowCurrent && settings.ccSwitchAppType === provider.appType,
      onClick: () => {
        void this.options.updateSettings({
          providerSource: "ccswitch",
          ccSwitchAppType: provider.appType,
          ccSwitchFollowCurrent: true,
          ccSwitchProviderId: ""
        }).then(() => this.options.rerender());
      }
    });
    this.renderModelSelector(parent, provider, settings, modelOptions, modelState);
    const metadata = parent.createDiv({ cls: "ccswitch-metadata-grid" });
    metadataField(metadata, "CLI \u7C7B\u578B", provider.appType, "terminal");
    metadataField(metadata, "Base URL", provider.baseUrl, "link-2");
    metadataField(metadata, "\u6A21\u578B", provider.model, "cpu");
    metadataField(metadata, "API \u683C\u5F0F", provider.apiFormat, "braces");
    const rawToggle = parent.createEl("button", {
      cls: "ccswitch-raw-toggle",
      attr: {
        type: "button",
        "aria-expanded": String(this.rawDetailExpanded)
      }
    });
    icon(rawToggle, this.rawDetailExpanded ? "chevron-down" : "chevron-right");
    rawToggle.createSpan({ text: "\u67E5\u770B\u539F\u59CB\u914D\u7F6E\uFF08\u5DF2\u8131\u654F\uFF09" });
    rawToggle.addEventListener("click", () => {
      this.rawDetailExpanded = !this.rawDetailExpanded;
      this.options.rerender();
    });
    if (!this.rawDetailExpanded) return;
    const envSection = parent.createDiv({ cls: "ccswitch-detail-section" });
    const envTitle = envSection.createDiv({ cls: "ccswitch-section-title" });
    icon(envTitle, "key-round");
    envTitle.createSpan({ text: "\u73AF\u5883\u53D8\u91CF" });
    const envEntries = Object.entries(provider.maskedEnv);
    if (envEntries.length === 0) {
      envSection.createDiv({ cls: "ccswitch-muted", text: "\u6CA1\u6709\u53EF\u663E\u793A\u7684\u73AF\u5883\u53D8\u91CF" });
    } else {
      const envGrid = envSection.createDiv({ cls: "ccswitch-env-grid" });
      for (const [key, value] of envEntries) {
        const card = envGrid.createDiv({ cls: "ccswitch-env-card" });
        card.createDiv({ cls: "ccswitch-env-key", text: key });
        card.createEl("code", { text: value });
      }
    }
    const configSection = parent.createDiv({ cls: "ccswitch-detail-section" });
    const configTitle = configSection.createDiv({ cls: "ccswitch-section-title" });
    icon(configTitle, "braces");
    configTitle.createSpan({ text: "\u914D\u7F6E" });
    const tabs = configSection.createDiv({ cls: "ccswitch-config-tabs" });
    this.renderConfigTab(tabs, "\u89E3\u6790\u7ED3\u679C", "parsed");
    this.renderConfigTab(tabs, "\u4F9B\u5E94\u5546\u914D\u7F6E", "raw");
    const parsedConfig = JSON.stringify(
      {
        baseUrl: provider.baseUrl,
        model: provider.model,
        apiFormat: provider.apiFormat,
        environment: provider.maskedEnv
      },
      null,
      2
    );
    const content = this.configTab === "parsed" ? parsedConfig : provider.redactedSettingsConfig;
    const codeHeader = configSection.createDiv({ cls: "ccswitch-code-header" });
    codeHeader.createSpan({
      text: this.configTab === "parsed" ? "\u63D2\u4EF6\u5B9E\u9645\u4F7F\u7528\u7684\u89E3\u6790\u7ED3\u679C" : "\u5BC6\u94A5\u5DF2\u8131\u654F"
    });
    const copyButton = codeHeader.createEl("button", {
      cls: "clickable-icon",
      attr: { type: "button", "aria-label": "\u590D\u5236\u914D\u7F6E" }
    });
    (0, import_obsidian3.setIcon)(copyButton, "copy");
    copyButton.addEventListener("click", () => {
      void navigator.clipboard.writeText(content).then(() => new import_obsidian3.Notice("\u914D\u7F6E\u5DF2\u590D\u5236")).catch(() => new import_obsidian3.Notice("\u590D\u5236\u5931\u8D25\uFF0C\u8BF7\u624B\u52A8\u9009\u62E9\u914D\u7F6E"));
    });
    configSection.createEl("pre", { cls: "ccswitch-code-block", text: content });
  }
  renderModelSelector(parent, provider, settings, fallbackModels, modelState) {
    const card = parent.createDiv({ cls: "ccswitch-model-selector" });
    const copy = card.createDiv({ cls: "ccswitch-model-selector-copy" });
    const title = copy.createDiv({ cls: "ccswitch-section-title" });
    icon(title, "cpu");
    title.createSpan({ text: "\u603B\u7ED3\u6A21\u578B" });
    const statusText = modelState.status === "loading" ? "\u6B63\u5728\u4F7F\u7528\u4F9B\u5E94\u5546 Key \u548C URL \u83B7\u53D6\u6A21\u578B\u5217\u8868..." : modelState.status === "loaded" ? `\u5DF2\u5B9E\u65F6\u83B7\u53D6 ${modelState.models.length} \u4E2A\u6A21\u578B` : `\u5B9E\u65F6\u83B7\u53D6\u5931\u8D25\uFF1A${modelState.error}\uFF1B\u5F53\u524D\u663E\u793A\u672C\u5730\u6A21\u578B`;
    copy.createDiv({
      cls: `ccswitch-model-status${modelState.status === "error" ? " is-error" : ""}`,
      text: statusText,
      attr: modelState.endpoint ? { title: modelState.endpoint } : {}
    });
    const controls = card.createDiv({ cls: "ccswitch-model-controls" });
    const select = controls.createEl("select", {
      cls: "dropdown ccswitch-model-dropdown",
      attr: { "aria-label": "\u9009\u62E9\u603B\u7ED3\u6A21\u578B" }
    });
    select.createEl("option", {
      value: "",
      text: provider.model ? `\u8DDF\u968F\u4F9B\u5E94\u5546\u9ED8\u8BA4 (${provider.model})` : "\u8DDF\u968F\u4F9B\u5E94\u5546\u9ED8\u8BA4"
    });
    const sourceModels = modelState.status === "loaded" ? modelState.models : fallbackModels;
    const options = [
      ...new Set([...sourceModels, provider.model ?? "", settings.model].filter(Boolean))
    ].sort((a, b) => a.localeCompare(b, "en", { numeric: true, sensitivity: "base" }));
    for (const model of options) {
      select.createEl("option", { value: model, text: model });
    }
    select.value = settings.model;
    select.addEventListener("change", () => {
      void this.options.updateSettings({ model: select.value });
    });
    const refresh = controls.createEl("button", {
      cls: `clickable-icon ccswitch-model-refresh${modelState.status === "loading" ? " is-loading" : ""}`,
      attr: { type: "button", "aria-label": "\u5B9E\u65F6\u5237\u65B0\u6A21\u578B\u5217\u8868" }
    });
    (0, import_obsidian3.setIcon)(refresh, "refresh-cw");
    refresh.disabled = modelState.status === "loading";
    refresh.addEventListener("click", () => this.startProviderModelRequest(provider, true));
  }
  providerModelKey(provider) {
    return `${provider.appType}:${provider.id}`;
  }
  ensureProviderModels(provider) {
    const existing = this.providerModelStates.get(this.providerModelKey(provider));
    return existing ?? this.startProviderModelRequest(provider, false);
  }
  startProviderModelRequest(provider, rerender) {
    const key = this.providerModelKey(provider);
    const requestId = ++this.modelRequestId;
    const state = {
      requestId,
      status: "loading",
      models: [],
      endpoint: "",
      error: "",
      probeStatus: "idle",
      probeError: ""
    };
    this.providerModelStates.set(key, state);
    if (rerender) this.options.rerender();
    void fetchCcSwitchProviderModels({
      dbPath: this.options.getSettings().ccSwitchDbPath,
      appType: provider.appType,
      providerId: provider.id
    }).then((response) => {
      if (this.providerModelStates.get(key)?.requestId !== requestId) return;
      this.providerModelStates.set(key, {
        requestId,
        status: "loaded",
        models: response.models,
        endpoint: response.endpoint,
        error: "",
        probeStatus: "idle",
        probeError: ""
      });
      this.options.rerender();
    }).catch((error) => {
      if (this.providerModelStates.get(key)?.requestId !== requestId) return;
      this.providerModelStates.set(key, {
        requestId,
        status: "error",
        models: [],
        endpoint: provider.baseUrl ?? "",
        error: error instanceof Error ? error.message : String(error),
        probeStatus: "idle",
        probeError: ""
      });
      this.options.rerender();
    });
    return state;
  }
  renderConfigTab(parent, label, value) {
    const button = parent.createEl("button", {
      cls: `ccswitch-config-tab${this.configTab === value ? " is-active" : ""}`,
      text: label,
      attr: { type: "button" }
    });
    button.addEventListener("click", () => {
      this.configTab = value;
      this.options.rerender();
    });
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
    containerEl.addClass("video-memo-settings-tab");
    containerEl.empty();
    if (this.page === "providers") {
      this.providerView.render(containerEl);
      return;
    }
    const intro = containerEl.createDiv({ cls: "video-memo-settings-intro" });
    const introMark = intro.createDiv({ cls: "video-memo-settings-mark" });
    (0, import_obsidian4.setIcon)(introMark, "video");
    const introCopy = intro.createDiv({ cls: "video-memo-settings-intro-copy" });
    introCopy.createEl("h2", { text: "VideoMemo" });
    const openProviders = () => {
      this.page = "providers";
      this.providerView.showProviderList();
      this.display();
    };
    const providerSetting = new import_obsidian4.Setting(containerEl).setName("\u4F9B\u5E94\u5546").setDesc(describeProviderSelection(this.plugin.settings)).addExtraButton(
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
    containerEl.createDiv({
      cls: "video-memo-settings-section-label",
      text: "\u8FD0\u884C\u73AF\u5883"
    });
    new import_obsidian4.Setting(containerEl).setName("\u9879\u76EE\u76EE\u5F55").setDesc("\u5305\u542B src/pipeline.py \u7684 VideoMemo \u76EE\u5F55").addText(
      (text) => text.setPlaceholder("D:\\AIApp\\video-memo").setValue(this.plugin.settings.projectPath).onChange(async (value) => {
        this.plugin.settings.projectPath = value.trim();
        await this.persist();
        this.display();
      })
    );
    const projectPath = this.plugin.settings.projectPath.trim();
    const pythonPath = projectPath ? this.plugin.resolvePython(projectPath) : "";
    new import_obsidian4.Setting(containerEl).setName("Python \u8DEF\u5F84").setDesc("\u81EA\u52A8\u68C0\u6D4B\u9879\u76EE .venv\uFF0C\u672A\u627E\u5230\u65F6\u4F7F\u7528\u7CFB\u7EDF PATH \u4E2D\u7684 python").addText((text) => {
      text.setPlaceholder("\u586B\u5199\u9879\u76EE\u76EE\u5F55\u540E\u81EA\u52A8\u8BC6\u522B").setValue(pythonPath).inputEl.disabled = true;
    });
    containerEl.createDiv({
      cls: "video-memo-settings-section-label",
      text: "\u8F93\u51FA"
    });
    new import_obsidian4.Setting(containerEl).setName("Vault \u76EE\u6807\u6587\u4EF6\u5939\uFF08\u53EF\u9009\uFF09").setDesc("\u7559\u7A7A\uFF1A\u6309\u89C6\u9891\u5185\u5BB9\u81EA\u52A8\u521B\u5EFA\u4E3B\u9898\u6587\u4EF6\u5939\uFF08\u5982 Git/\uFF09\uFF1B\u586B\u5199\uFF1A\u56FA\u5B9A\u653E\u5230 Vault \u5185\u8BE5\u76F8\u5BF9\u8DEF\u5F84\uFF08\u4E0D\u5141\u8BB8\u7EDD\u5BF9\u8DEF\u5F84\u6216 .. \u7247\u6BB5\uFF09").addText(
      (text) => text.setPlaceholder("\u7559\u7A7A = \u81EA\u52A8\u6309\u4E3B\u9898\u5F52\u7C7B").setValue(this.plugin.settings.targetFolder).onChange(async (value) => {
        this.plugin.settings.targetFolder = sanitizeTargetFolder(value);
        await this.persist();
      })
    );
    new import_obsidian4.Setting(containerEl).setName("\u5B8C\u6210\u540E\u6E05\u7406\u5A92\u4F53").setDesc("\u5220\u9664\u8F93\u51FA\u76EE\u5F55\u4E2D\u7684\u4E0B\u8F7D\u5A92\u4F53\u548C\u97F3\u8F68\uFF0C\u4E0D\u5220\u9664\u672C\u5730\u8F93\u5165\u6587\u4EF6").addToggle(
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
        const badge2 = badgeRow.createDiv({
          cls: "video-memo-provider-badge",
          attr: { "aria-label": "\u5F53\u524D\u4EFB\u52A1\u4F7F\u7528\u7684\u4F9B\u5E94\u5546" }
        });
        const badgeIcon = badge2.createSpan({
          cls: "video-memo-provider-badge-icon"
        });
        (0, import_obsidian5.setIcon)(badgeIcon, "server");
        badge2.createSpan({
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
      const createModeButton = (label, icon2, mode) => {
        const button = modeSwitch.createEl("button", {
          cls: "video-memo-mode-button",
          attr: { type: "button" }
        });
        const iconElement = button.createSpan({
          cls: "video-memo-mode-icon"
        });
        (0, import_obsidian5.setIcon)(iconElement, icon2);
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
