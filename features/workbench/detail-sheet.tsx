/** Project creation; progress is edited in the dedicated ProjectWorkflowPage. */
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
  onCreateProject: (input: {
    name: string;
    client: string;
    owner: string;
  }) => void | Promise<void>;
}) {
  const [name, setName] = useState('');
  const [client, setClient] = useState('');
  const [owner, setOwner] = useState('Me');
  const [busy, setBusy] = useState(false);
  return (
    <Sheet
      open={open}
      onOpenChange={(value) => {
        if (!value && !busy) onClose();
      }}
    >
      <SheetContent className="w-[min(560px,94vw)] sm:max-w-[560px]">
        <SheetHeader className="border-b border-border p-5 pr-12">
          <SheetTitle>New Project / 新建项目</SheetTitle>
          <SheetDescription>
            创建项目并采用当前 Master Data；后续在 Project Workflow
            登记公司平台进度。
          </SheetDescription>
        </SheetHeader>
        <form
          className="flex flex-1 flex-col"
          onSubmit={async (event) => {
            event.preventDefault();
            if (busy || !name.trim() || !client.trim()) return;
            setBusy(true);
            try {
              await onCreateProject({
                name: name.trim(),
                client: client.trim(),
                owner: owner.trim() || 'Me',
              });
            } finally {
              setBusy(false);
            }
          }}
        >
          <div className="flex-1 space-y-5 p-5">
            <label className="block space-y-2 text-sm">
              Project Name / 项目名称
              <Input
                value={name}
                onChange={(event) => setName(event.target.value)}
                required
                disabled={busy}
              />
            </label>
            <label className="block space-y-2 text-sm">
              Client / 客户名称
              <Input
                value={client}
                onChange={(event) => setClient(event.target.value)}
                required
                disabled={busy}
              />
            </label>
            <label className="block space-y-2 text-sm">
              Project Owner / 项目负责人
              <Input
                value={owner}
                onChange={(event) => setOwner(event.target.value)}
                disabled={busy}
              />
            </label>
          </div>
          <SheetFooter className="border-t border-border p-5">
            <Button
              type="submit"
              disabled={busy || !name.trim() || !client.trim()}
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
