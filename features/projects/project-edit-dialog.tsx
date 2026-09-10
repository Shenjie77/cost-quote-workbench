import { useEffect, useState } from 'react';
import { FolderArchive, RefreshCw } from 'lucide-react';
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
import {
  listProjectFiles,
  moveProjectArchive,
  type ProjectArchiveLocation,
} from './project-files';
import { projectDetails, type ProjectDetails } from './project-details';
import { ArchiveFolderButton } from './project-files-panel';
import type { Project } from './types';

const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : 'Unable to save project.';

/** Project references and the physical archive have independent save actions. */
export function ProjectEditDialog({
  project,
  onClose,
  onSave,
}: {
  project: Project;
  onClose: () => void;
  onSave: (details: ProjectDetails, baseline: ProjectDetails) => Promise<void>;
}) {
  const [details, setDetails] = useState<ProjectDetails>({
    name: project.name,
    client: project.client,
    proposalNumber: '',
    companyUrl: '',
    cpqUrl: '',
    scopeBrief: '',
    technicalBasis: '',
  });
  const [baseline, setBaseline] = useState<ProjectDetails | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [location, setLocation] = useState<ProjectArchiveLocation | null>(null);
  const [projectPath, setProjectPath] = useState('');
  const [folderError, setFolderError] = useState('');
  const [folderNotice, setFolderNotice] = useState('');
  const [moving, setMoving] = useState(false);
  const [folderLoading, setFolderLoading] = useState(true);
  const [folderReload, setFolderReload] = useState(0);
  const busy = saving || moving;
  const folderDirty = Boolean(
    location && projectPath.trim() !== location.projectPath,
  );
  const detailsDirty = Boolean(
    baseline && JSON.stringify(details) !== JSON.stringify(baseline),
  );
  useEffect(() => {
    let cancelled = false;
    void getLocalWorkspace(project.id)
      .then((record) => {
        if (cancelled) return;
        if (!record)
          throw new Error(
            'Project no longer exists. Refresh the project list.',
          );
        const current = projectDetails(record.workspace);
        setDetails(current);
        setBaseline(current);
      })
      .catch((cause) => {
        if (!cancelled) setError(errorMessage(cause));
      });
    return () => {
      cancelled = true;
    };
  }, [project.id]);
  useEffect(() => {
    let cancelled = false;
    void listProjectFiles(project.id)
      .then((archive) => {
        if (cancelled) return;
        setLocation(archive);
        setProjectPath(archive.projectPath);
        setFolderError('');
      })
      .catch((cause) => {
        if (!cancelled) setFolderError(errorMessage(cause));
      })
      .finally(() => {
        if (!cancelled) setFolderLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [project.id, folderReload]);
  const save = async () => {
    if (
      !baseline ||
      busy ||
      folderDirty ||
      !details.name.trim() ||
      !details.client.trim()
    )
      return;
    setSaving(true);
    setError('');
    try {
      await onSave(details, baseline);
      onClose();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setSaving(false);
    }
  };
  const move = async () => {
    if (!location || busy || !folderDirty || !projectPath.trim()) return;
    setMoving(true);
    setFolderError('');
    setFolderNotice('');
    try {
      const result = await moveProjectArchive(
        project.id,
        projectPath.trim(),
        location.projectPath,
      );
      setLocation(result);
      setProjectPath(result.projectPath);
      setFolderNotice(
        'Project folder updated. Existing documents remain available.',
      );
    } catch (cause) {
      setFolderError(errorMessage(cause));
    } finally {
      setMoving(false);
    }
  };
  const field = (
    key: keyof ProjectDetails,
    label: string,
    required = false,
  ) => (
    <label className="block space-y-1.5 text-xs font-medium">
      {label}
      <Input
        value={details[key]}
        onChange={(event) =>
          setDetails((previous) => ({ ...previous, [key]: event.target.value }))
        }
        disabled={busy || !baseline}
        required={required}
        type={key.endsWith('Url') ? 'url' : 'text'}
        maxLength={key.endsWith('Url') ? 2048 : 200}
      />
    </label>
  );
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent
        showCloseButton={!busy}
        className="max-h-[90vh] overflow-y-auto sm:max-w-[660px]"
      >
        <DialogHeader>
          <DialogTitle>Edit Project</DialogTitle>
          <DialogDescription>{project.id}</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-5"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            {field('name', 'Project Name', true)}
            {field('client', 'Client', true)}
            {field('proposalNumber', 'Proposal Number')}
            <div className="hidden sm:block" />
            {field('companyUrl', 'iSales Link')}
            {field('cpqUrl', 'CPQ Link')}
          </div>
          <details className="rounded-xl border border-border bg-muted/15 px-4 py-3">
            <summary className="cursor-pointer rounded-md text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring/30">
              Scope & Technical Basis
            </summary>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {(['scopeBrief', 'technicalBasis'] as const).map((key) => (
                <label
                  key={key}
                  className="block space-y-1.5 text-xs font-medium"
                >
                  {key === 'scopeBrief' ? 'Scope Brief' : 'Technical Basis'}
                  <textarea
                    className="min-h-24 w-full rounded-lg border border-input bg-white px-3 py-2.5 text-sm leading-6 outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/20"
                    value={details[key]}
                    disabled={busy || !baseline}
                    maxLength={4000}
                    onChange={(event) =>
                      setDetails((previous) => ({
                        ...previous,
                        [key]: event.target.value,
                      }))
                    }
                  />
                </label>
              ))}
            </div>
          </details>
          <section
            aria-label="Project Folder"
            className="space-y-3 rounded-xl border border-border bg-muted/20 p-4"
          >
            <div className="flex items-center justify-between">
              <h3 className="flex items-center gap-2 text-xs font-semibold">
                <FolderArchive className="size-4" />
                Project Folder
              </h3>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="size-7"
                aria-label="Reload project folder"
                disabled={busy || folderLoading}
                onClick={() => {
                  setFolderLoading(true);
                  setFolderNotice('');
                  setFolderReload((value) => value + 1);
                }}
              >
                <RefreshCw className="size-3.5" />
              </Button>
            </div>
            <Input
              aria-label="Project folder path"
              className="font-mono text-xs"
              value={projectPath}
              placeholder={
                folderLoading
                  ? 'Loading project folder…'
                  : 'Absolute path to this project folder'
              }
              disabled={busy || folderLoading || !location}
              onChange={(event) => {
                setProjectPath(event.target.value);
                setFolderNotice('');
              }}
            />
            <ArchiveFolderButton
              key={project.id}
              projectId={project.id}
              description="Open saved project archive folder"
              disabled={busy || folderLoading || !location}
            />
            <p className="text-[11px] text-muted-foreground">
              Enter a new project folder on the computer running the workbench,
              then apply to move its documents. Pasted quoted paths, file URLs
              and ~/ paths are supported. The destination folder must not exist.
            </p>
            {folderDirty && (
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  disabled={busy || !projectPath.trim()}
                  onClick={() => void move()}
                >
                  {moving ? 'Moving…' : 'Apply Folder'}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => {
                    setProjectPath(location?.projectPath || '');
                    setFolderError('');
                  }}
                >
                  Reset
                </Button>
                <span className="text-[11px] text-muted-foreground">
                  Apply or reset before saving project info.
                </span>
              </div>
            )}
            {folderError && (
              <p role="alert" className="text-xs text-destructive">
                {folderError}
              </p>
            )}
            {folderNotice && (
              <output className="block text-xs text-emerald-700">
                {folderNotice}
              </output>
            )}
          </section>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={onClose}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={
                busy ||
                !baseline ||
                !detailsDirty ||
                folderDirty ||
                !details.name.trim() ||
                !details.client.trim()
              }
            >
              {saving ? 'Saving…' : 'Save Project Info'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
