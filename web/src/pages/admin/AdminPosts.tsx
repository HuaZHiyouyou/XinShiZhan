import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArchiveRestore,
  Check,
  CheckCheck,
  Eye,
  EyeOff,
  Pencil,
  Pin,
  RotateCcw,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { api, ApiError } from '@/api/client';
import type { AdminPost } from '@/api/types';
import { Avatar } from '@/components/common/Avatar';
import { Empty, SkeletonList } from '@/components/common/Empty';
import { Modal } from '@/components/common/Modal';
import { Select } from '@/components/common/Select';
import { SelectBox } from '@/components/common/SelectBox';
import { LIFECYCLE_LABELS, REVIEW_STATUS_LABELS } from '@/lib/constants';
import { formatDateTime, formatCount } from '@/lib/format';
import { useUi } from '@/store/ui';

const STATUS_OPTIONS = [
  { value: '', label: '全部状态' },
  { value: 'published', label: '已发布' },
  { value: 'manual_review', label: '待复核' },
  { value: 'rejected', label: '已驳回' },
];

const LIFECYCLE_OPTIONS = [
  { value: '', label: '全部周期' },
  { value: 'live', label: '已上线' },
  { value: 'scheduled', label: '定时待发' },
  { value: 'draft', label: '未上线' },
  { value: 'expired', label: '已过期' },
];

const REVIEW_OPTIONS = [
  { value: 'published', label: '已发布' },
  { value: 'manual_review', label: '待复核' },
  { value: 'rejected', label: '已驳回' },
];

export function AdminPosts() {
  const notify = useUi((s) => s.notify);
  const askConfirm = useUi((s) => s.askConfirm);

  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [lifecycle, setLifecycle] = useState('');
  const [trash, setTrash] = useState(false);
  const [posts, setPosts] = useState<AdminPost[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<AdminPost | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  /* 批量选择：换页 / 换筛选 / 操作完都会清空，避免「看不见的选中项」被一起处理 */
  const [selected, setSelected] = useState<number[]>([]);

  const limit = 20;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.admin.posts({
        q: q || undefined,
        status: status || undefined,
        lifecycle: lifecycle || undefined,
        deleted: trash ? 1 : undefined,
        page,
        limit,
      });
      setPosts(data.posts);
      setTotal(data.total);
      setSelected([]);
    } catch (error) {
      notify(error instanceof ApiError ? error.message : '加载失败', 'danger');
      setPosts([]);
    } finally {
      setLoading(false);
    }
  }, [q, status, lifecycle, trash, page, notify]);

  useEffect(() => {
    load();
  }, [load]);

  const patch = async (post: AdminPost, body: Record<string, unknown>, message: string) => {
    try {
      await api.admin.updatePost(post.id, body);
      notify(message, 'success');
      await load();
    } catch (error) {
      notify(error instanceof ApiError ? error.message : '操作失败', 'danger');
    }
  };

  const openEditor = (post: AdminPost) => {
    setEditing(post);
    setDraft(post.content);
  };

  const submitEdit = async () => {
    if (!editing) return;
    if (!draft.trim()) {
      notify('正文不能为空', 'danger');
      return;
    }
    setBusy(true);
    try {
      await api.admin.updatePost(editing.id, { content: draft.trim() });
      notify('正文已更新', 'success');
      setEditing(null);
      await load();
    } catch (error) {
      notify(error instanceof ApiError ? error.message : '保存失败', 'danger');
    } finally {
      setBusy(false);
    }
  };

  const remove = (post: AdminPost) => {
    askConfirm({
      title: '下架这件心事',
      message: '下架后会移入回收站，内容不会真正删除，随时可以恢复。作者会收到一条站内信。',
      confirmText: '确认下架',
      tone: 'danger',
      onConfirm: async () => {
        try {
          await api.admin.deletePost(post.id);
          notify('已移入回收站', 'success');
          await load();
        } catch (error) {
          notify(error instanceof ApiError ? error.message : '操作失败', 'danger');
        }
      },
    });
  };

  const restore = async (post: AdminPost) => {
    try {
      await api.admin.restorePost(post.id);
      notify('已恢复到内容列表', 'success');
      await load();
    } catch (error) {
      notify(error instanceof ApiError ? error.message : '操作失败', 'danger');
    }
  };

  const toggle = (id: number) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((v) => v !== id) : [...prev, id]));

  /**
   * 批量下架 / 批量恢复。
   * 越权的条目由服务端逐条挡下并回报，这里如实告诉管理员「哪几条没动」，
   * 而不是笼统地说一句成功。
   */
  const runBatch = async (action: 'delete' | 'restore') => {
    if (!selected.length) return;
    setBusy(true);
    try {
      const result = await api.admin.postsBatch(selected, action);
      const skipped = result.blocked?.length || 0;
      const verb = action === 'delete' ? '下架' : '恢复';
      notify(
        skipped ? `已${verb} ${result.done} 条，${skipped} 条越权未处理` : `已${verb} ${result.done} 条`,
        skipped ? 'warning' : 'success'
      );
      await load();
    } catch (error) {
      notify(error instanceof ApiError ? error.message : '批量操作失败', 'danger');
    } finally {
      setBusy(false);
    }
  };

  const batchTrash = () => {
    if (!selected.length) return;
    askConfirm({
      title: `下架选中的 ${selected.length} 件心事`,
      message: '它们会一起移入回收站，内容不会真正删除，随时可以恢复。作者会各收到一条站内信。',
      confirmText: '确认下架',
      tone: 'danger',
      onConfirm: () => runBatch('delete'),
    });
  };

  const pages = Math.max(1, Math.ceil(total / limit));

  return (
    <div className="stack">
      <div className="card">
        <div className="card-head review-head">
          <div className="row" style={{ gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
            <div className="segmented">
              <button
                type="button"
                data-active={!trash}
                onClick={() => {
                  setTrash(false);
                  setPage(1);
                }}
              >
                内容列表
              </button>
              <button
                type="button"
                data-active={trash}
                onClick={() => {
                  setTrash(true);
                  setPage(1);
                }}
              >
                回收站
              </button>
            </div>
            <div className="input-affix admin-search">
              <Search size={14} />
              <input
                className="input"
                value={q}
                onChange={(e) => {
                  setQ(e.target.value);
                  setPage(1);
                }}
                placeholder="搜索内容或用户名"
              />
            </div>
            <Select
              className="admin-select"
              size="sm"
              value={status}
              options={STATUS_OPTIONS}
              ariaLabel="按审核状态筛选"
              onChange={(next) => {
                setStatus(next);
                setPage(1);
              }}
            />
            <Select
              className="admin-select"
              size="sm"
              value={lifecycle}
              options={LIFECYCLE_OPTIONS}
              ariaLabel="按生命周期筛选"
              onChange={(next) => {
                setLifecycle(next);
                setPage(1);
              }}
            />
          </div>
          <span className="hint">共 {total} 条</span>
        </div>

        {!loading && posts.length > 0 && (
          <div className="batch-bar">
            <span className="batch-count">已选 {selected.length} 条</span>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => setSelected(posts.map((p) => p.id))}
              disabled={selected.length === posts.length}
            >
              <CheckCheck size={13} />
              全选本页
            </button>
            <button type="button" className="btn btn-sm" onClick={() => setSelected([])} disabled={!selected.length}>
              清空
            </button>
            {trash ? (
              <button
                type="button"
                className="btn btn-sm btn-primary"
                onClick={() => runBatch('restore')}
                disabled={!selected.length || busy}
              >
                <RotateCcw size={13} />
                批量恢复（{selected.length}）
              </button>
            ) : (
              <button
                type="button"
                className="btn btn-sm btn-danger"
                onClick={batchTrash}
                disabled={!selected.length || busy}
              >
                <Trash2 size={13} />
                批量下架（{selected.length}）
              </button>
            )}
          </div>
        )}

        {loading ? (
          <SkeletonList rows={5} body={2} />
        ) : posts.length === 0 ? (
          <Empty
            icon={trash ? <ArchiveRestore size={26} /> : undefined}
            title={trash ? '回收站是空的' : '没有符合条件的内容'}
            desc={trash ? '被下架的心事会出现在这里，可以随时恢复' : undefined}
          />
        ) : (
          <div className="admin-table">
            {posts.map((post) => (
              <article key={post.id} className="admin-row" data-checked={selected.includes(post.id)}>
                <SelectBox
                  checked={selected.includes(post.id)}
                  onChange={() => toggle(post.id)}
                  label={`选中心事 #${post.id}`}
                />
                <Avatar name={post.author.anonName} color={post.author.anonColor} src={post.author.avatarUrl} />

                <div className="grow" style={{ minWidth: 0 }}>
                  <div className="row" style={{ gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
                    <span className="mono faint">#{post.id}</span>
                    <span className="review-name">{post.author.anonName}</span>
                    <span className="faint">@{post.author.username}</span>
                    <span className="tag">{REVIEW_STATUS_LABELS[post.reviewStatus]}</span>
                    <span className="tag">{LIFECYCLE_LABELS[post.lifecycle]}</span>
                    {post.pinned && <span className="tag tag-primary">置顶</span>}
                    {post.visibility === 'private' && <span className="tag">仅自己可见</span>}
                    {post.deletedAt && <span className="tag tag-warning">已下架</span>}
                  </div>

                  {post.deletedAt ? (
                    <p className="admin-excerpt clamp-2">{post.content}</p>
                  ) : (
                    <Link className="admin-excerpt clamp-2" to={`/post/${post.id}`}>
                      {post.content}
                    </Link>
                  )}

                  <div className="admin-stats">
                    <span>共鸣 {formatCount(post.likeCount)}</span>
                    <span>留言 {formatCount(post.messageCount)}</span>
                    <span>弹幕 {formatCount(post.danmakuCount)}</span>
                    <span>浏览 {formatCount(post.viewCount)}</span>
                    <span>发布于 {formatDateTime(post.createdAt)}</span>
                    {post.publishAt && <span>定时 {formatDateTime(post.publishAt)}</span>}
                    {post.expiresAt && <span>下架 {formatDateTime(post.expiresAt)}</span>}
                    {post.deletedAt && <span>下架于 {formatDateTime(post.deletedAt)}</span>}
                  </div>
                </div>

                <div className="admin-actions">
                  {post.deletedAt ? (
                    <button type="button" className="btn btn-sm btn-primary" onClick={() => restore(post)}>
                      <RotateCcw size={13} />
                      恢复
                    </button>
                  ) : (
                    <>
                      <button type="button" className="btn btn-sm" onClick={() => openEditor(post)}>
                        <Pencil size={13} />
                        改正文
                      </button>
                      <button
                        type="button"
                        className="btn btn-sm"
                        data-active={post.pinned}
                        onClick={() => patch(post, { pinned: !post.pinned }, post.pinned ? '已取消置顶' : '已置顶')}
                      >
                        <Pin size={13} />
                        {post.pinned ? '取消置顶' : '置顶'}
                      </button>
                      <button
                        type="button"
                        className="btn btn-sm"
                        onClick={() =>
                          patch(
                            post,
                            { visibility: post.visibility === 'private' ? 'public' : 'private' },
                            post.visibility === 'private' ? '已设为公开' : '已设为仅自己可见'
                          )
                        }
                      >
                        {post.visibility === 'private' ? <Eye size={13} /> : <EyeOff size={13} />}
                        {post.visibility === 'private' ? '转公开' : '转私密'}
                      </button>
                      <Select
                        className="admin-select"
                        size="sm"
                        align="end"
                        value={post.reviewStatus}
                        options={REVIEW_OPTIONS}
                        ariaLabel={`调整心事 #${post.id} 的审核状态`}
                        onChange={(next) => patch(post, { reviewStatus: next }, '审核状态已更新')}
                      />
                      <button type="button" className="btn btn-sm btn-danger" onClick={() => remove(post)}>
                        <Trash2 size={13} />
                        下架
                      </button>
                    </>
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

      {editing && (
        <Modal maxWidth={560}>
          <div className="card-head">
            <div className="card-title">
              <Pencil size={15} />
              修改心事 #{editing.id} 的正文
            </div>
              <button
                type="button"
                className="btn-icon"
                onClick={() => setEditing(null)}
                aria-label="关闭"
                disabled={busy}
              >
                <X size={15} />
              </button>
            </div>
            <div className="card-pad stack">
              <p className="muted" style={{ fontSize: 12 }}>
                管理员修改会直接生效，不会重新走自动审核流程。正文上限 1000 字。
              </p>
              <textarea
                className="textarea"
                rows={8}
                maxLength={1000}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
              />
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <span className="mono hint">{draft.length}/1000</span>
                <div className="row" style={{ gap: 'var(--sp-2)' }}>
                  <button type="button" className="btn" onClick={() => setEditing(null)} disabled={busy}>
                    取消
                  </button>
                  <button type="button" className="btn btn-primary" onClick={submitEdit} disabled={busy}>
                    <Check size={13} />
                    {busy ? '保存中…' : '保存正文'}
                  </button>
                </div>
              </div>
          </div>
        </Modal>
      )}
    </div>
  );
}