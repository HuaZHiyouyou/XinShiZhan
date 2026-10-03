import { useEffect, useState } from 'react';
import { X } from 'lucide-react';

export function ImageGrid({ images, alt }: { images: string[]; alt: string }) {
  const [active, setActive] = useState<string | null>(null);

  useEffect(() => {
    if (!active) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setActive(null);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [active]);

  if (!images.length) return null;

  return (
    <>
      <div className="image-grid" data-count={Math.min(images.length, 3)}>
        {images.map((src, i) => (
          <button key={src + i} type="button" className="image-cell" onClick={() => setActive(src)}>
            <img src={src} alt={`${alt} 配图 ${i + 1}`} loading="lazy" />
          </button>
        ))}
      </div>

      {active && (
        <div className="lightbox" onClick={() => setActive(null)} role="dialog" aria-modal="true">
          <button type="button" className="lightbox-close" aria-label="关闭大图">
            <X size={18} />
          </button>
          <img src={active} alt={alt} onClick={(e) => e.stopPropagation()} />
        </div>
      )}
    </>
  );
}