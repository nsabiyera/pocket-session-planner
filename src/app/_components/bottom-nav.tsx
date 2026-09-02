'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

/**
 * The bottom bar. Everything primary lives in the bottom ~35% of the viewport, which is the
 * only part of a phone a coach can reach one-handed while holding a ball.
 */
const ITEMS = [
  { href: '/', label: 'Today', icon: '◉' },
  { href: '/plan', label: 'Plan', icon: '✎' },
  { href: '/squad', label: 'Squad', icon: '👥' },
  { href: '/sessions', label: 'History', icon: '≡' },
] as const;

export function BottomNav() {
  const pathname = usePathname() ?? '/';

  return (
    <nav className="bottom-nav" aria-label="Main">
      {ITEMS.map((item) => {
        const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
        return (
          <Link key={item.href} href={item.href} aria-current={active ? 'page' : undefined}>
            <span className="nav-icon" aria-hidden="true">
              {item.icon}
            </span>
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
