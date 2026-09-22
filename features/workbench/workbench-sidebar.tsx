/** Desktop navigation presentation; the session owns navigation and backup effects. */
import { Database, Download } from 'lucide-react';
import type { ReviewGate } from '../reviews/types';
import { navItems } from './navigation';
import type { ViewKey } from './types';

type WorkbenchSidebarProps = {
  activeView: ViewKey;
  reviews: ReviewGate[];
  onNavigate: (view: ViewKey) => void;
  onDownloadBackup: () => Promise<void>;
};

/** Render workspace links, pending-review counts, and the current session's backup action. */
export function WorkbenchSidebar({
  activeView,
  reviews,
  onNavigate,
  onDownloadBackup,
}: WorkbenchSidebarProps) {
  return (
    <aside className="fixed inset-y-0 left-0 z-40 hidden w-[216px] flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground lg:flex">
      <div className="flex min-h-14 items-center gap-2.5 border-b border-sidebar-border px-3 py-2">
        <span className="financial-numeral flex size-7 items-center justify-center rounded-md border border-white/20 bg-white/10 text-xs font-bold">
          CQ
        </span>
        <div>
          <p className="text-[13px] font-semibold tracking-tight">
            Cost & Quote Workbench
          </p>
          <p className="mt-1 text-xs text-sidebar-foreground/75">报价管控台</p>
        </div>
      </div>
      <nav
        aria-label="Main navigation"
        className="workbench-scrollbar flex-1 overflow-y-auto px-2 py-3"
      >
        <p className="px-2 text-xs font-medium uppercase tracking-[0.08em] text-sidebar-foreground/65">
          Workspace <span className="sr-only">工作空间</span>
        </p>
        <div className="mt-2 space-y-1">
          {navItems
            .filter((item) => item.key !== 'master-data')
            .map((item) => {
              const Icon = item.icon;
              const active = item.key === activeView;
              return (
                <button
                  key={item.key}
                  onClick={() => onNavigate(item.key)}
                  aria-current={active ? 'page' : undefined}
                  title={[item.description, item.descriptionZh]
                    .filter(Boolean)
                    .join(' / ')}
                  className={
                    'wb-navigation-button group flex min-h-11 w-full items-center gap-2.5 rounded-md border border-transparent px-2.5 py-2 text-left transition-colors duration-150 ' +
                    (active
                      ? 'border-white/15 bg-sidebar-primary text-sidebar-primary-foreground shadow-[inset_3px_0_0_var(--ring)]'
                      : 'text-sidebar-foreground hover:bg-sidebar-accent hover:text-white')
                  }
                >
                  <Icon aria-hidden="true" className="size-4 shrink-0" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] font-medium">
                      {item.label}
                    </span>
                    <span
                      className={
                        'block text-xs leading-3 ' +
                        (active
                          ? 'text-sidebar-primary-foreground/80'
                          : 'text-sidebar-foreground/70')
                      }
                    >
                      {item.labelZh || item.description}
                    </span>
                  </span>
                  {item.key === 'reviews' ? (
                    <span className="financial-numeral flex size-5 items-center justify-center rounded-full bg-warning text-xs font-bold text-white">
                      {
                        reviews.filter(
                          (review) =>
                            review.status !== 'completed' &&
                            review.status !== 'cancelled',
                        ).length
                      }
                    </span>
                  ) : null}
                </button>
              );
            })}
        </div>
        <p className="mt-4 px-2 text-xs font-medium uppercase tracking-[0.08em] text-sidebar-foreground/65">
          Data Management <span className="sr-only">数据管理</span>
        </p>
        <div className="mt-2 space-y-1">
          <button
            onClick={() => onNavigate('master-data')}
            aria-current={activeView === 'master-data' ? 'page' : undefined}
            className={
              'wb-navigation-button group flex min-h-11 w-full items-center gap-2.5 rounded-md border border-transparent px-2.5 py-2 text-left transition-colors duration-150 ' +
              (activeView === 'master-data'
                ? 'border-white/15 bg-sidebar-primary text-sidebar-primary-foreground shadow-[inset_3px_0_0_var(--ring)]'
                : 'text-sidebar-foreground hover:bg-sidebar-accent hover:text-white')
            }
          >
            <Database aria-hidden="true" className="size-4" />
            <span className="flex-1">
              <span className="block text-[13px] font-medium">Master Data</span>
              <span
                className={
                  'text-xs leading-4 ' +
                  (activeView === 'master-data'
                    ? 'text-sidebar-primary-foreground/80'
                    : 'text-sidebar-foreground/70')
                }
              >
                全局主数据
              </span>
            </span>
          </button>
        </div>
      </nav>
      <div className="border-t border-sidebar-border p-3">
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium">Local Workspace</p>
            <p className="mt-0.5 text-xs text-sidebar-foreground/70">
              本地工作区
            </p>
          </div>
          <button
            type="button"
            aria-label="Download workspace backup"
            title="Download restore-ready workspace backup / 下载可恢复工作区备份"
            className="flex size-8 items-center justify-center rounded-md hover:bg-sidebar-accent"
            onClick={onDownloadBackup}
          >
            <Download
              aria-hidden="true"
              className="size-4 text-sidebar-foreground"
            />
          </button>
        </div>
      </div>
    </aside>
  );
}
