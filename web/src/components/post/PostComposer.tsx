import { useRef, useState } from 'react';
import { CalendarClock, ChevronDown, Eye, EyeOff, ImagePlus, PenLine, Send, Timer, X } from 'lucide-react';
import { api, ApiError } from '@/api/client';
import type { Post, Visibility } from '@/api/types';
import { DatePicker } from '@/components/common/DatePicker';
import { MOODS, TAGS } from '@/lib/constants';
import { fromLocalInput } from '@/lib/format';
import { useAuth } from '@/store/auth';
import { useFx } from '@/store/fx';
import { useUi } from '@/store/ui';

interface Props {
  onCreated: (post: Post) => void;
  defaultOpen?: boolean;
}

export function PostComposer({ onCreated, defaultOpen = false }: Props) {
  const user = useAuth((s) => s.user);
  const notify = useUi((s) => s.notify);
  const openAuth = useUi((s) => s.openAuth);
  const pulse = useFx((s) => s.pulse);

  const [open, setOpen] = useState(defaultOpen);
  const [content, setContent] = useState('');
  const [mood, setMood] = useState('plain');
  const [tags, setTags] = useState<string[]>([]);
  const [images, setImages] = useState<string[]>([]);
  const [visibility, setVisibility] = useState<Visibility>('public');
  const [publishAt, setPublishAt] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [scheduled, setScheduled] = useState(false);
  const [limited, setLimited] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  /* 未登录 → 去登录；访客只读 → 去注册。两种情况都给一句「为什么」 */
  if (!user || user.isGuest) {
    const isGuest = Boolean(user?.isGuest);
    return (
      <div className="card composer-gate card-pad">
        <div className="row-between">
          <div>
            <div className="section-title" style={{ marginBottom: 2 }}>
              <PenLine size={15} />
              写下此刻的心事
            </div>
            <div className="muted" style={{ fontSize: 12 }}>
              {isGuest
                ? '访客账号只能浏览全站内容。注册后即可发布心事、收到回应'
                : '登录后会得到一个匿名身份，别人只能看到它'}
            </div>
          </div>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => openAuth(isGuest ? 'register' : 'login')}
          >
            {isGuest ? '注册后发布' : '登录后发布'}
          </button>
        </div>
      </div>
    );
  }

  const pickFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    const room = 9 - images.length;
    if (room <= 0) {
      notify('最多只能带 9 张图', 'warning');
      return;
    }
    setUploading(true);
    try {
      const { urls } = await api.uploads.images(Array.from(files).slice(0, room));
      setImages((prev) => [...prev, ...urls]);
    } catch (error) {
      notify(error instanceof ApiError ? error.message : '图片上传失败', 'danger');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const toggleTag = (tag: string) => {
    setTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : prev.length >= 4 ? prev : [...prev, tag]
    );
  };

  const reset = () => {
    setContent('');
    setMood('plain');
    setTags([]);
    setImages([]);
    setVisibility('public');
    setPublishAt('');
    setExpiresAt('');
    setScheduled(false);
    setLimited(false);
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const text = content.trim();
    if (!text) {
      notify('先写点什么吧', 'warning');
      return;
    }
    setSubmitting(true);
    try {
      const { post, review } = await api.posts.create({
        content: text,
        mood,
        tags,
        images,
        visibility,
        publishAt: scheduled ? fromLocalInput(publishAt) : null,
        expiresAt: limited ? fromLocalInput(expiresAt) : null,
      });
      onCreated(post);
      reset();
      setOpen(false);
      if (review.status === 'published') {
        if (post.lifecycle !== 'scheduled') pulse();
        notify(
          post.lifecycle === 'scheduled' ? '已排入定时发布' : '心事已发布',
          'success'
        );
      } else if (review.status === 'manual_review') {
        notify(`已提交人工复核：${review.flags.join('；')}`, 'warning');
      } else {
        notify(`未通过自动审核：${review.flags.join('；')}`, 'danger');
      }
    } catch (error) {
      notify(error instanceof ApiError ? error.message : '发布失败', 'danger');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form className="card composer" onSubmit={submit}>
      <button
        type="button"
        className="composer-head"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className="card-title">
          <PenLine size={15} />
          写下此刻的心事
          <span className="card-sub">匿名发布，只留下此刻的情绪</span>
        </span>
        <ChevronDown size={16} className={`chev ${open ? 'chev-open' : ''}`} />
      </button>

      {open && (
        <div className="composer-body">
          <textarea
            className="textarea composer-textarea"
            value={content}
            maxLength={1000}
            onChange={(e) => setContent(e.target.value)}
            placeholder="今天发生了什么？说不出口的部分，可以留在这里。"
            rows={5}
          />

          {images.length > 0 && (
            <div className="composer-images">
              {images.map((src) => (
                <div key={src} className="composer-image">
                  <img src={src} alt="待发布配图" />
                  <button
                    type="button"
                    className="composer-image-remove"
                    onClick={() => setImages((prev) => prev.filter((s) => s !== src))}
                    aria-label="移除图片"
                  >
                    <X size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="composer-row">
            <div className="composer-group">
              <span className="composer-label">心情</span>
              <div className="composer-chips">
                {MOODS.map((item) => (
                  <button
                    key={item.value}
                    type="button"
                    className="chip"
                    data-active={mood === item.value}
                    style={{ '--chip-color': `var(--${item.token})` } as React.CSSProperties}
                    onClick={() => setMood(item.value)}
                  >
                    <span className="dot" style={{ background: `var(--${item.token})` }} />
                    {item.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="composer-row">
            <div className="composer-group">
              <span className="composer-label">标签（最多 4 个）</span>
              <div className="composer-chips">
                {TAGS.map((tag) => (
                  <button
                    key={tag}
                    type="button"
                    className="chip"
                    data-active={tags.includes(tag)}
                    onClick={() => toggleTag(tag)}
                  >
                    {tag}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="composer-row composer-row-split">
            <div className="composer-group">
              <span className="composer-label">可见范围</span>
              <div className="segmented">
                <button
                  type="button"
                  data-active={visibility === 'public'}
                  onClick={() => setVisibility('public')}
                >
                  <Eye size={13} />
                  公开
                </button>
                <button
                  type="button"
                  data-active={visibility === 'private'}
                  onClick={() => setVisibility('private')}
                >
                  <EyeOff size={13} />
                  仅自己可见
                </button>
              </div>
            </div>

            <div className="composer-group">
              <span className="composer-label">发布方式</span>
              <div className="segmented">
                <button
                  type="button"
                  data-active={!scheduled && !limited}
                  onClick={() => {
                    setScheduled(false);
                    setLimited(false);
                  }}
                >
                  立即
                </button>
                <button
                  type="button"
                  data-active={scheduled}
                  onClick={() => setScheduled((v) => !v)}
                >
                  <CalendarClock size={13} />
                  定时发布
                </button>
                <button type="button" data-active={limited} onClick={() => setLimited((v) => !v)}>
                  <Timer size={13} />
                  限时发布
                </button>
              </div>
            </div>
          </div>

          {(scheduled || limited) && (
            <div className="composer-row composer-row-split">
              {scheduled && (
                <div className="field">
                  <span className="field-label">上线时间</span>
                  <DatePicker
                    value={publishAt}
                    onChange={setPublishAt}
                    withTime
                    placeholder="选择上线时间"
                    ariaLabel="选择上线时间"
                  />
                </div>
              )}
              {limited && (
                <div className="field">
                  <span className="field-label">下架时间</span>
                  <DatePicker
                    value={expiresAt}
                    onChange={setExpiresAt}
                    withTime
                    placeholder="选择下架时间"
                    ariaLabel="选择下架时间"
                  />
                </div>
              )}
            </div>
          )}

          <div className="composer-foot">
            <div className="row" style={{ gap: 'var(--sp-2)' }}>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                multiple
                hidden
                onChange={(e) => pickFiles(e.target.files)}
              />
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => fileRef.current?.click()}
                disabled={uploading || images.length >= 9}
              >
                <ImagePlus size={14} />
                {uploading ? '上传中…' : `配图 ${images.length}/9`}
              </button>
              <span className="hint">带图内容会自动转人工确认</span>
            </div>

            <div className="row" style={{ gap: 'var(--sp-2)' }}>
              <span className="hint mono">{content.length}/1000</span>
              <button type="submit" className="btn btn-primary" disabled={submitting || !content.trim()}>
                <Send size={14} />
                {submitting ? '发布中…' : '发布'}
              </button>
            </div>
          </div>
        </div>
      )}
    </form>
  );
}