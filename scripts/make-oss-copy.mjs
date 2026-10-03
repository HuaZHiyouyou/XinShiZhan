#!/usr/bin/env node
/**
 * 生成「可以直接开源」的干净副本：`<项目根>/XinShiZhan/`
 *
 * 会做的事：
 *   1. 只复制源码与配置，跳过 node_modules / 构建产物 / 日志 / 上传内容 / 现有数据；
 *   2. 在新副本里生成一份「只有超级管理员、没有任何其他数据」的数据目录
 *      （复用 opensource/init-fresh.mjs，主密钥是这一份副本专属的新密钥）。
 *
 * 用法：
 *   node scripts/make-oss-copy.mjs             # 输出到 ./XinShiZhan
 *   node scripts/make-oss-copy.mjs MySite-OSS  # 输出到指定目录名
 *
 * 注意：目标目录若已存在会被**先整体删除**，请勿指向正在使用的目录。
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, '..');

const targetName = process.argv[2] || 'XinShiZhan';
const target = path.isAbsolute(targetName) ? targetName : path.resolve(projectRoot, targetName);

if (target === projectRoot || projectRoot.startsWith(`${target}${path.sep}`)) {
  console.error('✗ 目标不能是项目本身或其父目录，已中止。');
  process.exit(1);
}
if (target.startsWith(`${projectRoot}${path.sep}`) && target !== path.resolve(projectRoot, 'XinShiZhan')) {
  /* 允许自定义目录名，但仍限制在项目根目录内，避免误删系统路径 */
  const insideOk = path.dirname(target) === projectRoot;
  if (!insideOk) {
    console.error('✗ 目标需要位于项目根目录下，已中止。');
    process.exit(1);
  }
}

/* ── 复制规则 ─────────────────────────────────────────────── */

/** 目录名黑名单：任何层级都跳过 */
const SKIP_DIR_NAMES = new Set([
  'node_modules',
  'dist',
  '.git',
  '.codebuddy',
  '.playwright-cli',
  '.vscode',
  '.idea',
]);

/** 相对项目根的路径黑名单：运行时产物与私有数据，不进开源包 */
const SKIP_RELATIVE = new Set([
  'server/data', // 现有数据库与主密钥（副本会重新生成干净的一份）
  'server/uploads', // 用户上传的图片与音频
  'opensource/data', // 纯净实例的生成产物
  'web/dist', // 前端构建产物
]);

const SKIP_FILE_NAMES = new Set(['.DS_Store', 'Thumbs.db', 'nul']);
const SKIP_FILE_RE = /(?:\.log|\.tsbuildinfo)$/;

let fileCount = 0;
let totalBytes = 0;
const skippedPaths = [];

function relative(from, to) {
  return path.relative(from, to).split(path.sep).join('/');
}

function copyTree(fromDir, toDir) {
  /* 先取目录清单再建目标目录：否则刚建出来的副本目录会出现在清单里，导致无限递归 */
  const entries = fs.readdirSync(fromDir, { withFileTypes: true });
  fs.mkdirSync(toDir, { recursive: true });

  for (const entry of entries) {
    const source = path.join(fromDir, entry.name);
    const destination = path.join(toDir, entry.name);
    const rel = relative(projectRoot, source);

    /* 双保险：永远不把自己复制进自己 */
    if (path.resolve(source) === target) {
      skippedPaths.push(rel);
      continue;
    }

    if (entry.isDirectory()) {
      if (SKIP_DIR_NAMES.has(entry.name) || SKIP_RELATIVE.has(rel)) {
        skippedPaths.push(rel);
        continue;
      }
      copyTree(source, destination);
      continue;
    }

    if (SKIP_FILE_NAMES.has(entry.name) || SKIP_FILE_RE.test(entry.name)) {
      skippedPaths.push(rel);
      continue;
    }

    fs.copyFileSync(source, destination);
    fileCount += 1;
    totalBytes += fs.statSync(destination).size;
  }
}

console.log('=== 心事站 · 生成开源副本 ===');
console.log(`源目录：${projectRoot}`);
console.log(`目标目录：${target}`);

fs.rmSync(target, { recursive: true, force: true });
copyTree(projectRoot, target);

console.log(`\n已复制文件：${fileCount} 个（${(totalBytes / 1024 / 1024).toFixed(2)} MB）`);
console.log(`跳过的运行时目录/文件：${skippedPaths.length} 项`);
skippedPaths.slice(0, 12).forEach((item) => console.log(`  · 跳过 ${item}`));

/* ── 在副本里生成「只有超级管理员」的数据目录 ──────────────── */

console.log('\n--- 生成纯净数据（只有超级管理员）---');
const init = spawnSync(process.execPath, [path.join(projectRoot, 'opensource', 'init-fresh.mjs'), path.join(target, 'server', 'data')], {
  stdio: 'inherit',
  env: process.env,
});

if (init.status !== 0) {
  console.error('\n✗ 纯净数据生成失败，开源副本不完整。');
  process.exit(init.status ?? 1);
}

const dataDir = path.join(target, 'server', 'data');
console.log('\n--- 副本数据目录 ---');
fs.readdirSync(dataDir).forEach((name) => console.log(`  · server/data/${name}`));

console.log('\n✓ 开源副本已就绪：');
console.log(`  ${target}`);
console.log('  进入后执行 npm run install:all && npm run build && npm start 即可启动。');
console.log('  ⚠ 首次登录后请立刻修改超级管理员密码。');
