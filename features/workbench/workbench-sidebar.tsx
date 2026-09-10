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
    <aside className="fixed inset-y-0 left-0 z-40 hidden w-[244px] flex-col border-r border-[#29495c] bg-[#132c3d] text-[#eaf0f2] lg:flex">
      <div className="flex h-[74px] items-center gap-3 border-b border-[#29495c] px-5">
        <span className="financial-numeral flex size-9 items-center justify-center rounded-md border border-[#65808f] bg-[#1b3d51] text-xs font-bold">
          CQ
        </span>
        <div>
          <p className="text-sm font-semibold tracking-wide">
            Cost & Quote Workbench
          </p>
          <p className="mt-0.5 text-[9px] text-[#9fb0b9]">报价管控台</p>
        </div>
      </div>
      <nav
        aria-label="Main navigation"
        className="workbench-scrollbar flex-1 overflow-y-auto px-3 py-5"
      >
        <p className="px-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-[#78909e]">
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
                  className={
                    'flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left transition-colors ' +
                    (active
                      ? 'bg-[#e8f0f0] text-[#173a52]'
                      : 'text-[#c8d3d9] hover:bg-[#1b3d51] hover:text-white')
                  }
                >
                  <Icon className="size-4 shrink-0" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-xs font-semibold">
                      {item.label}
                    </span>
                    <span
                      className={
                        'mt-0.5 block text-[9px] ' +
                        (active ? 'text-[#587078]' : 'text-[#8197a3]')
                      }
                    >
                      {item.labelZh} · {item.description}
                    </span>
                    <span
                      className={
                        'block text-[8px] ' +
                        (active ? 'text-[#6f858c]' : 'text-[#718792]')
                      }
                    >
                      {item.descriptionZh}
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
        <p className="mt-7 px-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-[#78909e]">
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
              'flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left transition-colors ' +
              (activeView === 'master-data'
                ? 'bg-[#e8f0f0] text-[#173a52]'
                : 'text-[#c8d3d9] hover:bg-[#1b3d51] hover:text-white')
            }
          >
            <Database className="size-4" />
            <span className="flex-1">
              <span className="block text-xs font-medium">Master Data</span>
              <span
                className={
                  'text-[8px] ' +
                  (activeView === 'master-data'
                    ? 'text-[#587078]'
                    : 'text-[#8197a3]')
                }
              >
                全局主数据 · Rates, CPQ & templates
              </span>
            </span>
            <span className="text-[8px]">Live</span>
          </button>
        </div>
      </nav>
      <div className="border-t border-[#29495c] p-4">
        <div className="flex items-center gap-3">
          <span className="flex size-8 items-center justify-center rounded-full bg-[#dbe7e8] text-xs font-bold text-[#173a52]">
            ME
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-semibold">Quote Workspace</p>
            <p className="mt-0.5 text-[8px] text-[#8197a3]">
              报价工作区 · Local SQLite / 本地数据库
            </p>
          </div>
          <button
            type="button"
            aria-label="Download workspace backup"
            title="Download restore-ready workspace backup / 下载可恢复工作区备份"
            onClick={onDownloadBackup}
          >
            <MoreHorizontal className="size-4 text-[#8197a3]" />
          </button>
        </div>
      </div>
    </aside>
  );
}
