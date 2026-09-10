/** Desktop navigation presentation; the session owns navigation and backup effects. */
import { Database, MoreHorizontal } from 'lucide-react';
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
    <aside className="fixed inset-y-0 left-0 z-40 hidden w-[244px] flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground lg:flex">
      <div className="flex h-[84px] items-center gap-3 border-b border-sidebar-border px-5">
        <span className="financial-numeral flex size-9 items-center justify-center rounded-xl border border-white/20 bg-white/10 text-xs font-bold">
          CQ
        </span>
        <div>
          <p className="text-[13px] font-semibold tracking-tight">
            Cost & Quote Workbench
          </p>
          <p className="mt-1 text-[10px] text-[#adbfcb]">报价管控台</p>
        </div>
      </div>
      <nav
        aria-label="Main navigation"
        className="workbench-scrollbar flex-1 overflow-y-auto px-3 py-6"
      >
        <p className="px-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-[#a2b5c2]">
          Workspace{' '}
          <span className="text-[8px] normal-case tracking-normal">
            工作空间
          </span>
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
                    'group flex w-full items-center gap-3 rounded-lg border border-transparent px-3 py-3 text-left transition-colors ' +
                    (active
                      ? 'border-white/15 bg-sidebar-primary text-sidebar-primary-foreground shadow-sm'
                      : 'text-[#d2dce3] hover:bg-sidebar-accent hover:text-white')
                  }
                >
                  <Icon className="size-4 shrink-0" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] font-semibold">
                      {item.label}
                    </span>
                    <span
                      className={
                        'mt-1 block text-[10px] leading-4 ' +
                        (active ? 'text-[#4d6877]' : 'text-[#a1b5c3]')
                      }
                    >
                      {item.labelZh || item.description}
                    </span>
                  </span>
                  {item.key === 'reviews' ? (
                    <span className="financial-numeral flex size-5 items-center justify-center rounded-full bg-[#a86432] text-[9px] font-bold text-white">
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
        <p className="mt-7 px-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-[#a2b5c2]">
          Data Management{' '}
          <span className="text-[8px] normal-case tracking-normal">
            数据管理
          </span>
        </p>
        <div className="mt-2 space-y-1">
          <button
            onClick={() => onNavigate('master-data')}
            aria-current={activeView === 'master-data' ? 'page' : undefined}
            className={
              'group flex w-full items-center gap-3 rounded-lg border border-transparent px-3 py-3 text-left transition-colors ' +
              (activeView === 'master-data'
                ? 'border-white/15 bg-sidebar-primary text-sidebar-primary-foreground shadow-sm'
                : 'text-[#d2dce3] hover:bg-sidebar-accent hover:text-white')
            }
          >
            <Database className="size-4" />
            <span className="flex-1">
              <span className="block text-[13px] font-semibold">
                Master Data
              </span>
              <span
                className={
                  'text-[10px] leading-4 ' +
                  (activeView === 'master-data'
                    ? 'text-[#4d6877]'
                    : 'text-[#a1b5c3]')
                }
              >
                全局主数据 · Rates, CPQ & templates
              </span>
            </span>
            <span className="text-[8px]">Live</span>
          </button>
        </div>
      </nav>
      <div className="border-t border-sidebar-border p-4">
        <div className="flex items-center gap-3">
          <span className="flex size-8 items-center justify-center rounded-full bg-sidebar-primary text-xs font-bold text-sidebar-primary-foreground">
            ME
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-semibold">Quote Workspace</p>
            <p className="mt-1 text-[10px] text-[#a1b5c3]">
              报价工作区 · Local SQLite / 本地数据库
            </p>
          </div>
          <button
            type="button"
            aria-label="Download workspace backup"
            title="Download restore-ready workspace backup / 下载可恢复工作区备份"
            className="flex size-8 items-center justify-center rounded-md hover:bg-sidebar-accent"
            onClick={onDownloadBackup}
          >
            <MoreHorizontal className="size-4 text-[#8197a3]" />
          </button>
        </div>
      </div>
    </aside>
  );
}
