import { select } from "d3-selection";
import { loadParsed } from "./parse.js";
import { clearPitchPaintForSvg, packRenderResult, tryUpdatePitch } from "./pitch.js";
import { jianpu, showParseError } from "./render.js";

const d3 = { select };

export { applyFirstColumnHeaderH } from "./render.js";

/**
 * 可被 Vue 组件调用的初始化函数。
 * @param {SVGSVGElement} svgElement - 宿主 <svg> 节点
 * @param {string} [url] - musicxml 资源 URL 或 XML 字符串
 * @param {{ width?: number, hideTitle?: boolean, hideMeta?: boolean, columns?: number, autoColumns?: boolean, viewportWidth?: number, viewportHeight?: number, maxColumnWidth?: number, contentPadX?: number, lineBreak?: 'auto' | 'musicxml' | number, firstColumnHeaderH?: number, fontSize?: number, forceLight?: boolean, readableLineUnits?: boolean, fixedDo?: boolean, transposeSemitones?: number, preferPitchUpdate?: boolean }} [options]
 * @returns {Promise<{ xmlString: string, title: string, meta?: object, layout?: object, pitchUpdated?: boolean } | null>}
 */
export default async function initApp(svgElement, url, options = {}) {
  if (options.preferPitchUpdate) {
    const fast = tryUpdatePitch(svgElement, options);
    if (fast) return fast;
  }

  d3.select(svgElement).selectAll("*").remove();
  clearPitchPaintForSvg(svgElement);

  try {
    const { xmlString, parsed } = await loadParsed(url);
    const rendered = jianpu(parsed, svgElement, options);
    return packRenderResult(xmlString, rendered);
  } catch (err) {
    console.error("[initApp] 加载或解析 MusicXML 失败：", err);
    showParseError(svgElement, err);
    return null;
  }
}
