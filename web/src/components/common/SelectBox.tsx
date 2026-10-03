import { Check } from 'lucide-react';

interface Props {
  checked: boolean;
  onChange: () => void;
  /** 无障碍名称，例如「选中心事 #12」 */
  label: string;
}

/**
 * 批量操作用的勾选框。
 *
 * 后台各张列表的批量选择都用它，样式与语义统一：
 * 与其在各页各写一个 `input[type=checkbox]`，不如只改这一个地方。
 */
export function SelectBox({ checked, onChange, label }: Props) {
  return (
    <button
      type="button"
      className="select-box"
      data-checked={checked}
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      title={label}
      onClick={(event) => {
        /* 列表行本身可能也带点击行为（展开、跳转），别让勾选顺带触发它们 */
        event.stopPropagation();
        onChange();
      }}
    >
      {checked && <Check size={12} />}
    </button>
  );
}
