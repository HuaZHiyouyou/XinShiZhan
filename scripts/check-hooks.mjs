/**
 * Hook 顺序静态检查（零依赖）。
 *
 * 背景：React 要求组件每次渲染调用**数量与顺序完全一致**的 Hook。
 * 一旦某个 Hook 被写在 `if (xxx) return` 之后，弹窗打开 / 数据加载完成时
 * Hook 数量发生变化，React 会直接卸载整棵组件树——表现为整页黑屏，
 * 而 TypeScript 与接口层测试都发现不了。
 *
 * 这个脚本扫描 web/src 下的 .tsx，找出「组件体里出现在提前 return 之后的 Hook」。
 * 判定基于本项目的排版约定（组件体缩进 2 空格、顶格 `}` 结束一个顶层函数）：
 *   1. 缩进恰好 2 空格的 Hook 调用行（`useXxx(` 形式的调用，排除 import / 函数声明）
 *   2. 缩进恰好 2 空格的提前返回：`if (...) return`
 *      或 `if (...) {` 且紧随其后 4 行内有更深缩进的 return
 *   3. 顶格 `}` 表示进入下一个顶层函数，提前返回标记重置
 *
 * 用法：node scripts/check-hooks.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '..', 'web', 'src');

/** 2 空格缩进、以 `useXxx(` 调用的 Hook（涵盖 const x = useXxx(...) 与解构写法） */
const HOOK_CALL_RE = /\buse[A-Z][A-Za-z0-9]*\s*\(/;
/** 形如 `  if (...) return ...` */
const INLINE_RETURN_RE = /^ {2}if\s*\(.*\)\s*return\b/;
/** 形如 `  if (...) {` */
const BLOCK_IF_RE = /^ {2}if\s*\(.*\)\s*\{\s*$/;
/** 不该被当成 Hook 调用的行 */
const IGNORE_RE = /^ {2}(?:\/\/|\*|\/\*|import\b|export\s+default\s+function\b|export\s+function\b|function\b)/;

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith('.tsx')) out.push(full);
  }
  return out;
}

/** `if (...) {` 后面 4 行内出现更深缩进的 return，才算提前返回 */
function blockEndsWithReturn(lines, index) {
  for (let j = index + 1; j < Math.min(lines.length, index + 5); j += 1) {
    if (/^ {4,}return\b/.test(lines[j])) return true;
    if (/^ {4,}\}/.test(lines[j])) return false;
  }
  return false;
}

const problems = [];
const files = walk(ROOT).sort();

for (const file of files) {
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  let earlyReturn = -1;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];

    /* 顶格收尾 = 当前函数结束，标记重置 */
    if (/^\}/.test(line)) {
      earlyReturn = -1;
      continue;
    }

    if (earlyReturn < 0 && (INLINE_RETURN_RE.test(line) || (BLOCK_IF_RE.test(line) && blockEndsWithReturn(lines, i)))) {
      earlyReturn = i + 1;
      continue;
    }

    if (earlyReturn < 0 || IGNORE_RE.test(line)) continue;
    if (!HOOK_CALL_RE.test(line)) continue;

    problems.push({
      file: path.relative(path.resolve(here, '..'), file),
      line: i + 1,
      returnLine: earlyReturn,
      text: line.trim(),
    });
  }
}

console.log(`\n=== Hook 顺序检查（扫描 ${files.length} 个 tsx 文件）===`);

if (problems.length === 0) {
  console.log('  PASS  没有发现「提前 return 之后调用 Hook」的写法');
  process.exit(0);
}

console.log(`  FAIL  发现 ${problems.length} 处 Hook 写在提前 return 之后：\n`);
for (const item of problems) {
  console.log(`  ${item.file}:${item.line}   ${item.text}`);
  console.log(`       第 ${item.returnLine} 行已提前 return，此 Hook 会被条件跳过 → 渲染期崩溃（黑屏）`);
}
console.log('\n修复方式：把这些 Hook 移到提前 return 之前。\n');
process.exitCode = 1;
