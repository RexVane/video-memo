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
  default: () => VideoSummarizerPlugin
});
module.exports = __toCommonJS(main_exports);
var import_node_child_process = require("node:child_process");
var import_node_fs2 = require("node:fs");
var import_node_readline = require("node:readline");
var import_node_path2 = require("node:path");
var import_obsidian3 = require("obsidian");

// src/ccswitch.ts
var import_node_fs = require("node:fs");
var import_node_os = require("node:os");
var import_node_path = require("node:path");
var import_node_sqlite = require("node:sqlite");
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

// node_modules/smol-toml/dist/primitive.js
var INT_REGEX = /^((0x[0-9a-fA-F](_?[0-9a-fA-F])*)|(([+-]|0[ob])?\d(_?\d)*))$/;
var FLOAT_REGEX = /^[+-]?\d(_?\d)*(\.\d(_?\d)*)?([eE][+-]?\d(_?\d)*)?$/;
var LEADING_ZERO = /^[+-]?0[0-9_]/;
function parseString(str, ptr) {
  let c = str[ptr++];
  let first = c;
  let isLiteral = c === "'";
  let isMultiline = c === str[ptr] && c === str[ptr + 1];
  if (isMultiline) {
    if (str[ptr += 2] === "\n")
      ptr++;
    else if (str[ptr] === "\r" && str[ptr + 1] === "\n")
      ptr += 2;
  }
  let parsed = "";
  let sliceStart = ptr;
  let state = 0;
  for (let i = ptr; i < str.length; i++) {
    c = str[i];
    if (isMultiline && (c === "\n" || c === "\r" && str[i + 1] === "\n")) {
      state = state && 3;
    } else if (c < " " && c !== "	" || c === "\x7F") {
      throw new TomlError("control characters are not allowed in strings", {
        toml: str,
        ptr: i
      });
    } else if ((!state || state === 3) && c === first && (!isMultiline || str[i + 1] === first && str[i + 2] === first)) {
      if (isMultiline) {
        if (str[i + 3] === first)
          i++;
        if (str[i + 3] === first)
          i++;
      }
      return [
        // If we're in a newline escape still, then there's nothing to add.
        // Also try to avoid concat if there's nothing to add to parsed, or nothing has been added to parsed.
        state ? parsed : parsed + str.slice(sliceStart, i),
        i + (isMultiline ? 3 : 1)
      ];
    } else if (!state) {
      if (!isLiteral && c === "\\") {
        parsed += str.slice(sliceStart, sliceStart = i);
        state = 1;
      }
    } else if (state === 1) {
      if (c === "x" || c === "u" || c === "U") {
        let value = 0;
        let len = c === "x" ? 2 : c === "u" ? 4 : 8;
        for (let j = 0; j < len; j++, i++) {
          let hex = str.charCodeAt(i + 1);
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
            throw new TomlError("invalid non-hex character in unicode escape", { toml: str, ptr: i + 1 });
          value = value << 4 | digit;
        }
        if (value < 0 || value > 1114111 || value >= 55296 && value <= 57343) {
          throw new TomlError("invalid unicode escape", { toml: str, ptr: i });
        }
        parsed += String.fromCodePoint(value);
        sliceStart = i + 1;
        state = 0;
      } else if (c === " " || c === "	") {
        state = 2;
      } else {
        if (c === "b")
          parsed += "\b";
        else if (c === "t")
          parsed += "	";
        else if (c === "n")
          parsed += "\n";
        else if (c === "f")
          parsed += "\f";
        else if (c === "r")
          parsed += "\r";
        else if (c === "e")
          parsed += "\x1B";
        else if (c === '"')
          parsed += '"';
        else if (c === "\\")
          parsed += "\\";
        else
          throw new TomlError("unrecognized escape sequence", { toml: str, ptr: i });
        sliceStart = i + 1;
        state = 0;
      }
    } else if (c !== " " && c !== "	") {
      if (state === 2) {
        throw new TomlError("invalid escape: only line-ending whitespace may be escaped", {
          toml: str,
          ptr: sliceStart
        });
      }
      state = !isLiteral && c === "\\" ? 1 : 0;
      sliceStart = i;
    }
  }
  throw new TomlError("unfinished string", { toml: str, ptr });
}
function parseValue(value, toml, ptr, integersAsBigInt) {
  if (value === "true")
    return true;
  if (value === "false")
    return false;
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
      throw new TomlError("leading zeroes are not allowed", {
        toml,
        ptr
      });
    }
    value = value.replace(/_/g, "");
    let numeric = +value;
    if (isNaN(numeric)) {
      throw new TomlError("invalid number", {
        toml,
        ptr
      });
    }
    if (isInt) {
      if ((isInt = !Number.isSafeInteger(numeric)) && !integersAsBigInt) {
        throw new TomlError("integer value cannot be represented losslessly", {
          toml,
          ptr
        });
      }
      if (isInt || integersAsBigInt === true)
        numeric = BigInt(value);
    }
    return numeric;
  }
  const date = new TomlDate(value);
  if (!date.isValid()) {
    throw new TomlError("invalid value", {
      toml,
      ptr
    });
  }
  return date;
}

// node_modules/smol-toml/dist/util.js
function indexOfNewline(str, start = 0, end = str.length) {
  let idx = str.indexOf("\n", start);
  if (str[idx - 1] === "\r")
    idx--;
  return idx <= end ? idx : -1;
}
function skipComment(str, ptr) {
  for (let i = ptr; i < str.length; i++) {
    let c = str[i];
    if (c === "\n")
      return i;
    if (c === "\r" && str[i + 1] === "\n")
      return i + 1;
    if (c < " " && c !== "	" || c === "\x7F") {
      throw new TomlError("control characters are not allowed in comments", {
        toml: str,
        ptr
      });
    }
  }
  return str.length;
}
function skipVoid(str, ptr, banNewLines, banComments) {
  let c;
  while (1) {
    while ((c = str[ptr]) === " " || c === "	" || !banNewLines && (c === "\n" || c === "\r" && str[ptr + 1] === "\n"))
      ptr++;
    if (banComments || c !== "#")
      break;
    ptr = skipComment(str, ptr);
  }
  return ptr;
}
function skipUntil(str, ptr, sep, end, banNewLines = false) {
  if (!end) {
    ptr = indexOfNewline(str, ptr);
    return ptr < 0 ? str.length : ptr;
  }
  for (let i = ptr; i < str.length; i++) {
    let c = str[i];
    if (c === "#") {
      i = indexOfNewline(str, i);
    } else if (c === sep) {
      return i + 1;
    } else if (c === end || banNewLines && (c === "\n" || c === "\r" && str[i + 1] === "\n")) {
      return i;
    }
  }
  throw new TomlError("cannot find end of structure", {
    toml: str,
    ptr
  });
}

// node_modules/smol-toml/dist/extract.js
function sliceAndTrimEndOf(str, startPtr, endPtr) {
  let value = str.slice(startPtr, endPtr);
  let commentIdx = value.indexOf("#");
  if (commentIdx > -1) {
    skipComment(str, commentIdx);
    value = value.slice(0, commentIdx);
  }
  return [value.trimEnd(), commentIdx];
}
function extractValue(str, ptr, end, depth, integersAsBigInt) {
  if (depth === 0) {
    throw new TomlError("document contains excessively nested structures. aborting.", {
      toml: str,
      ptr
    });
  }
  let c = str[ptr];
  if (c === "[" || c === "{") {
    let [value, endPtr2] = c === "[" ? parseArray(str, ptr, depth, integersAsBigInt) : parseInlineTable(str, ptr, depth, integersAsBigInt);
    if (end) {
      endPtr2 = skipVoid(str, endPtr2);
      if (str[endPtr2] === ",")
        endPtr2++;
      else if (str[endPtr2] !== end) {
        throw new TomlError("expected comma or end of structure", {
          toml: str,
          ptr: endPtr2
        });
      }
    }
    return [value, endPtr2];
  }
  if (c === '"' || c === "'") {
    let [parsed, endPtr2] = parseString(str, ptr);
    if (end) {
      endPtr2 = skipVoid(str, endPtr2);
      if (str[endPtr2] && str[endPtr2] !== "," && str[endPtr2] !== end && str[endPtr2] !== "\n" && str[endPtr2] !== "\r") {
        throw new TomlError("unexpected character encountered", {
          toml: str,
          ptr: endPtr2
        });
      }
      if (str[endPtr2] === ",")
        endPtr2++;
    }
    return [parsed, endPtr2];
  }
  let endPtr = skipUntil(str, ptr, ",", end);
  let slice = sliceAndTrimEndOf(str, ptr, endPtr - (str[endPtr - 1] === "," ? 1 : 0));
  if (!slice[0]) {
    throw new TomlError("incomplete key-value declaration: no value specified", {
      toml: str,
      ptr
    });
  }
  if (end && slice[1] > -1) {
    endPtr = skipVoid(str, ptr + slice[1]);
    if (str[endPtr] === ",")
      endPtr++;
  }
  return [
    parseValue(slice[0], str, ptr, integersAsBigInt),
    endPtr
  ];
}

// node_modules/smol-toml/dist/struct.js
var KEY_PART_RE = /^[a-zA-Z0-9-_]+[ \t]*$/;
function parseKey(str, ptr, end = "=") {
  let dot = ptr - 1;
  let parsed = [];
  let endPtr = str.indexOf(end, ptr);
  if (endPtr < 0) {
    throw new TomlError("incomplete key-value: cannot find end of key", {
      toml: str,
      ptr
    });
  }
  do {
    let c = str[ptr = ++dot];
    if (c !== " " && c !== "	") {
      if (c === '"' || c === "'") {
        if (c === str[ptr + 1] && c === str[ptr + 2]) {
          throw new TomlError("multiline strings are not allowed in keys", {
            toml: str,
            ptr
          });
        }
        let [part, eos] = parseString(str, ptr);
        dot = str.indexOf(".", eos);
        let strEnd = str.slice(eos, dot < 0 || dot > endPtr ? endPtr : dot);
        let newLine = indexOfNewline(strEnd);
        if (newLine > -1) {
          throw new TomlError("newlines are not allowed in keys", {
            toml: str,
            ptr: ptr + dot + newLine
          });
        }
        if (strEnd.trimStart()) {
          throw new TomlError("found extra tokens after the string part", {
            toml: str,
            ptr: eos
          });
        }
        if (endPtr < eos) {
          endPtr = str.indexOf(end, eos);
          if (endPtr < 0) {
            throw new TomlError("incomplete key-value: cannot find end of key", {
              toml: str,
              ptr
            });
          }
        }
        parsed.push(part);
      } else {
        dot = str.indexOf(".", ptr);
        let part = str.slice(ptr, dot < 0 || dot > endPtr ? endPtr : dot);
        if (!KEY_PART_RE.test(part)) {
          throw new TomlError("only letter, numbers, dashes and underscores are allowed in keys", {
            toml: str,
            ptr
          });
        }
        parsed.push(part.trimEnd());
      }
    }
  } while (dot + 1 && dot < endPtr);
  return [parsed, skipVoid(str, endPtr + 1, true, true)];
}
function parseInlineTable(str, ptr, depth, integersAsBigInt) {
  let res = {};
  let seen = /* @__PURE__ */ new Set();
  let c;
  ptr++;
  while ((c = str[ptr++]) !== "}" && c) {
    if (c === ",") {
      throw new TomlError("expected value, found comma", {
        toml: str,
        ptr: ptr - 1
      });
    } else if (c === "#")
      ptr = skipComment(str, ptr);
    else if (c !== " " && c !== "	" && c !== "\n" && c !== "\r") {
      let k;
      let t = res;
      let hasOwn = false;
      let [key, keyEndPtr] = parseKey(str, ptr - 1);
      for (let i = 0; i < key.length; i++) {
        if (i)
          t = hasOwn ? t[k] : t[k] = {};
        k = key[i];
        if ((hasOwn = Object.hasOwn(t, k)) && (typeof t[k] !== "object" || seen.has(t[k]))) {
          throw new TomlError("trying to redefine an already defined value", {
            toml: str,
            ptr
          });
        }
        if (!hasOwn && k === "__proto__") {
          Object.defineProperty(t, k, { enumerable: true, configurable: true, writable: true });
        }
      }
      if (hasOwn) {
        throw new TomlError("trying to redefine an already defined value", {
          toml: str,
          ptr
        });
      }
      let [value, valueEndPtr] = extractValue(str, keyEndPtr, "}", depth - 1, integersAsBigInt);
      seen.add(value);
      t[k] = value;
      ptr = valueEndPtr;
    }
  }
  if (!c) {
    throw new TomlError("unfinished table encountered", {
      toml: str,
      ptr
    });
  }
  return [res, ptr];
}
function parseArray(str, ptr, depth, integersAsBigInt) {
  let res = [];
  let c;
  ptr++;
  while ((c = str[ptr++]) !== "]" && c) {
    if (c === ",") {
      throw new TomlError("expected value, found comma", {
        toml: str,
        ptr: ptr - 1
      });
    } else if (c === "#")
      ptr = skipComment(str, ptr);
    else if (c !== " " && c !== "	" && c !== "\n" && c !== "\r") {
      let e = extractValue(str, ptr - 1, "]", depth - 1, integersAsBigInt);
      res.push(e[0]);
      ptr = e[1];
    }
  }
  if (!c) {
    throw new TomlError("unfinished array encountered", {
      toml: str,
      ptr
    });
  }
  return [res, ptr];
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
  let res = {};
  let meta = {};
  let tbl = res;
  let m = meta;
  for (let ptr = skipVoid(toml, 0); ptr < toml.length; ) {
    if (toml[ptr] === "[") {
      let isTableArray = toml[++ptr] === "[";
      let k = parseKey(toml, ptr += +isTableArray, "]");
      if (isTableArray) {
        if (toml[k[1] - 1] !== "]") {
          throw new TomlError("expected end of table declaration", {
            toml,
            ptr: k[1] - 1
          });
        }
        k[1]++;
      }
      let p = peekTable(
        k[0],
        res,
        meta,
        isTableArray ? 2 : 1
        /* Type.EXPLICIT */
      );
      if (!p) {
        throw new TomlError("trying to redefine an already defined table or value", {
          toml,
          ptr
        });
      }
      m = p[2];
      tbl = p[1];
      ptr = k[1];
    } else {
      let k = parseKey(toml, ptr);
      let p = peekTable(
        k[0],
        tbl,
        m,
        0
        /* Type.DOTTED */
      );
      if (!p) {
        throw new TomlError("trying to redefine an already defined table or value", {
          toml,
          ptr
        });
      }
      let v = extractValue(toml, k[1], void 0, maxDepth, integersAsBigInt);
      p[1][p[0]] = v[0];
      ptr = v[1];
    }
    ptr = skipVoid(toml, ptr, true);
    if (toml[ptr] && toml[ptr] !== "\n" && toml[ptr] !== "\r") {
      throw new TomlError("each key-value declaration must be followed by an end-of-line", {
        toml,
        ptr
      });
    }
    ptr = skipVoid(toml, ptr);
  }
  return res;
}

// src/ccswitch.ts
var SECRET_MARKERS = ["token", "key", "secret", "auth", "password"];
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
function keyMatches(key, exact, suffixes) {
  const normalized = normalizeKey(key);
  return exact.some((candidate) => normalized === normalizeKey(candidate)) || suffixes.some((suffix) => normalized.endsWith(normalizeKey(suffix)));
}
function findTextByKeyPatterns(value, exact, suffixes) {
  const record = asRecord(value);
  if (!record) return null;
  for (const [key, candidate] of Object.entries(record)) {
    if (keyMatches(key, exact, suffixes)) {
      const text = textValue(candidate);
      if (text) return text;
    }
  }
  for (const candidate of Object.values(record)) {
    const nested = findTextByKeyPatterns(candidate, exact, suffixes);
    if (nested) return nested;
  }
  return null;
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
      redactedSettingsConfig: settingsConfig,
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
function openDatabase(configuredPath) {
  const path = resolveCcSwitchDbPath(configuredPath);
  if ((0, import_node_path.extname)(path).toLowerCase() !== ".db") {
    throw new Error("cc-switch \u6570\u636E\u5E93\u8DEF\u5F84\u5FC5\u987B\u6307\u5411 .db \u6587\u4EF6");
  }
  if (!(0, import_node_fs.existsSync)(path)) {
    throw new Error(`\u672A\u627E\u5230 cc-switch \u6570\u636E\u5E93: ${path}`);
  }
  return {
    db: new import_node_sqlite.DatabaseSync(path, { readOnly: true, timeout: 15e3 }),
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
function openAiModelsUrl(baseUrl) {
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
async function fetchCcSwitchProviderModels(options) {
  const runtime = resolveCcSwitchProviderRuntime({
    dbPath: options.dbPath,
    appType: options.appType,
    followCurrent: false,
    providerId: options.providerId
  });
  const endpoint = openAiModelsUrl(runtime.baseUrl);
  let timeout;
  try {
    const response = await Promise.race([
      (0, import_obsidian.requestUrl)({
        url: endpoint,
        method: "GET",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${runtime.apiKey}`
        },
        throw: false
      }),
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error("\u6A21\u578B\u63A5\u53E3\u8BF7\u6C42\u8D85\u65F6\uFF0815 \u79D2\uFF09")), 15e3);
      })
    ]);
    if (response.status < 200 || response.status >= 300) {
      const label = response.status === 401 || response.status === 403 ? "\u6A21\u578B\u63A5\u53E3\u9274\u6743\u5931\u8D25" : response.status === 404 ? "\u672A\u627E\u5230\u6A21\u578B\u63A5\u53E3" : "\u6A21\u578B\u63A5\u53E3\u8BF7\u6C42\u5931\u8D25";
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
    throw new Error(message.replaceAll(runtime.apiKey, "***"));
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

// src/ccswitch-settings.ts
var import_obsidian2 = require("obsidian");
function icon(parent, name, className = "") {
  const element = parent.createSpan({ cls: className });
  (0, import_obsidian2.setIcon)(element, name);
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
  configTab = "parsed";
  providerModelStates = /* @__PURE__ */ new Map();
  modelRequestId = 0;
  constructor(options) {
    this.options = options;
  }
  showProviderList() {
    this.selectedProviderId = "";
    this.configTab = "parsed";
  }
  render(parent) {
    const settings = this.options.getSettings();
    const section = parent.createDiv({ cls: "ccswitch-section" });
    let response = null;
    let loadError = "";
    try {
      response = loadCcSwitchProviders(settings.ccSwitchDbPath);
    } catch (error) {
      loadError = error instanceof Error ? error.message : String(error);
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
    if (this.selectedProviderId) this.showProviderList();
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
    headingCopy.createEl("h2", { text: "\u4F9B\u5E94\u5546 (cc-switch)" });
    headingCopy.createEl("p", {
      text: "\u53EA\u8BFB\u89E3\u6790\u672C\u673A cc-switch \u6570\u636E\u5E93\uFF0C\u9009\u62E9\u89C6\u9891\u603B\u7ED3\u4EFB\u52A1\u4F7F\u7528\u7684 API \u4F9B\u5E94\u5546\u3002"
    });
    const sourceSwitch = heading.createDiv({
      cls: "ccswitch-source-switch",
      attr: { "aria-label": "\u4F9B\u5E94\u5546\u914D\u7F6E\u6765\u6E90" }
    });
    this.renderSourceButton(sourceSwitch, "cc-switch", "database", "ccswitch");
    this.renderSourceButton(sourceSwitch, "\u73AF\u5883\u914D\u7F6E", "file-cog", "environment");
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
  renderSourceButton(parent, label, iconName, source) {
    const active = this.options.getSettings().providerSource === source;
    const button = parent.createEl("button", {
      cls: `ccswitch-source-button${active ? " is-active" : ""}`,
      attr: { type: "button", "aria-pressed": String(active) }
    });
    icon(button, iconName);
    button.createSpan({ text: label });
    button.addEventListener("click", () => {
      void this.options.updateSettings({ providerSource: source }).then(() => {
        this.options.rerender();
      });
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
        new import_obsidian2.Notice("\u65E0\u6CD5\u8BFB\u53D6\u6240\u9009\u6570\u636E\u5E93\u7684\u672C\u5730\u8DEF\u5F84");
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
    const row = parent.createEl("button", {
      cls: "ccswitch-provider-row",
      attr: { type: "button", "aria-label": `\u67E5\u770B ${provider.name} \u914D\u7F6E` }
    });
    const tile = row.createDiv({ cls: "ccswitch-provider-icon" });
    icon(tile, provider.usable ? "server" : "server-off");
    const copy = row.createDiv({ cls: "ccswitch-provider-row-copy" });
    copy.createDiv({ cls: "ccswitch-provider-name", text: provider.name });
    copy.createDiv({ cls: "ccswitch-provider-subtitle", text: providerSubtitle(provider) });
    const trailing = row.createDiv({ cls: "ccswitch-provider-trailing" });
    if (this.isProviderActive(provider, settings)) badge(trailing, "\u4F7F\u7528\u4E2D", "accent");
    else if (provider.isCurrent) badge(trailing, "\u5168\u5C40\u5F53\u524D", "neutral");
    icon(trailing, "chevron-right");
    row.addEventListener("click", () => {
      this.selectedProviderId = provider.id;
      this.configTab = "parsed";
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
    (0, import_obsidian2.setIcon)(copyButton, "copy");
    copyButton.addEventListener("click", () => {
      void navigator.clipboard.writeText(content).then(() => new import_obsidian2.Notice("\u914D\u7F6E\u5DF2\u590D\u5236"));
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
    (0, import_obsidian2.setIcon)(refresh, "refresh-cw");
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
      error: ""
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
        error: ""
      });
      this.options.rerender();
    }).catch((error) => {
      if (this.providerModelStates.get(key)?.requestId !== requestId) return;
      this.providerModelStates.set(key, {
        requestId,
        status: "error",
        models: [],
        endpoint: provider.baseUrl ?? "",
        error: error instanceof Error ? error.message : String(error)
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

// src/main.ts
var EVENT_PREFIX = "@@VIDEO_SUMMARIZER@@";
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
var DEFAULT_SETTINGS = {
  projectPath: "",
  pythonPath: "",
  providerSource: "ccswitch",
  ccSwitchDbPath: "",
  ccSwitchAppType: "codex",
  ccSwitchFollowCurrent: true,
  ccSwitchProviderId: "",
  model: "",
  targetFolder: "Video Summaries",
  cleanupMedia: false
};
function normalizeSettings(stored) {
  const stringValue = (value, fallback) => typeof value === "string" ? value : fallback;
  return {
    projectPath: stringValue(stored?.projectPath, DEFAULT_SETTINGS.projectPath),
    pythonPath: stringValue(stored?.pythonPath, DEFAULT_SETTINGS.pythonPath),
    providerSource: stored?.providerSource === "environment" ? "environment" : "ccswitch",
    ccSwitchDbPath: stringValue(stored?.ccSwitchDbPath, DEFAULT_SETTINGS.ccSwitchDbPath),
    ccSwitchAppType: stringValue(stored?.ccSwitchAppType, DEFAULT_SETTINGS.ccSwitchAppType),
    ccSwitchFollowCurrent: typeof stored?.ccSwitchFollowCurrent === "boolean" ? stored.ccSwitchFollowCurrent : DEFAULT_SETTINGS.ccSwitchFollowCurrent,
    ccSwitchProviderId: stringValue(
      stored?.ccSwitchProviderId,
      DEFAULT_SETTINGS.ccSwitchProviderId
    ),
    model: stringValue(stored?.model, DEFAULT_SETTINGS.model),
    targetFolder: stringValue(stored?.targetFolder, DEFAULT_SETTINGS.targetFolder),
    cleanupMedia: typeof stored?.cleanupMedia === "boolean" ? stored.cleanupMedia : DEFAULT_SETTINGS.cleanupMedia
  };
}
var TextPromptModal = class extends import_obsidian3.Modal {
  titleText;
  fieldName;
  placeholder;
  onSubmit;
  onOpenSettings;
  showMediaPicker;
  constructor(app, options) {
    super(app);
    this.titleText = options.title;
    this.fieldName = options.fieldName;
    this.placeholder = options.placeholder;
    this.onSubmit = options.onSubmit;
    this.onOpenSettings = options.onOpenSettings ?? null;
    this.showMediaPicker = options.showMediaPicker ?? false;
  }
  onOpen() {
    this.modalEl.addClass("video-summarizer-shell");
    this.contentEl.addClass("video-summarizer-modal");
    const titleRow = this.contentEl.createDiv({
      cls: "video-summarizer-title-row"
    });
    titleRow.createEl("h2", { text: this.titleText });
    if (this.onOpenSettings) {
      const settingsButton = titleRow.createEl("button", {
        cls: "clickable-icon video-summarizer-settings-button",
        attr: {
          type: "button",
          "aria-label": "\u6253\u5F00 Video Summarizer \u8BBE\u7F6E"
        }
      });
      (0, import_obsidian3.setIcon)(settingsButton, "settings");
      settingsButton.addEventListener("click", () => {
        this.close();
        this.onOpenSettings?.();
      });
    }
    let value = "";
    let linkValue = "";
    let fileValue = "";
    let sourceMode = "link";
    const submit = () => {
      const normalized = (this.showMediaPicker ? sourceMode === "link" ? linkValue : fileValue : value).trim();
      if (!normalized) {
        const missing = this.showMediaPicker ? sourceMode === "link" ? "\u8BF7\u8F93\u5165\u89C6\u9891\u94FE\u63A5" : "\u8BF7\u9009\u62E9\u672C\u5730\u6587\u4EF6" : `${this.fieldName}\u4E0D\u80FD\u4E3A\u7A7A`;
        new import_obsidian3.Notice(missing);
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
        cls: "video-summarizer-mode-switch",
        attr: { "aria-label": "\u8F93\u5165\u7C7B\u578B" }
      });
      const createModeButton = (label, icon2, mode) => {
        const button = modeSwitch.createEl("button", {
          cls: "video-summarizer-mode-button",
          attr: { type: "button" }
        });
        const iconElement = button.createSpan({
          cls: "video-summarizer-mode-icon"
        });
        (0, import_obsidian3.setIcon)(iconElement, icon2);
        button.createSpan({ text: label });
        button.addEventListener("click", () => setSourceMode(mode));
        return button;
      };
      let linkInput = null;
      let fileControl = null;
      let fileInputElement = null;
      const linkSetting = new import_obsidian3.Setting(this.contentEl).setClass("video-summarizer-input-setting").setName("\u89C6\u9891\u94FE\u63A5").addText((text) => {
        linkInput = text.inputEl;
        text.setPlaceholder("https://...").onChange((next) => {
          linkValue = next;
        });
        text.inputEl.addEventListener("keydown", (event) => {
          if (event.key === "Enter") submit();
        });
      });
      const fileSetting = new import_obsidian3.Setting(this.contentEl).setClass("video-summarizer-input-setting").setName("\u672C\u5730\u89C6\u9891\u6216\u5F55\u97F3").addText((text) => {
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
        cls: "video-summarizer-native-file",
        attr: { type: "file", accept: MEDIA_ACCEPT }
      });
      fileInput.addEventListener("change", () => {
        const file = fileInput.files?.[0];
        if (!file) return;
        const electron = require("electron");
        const selectedPath = electron.webUtils?.getPathForFile(file) ?? file.path ?? "";
        if (!selectedPath) {
          new import_obsidian3.Notice("\u65E0\u6CD5\u8BFB\u53D6\u6240\u9009\u6587\u4EF6\u7684\u672C\u5730\u8DEF\u5F84");
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
      new import_obsidian3.Setting(this.contentEl).setClass("video-summarizer-input-setting").setName(this.fieldName).addText((text) => {
        text.setPlaceholder(this.placeholder).onChange((next) => {
          value = next;
        });
        text.inputEl.addEventListener("keydown", (event) => {
          if (event.key === "Enter") submit();
        });
        window.setTimeout(() => text.inputEl.focus(), 0);
      });
    }
    new import_obsidian3.Setting(this.contentEl).setClass("video-summarizer-actions").addButton((button) => button.setButtonText("\u53D6\u6D88").onClick(() => this.close())).addButton(
      (button) => button.setButtonText("\u5F00\u59CB").setCta().onClick(submit)
    );
  }
  onClose() {
    this.contentEl.empty();
  }
};
var VideoSummarizerPlugin = class extends import_obsidian3.Plugin {
  settings = DEFAULT_SETTINGS;
  activeProcess = null;
  statusEl = null;
  generatedNotePath = null;
  stderrTail = "";
  async onload() {
    const stored = await this.loadData();
    this.settings = normalizeSettings(stored);
    if (!stored || JSON.stringify(stored) !== JSON.stringify(this.settings)) {
      await this.saveData(this.settings);
    }
    this.statusEl = this.addStatusBarItem();
    this.statusEl.addClass("video-summarizer-status");
    this.statusEl.setText("Video Summarizer: \u5C31\u7EEA");
    const settingTab = new VideoSummarizerSettingTab(this.app, this);
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
  }
  openSourceModal() {
    new TextPromptModal(this.app, {
      title: "\u603B\u7ED3\u89C6\u9891\u6216\u5F55\u97F3",
      fieldName: "\u94FE\u63A5\u6216\u672C\u5730\u6587\u4EF6\u8DEF\u5F84",
      placeholder: "https://... \u6216 D:\\Media\\course.mp4",
      showMediaPicker: true,
      onOpenSettings: () => this.openPluginSettings(),
      onSubmit: (value) => this.startEngine([value])
    }).open();
  }
  openRegenerateModal() {
    new TextPromptModal(this.app, {
      title: "\u91CD\u65B0\u751F\u6210\u62A5\u544A",
      fieldName: "\u8FD0\u884C\u76EE\u5F55",
      placeholder: "D:\\video-summarizer\\output\\20260717_...",
      onOpenSettings: () => this.openPluginSettings(),
      onSubmit: (value) => this.startEngine(["--regenerate", value])
    }).open();
  }
  vaultPath() {
    const adapter = this.app.vault.adapter;
    if (!(adapter instanceof import_obsidian3.FileSystemAdapter)) {
      new import_obsidian3.Notice("Video Summarizer \u4EC5\u652F\u6301\u684C\u9762\u6587\u4EF6\u7CFB\u7EDF Vault");
      return null;
    }
    return adapter.getBasePath();
  }
  resolvePython(projectPath) {
    if (this.settings.pythonPath.trim()) return this.settings.pythonPath.trim();
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
  startEngine(sourceArgs) {
    if (this.activeProcess) {
      new import_obsidian3.Notice("\u5DF2\u6709\u603B\u7ED3\u4EFB\u52A1\u6B63\u5728\u8FD0\u884C");
      return;
    }
    const projectPath = this.settings.projectPath.trim();
    const pipelinePath = (0, import_node_path2.join)(projectPath, "src", "pipeline.py");
    if (!projectPath || !(0, import_node_fs2.existsSync)(pipelinePath)) {
      new import_obsidian3.Notice("\u8BF7\u5148\u5728\u63D2\u4EF6\u8BBE\u7F6E\u4E2D\u914D\u7F6E Video Summarizer \u9879\u76EE\u76EE\u5F55");
      return;
    }
    const vaultPath = this.vaultPath();
    if (!vaultPath) return;
    const engineEnv = { ...process.env, PYTHONUTF8: "1" };
    let selectedModel = this.settings.model.trim();
    let providerBaseUrl = "";
    if (this.settings.providerSource === "ccswitch") {
      try {
        const runtime = resolveCcSwitchProviderRuntime({
          dbPath: this.settings.ccSwitchDbPath,
          appType: this.settings.ccSwitchAppType,
          followCurrent: this.settings.ccSwitchFollowCurrent,
          providerId: this.settings.ccSwitchProviderId
        });
        providerBaseUrl = runtime.baseUrl;
        selectedModel = selectedModel || runtime.model || "";
        engineEnv.LLM_API_KEY = runtime.apiKey;
        engineEnv.LLM_BASE_URL = runtime.baseUrl;
        if (runtime.apiFormat) engineEnv.LLM_API_FORMAT = runtime.apiFormat;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        new import_obsidian3.Notice(`\u65E0\u6CD5\u4F7F\u7528 cc-switch \u4F9B\u5E94\u5546
${message}`, 8e3);
        this.openPluginSettings();
        return;
      }
    }
    const args = [
      pipelinePath,
      ...sourceArgs,
      "--obsidian-vault",
      vaultPath,
      "--obsidian-folder",
      this.settings.targetFolder.trim() || DEFAULT_SETTINGS.targetFolder,
      "--json-progress"
    ];
    if (selectedModel) args.push("--llm-model", selectedModel);
    if (providerBaseUrl) args.push("--api-base-url", providerBaseUrl);
    if (this.settings.cleanupMedia && sourceArgs[0] !== "--regenerate") {
      args.push("--cleanup-media");
    }
    this.generatedNotePath = null;
    this.stderrTail = "";
    this.statusEl?.setText("Video Summarizer: \u542F\u52A8\u4E2D");
    const child = (0, import_node_child_process.spawn)(this.resolvePython(projectPath), args, {
      cwd: projectPath,
      env: engineEnv,
      shell: false,
      windowsHide: true
    });
    this.activeProcess = child;
    (0, import_node_readline.createInterface)({ input: child.stdout }).on("line", (line) => {
      this.handleOutputLine(line, vaultPath);
    });
    child.stderr.on("data", (chunk) => {
      this.stderrTail = (this.stderrTail + chunk.toString("utf8")).slice(-4e3);
    });
    child.on("error", (error) => {
      this.finishTask(false, `\u65E0\u6CD5\u542F\u52A8 Python: ${error.message}`);
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
      if (event.type === "progress") {
        const percent = Math.round((event.progress ?? 0) * 100);
        const message = (event.message ?? "\u5904\u7406\u4E2D").trim().split("\n").at(-1);
        this.statusEl?.setText(`Video Summarizer: ${percent}% ${message ?? ""}`);
      } else if (event.type === "artifact" && event.kind === "obsidian_note") {
        if (event.path && (0, import_node_path2.isAbsolute)(event.path)) {
          this.generatedNotePath = (0, import_obsidian3.normalizePath)((0, import_node_path2.relative)(vaultPath, event.path));
        }
      }
    } catch {
    }
  }
  finishTask(success, errorMessage) {
    this.activeProcess = null;
    if (!success) {
      this.statusEl?.setText("Video Summarizer: \u5931\u8D25");
      new import_obsidian3.Notice(`\u89C6\u9891\u603B\u7ED3\u5931\u8D25
${errorMessage ?? "\u672A\u77E5\u9519\u8BEF"}`, 1e4);
      return;
    }
    this.statusEl?.setText("Video Summarizer: \u5B8C\u6210");
    new import_obsidian3.Notice("\u89C6\u9891\u603B\u7ED3\u5DF2\u751F\u6210");
    if (!this.generatedNotePath) return;
    const note = this.app.vault.getAbstractFileByPath(this.generatedNotePath);
    if (note instanceof import_obsidian3.TFile) {
      void this.app.workspace.getLeaf(false).openFile(note);
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
    } else {
      child.kill("SIGTERM");
    }
    this.statusEl?.setText("Video Summarizer: \u5DF2\u53D6\u6D88");
    if (showNotice) new import_obsidian3.Notice("\u5DF2\u53D6\u6D88\u89C6\u9891\u603B\u7ED3\u4EFB\u52A1");
  }
};
var VideoSummarizerSettingTab = class extends import_obsidian3.PluginSettingTab {
  plugin;
  providerView;
  page = "settings";
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
    this.providerView = new CcSwitchProviderSettingsView({
      app,
      getSettings: () => this.plugin.settings,
      updateSettings: async (patch) => {
        Object.assign(this.plugin.settings, patch);
        await this.plugin.saveData(this.plugin.settings);
      },
      rerender: () => this.display(),
      onBack: () => {
        this.page = "settings";
        this.display();
      }
    });
  }
  display() {
    const { containerEl } = this;
    containerEl.addClass("video-summarizer-settings-tab");
    containerEl.empty();
    containerEl.createEl("h2", { text: "Video Summarizer" });
    if (this.page === "providers") {
      this.providerView.render(containerEl);
      return;
    }
    const openProviders = () => {
      this.page = "providers";
      this.providerView.showProviderList();
      this.display();
    };
    const providerSetting = new import_obsidian3.Setting(containerEl).setName("\u4F9B\u5E94\u5546").setDesc(this.providerDescription()).addExtraButton(
      (button) => button.setIcon("chevron-right").setTooltip("\u6253\u5F00\u4F9B\u5E94\u5546\u8BBE\u7F6E").onClick(openProviders)
    );
    providerSetting.settingEl.addClass("video-summarizer-navigation-setting");
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
    new import_obsidian3.Setting(containerEl).setName("\u9879\u76EE\u76EE\u5F55").setDesc("\u5305\u542B src/pipeline.py \u7684 Video Summarizer \u76EE\u5F55").addText(
      (text) => text.setPlaceholder("D:\\AIApp\\video-summarizer").setValue(this.plugin.settings.projectPath).onChange(async (value) => {
        this.plugin.settings.projectPath = value.trim();
        await this.plugin.saveData(this.plugin.settings);
      })
    );
    new import_obsidian3.Setting(containerEl).setName("Python \u8DEF\u5F84").setDesc("\u7559\u7A7A\u65F6\u4F18\u5148\u4F7F\u7528\u9879\u76EE .venv\uFF0C\u968F\u540E\u4F7F\u7528 PATH \u4E2D\u7684 python").addText(
      (text) => text.setValue(this.plugin.settings.pythonPath).onChange(async (value) => {
        this.plugin.settings.pythonPath = value.trim();
        await this.plugin.saveData(this.plugin.settings);
      })
    );
    new import_obsidian3.Setting(containerEl).setName("Vault \u76EE\u6807\u6587\u4EF6\u5939").addText(
      (text) => text.setValue(this.plugin.settings.targetFolder).onChange(async (value) => {
        this.plugin.settings.targetFolder = value.trim();
        await this.plugin.saveData(this.plugin.settings);
      })
    );
    new import_obsidian3.Setting(containerEl).setName("\u5B8C\u6210\u540E\u6E05\u7406\u5A92\u4F53").setDesc("\u5220\u9664\u8F93\u51FA\u76EE\u5F55\u4E2D\u7684\u4E0B\u8F7D\u5A92\u4F53\u548C\u97F3\u8F68\uFF0C\u4E0D\u5220\u9664\u672C\u5730\u8F93\u5165\u6587\u4EF6").addToggle(
      (toggle) => toggle.setValue(this.plugin.settings.cleanupMedia).onChange(async (value) => {
        this.plugin.settings.cleanupMedia = value;
        await this.plugin.saveData(this.plugin.settings);
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
  providerDescription() {
    const settings = this.plugin.settings;
    if (settings.providerSource === "environment") return "\u4F7F\u7528\u9879\u76EE\u73AF\u5883\u53D8\u91CF\u914D\u7F6E";
    try {
      const providers = loadCcSwitchProviders(settings.ccSwitchDbPath).providers;
      const provider = settings.ccSwitchFollowCurrent ? providers.find(
        (item) => item.appType === settings.ccSwitchAppType && item.isCurrent
      ) : providers.find(
        (item) => item.appType === settings.ccSwitchAppType && item.id === settings.ccSwitchProviderId
      );
      const mode = settings.ccSwitchFollowCurrent ? "\u8DDF\u968F\u5168\u5C40\u5F53\u524D" : "\u5DF2\u56FA\u5B9A";
      return provider ? `cc-switch \xB7 ${provider.name} \xB7 ${mode}` : `cc-switch \xB7 ${settings.ccSwitchAppType} \xB7 \u914D\u7F6E\u9700\u8981\u68C0\u67E5`;
    } catch {
      return "cc-switch \xB7 \u65E0\u6CD5\u8BFB\u53D6\u6570\u636E\u5E93";
    }
  }
  hide() {
    this.showHome();
  }
};
/*! Bundled license information:

smol-toml/dist/date.js:
smol-toml/dist/error.js:
smol-toml/dist/primitive.js:
smol-toml/dist/util.js:
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
