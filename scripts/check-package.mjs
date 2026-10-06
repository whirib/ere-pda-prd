import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const skill = path.join(root, 'skills/ere-prd');
function files(dir) { return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? files(path.join(dir, e.name)) : [path.join(dir, e.name)]); }
const all = files(skill), md = fs.readFileSync(path.join(skill, 'SKILL.md'), 'utf8');
assert.match(md, /^---\r?\nname: ere-prd\r?\ndescription: .+\r?\n/);
const front = md.split(/^---\r?$/m)[1];
assert.ok(front.includes('license: Apache-2.0'));
assert.ok(md.split('\n').length < 300, '主 SKILL 应保持精简');
for (const file of [...all.filter(x => x.endsWith('.md')), path.join(root, 'README.md')]) {
  const prose = fs.readFileSync(file, 'utf8').replace(/```[\s\S]*?```/g, '').replace(/`[^`]*`/g, '');
  for (const link of prose.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    const target = link[1].split('#')[0];
    if (!target || /^(?:https?:|mailto:)/.test(target)) continue;
    const resolved = path.resolve(path.dirname(file), target);
    assert.ok(fs.existsSync(resolved), `缺失引用 ${file}: ${target}`);
    if (file.startsWith(skill)) assert.ok(resolved.startsWith(skill + path.sep), `skill 不能依赖外部文件 ${target}`);
  }
}
for (const file of files(root).filter(x => x.endsWith('.mjs') && !x.includes(`${path.sep}.demo-output${path.sep}`) && !x.includes(`${path.sep}.git${path.sep}`))) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 0, result.stderr);
}
for (const name of ['LICENSE', 'THIRD_PARTY_NOTICES.md', 'SOURCE_AUDIT.md', 'source-manifest.json', 'VALIDATION.md']) assert.ok(fs.existsSync(path.join(root, name)), `缺少 ${name}`);
for (const name of ['Apache-2.0.txt', 'product-idea-excavator-MIT.txt', 'prd-debate-MIT.txt', 'pm-skills-Apache-2.0.txt']) assert.ok(fs.readFileSync(path.join(skill, 'licenses', name)).length > 900);
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'source-manifest.json'), 'utf8'));
assert.equal(manifest.sources.length, 3);
for (const source of manifest.sources) { assert.match(source.commit, /^[a-f0-9]{40}$/); for (const item of source.files) assert.match(item.sha256, /^[a-f0-9]{64}$/); }
const config = fs.readFileSync(path.join(skill, 'agents/openai.yaml'), 'utf8');
const description = config.match(/short_description: "([^"]+)"/)[1];
assert.ok(description.length >= 25 && description.length <= 64);
assert.ok(config.includes('$ere-prd'));
// The installed folder must run without repository-level modules or fixtures.
const copied = fs.mkdtempSync(path.join(os.tmpdir(), 'ere-prd-package-'));
try {
  fs.cpSync(skill, path.join(copied, 'ere-prd'), { recursive: true });
  const result = spawnSync(process.execPath, [path.join(copied, 'ere-prd/scripts/prd.mjs'), 'help'], { cwd: copied, encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 0, result.stderr); assert.ok(JSON.parse(result.stdout).commands.length);
} finally { if (path.dirname(path.resolve(copied)) === path.resolve(os.tmpdir()) && path.basename(copied).startsWith('ere-prd-package-')) fs.rmSync(copied, { recursive: true, force: true }); }
process.stdout.write(JSON.stringify({ ok: true, skillFiles: all.length, checks: ['links', 'syntax', 'licenses', 'source-manifest', 'metadata', 'standalone-copy'] }) + '\n');
