import { Badge } from '@/components/ui/badge';
import { Surface, Text } from '@/components/ui/presentation';
import { Button } from '@/components/ui/button';
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
    <Surface
      as="aside"
      variant="navigation"
      tone="inverse"
      className="fixed inset-y-0 left-0 z-40 hidden w-(--sidebar-width) flex-col lg:flex"
    >
      <Surface
        as="div"
        variant="item"
        className="flex min-h-14 items-center gap-3"
      >
        <Badge className="financial-numeral flex items-center justify-center">
          CQ
        </Badge>
        <div>
          <Text as="p" textRole="body-small">
            Cost & Quote Workbench
          </Text>
          <Text as="p" tone="inverse" textRole="body-small" className="mt-1">
            报价管控台
          </Text>
        </div>
      </Surface>
      <Surface
        aria-label="Main navigation"
        as="nav"
        variant="body"
        className="workbench-scrollbar flex-1 overflow-y-auto"
      >
        <Surface
          as="p"
          variant="body"
          tone="inverse"
          textRole="body-small"
          className="uppercase"
        >
          Workspace <span className="sr-only">工作空间</span>
        </Surface>
        <div className="mt-2 space-y-1">
          {navItems
            .filter((item) => item.key !== 'master-data')
            .map((item) => {
              const Icon = item.icon;
              const active = item.key === activeView;
              return (
                <Button
                  variant="navigation"
                  key={item.key}
                  onClick={() => onNavigate(item.key)}
                  aria-current={active ? 'page' : undefined}
                  title={[item.description, item.descriptionZh]
                    .filter(Boolean)
                    .join(' / ')}
                  className="group flex w-full items-center gap-3 text-left"
                >
                  <Icon aria-hidden="true" className="size-4 shrink-0" />
                  <span className="min-w-0 flex-1">
                    <Text as="span" textRole="body-small" className="block">
                      {item.label}
                    </Text>
                    <Text
                      as="span"
                      tone={active ? 'primary' : 'inverse'}
                      textRole="body-small"
                      className={' block ' + ''}
                    >
                      {item.labelZh || item.description}
                    </Text>
                  </span>
                  {item.key === 'reviews' ? (
                    <Badge
                      tone="neutral"
                      className="financial-numeral flex items-center justify-center"
                    >
                      {
                        reviews.filter(
                          (review) =>
                            review.status !== 'completed' &&
                            review.status !== 'cancelled',
                        ).length
                      }
                    </Badge>
                  ) : null}
                </Button>
              );
            })}
        </div>
        <Surface
          as="p"
          variant="body"
          tone="inverse"
          textRole="body-small"
          className="mt-4 uppercase"
        >
          Data Management <span className="sr-only">数据管理</span>
        </Surface>
        <div className="mt-2 space-y-1">
          <Button
            variant="navigation"
            onClick={() => onNavigate('master-data')}
            aria-current={activeView === 'master-data' ? 'page' : undefined}
            className="group flex w-full items-center gap-3 text-left"
          >
            <Database aria-hidden="true" className="size-4" />
            <span className="flex-1">
              <Text as="span" textRole="body-small" className="block">
                Master Data
              </Text>
              <Text
                as="span"
                tone={activeView === 'master-data' ? 'primary' : 'inverse'}
                textRole="body-small"
                className={' ' + ''}
              >
                全局主数据
              </Text>
            </span>
          </Button>
        </div>
      </Surface>
      <Surface as="div" variant="footer">
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <Text as="p" textRole="body-small">
              Local Workspace
            </Text>
            <Text as="p" tone="inverse" textRole="body-small" className="mt-1">
              本地工作区
            </Text>
          </div>
          <Button
            variant="navigation"
            type="button"
            aria-label="Download workspace backup"
            title="Download restore-ready workspace backup / 下载可恢复工作区备份"
            className="flex items-center justify-center"
            onClick={onDownloadBackup}
          >
            <Text
              aria-hidden="true"
              as={Download}
              tone="inverse"
              className="size-4"
            />
          </Button>
        </div>
      </Surface>
    </Surface>
  );
}
