/** superadmin：超级管理员（站点所有者，仅服务端自举指定）；admin：管理员；reviewer：审核员 */
export type Role = 'user' | 'reviewer' | 'admin' | 'superadmin' | 'guest';
export type AvatarStatus = 'none' | 'pending' | 'approved' | 'rejected';
export type ReviewStatus = 'pending' | 'published' | 'manual_review' | 'rejected';
export type Lifecycle = 'draft' | 'scheduled' | 'live' | 'expired';
export type Visibility = 'public' | 'private';
export type DanmakuMode = 'scroll' | 'bubble';
export type DanmakuEffect = 'glow' | 'trace' | 'outline' | 'shimmer';
export type Gender = 'secret' | 'male' | 'female' | 'other';

export interface Author {
  id: number;
  anonName: string;
  anonColor: string;
  avatarUrl?: string;
  role?: Role;
  username?: string;
}

export interface Post {
  id: number;
  content: string;
  mood: string;
  tags: string[];
  images: string[];
  visibility: Visibility;
  reviewStatus: ReviewStatus;
  reviewMode: 'auto' | 'manual';
  rejectReason: string | null;
  autoFlags: string[];
  lifecycle: Lifecycle;
  publishAt: string | null;
  expiresAt: string | null;
  pinned: boolean;
  likeCount: number;
  viewCount: number;
  messageCount: number;
  danmakuCount: number;
  hotScore: number;
  deletedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  reviewedAt: string | null;
  author: Author;
  isAuthor: boolean;
  canView: boolean;
  liked: boolean;
}

export interface PostMessage {
  id: number;
  postId: number;
  parentId: number | null;
  content: string;
  reviewStatus: ReviewStatus;
  rejectReason: string | null;
  likeCount: number;
  createdAt: string;
  liked: boolean;
  isPostAuthor: boolean;
  isStaff: boolean;
  author: Author;
}

export interface DanmakuItem {
  id: number;
  content: string;
  color: string;
  effect: DanmakuEffect;
  mode: DanmakuMode;
  postId: number | null;
  reviewStatus: ReviewStatus;
  createdAt: string;
  author: Author;
}

export interface PaletteEntry {
  label: string;
  hex: string;
}

export interface MusicTrack {
  id: number;
  title: string;
  artist: string;
  album: string;
  cover: string;
  url: string;
  duration: number;
  source: 'builtin' | 'user';
  sortOrder: number;
  enabled: boolean;
  createdAt: string;
  uploadedBy: number | null;
}

export interface NotificationItem {
  id: number;
  type: string;
  title: string;
  body: string;
  read: boolean;
  /** 需要「下次进站弹窗一次」的信：弹过之后服务端就不再下发 */
  popup?: boolean;
  createdAt: string;
}

export interface SessionUser {
  id: number;
  /** 用户编号：注册即分配，全局唯一 */
  uid: number | null;
  username: string;
  anonName: string;
  /** 用户自定义昵称，为空表示仍使用系统分配的匿名身份 */
  nickname: string;
  anonColor: string;
  avatarUrl: string;
  avatarPending?: string;
  avatarStatus?: AvatarStatus;
  isGuest?: boolean;
  role: Role;
  /** 是否为超级管理员：站点级开关（身份验证、找回渠道、内容策略）只有其可改 */
  isSuperAdmin?: boolean;
  status: string;
  violationCount: number;
  bio: string;
  intro: string;
  gender: Gender;
  age: number | null;
  birthday: string | null;
  occupation: string;
  location: string;
  hobbies: string[];
  /* 邮箱 / 手机号 / 实名：预留能力，仅本人可见 */
  email: string;
  phone: string;
  realName: string;
  idNumber: string;
  verified: VerificationState;
  createdAt: string;
  unreadNotifications: number;
  ban: { reason: string; until: string | null } | null;
}

/** 邮箱 / 手机号 / 实名的核验状态 */
export interface VerificationState {
  email: boolean;
  phone: boolean;
  realName: boolean;
}

export interface ProfilePatch {
  bio?: string;
  intro?: string;
  avatarUrl?: string;
  nickname?: string;
  gender?: Gender;
  age?: number | null;
  birthday?: string | null;
  occupation?: string;
  location?: string;
  hobbies?: string[];
  /* 预留字段：仅在站点开关开启时可写 */
  email?: string;
  phone?: string;
  realName?: string;
  idNumber?: string;
}

/** 登录账号与密码修改：敏感字段在通道内二次加密后提交 */
export interface AccountPatch {
  username?: string;
  currentPassword?: string;
  newPassword?: string;
}

export interface RankingItem {
  rank: number;
  id: number;
  content: string;
  mood: string;
  tags: string[];
  likeCount: number;
  messageCount: number;
  danmakuCount: number;
  viewCount: number;
  hotScore: number;
  createdAt: string;
  author: Author;
  liked: boolean;
}

export interface Overview {
  postCount: number;
  userCount: number;
  danmakuCount: number;
  pending: number;
  viewer: string | null;
}

export interface AdminUser {
  id: number;
  uid: number | null;
  username: string;
  nickname: string;
  anonName: string;
  anonColor: string;
  avatarUrl?: string;
  role: Role;
  status: string;
  violationCount: number;
  postCount: number;
  createdAt: string;
  lastLoginAt: string | null;
  /** 注册来源 IP 与最近登录 IP：真实记录，仅超级管理员可见 */
  registerIp: string;
  lastLoginIp: string;
  verified: VerificationState;
  /** 联系方式与实名资料：仅超级管理员可见，审核员拿到 null */
  contact: { email: string; phone: string; realName: string } | null;
  ban: { id: number; reason: string; until: string | null } | null;
}

export interface ReviewItem {
  type: 'post' | 'message' | 'danmaku';
  id: number;
  content: string;
  images?: string[];
  tags?: string[];
  /** 这条内容是不是自己发的：只有超管会看到自己的待审内容 */
  self?: boolean;
  visibility?: Visibility;
  lifecycle?: Lifecycle;
  publishAt?: string | null;
  expiresAt?: string | null;
  postId?: number | null;
  parentId?: number | null;
  autoFlags: string[];
  createdAt: string;
  author: Author;
}

export interface AdminPost {
  id: number;
  content: string;
  images: string[];
  visibility: Visibility;
  reviewStatus: ReviewStatus;
  lifecycle: Lifecycle;
  pinned: boolean;
  likeCount: number;
  messageCount: number;
  danmakuCount: number;
  viewCount: number;
  publishAt: string | null;
  expiresAt: string | null;
  rejectReason: string | null;
  deletedAt?: string | null;
  createdAt: string;
  author: Author;
}

export interface ReviewRules {
  autoReviewEnabled: boolean;
  blockWords: string[];
  softWords: string[];
  linkNeedsReview: boolean;
  newUserNeedsReview: boolean;
  newUserDays: number;
  maxPostsPerHour: number;
  maxMessagesPerHour: number;
  maxDanmakuPerMinute: number;
  duplicateNeedsReview: boolean;
  duplicateThreshold: number;
  autoApproveDanmaku: boolean;
  autoApproveMessages: boolean;
  imageNeedsReview: boolean;
  hotWeights: { like: number; message: number; danmaku: number; view: number };
  hotDecay: number;
}

export interface AdminStats {
  pending: { post: number; message: number; danmaku: number; avatar: number; recovery: number };
  pendingTotal: number;
  publishedToday: number;
  newUsersToday: number;
  bannedUsers: number;
  autoRejectedToday: number;
  openReports: number;
  livePosts: number;
  scheduledPosts: number;
  expiredPosts: number;
  trend: { day: string; posts: number; danmaku: number }[];
}

export interface ReportItem {
  id: number;
  targetType: 'post' | 'message';
  targetId: number;
  reason: string;
  /** 举报人填写的补充描述 */
  detail: string;
  status: string;
  createdAt: string;
  handledAt: string | null;
  /** 处理时写给举报人的说明 */
  handledNote: string;
  excerpt: string;
  /** 举报人或被举报内容是当前操作者自己 */
  self?: boolean;
  owner?: { id: number | null; anonName: string; role: Role };
  reporter: { anonName: string; anonColor: string; uid: number | null; username: string; id?: number };
}

export interface AuditLogItem {
  id: number;
  actorName: string;
  action: string;
  targetType: string;
  targetId: number | null;
  detail: Record<string, unknown>;
  createdAt: string;
}

/** 认证与接口安全策略（仅管理端可见，公开配置里不含任何阈值） */
export interface SecurityPolicy {
  enforceEncryptedChannel: boolean;
  powEnabled: boolean;
  powBaseBits: number;
  powMaxBits: number;
  loginWindowMinutes: number;
  loginMaxFailPerUser: number;
  loginMaxPerIp: number;
  lockMinutes: number;
  lockMaxMinutes: number;
  sessionTtlMinutes: number;
  apiWindowMinutes: number;
  apiMaxPerIp: number;
  minPasswordLength: number;
  /** 认证类接口的独立限流（按 IP，统一 10 分钟窗口） */
  registerMaxPerIp: number;
  handshakeMaxPerIp: number;
  challengeMaxPerIp: number;
  recoverMaxPerIp: number;
}

/**
 * 身份验证预留开关。
 * 邮箱 / 手机号 / 实名验证目前只做能力预留，开关默认全部关闭，
 * 只有超级管理员在后台开启后，用户侧入口才会出现。
 */
export interface VerificationSettings {
  emailEnabled: boolean;
  emailRequired: boolean;
  phoneEnabled: boolean;
  phoneRequired: boolean;
  realNameEnabled: boolean;
  realNameRequired: boolean;
}

/**
 * 找回密码渠道配置。
 * 邮箱与密保为预留能力；站内客服与站长求助是真实可用的联系方式，
 * 由超级管理员在后台填写，留空时前台只展示通用提示。
 */
export interface RecoverySettings {
  /** 邮箱自助找回：预留能力，通道未接入 */
  emailEnabled: boolean;
  /** 站内客服：需要「已开启 + 已配置客服账号」才真正可用 */
  serviceEnabled: boolean;
  /** 站长求助：需要「已开启 + 已配置联系方式」才真正可用 */
  masterEnabled: boolean;
  /** 密保找回：预留能力 */
  securityEnabled: boolean;
  serviceAccount: string;
  serviceHint: string;
  masterContact: string;
  masterHint: string;
}

/** 找回渠道的实时状态：disabled 未开放 / unconfigured 未配置 / reserved 预留 / available 可用 */
export type RecoveryChannelState = 'disabled' | 'unconfigured' | 'reserved' | 'available';

/** 找回密码接口返回的渠道信息 */
export interface RecoveryChannel {
  available: boolean;
  state: RecoveryChannelState;
  label: string;
  hint: string;
  account?: string;
  contact?: string;
}

/** 找回申请提交后的回执 */
export interface RecoveryResult {
  ok: boolean;
  handled: boolean;
  requestId?: number;
  message?: string;
  error?: string;
  channels: Record<string, RecoveryChannel>;
  account?: { uid: number | null; username: string; anonName: string };
}

/** 公开给前端的站点配置（不含管理字段与安全阈值） */
export interface SiteConfig {
  allowRegister: boolean;
  /** 访客账号永远只读（不能发言、不能改资料）——这是产品承诺，不提供开关 */
  allowGuestLogin: boolean;
  announcement: string;
  secureChannel: boolean;
  /** 注册 / 改密的最小密码长度，与后端策略保持一致 */
  minPasswordLength: number;
  verification: VerificationSettings;
  recovery: RecoverySettings;
}

/** 管理端可见/可改的完整站点配置 */
export interface AdminSiteConfig extends SiteConfig {
  avatarNeedsReview: boolean;
  guestHourlyLimitPerIp: number;
  security: SecurityPolicy;
}

export interface AuthLockItem {
  id: number;
  scope: 'ip' | 'user';
  key: string;
  reason: string;
  attempts: number;
  until: string;
  createdAt: string;
}

export interface AuthEventItem {
  id: number;
  ip: string;
  username: string;
  kind: string;
  detail: Record<string, unknown>;
  createdAt: string;
}

export interface ChannelStats {
  sessions: number;
  challenges: number;
  nonces: number;
}

export interface AdminSecurity {
  locks: AuthLockItem[];
  events: AuthEventItem[];
  channel: ChannelStats;
  viewerIp: string;
}

export interface GuestLoginItem {
  id: number;
  userId: number;
  username: string;
  anonName: string;
  anonColor: string;
  ip: string;
  userAgent: string;
  userStatus: string;
  violationCount: number;
  createdAt: string;
}

export interface PendingAvatarItem {
  id: number;
  username: string;
  anonName: string;
  anonColor: string;
  role?: Role;
  avatarUrl: string;
  avatarPending: string;
  avatarStatus: AvatarStatus;
  submittedAt: string | null;
  /** 是不是自己的头像：只有超管会看到自己的，理由选填 */
  self?: boolean;
}

/** 我提交过的找回密码申请：展示在个人信息里，含处理结果与管理员说明 */
export interface MyRecoveryItem {
  id: number;
  method: string;
  label: string;
  status: string;
  /** 提交时的来源 IP，完整回显 */
  ip: string;
  createdAt: string;
  handledAt: string | null;
  handledBy: string;
  handledNote: string;
}

/** 站内回复的人群预览 */
export interface SiteMessageTargets {
  total: number;
  registered: number;
  roles: { role: string; count: number }[];
}

/** 找回密码申请：用户提交后进入审批台统一处理 */
export interface RecoveryRequestItem {
  id: number;
  account: string;
  userId: number | null;
  uid: number | null;
  username: string;
  anonName: string;
  anonColor: string;
  avatarUrl: string;
  userStatus: string;
  method: 'email' | 'service' | 'master' | 'security' | string;
  status: string;
  ip: string;
  userAgent: string;
  createdAt: string;
  handledBy: string;
  handledAt: string | null;
  handledNote: string;
  /** 申请人就是当前操作者：处理时必须写明依据（仅超管走得通） */
  self?: boolean;
}