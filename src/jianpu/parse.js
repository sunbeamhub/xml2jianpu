import { XMLParser } from "fast-xml-parser";

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
});

/** xmlString → 已 parse 的 JSON；normalizeScore 结果挂 WeakMap */
let parseCache = { xmlString: null, parsed: null };
const normalizedCache = new WeakMap();

export function getParseCache() {
  return parseCache;
}

function isLink(str) {
  if (typeof str !== "string" || !str) return false;
  const s = str.trim();
  // XML 字符串以 < 或 <?xml 开头；其余视为可 fetch 的 URL（含 webpack 相对路径）
  if (s.startsWith("<") || s.startsWith("<?")) return false;
  try {
    new URL(s);
    return true;
  } catch {
    return (
      s.startsWith("/") ||
      s.startsWith("./") ||
      s.startsWith("../") ||
      /^[a-z][a-z0-9+.-]*:/i.test(s)
    );
  }
}

export function asArray(value) {
  if (value == null || value === "") return [];
  return Array.isArray(value) ? value : [value];
}

export function textOf(node) {
  if (node == null) return "";
  if (typeof node === "string" || typeof node === "number") return String(node).trim();
  if (typeof node === "object" && node["#text"] != null) return String(node["#text"]).trim();
  return "";
}

export function isPlaceholder(text) {
  return !text || /^(title|composer|lyricist|composer\.?|unknown)$/i.test(text);
}

function mergeAttributes(prev, next) {
  const src = Array.isArray(next) ? next[0] : next;
  if (!src) return prev;
  return {
    ...(prev || {}),
    ...src,
    key: src.key != null ? src.key : prev?.key,
    time: src.time != null ? src.time : prev?.time,
    divisions: src.divisions != null ? src.divisions : prev?.divisions,
    clef: src.clef != null ? src.clef : prev?.clef,
    staves: src.staves != null ? src.staves : prev?.staves,
  };
}

export function normalizeScore(musicJson) {
  const hit = musicJson && normalizedCache.get(musicJson);
  if (hit) return hit;

  const score = musicJson?.["score-partwise"];
  if (!score) {
    throw new Error("不是 score-partwise 格式的 MusicXML，或文件不完整");
  }
  const part = asArray(score.part)[0];
  if (!part) {
    throw new Error("MusicXML 中没有 part");
  }
  const measures = asArray(part.measure);
  if (!measures.length) {
    throw new Error("MusicXML 中没有小节");
  }

  let lastAttr = null;
  for (const measure of measures) {
    if (measure.attributes) {
      lastAttr = mergeAttributes(lastAttr, measure.attributes);
      measure.attributes = lastAttr;
    } else if (lastAttr) {
      measure.attributes = lastAttr;
    }
    measure.note = asArray(measure.note);
  }

  const result = {
    score,
    measures,
    partAttr: measures[0].attributes,
  };
  if (musicJson && typeof musicJson === "object") {
    normalizedCache.set(musicJson, result);
  }
  return result;
}

export async function loadParsed(url) {
  let xmlString;
  if (isLink(url)) {
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`无法加载 MusicXML (${res.status})`);
    }
    xmlString = await res.text();
  } else {
    xmlString = url;
  }

  if (!xmlString || !String(xmlString).trim()) {
    throw new Error("MusicXML 内容为空");
  }

  if (parseCache.parsed && parseCache.xmlString === xmlString) {
    return parseCache;
  }

  const parsed = xmlParser.parse(xmlString);
  if (!parsed?.["score-partwise"]) {
    throw new Error("不是 score-partwise 格式的 MusicXML，或文件不完整");
  }
  parseCache = { xmlString, parsed };
  return parseCache;
}
