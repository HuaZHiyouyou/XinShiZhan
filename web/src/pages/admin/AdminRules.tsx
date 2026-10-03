import { useEffect, useState } from 'react';
import { Info, Save, Settings2 } from 'lucide-react';
import { api, ApiError } from '@/api/client';
import type { ReviewRules } from '@/api/types';
import { SkeletonList } from '@/components/common/Empty';
import { useAuth } from '@/store/auth';
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

export function AdminRules() {
  const me = useAuth((s) => s.user);
  const notify = useUi((s) => s.notify);
  const [rules, setRules] = useState<ReviewRules | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  /* 内容策略属于站点级开关，只有超级管理员能改 */
  const isAdmin = me?.role === 'superadmin';

  useEffect(() => {
    let alive = true;
    api.admin
      .rules()
      .then(({ rules: data }) => {
        if (alive) setRules(data);
      })
      .catch((error: unknown) => {
        if (alive) notify(error instanceof ApiError ? error.message : '规则加载失败', 'danger');
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [notify]);

  if (loading) return <SkeletonList rows={5} body={2} />;
  if (!rules) return null;

  const patch = (next: Partial<ReviewRules>) => setRules({ ...rules, ...next });

  const save = async () => {
    setSaving(true);
    try {
      const { rules: saved } = await api.admin.saveRules(rules);
      setRules(saved);
      notify('规则已保存，立即对新提交生效', 'success');
    } catch (error) {
      notify(error instanceof ApiError ? error.message : '保存失败', 'danger');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="stack">
      {!isAdmin && (
        <div className="card card-pad read-only-note">
          <Info size={15} />
          审核员可以查看规则，但只有管理员能修改。
        </div>
      )}

      <section className="card">
        <div className="card-head">
          <div className="card-title">
            <Settings2 size={15} />
            自动审核
            <span className="card-sub">先由机器过滤，再交给人工</span>
          </div>
          <button type="button" className="btn btn-sm btn-primary" onClick={save} disabled={!isAdmin || saving}>
            <Save size={13} />
            {saving ? '保存中…' : '保存规则'}
          </button>
        </div>

        <div className="card-pad stack">
          <Toggle
            checked={rules.autoReviewEnabled}
            onChange={(v) => patch({ autoReviewEnabled: v })}
            label="启用自动审核"
            desc="关闭后所有内容都会直接进入人工复核队列"
            disabled={!isAdmin}
          />
          <Toggle
            checked={rules.autoApproveDanmaku}
            onChange={(v) => patch({ autoApproveDanmaku: v })}
            label="弹幕自动放行"
            desc="未命中规则的弹幕可直接飘过，命中则转人工"
            disabled={!isAdmin}
          />
          <Toggle
            checked={rules.autoApproveMessages}
            onChange={(v) => patch({ autoApproveMessages: v })}
            label="留言自动放行"
            desc="未命中规则的留言直接可见"
            disabled={!isAdmin}
          />
          <Toggle
            checked={rules.linkNeedsReview}
            onChange={(v) => patch({ linkNeedsReview: v })}
            label="含链接转人工"
            desc="识别网址、加群、扫码等引流特征"
            disabled={!isAdmin}
          />
          <Toggle
            checked={rules.imageNeedsReview}
            onChange={(v) => patch({ imageNeedsReview: v })}
            label="带图转人工"
            desc="包含图片的心事一律先进入人工复核"
            disabled={!isAdmin}
          />
          <Toggle
            checked={rules.newUserNeedsReview}
            onChange={(v) => patch({ newUserNeedsReview: v })}
            label="新用户转人工"
            desc="注册时间不足设定天数的新住客，内容先转人工"
            disabled={!isAdmin}
          />
          <Toggle
            checked={rules.duplicateNeedsReview}
            onChange={(v) => patch({ duplicateNeedsReview: v })}
            label="重复内容转人工"
            desc="与本人近期内容高度相似的提交会转人工"
            disabled={!isAdmin}
          />
        </div>
      </section>

      <section className="card">
        <div className="card-head">
          <div className="card-title">
            <Settings2 size={15} />
            词表与阈值
          </div>
        </div>
        <div className="card-pad stack">
          <label className="field">
            <span className="field-label">黑名单词（命中即自动拒绝，逗号分隔）</span>
            <textarea
              className="textarea"
              rows={2}
              disabled={!isAdmin}
              value={rules.blockWords.join('，')}
              onChange={(e) =>
                patch({
                  blockWords: e.target.value
                    .split(/[,，\s]+/)
                    .map((w) => w.trim())
                    .filter(Boolean),
                })
              }
            />
          </label>

          <label className="field">
            <span className="field-label">敏感词（命中转人工，逗号分隔）</span>
            <textarea
              className="textarea"
              rows={2}
              disabled={!isAdmin}
              value={rules.softWords.join('，')}
              onChange={(e) =>
                patch({
                  softWords: e.target.value
                    .split(/[,，\s]+/)
                    .map((w) => w.trim())
                    .filter(Boolean),
                })
              }
            />
          </label>

          <div className="field-row">
            <label className="field">
              <span className="field-label">新用户判定天数</span>
              <input
                className="input"
                type="number"
                min={0}
                max={90}
                disabled={!isAdmin}
                value={rules.newUserDays}
                onChange={(e) => patch({ newUserDays: Number(e.target.value) })}
              />
            </label>
            <label className="field">
              <span className="field-label">每小时发布上限</span>
              <input
                className="input"
                type="number"
                min={1}
                max={50}
                disabled={!isAdmin}
                value={rules.maxPostsPerHour}
                onChange={(e) => patch({ maxPostsPerHour: Number(e.target.value) })}
              />
            </label>
            <label className="field">
              <span className="field-label">每小时留言上限</span>
              <input
                className="input"
                type="number"
                min={1}
                max={200}
                disabled={!isAdmin}
                value={rules.maxMessagesPerHour}
                onChange={(e) => patch({ maxMessagesPerHour: Number(e.target.value) })}
              />
            </label>
            <label className="field">
              <span className="field-label">每分钟弹幕上限</span>
              <input
                className="input"
                type="number"
                min={1}
                max={60}
                disabled={!isAdmin}
                value={rules.maxDanmakuPerMinute}
                onChange={(e) => patch({ maxDanmakuPerMinute: Number(e.target.value) })}
              />
            </label>
            <label className="field">
              <span className="field-label">相似度阈值（0.3 - 1）</span>
              <input
                className="input"
                type="number"
                min={0.3}
                max={1}
                step={0.01}
                disabled={!isAdmin}
                value={rules.duplicateThreshold}
                onChange={(e) => patch({ duplicateThreshold: Number(e.target.value) })}
              />
            </label>
          </div>
        </div>
      </section>

      <section className="card">
        <div className="card-head">
          <div className="card-title">
            <Settings2 size={15} />
            热度算法权重
            <span className="card-sub">修改后榜单会立即重新计算</span>
          </div>
        </div>
        <div className="card-pad stack">
          <div className="field-row">
            <label className="field">
              <span className="field-label">点赞权重</span>
              <input
                className="input"
                type="number"
                min={0}
                step={0.1}
                disabled={!isAdmin}
                value={rules.hotWeights.like}
                onChange={(e) => patch({ hotWeights: { ...rules.hotWeights, like: Number(e.target.value) } })}
              />
            </label>
            <label className="field">
              <span className="field-label">留言权重</span>
              <input
                className="input"
                type="number"
                min={0}
                step={0.1}
                disabled={!isAdmin}
                value={rules.hotWeights.message}
                onChange={(e) => patch({ hotWeights: { ...rules.hotWeights, message: Number(e.target.value) } })}
              />
            </label>
            <label className="field">
              <span className="field-label">弹幕权重</span>
              <input
                className="input"
                type="number"
                min={0}
                step={0.1}
                disabled={!isAdmin}
                value={rules.hotWeights.danmaku}
                onChange={(e) => patch({ hotWeights: { ...rules.hotWeights, danmaku: Number(e.target.value) } })}
              />
            </label>
            <label className="field">
              <span className="field-label">浏览权重</span>
              <input
                className="input"
                type="number"
                min={0}
                step={0.1}
                disabled={!isAdmin}
                value={rules.hotWeights.view}
                onChange={(e) => patch({ hotWeights: { ...rules.hotWeights, view: Number(e.target.value) } })}
              />
            </label>
            <label className="field">
              <span className="field-label">时间衰减指数</span>
              <input
                className="input"
                type="number"
                min={0.1}
                step={0.1}
                disabled={!isAdmin}
                value={rules.hotDecay}
                onChange={(e) => patch({ hotDecay: Number(e.target.value) })}
              />
            </label>
          </div>
          <div className="hint">当前公式：分数 = (点赞×{rules.hotWeights.like} + 留言×{rules.hotWeights.message} + 弹幕×{rules.hotWeights.danmaku} + 浏览×{rules.hotWeights.view}) ÷ (发布小时数 + 2) ^{rules.hotDecay}</div>
        </div>
      </section>
    </div>
  );
}