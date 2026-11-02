'use client';

import { useEffect, useRef, type ReactNode } from 'react';

/** Publish the actual chrome height so worksheet controls never slide behind it. */
export function WorkspaceHeader({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const header = ref.current;
    if (!header) return;
    const update = () =>
      document.documentElement.style.setProperty(
        '--workbench-header-height',
        `${Math.ceil(header.getBoundingClientRect().height)}px`,
      );
    update();
    const observer = new ResizeObserver(update);
    observer.observe(header);
    return () => {
      observer.disconnect();
      document.documentElement.style.removeProperty(
        '--workbench-header-height',
      );
    };
  }, []);
  return (
    <header ref={ref} data-workbench-header className="wb-workspace-header">
      {children}
    </header>
  );
}
