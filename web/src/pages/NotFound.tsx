import { Link } from 'react-router-dom';
import { Compass } from 'lucide-react';
import { Empty } from '@/components/common/Empty';

export function NotFound() {
  return (
    <Empty
      icon={<Compass size={26} />}
      title="这里没有内容"
      desc="页面可能已经被移走，或者链接不太对"
      action={
        <Link className="btn btn-sm" to="/" style={{ marginTop: 'var(--sp-2)' }}>
          回到心事广场
        </Link>
      }
    />
  );
}