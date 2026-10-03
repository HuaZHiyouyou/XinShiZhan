import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import cors from 'cors';
import { UPLOAD_DIR } from './db.js';
import { authRouter } from './routes/auth.js';
import { postsRouter } from './routes/posts.js';
import { danmakuRouter } from './routes/danmaku.js';
import { musicRouter } from './routes/music.js';
import { rankingRouter } from './routes/ranking.js';
import { uploadRouter } from './routes/uploads.js';
import { adminRouter } from './routes/admin.js';
import { messagesRouter, messageActionsRouter } from './routes/messages.js';
import { notificationsRouter } from './routes/notifications.js';
import { apiRateLimit, logAuthEvent, securityHeaders } from './lib/secure.js';
import { attachUser, ensureAdminAccount } from './lib/auth.js';
import { publicSiteConfig } from './lib/site.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = Number(process.env.PORT || 8787);
const WEB_DIST = path.resolve(__dirname, '../../web/dist');

app.disable('x-powered-by');

/* 安全响应头 + 源码/映射/数据库等敏感路径屏蔽（必须在任何静态服务之前） */
app.use(securityHeaders);

/* 仅允许白名单来源跨域；未配置时等同「只允许同源」，第三方站点无法代打接口 */
const ALLOWED_ORIGINS = String(process.env.XSZ_CORS_ORIGINS || '')
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean);

app.use(
  cors(
    ALLOWED_ORIGINS.length
      ? {
          origin: ALLOWED_ORIGINS,
          credentials: true,
          methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
          allowedHeaders: ['Content-Type', 'Authorization', 'X-Xsz-Enc', 'X-Xsz-Sid', 'X-Xsz-Ts', 'X-Xsz-Nonce'],
          exposedHeaders: ['X-Xsz-Enc', 'Retry-After'],
          maxAge: 600,
        }
      : false
  )
);

/* 请求体上限收紧，配合限流降低放大攻击与解析开销 */
app.use(express.json({ limit: '256kb' }));
app.use(express.urlencoded({ extended: false, limit: '64kb' }));

/* 全站 API 粗粒度限流：拖慢扫描与脚本化尝试 */
app.use('/api', apiRateLimit());

/* 公共接口也尝试解析登录态（失败即视为游客），用于点赞状态、可见范围等判定 */
app.use('/api', attachUser);

/* 路由 */
app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'xsz', time: new Date().toISOString() }));
app.get('/api/site-config', (_req, res) => res.json({ config: publicSiteConfig() }));

app.use('/api/auth', authRouter);
app.use('/api/posts/:postId/messages', messagesRouter);
app.use('/api/messages', messageActionsRouter);
app.use('/api/posts', postsRouter);
app.use('/api/danmaku', danmakuRouter);
app.use('/api/music', musicRouter);
app.use('/api/ranking', rankingRouter);
app.use('/api/notifications', notificationsRouter);
app.use('/api/uploads', uploadRouter);
app.use('/api/admin', adminRouter);

/* 未匹配的 API 一律返回 JSON 404，不落到前端兜底页，避免暴露路由探测信息 */
app.use('/api', (req, res) => {
  logAuthEvent({ req, kind: 'api.unknown', detail: { path: req.originalUrl.slice(0, 200) } });
  res.status(404).json({ error: '接口不存在' });
});

/* 静态资源：用户上传（图片/音频），目录本身不提供索引 */
app.use('/uploads', express.static(UPLOAD_DIR, { index: false, dotfiles: 'deny', maxAge: '7d' }));

/* 前端构建产物（已压缩混淆，不含 sourcemap；.map 等敏感扩展名已被前置拦截） */
app.use(express.static(WEB_DIST, { index: false, dotfiles: 'deny', maxAge: '1h' }));
app.get(/^(?!\/api|\/uploads).*/, (_req, res, next) => {
  res.sendFile(path.join(WEB_DIST, 'index.html'), (error) => {
    if (error) next(error);
  });
});

/* 统一错误处理：对外只给结论，不回传堆栈与内部实现细节 */
app.use((err, req, res, _next) => {
  const status = Number(err?.status || err?.statusCode) || 500;
  if (status >= 500) console.error('[server]', err);
  const payload = { error: status >= 500 ? '服务内部错误' : err?.message || '请求失败' };
  if (err?.retryAfter) payload.retryAfter = err.retryAfter;
  if (err?.type === 'entity.too.large') payload.error = '请求内容过大';
  res.status(status).json(payload);
});

/* 启动时确保管理员账号存在且口令符合当前策略 */
try {
  const state = ensureAdminAccount();
  if (state.action !== 'exists') console.log(`[server] 管理员账号已就绪：${state.username}（${state.action}）`);
} catch (error) {
  console.error('[server] 管理员账号初始化失败', error.message);
}

app.listen(PORT, () => {
  console.log(`XinShiZhan 服务端已启动: http://localhost:${PORT}`);
});
