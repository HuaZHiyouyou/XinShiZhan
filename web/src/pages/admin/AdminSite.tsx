import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Ghost, Inbox, Info, KeyRound, LifeBuoy, Lock, Mail, Megaphone, Save, ShieldAlert, ShieldCheck, Smartphone, UserCheck, UserRound, X } from 'lucide-react';
import { api, ApiError } from '@/api/client';
import type {
  AdminSecurity,
  AdminSiteConfig,
  AuthEventItem,
  AuthLockItem,
  GuestLoginItem,
  RecoverySettings,
  SecurityPolicy,
  VerificationSettings,
} from '@/api/types';
import { Avatar } from '@/components/common/Avatar';
import { Empty, SkeletonList } from '@/components/common/Empty';
import { formatDateTime, relativeTime } from '@/lib/format';
import { useAuth } from '@/store/auth';
import { useSite } from '@/store/site';
import { useUi } from '@/store/ui';

function Toggle({
  checked,
  onChange,
  label,
  desc,
  disabled,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  desc: string;
  disabled?: boolean;
}) {
  return (
    <label className="rule-toggle" data-disabled={disabled}>
      <span className="grow">
        <span className="rule-label">{label}</span>
        <span className="rule-desc">{desc}</span>
      </span>
      <input
        type="checkbox"
        className="switch"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        disabled={disabled}
      />
    </label>
  );
}

const GUEST_LIMIT = 10;

/** 安全策略可调项：范围与服务端 normalizeSecurity 完全一致，越界会被服务端夹回 */
const SECURITY_FIELDS: { key: keyof SecurityPolicy; label: string; min: number; max: number; unit: string }[] = [
  { key: 'powBaseBits', label: '工作量证明基础难度', min: 4, max: 20, unit: '比特' },
  { key: 'powMaxBits', label: '失败后最高难度', min: 4, max: 24, unit: '比特' },
  { key: 'loginWindowMinutes', label: '登录失败统计窗口', min: 1, max: 1440, unit: '分钟' },
  { key: 'loginMaxFailPerUser', label: '同一账号允许失败', min: 1, max: 100, unit: '次' },
  { key: 'loginMaxPerIp', label: '同一 IP 允许失败', min: 1, max: 500, unit: '次' },
  { key: 'lockMinutes', label: '触发锁定后的时长', min: 1, max: 1440, unit: '分钟' },
  { key: 'lockMaxMinutes', label: '锁定时间上限', min: 5, max: 10080, unit: '分钟' },
  { key: 'sessionTtlMinutes', label: '登录态有效期', min: 5, max: 4320, unit: '分钟' },
  { key: 'apiWindowMinutes', label: '全站接口限流窗口', min: 1, max: 1440, unit: '分钟' },
  { key: 'apiMaxPerIp', label: '每 IP 接口调用上限', min: 10, max: 100000, unit: '次' },
  { key: 'minPasswordLength', label: '注册密码最小长度', min: 6, max: 64, unit: '位' },
  { key: 'registerMaxPerIp', label: '每 IP 每 10 分钟最多注册', min: 1, max: 1000, unit: '次' },
  { key: 'handshakeMaxPerIp', label: '每 IP 每 10 分钟最多握手', min: 5, max: 5000, unit: '次' },
  { key: 'challengeMaxPerIp', label: '每 IP 每 10 分钟最多取校验', min: 5, max: 10000, unit: '次' },
  { key: 'recoverMaxPerIp', label: '每 IP 每 10 分钟最多找回申请', min: 1, max: 1000, unit: '次' },
];

const EVENT_KIND_LABELS: Record<string, string> = {
  handshake: '建立加密通道',
  'login.ok': '登录成功',
  'login.fail': '登录失败',
  'login.banned': '封禁账号尝试登录',
  'register.ok': '注册成功',
  'register.fail': '注册失败',
  'guest.ok': '访客进入',
  logout: '退出登录',
  profile: '修改资料',
  honeypot: '蜜罐命中（疑似机器人）',
  'pow.fail': '工作量证明未通过',
  'rate.limit': '触发限流',
  'envelope.fail': '信封校验失败',
  'channel.missing': '缺少加密通道',
  'source.probe': '源码探测',
  'api.unknown': '未知接口探测',
};

function eventLabel(kind: string) {
  return EVENT_KIND_LABELS[kind] || kind;
}

export function AdminSite() {
  const me = useAuth((s) => s.user);
  const notify = useUi((s) => s.notify);
  const loadSite = useSite((s) => s.load);
  /* 站点级开关只有超级管理员能改，普通管理员只能查看 */
  const isAdmin = me?.role === 'superadmin';

  const [config, setConfig] = useState<AdminSiteConfig | null>(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  const [guests, setGuests] = useState<GuestLoginItem[]>([]);
  const [guestTotal, setGuestTotal] = useState(0);
  const [guestPage, setGuestPage] = useState(1);
  const [guestsLoading, setGuestsLoading] = useState(true);

  const [security, setSecurity] = useState<AdminSecurity | null>(null);
  const [securityLoading, setSecurityLoading] = useState(true);
  const [unlocking, setUnlocking] = useState<number | null>(null);

  const loadSecurity = useCallback(async () => {
    try {
      setSecurity(await api.admin.security(60));
    } catch (error) {
      notify(error instanceof ApiError ? error.message : '安全事件加载失败', 'danger');
    } finally {
      setSecurityLoading(false);
    }
  }, [notify]);

  useEffect(() => {
    let alive = true;
    api.admin
      .siteConfig()
      .then(({ config: data }) => {
        if (alive) setConfig(data);
      })
      .catch((error: unknown) => {
        if (alive) notify(error instanceof ApiError ? error.message : '站点配置加载失败', 'danger');
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    loadSecurity();
    return () => {
      alive = false;
    };
  }, [notify, loadSecurity]);

  useEffect(() => {
    let alive = true;
    setGuestsLoading(true);
    api.admin
      .guests({ page: guestPage, limit: GUEST_LIMIT })
      .then(({ guests: rows, total }) => {
        if (!alive) return;
        setGuests(rows);
        setGuestTotal(total);
      })
      .catch((error: unknown) => {
        if (alive) notify(error instanceof ApiError ? error.message : '访客记录加载失败', 'danger');
      })
      .finally(() => {
        if (alive) setGuestsLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [guestPage, notify]);

  if (loading || !config) return <SkeletonList rows={4} body={2} />;

  const patch = (next: Partial<AdminSiteConfig>) => setConfig({ ...config, ...next });

  const patchSecurity = (next: Partial<SecurityPolicy>) =>
    setConfig({ ...config, security: { ...config.security, ...next } });

  const patchVerification = (next: Partial<VerificationSettings>) =>
    setConfig({ ...config, verification: { ...config.verification, ...next } });

  const patchRecovery = (next: Partial<RecoverySettings>) =>
    setConfig({ ...config, recovery: { ...config.recovery, ...next } });

  const unlock = async (item: AuthLockItem) => {
    setUnlocking(item.id);
    try {
      await api.admin.unlock(item.id);
      notify(`已解除对 ${item.key} 的锁定`, 'success');
      await loadSecurity();
    } catch (error) {
      notify(error instanceof ApiError ? error.message : '解锁失败', 'danger');
    } finally {
      setUnlocking(null);
    }
  };

  const save = async () => {
    setSaving(true);
    try {
      const { config: saved } = await api.admin.saveSiteConfig(config);
      setConfig(saved);
      /* 立刻把公开配置同步到前端缓存：注册页/登录弹窗/找回入口无需刷新页面即可生效 */
      await loadSite();
      notify('站点配置已保存并立即生效', 'success');
    } catch (error) {
      notify(error instanceof ApiError ? error.message : '保存失败', 'danger');
    } finally {
      setSaving(false);
    }
  };

  const guestPages = Math.max(1, Math.ceil(guestTotal / GUEST_LIMIT));

  return (
    <div className="stack">
      {!isAdmin && (
        <div className="card card-pad read-only-note">
          <Info size={15} />
          审核员可以查看站点配置与记录，但只有管理员能修改。
        </div>
      )}

      <section className="card">
        <div className="card-head">
          <div className="card-title">
            <Lock size={15} />
            访问与安全
            <span className="card-sub">注册、访客与头像审核的总开关，保存后立即生效</span>
          </div>
          <button type="button" className="btn btn-sm btn-primary" onClick={save} disabled={!isAdmin || saving}>
            <Save size={13} />
            {saving ? '保存中…' : '保存配置'}
          </button>
        </div>

        <div className="card-pad stack">
          <Toggle
            checked={config.allowRegister}
            onChange={(v) => patch({ allowRegister: v })}
            label="开放新用户注册"
            desc="关闭后注册接口与注册入口都会隐藏，已有账号不受影响"
            disabled={!isAdmin}
          />
          <Toggle
            checked={config.allowGuestLogin}
            onChange={(v) => patch({ allowGuestLogin: v })}
            label="开放访客登录"
            desc="允许游客一键创建访客账号；访客账号固定为只读（可浏览，不能发言或改资料），每次进入都会记录 IP 与设备留痕"
            disabled={!isAdmin}
          />
          <Toggle
            checked={config.avatarNeedsReview}
            onChange={(v) => patch({ avatarNeedsReview: v })}
            label="头像先审后显"
            desc="开启后用户上传的新头像需管理员通过才会全站生效"
            disabled={!isAdmin}
          />

          <div className="field-row">
            <label className="field">
              <span className="field-label">每 IP 每小时访客上限</span>
              <input
                className="input"
                type="number"
                min={1}
                max={100}
                disabled={!isAdmin}
                value={config.guestHourlyLimitPerIp}
                onChange={(e) => patch({ guestHourlyLimitPerIp: Number(e.target.value) })}
              />
            </label>
            <label className="field" style={{ flex: 2 }}>
              <span className="field-label">
                <Megaphone size={12} /> 站点公告（留空则不展示，最多 200 字）
              </span>
              <textarea
                className="textarea"
                rows={2}
                maxLength={200}
                disabled={!isAdmin}
                value={config.announcement}
                onChange={(e) => patch({ announcement: e.target.value })}
                placeholder="例如：本周六晚八点点歌专场，欢迎来心事广场坐坐"
              />
            </label>
          </div>
        </div>
      </section>

      <section className="card">
        <div className="card-head">
          <div className="card-title">
            <UserCheck size={15} />
            身份验证（预留）
            <span className="card-sub">
              邮箱、手机号与实名验证的开放开关，默认全部关闭，只有超级管理员能开启
            </span>
          </div>
          <button type="button" className="btn btn-sm btn-primary" onClick={save} disabled={!isAdmin || saving}>
            <Save size={13} />
            {saving ? '保存中…' : '保存配置'}
          </button>
        </div>

        <div className="card-pad stack">
          <div className="read-only-note">
            <Info size={15} />
            <div className="grow">
              这三项能力已完成数据结构与接口预留，但真实的验证码下发 / 实名核验通道尚未接入。
              开关全部关闭时用户无法填写与修改；开启后用户可在「个人信息」中填写，
              暂时由超级管理员在用户管理里人工核验。
            </div>
          </div>

          <div className="stack" style={{ gap: 'var(--sp-3)' }}>
            <div className="card-sub">邮箱验证</div>
            <Toggle
              checked={config.verification.emailEnabled}
              onChange={(v) => patchVerification({ emailEnabled: v, emailRequired: v ? config.verification.emailRequired : false })}
              label="开放邮箱填写与验证"
              desc="开启后注册页与个人信息页会出现邮箱输入与「发送验证」入口"
              disabled={!isAdmin}
            />
            <Toggle
              checked={config.verification.emailRequired}
              onChange={(v) => patchVerification({ emailRequired: v })}
              label="注册时强制填写邮箱"
              desc="仅在邮箱验证已开启时可用"
              disabled={!isAdmin || !config.verification.emailEnabled}
            />
          </div>

          <div className="stack" style={{ gap: 'var(--sp-3)' }}>
            <div className="card-sub">
              <Smartphone size={13} /> 手机号验证
            </div>
            <Toggle
              checked={config.verification.phoneEnabled}
              onChange={(v) => patchVerification({ phoneEnabled: v, phoneRequired: v ? config.verification.phoneRequired : false })}
              label="开放手机号填写与验证"
              desc="开启后注册页与个人信息页会出现手机号输入与「发送验证」入口"
              disabled={!isAdmin}
            />
            <Toggle
              checked={config.verification.phoneRequired}
              onChange={(v) => patchVerification({ phoneRequired: v })}
              label="注册时强制填写手机号"
              desc="仅在手机号验证已开启时可用"
              disabled={!isAdmin || !config.verification.phoneEnabled}
            />
          </div>

          <div className="stack" style={{ gap: 'var(--sp-3)' }}>
            <div className="card-sub">实名认证</div>
            <Toggle
              checked={config.verification.realNameEnabled}
              onChange={(v) =>
                patchVerification({ realNameEnabled: v, realNameRequired: v ? config.verification.realNameRequired : false })
              }
              label="开放实名信息填写"
              desc="开启后用户可在个人信息中填写姓名与证件号，资料加密存储"
              disabled={!isAdmin}
            />
            <Toggle
              checked={config.verification.realNameRequired}
              onChange={(v) => patchVerification({ realNameRequired: v })}
              label="强制完成实名信息"
              desc="仅在实名认证已开启时可用"
              disabled={!isAdmin || !config.verification.realNameEnabled}
            />
          </div>
        </div>
      </section>

      <section className="card">
        <div className="card-head">
          <div className="card-title">
            <LifeBuoy size={15} />
            找回密码渠道
            <span className="card-sub">用户忘记密码时的联系方式，邮箱与密保为预留能力</span>
          </div>
          <button type="button" className="btn btn-sm btn-primary" onClick={save} disabled={!isAdmin || saving}>
            <Save size={13} />
            {saving ? '保存中…' : '保存配置'}
          </button>
        </div>

        <div className="card-pad stack">
          <div className="read-only-note">
            <Info size={15} />
            <div className="grow">
              四种渠道都接在登录页的「忘记密码」入口上：开关关闭、联系方式留空、或通道未接入时，
              用户端会直接看到对应的状态标签并且点不动，不会出现「点了没反应」。
            </div>
          </div>

          <div className="stack" style={{ gap: 'var(--sp-3)' }}>
            <div className="card-sub">
              <Mail size={13} /> 邮箱找回（预留）
            </div>
            <Toggle
              checked={config.recovery.emailEnabled}
              onChange={(v) => patchRecovery({ emailEnabled: v })}
              label="开放邮箱自助找回"
              desc="通道尚未接入，开启后用户可发起申请并由管理员人工核实"
              disabled={!isAdmin}
            />
          </div>

          <div className="stack" style={{ gap: 'var(--sp-3)' }}>
            <div className="card-sub">
              <LifeBuoy size={13} /> 站内客服
            </div>
            <Toggle
              checked={config.recovery.serviceEnabled}
              onChange={(v) => patchRecovery({ serviceEnabled: v })}
              label="开放站内客服找回"
              desc="必须同时填写客服账号，否则用户端会显示「未配置」且不可点击"
              disabled={!isAdmin}
            />
          </div>

          <div className="stack" style={{ gap: 'var(--sp-3)' }}>
            <div className="card-sub">
              <UserRound size={13} /> 站长求助
            </div>
            <Toggle
              checked={config.recovery.masterEnabled}
              onChange={(v) => patchRecovery({ masterEnabled: v })}
              label="开放站长求助"
              desc="用户提交后会立刻站内通知你并进入审批台；联系方式可选填，填了就多给用户一条路"
              disabled={!isAdmin}
            />
          </div>

          <div className="stack" style={{ gap: 'var(--sp-3)' }}>
            <div className="card-sub">
              <KeyRound size={13} /> 密保找回（预留）
            </div>
            <Toggle
              checked={config.recovery.securityEnabled}
              onChange={(v) => patchRecovery({ securityEnabled: v })}
              label="开放密保找回"
              desc="密保问题尚未开放设置与校验"
              disabled={!isAdmin}
            />
          </div>

          <div className="profile-form-grid">
            <label className="field">
              <span className="field-label">
                站内客服账号
                <span className="faint" style={{ marginLeft: 6, fontSize: 11 }}>必填，否则用户端不可点</span>
              </span>
              <input
                className="input"
                value={config.recovery.serviceAccount}
                maxLength={40}
                onChange={(e) => patchRecovery({ serviceAccount: e.target.value })}
                placeholder="例如：support"
                disabled={!isAdmin}
              />
            </label>
            <label className="field">
              <span className="field-label">
                站长联系方式
                <span className="faint" style={{ marginLeft: 6, fontSize: 11 }}>选填</span>
              </span>
              <input
                className="input"
                value={config.recovery.masterContact}
                maxLength={120}
                onChange={(e) => patchRecovery({ masterContact: e.target.value })}
                placeholder="例如：master@example.com"
                disabled={!isAdmin}
              />
            </label>
            <label className="field">
              <span className="field-label">客服说明（留空使用默认文案）</span>
              <input
                className="input"
                value={config.recovery.serviceHint}
                maxLength={120}
                onChange={(e) => patchRecovery({ serviceHint: e.target.value })}
                disabled={!isAdmin}
              />
            </label>
            <label className="field">
              <span className="field-label">站长说明（留空使用默认文案）</span>
              <input
                className="input"
                value={config.recovery.masterHint}
                maxLength={120}
                onChange={(e) => patchRecovery({ masterHint: e.target.value })}
                disabled={!isAdmin}
              />
            </label>
          </div>
        </div>
      </section>

      <section className="card">
        <div className="card-head">
          <div className="card-title">
            <KeyRound size={15} />
            认证与接口安全
            <span className="card-sub">加密通道、工作量证明与锁定阈值，保存后立即生效</span>
          </div>
          <button type="button" className="btn btn-sm btn-primary" onClick={save} disabled={!isAdmin || saving}>
            <Save size={13} />
            {saving ? '保存中…' : '保存配置'}
          </button>
        </div>

        <div className="card-pad stack">
          <Toggle
            checked={config.security.enforceEncryptedChannel}
            onChange={(v) => patchSecurity({ enforceEncryptedChannel: v })}
            label="强制加密通道"
            desc="关闭后认证与后台接口将退回明文 JSON，抓包即可看到全部字段，仅在排障时临时使用"
            disabled={!isAdmin}
          />
          <Toggle
            checked={config.security.powEnabled}
            onChange={(v) => patchSecurity({ powEnabled: v })}
            label="启用工作量证明"
            desc="登录/注册前需先在浏览器完成一次哈希计算，失败越多难度越高，可显著拖慢脚本爆破"
            disabled={!isAdmin}
          />

          <div className="field-row" style={{ flexWrap: 'wrap' }}>
            {SECURITY_FIELDS.map((field) => (
              <label className="field" key={field.key} style={{ flex: '1 1 160px' }}>
                <span className="field-label">
                  {field.label}
                  <span className="faint" style={{ marginLeft: 4 }}>
                    （{field.unit}）
                  </span>
                </span>
                <input
                  className="input"
                  type="number"
                  min={field.min}
                  max={field.max}
                  disabled={!isAdmin}
                  value={config.security[field.key] as number}
                  onChange={(e) => patchSecurity({ [field.key]: Number(e.target.value) } as Partial<SecurityPolicy>)}
                />
              </label>
            ))}
          </div>

          <p className="muted" style={{ fontSize: 12, margin: 0 }}>
            说明：这些阈值只存在于服务端，不会出现在前端产物或公开接口中；管理员账号口令由服务端环境变量决定，
            不随前端下发，因此改这里不会影响到你当前的登录。
          </p>
        </div>
      </section>

      <section className="card">
        <div className="card-head">
          <div className="card-title">
            <ShieldAlert size={15} />
            安全事件与锁定
            <span className="card-sub">
              {security
                ? `通道 ${security.channel.sessions} 个 · 挑战 ${security.channel.challenges} 条 · 你的 IP ${security.viewerIp}`
                : '登录失败、蜜罐命中、限流与通道异常都会记录在这里'}
            </span>
          </div>
          <button type="button" className="btn btn-sm" onClick={loadSecurity} disabled={securityLoading}>
            刷新
          </button>
        </div>

        {securityLoading && !security ? (
          <SkeletonList rows={4} body={1} />
        ) : (
          <div className="card-pad stack" style={{ gap: 'var(--sp-4)' }}>
            {security && security.locks.length > 0 && (
              <div className="stack" style={{ gap: 'var(--sp-2)' }}>
                <div className="card-sub">
                  <ShieldCheck size={13} /> 进行中的锁定（{security.locks.length}）
                </div>
                {security.locks.map((item) => (
                  <div key={item.id} className="row" style={{ gap: 'var(--sp-3)', alignItems: 'center' }}>
                    <span className={`tag ${item.scope === 'ip' ? 'tag-danger' : 'tag-warning'}`}>
                      {item.scope === 'ip' ? 'IP' : '账号'}
                    </span>
                    <span className="mono" style={{ minWidth: 120 }}>
                      {item.key}
                    </span>
                    <span className="grow faint" style={{ fontSize: 12 }}>
                      {item.reason} · 失败 {item.attempts} 次 · 解除于 {formatDateTime(item.until)}
                    </span>
                    <button
                      type="button"
                      className="btn btn-sm"
                      disabled={!isAdmin || unlocking === item.id}
                      onClick={() => unlock(item)}
                    >
                      <X size={13} />
                      解锁
                    </button>
                  </div>
                ))}
              </div>
            )}

            {security && security.events.length > 0 ? (
              <div className="audit-list">
                {security.events.map((item: AuthEventItem) => (
                  <article key={item.id} className="audit-row">
                    <span className="audit-actor">{eventLabel(item.kind)}</span>
                    <span className="faint audit-target mono">{item.username || '匿名'}</span>
                    <span className="grow audit-detail faint mono" title={JSON.stringify(item.detail)}>
                      {item.ip || '未知 IP'}
                      {item.detail && Object.keys(item.detail).length > 0
                        ? ` · ${JSON.stringify(item.detail).slice(0, 90)}`
                        : ''}
                    </span>
                    <span className="faint audit-time" title={formatDateTime(item.createdAt)}>
                      {relativeTime(item.createdAt)}
                    </span>
                  </article>
                ))}
              </div>
            ) : (
              <Empty icon={<ShieldCheck size={26} />} title="暂时没有安全事件" desc="出现失败登录或异常请求时会记录在这里" />
            )}
          </div>
        )}
      </section>

      <section className="card card-pad">
        <div className="read-only-note">
          <ShieldCheck size={15} />
          <div className="grow">
            头像审核、内容审批与找回密码申请已经统一收进「审批台」，这里只保留站点级开关与安全留痕。
          </div>
          <Link className="btn btn-sm" to="/admin/review">
            <Inbox size={13} /> 去审批台
          </Link>
        </div>
      </section>

      <section className="card">
        <div className="card-head">
          <div className="card-title">
            <Ghost size={15} />
            访客登录记录
            <span className="card-sub">共 {guestTotal} 次访客进入，含 IP 与设备留痕</span>
          </div>
          {guestPages > 1 && (
            <div className="row" style={{ gap: 'var(--sp-2)', alignItems: 'center' }}>
              <button
                type="button"
                className="btn btn-sm"
                disabled={guestPage <= 1 || guestsLoading}
                onClick={() => setGuestPage((p) => Math.max(1, p - 1))}
              >
                上一页
              </button>
              <span className="faint mono">
                {guestPage} / {guestPages}
              </span>
              <button
                type="button"
                className="btn btn-sm"
                disabled={guestPage >= guestPages || guestsLoading}
                onClick={() => setGuestPage((p) => Math.min(guestPages, p + 1))}
              >
                下一页
              </button>
            </div>
          )}
        </div>

        {guestsLoading && guests.length === 0 ? (
          <SkeletonList rows={4} body={1} />
        ) : guests.length === 0 ? (
          <Empty icon={<Ghost size={26} />} title="还没有访客进来过" desc="开放访客登录后，这里的每次进入都会留痕" />
        ) : (
          <div className="audit-list">
            {guests.map((item) => (
              <article key={item.id} className="audit-row">
                <Avatar name={item.anonName} color={item.anonColor} size="sm" />
                <span className="audit-actor">{item.anonName}</span>
                <span className="faint audit-target mono">{item.username}</span>
                <span className={item.userStatus === 'active' ? 'tag tag-success' : 'tag tag-danger'}>
                  {item.userStatus === 'active' ? '正常' : item.userStatus === 'banned' ? '已封禁' : item.userStatus}
                </span>
                <span className="grow audit-detail faint mono" title={item.userAgent}>
                  IP {item.ip || '未知'} · {item.userAgent ? `${item.userAgent.slice(0, 60)}…` : '未知设备'}
                </span>
                <span className="faint audit-time" title={formatDateTime(item.createdAt)}>
                  {relativeTime(item.createdAt)}
                </span>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
