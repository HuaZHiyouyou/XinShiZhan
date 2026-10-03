import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  Check,
  CheckCheck,
  Copy,
  FileText,
  ImagePlus,
  Inbox,
  KeyRound,
  LifeBuoy,
  Mail,
  Radio,
  RefreshCw,
  ShieldCheck,
  UserRound,
  X,
  ZoomIn,
} from 'lucide-react';
import { api, ApiError } from '@/api/client';
import type { PendingAvatarItem, RecoveryRequestItem, ReviewItem } from '@/api/types';
import { Avatar } from '@/components/common/Avatar';
import { AvatarViewer } from '@/components/common/AvatarViewer';
import { Empty, SkeletonList } from '@/components/common/Empty';
import { Modal } from '@/components/common/Modal';
import { formatDateTime, relativeTime } from '@/lib/format';
import { useBodyScrollLock } from '@/lib/useBodyScrollLock';
import { useAuth } from '@/store/auth';
import { useUi } from '@/store/ui';
import { AdminReports } from './AdminReports';

type TargetType = 'post' | 'message' | 'danmaku';
type Board = 'content' | 'avatar' | 'report' | 'recovery';

/** 所有「待审 / 待处理」的业务都集中在这一页，避免审核动作散落在多个菜单里 */
const BOARDS: { key: Board; label: string; icon: typeof FileText }[] = [
  { key: 'content', label: '内容审批', icon: FileText },
  { key: 'avatar', label: '头像审批', icon: ImagePlus },
  { key: 'report', label: '举报处理', icon: AlertTriangle },
  { key: 'recovery', label: '找回申请', icon: LifeBuoy },
];

const TYPES: { key: TargetType; label: string; icon: typeof FileText }[] = [
  { key: 'post', label: '心事', icon: FileText },
  { key: 'message', label: '留言', icon: Radio },
  { key: 'danmaku', label: '弹幕', icon: Radio },
];

const STATUSES = [
  { key: 'manual_review', label: '待人工复核' },
  { key: 'published', label: '已发布' },
  { key: 'rejected', label: '已驳回' },
];

const RECOVERY_METHOD_LABEL: Record<string, string> = {
  email: '邮箱找回',
  service: '站内客服',
  master: '站长求助',
  security: '密保找回',
};

const RECOVERY_STATUS = [
  { key: 'open', label: '待处理' },
  { key: 'handled', label: '已处理' },
  { key: 'rejected', label: '已驳回' },
  { key: 'all', label: '全部' },
];

type Notify = (message: string, tone?: 'info' | 'success' | 'warning' | 'danger') => void;

/* ─────────────────────────────── 内容审批 ─────────────────────────────── */

function ContentBoard({ notify }: { notify: Notify }) {
  const [type, setType] = useState<TargetType>('post');
  const [status, setStatus] = useState('manual_review');
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<number[]>([]);
  /* 通过/驳回共用一个弹窗：理由选填，只是给操作日志与站内信留个上下文 */
  const [dialog, setDialog] = useState<{ item: ReviewItem | null; batch: boolean; action: 'approve' | 'reject' } | null>(
    null
  );
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  useBodyScrollLock(Boolean(dialog));

  const openDialog = (action: 'approve' | 'reject', item: ReviewItem | null = null) => {
    setReason('');
    setDialog({ item, batch: !item, action });
  };

  const limit = 20;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.admin.review({ type, status, page, limit });
      setItems(data.items);
      setTotal(data.total);
      setSelected([]);
    } catch (error) {
      notify(error instanceof ApiError ? error.message : '队列加载失败', 'danger');
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [type, status, page, notify]);

  useEffect(() => {
    load();
  }, [load]);

  const approve = async (item: ReviewItem) => {
    setBusy(true);
    try {
      await api.admin.decide(item.type, item.id, 'approve');
      notify('已通过', 'success');
      await load();
    } catch (error) {
      notify(error instanceof ApiError ? error.message : '操作失败', 'danger');
    } finally {
      setBusy(false);
    }
  };

  const submitDialog = async () => {
    if (!dialog) return;
    setBusy(true);
    try {
      if (dialog.batch) {
        const result = await api.admin.decideBatch(
          items.filter((i) => selected.includes(i.id)).map((i) => ({ type: i.type, id: i.id })),
          dialog.action,
          reason
        );
        const skipped = result.blocked?.length || 0;
        const verb = dialog.action === 'approve' ? '通过' : '驳回';
        notify(skipped ? `已${verb} ${result.done} 条，${skipped} 条越权未处理` : `已${verb} ${result.done} 条`, skipped ? 'warning' : 'success');
      } else if (dialog.item) {
        await api.admin.decide(dialog.item.type, dialog.item.id, dialog.action, reason);
        notify(dialog.action === 'approve' ? '已通过' : '已驳回', 'success');
      }
      setDialog(null);
      setReason('');
      await load();
    } catch (error) {
      notify(error instanceof ApiError ? error.message : '操作失败', 'danger');
    } finally {
      setBusy(false);
    }
  };

  const batchApprove = async () => {
    setBusy(true);
    try {
      const result = await api.admin.decideBatch(
        items.filter((i) => selected.includes(i.id)).map((i) => ({ type: i.type, id: i.id })),
        'approve'
      );
      const skipped = result.blocked?.length || 0;
      notify(skipped ? `已通过 ${result.done} 条，${skipped} 条需自行逐条处理` : `已通过 ${result.done} 条`, skipped ? 'warning' : 'success');
      await load();
    } catch (error) {
      notify(error instanceof ApiError ? error.message : '操作失败', 'danger');
    } finally {
      setBusy(false);
    }
  };

  const toggle = (id: number) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((v) => v !== id) : [...prev, id]));

  const pages = Math.max(1, Math.ceil(total / limit));
  const pendingView = status === 'manual_review';

  return (
    <div className="card">
      <div className="card-head review-head">
        <div className="row" style={{ gap: 'var(--sp-3)', flexWrap: 'wrap' }}>
          <div className="segmented">
            {TYPES.map((item) => (
              <button
                key={item.key}
                type="button"
                data-active={type === item.key}
                onClick={() => {
                  setType(item.key);
                  setPage(1);
                }}
              >
                <item.icon size={13} />
                {item.label}
              </button>
            ))}
          </div>
          <div className="segmented">
            {STATUSES.map((item) => (
              <button
                key={item.key}
                type="button"
                data-active={status === item.key}
                onClick={() => {
                  setStatus(item.key);
                  setPage(1);
                }}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        <span className="hint">共 {total} 条</span>
      </div>

      {pendingView && !loading && items.length > 0 && (
        <div className="batch-bar">
          <span className="batch-count">已选 {selected.length} 条</span>
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => setSelected(items.map((i) => i.id))}
            disabled={selected.length === items.length}
          >
            <CheckCheck size={13} />
            全选本页
          </button>
          <button type="button" className="btn btn-sm" onClick={() => setSelected([])} disabled={!selected.length}>
            清空
          </button>
          <button
            type="button"
            className="btn btn-sm btn-primary"
            onClick={batchApprove}
            disabled={!selected.length || busy}
          >
            <Check size={13} />
            批量通过（{selected.length}）
          </button>
          <button
            type="button"
            className="btn btn-sm btn-danger"
            onClick={() => openDialog('reject')}
            disabled={!selected.length || busy}
          >
            <X size={13} />
            批量驳回（{selected.length}）
          </button>
        </div>
      )}

      <div className="review-list">
        {loading && <SkeletonList rows={4} body={2} />}
        {!loading && items.length === 0 && (
          <Empty
            icon={<Inbox size={26} />}
            title={pendingView ? '队列已经清空' : '这个状态下没有内容'}
            desc={pendingView ? '所有提交都已处理完毕' : '换个状态看看'}
          />
        )}

        {!loading &&
          items.map((item) => {
            const checked = selected.includes(item.id);
            return (
              <article
                key={`${item.type}-${item.id}`}
                className="review-item"
                data-checked={checked}
                data-selectable={pendingView}
                onClick={pendingView ? () => toggle(item.id) : undefined}
                onKeyDown={
                  pendingView
                    ? (e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          toggle(item.id);
                        }
                      }
                    : undefined
                }
                role={pendingView ? 'checkbox' : undefined}
                aria-checked={pendingView ? checked : undefined}
                tabIndex={pendingView ? 0 : undefined}
              >
                {pendingView && (
                  <span className="review-mark" aria-hidden="true">
                    {checked && <Check size={12} />}
                  </span>
                )}

                <div className="grow" style={{ minWidth: 0 }}>
                  <div className="review-meta">
                    <Avatar name={item.author.anonName} color={item.author.anonColor} src={item.author.avatarUrl} size="sm" />
                    <span className="review-name">{item.author.anonName}</span>
                    {item.author.username && <span className="faint">@{item.author.username}</span>}
                    <span className="meta-dot" />
                    <span className="faint" title={formatDateTime(item.createdAt)}>
                      {relativeTime(item.createdAt)}
                    </span>
                    {item.visibility === 'private' && <span className="tag">仅自己可见</span>}
                    {item.lifecycle === 'scheduled' && <span className="tag tag-sand">定时待发</span>}
                    {item.postId && <span className="tag">关联心事 #{item.postId}</span>}
                    {item.parentId && <span className="tag">回复 #{item.parentId}</span>}
                    {/* 自己的内容不进别人的队列，只有超管看得到 */}
                    {item.self && (
                      <span className="tag tag-warning" title="这是你自己的内容：站点里没有比你更高的人能处理它">
                        自我裁决
                      </span>
                    )}
                  </div>

                  <p className="review-content">{item.content}</p>

                  {item.images && item.images.length > 0 && (
                    <div className="review-images">
                      {item.images.map((src) => (
                        <img key={src} src={src} alt="待审配图" loading="lazy" />
                      ))}
                    </div>
                  )}

                  {item.autoFlags.length > 0 && (
                    <div className="review-flags">
                      {item.autoFlags.map((flag) => (
                        <span key={flag} className="tag tag-warning">
                          {flag}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                {pendingView && (
                  <div
                    className="review-actions"
                    onClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => e.stopPropagation()}
                  >
                    <button
                      type="button"
                      className="btn btn-sm btn-primary"
                      onClick={() => (item.self ? openDialog('approve', item) : approve(item))}
                      disabled={busy}
                    >
                      <Check size={13} />
                      通过
                    </button>
                    <button
                      type="button"
                      className="btn btn-sm btn-danger"
                      onClick={() => openDialog('reject', item)}
                      disabled={busy}
                    >
                      <X size={13} />
                      驳回
                    </button>
                  </div>
                )}
              </article>
            );
          })}
      </div>

      {pages > 1 && (
        <div className="card-pad row" style={{ justifyContent: 'center', gap: 'var(--sp-2)' }}>
          <button type="button" className="btn btn-sm" onClick={() => setPage((p) => p - 1)} disabled={page <= 1}>
            上一页
          </button>
          <span className="mono hint">
            {page} / {pages}
          </span>
          <button type="button" className="btn btn-sm" onClick={() => setPage((p) => p + 1)} disabled={page >= pages}>
            下一页
          </button>
        </div>
      )}

      {dialog && (
        <Modal maxWidth={460}>
          <div className="card-head">
            <div className="card-title">
              <ShieldCheck size={15} />
              {dialog.action === 'approve'
                ? dialog.batch
                  ? `通过选中的 ${selected.length} 条`
                  : '通过这条内容'
                : dialog.batch
                  ? `驳回选中的 ${selected.length} 条`
                  : '驳回这条内容'}
            </div>
          </div>
          <div className="card-pad stack">
            <p className="muted" style={{ fontSize: 12 }}>
              {dialog.item?.self
                ? '这是你自己发布的内容 —— 站点里没有比你更高的人能处理它，只能由你自行裁决。操作会记入审计日志。'
                : dialog.action === 'approve'
                  ? '通过后内容会立即生效。理由选填，仅记入操作日志。'
                  : '驳回会给作者发送站内信，并累加一次违规计数。留空则使用默认理由。'}
            </p>
            <textarea
              className="textarea"
              rows={3}
              maxLength={120}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="理由选填，例如：内容涉及广告引流"
            />
            <div className="row" style={{ justifyContent: 'flex-end' }}>
              <button
                type="button"
                className="btn"
                onClick={() => {
                  setDialog(null);
                  setReason('');
                }}
                disabled={busy}
              >
                取消
              </button>
              <button
                type="button"
                className={dialog.action === 'approve' ? 'btn btn-primary' : 'btn btn-danger'}
                onClick={submitDialog}
                disabled={busy}
              >
                {busy ? '处理中…' : dialog.action === 'approve' ? '确认通过' : '确认驳回'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

/* ─────────────────────────────── 头像审批 ─────────────────────────────── */

function AvatarBoard({ notify }: { notify: Notify }) {
  const [items, setItems] = useState<PendingAvatarItem[]>([]);
  const me = useAuth((s) => s.user);
  const refreshUser = useAuth((s) => s.refreshUser);

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<number | null>(null);
  /* 通过/驳回共用弹窗：理由选填 */
  const [dialog, setDialog] = useState<{ item: PendingAvatarItem; action: 'approve' | 'reject' } | null>(null);
  const [reason, setReason] = useState('');
  /* 正在放大的头像：可切换看新头像 / 当前头像，以及显示尺寸 */
  const [zoom, setZoom] = useState<PendingAvatarItem | null>(null);

  useBodyScrollLock(Boolean(dialog) || Boolean(zoom));

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { avatars } = await api.admin.avatars();
      setItems(avatars);
    } catch (error) {
      notify(error instanceof ApiError ? error.message : '待审头像加载失败', 'danger');
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [notify]);

  useEffect(() => {
    load();
  }, [load]);

  const decide = async (item: PendingAvatarItem, action: 'approve' | 'reject', why = '') => {
    setBusy(item.id);
    try {
      await api.admin.decideAvatar(item.id, action, why);
      notify(action === 'approve' ? `已通过 ${item.anonName} 的新头像` : `已驳回 ${item.anonName} 的新头像`, 'success');
      setDialog(null);
      setReason('');
      setZoom(null);
      await load();
      /*
       * 审核的可能是自己的头像（管理员同时也是用户）。
       * 审核结果由服务端直接改在用户记录上，不会经过本地写接口，
       * 所以这里必须重新拉一次身份，否则「个人信息」还停在「审核中」。
       */
      if (me?.id === item.id) await refreshUser();
    } catch (error) {
      notify(error instanceof ApiError ? error.message : '操作失败', 'danger');
    } finally {
      setBusy(null);
    }
  };

  /** 一个用户可能同时有「当前头像」和「待审的新头像」，两相对照才好判断 */
  const shotsOf = (item: PendingAvatarItem) => {
    const shots = [{ label: '待审新头像', src: item.avatarPending, hint: item.avatarUrl ? '替换后' : '首次上传' }];
    if (item.avatarUrl) shots.push({ label: '当前头像', src: item.avatarUrl, hint: '正在使用' });
    return shots;
  };

  return (
    <div className="card">
      <div className="card-head">
        <div className="card-title">
          <ImagePlus size={15} />
          头像审批
          <span className="card-sub">
            {items.length > 0 ? `${items.length} 个新头像等待处理` : '开启「头像先审后显」后，新头像会进入这里'}
          </span>
        </div>
        <button type="button" className="btn btn-sm" onClick={load} disabled={loading}>
          <RefreshCw size={13} /> 刷新
        </button>
      </div>

      {loading ? (
        <SkeletonList rows={3} body={1} />
      ) : items.length === 0 ? (
        <Empty icon={<Check size={26} />} title="没有待审核的头像" />
      ) : (
        <div className="card-pad stack" style={{ gap: 'var(--sp-3)' }}>
          {items.map((item) => (
            <div key={item.id} className="avatar-review-row">
              {/* 小圆圈里看不清细节，点一下就能放大、还能和当前头像并排比 */}
              <Avatar
                name={item.anonName}
                color={item.anonColor}
                src={item.avatarPending}
                size="md"
                onZoom={() => setZoom(item)}
              />

              <div className="grow" style={{ minWidth: 0 }}>
                <div className="row" style={{ gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
                  <strong>{item.anonName}</strong>
                  <span className="faint mono">@{item.username}</span>
                  {item.self && (
                    <span className="tag tag-warning" title="这是你自己的头像：站点里没有比你更高的人能处理它">
                      自我裁决
                    </span>
                  )}
                </div>
                <div className="faint" style={{ fontSize: 12 }}>
                  提交于 {item.submittedAt ? formatDateTime(item.submittedAt) : '未知时间'}
                  {item.avatarUrl ? ' · 有人正在使用旧头像，可对比后再定' : ' · 首次上传头像'}
                </div>
                <button type="button" className="link-btn" onClick={() => setZoom(item)}>
                  <ZoomIn size={12} />
                  放大查看 / 与当前头像对比
                </button>
              </div>

              <div className="row" style={{ gap: 'var(--sp-2)' }}>
                <button
                  type="button"
                  className="btn btn-sm btn-primary"
                  disabled={busy === item.id}
                  onClick={() => {
                    setReason('');
                    setDialog({ item, action: 'approve' });
                  }}
                >
                  <Check size={13} />
                  通过
                </button>
                <button
                  type="button"
                  className="btn btn-sm btn-danger"
                  disabled={busy === item.id}
                  onClick={() => {
                    setReason('');
                    setDialog({ item, action: 'reject' });
                  }}
                >
                  <X size={13} />
                  驳回
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {zoom && <AvatarViewer shots={shotsOf(zoom)} name={zoom.anonName} onClose={() => setZoom(null)} />}

      {dialog && (
        <Modal maxWidth={440}>
          <div className="card-head">
            <div className="card-title">
              <ImagePlus size={15} />
              {dialog.action === 'approve' ? '通过' : '驳回'} {dialog.item.anonName} 的新头像
            </div>
          </div>
          <div className="card-pad stack">
            {dialog.item.self && (
              <p className="muted" style={{ fontSize: 12, margin: 0 }}>
                这是你自己的头像 —— 站点里没有比你更高的人能处理，只能自行裁决。操作会记入审计日志。
              </p>
            )}
            <textarea
              className="textarea"
              rows={3}
              maxLength={120}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="理由选填，例如：图片含有引流水印"
            />
            <div className="row" style={{ justifyContent: 'flex-end' }}>
              <button
                type="button"
                className="btn"
                onClick={() => {
                  setDialog(null);
                  setReason('');
                }}
              >
                取消
              </button>
              <button
                type="button"
                className={dialog.action === 'approve' ? 'btn btn-primary' : 'btn btn-danger'}
                disabled={busy === dialog.item.id}
                onClick={() => decide(dialog.item, dialog.action, reason)}
              >
                {busy === dialog.item.id ? '处理中…' : dialog.action === 'approve' ? '确认通过' : '确认驳回'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

/* ─────────────────────────────── 找回申请 ─────────────────────────────── */

function RecoveryBoard({ notify }: { notify: Notify }) {
  const me = useAuth((s) => s.user);
  const isSuperAdmin = me?.role === 'superadmin';

  const [status, setStatus] = useState('open');
  const [items, setItems] = useState<RecoveryRequestItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<number | null>(null);
  const [issued, setIssued] = useState<{ username: string; tempPassword: string } | null>(null);
  /* 处理申请时写给用户的说明：会同时出现在站内信和对方的「找回记录」里 */
  const [decision, setDecision] = useState<{ item: RecoveryRequestItem; next: 'handled' | 'rejected' } | null>(null);
  const [note, setNote] = useState('');

  useBodyScrollLock(Boolean(issued) || Boolean(decision));

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.admin.recovery({ status, limit: 50 });
      setItems(data.requests);
      setTotal(data.total);
    } catch (error) {
      notify(error instanceof ApiError ? error.message : '找回申请加载失败', 'danger');
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [status, notify]);

  useEffect(() => {
    load();
  }, [load]);

  const decide = async (item: RecoveryRequestItem, next: 'handled' | 'rejected', text = '') => {
    setBusy(item.id);
    try {
      await api.admin.decideRecovery(item.id, { status: next, note: text });
      notify(
        next === 'handled' ? '已标记为处理完成，说明已同步给用户' : '已驳回该申请，说明已同步给用户',
        'success'
      );
      setDecision(null);
      setNote('');
      await load();
    } catch (error) {
      notify(error instanceof ApiError ? error.message : '操作失败', 'danger');
    } finally {
      setBusy(null);
    }
  };

  const resetPassword = async (item: RecoveryRequestItem) => {
    if (!item.userId) return;
    setBusy(item.id);
    try {
      const result = await api.admin.resetPassword(item.userId);
      setIssued({ username: result.username, tempPassword: result.tempPassword });
      await api.admin.decideRecovery(item.id, { status: 'handled', note: '已重置并交付临时密码' });
      await load();
    } catch (error) {
      notify(error instanceof ApiError ? error.message : '重置失败', 'danger');
    } finally {
      setBusy(null);
    }
  };

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      notify('临时密码已复制', 'success');
    } catch {
      notify('复制失败，请手动选中复制', 'warning');
    }
  };

  return (
    <div className="card">
      <div className="card-head">
        <div className="card-title">
          <LifeBuoy size={15} />
          找回密码申请
          <span className="card-sub">用户在登录页提交的找回请求，核实身份后可在这里直接重置口令</span>
        </div>
        <div className="row" style={{ gap: 'var(--sp-2)' }}>
          <div className="segmented">
            {RECOVERY_STATUS.map((item) => (
              <button key={item.key} type="button" data-active={status === item.key} onClick={() => setStatus(item.key)}>
                {item.label}
              </button>
            ))}
          </div>
          <button type="button" className="btn btn-sm" onClick={load} disabled={loading}>
            <RefreshCw size={13} /> 刷新
          </button>
        </div>
      </div>

      {loading ? (
        <SkeletonList rows={3} body={2} />
      ) : items.length === 0 ? (
        <Empty icon={<Inbox size={26} />} title="没有找回申请" desc="用户在登录页提交后会出现在这里" />
      ) : (
        <div className="review-list">
          <div className="card-pad hint">共 {total} 条</div>
          {items.map((item) => (
            <article key={item.id} className="review-item">
              <div className="grow" style={{ minWidth: 0 }}>
                <div className="review-meta">
                  <span className="review-name">
                    {item.anonName || item.account}
                    {item.uid ? `（UID ${item.uid}）` : ''}
                  </span>
                  {item.username && <span className="faint">@{item.username}</span>}
                  {!item.userId && <span className="tag tag-danger">账号已删除</span>}
                  {item.userStatus === 'banned' && <span className="tag tag-danger">账号已封禁</span>}
                  <span className="meta-dot" />
                  <span className="faint" title={formatDateTime(item.createdAt)}>
                    {relativeTime(item.createdAt)}
                  </span>
                  <span className={`tag ${item.status === 'open' ? 'tag-warning' : item.status === 'handled' ? 'tag-success' : ''}`}>
                    {item.status === 'open' ? '待处理' : item.status === 'handled' ? '已处理' : '已驳回'}
                  </span>
                </div>
                <div className="admin-stats">
                  <span>
                    方式：
                    {item.method === 'email' ? <Mail size={11} /> : item.method === 'service' ? <LifeBuoy size={11} /> : item.method === 'master' ? <UserRound size={11} /> : <KeyRound size={11} />}
                    {RECOVERY_METHOD_LABEL[item.method] || item.method}
                  </span>
                  <span>受理编号 #{item.id}</span>
                  <span>提交于 {formatDateTime(item.createdAt)}</span>
                </div>

                {/* 申请来源完整留痕：IP 不脱敏、不省略，长 IPv6 也照原样显示 */}
                <div className="recovery-source">
                  <span className="mono" title={item.ip || ''}>
                    来源 IP：{item.ip || '未记录'}
                  </span>
                  {item.userAgent && (
                    <span className="mono faint" title={item.userAgent}>
                      设备：{item.userAgent}
                    </span>
                  )}
                </div>
                {item.handledAt && (
                  <div className="admin-ban-note">
                    由 {item.handledBy || '管理员'} 于 {formatDateTime(item.handledAt)} 处理
                    {item.handledNote ? `：${item.handledNote}` : ''}
                  </div>
                )}
              </div>

              {item.status === 'open' && (
                <div className="review-actions">
                  {isSuperAdmin && item.userId && (
                    <button
                      type="button"
                      className="btn btn-sm btn-primary"
                      disabled={busy === item.id}
                      onClick={() => resetPassword(item)}
                    >
                      <KeyRound size={13} />
                      重置并交付新密码
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn btn-sm"
                    disabled={busy === item.id}
                    onClick={() => {
                      setNote('');
                      setDecision({ item, next: 'handled' });
                    }}
                  >
                    <Check size={13} />
                    标记已处理
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm btn-danger"
                    disabled={busy === item.id}
                    onClick={() => {
                      setNote('');
                      setDecision({ item, next: 'rejected' });
                    }}
                  >
                    <X size={13} />
                    驳回
                  </button>
                </div>
              )}
            </article>
          ))}
        </div>
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
              这个密码只在这里显示一次，请通过可靠渠道交给本人，并提醒对方登录后立刻在
              「个人信息 → 账号与安全」里改成自己的密码。该账号此前的登录状态已全部失效。
            </p>
            <div className="row" style={{ justifyContent: 'flex-end' }}>
              <button type="button" className="btn" onClick={() => copy(issued.tempPassword)}>
                <Copy size={13} /> 复制
              </button>
              <button type="button" className="btn btn-primary" onClick={() => setIssued(null)}>
                我已记下
              </button>
            </div>
          </div>
        </Modal>
      )}

      {decision && (
        <Modal maxWidth={520}>
          <div className="card-head">
            <div className="card-title">
              {decision.next === 'handled' ? <Check size={15} /> : <X size={15} />}
              {decision.next === 'handled' ? '标记为已处理' : '驳回这条找回申请'}
            </div>
          </div>

            <div className="card-pad stack">
              <div className="form-note">
                <div>
                  <strong>{decision.item.anonName || decision.item.account}</strong>
                  {decision.item.uid ? <span className="faint"> · UID {decision.item.uid}</span> : null}
                </div>
                <div style={{ marginTop: 6, fontSize: 12 }}>
                  {RECOVERY_METHOD_LABEL[decision.item.method] || decision.item.method} · 受理编号 #
                  {decision.item.id}
                </div>
              </div>

              <div className="field">
                <span className="field-label">
                  给用户的说明
                  <span className="faint" style={{ marginLeft: 6, fontSize: 11 }}>
                    选填，会同时出现在对方的站内信与「找回记录」里
                  </span>
                </span>
                <textarea
                  className="textarea"
                  rows={3}
                  maxLength={200}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder={
                    decision.next === 'handled'
                      ? '例如：已通过站内客服核实身份，临时密码已交付'
                      : '例如：提交的信息不足以确认是本人在申请，请补充注册时间或登录过的设备'
                  }
                />
                <div className="row" style={{ gap: 'var(--sp-2)', flexWrap: 'wrap', marginTop: 'var(--sp-2)' }}>
                  {(decision.next === 'handled'
                    ? ['已核实身份，临时密码已交付', '已通过站内客服确认，请尽快修改密码']
                    : ['信息不足以确认本人，请补充注册时间', '同一账号短期内申请过于频繁，请稍后再试']
                  ).map((text) => (
                    <button key={text} type="button" className="tag" onClick={() => setNote(text)}>
                      {text}
                    </button>
                  ))}
                </div>
              </div>

              <div className="row" style={{ justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    setDecision(null);
                    setNote('');
                  }}
                  disabled={busy === decision.item.id}
                >
                  取消
                </button>
                <button
                  type="button"
                  className={decision.next === 'handled' ? 'btn btn-primary' : 'btn btn-danger'}
                  onClick={() => decide(decision.item, decision.next, note.trim())}
                  disabled={busy === decision.item.id}
                >
                  {busy === decision.item.id
                    ? '处理中…'
                    : decision.next === 'handled'
                      ? '确认已处理并通知'
                      : '确认驳回并通知'}
                </button>
              </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

/* ─────────────────────────────── 页面入口 ─────────────────────────────── */

export function AdminReview() {
  const notify = useUi((s) => s.notify);
  const [board, setBoard] = useState<Board>('content');

  return (
    <div className="stack">
      <div className="card card-pad">
        <div className="row" style={{ justifyContent: 'space-between', gap: 'var(--sp-4)', flexWrap: 'wrap' }}>
          <div className="segmented">
            {BOARDS.map((item) => (
              <button key={item.key} type="button" data-active={board === item.key} onClick={() => setBoard(item.key)}>
                <item.icon size={13} />
                {item.label}
              </button>
            ))}
          </div>
          <span className="hint">内容、头像、举报与找回申请都在这一页处理</span>
        </div>
      </div>

      {/* 换标签时让新面板浮进来，而不是「啪」地整块替换 */}
      <div key={board} className="page-enter">
        {board === 'content' && <ContentBoard notify={notify} />}
        {board === 'avatar' && <AvatarBoard notify={notify} />}
        {board === 'report' && <AdminReports />}
        {board === 'recovery' && <RecoveryBoard notify={notify} />}
      </div>
    </div>
  );
}
