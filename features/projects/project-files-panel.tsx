import {
  useEffect,
  useRef,
  useState,
  type DragEvent,
  type ReactNode,
} from 'react';
import { Download, FolderArchive, RefreshCw, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  archiveProjectFile,
  getArchiveSettings,
  listProjectFiles,
  MAX_PROJECT_FILE_BYTES,
  projectFileDownloadUrl,
  projectFileSizeLabel,
  updateArchiveSettings,
  type ArchiveSettings,
  type ProjectFileArchive,
  type ProjectFileFilter,
  type ProjectFileRecord,
} from './project-files';

const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : 'Unable to access the file archive.';
const dateLabel = (value: string) =>
  Number.isFinite(Date.parse(value))
    ? new Intl.DateTimeFormat('en-SG', {
        timeZone: 'Asia/Singapore',
        dateStyle: 'medium',
        timeStyle: 'short',
      }).format(new Date(value))
    : value;

/** An absolute path belongs to the local API host, not the browser's download folder. */
export function ArchiveSettingsPanel({
  onBlockedChange,
  disabled = false,
}: {
  onBlockedChange?: (blocked: boolean) => void;
  disabled?: boolean;
}) {
  const [settings, setSettings] = useState<ArchiveSettings | null>(null);
  const [rootPath, setRootPath] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [reload, setReload] = useState(0);
  const mounted = useRef(false);
  const saveInFlight = useRef(false);
  const dirty = Boolean(settings && rootPath.trim() !== settings.rootPath);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    let cancelled = false;
    void getArchiveSettings()
      .then((value) => {
        if (cancelled) return;
        setSettings(value);
        setRootPath(value.rootPath);
        setError('');
      })
      .catch((cause) => {
        if (!cancelled) setError(errorMessage(cause));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [reload]);
  useEffect(() => {
    onBlockedChange?.(
      !settings || loading || saving || dirty || Boolean(error),
    );
  }, [dirty, error, loading, onBlockedChange, saving, settings]);
  const save = async () => {
    if (!settings || !rootPath.trim() || disabled || saveInFlight.current)
      return;
    saveInFlight.current = true;
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const next = await updateArchiveSettings(
        rootPath.trim(),
        settings.revision,
      );
      if (!mounted.current) return;
      setSettings(next);
      setRootPath(next.rootPath);
      setNotice('Archive folder saved. New projects will use this location.');
    } catch (cause) {
      if (mounted.current) setError(errorMessage(cause));
    } finally {
      saveInFlight.current = false;
      if (mounted.current) setSaving(false);
    }
  };
  return (
    <section
      aria-label="Archive Settings"
      className="space-y-3 rounded-lg border bg-muted/15 p-3"
    >
      <div>
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <FolderArchive className="size-4" /> Project Archive Folder
        </h3>
        <p className="mt-1 text-xs text-muted-foreground">
          A project folder is created here when you create a project. Each
          workflow round and step keeps its own documents.
        </p>
      </div>
      <label className="block space-y-1 text-xs">
        Server folder · absolute path
        <Input
          aria-label="Project archive root folder"
          value={rootPath}
          placeholder={
            loading
              ? 'Loading archive folder…'
              : 'Enter an absolute folder path'
          }
          disabled={disabled || loading || saving || !settings}
          onChange={(event) => {
            setRootPath(event.target.value);
            setNotice('');
          }}
          className="font-mono text-xs"
        />
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          disabled={disabled || loading || saving || !dirty || !rootPath.trim()}
          onClick={() => void save()}
        >
          {saving ? 'Saving…' : 'Save Folder'}
        </Button>
        {dirty && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={disabled || saving}
            onClick={() => {
              setRootPath(settings?.rootPath || '');
              setError('');
            }}
          >
            Reset
          </Button>
        )}
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={disabled || loading || saving}
          onClick={() => {
            setLoading(true);
            setNotice('');
            setReload((value) => value + 1);
          }}
        >
          <RefreshCw /> {error ? 'Retry / Reload' : 'Reload'}
        </Button>
      </div>
      <p className="text-[11px] text-muted-foreground">
        Changes apply to new projects only. Existing project folders remain in
        their original location.
      </p>
      {dirty && (
        <p className="text-xs text-amber-800">
          Save or reset the folder change before creating a project.
        </p>
      )}
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      {notice && (
        <output className="block text-xs text-emerald-700">{notice}</output>
      )}
    </section>
  );
}

export function ProjectFileList({
  projectId,
  files,
  showAssociation = false,
}: {
  projectId: string;
  files: ProjectFileRecord[];
  showAssociation?: boolean;
}) {
  if (!files.length)
    return (
      <p className="py-5 text-center text-xs text-muted-foreground">
        No documents archived yet.
      </p>
    );
  return (
    <ul
      className="max-h-64 divide-y overflow-y-auto rounded-lg border"
      aria-label="Archived documents"
    >
      {files.map((file) => (
        <li key={file.id} className="flex items-center gap-3 px-3 py-2.5">
          <div className="min-w-0 flex-1">
            <p
              className="break-words text-xs font-medium"
              title={file.relativePath}
            >
              {file.originalName}
            </p>
            <p className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
              <span>{projectFileSizeLabel(file.sizeBytes)}</span>
              <time dateTime={file.createdAt}>
                {dateLabel(file.createdAt)} SGT
              </time>
              {showAssociation && (
                <span className="capitalize">
                  {[
                    file.category,
                    file.versionCode,
                    file.nodeName || file.nodeCode,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              )}
            </p>
          </div>
          <a
            href={projectFileDownloadUrl(projectId, file.id)}
            download={file.originalName}
            className="flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs text-primary hover:bg-muted"
            aria-label={`Download ${file.originalName}`}
          >
            <Download className="size-3.5" /> Download
          </a>
        </li>
      ))}
    </ul>
  );
}

type UploadItem = {
  file: File;
  requestId: string;
  status: 'pending' | 'uploading' | 'failed';
  error?: string;
};
type ProjectFilesPanelProps = {
  projectId: string;
  nodeCode?: string;
  nodeName?: string;
  versionCode?: string;
  refreshKey?: number;
  onArchived?: () => void;
  onUploadingChange?: (uploading: boolean) => void;
  disabled?: boolean;
};

const isFileDrag = (event: DragEvent<HTMLElement>) =>
  Array.from(event.dataTransfer.types || []).includes('Files') ||
  event.dataTransfer.files.length > 0;

/** The entire archive card accepts files; the native button also works by keyboard. */
export function ProjectFileDropzone({
  title,
  target,
  versionCode,
  node = false,
  dragging = false,
  disabled = false,
  uploading = false,
  loading = false,
  onDraggingChange,
  onFiles,
  onBrowse,
  onRefresh,
  children,
}: {
  title: string;
  target: string;
  versionCode?: string;
  node?: boolean;
  dragging?: boolean;
  disabled?: boolean;
  uploading?: boolean;
  loading?: boolean;
  onDraggingChange: (dragging: boolean) => void;
  onFiles: (files: File[]) => void;
  onBrowse: () => void;
  onRefresh: () => void;
  children?: ReactNode;
}) {
  const unavailable = disabled || uploading;
  const dragOver = (event: DragEvent<HTMLElement>) => {
    if (!isFileDrag(event)) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = unavailable ? 'none' : 'copy';
    onDraggingChange(!unavailable);
  };
  return (
    // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- The native picker button provides the keyboard equivalent of this region's file drop.
    <section
      aria-label={node ? 'Workflow Step Documents' : 'Project File Archive'}
      className={`space-y-3 rounded-xl border p-4 transition-colors ${dragging && !unavailable ? 'border-[#2e6f77] bg-[#eef7f6] ring-2 ring-[#2e6f77]/15' : 'border-border bg-card'}`}
      onDragEnter={dragOver}
      onDragOver={dragOver}
      onDragLeave={(event) => {
        if (
          event.relatedTarget &&
          typeof Node !== 'undefined' &&
          event.relatedTarget instanceof Node &&
          event.currentTarget.contains(event.relatedTarget)
        )
          return;
        onDraggingChange(false);
      }}
      onDrop={(event) => {
        if (!isFileDrag(event)) return;
        event.preventDefault();
        event.stopPropagation();
        onDraggingChange(false);
        if (!unavailable) onFiles(Array.from(event.dataTransfer.files));
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            {title}
            {versionCode && (
              <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-normal text-muted-foreground">
                {versionCode}
              </span>
            )}
          </h3>
          <p className="mt-1 break-words text-[11px] text-muted-foreground">
            {target}
          </p>
        </div>
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          disabled={loading}
          onClick={onRefresh}
          aria-label={node ? 'Refresh step documents' : 'Refresh project files'}
          title="Refresh documents"
        >
          <RefreshCw className={loading ? 'animate-spin' : ''} />
        </Button>
      </div>
      <button
        type="button"
        aria-label={`Choose files for ${target}`}
        disabled={unavailable}
        onClick={onBrowse}
        className={`flex w-full items-center justify-center gap-3 rounded-lg border border-dashed px-4 py-4 text-left transition-colors disabled:cursor-wait disabled:opacity-60 ${dragging && !unavailable ? 'border-[#2e6f77] bg-white/70' : 'border-[#bdcece] bg-[#f7faf9] hover:border-[#2e6f77] hover:bg-[#eef7f6]'} focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2e6f77]`}
      >
        <Upload className="pointer-events-none size-5 shrink-0 text-[#2e6f77]" />
        <span className="pointer-events-none">
          <span className="block text-xs font-medium text-[#173a52]">
            {uploading
              ? 'Uploading files…'
              : dragging && !disabled
                ? 'Release to upload'
                : 'Drop files here'}
          </span>
          <span className="mt-0.5 block text-[11px] text-muted-foreground">
            {uploading
              ? 'Files are being archived'
              : disabled
                ? 'Wait for the current update'
                : 'or click to browse · 50 MiB per file'}
          </span>
        </span>
      </button>
      {children}
    </section>
  );
}

/** Re-mount the controller on association changes so pending requests cannot replace another node's files. */
export function ProjectFilesPanel(props: ProjectFilesPanelProps) {
  return (
    <ProjectFilesController
      key={JSON.stringify([props.projectId, props.nodeCode, props.versionCode])}
      {...props}
    />
  );
}

function ProjectFilesController({
  projectId,
  nodeCode,
  nodeName,
  versionCode,
  refreshKey = 0,
  onArchived,
  onUploadingChange,
  disabled = false,
}: ProjectFilesPanelProps) {
  const isNode = Boolean(nodeCode);
  const [dragging, setDragging] = useState(false);
  const [archive, setArchive] = useState<ProjectFileArchive | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [queue, setQueue] = useState<UploadItem[]>([]);
  const [uploading, setUploading] = useState(false);
  const [reload, setReload] = useState(0);
  const live = useRef(false);
  const uploadingRef = useRef(false);
  const selectionRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  useEffect(() => {
    return () => {
      onUploadingChange?.(false);
    };
  }, [onUploadingChange]);
  useEffect(() => {
    if (!uploading) return;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => {
      window.removeEventListener('beforeunload', beforeUnload);
    };
  }, [uploading]);
  useEffect(() => {
    let cancelled = false;
    const filter: ProjectFileFilter = isNode
      ? { category: 'workflow', nodeCode, versionCode }
      : {};
    void listProjectFiles(projectId, filter)
      .then((value) => {
        if (cancelled) return;
        setArchive(value);
        setError('');
      })
      .catch((cause) => {
        if (!cancelled) setError(errorMessage(cause));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, nodeCode, versionCode, isNode, reload, refreshKey]);

  const upload = async (items: UploadItem[]) => {
    if (disabled || uploadingRef.current || !items.length) return;
    uploadingRef.current = true;
    onUploadingChange?.(true);
    setUploading(true);
    setNotice('');
    let count = 0;
    for (const item of items) {
      if (!live.current) break;
      setQueue((previous) =>
        previous.map((row) =>
          row.requestId === item.requestId
            ? { ...row, status: 'uploading', error: undefined }
            : row,
        ),
      );
      try {
        await archiveProjectFile(projectId, item.file, {
          category: isNode ? 'workflow' : 'general',
          ...(isNode ? { nodeCode, versionCode } : {}),
          requestId: item.requestId,
        });
        count += 1;
        if (live.current)
          setQueue((previous) =>
            previous.filter((row) => row.requestId !== item.requestId),
          );
      } catch (cause) {
        if (live.current)
          setQueue((previous) =>
            previous.map((row) =>
              row.requestId === item.requestId
                ? { ...row, status: 'failed', error: errorMessage(cause) }
                : row,
            ),
          );
      }
    }
    uploadingRef.current = false;
    if (!live.current) return;
    setUploading(false);
    onUploadingChange?.(false);
    if (count) {
      setNotice(`${count} document${count === 1 ? '' : 's'} archived.`);
      setReload((value) => value + 1);
      onArchived?.();
    }
  };
  const selectFiles = (files: File[]) => {
    if (disabled || uploadingRef.current) return;
    const items: UploadItem[] = files.map((file) => ({
      file,
      requestId: crypto.randomUUID(),
      status: file.size > MAX_PROJECT_FILE_BYTES ? 'failed' : 'pending',
      ...(file.size > MAX_PROJECT_FILE_BYTES
        ? { error: 'Each file must be 50 MiB or smaller.' }
        : {}),
    }));
    setQueue((previous) => [...previous, ...items]);
    void upload(items.filter((item) => item.status === 'pending'));
  };
  return (
    <ProjectFileDropzone
      title={isNode ? 'Documents' : 'Project Files'}
      target={
        isNode
          ? `workflow / ${nodeName || nodeCode}`
          : 'All project documents · Drop uploads to workflow'
      }
      versionCode={isNode ? versionCode : undefined}
      node={isNode}
      dragging={dragging}
      disabled={disabled}
      uploading={uploading}
      loading={loading}
      onDraggingChange={setDragging}
      onFiles={selectFiles}
      onBrowse={() => selectionRef.current?.click()}
      onRefresh={() => {
        setLoading(true);
        setReload((value) => value + 1);
      }}
    >
      <input
        ref={selectionRef}
        type="file"
        multiple
        className="sr-only"
        aria-label={isNode ? 'Choose step documents' : 'Choose project files'}
        disabled={disabled || uploading}
        onChange={(event) => {
          selectFiles(Array.from(event.target.files || []));
          event.target.value = '';
        }}
      />
      {!isNode && archive && (
        <p
          className="break-all rounded-md bg-muted/40 px-2 py-1.5 font-mono text-[11px]"
          title="Project archive folder"
        >
          {archive.projectPath}
        </p>
      )}
      {loading && (
        <output className="block text-xs text-muted-foreground">
          Loading documents…
        </output>
      )}
      {error && (
        <div
          role="alert"
          className="flex items-center gap-2 text-xs text-destructive"
        >
          <span>{error}</span>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={loading}
            onClick={() => {
              setLoading(true);
              setReload((value) => value + 1);
            }}
          >
            Retry
          </Button>
        </div>
      )}
      {archive && (
        <ProjectFileList
          projectId={projectId}
          files={archive.files}
          showAssociation={!isNode}
        />
      )}
      {queue.length > 0 && (
        <ul className="space-y-2" aria-label="Upload queue">
          {queue.map((item) => (
            <li
              key={item.requestId}
              className="flex flex-wrap items-center gap-2 rounded-md bg-muted/30 px-3 py-2 text-xs"
            >
              <span className="min-w-0 flex-1 break-words">
                {item.file.name} · {projectFileSizeLabel(item.file.size)}
              </span>
              {item.status === 'failed' ? (
                <>
                  <span role="alert" className="w-full text-destructive">
                    {item.error}
                  </span>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={
                      disabled ||
                      uploading ||
                      item.file.size > MAX_PROJECT_FILE_BYTES
                    }
                    onClick={() => void upload([item])}
                  >
                    Retry Upload
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={uploading}
                    onClick={() =>
                      setQueue((previous) =>
                        previous.filter(
                          (row) => row.requestId !== item.requestId,
                        ),
                      )
                    }
                  >
                    Dismiss
                  </Button>
                </>
              ) : (
                <span>
                  {item.status === 'uploading' ? 'Uploading…' : 'Waiting…'}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {notice && (
        <output className="block text-xs text-emerald-700">{notice}</output>
      )}
    </ProjectFileDropzone>
  );
}
