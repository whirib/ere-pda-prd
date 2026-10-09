import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const skill = path.join(root, 'skills/ere-prd');
function files(dir) { return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? files(path.join(dir, e.name)) : [path.join(dir, e.name)]); }
const packages = fs.readdirSync(path.join(root, 'skills'), { withFileTypes: true }).filter(e => e.isDirectory()).map(e => path.join(root, 'skills', e.name));
const packageFiles = packages.flatMap(files);
for (const dir of packages) {
  const entry = fs.readFileSync(path.join(dir, 'SKILL.md'), 'utf8');
  assert.match(entry, new RegExp(`^---\\r?\\nname: ${path.basename(dir)}\\r?\\ndescription: .+\\r?\\n`));
  assert.ok(fs.existsSync(path.join(dir, 'agents/openai.yaml')), `缺少 Codex 元数据 ${dir}`);
}
const all = files(skill), md = fs.readFileSync(path.join(skill, 'SKILL.md'), 'utf8');
assert.match(md, /^---\r?\nname: ere-prd\r?\ndescription: .+\r?\n/);
const front = md.split(/^---\r?$/m)[1];
assert.ok(front.includes('license: Apache-2.0'));
assert.ok(md.split('\n').length < 300, '主 SKILL 应保持精简');
for (const file of [...packageFiles.filter(x => x.endsWith('.md')), path.join(root, 'README.md')]) {
  const prose = fs.readFileSync(file, 'utf8').replace(/```[\s\S]*?```/g, '').replace(/`[^`]*`/g, '');
  for (const link of prose.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    const target = link[1].split('#')[0];
    if (!target || /^(?:https?:|mailto:)/.test(target)) continue;
    const resolved = path.resolve(path.dirname(file), target);
    assert.ok(fs.existsSync(resolved), `缺失引用 ${file}: ${target}`);
    const owner = packages.find(dir => file.startsWith(dir + path.sep));
    if (owner) assert.ok(resolved.startsWith(owner + path.sep), `skill 不能依赖外部文件 ${target}`);
  }
}
for (const file of files(root).filter(x => x.endsWith('.mjs') && !x.includes(`${path.sep}.demo-output${path.sep}`) && !x.includes(`${path.sep}.git${path.sep}`))) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 0, result.stderr);
}
for (const name of ['LICENSE', 'THIRD_PARTY_NOTICES.md', 'SOURCE_AUDIT.md', 'source-manifest.json', 'VALIDATION.md']) assert.ok(fs.existsSync(path.join(root, name)), `缺少 ${name}`);
for (const name of ['Apache-2.0.txt', 'product-idea-excavator-MIT.txt', 'prd-debate-MIT.txt', 'pm-skills-Apache-2.0.txt', 'mattpocock-skills-MIT.txt']) assert.ok(fs.readFileSync(path.join(skill, 'licenses', name)).length > 900);
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'source-manifest.json'), 'utf8'));
assert.equal(manifest.sources.length, 4);
for (const source of manifest.sources) { assert.match(source.commit, /^[a-f0-9]{40}$/); for (const item of source.files) assert.match(item.sha256, /^[a-f0-9]{64}$/); }
assert.deepEqual(manifest.bundledSkills.map(x => x.name).sort(), ['grill-me', 'grilling']);
const upstream = manifest.sources.find(x => x.repository === 'https://github.com/mattpocock/skills');
for (const bundled of manifest.bundledSkills) {
  assert.equal(bundled.commit, upstream.commit);
  const dir = path.join(root, 'skills', bundled.name);
  for (const item of bundled.files) {
    const content = fs.readFileSync(path.join(dir, item.path), 'utf8').replace(/\r\n/g, '\n');
    assert.equal(createHash('sha256').update(content).digest('hex'), item.sha256, `收录快照被改动 ${bundled.name}/${item.path}`);
  }
  assert.equal(bundled.files.find(x => x.path === 'SKILL.md').sha256, upstream.files.find(x => x.path.endsWith(`/${bundled.name}/SKILL.md`)).sha256);
  assert.equal(bundled.files.find(x => x.path === 'LICENSE').sha256, upstream.files.find(x => x.path === 'LICENSE').sha256);
}
const config = fs.readFileSync(path.join(skill, 'agents/openai.yaml'), 'utf8');
const description = config.match(/short_description: "([^"]+)"/)[1];
assert.ok(description.length >= 25 && description.length <= 64);
assert.ok(config.includes('$ere-prd'));
// The installed folder must run without repository-level modules or fixtures.
const packageTemp = path.resolve(process.env.ERE_PRD_TEST_TMP ?? os.tmpdir());
fs.mkdirSync(packageTemp, { recursive: true });
const copied = fs.mkdtempSync(path.join(packageTemp, 'ere-prd-package-'));
try {
  fs.cpSync(skill, path.join(copied, 'ere-prd'), { recursive: true });
  const result = spawnSync(process.execPath, [path.join(copied, 'ere-prd/scripts/prd.mjs'), 'help'], { cwd: copied, encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 0, result.stderr); assert.ok(JSON.parse(result.stdout).commands.length);
} finally { if (path.dirname(path.resolve(copied)) === packageTemp && path.basename(copied).startsWith('ere-prd-package-')) fs.rmSync(copied, { recursive: true, force: true }); }
process.stdout.write(JSON.stringify({ ok: true, skills: packages.map(dir => path.basename(dir)).sort(), skillFiles: packageFiles.length, checks: ['links', 'syntax', 'licenses', 'source-manifest', 'bundled-integrity', 'metadata', 'standalone-copy'] }) + '\n');
