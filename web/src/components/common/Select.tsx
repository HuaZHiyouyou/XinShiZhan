import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, ChevronDown } from 'lucide-react';

export interface SelectOption {
  value: string;
  label: string;
}

interface Props {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  size?: 'sm' | 'md';
  align?: 'start' | 'end';
  disabled?: boolean;
  ariaLabel?: string;
  className?: string;
}

export function Select({
  value,
  options,
  onChange,
  size = 'md',
  align = 'start',
  disabled = false,
  ariaLabel,
  className = '',
}: Props) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);

  const selectedIndex = options.findIndex((option) => option.value === value);
  const selected = selectedIndex >= 0 ? options[selectedIndex] : undefined;

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event: MouseEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open]);

  useEffect(() => {
    if (open) setActive(selectedIndex >= 0 ? selectedIndex : 0);
  }, [open, selectedIndex]);

  const commit = (index: number) => {
    const option = options[index];
    if (!option) return;
    onChange(option.value);
    setOpen(false);
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (disabled) return;

    if (!open) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key)) {
        event.preventDefault();
        setOpen(true);
      }
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      setOpen(false);
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive((index) => Math.min(options.length - 1, index + 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((index) => Math.max(0, index - 1));
    } else if (event.key === 'Home') {
      event.preventDefault();
      setActive(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      setActive(options.length - 1);
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      commit(active);
    }
  };

  return (
    <div className={`pill-select pill-select-${size} ${className}`.trim()} ref={wrapRef}>
      <button
        type="button"
        className="pill-select-trigger"
        data-open={open}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={onKeyDown}
      >
        <span className="pill-select-value">{selected?.label ?? ''}</span>
        <ChevronDown className="pill-select-caret" size={size === 'sm' ? 13 : 14} />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            className={`pill-select-panel pill-select-panel-${align}`}
            role="listbox"
            aria-label={ariaLabel}
            initial={{ opacity: 0, y: -6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.97 }}
            transition={{ duration: 0.14, ease: [0.4, 0, 0.2, 1] }}
          >
            {options.map((option, index) => (
              <button
                key={option.value || `option-${index}`}
                type="button"
                role="option"
                aria-selected={option.value === value}
                className="pill-select-option"
                data-active={index === active}
                data-selected={option.value === value}
                tabIndex={-1}
                onMouseEnter={() => setActive(index)}
                onClick={() => commit(index)}
              >
                <span className="pill-select-check">{option.value === value && <Check size={12} />}</span>
                {option.label}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}