/* eslint-disable no-unused-vars */
import * as d3 from "d3";
import { XMLParser } from "fast-xml-parser";

const MEASURES_PER_LINE = 4;

function isLink(str) {
  try {
    new URL(str);
    return true;
  } catch {
    return false;
  }
}

function asArray(value) {
  if (value == null || value === "") return [];
  return Array.isArray(value) ? value : [value];
}

function textOf(node) {
  if (node == null) return "";
  if (typeof node === "string" || typeof node === "number") return String(node).trim();
  if (typeof node === "object" && node["#text"] != null) return String(node["#text"]).trim();
  return "";
}

function isPlaceholder(text) {
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
  };
}

function normalizeScore(musicJson) {
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

  const hasPrint = measures.some((m) => m.print);
  if (!hasPrint) {
    for (let i = 0; i < measures.length; i++) {
      if (i % MEASURES_PER_LINE === 0) {
        measures[i]._lineBreak = true;
      }
    }
  }

  return {
    score,
    measures,
    partAttr: measures[0].attributes,
  };
}

function isLineBreak(measure) {
  return !!(measure?.print || measure?._lineBreak);
}

function keyNameFromFifths(fifths) {
  const map = {
    0: "C",
    1: "G",
    2: "D",
    3: "A",
    4: "E",
    5: "B",
    6: "#F",
    7: "#C",
    "-1": "F",
    "-2": "bB",
    "-3": "bE",
    "-4": "bA",
    "-5": "bD",
    "-6": "bG",
    "-7": "bC",
  };
  return map[String(fifths)] || "C";
}

function findTempo(measures) {
  for (const measure of measures) {
    for (const direction of asArray(measure.direction)) {
      const sound = direction.sound;
      if (sound != null) {
        const tempo = sound["@_tempo"] ?? sound.tempo;
        if (tempo != null && tempo !== "") return String(tempo);
      }
      const metro = direction["direction-type"]?.metronome;
      const perMinute = metro?.["per-minute"];
      if (perMinute != null && perMinute !== "") return String(perMinute);
    }
  }
  return null;
}

function extractMeta(score, partAttr, measures) {
  const credits = asArray(score.credit);
  const creditWords = [];
  for (const credit of credits) {
    for (const words of asArray(credit["credit-words"])) {
      const line = textOf(words);
      if (line) creditWords.push(line);
    }
  }

  let title = "";
  const titleCredit = credits.find((c) => c["credit-type"] === "title");
  if (titleCredit) {
    title = textOf(asArray(titleCredit["credit-words"])[0]);
  }
  if (isPlaceholder(title)) {
    title = textOf(score.work?.["work-title"]);
  }
  if (isPlaceholder(title)) {
    title = creditWords[0] || "未命名";
  }

  const creators = asArray(score.identification?.creator);
  let lyricist = "";
  let composer = "";
  for (const creator of creators) {
    const value = textOf(creator);
    if (isPlaceholder(value)) continue;
    if (creator["@_type"] === "lyricist") lyricist = value;
    if (creator["@_type"] === "composer") composer = value;
  }

  const creditAuthors = creditWords.filter((line) =>
    /作词|作曲|作编曲|歌：|演唱/.test(line)
  );

  const fifths = partAttr?.key?.fifths ?? 0;
  const keyName = keyNameFromFifths(fifths);
  const beats = partAttr?.time?.beats ?? 4;
  const beatType = partAttr?.time?.["beat-type"] ?? 4;
  const tempo = findTempo(measures);

  return {
    title: title.replace(/\s+/g, ""),
    lyricist,
    composer,
    creditAuthors,
    keyName,
    timeSig: `${beats}/${beatType}`,
    tempo,
  };
}

function showParseError(svgElement, err) {
  const message = err?.message || "文件可能不完整或格式无效";
  d3.select(svgElement)
    .attr("width", 640)
    .attr("height", 80)
    .append("text")
    .attr("x", 16)
    .attr("y", 36)
    .attr("fill", "#b00020")
    .attr("font-size", 16)
    .text(`MusicXML 解析失败：${message}`);
}

/**
 * 可被 Vue 组件调用的初始化函数。
 * @param {SVGSVGElement} svgElement - 宿主 <svg> 节点
 * @param {string} [url] - musicxml 资源 URL 或 XML 字符串
 */
export default async function initApp(svgElement, url) {
  d3.select(svgElement).selectAll("*").remove();

  try {
    let xmlString;
    if (isLink(url)) {
      const xmlDoc = await d3.xml(url);
      xmlString = new XMLSerializer().serializeToString(xmlDoc);
    } else {
      xmlString = url;
    }

    if (!xmlString || !String(xmlString).trim()) {
      throw new Error("MusicXML 内容为空");
    }

    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: "@_",
    });
    const parsed = parser.parse(xmlString);
    if (!parsed?.["score-partwise"]) {
      throw new Error("不是 score-partwise 格式的 MusicXML，或文件不完整");
    }

    jianpu(parsed, svgElement);
  } catch (err) {
    console.error("[initApp] 加载或解析 MusicXML 失败：", err);
    showParseError(svgElement, err);
  }
}

function jianpu(musicJson, svgElement) {
  const { score, measures, partAttr } = normalizeScore(musicJson);
  if (!partAttr) {
    throw new Error("缺少 attributes（调号/拍号/divisions）");
  }

  const meta = extractMeta(score, partAttr, measures);
  const width =
    window.innerWidth ||
    document.documentElement.clientWidth ||
    document.body.clientWidth;
  const height =
    window.innerHeight ||
    document.documentElement.clientHeight ||
    document.body.clientHeight;
  const svg = d3.select(svgElement || "svg");
  const g = svg.attr("width", width).attr("height", height).append("g");

  //绘制小节音符
  var start = 0; //该小节前的小节的位置
  var length = 0; //该小节的长度
  var lineIndex = 0; //该小节所在行
  var eachHeight = 70; //每个小节的高度
  var marginLeft = 100; //左边距
  var marginTop = 100; //上边距
  var tiePath = [-1, -1, -1, -1]; //连音始末位置
  var eighthPath = 0; //八分音符下划线的始末位置
  var sixteenthPath = 0; //16分音符下划线的始末位置
  var titleTop = 30;
  var initSpacing = 18;
  var noteSpacing = 20;
  const divisions = Number(partAttr.divisions) || 1;

  var noteCount = [];
  var eachNoteCount = 0;
  for (let j = 0; j < measures.length; j++) {
    if (isLineBreak(measures[j])) {
      noteCount.push(eachNoteCount);
      eachNoteCount = 0;
    }

    for (const d of measures[j].note) {
      eachNoteCount++;
      const dur = Number(d.duration) || 0;
      if (dur > divisions) {
        eachNoteCount += Math.floor(dur / divisions) - 1;
      }
    }
    eachNoteCount++;
  }
  noteCount.push(eachNoteCount);
  var maxLength = d3.max(noteCount.filter((n) => n > 0)) || d3.max(noteCount) || 1;
  var totalWidth = maxLength * initSpacing;
  marginLeft = (width - totalWidth) / 2;
  svg.attr("height", marginTop + noteCount.length * eachHeight);

  g.append("text")
    .attr(
      "transform",
      `translate(${marginLeft + totalWidth / 2},${titleTop + 30})`
    )
    .attr("font-weight", "bold")
    .attr("text-anchor", "middle")
    .attr("font-size", 30)
    .text(meta.title);

  var textD = g
    .append("text")
    .attr("transform", `translate(${marginLeft},${titleTop + 60})`)
    .attr("font-size", 18);
  textD.append("tspan").text("1=");
  if (meta.keyName.startsWith("b") || meta.keyName.startsWith("#")) {
    textD
      .append("tspan")
      .attr("baseline-shift", "super")
      .attr("font-size", 15)
      .text(meta.keyName[0]);
    textD.append("tspan").text(meta.keyName.slice(1));
  } else {
    textD.append("tspan").text(meta.keyName);
  }
  textD.append("tspan").attr("dx", 20).text(meta.timeSig);

  if (meta.tempo) {
    g.append("text")
      .attr("transform", `translate(${marginLeft},${titleTop + 90})`)
      .attr("font-size", 18)
      .text(`BPM = ${meta.tempo}`);
  }

  const authorLines =
    meta.creditAuthors.length > 0
      ? meta.creditAuthors
      : [
          meta.lyricist
            ? meta.lyricist.includes("作词")
              ? meta.lyricist
              : `作词：${meta.lyricist}`
            : "",
          meta.composer
            ? meta.composer.includes("作曲")
              ? meta.composer
              : `作曲：${meta.composer}`
            : "",
        ].filter(Boolean);

  authorLines.forEach((line, idx) => {
    g.append("text")
      .attr(
        "transform",
        `translate(${marginLeft + maxLength * initSpacing - 150},${
          titleTop + 60 + idx * 20
        })`
      )
      .attr("font-size", 15)
      .text(line);
  });

  for (var j = 0; j < measures.length; j++) {
    var dx = 0; //有全音符时位置偏移
    var reset = 0; //有全音符时位置修正
    if (isLineBreak(measures[j])) {
      start = 0;
      lineIndex++;
      noteSpacing = initSpacing * maxLength / noteCount[lineIndex];
    } else start = start + length * noteSpacing + noteSpacing;
    //console.log(j);
    //console.log(measures[j].note.length);
    length = measures[j].note.length;
    //选择各小节音符
    g.selectAll(".note")
    .data(measures[j].note)
    .enter()
    .each(function(d,i,n){
      //console.log(n[0].__data__);
      var number = note2number(d);
      var dy = 0;//绘制下划线和点时的位置偏移
      var ddy = 0//绘制上方点和线时位置偏移
      //console.log(number);
      //绘制音符
      var noteNumberIs = d3.select(this)
      .append("text")
      .attr("text-anchor","middle")
      .attr("transform",`translate(${marginLeft+start+(i+dx)*noteSpacing},${marginTop+lineIndex*eachHeight})`);
      if(number.text.length == 1)
        noteNumberIs.text(number.text);
      else
      {
        noteNumberIs.append("tspan")
        .attr("baseline-shift","super")
        .attr("dy",()=>{
          if(number.text[0] == "#")
            return 8;
          else
            return 4;
        })
        .attr("font-size",12)
        .attr("dx",-5)
        .text(number.text[0]);
        noteNumberIs.append("tspan")
        .attr("dy",()=>{
          if(number.text[0] == "#")
            return -8;
          else
            return -4;
        })
        .text(number.text[1]);
      }
      //绘制附点
      if(d.dot!=undefined && number.dur<2*divisions)
      {
        d3.select(this)
      .append("text")
      .attr("text-anchor","left")
      .attr("font-weight","bold")
      .attr("transform",`translate(${marginLeft+start+(i+dx)*noteSpacing+5},${marginTop+lineIndex*eachHeight})`)
      .text("·");
      }
      //绘制歌词
      if(d.lyric != undefined)
      {
        const lyrics = asArray(d.lyric);
        let text = lyrics.map((item) => textOf(item.text) || textOf(item)).join("");
        d3.select(this)
        .append("text")
        .attr("text-anchor","middle")
        .attr("font-family","SimSun")
        .attr("font-weight","600")
        .attr("transform",`translate(${marginLeft+start+(i+dx)*noteSpacing},${marginTop+lineIndex*eachHeight+35})`)
        .text(text);
      }
      //绘制下划线
      let durList = d3.map(n,d=>note2number(d.__data__).dur);
      let octList = d3.map(n,d=>note2number(d.__data__).octave);
      if(number.dur == divisions /2)
      {
        console.log(d);
        
        d3.select(this)
        .append("line")
        .attr("transform",`translate(${marginLeft+start+(i+dx)*noteSpacing},${marginTop+lineIndex*eachHeight})`)
        .attr("x1",-5)
        .attr("y1",5)
        .attr("x2",5)
        .attr("y2",5)
        .attr("stroke","black")
        .attr("stroke-width","1px");

        if(d.beam != undefined)
        {
          if(d.beam == "begin")
            eighthPath = -noteSpacing;
          else if(d.beam == "continue")
            eighthPath -= noteSpacing;
          else if(d.beam == "end")
          {
            d3.select(this)
            .append("line")
            .attr("transform",`translate(${marginLeft+start+(i+dx)*noteSpacing},${marginTop+lineIndex*eachHeight})`)
            .attr("x1",0)
            .attr("y1",5)
            .attr("x2",eighthPath)
            .attr("y2",5)
            .attr("stroke","black")
            .attr("stroke-width","1px");
            eighthPath = 0;
          }
        }
        else
        {
          durList.push(0);
          //console.log(durList);
          if((i == 0 && durList[i] == durList[i+1])||(i != 0 && durList[i] != durList[i-1] && durList[i+1] == durList[i]))
          {
            d3.select(this)
          .append("line")
          .attr("transform",`translate(${marginLeft+start+(i+dx)*noteSpacing},${marginTop+lineIndex*eachHeight})`)
          .attr("x1",0)
          .attr("y1",5)
          .attr("x2",noteSpacing)
          .attr("y2",5)
          .attr("stroke","black")
          .attr("stroke-width","1px");
          }
        }

        dy = 5;
      }
      else if(number.dur == divisions / 4)
      {
        d3.select(this)
        .append("line")
        .attr("transform",`translate(${marginLeft+start+(i+dx)*noteSpacing},${marginTop+lineIndex*eachHeight})`)
        .attr("x1",-5)
        .attr("y1",5)
        .attr("x2",5)
        .attr("y2",5)
        .attr("stroke","black")
        .attr("stroke-width","1px")
        d3.select(this)
        .append("line")
        .attr("transform",`translate(${marginLeft+start+(i+dx)*noteSpacing},${marginTop+lineIndex*eachHeight})`)
        .attr("x1",-5)
        .attr("y1",8)
        .attr("x2",5)
        .attr("y2",8)
        .attr("stroke","black")
        .attr("stroke-width","1px");
        if(d.beam != undefined)
        {
          if(d.beam[0] == "begin")
            eighthPath = -noteSpacing*number.text.length;
          else if(d.beam[0] == "continue")
            eighthPath -= noteSpacing*number.text.length;
          else if(d.beam[0] == "end")
          {
            d3.select(this)
            .append("line")
            .attr("transform",`translate(${marginLeft+start+(i+dx)*noteSpacing},${marginTop+lineIndex*eachHeight})`)
            .attr("x1",0)
            .attr("y1",5)
            .attr("x2",eighthPath)
            .attr("y2",5)
            .attr("stroke","black")
            .attr("stroke-width","1px");
            eighthPath = 0;
          }
          if(d.beam[1] == "begin")
            sixteenthPath = -noteSpacing;
          else if(d.beam[1] == "continue")
            sixteenthPath -= noteSpacing;
          else if(d.beam[1] == "end")
          {
            d3.select(this)
            .append("line")
            .attr("transform",`translate(${marginLeft+start+(i+dx)*noteSpacing},${marginTop+lineIndex*eachHeight})`)
            .attr("x1",0)
            .attr("y1",8)
            .attr("x2",eighthPath)
            .attr("y2",8)
            .attr("stroke","black")
            .attr("stroke-width","1px");
            sixteenthPath = 0;
          }
        }
        else{
        if((i == 0 && durList[i] == durList[i+1])||(i != 0 && durList[i] != durList[i-1] && durList[i+1] == durList[i]))
        {
          d3.select(this)
        .append("line")
        .attr("transform",`translate(${marginLeft+start+(i+dx)*noteSpacing},${marginTop+lineIndex*eachHeight})`)
        .attr("x1",0)
        .attr("y1",5)
        .attr("x2",noteSpacing)
        .attr("y2",5)
        .attr("stroke","black")
        .attr("stroke-width","1px");
        d3.select(this)
        .append("line")
        .attr("transform",`translate(${marginLeft+start+(i+dx)*noteSpacing},${marginTop+lineIndex*eachHeight})`)
        .attr("x1",0)
        .attr("y1",8)
        .attr("x2",noteSpacing)
        .attr("y2",8)
        .attr("stroke","black")
        .attr("stroke-width","1px");
        }}
        dy = 8;
      }
      else if(number.dur > divisions)
      {
        let addNote = Math.floor(number.dur/divisions);
        for(let k = 1; k < addNote; k++)
        {
          d3.select(this)
          .append("text")
          .attr("transform",`translate(${marginLeft+start+(i+dx+k)*noteSpacing},${marginTop+lineIndex*eachHeight})`)
          .attr("font-weight",()=>{
            if(number.text == "0")
            return "normal";
            else
            return "bold";
          })
          .attr("text-anchor","middle")
          .text(()=>{
            if(number.text == "0")
            return "0";
            else
            return "-";
          });
          length++;
        }
        dx+=addNote-1;
      }

      if(number.dur > divisions) reset=i;
      else reset = i+dx;
      //绘制点
      if(number.octave == 3)
      {
        d3.select(this)
        .append("circle")
        .attr("transform",`translate(${marginLeft+start+reset*noteSpacing},${marginTop+lineIndex*eachHeight})`)
        .attr("cx",0)
        .attr("cy",5+dy)
        .attr("r",1.5)
        .attr("fill","black");
        dy+=5;
      }
      else if(number.octave == 5)
      {
        d3.select(this)
        .append("circle")
        .attr("transform",`translate(${marginLeft+start+reset*noteSpacing},${marginTop+lineIndex*eachHeight})`)
        .attr("cx",0)
        .attr("cy",-18)
        .attr("r",1.5)
        .attr("fill","black");
        ddy+=5;
      }
      //绘制连音的曲线
      if(number.tied)
      {
        
        if(tiePath[0]==-1)
        {
          tiePath[0] = marginLeft+start+reset*noteSpacing;
          tiePath[1] = marginTop+lineIndex*eachHeight-(ddy+17);
        }
        else if(tiePath[2]==-1)
        {
          tiePath[2] = marginLeft+start+reset*noteSpacing;
          tiePath[3] = marginTop+lineIndex*eachHeight-(ddy+17);
          //如果两个音符在一行，绘制一条曲线；如果在两行，绘制两条曲线。
          if(Math.abs(tiePath[3] - tiePath[1]) < 20)
          {
            d3.select(this)
            .append("path")
            .attr("fill","none")
            .attr("stroke","black")
            .attr("stroke-width",1)
            .attr("d",pathTied(tiePath));
            tiePath[0] = -1;
            tiePath[2] = -1;
        }
        else if(Math.abs(tiePath[3] - tiePath[1]) > 20)
        {
          let path1 = [tiePath[0],tiePath[1],tiePath[0]+noteSpacing,tiePath[1]];
          let path2 = [tiePath[2]-10,tiePath[3],tiePath[2],tiePath[3]];
          d3.select(this)
          .append("path")
          .attr("fill","none")
          .attr("stroke","black")
          .attr("stroke-width",1)
          .attr("d",pathTied(path1));
          d3.select(this)
          .append("path")
          .attr("fill","none")
          .attr("stroke","black")
          .attr("stroke-width",1)
          .attr("d",pathTied(path2));
          tiePath[0] = -1;
          tiePath[2] = -1;
        }
        }
      }
      //绘制三连音的标志
      if(number.dur == divisions / 3 || number.dur == divisions * 2 / 3)
      {
        if(i != 0 && i+1 < length && durList[i-1] == number.dur && number.dur == durList[i+1])
        {
          if(octList[i-1] == 5 || octList[i] == 5 || octList[i+1] == 5)
            ddy = 5;
          d3.select(this)
          .append("path")
          .attr("fill","none")
          .attr("stroke","black")
          .attr("stroke-width","1px")
          .attr("transform",`translate(${marginLeft+start+reset*noteSpacing},${marginTop+lineIndex*eachHeight})`)
          .attr("d",`M ${-noteSpacing} ${-(16+ddy)} L ${-noteSpacing} ${-(19+ddy)} L ${noteSpacing} ${-(19+ddy)} L ${noteSpacing} ${-(16+ddy)}`);
          d3.select(this)
          .append("text")
          .attr("font-size",10)
          .attr("text-anchor","middle")
          .attr("x",0)
          .attr("y",-(16+ddy))
          .attr("transform",`translate(${marginLeft+start+reset*noteSpacing},${marginTop+lineIndex*eachHeight})`)
          .text("3");
        }
      }
    })
    
    //绘制小节线
    g.append("text")
    .attr("transform",(_d,_i)=>`translate(${marginLeft+start+length*noteSpacing},${marginTop+lineIndex*eachHeight})`)
    .attr("text-anchor","middle")
    .text("|")
  }
  function pathTied(p)
  {
    if(p[1] > p[3] && p[1] - p[3] < 20)
      p[3] = p[1];
    else if(p[3] > p[1] && p[3] - p[1] < 20) 
      p[1] = p[3];
    var dx = p[2] - p[0];
    return `M ${p[0]} ${p[1]} C ${p[0]+dx/4} ${p[1]-4} ${p[2]-dx/4} ${p[1]-4} ${p[2]} ${p[1]}`;
  }
  function note2number(note)
  {
    var keyAlter =  [{fifth:7,key:"#C",alter:-1},
                      {fifth:0,key:"C",alter:0},
                      {fifth:-7,key:"bC",alter:1},
                      {fifth:-5,key:"bD",alter:-1},
                      {fifth:-4,key:"D",alter:-2},
                      {fifth:-3,key:"bE",alter:-3},
                      {fifth:4,key:"E",alter:-4},
                      {fifth:5,key:"B",alter:1},
                      {fifth:-1,key:"F",alter:-5},
                      {fifth:1,key:"G",alter:5}] ;
    var stepList = [ "1","#1","2","#2","3","4","#4","5","#5","6","#6","7" ];
    var step2num = [ {step:"C",num:0},{step:"D",num:2},{step:"E",num:4},
                    {step:"F",num:5},{step:"G",num:7},{step:"A",num:9},{step:"B",num:11} ];
    var number = {text:"0",tied:0,octave:4,dur:0};
    var tempNum = 0;
    const notations = note.notations;
    const hasTied =
      notations != null &&
      (notations.tied != null ||
        asArray(notations).some((item) => item && item.tied != null));
    number.tied = hasTied ? 1 : 0;
    if(note.rest != undefined)
    {
      number.text = "0";
      number.dur = Number(note.duration) || 0;
      number.octave = 4;
      return number;
    }
    if (!note.pitch) {
      number.dur = Number(note.duration) || 0;
      return number;
    }
    for(let i = 0; i < step2num.length;i++)
    {
      if(step2num[i].step == note.pitch.step)
      {
        tempNum = step2num[i].num;
        break;
      }
    }
    const fifths = Number(partAttr.key?.fifths);
    for(let i = 0; i < keyAlter.length;i++)
    {
      if(keyAlter[i].fifth == fifths)
      {
        tempNum+=keyAlter[i].alter;
        break;
      }
    }
    if(note.pitch.alter != undefined) tempNum+=Number(note.pitch.alter);
    number.octave = Number(note.pitch.octave);
    if(tempNum < 0)
    {
      tempNum+=12;
      number.octave--;
    }
    else if(tempNum > 11)
    {
      tempNum-=12;
      number.octave++;
    }
    number.dur = Number(note.duration) || 0;
    number.text = stepList[tempNum] || "0";
    return number;
  }

}