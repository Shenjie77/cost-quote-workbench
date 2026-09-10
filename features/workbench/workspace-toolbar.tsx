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
    <div className="mb-4 flex items-center justify-between gap-3">
      <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
        <Badge variant="outline" className={'h-5 ' + presentation.className}>
          <StatusIcon className={presentation.iconClassName} />
          Local SQLite <span className="ml-1 text-[8px]">本地数据库</span>
        </Badge>
        <span
          className="max-w-[760px] truncate"
          title={persistenceStatus.message}
        >
          {persistenceStatus.message}
        </span>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-[9px]"
          onClick={onSave}
          disabled={persistenceStatus.phase === 'saving'}
        >
          <Save className="size-3" /> Save{' '}
          <span className="text-[8px]">保存</span>
        </Button>
        {['conflict', 'error', 'offline'].includes(persistenceStatus.phase) && (
          <Button variant="outline" size="sm" onClick={onBackupAndReload}>
            备份并重载项目列表
          </Button>
        )}
        {activeView === 'cost' ? (
          <Button
            size="sm"
            className="h-6 px-2 text-[9px]"
            onClick={onNewVersion}
            disabled={newVersionDisabled}
          >
            <Plus className="size-3" /> New Version{' '}
            <span className="text-[8px] opacity-60">创建版本</span>
          </Button>
        ) : null}
      </div>
      <span className="financial-numeral hidden text-[10px] text-muted-foreground sm:block">
        {displayDate}
      </span>
    </div>
  );
}
