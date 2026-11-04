'use client';
import { useEffect } from 'react';
import Link from 'next/link';
import { LOCAL_API_BASE } from '@/lib/local-api';
/** The approved standalone front end is the application; no legacy page is mounted inside it. */
export function CompactEntry() {
  useEffect(() => {
    const target = new URL('/design-review/index.html', window.location.origin);
    target.hash = window.location.hash || '#today';
    target.search = window.location.search;
    if (!target.searchParams.has('apiPort'))
      target.searchParams.set('apiPort', new URL(LOCAL_API_BASE).port || '80');
    window.location.replace(target.href);
  }, []);
  return (
    <main>
      <Link prefetch={false} href="/design-review/index.html#today">
        打开工作平台 / Open workbench
      </Link>
    </main>
  );
}
