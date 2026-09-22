/** Compact persistence feedback in the shared header; the session still owns every save effect. */
import { Check, LoaderCircle, Plus, Save, WifiOff } from 'lucide-react';
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

/** Give persistence states a readable label, with errors retaining their complete recovery message. */
function persistencePresentation(phase: PersistencePhase) {
  if (phase === 'saved')
    return {
      icon: Check,
      label: 'Saved / 已保存',
      className: 'text-success',
      spinning: false,
    };
  if (['offline', 'error', 'conflict'].includes(phase))
    return {
      icon: WifiOff,
      label: 'Save needs attention / 保存待处理',
      className: 'text-warning',
      spinning: false,
    };
  return {
    icon: LoaderCircle,
    label: phase === 'saving' ? 'Saving… / 保存中…' : 'Loading… / 加载中…',
    className: 'text-info',
    spinning: true,
  };
}

/** Keep save and version creation reachable without adding a full-width row above every working table. */
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
  const needsRecovery = ['conflict', 'error', 'offline'].includes(
    persistenceStatus.phase,
  );
  return (
    <div
      className="order-last flex w-full min-w-0 flex-wrap items-center gap-1.5 md:order-none md:w-auto"
      aria-label="Workspace save controls"
    >
      <output
        aria-live="polite"
        aria-atomic="true"
        title={`${persistenceStatus.message} · ${displayDate}`}
        className={`inline-flex min-h-8 items-center gap-1.5 text-xs ${presentation.className}`}
      >
        <StatusIcon
          aria-hidden="true"
          className={`size-3.5 shrink-0 ${presentation.spinning ? 'animate-spin' : ''}`}
        />
        <span className="sr-only xl:not-sr-only">{presentation.label}</span>
      </output>
      <Button
        variant="ghost"
        size="sm"
        className="h-8 px-2 text-xs"
        title="Save workspace / 保存工作区"
        onClick={onSave}
        disabled={persistenceStatus.phase === 'saving'}
      >
        <Save aria-hidden="true" className="size-3.5" /> Save{' '}
        <span className="sr-only">保存</span>
      </Button>
      {activeView === 'cost' && (
        <Button
          variant="outline"
          size="sm"
          className="h-8 text-xs"
          onClick={onNewVersion}
          disabled={newVersionDisabled}
        >
          <Plus aria-hidden="true" className="size-3.5" /> New Version{' '}
          <span className="sr-only">创建版本</span>
        </Button>
      )}
      {/* Failure information stays visible and actionable; only routine technical details use a tooltip. */}
      {needsRecovery && (
        <div className="flex max-w-full flex-wrap items-center gap-2 rounded border border-warning/25 bg-warning-muted px-2 py-1 text-xs text-warning">
          <output className="max-w-sm break-words">
            {persistenceStatus.message}
          </output>
          <Button variant="outline" size="sm" onClick={onBackupAndReload}>
            备份并重载项目列表
          </Button>
        </div>
      )}
    </div>
  );
}
