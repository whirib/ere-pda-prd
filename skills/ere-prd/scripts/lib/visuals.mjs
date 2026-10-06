import { need, idValue, textValue } from './store.mjs';

const xml = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]);
const quote = value => String(value).replace(/"/g, '#quot;').replace(/[\r\n]/g, ' ');
const wrap = value => { const chars = Array.from(String(value)), rows = []; for (let i = 0; i < chars.length; i += 13) rows.push(chars.slice(i, i + 13).join('')); return rows; };
const svgStart = (w, h, title) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img"><title>${xml(title)}</title><rect width="100%" height="100%" fill="white"/><style>text{font-family:'Microsoft YaHei','Noto Sans CJK SC',sans-serif;fill:#17243a;font-size:16px} .edge{fill:none;stroke:#52647a;stroke-width:2} .label{paint-order:stroke;stroke:white;stroke-width:6px;stroke-linejoin:round}</style><defs><marker id="arrow" markerWidth="9" markerHeight="9" refX="8" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 Z" fill="#52647a"/></marker></defs><text x="24" y="32" font-size="21" font-weight="600">${xml(title)}</text>`;

export function renderDiagram(s, spec) {
  need(s.draft && spec && idValue(spec.id) && textValue(spec.title) && textValue(spec.purpose) && textValue(spec.reason), 'DIAGRAM_SPEC', '图表需要唯一 ID、标题、目的与选型理由。');
  need(Array.isArray(spec.requirementIds) && spec.requirementIds.length && spec.requirementIds.every(id => s.artifacts.specification?.requirements.some(r => r.id === id)), 'DIAGRAM_REQUIREMENT', '图必须关联存在的需求。');
  need(['flowchart', 'state', 'line', 'bar'].includes(spec.type), 'RENDERER_CAPABILITY', '内置工具支持流程、状态、折线和柱状图。其他类型请接入实际 renderer skill。');
  if (['flowchart', 'state'].includes(spec.type)) {
    const nodes = spec.nodes ?? [], edges = spec.edges ?? [], ids = new Set();
    need(Array.isArray(nodes) && Array.isArray(edges) && [...nodes, ...edges].every(x => x && typeof x === 'object'), 'GRAPH_SIZE', 'nodes 和 edges 需要记录数组。');
    need(nodes.length >= 2 && nodes.length <= 16 && edges.length > 0, 'GRAPH_SIZE', '内置图应有 2–16 个节点及关系；复杂图请拆分或使用其他 renderer。');
    for (const n of nodes) {
      need(idValue(n.id) && !['end', 'graph', 'state', 'subgraph'].includes(n.id) && !ids.has(n.id), 'NODE_ID', '节点 ID 无效、保留字或重复。'); ids.add(n.id);
      need(textValue(n.label) && s.draft.text.includes(n.label) && Array.from(n.label).length <= 52, 'NODE_LABEL', '节点标签必须来自当前 PRD，过长标签请压缩正文或拆图。');
    }
    for (const e of edges) need(ids.has(e.from) && ids.has(e.to) && e.from !== e.to, 'EDGE_ENDPOINT', '关系必须连接已声明的两个不同节点。');
    if (spec.type === 'flowchart') need(edges.some(e => edges.filter(x => x.from === e.from).length > 1) || edges.some(e => nodes.findIndex(n => n.id === e.to) < nodes.findIndex(n => n.id === e.from)), 'LINEAR_DIAGRAM', '线性步骤用列表更清楚；流程图需表达分支、关系或回路。');
    // Coordinates are optional, bounded and collision-checked. The deterministic
    // vertical fallback works for cycles without trusting an LLM's layout claim.
    const positions = nodes.map((n, index) => ({ ...n, x: n.x ?? 320, y: n.y ?? 100 + index * 140 }));
    for (const n of positions) need(Number.isFinite(n.x) && Number.isFinite(n.y) && n.x >= 150 && n.x <= 1800 && n.y >= 90 && n.y <= 2400, 'NODE_POSITION', '坐标超出可读范围。');
    for (let i = 0; i < positions.length; i++) for (let j = i + 1; j < positions.length; j++) need(Math.abs(positions[i].x - positions[j].x) >= 270 || Math.abs(positions[i].y - positions[j].y) >= 100, 'NODE_OVERLAP', '节点重叠，请调整布局。');
    const width = Math.max(...positions.map(n => n.x)) + 350, height = Math.max(...positions.map(n => n.y)) + 90;
    let svg = svgStart(width, height, spec.title);
    for (const [index, e] of edges.entries()) {
      const a = positions.find(n => n.id === e.from), b = positions.find(n => n.id === e.to);
      let d, lx, ly, anchor = 'start', labelChars = 13;
      if (b.y < a.y) {
        const lane = width - 35 - (index % 3) * 22;
        d = `M ${a.x + 125} ${a.y} L ${lane} ${a.y} L ${lane} ${b.y} L ${b.x + 125} ${b.y}`;
        lx = lane - 8; ly = a.y - 18; anchor = 'end'; labelChars = 6;
      } else if (Math.abs(a.x - b.x) >= 270) {
        const side = b.x > a.x ? 1 : -1, x1 = a.x + side * 125, x2 = b.x - side * 125, mid = (x1 + x2) / 2;
        const reciprocal = edges.some(x => x.from === e.to && x.to === e.from), offset = reciprocal ? -side * 17 : 0;
        d = `M ${x1} ${a.y + offset} C ${mid} ${a.y + offset}, ${mid} ${b.y + offset}, ${x2} ${b.y + offset}`;
        lx = mid; ly = (a.y + b.y) / 2 + offset - 8; anchor = 'middle'; labelChars = Math.max(2, Math.floor((Math.abs(x2 - x1) - 12) / 16));
      } else if (b.y > a.y && b.y - a.y <= 150) {
        d = `M ${a.x} ${a.y + 40} L ${b.x} ${b.y - 40}`; lx = a.x + 26; ly = (a.y + b.y) / 2;
      } else {
        const lane = 28 + (index % 5) * 22, x1 = a.x - 125, x2 = b.x - 125;
        d = `M ${x1} ${a.y} L ${lane} ${a.y} L ${lane} ${b.y} L ${x2} ${b.y}`; lx = lane + 7; ly = (a.y + b.y) / 2;
      }
      svg += `<path class="edge" d="${d}" marker-end="url(#arrow)"/>`;
      if (e.label) { const chars = Array.from(String(e.label)); for (let i = 0; i < chars.length; i += labelChars) svg += `<text class="label" x="${lx}" y="${ly + Math.floor(i / labelChars) * 20}" text-anchor="${anchor}">${xml(chars.slice(i, i + labelChars).join(''))}</text>`; }
    }
    for (const n of positions) {
      const decision = n.kind === 'decision';
      svg += decision ? `<polygon points="${n.x},${n.y - 43} ${n.x + 125},${n.y} ${n.x},${n.y + 43} ${n.x - 125},${n.y}" fill="#fff4d7" stroke="#957038"/>`
        : `<rect x="${n.x - 125}" y="${n.y - 40}" width="250" height="80" rx="${n.kind === 'terminal' ? 30 : 10}" fill="#edf4fd" stroke="#516d96"/>`;
      const rows = wrap(n.label);
      rows.forEach((line, i) => { svg += `<text x="${n.x}" y="${n.y - (rows.length - 1) * 10 + i * 20 + 5}" text-anchor="middle">${xml(line)}</text>`; });
    }
    const source = spec.type === 'flowchart'
      ? `flowchart TD\n${nodes.map(n => `  ${n.id}${n.kind === 'decision' ? `{"${quote(n.label)}"}` : `["${quote(n.label)}"]`}`).join('\n')}\n${edges.map(e => `  ${e.from} -->${e.label ? `|"${quote(e.label)}"|` : ''} ${e.to}`).join('\n')}\n`
      : `stateDiagram-v2\n${nodes.map(n => `  state "${quote(n.label)}" as ${n.id}`).join('\n')}\n${edges.map(e => `  ${e.from} --> ${e.to}${e.label ? `: ${quote(e.label)}` : ''}`).join('\n')}\n`;
    return { svg: `${svg}</svg>`, source, sourceExtension: 'mmd', width, height };
  }
  const points = spec.points ?? [];
  need(Array.isArray(points) && points.every(x => x && typeof x === 'object'), 'CHART_DATA', 'points 需要数据点数组。');
  need(points.length >= 2 && points.length <= 24 && textValue(spec.unit), 'CHART_DATA', '图表需要 2–24 个实际数据点和单位。');
  for (const p of points) {
    const c = s.artifacts.intake?.claims.find(x => x.id === p.claimId);
    const numeric = String(p.value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    need(textValue(p.label) && Number.isFinite(p.value) && c?.kind === 'fact' && c.evidence?.some(x => new RegExp(`(?<![\\d.])${numeric}(?![\\d.])`).test(x.quote)), 'UNSOURCED_CHART', '每个数值需要原始资料中的事实引用；不得把预测或建议画成实测。');
  }
  if (spec.type === 'line') need(points.every(p => Number.isFinite(p.time)) && points.every((p, i) => i === 0 || p.time > points[i - 1].time), 'CHART_TIME', '折线图需提供真实递增时间，使用实际间距。');
  const width = 900, height = 480, left = 80, top = 80, plotW = 770, plotH = 300;
  const min = Math.min(0, ...points.map(p => p.value)), max = Math.max(0, ...points.map(p => p.value));
  const range = max - min || 1, y = value => top + plotH - ((value - min) / range) * plotH;
  const x = (p, i) => spec.type === 'line' ? left + (p.time - points[0].time) / (points.at(-1).time - points[0].time) * plotW : left + (i + 0.5) / points.length * plotW;
  let svg = svgStart(width, height, spec.title);
  svg += `<text x="${left}" y="60">单位：${xml(spec.unit)}</text><path class="edge" d="M ${left} ${top} L ${left} ${top + plotH} L ${left + plotW} ${top + plotH}"/>`;
  for (let i = 0; i <= 4; i++) { const v = min + range * i / 4; svg += `<text x="${left - 10}" y="${y(v) + 5}" text-anchor="end">${xml(Number(v.toFixed(2)))}</text>`; }
  if (spec.type === 'line') svg += `<polyline points="${points.map((p, i) => `${x(p, i)},${y(p.value)}`).join(' ')}" fill="none" stroke="#245ac3" stroke-width="3"/>`;
  points.forEach((p, i) => {
    const px = x(p, i), py = y(p.value), zero = y(0), barW = Math.min(55, plotW / points.length * 0.6);
    svg += spec.type === 'bar' ? `<rect x="${px - barW / 2}" y="${Math.min(py, zero)}" width="${barW}" height="${Math.max(1, Math.abs(zero - py))}" fill="#3c73c4"/>` : `<circle cx="${px}" cy="${py}" r="5" fill="#245ac3"/>`;
    svg += `<text x="${px}" y="${py - 12}" text-anchor="middle">${xml(p.value)}</text><text x="${px}" y="${top + plotH + 24}" text-anchor="end" transform="rotate(-25 ${px} ${top + plotH + 24})">${xml(p.label)}</text>`;
  });
  return { svg: `${svg}</svg>`, source: JSON.stringify(spec, null, 2), sourceExtension: 'json', width, height };
}
