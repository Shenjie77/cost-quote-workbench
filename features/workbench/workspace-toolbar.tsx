import { Surface, Text } from '@/components/ui/presentation';
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
      tone: 'success' as const,
      spinning: false,
    };
  if (['offline', 'error', 'conflict'].includes(phase))
    return {
      icon: WifiOff,
      label: 'Save needs attention / 保存待处理',
      tone: 'warning' as const,
      spinning: false,
    };
  return {
    icon: LoaderCircle,
    label: phase === 'saving' ? 'Saving… / 保存中…' : 'Loading… / 加载中…',
    tone: 'info' as const,
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
      className="order-last flex w-full min-w-0 flex-wrap items-center gap-2 md:order-none md:w-auto"
      aria-label="Workspace save controls"
    >
      <Text
        aria-live="polite"
        aria-atomic="true"
        title={`${persistenceStatus.message} · ${displayDate}`}
        as="output"
        tone={presentation.tone}
        textRole="body-small"
        className="inline-flex min-h-8 items-center gap-2"
      >
        <StatusIcon
          aria-hidden="true"
          className={`size-4 shrink-0 ${presentation.spinning ? 'animate-spin' : ''}`}
        />
        <span className="sr-only xl:not-sr-only">{presentation.label}</span>
      </Text>
      <Button
        variant="ghost"
        size="sm"

        title="Save workspace / 保存工作区"
        onClick={onSave}
        disabled={persistenceStatus.phase === 'saving'}
      >
        <Save aria-hidden="true" className="size-4" /> Save{' '}
        <span className="sr-only">保存</span>
      </Button>
      {activeView === 'cost' && (
        <Button
          variant="outline"
          size="sm"

          onClick={onNewVersion}
          disabled={newVersionDisabled}
        >
          <Plus aria-hidden="true" className="size-4" /> New Version{' '}
          <span className="sr-only">创建版本</span>
        </Button>
      )}
      {/* Failure information stays visible and actionable; only routine technical details use a tooltip. */}
      {needsRecovery && (
        <Surface
          as="div"
          variant="notice"
          tone="warning"
          textRole="body-small"
          className="flex max-w-full flex-wrap items-center gap-2"
        >
          <output className="max-w-sm break-words">
            {persistenceStatus.message}
          </output>
          <Button variant="outline" size="sm" onClick={onBackupAndReload}>
            备份并重载项目列表
          </Button>
        </Surface>
      )}
    </div>
  );
}
