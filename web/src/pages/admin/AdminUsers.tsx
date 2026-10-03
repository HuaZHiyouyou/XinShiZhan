import { useCallback, useEffect, useState } from 'react';
import { CheckCheck, Copy, KeyRound, Search, ShieldAlert, ShieldCheck, ShieldOff, UserCog } from 'lucide-react';
import { api, ApiError } from '@/api/client';
import type { AdminUser } from '@/api/types';
import { Avatar } from '@/components/common/Avatar';
import { DatePicker } from '@/components/common/DatePicker';
import { Empty, SkeletonList } from '@/components/common/Empty';
import { Modal } from '@/components/common/Modal';
import { Select } from '@/components/common/Select';
import { SelectBox } from '@/components/common/SelectBox';
import { authorityHint, canHandle } from '@/lib/authority';
import { formatDateTime } from '@/lib/format';
import { useBodyScrollLock } from '@/lib/useBodyScrollLock';
import { useAuth } from '@/store/auth';
import { useSite } from '@/store/site';
import { useUi } from '@/store/ui';

const ROLE_LABEL: Record<string, string> = {
  user: '住客',
  reviewer: '审核员',
  admin: '管理员',
  superadmin: '超级管理员',
  guest: '访客',
};

/** 预留的核验项：字段名对应后台人工核验接口，开关名对应站点配置里的验证开关 */
const VERIFY_ITEMS: {
  field: 'emailVerified' | 'phoneVerified' | 'realVerified';
  stateKey: 'email' | 'phone' | 'realName';
  enabledKey: 'emailEnabled' | 'phoneEnabled' | 'realNameEnabled';
  label: string;
}[] = [
  { field: 'emailVerified', stateKey: 'email', enabledKey: 'emailEnabled', label: '邮箱' },
  { field: 'phoneVerified', stateKey: 'phone', enabledKey: 'phoneEnabled', label: '手机号' },
  { field: 'realVerified', stateKey: 'realName', enabledKey: 'realNameEnabled', label: '实名' },
];

const ROLE_FILTER_OPTIONS = [
  { value: '', label: '全部角色' },
  { value: 'user', label: '住客' },
  { value: 'reviewer', label: '审核员' },
  { value: 'admin', label: '管理员' },
  { value: 'superadmin', label: '超级管理员' },
  { value: 'guest', label: '访客' },
];

const STATUS_FILTER_OPTIONS = [
  { value: '', label: '全部状态' },
  { value: 'active', label: '正常' },
  { value: 'banned', label: '已封禁' },
];

const ROLE_OPTIONS = [
  { value: 'user', label: '住客' },
  { value: 'reviewer', label: '审核员' },
  { value: 'admin', label: '管理员' },
];

/**
 * 封禁时长预制：短时 / 长时 / 永久三组，key 与服务端 BAN_PRESETS 一一对应。
 * 选「自定义」时可以再指定具体解封时间。
 */
const BAN_PRESETS: { group: string; items: { key: string; label: string }[] }[] = [
  {
    group: '短时',
    items: [
      { key: '1h', label: '1 小时' },
      { key: '1d', label: '1 天' },
      { key: '3d', label: '3 天' },
    ],
  },
  {
    group: '长时',
    items: [
      { key: '7d', label: '7 天' },
      { key: '30d', label: '30 天' },
      { key: '90d', label: '90 天' },
    ],
  },
  { group: '永久', items: [{ key: 'forever', label: '永久封禁' }] },
];

const BAN_PRESET_LABEL: Record<string, string> = Object.fromEntries(
  BAN_PRESETS.flatMap((group) => group.items.map((item) => [item.key, item.label]))
);

/** 常见封禁原因，点一下就能填，也允许自己写 */
const BAN_REASONS = ['发布广告引流内容', '人身攻击或辱骂', '发布违法违规内容', '恶意刷屏', '冒充他人身份'];

export function AdminUsers() {
  const me = useAuth((s) => s.user);
  const notify = useUi((s) => s.notify);
  const verification = useSite((s) => s.config.verification);

  const [q, setQ] = useState('');
  const [role, setRole] = useState('');
  const [status, setStatus] = useState('');
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [banTarget, setBanTarget] = useState<AdminUser | null>(null);
  const [banReason, setBanReason] = useState('');
  const [banPreset, setBanPreset] = useState('7d');
  const [banUntil, setBanUntil] = useState('');
  const [busy, setBusy] = useState(false);
  const [issued, setIssued] = useState<{ username: string; tempPassword: string } | null>(null);
  /* 批量选择：封禁弹窗的「批量」与「单条」共用，用 batchBan 区分 */
  const [selected, setSelected] = useState<number[]>([]);
  const [batchBan, setBatchBan] = useState(false);

  const limit = 20;
  /* 任何弹窗打开时都锁住页面滚动，避免背景被滑走 */
  useBodyScrollLock(Boolean(banTarget) || Boolean(issued) || batchBan);
  /* 超级管理员：可改角色、做人工核验；管理员：只能封禁普通账号 */
  const isSuperAdmin = me?.role === 'superadmin';
  const canBan = me?.role === 'admin' || isSuperAdmin;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.admin.users({
        q: q || undefined,
        role: role || undefined,
        status: status || undefined,
        page,
        limit,
      });
      setUsers(data.users);
      setTotal(data.total);
      setSelected([]);
    } catch (error) {
      notify(error instanceof ApiError ? error.message : '加载失败', 'danger');
      setUsers([]);
    } finally {
      setLoading(false);
    }
  }, [q, role, status, page, notify]);

  useEffect(() => {
    load();
  }, [load]);

  const resetBanForm = () => {
    setBanTarget(null);
    setBatchBan(false);
    setBanReason('');
    setBanUntil('');
    setBanPreset('7d');
  };

  const submitBan = async () => {
    if (!banTarget && !batchBan) return;
    if (banPreset === 'custom' && !banUntil) {
      notify('请选择具体的解封时间', 'warning');
      return;
    }
    setBusy(true);
    const until = banUntil ? new Date(banUntil).toISOString() : null;
    try {
      if (batchBan) {
        const result = await api.admin.usersBatch(selected, 'ban', {
          reason: banReason.trim(),
          until,
          preset: banPreset,
        });
        const skipped = result.blocked?.length || 0;
        notify(
          skipped
            ? `已封禁 ${result.done} 个账号，${skipped} 个越权或不可封禁`
            : `已封禁 ${result.done} 个账号（${banPreset === 'forever' ? '永久' : BAN_PRESET_LABEL[banPreset] || '自定义时间'}）`,
          skipped ? 'warning' : 'success'
        );
      } else {
        await api.admin.ban(banTarget!.id, banReason.trim(), until, banPreset);
        notify(
          banPreset === 'forever' ? '已永久封禁该账号' : `已封禁该账号（${BAN_PRESET_LABEL[banPreset] || '自定义时间'}）`,
          'success'
        );
      }
      resetBanForm();
      await load();
    } catch (error) {
      notify(error instanceof ApiError ? error.message : '封禁失败', 'danger');
    } finally {
      setBusy(false);
    }
  };

  const toggle = (id: number) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((v) => v !== id) : [...prev, id]));

  /** 批量封禁：与单条共用同一个弹窗（原因 + 时长对整批生效） */
  const openBatchBan = () => {
    if (!selected.length) return;
    setBanReason('');
    setBanUntil('');
    setBanPreset('7d');
    setBatchBan(true);
  };

  const batchUnban = async () => {
    if (!selected.length) return;
    setBusy(true);
    try {
      const result = await api.admin.usersBatch(selected, 'unban');
      const skipped = result.blocked?.length || 0;
      notify(
        skipped ? `已解封 ${result.done} 个账号，${skipped} 个越权未处理` : `已解封 ${result.done} 个账号`,
        skipped ? 'warning' : 'success'
      );
      await load();
    } catch (error) {
      notify(error instanceof ApiError ? error.message : '批量解封失败', 'danger');
    } finally {
      setBusy(false);
    }
  };

  /** 管理员协助重置口令：生成的临时密码只显示一次 */
  const resetPassword = async (target: AdminUser) => {
    setBusy(true);
    try {
      const result = await api.admin.resetPassword(target.id);
      setIssued({ username: result.username, tempPassword: result.tempPassword });
      await load();
    } catch (error) {
      notify(error instanceof ApiError ? error.message : '重置失败', 'danger');
    } finally {
      setBusy(false);
    }
  };

  const copyText = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      notify('临时密码已复制', 'success');
    } catch {
      notify('复制失败，请手动选中复制', 'warning');
    }
  };

  const unban = async (target: AdminUser) => {
    try {
      await api.admin.unban(target.id);
      notify('已解封', 'success');
      await load();
    } catch (error) {
      notify(error instanceof ApiError ? error.message : '解封失败', 'danger');
    }
  };

  /** 人工核验：仅超级管理员，且对应验证开关需已在后台开启 */
  const toggleVerified = async (target: AdminUser, item: (typeof VERIFY_ITEMS)[number]) => {
    try {
      await api.admin.verifyUser(target.id, { [item.field]: !target.verified[item.stateKey] });
      notify(`已更新 ${target.anonName} 的${item.label}核验状态`, 'success');
      await load();
    } catch (error) {
      notify(error instanceof ApiError ? error.message : '核验状态更新失败', 'danger');
    }
  };

  const changeRole = async (target: AdminUser, nextRole: string) => {
    try {
      await api.admin.setRole(target.id, nextRole);
      notify('角色已更新', 'success');
      await load();
    } catch (error) {
      notify(error instanceof ApiError ? error.message : '修改失败', 'danger');
    }
  };

  const pages = Math.max(1, Math.ceil(total / limit));

  return (
    <div className="stack">
      <div className="card">
        <div className="card-head review-head">
          <div className="row" style={{ gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
            <div className="input-affix admin-search">
              <Search size={14} />
              <input
                className="input"
                value={q}
                onChange={(e) => {
                  setQ(e.target.value);
                  setPage(1);
                }}
                placeholder="搜索用户名、昵称或 UID"
              />
            </div>
            <Select
              className="admin-select"
              size="sm"
              value={role}
              options={ROLE_FILTER_OPTIONS}
              ariaLabel="按角色筛选"
              onChange={(next) => {
                setRole(next);
                setPage(1);
              }}
            />
            <Select
              className="admin-select"
              size="sm"
              value={status}
              options={STATUS_FILTER_OPTIONS}
              ariaLabel="按账号状态筛选"
              onChange={(next) => {
                setStatus(next);
                setPage(1);
              }}
            />
          </div>
          <span className="hint">共 {total} 人</span>
        </div>

        {canBan && !loading && users.length > 0 && (
          <div className="batch-bar">
            <span className="batch-count">已选 {selected.length} 个账号</span>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => setSelected(users.map((u) => u.id))}
              disabled={selected.length === users.length}
            >
              <CheckCheck size={13} />
              全选本页
            </button>
            <button type="button" className="btn btn-sm" onClick={() => setSelected([])} disabled={!selected.length}>
              清空
            </button>
            <button
              type="button"
              className="btn btn-sm btn-danger"
              onClick={openBatchBan}
              disabled={!selected.length || busy}
            >
              <ShieldAlert size={13} />
              批量封禁（{selected.length}）
            </button>
            <button
              type="button"
              className="btn btn-sm"
              onClick={batchUnban}
              disabled={!selected.length || busy}
            >
              <ShieldOff size={13} />
              批量解封（{selected.length}）
            </button>
          </div>
        )}

        {loading ? (
          <SkeletonList rows={5} body={1} />
        ) : users.length === 0 ? (
          <Empty title="没有符合条件的用户" />
        ) : (
          <div className="admin-table">
            {users.map((item) => (
              <article key={item.id} className="admin-row" data-checked={selected.includes(item.id)}>
                {canBan && (
                  <SelectBox
                    checked={selected.includes(item.id)}
                    onChange={() => toggle(item.id)}
                    label={`选中账号 ${item.anonName}`}
                  />
                )}
                <Avatar name={item.anonName} color={item.anonColor} src={item.avatarUrl} />

                <div className="grow" style={{ minWidth: 0 }}>
                  <div className="row" style={{ gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
                    <span className="review-name">{item.anonName}</span>
                    <span className="faint">@{item.username}</span>
                    <span className="faint mono" title="用户编号">
                      UID {item.uid ?? '—'}
                    </span>
                    <span
                      className={`tag ${
                        item.role === 'superadmin'
                          ? 'tag-danger'
                          : item.role === 'admin'
                            ? 'tag-primary'
                            : item.role === 'reviewer'
                              ? 'tag-sand'
                              : ''
                      }`}
                    >
                      {ROLE_LABEL[item.role]}
                    </span>
                    {item.status === 'banned' && <span className="tag tag-danger">已封禁</span>}
                    {item.violationCount > 0 && <span className="tag tag-warning">违规 {item.violationCount}</span>}
                  </div>
                  <div className="admin-stats">
                    <span>发布 {item.postCount}</span>
                    <span title="注册时间（精确到分钟）">注册于 {formatDateTime(item.createdAt)}</span>
                    {isSuperAdmin && item.registerIp && <span className="mono">注册 IP {item.registerIp}</span>}
                    <span>最近登录 {item.lastLoginAt ? formatDateTime(item.lastLoginAt) : '从未'}</span>
                    {isSuperAdmin && item.lastLoginIp && item.lastLoginIp !== item.registerIp && (
                      <span className="mono">登录 IP {item.lastLoginIp}</span>
                    )}
                  </div>
                  {isSuperAdmin && item.contact && (
                    <div className="admin-stats" style={{ flexWrap: 'wrap', gap: 'var(--sp-3)' }}>
                      {VERIFY_ITEMS.map((verifyItem) => {
                        const value = item.contact?.[verifyItem.stateKey] || '';
                        const verified = item.verified[verifyItem.stateKey];
                        const enabled = verification[verifyItem.enabledKey];
                        return (
                          <span key={verifyItem.field} className="row" style={{ gap: 6, alignItems: 'center' }}>
                            <span className="faint" style={{ fontSize: 12 }}>
                              {verifyItem.label}
                            </span>
                            <span className="mono" style={{ fontSize: 12 }}>
                              {value || '未填写'}
                            </span>
                            <span className={verified ? 'tag tag-success' : 'tag'}>
                              {verified ? '已核验' : '未核验'}
                            </span>
                            {!enabled && <span className="faint" style={{ fontSize: 11 }}>（功能未开放）</span>}
                            {enabled && value && canHandle(me, item) && (
                              <button
                                type="button"
                                className="link-btn"
                                style={{ fontSize: 12 }}
                                onClick={() => toggleVerified(item, verifyItem)}
                              >
                                {verified ? '取消核验' : '标记已核验'}
                              </button>
                            )}
                          </span>
                        );
                      })}
                    </div>
                  )}
                  {item.ban && (
                    <div className="admin-ban-note">
                      <ShieldAlert size={12} />
                      封禁原因：{item.ban.reason}
                      {item.ban.until ? `，至 ${formatDateTime(item.ban.until)}` : '，永久'}
                    </div>
                  )}
                </div>

                <div className="admin-actions">
                  {isSuperAdmin && item.role !== 'superadmin' && canHandle(me, item) && (
                    <Select
                      className="admin-select"
                      size="sm"
                      align="end"
                      value={item.role}
                      options={ROLE_OPTIONS}
                      ariaLabel={`调整 ${item.anonName} 的角色`}
                      onChange={(next) => changeRole(item, next)}
                    />
                  )}
                  {isSuperAdmin && canHandle(me, item) && (
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={() => resetPassword(item)}
                      disabled={busy}
                      title="生成一次性临时密码，用于协助用户找回账号"
                    >
                      <KeyRound size={13} />
                      重置密码
                    </button>
                  )}
                  {item.status === 'banned' ? (
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={() => unban(item)}
                      disabled={!canBan || !canHandle(me, item)}
                      title={canBan ? authorityHint(me, item, '账号') || '解除封禁' : '仅管理员可操作'}
                    >
                      <ShieldCheck size={13} />
                      解封
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="btn btn-sm btn-danger"
                      onClick={() => setBanTarget(item)}
                      disabled={!canBan || !canHandle(me, item)}
                      title={canBan ? authorityHint(me, item, '账号') || '封禁账号' : '仅管理员可操作'}
                    >
                      <ShieldAlert size={13} />
                      封禁
                    </button>
                  )}
                </div>
              </article>
            ))}
          </div>
        )}

        {pages > 1 && (
          <div className="card-pad row" style={{ justifyContent: 'center', gap: 'var(--sp-2)' }}>
            <button type="button" className="btn btn-sm" onClick={() => setPage((p) => p - 1)} disabled={page <= 1}>
              上一页
            </button>
            <span className="mono hint">
              {page} / {pages}
            </span>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => setPage((p) => p + 1)}
              disabled={page >= pages}
            >
              下一页
            </button>
          </div>
        )}
      </div>

      {(banTarget || batchBan) && (
        <Modal maxWidth={480}>
          <div className="card-head">
            <div className="card-title">
              <UserCog size={15} />
              {batchBan ? `封禁选中的 ${selected.length} 个账号` : `封禁 ${banTarget?.anonName}`}
            </div>
          </div>
            <div className="card-pad stack">
              <label className="field">
                <span className="field-label">封禁原因</span>
                <input
                  className="input"
                  value={banReason}
                  maxLength={120}
                  onChange={(e) => setBanReason(e.target.value)}
                  placeholder="例如：多次发布广告引流内容"
                />
              </label>
              <div className="row" style={{ gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
                {BAN_REASONS.map((text) => (
                  <button key={text} type="button" className="tag" onClick={() => setBanReason(text)}>
                    {text}
                  </button>
                ))}
              </div>

              <div className="field">
                <span className="field-label">封禁时长</span>
                <div className="stack" style={{ gap: 'var(--sp-2)' }}>
                  {BAN_PRESETS.map((group) => (
                    <div key={group.group} className="row" style={{ gap: 'var(--sp-2)', alignItems: 'center' }}>
                      <span className="faint" style={{ fontSize: 12, width: 32 }}>
                        {group.group}
                      </span>
                      <div className="segmented">
                        {group.items.map((preset) => (
                          <button
                            key={preset.key}
                            type="button"
                            data-active={banPreset === preset.key}
                            onClick={() => {
                              setBanPreset(preset.key);
                              setBanUntil('');
                            }}
                          >
                            {preset.label}
                          </button>
                        ))}
                        {group.group === '永久' && (
                          <button
                            type="button"
                            data-active={banPreset === 'custom'}
                            onClick={() => setBanPreset('custom')}
                          >
                            自定义
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {banPreset === 'custom' && (
                <div className="field">
                  <span className="field-label">解封时间</span>
                  <DatePicker
                    value={banUntil}
                    onChange={setBanUntil}
                    withTime
                    placeholder="选择具体的解封时间"
                    ariaLabel="选择解封时间"
                  />
                </div>
              )}

              <div className="form-note" style={{ fontSize: 12 }}>
                {batchBan ? '选中的账号：' : ''}
                {banPreset === 'forever'
                  ? '将永久封禁，需要手动解封才能恢复。'
                  : banPreset === 'custom'
                    ? `将在 ${banUntil ? formatDateTime(banUntil) : '（待选择时间）'} 自动失效。`
                    : `将持续 ${BAN_PRESET_LABEL[banPreset] || ''}，到期后自动解封。`}
                <br />
                封禁期间无法发布、留言与发送弹幕，登录时会看到封禁原因；已登录的设备会立即掉线。
                {batchBan && ' 站长与你自己不能封禁，这几条会被跳过并单独告诉你。'}
              </div>

              <div className="row" style={{ justifyContent: 'flex-end' }}>
                <button type="button" className="btn" onClick={resetBanForm} disabled={busy}>
                  取消
                </button>
                <button type="button" className="btn btn-danger" onClick={submitBan} disabled={busy}>
                  {busy ? '处理中…' : batchBan ? `确认封禁 ${selected.length} 个账号` : '确认封禁'}
                </button>
              </div>
          </div>
        </Modal>
      )}

      {issued && (
        <Modal maxWidth={460}>
          <div className="card-head">
            <div className="card-title">
              <KeyRound size={15} />
              已为 {issued.username} 生成临时密码
            </div>
          </div>
            <div className="card-pad stack">
              <div className="form-note">
                <div className="mono" style={{ fontSize: 16, letterSpacing: 1 }}>
                  {issued.tempPassword}
                </div>
              </div>
              <p className="muted" style={{ fontSize: 12 }}>
                这个密码只显示这一次，请通过可靠渠道交给本人，并提醒对方登录后立刻修改。该账号此前的登录状态已全部失效。
              </p>
              <div className="row" style={{ justifyContent: 'flex-end' }}>
                <button type="button" className="btn" onClick={() => copyText(issued.tempPassword)}>
                  <Copy size={13} /> 复制
                </button>
                <button type="button" className="btn btn-primary" onClick={() => setIssued(null)}>
                  我已记下
                </button>
              </div>
          </div>
        </Modal>
      )}
    </div>
  );
}