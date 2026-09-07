import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { getLocalWorkspace } from '../workbench/workspace-client';
import type { Project } from './types';

/** Edits identity fields only; saved costs and review snapshots remain intact. */
export function ProjectEditDialog({
  project,
  onClose,
  onSave,
}: {
  project: Project;
  onClose: () => void;
  onSave: (
    details: { name: string; client: string },
    revision: number,
  ) => Promise<void>;
}) {
  const [name, setName] = useState(project.name);
  const [client, setClient] = useState(project.client);
  const [revision, setRevision] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void getLocalWorkspace(project.id)
      .then((record) => {
        if (cancelled) return;
        if (!record) throw new Error('项目不存在，请刷新项目列表。');
        setName(record.workspace.project.name);
        setClient(record.workspace.project.client);
        setRevision(record.revision);
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [project.id]);
  const save = async () => {
    if (!revision || saving || !name.trim() || !client.trim()) return;
    setSaving(true);
    setError('');
    try {
      await onSave({ name: name.trim(), client: client.trim() }, revision);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !saving) onClose();
      }}
    >
      <DialogContent showCloseButton={!saving}>
        <DialogHeader>
          <DialogTitle>Edit Project / 编辑项目</DialogTitle>
          <DialogDescription>{project.id}</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <label className="block space-y-1 text-xs">
            Project Name / 项目名称
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={saving || !revision}
              required
              maxLength={200}
            />
          </label>
          <label className="block space-y-1 text-xs">
            Client / 客户
            <Input
              value={client}
              onChange={(e) => setClient(e.target.value)}
              disabled={saving || !revision}
              required
              maxLength={200}
            />
          </label>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={saving}
              onClick={onClose}
            >
              Cancel / 取消
            </Button>
            <Button
              type="submit"
              disabled={saving || !revision || !name.trim() || !client.trim()}
            >
              {saving ? 'Saving… / 保存中' : 'Save / 保存'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
