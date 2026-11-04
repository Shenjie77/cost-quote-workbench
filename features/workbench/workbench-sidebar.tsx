import {
  Download,
  Folder,
  ListChecks,
  LayoutGrid,
  Calculator,
  FileSpreadsheet,
  Settings,
  Bell,
} from 'lucide-react';
import { Surface, Text } from '@/components/ui/presentation';
import { Button } from '@/components/ui/button';
import { useWorkbenchLanguage } from './workbench-language';
import { workbenchDestinations } from './workbench-destinations';
import type { ViewKey } from './types';
import type { CostViewKey } from '../cost/ui-types';
/** Only composition lives here; appearance is frozen in global tokens/components. */
export function WorkbenchSidebar({
  activeView,
  costView,
  onNavigate,
  onCostView,
  onDownloadBackup,
}: {
  activeView: ViewKey;
  costView: CostViewKey;
  onNavigate: (view: ViewKey) => void;
  onCostView: (view: CostViewKey) => void;
  onDownloadBackup: () => Promise<void>;
}) {
  const { label } = useWorkbenchLanguage();
  return (
    <Surface
      as="aside"
      variant="navigation"
      className="fixed inset-y-0 left-0 z-40 hidden w-(--sidebar-width) flex-col lg:flex"
    >
      <Surface variant="item" className="flex min-h-12 items-center gap-2">
        <LayoutGrid className="size-5 shrink-0" />
        <Text textRole="h3">{label('Project Workbench', '项目工作平台')}</Text>
      </Surface>
      <Surface
        as="nav"
        aria-label="Main navigation"
        variant="body"
        className="workbench-scrollbar flex-1 overflow-y-auto"
      >
        {workbenchDestinations.map((item) => {
          const Icon =
            item.view === 'project' || item.view === 'files'
              ? Folder
              : item.view === 'workflow'
                ? ListChecks
                : item.view === 'calculation'
                  ? Calculator
                  : item.view === 'master-data'
                    ? Settings
                    : item.view === 'agent'
                      ? Bell
                      : item.view === 'overview'
                        ? LayoutGrid
                        : FileSpreadsheet;
          const active =
            item.view === activeView &&
            (!item.costView || item.costView === costView);
          return (
            <div key={item.id}>
              {item.group && (
                <Text
                  as="p"
                  tone="muted"
                  textRole="body-small"
                  className="my-3"
                >
                  {item.group === 'workspace'
                    ? label('Workspace', '工作空间')
                    : item.group === 'project'
                      ? label('Current project', '当前项目')
                      : label('Global resources', '全局资源')}
                </Text>
              )}
              <Button
                variant="navigation"
                className="w-full text-left"
                onClick={() =>
                  item.costView
                    ? onCostView(item.costView)
                    : onNavigate(item.view)
                }
                aria-current={active ? 'page' : undefined}
                title={`${item.en} / ${item.zh}`}
              >
                <Icon />
                <span className="min-w-0 truncate">
                  {label(item.en, item.zh)}
                </span>
              </Button>
            </div>
          );
        })}
      </Surface>
      <Surface variant="footer" className="flex items-center justify-between">
        <Text tone="muted" textRole="body-small">
          {label('Local workspace', '本地工作区')}
        </Text>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => void onDownloadBackup()}
          aria-label="Download workspace backup"
          title={label('Download workspace backup', '下载工作区备份')}
        >
          <Download />
        </Button>
      </Surface>
    </Surface>
  );
}
