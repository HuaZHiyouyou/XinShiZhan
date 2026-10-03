import { useEffect, useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';

interface PasswordInputProps {
  value: string;
  onChange: (value: string) => void;
  id?: string;
  placeholder?: string;
  autoComplete?: 'current-password' | 'new-password' | 'off';
  maxLength?: number;
  disabled?: boolean;
  autoFocus?: boolean;
}

/**
 * 带独立显隐开关的密码输入框。
 *
 * 三个约定：
 * 1. 每个密码框都有**自己的**开关，确认密码不会跟着密码框一起被切换；
 * 2. 图标表达的是**当前状态**而不是「点一下会发生什么」——
 *    睁眼 = 此刻密码是明文可见的，斜杠眼 = 此刻是隐藏的；
 * 3. **空框不显示开关**。还没输入时那个眼睛只会让人以为「这里已经有密码了」，
 *    所以它只在真的敲进字符之后才出现；清空时连同「已显示」状态一起复位。
 */
export function PasswordInput({
  value,
  onChange,
  id,
  placeholder,
  autoComplete = 'current-password',
  maxLength = 128,
  disabled,
  autoFocus,
}: PasswordInputProps) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    /* 清空之后不该继续以明文展示，否则下次输入会直接裸奔 */
    if (!value && visible) setVisible(false);
  }, [value, visible]);

  return (
    <div className="input-affix">
      <input
        id={id}
        className="input"
        type={visible ? 'text' : 'password'}
        value={value}
        maxLength={maxLength}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete={autoComplete}
        spellCheck={false}
        disabled={disabled}
        autoFocus={autoFocus}
      />
      {/*
        开关常驻但空框时不可见：既满足「没输入就不该出现小眼睛」，
        又让三个密码框的内层宽度完全一致，不会因为谁多一个按钮就窄一截。
      */}
      <button
        type="button"
        className="btn-icon"
        data-hidden={value.length === 0}
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? '隐藏密码' : '显示密码'}
        aria-pressed={visible}
        aria-hidden={value.length === 0}
        tabIndex={value.length === 0 ? -1 : 0}
        title={visible ? '隐藏密码' : '显示密码'}
      >
        {visible ? <Eye size={15} /> : <EyeOff size={15} />}
      </button>
    </div>
  );
}
