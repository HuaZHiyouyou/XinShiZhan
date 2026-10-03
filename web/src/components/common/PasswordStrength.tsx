import { AlertTriangle, Check } from 'lucide-react';
import type { PasswordAssessment } from '@/lib/password';

/**
 * 密码强度提示条。
 *
 * 只提示、不拦截：达到站点最小长度就一定可以提交，
 * 强度条与建议是「帮你把密码变得更好」，而不是「不满足就不许注册」。
 */
export function PasswordStrength({ assessment }: { assessment: PasswordAssessment }) {
  if (assessment.level === 'empty') return null;

  const blocked = !assessment.meetsMinimum;

  return (
    <div className="pw-strength" data-level={assessment.level}>
      <div className="pw-meter" role="presentation">
        <span style={{ width: `${Math.max(6, assessment.percent)}%` }} />
      </div>

      <div className="pw-line">
        <span className="pw-label">
          {blocked ? (
            <>
              <AlertTriangle size={12} /> 长度不足
            </>
          ) : (
            <>
              <Check size={12} /> 强度{assessment.label}
            </>
          )}
        </span>
        <span className="faint">长度是最好用的那一维，长度够了普通密码也同样安全</span>
      </div>

      {assessment.suggestions.length > 0 && (
        <ul className="pw-tips">
          {assessment.suggestions.map((tip) => (
            <li key={tip}>{tip}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
