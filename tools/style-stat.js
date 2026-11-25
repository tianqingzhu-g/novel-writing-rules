#!/usr/bin/env node
/**
 * style-stat.js —— 网文"去 AI 味"量化体检
 *
 * 用法一（量单章 / 多章）：
 *   node tools/style-stat.js 章1.md 章2.md
 *
 * 用法二（量样本库，按"第N章"切分并按段聚合）：
 *   node tools/style-stat.js --corpus 样本.txt --bands 1-20,21-100,101-500
 *
 * 输出：字数、句长分布、分句结构、对白段占比、单句段占比、
 *       动词密度、关联词密度、AI 腔命中、段首"他"、ASCII 引号。
 *
 * 说明：
 * 1) 句子切分为"到句号/问号/叹号为止，允许紧跟一个右引号"。
 * 2) 段落只统计 >=6 字的行，所以"疼。""不疼。"这类极短段不计入，
 *    这是为了与参考书用同一把尺子（参考书正文也是长段）。
 * 3) 动词、关联词是固定词表，绝对值没有意义，只用于"与样本库对比"。
 */
const fs = require('fs');

// ---------- 可调参数 ----------
const MIN_PARA = 6;          // 段落最小字数（汉字）
const VERBS = '看走说站坐捏拿放听想问答摸翻拉推开关抬低转伸握咬嚼吃完喝咽躺睡醒睁闭跑来去回进出上下来到起落停接递塞按提拎抱扛扯拽踢打骂笑哭喊叫写画读念记忘擦洗穿脱买卖给送借还欠攒赔赚算数点认觉知道当叫让把被'.split('');
const LINKS = ['却','而','便','乃','则','虽','然','若','但','更','还','就','已','才','再','又','也','都','只','倒','竟','遂','故','于是','因此','然而','虽然','但是','不过','只是','至于','须知','饶是','倘若','纵','亦'];
const BLACKLIST_A = [
  '涌上心头','心头一紧','心中一暖','心中一沉','勾起一抹','弧度','深邃','凝滞',
  '不易察觉','几不可察','只有他知道','声音不大，却',
];
const BLACKLIST_B = [
  '顿了顿','一抹','一丝','仿佛','像是','某种','莫名','不知为何','终于','不禁',
  '缓缓','淡淡','沉默','那一刻','闪过','泛起','说穿了','说白了',
];
// --------------------------------

const HAN = /[\u4e00-\u9fff]/g;
const han = s => (s.match(HAN) || []).length;

function splitSentences(text) {
  const out = [];
  let buf = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    buf += ch;
    if ('。！？'.includes(ch)) {
      const next = text[i + 1];
      if (next === '”' || next === '」' || next === '』') { buf += next; i++; }
      if (han(buf) >= 2) out.push(buf.trim());
      buf = '';
    }
  }
  if (han(buf) >= 2) out.push(buf.trim());
  return out;
}

function metrics(name, text) {
  const paras = text.split(/\r?\n/).map(x => x.trim()).filter(x => x.length >= MIN_PARA);
  const sents = [];
  for (const p of paras) for (const s of splitSentences(p)) sents.push(s);

  const lens = sents.map(han).sort((a, b) => a - b);
  const q = p => lens.length ? lens[Math.min(lens.length - 1, Math.floor(lens.length * p))] : 0;
  const share = (fn) => sents.length ? sents.filter(fn).length / sents.length * 100 : 0;

  let clauses = 0, clauseHan = 0, multi = 0;
  for (const s of sents) {
    const cs = s.split(/[，；：、]/).map(han).filter(x => x > 0);
    if (cs.length >= 2) multi++;
    clauses += cs.length;
    clauseHan += cs.reduce((a, b) => a + b, 0);
  }

  const h = han(text);
  const per = n => (n / h * 1000).toFixed(1);
  const countAny = arr => arr.reduce((acc, w) => acc + (text.split(w).length - 1), 0);

  return {
    name,
    han: h,
    nonWS: text.replace(/\s/g, '').length,
    paras: paras.length,
    sents: sents.length,
    sentMed: q(.5),
    p25: q(.25), p75: q(.75), p90: q(.9),
    long20: share(s => han(s) >= 20).toFixed(1),
    short6: share(s => han(s) <= 6).toFixed(1),
    clauseAvg: (clauseHan / (clauses || 1)).toFixed(1),
    clausePerSent: (clauses / (sents.length || 1)).toFixed(2),
    multiPct: (multi / (sents.length || 1) * 100).toFixed(1),
    onePara: (paras.filter(p => splitSentences(p).length <= 1).length / (paras.length || 1) * 100).toFixed(1),
    dlgPara: (paras.filter(p => /[“「『]/.test(p)).length / (paras.length || 1) * 100).toFixed(1),
    verb: per(countAny(VERBS)),
    link: per(countAny(LINKS)),
    de: per((text.match(/的/g) || []).length),
    hitA: BLACKLIST_A.filter(w => text.includes(w)),
    hitB: BLACKLIST_B.reduce((n, w) => n + (text.split(w).length - 1), 0),
    taStart: text.split(/\r?\n/).filter(l => /^他/.test(l.trim())).length,
    asciiQuote: (text.match(/["']/g) || []).length,
  };
}

const COLS = ['name','han','nonWS','paras','sentMed','p25','p75','p90','long20','short6','clauseAvg','clausePerSent','onePara','dlgPara','verb','link','de','taStart','asciiQuote'];

function printTable(rows) {
  console.log(COLS.join('\t'));
  for (const r of rows) console.log(COLS.map(c => r[c]).join('\t'));
  const bad = rows.filter(r => r.hitA.length);
  console.log('\nA 级命中（出现即改）：' + (bad.length ? '' : '无'));
  for (const r of bad) console.log('  ' + r.name + ': ' + r.hitA.join('、'));
  console.log('慎用词次数（只作对比，不单独判罪）：' + rows.map(r => r.name + '=' + r.hitB).join('  '));
}

const args = process.argv.slice(2);
if (!args.length) {
  console.log('用法: node tools/style-stat.js <文件...>');
  console.log('     node tools/style-stat.js --corpus <样本.txt> [--bands 1-20,21-100]');
  process.exit(0);
}

if (args[0] === '--corpus') {
  const raw = fs.readFileSync(args[1], 'utf8');
  const bandsArg = (args.includes('--bands') ? args[args.indexOf('--bands') + 1] : '1-100,101-300,301-600,601-1000');
  const bands = bandsArg.split(',').map(b => b.split('-').map(Number));

  const lines = raw.split(/\r?\n/);
  const chapters = [];
  let cur = null;
  for (const line of lines) {
    const m = line.match(/^\s{0,2}第(\d+)章/);
    if (m) { if (cur) chapters.push(cur); cur = { no: +m[1], lines: [] }; }
    else if (cur) cur.lines.push(line);
  }
  if (cur) chapters.push(cur);

  const rows = [];
  for (const [lo, hi] of bands) {
    const chs = chapters.filter(c => c.no >= lo && c.no <= hi);
    if (!chs.length) continue;
    const text = chs.map(c => c.lines.join('\n')).join('\n');
    const m = metrics(`${lo}-${hi}章`, text);
    m.han = Math.round(m.han / chs.length);
    m.paras = Math.round(m.paras / chs.length);
    m.sents = Math.round(m.sents / chs.length);
    m.taStart = Math.round(m.taStart / chs.length);
    rows.push({ ...m, name: `${lo}-${hi}（每章均值）` });
  }
  printTable(rows);
} else {
  printTable(args.map(f => metrics(f.split(/[\\/]/).pop(), fs.readFileSync(f, 'utf8'))));
}
