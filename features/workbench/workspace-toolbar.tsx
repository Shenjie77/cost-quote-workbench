/** Persistence feedback and explicit workspace actions, independent of session storage. */
import { Check, LoaderCircle, Plus, Save, WifiOff } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { PersistencePhase, PersistenceStatus } from './workspace-types';
import type { ViewKey } from './types';

type WorkspaceToolbarProps = {
  persistenceStatus: PersistenceStatus;
  activeView: ViewKey;
  displayDate: string;
  newVersionDisabled: boolean;
  onSave: () => void;
  onBackupAndReload: () => Promise<void>;
  onNewVersion: () => void;
};

/** Select matching badge colors and icon for saved, failed, or pending persistence. */
function persistencePresentation(phase: PersistencePhase) {
  if (phase === 'saved')
    return {
      icon: Check,
      className: 'border-[#9fb9aa] bg-[#edf5ef] text-[#377054]',
      iconClassName: 'mr-1 size-3',
    };
  if (['offline', 'error', 'conflict'].includes(phase))
    return {
      icon: WifiOff,
      className: 'border-[#d0b787] bg-[#f8f0e2] text-[#8d5b12]',
      iconClassName: 'mr-1 size-3',
    };
  return {
    icon: LoaderCircle,
    className: 'border-[#9eb9ba] bg-[#edf4f3] text-[#2e6f77]',
    iconClassName: 'mr-1 size-3 animate-spin',
  };
}

/** Render save/recovery controls; callers preserve the ordering of all asynchronous effects. */
export function WorkspaceToolbar({
  persistenceStatus,
  activeView,
  displayDate,
  newVersionDisabled,
  onSave,
  onBackupAndReload,
  onNewVersion,
}: WorkspaceToolbarProps) {
  const presentation = persistencePresentation(persistenceStatus.phase);
  const StatusIcon = presentation.icon;
  return (
    <div className="mb-2 flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-border px-1 py-1">
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
        <Badge
          variant="outline"
          className={'h-5 rounded px-1.5 text-[11px] ' + presentation.className}
        >
          <StatusIcon className={presentation.iconClassName} />
          Local SQLite <span className="ml-1 text-[10px]">本地数据库</span>
        </Badge>
        <output
          className="max-w-full break-words sm:max-w-[min(50vw,760px)]"
          title={persistenceStatus.message}
        >
          {persistenceStatus.message}
        </output>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-[11px]"
          onClick={onSave}
          disabled={persistenceStatus.phase === 'saving'}
        >
          <Save className="size-3" /> Save{' '}
          <span className="text-[10px]">保存</span>
        </Button>
        {['conflict', 'error', 'offline'].includes(persistenceStatus.phase) && (
          <Button variant="outline" size="sm" onClick={onBackupAndReload}>
            备份并重载项目列表
          </Button>
        )}
        {activeView === 'cost' ? (
          <Button
            size="sm"
            className="h-7 px-2 text-[11px]"
            onClick={onNewVersion}
            disabled={newVersionDisabled}
          >
            <Plus className="size-3" /> New Version{' '}
            <span className="text-[10px] opacity-60">创建版本</span>
          </Button>
        ) : null}
      </div>
      <span className="financial-numeral hidden text-[11px] text-muted-foreground sm:block">
        {displayDate}
      </span>
    </div>
  );
}
