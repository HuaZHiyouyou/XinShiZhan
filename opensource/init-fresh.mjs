#!/usr/bin/env node
/**
 * 生成一份「纯净实例」的数据目录：**只有超级管理员，没有任何其他数据**。
 *
 * 具体会做三件事：
 *   1. 清空目标数据目录（默认 `opensource/data`）；
 *   2. 建好完整的空表结构 + 一份全新的主密钥；
 *   3. 只创建超级管理员账号，并把口令设为 README 里写明的那个。
 *
 * 为什么要有这个脚本，而不是直接塞一个现成的 .db 文件？
 * 因为账号口令是用「主密钥派生的胡椒」做哈希的。换一台机器如果不带 master.key，
 * 文档里写的口令就永远登不进去；而把 master.key 一起开源，等于公布了一把永久钥匙。
 * 所以正确做法是：**在本地生成**，密钥和口令都只属于这一份实例。
 *
 * 用法：
 *   node opensource/init-fresh.mjs              # 写入 opensource/data
 *   node opensource/init-fresh.mjs <目录>        # 写入指定目录
 *   XSZ_ADMIN_PASS=自定义 node opensource/init-fresh.mjs
 *
 * 注意：不接受把 server/data 作为目标（那会清空你正在用的数据）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, '..');
const liveDataDir = path.join(projectRoot, 'server', 'data');

const ADMIN_USER = String(process.env.XSZ_ADMIN_USER || 'huazhiyou');
const ADMIN_PASS = String(process.env.XSZ_ADMIN_PASS || 'huazhiyouyou');

const target = path.resolve(process.argv[2] || path.join(here, 'data'));

if (target === liveDataDir) {
  console.error('✗ 拒绝执行：目标目录是正在使用的 server/data，避免误删线上数据。');
  console.error('  如果要重置线上实例，请先备份，然后显式指定该目录。');
  process.exit(1);
}

console.log('=== 心事站 · 生成纯净实例 ===');
console.log(`目标目录：${target}`);

fs.rmSync(target, { recursive: true, force: true });
fs.mkdirSync(target, { recursive: true });

/* 必须在 import 之前设置：db.js 与 secrets.js 在模块加载时就会读取这些变量 */
process.env.XSZ_DATA_DIR = target;
process.env.XSZ_ADMIN_USER = ADMIN_USER;
process.env.XSZ_ADMIN_PASS = ADMIN_PASS;

const importFromServer = (relative) =>
  import(pathToFileURL(path.join(projectRoot, 'server', 'src', relative)).href);

const { db, DATA_DIR } = await importFromServer('db.js');
const { ensureAdminAccount } = await importFromServer('lib/auth.js');

const created = ensureAdminAccount();

const users = db.prepare('SELECT uid, username, role, status FROM users ORDER BY id').all();
const counts = {
  心事: db.prepare('SELECT COUNT(*) AS c FROM posts').get().c,
  留言: db.prepare('SELECT COUNT(*) AS c FROM messages').get().c,
  弹幕: db.prepare('SELECT COUNT(*) AS c FROM danmaku').get().c,
  音乐: db.prepare('SELECT COUNT(*) AS c FROM music_tracks').get().c,
  封禁: db.prepare('SELECT COUNT(*) AS c FROM bans').get().c,
  举报: db.prepare('SELECT COUNT(*) AS c FROM reports').get().c,
  找回申请: db.prepare('SELECT COUNT(*) AS c FROM recovery_requests').get().c,
};

console.log(`数据目录：${DATA_DIR}`);
console.log(`管理员动作：${created.action}`);
console.log('\n账号清单：');
users.forEach((user) => console.log(`  UID ${user.uid}  ${user.username}  ${user.role}  ${user.status}`));
console.log('\n其他数据：');
Object.entries(counts).forEach(([label, value]) => console.log(`  ${label}：${value}`));

const onlyAdmin = users.length === 1 && users[0].role === 'superadmin';
const clean = Object.values(counts).every((value) => value === 0);

console.log('\n--- 校验 ---');
console.log(`  只有一个账号且为超级管理员：${onlyAdmin ? '✓' : '✗'}`);
console.log(`  没有任何其他业务数据：${clean ? '✓' : '✗'}`);
console.log(`  超级管理员账号：${ADMIN_USER}`);
console.log('  ⚠ 首次登录后请立刻修改密码（个人信息 → 账号与安全）');

/* 数据目录里刻意只放数据库与主密钥，不写任何说明文件，保持「零其他信息」 */
fs.readdirSync(target).forEach((name) => console.log(`  · ${name}`));

db.close?.();
process.exit(onlyAdmin && clean ? 0 : 1);
