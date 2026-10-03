import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { allocateUid, db, nowIso, setSetting, DATA_DIR } from './db.js';
import { hashPassword } from './lib/auth.js';
import { anonIdentity, DANMAKU_COLORS } from './lib/anon.js';
import { DEFAULT_RULES, getRules } from './lib/moderation.js';
import { computeLifecycle } from './lib/lifecycle.js';
import { ADMIN_PASSWORD, ADMIN_USERNAME } from './lib/secrets.js';

const force = process.argv.includes('--rebuild');
const existing = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
if (existing > 0 && !force) {
  console.log(`已有 ${existing} 个用户，跳过播种。需要重建请执行 npm run seed -- --rebuild`);
  process.exit(0);
}

if (force) {
  const tables = [
    'audit_logs', 'notifications', 'reports', 'likes', 'danmaku',
    'messages', 'posts', 'bans', 'users', 'music_tracks', 'settings',
    'auth_events', 'auth_locks', 'sessions', 'guest_logins',
  ];
  db.exec('PRAGMA foreign_keys = OFF;');
  tables.forEach((table) => db.exec(`DELETE FROM ${table};`));
  db.exec("DELETE FROM sqlite_sequence;");
  db.exec('PRAGMA foreign_keys = ON;');
}

const now = Date.now();
const iso = (offsetMs) => new Date(now + offsetMs).toISOString();
const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;

function createUser(username, password, role, daysAgo) {
  const identity = anonIdentity(username);
  const info = db
    .prepare(
      `INSERT INTO users (uid, username, password_hash, anon_name, anon_color, role, status, created_at, last_login_at, bio)
       VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)`
    )
    .run(
      allocateUid(),
      username,
      hashPassword(password),
      identity.name,
      identity.color,
      role,
      iso(-daysAgo * DAY),
      iso(-HOUR),
      role === 'admin' ? '这里是值班室，有问题随时说。' : ''
    );
  return Number(info.lastInsertRowid);
}

/* 演示账号一律使用随机口令：避免固定弱口令成为后门。
   口令写入 data 目录（不对外提供静态访问），管理员账号口令由服务端常量决定。 */
const randomPassword = (bytes = 12) => crypto.randomBytes(bytes).toString('base64url');
const reviewerPassword = randomPassword(15);
const demoPassword = randomPassword(12);

const admin = createUser(ADMIN_USERNAME, ADMIN_PASSWORD, 'admin', 60);
const reviewer = createUser('reviewer', reviewerPassword, 'reviewer', 45);
const uYue = createUser('yueguang', demoPassword, 'user', 32);
const uChuan = createUser('wangchuan', demoPassword, 'user', 21);
const uTai = createUser('taixi', demoPassword, 'user', 14);
const uJing = createUser('jingmo', demoPassword, 'user', 6);
const uNew = createUser('xinyu', demoPassword, 'user', 1);

// 沉默的大多数：只为让点赞与热度有真实分布
const silentUsers = [
  'haitang', 'lanyu', 'shanhu', 'qiandao', 'wuxian', 'mumian',
  'beian', 'kongming', 'shiguang', 'youyu',
].map((name, index) => createUser(name, demoPassword, 'user', 20 + index * 2));

try {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(DATA_DIR, 'seed-credentials.txt'),
    [
      `生成时间: ${new Date().toISOString()}`,
      `管理员: ${ADMIN_USERNAME}`,
      `审核员: reviewer / ${reviewerPassword}`,
      `演示用户: ${demoPassword}`,
      '提示: 该文件仅存放在服务端 data 目录，请妥善保管或自行修改密码后删除。',
    ].join('\n'),
    { mode: 0o600 }
  );
} catch (error) {
  console.warn('写入播种凭据文件失败：', error.message);
}

const postRows = [
  {
    author: uYue, mood: 'calm', tags: ['深夜', '独处'], hours: 4,
    content: '凌晨三点的便利店，关东煮的蒸汽把玻璃糊住了。我忽然觉得，能一个人安安静静吃完一碗面，也算一种本事。',
  },
  {
    author: uChuan, mood: 'warm', tags: ['陌生人', '治愈'], hours: 9,
    content: '今天在地铁上看到有人抱着一大束向日葵，站在角落里笑得特别小心。希望她的花是送给自己的。',
  },
  {
    author: uTai, mood: 'tired', tags: ['家人', '工作'], hours: 14,
    content: '妈妈打电话来问我吃没吃饭，我说吃了。其实我在加班，桌上是第三杯咖啡。',
  },
  {
    author: uJing, mood: 'hopeful', tags: ['朋友', '城市'], hours: 26,
    content: '搬来这座城市第三年，终于有了一个愿意在周末一起逛菜市场的朋友。原来归属感是从一袋小葱开始的。',
  },
  {
    author: uYue, mood: 'anxious', tags: ['工作', '自我'], hours: 33,
    content: '面试又挂了。第八次。我把简历删了又写，写了又删，最后发现我只是想被谁认可一下。',
    images: ['/uploads/images/seed-1.png'],
  },
  {
    author: uTai, mood: 'calm', tags: ['日常', '治愈'], hours: 40,
    content: '养的多肉长出了新芽，小小的一颗，挤在老叶子中间。我盯着看了很久，久到水烧开了都没听见。',
  },
  {
    author: uChuan, mood: 'lonely', tags: ['独处', '深夜'], hours: 52,
    content: '有些话在心里排练了很多遍，最后说出口的只有「没事」。',
  },
  {
    author: uJing, mood: 'lonely', tags: ['回忆'], hours: 63,
    content: '我把旧手机里的照片导出来了。三年前的我笑得比现在用力，那时候好像什么都不怕。',
    images: ['/uploads/images/seed-2.png'],
  },
  {
    author: uYue, mood: 'hopeful', tags: ['健康', '自我'], hours: 70,
    content: '今天终于把拖了半年的体检做了。报告说一切正常。走出医院的时候阳光很好，我在路边站了五分钟才走。',
  },
  {
    author: uTai, mood: 'lonely', tags: ['日常', '猫'], hours: 78,
    content: '楼下的猫今天没有来。我留的猫粮被雨淋湿了，明天再放一点吧。',
  },
  {
    author: uChuan, mood: 'tired', tags: ['工作', '深夜'], hours: 88,
    content: '凌晨改完最后一版方案，关掉电脑，窗外刚好开始泛白。楼下的早餐摊已经支起来了。',
    images: ['/uploads/images/seed-3.png'],
  },
  {
    author: uJing, mood: 'warm', tags: ['朋友', '和解'], hours: 96,
    content: '和好了。其实谁都没道歉，就是一起吃了顿饭，他把我讨厌的香菜挑走了。',
  },
  {
    author: uYue, mood: 'calm', tags: ['自我', '时间'], hours: 110,
    content: '想给五年前的自己写封信，告诉他别怕，后来都过去了。虽然过程很慢，但真的过去了。',
    images: ['/uploads/images/seed-4.png'],
  },
  {
    author: uTai, mood: 'calm', tags: ['日常', '读书'], hours: 120,
    content: '图书馆四楼靠窗的位置，阳光下午三点会挪到我手背上。这是我每周最期待的三分钟。',
  },
  {
    author: uJing, mood: 'hopeful', tags: ['生日'], hours: 6,
    content: '明天是我生日。我打算给自己买一个小蛋糕，插一根蜡烛，然后认真许一个愿。',
    publishAt: iso(20 * HOUR),
  },
  {
    author: uChuan, mood: 'warm', tags: ['天空', '限时'], hours: 3,
    content: '今天的晚霞很好。这条心事只留二十四小时，看完就去睡吧。',
    images: ['/uploads/images/seed-1.png'],
    expiresAt: iso(DAY),
  },
  {
    author: uNew, mood: 'anxious', tags: ['睡眠'], hours: 5,
    content: '最近总是睡不好，脑子里像有一台关不掉的收音机，一直在放很多年前的歌。',
    reviewStatus: 'manual_review',
    autoFlags: ['新用户内容', '命中敏感词：撑不下去'],
  },
  {
    author: uNew, mood: 'plain', tags: ['引流'], hours: 8,
    content: '加微信代刷，价格优惠，需要的私聊。',
    reviewStatus: 'rejected',
    autoFlags: ['命中黑名单词：加微信', '命中黑名单词：代刷'],
    rejectReason: '命中黑名单词：加微信、代刷',
  },
];

const insertedPosts = [];

postRows.forEach((item) => {
  const createdAt = iso(-item.hours * HOUR);
  const reviewStatus = item.reviewStatus || 'published';
  const visibility = item.visibility || 'public';
  const publishAt = item.publishAt || null;
  const expiresAt = item.expiresAt || null;
  const lifecycle = computeLifecycle({ reviewStatus, publishAt, expiresAt });
  const info = db
    .prepare(
      `INSERT INTO posts
        (author_id, content, mood, tags, images, visibility, review_status, review_mode, reject_reason,
         auto_flags, lifecycle, publish_at, expires_at, like_count, view_count, message_count,
         danmaku_count, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'auto', ?, ?, ?, ?, ?, 0, 0, 0, 0, ?, ?)`
    )
    .run(
      item.author,
      item.content,
      item.mood,
      JSON.stringify(item.tags),
      JSON.stringify(item.images || []),
      visibility,
      reviewStatus,
      item.rejectReason || null,
      JSON.stringify(item.autoFlags || []),
      lifecycle,
      publishAt,
      expiresAt,
      createdAt,
      createdAt
    );
  insertedPosts.push({ id: Number(info.lastInsertRowid), author: item.author, createdAt });
});

// 仅自己可见的心事
const privatePost = db
  .prepare(
    `INSERT INTO posts (author_id, content, mood, tags, images, visibility, review_status, review_mode,
      auto_flags, lifecycle, like_count, view_count, message_count, danmaku_count, created_at, updated_at)
     VALUES (?, ?, 'anxious', '["自我"]', '[]', 'private', 'published', 'auto', '[]', 'live', 0, 0, 0, 0, ?, ?)`
  )
  .run(
    uYue,
    '写下这句话的时候，我还没准备好让别人看到。先放在这里，等哪天有勇气了再公开。',
    iso(-2 * HOUR),
    iso(-2 * HOUR)
  );
insertedPosts.push({ id: Number(privatePost.lastInsertRowid), author: uYue, createdAt: iso(-2 * HOUR) });

const messageTemplates = [
  '看完之后安静了很久。谢谢你把它写下来。',
  '我也经历过类似的夜晚，会过去的，真的。',
  '记得吃饭，也记得早点睡。',
  '你描述的那个画面我也见过，一下子被击中了。',
  '不用急着好起来，慢慢来也可以。',
  '这段话我读了三遍，像有人替我说了出来。',
  '抱一下。虽然隔着屏幕，但是认真的。',
  '希望明天的阳光也照到你手背上。',
  '你已经做得很好了，真的。',
  '同款多肉，同款盯着看半天。',
];

const replyPool = [uYue, uChuan, uTai, uJing, reviewer, admin];
let messageSeed = 0;

insertedPosts
  .filter((post) => post.createdAt > iso(-9 * DAY))
  .forEach((post, index) => {
    const count = 2 + (index % 4);
    for (let i = 0; i < count; i += 1) {
      const author = replyPool[(index + i) % replyPool.length];
      const content = messageTemplates[(index * 3 + i) % messageTemplates.length];
      const base = new Date(post.createdAt).getTime();
      const at = new Date(base + (i + 1) * 47 * 60 * 1000 + (messageSeed % 11) * 60 * 1000).toISOString();
      messageSeed += 1;
      const info = db
        .prepare(
          `INSERT INTO messages (post_id, author_id, parent_id, content, review_status, review_mode, auto_flags, like_count, created_at)
           VALUES (?, ?, NULL, ?, 'published', 'auto', '[]', ?, ?)`
        )
        .run(post.id, author, content, (index + i) % 5, at);

      // 楼主回复，用于区分「楼主」与普通回复者
      if (i === 1 && author !== post.author) {
        db.prepare(
          `INSERT INTO messages (post_id, author_id, parent_id, content, review_status, review_mode, auto_flags, like_count, created_at)
           VALUES (?, ?, ?, ?, 'published', 'auto', '[]', 2, ?)`
        ).run(
          post.id,
          post.author,
          Number(info.lastInsertRowid),
          '谢谢你，看到这条的时候我刚好在喝水，差点呛到。',
          new Date(base + (i + 1) * 47 * 60 * 1000 + 26 * 60 * 1000).toISOString()
        );
      }
    }
  });

// 一条待人工复核的留言
db.prepare(
  `INSERT INTO messages (post_id, author_id, parent_id, content, review_status, review_mode, auto_flags, like_count, created_at)
   VALUES (?, ?, NULL, ?, 'manual_review', 'auto', ?, 0, ?)`
).run(
  insertedPosts[0].id,
  uNew,
  '我最近也撑不下去，感觉每天都在硬扛，不知道跟谁说。',
  JSON.stringify(['命中敏感词：撑不下去', '新用户内容']),
  iso(-1 * HOUR)
);

const danmakuLines = [
  ['今天也辛苦了', 'azure', 'glow', 'scroll'],
  ['晚安，早点睡', 'indigo', 'shimmer', 'scroll'],
  ['会好起来的', 'teal', 'glow', 'scroll'],
  ['记得吃饭', 'sand', 'trace', 'scroll'],
  ['我也一样', 'slate', 'outline', 'scroll'],
  ['抱抱你', 'rose', 'glow', 'bubble'],
  ['别一个人扛', 'sage', 'glow', 'scroll'],
  ['慢慢来也可以', 'azure', 'shimmer', 'scroll'],
  ['谢谢你写下来', 'amber', 'trace', 'scroll'],
  ['我在同一条夜里', 'indigo', 'glow', 'scroll'],
  ['明天有太阳', 'sand', 'glow', 'bubble'],
  ['读完安静了很久', 'teal', 'outline', 'scroll'],
  ['多肉会长大的', 'sage', 'shimmer', 'scroll'],
  ['愿你被好好对待', 'rose', 'glow', 'scroll'],
  ['我把猫粮留着了', 'slate', 'trace', 'bubble'],
  ['窗边的位置真好', 'amber', 'glow', 'scroll'],
  ['面试会过的', 'azure', 'trace', 'scroll'],
  ['蛋糕要买大的', 'sand', 'shimmer', 'scroll'],
  ['晚霞我看到了', 'rose', 'glow', 'scroll'],
  ['深呼吸一下', 'teal', 'glow', 'bubble'],
  ['这条路有人陪着', 'indigo', 'outline', 'scroll'],
  ['谢谢你还在', 'sage', 'glow', 'scroll'],
  ['凌晨的风很轻', 'slate', 'shimmer', 'scroll'],
  ['一切都会过去', 'amber', 'glow', 'scroll'],
];

const danmakuUsers = [uYue, uChuan, uTai, uJing, reviewer, admin, uNew];
danmakuLines.forEach((line, index) => {
  db.prepare(
    `INSERT INTO danmaku (user_id, post_id, content, color, effect, mode, review_status, review_mode, created_at)
     VALUES (?, NULL, ?, ?, ?, ?, 'published', 'auto', ?)`
  ).run(
    danmakuUsers[index % danmakuUsers.length],
    line[0],
    line[1],
    line[2],
    line[3],
    iso(-(danmakuLines.length - index) * 11 * 60 * 1000)
  );
});

// 点赞：让热度榜有可见梯度
const likePool = [uYue, uChuan, uTai, uJing, reviewer, admin, uNew, ...silentUsers];
insertedPosts.forEach((post, index) => {
  const likeCount = Math.min(
    likePool.length - 1,
    Math.max(1, Math.round(22 - index * 1.5 + (index % 3) * 3))
  );
  const viewCount = 40 + index * 9 + (index % 5) * 17;
  for (let i = 0; i < likeCount; i += 1) {
    const user = likePool[i];
    if (user === post.author) continue;
    try {
      db.prepare(
        'INSERT INTO likes (user_id, target_type, target_id, created_at) VALUES (?, ?, ?, ?)'
      ).run(user, 'post', post.id, iso(-(index + 1) * HOUR));
    } catch {
      // 同一用户重复点赞时忽略
    }
  }
  const realLikes = db
    .prepare("SELECT COUNT(*) AS c FROM likes WHERE target_type = 'post' AND target_id = ?")
    .get(post.id).c;
  const realMessages = db
    .prepare("SELECT COUNT(*) AS c FROM messages WHERE post_id = ? AND review_status = 'published'")
    .get(post.id).c;
  db.prepare(
    'UPDATE posts SET like_count = ?, view_count = ?, message_count = ? WHERE id = ?'
  ).run(realLikes, viewCount, realMessages, post.id);
});

db.prepare("UPDATE posts SET pinned = 1 WHERE id = ?").run(insertedPosts[0].id);

const tracks = [
  ['夜航', '心事站电台', '夜航', '/uploads/audio/night-voyage.wav', 48, 1],
  ['苔痕', '心事站电台', '苔痕', '/uploads/audio/moss-trace.wav', 46, 2],
  ['潮汐记事', '心事站电台', '潮汐记事', '/uploads/audio/tide-notes.wav', 50, 3],
];
tracks.forEach(([title, artist, album, url, duration, order]) => {
  db.prepare(
    `INSERT INTO music_tracks (title, artist, album, cover, url, duration, source, uploaded_by, sort_order, enabled, created_at)
     VALUES (?, ?, ?, '', ?, ?, 'builtin', ?, ?, 1, ?)`
  ).run(title, artist, album, url, duration, admin, order, iso(-40 * DAY));
});

db.prepare(
  `INSERT INTO reports (reporter_id, target_type, target_id, reason, detail, status, created_at)
   VALUES (?, 'post', ?, '广告引流', '内容包含加微信与代刷信息', 'open', ?)`
).run(uJing, insertedPosts[17].id, iso(-7 * HOUR));

db.prepare(
  `INSERT INTO reports (reporter_id, target_type, target_id, reason, detail, status, created_at)
   VALUES (?, 'message', ?, '不友善', '语气让人不舒服', 'open', ?)`
).run(uTai, 4, iso(-3 * HOUR));

db.prepare(
  `INSERT INTO notifications (user_id, type, title, body, read, created_at)
   VALUES (?, 'review', '内容已提交人工复核', '复核结果会通过站内信告知。', 0, ?)`
).run(uNew, iso(-5 * HOUR));

db.prepare(
  `INSERT INTO notifications (user_id, type, title, body, read, created_at)
   VALUES (?, 'like', '有人对你的心事产生了共鸣', '', 1, ?)`
).run(uYue, iso(-2 * HOUR));

db.prepare(
  `INSERT INTO audit_logs (actor_id, actor_name, action, target_type, target_id, detail, created_at)
   VALUES (?, 'system', 'review.reject', 'post', ?, ?, ?)`
).run(
  null,
  insertedPosts[17].id,
  JSON.stringify({ reason: '命中黑名单词：加微信、代刷' }),
  iso(-8 * HOUR)
);

db.prepare(
  `INSERT INTO audit_logs (actor_id, actor_name, action, target_type, target_id, detail, created_at)
   VALUES (?, ?, 'danmaku.create', 'danmaku', 1, '{}', ?)`
).run(admin, anonIdentity('admin').name, iso(-30 * 60 * 1000));

if (!getRules()) setSetting('rules', DEFAULT_RULES);

console.log('播种完成：');
console.log(`  用户 ${db.prepare('SELECT COUNT(*) AS c FROM users').get().c} 个（管理员 ${ADMIN_USERNAME}，口令见服务端配置；审核员与演示账号口令已写入 data/seed-credentials.txt）`);
console.log(`  心事 ${db.prepare('SELECT COUNT(*) AS c FROM posts').get().c} 条`);
console.log(`  留言 ${db.prepare('SELECT COUNT(*) AS c FROM messages').get().c} 条`);
console.log(`  弹幕 ${db.prepare('SELECT COUNT(*) AS c FROM danmaku').get().c} 条`);
console.log(`  曲目 ${db.prepare('SELECT COUNT(*) AS c FROM music_tracks').get().c} 首`);
console.log(`  配色方案 ${Object.keys(DANMAKU_COLORS).length} 种 · 播种时间 ${nowIso()}`);