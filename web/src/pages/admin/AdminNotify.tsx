import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Check, Loader2, Search, Send, Sparkles, X } from 'lucide-react';
import { api, ApiError } from '@/api/client';
import type { AdminUser, SiteMessageTargets } from '@/api/types';
import { Avatar } from '@/components/common/Avatar';
import { SkeletonList } from '@/components/common/Empty';
import { useAuth } from '@/store/auth';
import { useUi } from '@/store/ui';

type Audience = 'all' | 'registered' | 'role' | 'user';

const ROLE_LABEL: Record<string, string> = {
  superadmin: '超级管理员',
  admin: '管理员',
  reviewer: '审核员',
  user: '住客',
  guest: '访客',
};

const AUDIENCES: { value: Audience; label: string; desc: string }[] = [
  { value: 'registered', label: '全部正式账号', desc: '所有注册用户，不含访客' },
  { value: 'all', label: '全部账号', desc: '含访客账号在内的一切账号' },
  { value: 'role', label: '按角色', desc: '只发给某一个角色，例如全部住客或全部审核员' },
  { value: 'user', label: '指定用户', desc: '从账号列表里搜索并勾选，支持多选' },
];

/** 常用模板：站长不用每次从零写 */
const TEMPLATES = [
  {
    label: '站点维护通知',
    title: '站点维护说明',
    body: '我们会在近期对站点做一次维护，期间可能短暂无法访问。\n维护完成后会在这里同步进展，感谢你的耐心。',
  },
  {
    label: '审核规则提醒',
    title: '关于内容规范的说明',
    body: '最近收到一些关于内容规范的反馈。\n这里想提醒一下：匿名是为了让表达更自由，不是为了省略对他人的尊重。\n被举报且核实的内容会被下架，多次违规会累计记录。',
  },
  {
    label: '感谢与回应',
    title: '谢谢你留在这里',
    body: '看到很多人在认真回应陌生人的情绪，这件事本身就很好。\n如果有什么想说的、想改的，随时可以回复这条站内信。',
  },
];

const TITLE_MAX = 60;
const BODY_MAX = 600;

/** 搜索并勾选收件人：手打用户名容易拼错，还不如直接看着账号挑 */
function UserPicker({
  selected,
  onToggle,
}: {
  selected: AdminUser[];
  onToggle: (user: AdminUser) => void;
}) {
  const [keyword, setKeyword] = useState('');
  const [list, setList] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    /* 防抖：打字过程中不必每个字都打一次接口 */
    const timer = window.setTimeout(() => {
      api.admin
        .users({ q: keyword.trim(), limit: 20 })
        .then(({ users }) => alive && setList(users))
        .catch(() => alive && setList([]))
        .finally(() => alive && setLoading(false));
    }, 240);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [keyword]);

  const chosen = new Set(selected.map((user) => user.id));

  return (
    <div className="field">
      <span className="field-label">
        收件人
        <span className="faint" style={{ marginLeft: 6, fontSize: 11 }}>
          已选 {selected.length} 人
        </span>
      </span>

      {selected.length > 0 && (
        <div className="pick-chosen">
          {selected.map((user) => (
            <button key={user.id} type="button" className="pick-chip" onClick={() => onToggle(user)}>
              <Avatar name={user.anonName} color={user.anonColor} src={user.avatarUrl} size="sm" />
              <span>{user.anonName}</span>
              <span className="faint mono">@{user.username}</span>
              <X size={12} />
            </button>
          ))}
        </div>
      )}

      <div className="input-affix">
        <Search size={14} />
        <input
          className="input"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          placeholder="搜索昵称、用户名或用户编号 UID"
          aria-label="搜索收件人"
        />
        {loading && <Loader2 size={14} className="spin" />}
      </div>

      <div className="pick-list" role="listbox" aria-multiselectable="true">
        {list.length === 0 && !loading && <p className="hint">没有匹配的账号</p>}
        {list.map((user) => {
          const active = chosen.has(user.id);
          return (
            <button
              key={user.id}
              type="button"
              role="option"
              aria-selected={active}
              className="pick-row"
              data-active={active}
              onClick={() => onToggle(user)}
            >
              <Avatar name={user.anonName} color={user.anonColor} src={user.avatarUrl} size="sm" />
              <span className="pick-name">{user.anonName}</span>
              <span className="faint mono pick-account">@{user.username}</span>
              {user.uid ? <span className="faint mono">UID {user.uid}</span> : null}
              <span className="tag">{ROLE_LABEL[user.role] || user.role}</span>
              <span className="pick-mark" data-active={active}>
                {active && <Check size={12} />}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function AdminNotify() {
  const me = useAuth((s) => s.user);
  const notify = useUi((s) => s.notify);

  const [targets, setTargets] = useState<SiteMessageTargets | null>(null);
  const [loading, setLoading] = useState(true);
  const [audience, setAudience] = useState<Audience>('registered');
  const [role, setRole] = useState('user');
  const [selected, setSelected] = useState<AdminUser[]>([]);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  /* 勾上后收件人下次进站会弹窗提醒一次（不即时打扰） */
  const [popup, setPopup] = useState(false);
  const [busy, setBusy] = useState(false);

  const canSend = me?.role === 'superadmin';

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setTargets(await api.admin.siteMessageTargets());
    } catch (error) {
      notify(error instanceof ApiError ? error.message : '收件人统计加载失败', 'danger');
      setTargets(null);
    } finally {
      setLoading(false);
    }
  }, [notify]);

  useEffect(() => {
    load();
  }, [load]);

  /* 收件人预览：发出去之前先知道会打扰多少人 */
  const preview = useMemo(() => {
    if (!targets) return 0;
    if (audience === 'all') return targets.total;
    if (audience === 'registered') return targets.registered;
    if (audience === 'role') return targets.roles.find((item) => item.role === role)?.count ?? 0;
    return selected.length;
  }, [targets, audience, role, selected]);

  const toggleUser = (user: AdminUser) => {
    setSelected((prev) => (prev.some((item) => item.id === user.id) ? prev.filter((item) => item.id !== user.id) : [...prev, user]));
  };

  const send = async () => {
    setBusy(true);
    try {
      const result = await api.admin.sendSiteMessage({
        audience,
        role: audience === 'role' ? role : undefined,
        targets: audience === 'user' ? selected.map((user) => user.username) : undefined,
        title: title.trim(),
        body: body.trim(),
        popup,
      });
      const base = result.missing?.length
        ? `已发送给 ${result.sent} 人；未找到：${result.missing.join('、')}`
        : `已发送给 ${result.sent} 人`;
      notify(popup ? `${base}；他们下次进站会看到弹窗提醒` : base, 'success');
      setTitle('');
      setBody('');
      setSelected([]);
      setPopup(false);
      await load();
    } catch (error) {
      notify(error instanceof ApiError ? error.message : '发送失败', 'danger');
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <SkeletonList rows={3} body={2} />;

  if (!canSend) {
    return (
      <div className="card card-pad read-only-note">
        <AlertTriangle size={15} />
        <div className="grow">
          站内回复目前只对站长（超级管理员）开放。后续会逐步放开给值班成员，届时这里会同步说明。
        </div>
      </div>
    );
  }

  const valid = Boolean(title.trim() && body.trim() && preview > 0);

  return (
    <div className="stack" style={{ gap: 'var(--sp-5)' }}>
      <section className="card card-pad">
        <div className="section-title">
          <Send size={14} />
          站内回复
          <span className="card-sub">给指定人群发一条站内信，会出现在对方的「站内信」里</span>
        </div>

        {/* 每个设置项独立成块，块与块之间留出明显间隔 */}
        <div className="form-blocks">
          <div className="field">
            <span className="field-label">发给谁</span>
            <div className="choice-row">
              {AUDIENCES.map((item) => (
                <button
                  key={item.value}
                  type="button"
                  className="choice-chip"
                  data-active={audience === item.value}
                  onClick={() => setAudience(item.value)}
                >
                  {item.label}
                </button>
              ))}
            </div>
            <span className="field-hint">{AUDIENCES.find((item) => item.value === audience)?.desc}</span>
          </div>

          {audience === 'role' && (
            <div className="field">
              <span className="field-label">角色</span>
              <div className="choice-row">
                {(targets?.roles || []).map((item) => (
                  <button
                    key={item.role}
                    type="button"
                    className="choice-chip"
                    data-active={role === item.role}
                    onClick={() => setRole(item.role)}
                  >
                    {ROLE_LABEL[item.role] || item.role}
                    <span className="faint">（{item.count}）</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {audience === 'user' && <UserPicker selected={selected} onToggle={toggleUser} />}

          <div className="field">
            <span className="field-label">快捷模板</span>
            <div className="choice-row">
              {TEMPLATES.map((item) => (
                <button
                  key={item.label}
                  type="button"
                  className="choice-chip"
                  onClick={() => {
                    setTitle(item.title);
                    setBody(item.body);
                  }}
                >
                  <Sparkles size={12} />
                  {item.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="card card-pad">
        <div className="section-title">
          <Send size={14} />
          写点什么
        </div>

        <div className="form-blocks">
          <label className="field">
            <span className="field-label">
              标题
              <span className="faint" style={{ marginLeft: 6, fontSize: 11 }}>
                {title.length}/{TITLE_MAX}
              </span>
            </span>
            <input
              className="input"
              value={title}
              maxLength={TITLE_MAX}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="一句话说清这封信是关于什么的"
            />
          </label>

          <label className="field">
            <span className="field-label">
              正文
              <span className="faint" style={{ marginLeft: 6, fontSize: 11 }}>
                {body.length}/{BODY_MAX}
              </span>
            </span>
            <textarea
              className="textarea"
              rows={6}
              maxLength={BODY_MAX}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="写清楚发生了什么、影响是什么、希望大家做什么。换行会原样保留。"
            />
          </label>
        </div>

        {/* 弹窗提醒是「下一次进站」才生效的：正在写东西的人不该被临时公告打断 */}
        <label className="switch-row">
          <input type="checkbox" checked={popup} onChange={(e) => setPopup(e.target.checked)} />
          <span>
            <strong>下次进站时弹窗提醒</strong>
            <span className="faint">
              不会当场打断任何人 —— 收件人下次打开站点时弹出一次，关掉后不再弹
            </span>
          </span>
        </label>

        <div className="notify-send-bar">
          <span className="row" style={{ gap: 6 }}>
            <Send size={13} />
            <span className="muted" style={{ fontSize: 12 }}>
              将发送给 <strong>{preview}</strong> 人
              {popup ? '，并弹窗提醒' : ''}
            </span>
          </span>
          <button type="button" className="btn btn-primary" onClick={send} disabled={busy || !valid}>
            {busy ? <Loader2 size={14} className="spin" /> : <Send size={14} />}
            {busy ? '发送中…' : '发送站内回复'}
          </button>
        </div>
      </section>
    </div>
  );
}
