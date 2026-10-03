import { colorHex } from '@/lib/constants';
import { initials } from '@/lib/format';

interface Props {
  name: string;
  color: string;
  src?: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  /** 传入后头像可点击放大查看（审核、资料预览等需要看清细节的场景） */
  onZoom?: () => void;
}

export function Avatar({ name, color, src, size = 'md', className = '', onZoom }: Props) {
  const hex = colorHex(color);
  const cls = size === 'sm' ? 'avatar avatar-sm' : size === 'lg' ? 'avatar avatar-lg' : 'avatar';

  if (src) {
    const image = (
      <span className={`${cls} avatar-img ${className}`.trim()} aria-hidden="true">
        <img src={src} alt="" loading="lazy" />
      </span>
    );

    if (!onZoom) return image;

    return (
      <button type="button" className="avatar-zoom" onClick={onZoom} title="点击查看大图" aria-label={`查看 ${name} 的头像大图`}>
        {image}
      </button>
    );
  }

  return (
    <span
      className={`${cls} ${className}`.trim()}
      style={{ color: hex, borderColor: `${hex}59`, background: `${hex}1f` }}
      aria-hidden="true"
    >
      {initials(name)}
    </span>
  );
}