import { Surface, Text } from '@/components/ui/presentation';
/** Project creation; progress is edited in the dedicated ProjectWorkflowPage. */
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NewProjectIdField } from './new-project-id-field';
import { ArchiveSettingsPanel } from '../projects/project-files-panel';
import { projectIdError, type NewProjectInput } from './project-creation';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';

export function DetailSheet({
  open,
  onClose,
  onCreateProject,
}: {
  open: boolean;
  onClose: () => void;
  onCreateProject: (input: NewProjectInput) => void | Promise<void>;
}) {
  const [projectId, setProjectId] = useState('');
  const [name, setName] = useState('');
  const [client, setClient] = useState('');
  const [owner, setOwner] = useState('Me');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [archiveBlocked, setArchiveBlocked] = useState(true);
  return (
    <Sheet
      open={open}
      onOpenChange={(value) => {
        if (!value && !busy) onClose();
      }}
    >
      <SheetContent className="w-[min(560px,94vw)] sm:max-w-[560px]">
        <SheetHeader className="shrink-0">
          <SheetTitle>New Project / 新建项目</SheetTitle>
          <SheetDescription>
            创建项目并采用当前 Master Data；后续在 Project Workflow
            登记公司平台进度。
          </SheetDescription>
        </SheetHeader>
        <form
          className="flex min-h-0 flex-1 flex-col"
          onSubmit={async (event) => {
            event.preventDefault();
            if (
              busy ||
              archiveBlocked ||
              !name.trim() ||
              !client.trim() ||
              projectIdError(projectId)
            )
              return;
            setBusy(true);
            setError('');
            try {
              await onCreateProject({
                id: projectId.trim() || undefined,
                name: name.trim(),
                client: client.trim(),
                owner: owner.trim() || 'Me',
              });
              setProjectId('');
              setName('');
              setClient('');
              setOwner('Me');
            } catch (e) {
              setError(e instanceof Error ? e.message : 'Create failed');
            } finally {
              setBusy(false);
            }
          }}
        >
          <Surface
            as="div"
            variant="body"
            className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain"
          >
            <NewProjectIdField
              inputId="new-project-id"
              value={projectId}
              onChange={(value) => {
                setProjectId(value);
                setError('');
              }}
              disabled={busy}
            />
            <Surface
              as="label"
              variant="field"
              textRole="body-main"
              className="block"
            >
              Project Name / 项目名称
              <Input
                value={name}
                onChange={(event) => setName(event.target.value)}
                required
                disabled={busy}
              />
            </Surface>
            <Surface
              as="label"
              variant="field"
              textRole="body-main"
              className="block"
            >
              Client / 客户名称
              <Input
                value={client}
                onChange={(event) => setClient(event.target.value)}
                required
                disabled={busy}
              />
            </Surface>
            <Surface
              as="label"
              variant="field"
              textRole="body-main"
              className="block"
            >
              Project Owner / 项目负责人
              <Input
                value={owner}
                onChange={(event) => setOwner(event.target.value)}
                disabled={busy}
              />
            </Surface>
            <ArchiveSettingsPanel
              disabled={busy}
              onBlockedChange={setArchiveBlocked}
            />
            {error && (
              <Text role="alert" as="p" tone="danger" textRole="body-main">
                {error}
              </Text>
            )}
          </Surface>
          <SheetFooter className="shrink-0">
            <Button
              type="submit"
              disabled={
                busy ||
                archiveBlocked ||
                !name.trim() ||
                !client.trim() ||
                Boolean(projectIdError(projectId))
              }
            >
              {busy ? '创建中…' : 'Create Project / 创建项目'}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={onClose}
            >
              取消
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
