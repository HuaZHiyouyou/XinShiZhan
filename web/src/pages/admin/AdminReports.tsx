import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, Check, CheckCheck, MessageSquareReply, Trash2, XCircle } from 'lucide-react';
import { api, ApiError } from '@/api/client';
import type { ReportItem } from '@/api/types';
import { Avatar } from '@/components/common/Avatar';
import { Empty, SkeletonList } from '@/components/common/Empty';
import { Modal } from '@/components/common/Modal';
import { SelectBox } from '@/components/common/SelectBox';
import { formatDateTime, relativeTime } from '@/lib/format';
import { useBodyScrollLock } from '@/lib/useBodyScrollLock';
import { useAuth } from '@/store/auth';
import { useUi } from '@/store/ui';

const STATUSES = [
  { value: 'open', label: '待处理' },
  { value: 'dismissed', label: '已忽略' },
  { value: 'removed', label: '已删除' },
];

/** 常用处理说明：点一下就能填，也允许自己写 */
const NOTE_PRESETS = [
  '内容已核实，已下架并提醒作者',
  '内容已核实，但未达到违规标准，我们会继续观察',
  '多次发布同类内容，已记录违规次数',
  '感谢反馈，这次属于误报',
];

const NOTE_MAX = 200;

export function AdminReports() {
  const notify = useUi((s) => s.notify);
  const me = useAuth((s) => s.user);
  const isSuperAdmin = me?.role === 'superadmin';
  const [status, setStatus] = useState('open');
  const [reports, setReports] = useState<ReportItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [target, setTarget] = useState<{ report: ReportItem; action: 'remove' | 'dismiss' } | null>(null);
  /* 批量与单条共用同一个弹窗：说明都是一句话对整批生效，没必要做两套界面 */
  const [batchAction, setBatchAction] = useState<'remove' | 'dismiss' | null>(null);
  const [selected, setSelected] = useState<number[]>([]);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  useBodyScrollLock(Boolean(target) || Boolean(batchAction));

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.admin.reports(status);
      setReports(data.reports);
      setSelected([]);
    } catch (error) {
      notify(error instanceof ApiError ? error.message : '加载失败', 'danger');
      setReports([]);
    } finally {
      setLoading(false);
    }
  }, [status, notify]);

  useEffect(() => {
    load();
  }, [load]);

  const openDialog = (report: ReportItem, action: 'remove' | 'dismiss') => {
    setTarget({ report, action });
    setNote('');
  };

  const openBatch = (action: 'remove' | 'dismiss') => {
    if (!selected.length) return;
    setBatchAction(action);
    setNote('');
  };

  const closeDialog = () => {
    setTarget(null);
    setBatchAction(null);
  };

  const toggle = (id: number) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((v) => v !== id) : [...prev, id]));

  const submit = async () => {
    if (!target && !batchAction) return;
    const action = batchAction || target!.action;
    setBusy(true);
    try {
      if (batchAction) {
        const result = await api.admin.reportsBatch(selected, batchAction, note.trim());
        const skipped = result.blocked?.length || 0;
        const verb = batchAction === 'remove' ? '删除' : '忽略';
        notify(
          skipped ? `已${verb} ${result.done} 条，${skipped} 条越权未处理` : `已${verb} ${result.done} 条，回执已送达`,
          skipped ? 'warning' : 'success'
        );
      } else {
        await api.admin.resolveReport(target!.report.id, action, note.trim());
        notify(action === 'remove' ? '内容已删除，并已回复举报人' : '已忽略该举报，并已回复举报人', 'success');
      }
      closeDialog();
      await load();
    } catch (error) {
      notify(error instanceof ApiError ? error.message : '操作失败', 'danger');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card">
      <div className="card-head review-head">
        <div className="segmented">
          {STATUSES.map((item) => (
            <button
              key={item.value}
              type="button"
              data-active={status === item.value}
              onClick={() => setStatus(item.value)}
            >
              {item.label}
            </button>
          ))}
        </div>
        <span className="hint">共 {reports.length} 条</span>
      </div>

      {!loading && status === 'open' && reports.length > 0 && (
        <div className="batch-bar">
          <span className="batch-count">已选 {selected.length} 条</span>
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => setSelected(reports.map((r) => r.id))}
            disabled={selected.length === reports.length}
          >
            <CheckCheck size={13} />
            全选本页
          </button>
          <button type="button" className="btn btn-sm" onClick={() => setSelected([])} disabled={!selected.length}>
            清空
          </button>
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => openBatch('dismiss')}
            disabled={!selected.length || busy}
          >
            <XCircle size={13} />
            批量忽略（{selected.length}）
          </button>
          <button
            type="button"
            className="btn btn-sm btn-danger"
            onClick={() => openBatch('remove')}
            disabled={!selected.length || busy}
          >
            <Trash2 size={13} />
            批量删除内容（{selected.length}）
          </button>
        </div>
      )}

      {loading ? (
        <SkeletonList rows={4} body={2} />
      ) : reports.length === 0 ? (
        <Empty icon={<AlertTriangle size={26} />} title="没有需要处理的举报" />
      ) : (
        <div className="admin-table">
          {reports.map((report) => (
            <article key={report.id} className="admin-row" data-checked={selected.includes(report.id)}>
              {status === 'open' && (
                <SelectBox
                  checked={selected.includes(report.id)}
                  onChange={() => toggle(report.id)}
                  label={`选中举报 #${report.id}`}
                />
              )}
              <div className="grow" style={{ minWidth: 0 }}>
                <div className="row" style={{ gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
                  <span className="tag tag-danger">{report.reason}</span>
                  <span className="tag">{report.targetType === 'post' ? '心事' : '留言'}</span>
                  <span className="mono faint">#{report.targetId}</span>
                  <span className="meta-dot" />
                  <span className="faint" title={formatDateTime(report.createdAt)}>
                    {relativeTime(report.createdAt)}
                  </span>
                </div>

                <p className="admin-excerpt">{report.excerpt}</p>

                {/* 举报人写的补充描述：值班的人据此判断，不再只看到一个理由标签 */}
                {report.detail ? (
                  <div className="report-quote">
                    <MessageSquareReply size={13} />
                    <div className="grow">
                      <span className="report-quote-label">举报人补充说明</span>
                      {report.detail}
                    </div>
                  </div>
                ) : (
                  <p className="hint" style={{ marginTop: 'var(--sp-2)' }}>
                    举报人没有填写补充说明
                  </p>
                )}

                <div className="admin-stats">
                  <Avatar name={report.reporter.anonName} color={report.reporter.anonColor} size="sm" />
                  <span>举报人 {report.reporter.anonName}</span>
                  {report.reporter.uid ? <span className="mono">UID {report.reporter.uid}</span> : null}
                  {report.reporter.username && <span className="mono">@{report.reporter.username}</span>}
                  {report.targetType === 'post' && (
                    <Link className="link-btn" to={`/post/${report.targetId}`}>
                      查看原内容
                    </Link>
                  )}
                </div>

                {/* 与举报相关的当事人不能自己拍板：非超管直接挡下，超管可以自行裁决 */}
                {report.self && (
                  <div className="admin-ban-note admin-note-muted">
                    <AlertTriangle size={12} />
                    {isSuperAdmin
                      ? '你与这条举报有关（举报人或当事人是你），只能由你自行裁决，操作会记入审计日志'
                      : '你与这条举报有关，不能由你自己处理，请交给超级管理员'}
                  </div>
                )}

                {report.handledAt && (
                  <div className={`admin-ban-note ${report.status === 'removed' ? '' : 'admin-note-muted'}`}>
                    <Check size={12} />
                    已由管理员于 {formatDateTime(report.handledAt)} 处理
                    {report.handledNote ? `：${report.handledNote}` : '（未填写说明）'}
                  </div>
                )}
              </div>

              {status === 'open' && (
                <div className="admin-actions">
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => openDialog(report, 'dismiss')}
                    disabled={report.self && !isSuperAdmin}
                    title={report.self && !isSuperAdmin ? '与自己相关的举报不能自己处理' : undefined}
                  >
                    <XCircle size={13} />
                    忽略
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm btn-danger"
                    onClick={() => openDialog(report, 'remove')}
                    disabled={report.self && !isSuperAdmin}
                    title={report.self && !isSuperAdmin ? '与自己相关的举报不能自己处理' : undefined}
                  >
                    <Trash2 size={13} />
                    删除内容
                  </button>
                </div>
              )}
            </article>
          ))}
        </div>
      )}

      {(target || batchAction) && (
        <Modal maxWidth={520}>
          <div className="card-head">
            <div className="card-title">
              {(batchAction || target?.action) === 'remove' ? <Trash2 size={15} /> : <XCircle size={15} />}
              {batchAction
                ? batchAction === 'remove'
                  ? `删除选中的 ${selected.length} 条被举报内容`
                  : `忽略选中的 ${selected.length} 条举报`
                : target?.action === 'remove'
                  ? '删除被举报的内容'
                  : '忽略这条举报'}
            </div>
          </div>

          <div className="card-pad stack">
            <div className="form-note">
              {target ? (
                <>
                  <div>
                    <strong>{target.report.reason}</strong>
                    <span className="faint"> · 举报人 {target.report.reporter.anonName}</span>
                  </div>
                  {target.report.detail && (
                    <div style={{ marginTop: 6, fontSize: 12 }}>补充说明：{target.report.detail}</div>
                  )}
                </>
              ) : (
                <div>
                  已选中 <strong>{selected.length}</strong> 条待处理举报。
                </div>
              )}
              <div style={{ marginTop: 6, fontSize: 12 }} className="faint">
                {(batchAction || target?.action) === 'remove'
                  ? batchAction
                    ? '这些内容会被永久删除，对应的举报一并标记为已处理。'
                    : '该内容会被永久删除，举报标记为已处理。'
                  : batchAction
                    ? '这些内容会原样保留，对应的举报一并标记为已忽略。'
                    : '内容会原样保留，举报标记为已忽略。'}
              </div>
            </div>

            <div className="field">
              <span className="field-label">
                给举报人的说明
                <span className="faint" style={{ marginLeft: 6, fontSize: 11 }}>
                  选填，会随回执一起送达
                </span>
              </span>
              <textarea
                className="textarea"
                rows={3}
                maxLength={NOTE_MAX}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="留空则发送一句通用回执；填了就按你写的发给举报人"
              />
              <div className="row" style={{ gap: 'var(--sp-2)', flexWrap: 'wrap', marginTop: 'var(--sp-2)' }}>
                {NOTE_PRESETS.map((text) => (
                  <button key={text} type="button" className="tag" onClick={() => setNote(text)}>
                    {text}
                  </button>
                ))}
              </div>
            </div>

            <div className="row" style={{ justifyContent: 'flex-end' }}>
              <button type="button" className="btn" onClick={closeDialog} disabled={busy}>
                取消
              </button>
              <button
                type="button"
                className={(batchAction || target?.action) === 'remove' ? 'btn btn-danger' : 'btn btn-primary'}
                onClick={submit}
                disabled={busy}
              >
                {busy
                  ? '处理中…'
                  : (batchAction || target?.action) === 'remove'
                    ? batchAction
                      ? `确认删除 ${selected.length} 条并回复`
                      : '确认删除并回复'
                    : batchAction
                      ? `确认忽略 ${selected.length} 条并回复`
                      : '确认忽略并回复'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
