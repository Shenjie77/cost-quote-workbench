import { Surface, Text, DisclosureSummary } from '@/components/ui/presentation';
import { CheckInput } from '@/components/ui/check-input';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { SelectField } from '@/components/ui/select-field';
import { Textarea } from '@/components/ui/textarea';
import { useEffect, useRef, useState } from 'react';
import { StatusBadge } from '@/components/workbench/status-badge';
import type { DailyDigest, DigestItem } from '../agent/digest-domain';
import type { AiOutput, AiRun, Scene, SceneRecord } from './contracts';

const fieldClass = 'w-full';
type Settings = {
  provider: string;
  model: string;
  configured: boolean;
  timeoutMs: number;
  contextLength: number;
  maxTokens: number;
};

/** An opt-in experiment. Confirming writes feedback only, never a project/workflow. */
export function AiOutputPanel({
  digest,
  openItem,
}: {
  digest: DailyDigest;
  openItem: (item: DigestItem) => void;
}) {
  const [enabled, setEnabled] = useState(false);
  const [endpoint, setEndpoint] = useState('');
  const [scenes, setScenes] = useState<SceneRecord[]>([]);
  const [sceneId, setSceneId] = useState('');
  const [configText, setConfigText] = useState('');
  const [settings, setSettings] = useState<Settings>();
  const [adjustment, setAdjustment] = useState('');
  const [note, setNote] = useState('');
  const [run, setRun] = useState<AiRun>();
  const [final, setFinal] = useState<AiOutput>();
  const [history, setHistory] = useState<AiRun[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const locked = useRef(false);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  const enableExperiment = (value: boolean) => {
    setEnabled(value);
    if (value && !endpoint) {
      const local = ['localhost', '127.0.0.1', '[::1]'].includes(
        window.location.hostname,
      );
      let saved = '';
      try {
        saved = localStorage.getItem('ai-output-api') || '';
      } catch {
        /* Optional browser preference. */
      }
      setEndpoint(saved || (local ? 'http://127.0.0.1:3210/api/local' : ''));
    }
  };
  const record = scenes.find((s) => s.scene.id === sceneId);
  const setScene = (value: SceneRecord) => {
    setSceneId(value.scene.id);
    setAdjustment(value.scene.adjustment);
    setConfigText(JSON.stringify(value.scene, null, 2));
  };
  const apiUrl = (route: string) => {
    const base = new URL(endpoint);
    if (
      !['http:', 'https:'].includes(base.protocol) ||
      base.username ||
      base.password ||
      base.search ||
      base.hash
    )
      throw new Error('Use an HTTP(S) local API URL without credentials.');
    return `${base.href.replace(/\/$/, '')}/ai-output/${route}`;
  };
  async function api<T>(
    route: string,
    body?: unknown,
    method = body ? 'POST' : 'GET',
  ): Promise<T> {
    const c = new AbortController();
    controller.current = c;
    const timer = setTimeout(
      () => c.abort(),
      (settings?.timeoutMs || 120000) + 15000,
    );
    try {
      const response = await fetch(apiUrl(route), {
        method,
        signal: c.signal,
        headers: { 'Content-Type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      const envelope = (await response.json()) as {
        ok: boolean;
        data?: T;
        error?: { message?: string };
      };
      if (!response.ok || !envelope.ok)
        throw new Error(envelope.error?.message || 'Local API request failed.');
      return envelope.data as T;
    } finally {
      clearTimeout(timer);
      controller.current = null;
    }
  }
  async function perform(label: string, action: () => Promise<void>) {
    if (locked.current) return;
    locked.current = true;
    setBusy(label);
    setError('');
    setMessage('');
    try {
      await action();
    } catch (e) {
      setError(
        e instanceof Error && e.name !== 'AbortError'
          ? e.message
          : 'Request timed out or disconnected. Previous draft is retained; retry or use the original digest.',
      );
    } finally {
      locked.current = false;
      setBusy('');
    }
  }
  const load = () =>
    perform('Loading / 读取配置', async () => {
      const loadedSettings = await api<Settings>('settings');
      setSettings(loadedSettings);
      const values = await api<SceneRecord[]>('scenes');
      setScenes(values);
      if (values[0])
        setScene(values.find((s) => s.scene.id === sceneId) || values[0]);
      setHistory(await api<AiRun[]>('runs'));
      setSelected(digest.items.slice(0, 1).map((i) => i.id));
      try {
        localStorage.setItem('ai-output-api', endpoint);
      } catch {
        /* API remains usable without browser storage. */
      }
      setMessage(
        'Configuration loaded. Start with one source item at 4K. / 已读取配置，4K 建议先选一条。',
      );
    });
  const generate = (revise: boolean) =>
    perform('Generating / 正在生成', async () => {
      if (!record) throw new Error('Load a scene first.');
      const scene = JSON.parse(configText) as Scene;
      const result = await api<AiRun>('generate', {
        sceneId,
        sceneRevision: record.revision,
        scene,
        adjustment,
        sourceIds: selected,
        ...(revise && run ? { parentId: run.id } : {}),
      });
      setRun(result);
      setFinal(structuredClone(result.result!));
      setNote('');
      setHistory(await api<AiRun[]>('runs'));
      setMessage(
        'Draft saved. Review against source records before confirming. / 草稿已保存，请核对来源后确认。',
      );
    });
  const savePreset = () =>
    perform('Saving preset / 保存预设', async () => {
      if (!record) throw new Error('Load a scene first.');
      const scene = { ...JSON.parse(configText), adjustment } as Scene;
      const existing = scenes.find((s) => s.scene.id === scene.id);
      const saved = await api<SceneRecord>(
        'scenes',
        { scene, expectedRevision: existing?.revision ?? null },
        'PUT',
      );
      const values = await api<SceneRecord[]>('scenes');
      setScenes(values);
      setScene(saved);
      setMessage(
        `Scene revision ${saved.revision} saved. / 场景配置及调整要求已保存。`,
      );
    });
  function editEntry(
    sectionIndex: number,
    entryIndex: number,
    key: 'lead' | 'excerpt',
    value: string,
  ) {
    if (!final) return;
    const updated = structuredClone(final);
    updated.sections[sectionIndex].entries[entryIndex][key] = value;
    setFinal(updated);
  }
  return (
    <Surface as="section" variant="panel">
      <Surface as="div" variant="toolbar" className="justify-between">
        <Surface
          as="label"
          variant="inline-field"
          textRole="body-main"
          className="flex items-center"
        >
          <CheckInput
            type="checkbox"
            checked={enabled}
            disabled={Boolean(busy)}
            onChange={(e) => enableExperiment(e.target.checked)}
          />
          Local AI draft experiment / 本地 AI 草稿实验
        </Surface>
        <Text as="span" tone="muted" textRole="body-small">
          Feedback only · No automatic training / 仅存反馈，不自动训练
        </Text>
      </Surface>
      {enabled && (
        <Surface as="div" variant="footer">
          <Text as="p" tone="muted" textRole="body-small">
            原有摘要在下方始终可用。模型组织章节、顺序及来源摘录；数字、状态和期限由平台保留。确认仅保存认可稿，不修改项目。
          </Text>
          <div className="flex flex-wrap items-end gap-2">
            <Surface
              as="label"
              variant="field"
              textRole="body-small"
              className="min-w-64 flex-1"
            >
              Local backend API / 平台本地后端地址
              <Input
                className="w-full"
                value={endpoint}
                disabled={Boolean(busy)}
                onChange={(e) => setEndpoint(e.target.value)}
              />
            </Surface>
            <Button
              variant="ghost"
              className="disabled:cursor-not-allowed"
              disabled={Boolean(busy) || !endpoint}
              onClick={load}
            >
              Load configuration / 读取配置
            </Button>
            <Button
              variant="ghost"
              className="disabled:cursor-not-allowed"
              disabled={Boolean(busy) || !settings}
              onClick={() =>
                perform('Checking service / 检查连接', async () => {
                  const result = await api<{
                    reachable: boolean;
                    modelAvailable: boolean;
                    models: string[];
                  }>('probe', {});
                  setMessage(
                    result.modelAvailable
                      ? 'Service connected; configured model found. / 已连接，模型存在。'
                      : `Service connected; configured model not found. Available: ${result.models.join(', ')}`,
                  );
                })
              }
            >
              Check model connection / 验证模型连接
            </Button>
          </div>
          {settings && (
            <Text as="p" tone="muted" textRole="body-small">
              {settings.provider} ·{' '}
              {settings.model || 'Set WORKBENCH_AI_MODEL / 请配置模型名'} ·
              context {settings.contextLength} · output ≤ {settings.maxTokens}{' '}
              tokens · timeout {settings.timeoutMs / 1000}s · single request
            </Text>
          )}
          {!!scenes.length && (
            <>
              <Surface
                as="label"
                variant="field"
                textRole="body-small"
                className="block"
              >
                Scenario / 场景
                <SelectField
                  className="w-full"
                  value={sceneId}
                  disabled={Boolean(busy)}
                  onChange={(e) => {
                    const value = scenes.find(
                      (s) => s.scene.id === e.target.value,
                    );
                    if (value) {
                      setScene(value);
                      setRun(undefined);
                      setFinal(undefined);
                    }
                  }}
                >
                  {scenes.map((s) => (
                    <option key={s.scene.id} value={s.scene.id}>
                      {s.scene.name} · v{s.revision}
                    </option>
                  ))}
                </SelectField>
              </Surface>
              <details>
                <DisclosureSummary className="cursor-pointer">
                  Edit scene configuration / 编辑章节、语气、长度、必填项和示例
                </DisclosureSummary>
                <Text
                  as="p"
                  tone="muted"
                  textRole="body-small"
                  className="mb-2"
                >
                  JSON 配置可仅用于本次；保存预设保留版本。修改 id
                  可另存新场景。引导语由你维护，摘录必须逐字来自记录。sections
                  顺序即章节顺序；requiredFields 控制来源字段显示。
                </Text>
                <Surface
                  as="label"
                  variant="field"
                  textRole="body-small"
                  className="block"
                >
                  Scene JSON
                  <Textarea
                    className={`${fieldClass}`}
                    rows={14}
                    value={configText}
                    disabled={Boolean(busy)}
                    onChange={(e) => setConfigText(e.target.value)}
                  />
                </Surface>
              </details>
              <details open>
                <DisclosureSummary className="cursor-pointer">
                  Input snapshot selection / 选择输入记录（4K 从一条开始）
                </DisclosureSummary>
                <div className="max-h-48 space-y-2 overflow-auto">
                  {digest.items.map((item) => (
                    <Surface
                      as="label"
                      variant="inline-field"
                      textRole="body-small"
                      className="flex items-start"
                      key={item.id}
                    >
                      <CheckInput
                        type="checkbox"
                        disabled={Boolean(busy)}
                        checked={selected.includes(item.id)}
                        onChange={(e) =>
                          setSelected((ids) =>
                            e.target.checked
                              ? [...ids, item.id]
                              : ids.filter((id) => id !== item.id),
                          )
                        }
                      />
                      <span>
                        {item.titleZh || item.title} —{' '}
                        {item.detailZh || item.detail}
                      </span>
                    </Surface>
                  ))}
                  {!digest.items.length && (
                    <Text as="p" textRole="body-small">
                      No source items / 当前没有提醒事项
                    </Text>
                  )}
                </div>
              </details>
              <Surface
                as="label"
                variant="field"
                textRole="body-small"
                className="block"
              >
                Adjustment for this generation / 本次调整要求（最多 500 字）
                <Textarea
                  className="w-full"
                  rows={2}
                  maxLength={500}
                  disabled={Boolean(busy)}
                  value={adjustment}
                  onChange={(e) => setAdjustment(e.target.value)}
                />
              </Surface>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="ghost"
                  className="disabled:cursor-not-allowed"
                  disabled={Boolean(busy) || !settings?.configured}
                  onClick={() => generate(false)}
                >
                  Generate new draft / 生成新草稿
                </Button>
                <Button
                  variant="ghost"
                  className="disabled:cursor-not-allowed"
                  disabled={
                    Boolean(busy) || !run?.result || !settings?.configured
                  }
                  onClick={() => generate(true)}
                >
                  Revise same snapshot / 调整本次并重新生成
                </Button>
                <Button
                  variant="ghost"
                  className="disabled:cursor-not-allowed"
                  disabled={Boolean(busy)}
                  onClick={savePreset}
                >
                  Save as scene preset / 保存为场景预设
                </Button>
              </div>
            </>
          )}
          <Text
            aria-live="polite"
            as="output"
            textRole="body-small"
            className="block"
          >
            {busy || message}
          </Text>
          {error && (
            <Text role="alert" as="p" tone="danger" textRole="body-main">
              {error} 原有摘要和已有草稿保留。
            </Text>
          )}
          {run && final && (
            <div className="space-y-3">
              <Text as="p" tone="muted" textRole="body-small">
                Snapshot {run.snapshot.asOf} · {run.model} · scene v
                {run.sceneRevision} ·{' '}
                {run.status === 'confirmed'
                  ? 'Confirmed / 已确认'
                  : 'Draft / 待确认'}{' '}
                · {run.createdAt}
              </Text>
              {final.sections.map((section, si) => (
                <Surface as="section" variant="panel" key={section.id}>
                  <Surface as="h3" variant="header">
                    {run.scene.sections.find((s) => s.id === section.id)?.title}
                  </Surface>
                  {!section.entries.length && (
                    <Surface
                      as="p"
                      variant="body"
                      tone="muted"
                      textRole="body-small"
                    >
                      {run.scene.missing === 'pending'
                        ? 'Pending confirmation / 待确认'
                        : ''}
                    </Surface>
                  )}
                  {section.entries.map((entry, ei) => {
                    const source = run.snapshot.items.find(
                      (i) => i.id === entry.sourceId,
                    )!;
                    return (
                      <Surface
                        as="div"
                        variant="item"
                        className="space-y-2"
                        key={entry.sourceId}
                      >
                        <Surface
                          as="div"
                          textRole="body-main"
                          className="flex items-center gap-2"
                        >
                          <StatusBadge tone={source.severity}>
                            {source.severity}
                          </StatusBadge>
                          <span>{source.titleZh || source.title}</span>
                        </Surface>
                        <Surface
                          as="label"
                          variant="field"
                          textRole="body-small"
                          className="block"
                        >
                          Lead / 引导语
                          <Input
                            className="w-full"
                            disabled={
                              Boolean(busy) || run.status === 'confirmed'
                            }
                            value={entry.lead}
                            maxLength={80}
                            onChange={(e) =>
                              editEntry(si, ei, 'lead', e.target.value)
                            }
                          />
                        </Surface>
                        <Surface
                          as="label"
                          variant="field"
                          textRole="body-small"
                          className="block"
                        >
                          Draft content / 草稿内容
                          <Textarea
                            className="w-full"
                            rows={2}
                            disabled={
                              Boolean(busy) || run.status === 'confirmed'
                            }
                            maxLength={run.scene.maxExcerptChars}
                            value={entry.excerpt}
                            onChange={(e) =>
                              editEntry(si, ei, 'excerpt', e.target.value)
                            }
                          />
                        </Surface>
                        <details>
                          <DisclosureSummary className="cursor-pointer">
                            Source facts / 来源核对
                          </DisclosureSummary>
                          <Surface
                            as="dl"
                            variant="body"
                            tone="muted"
                            textRole="body-small"
                            className="space-y-1"
                          >
                            {run.scene.requiredFields.map((key) => (
                              <div key={key}>
                                <dt className="inline">{key}: </dt>
                                <dd className="inline">
                                  {source[key] ||
                                    (run.scene.missing === 'pending'
                                      ? '待确认'
                                      : '')}
                                </dd>
                              </div>
                            ))}
                          </Surface>
                        </details>
                        <Button
                          variant="ghost"
                          className="disabled:cursor-not-allowed"
                          onClick={() => openItem(source)}
                        >
                          Open source record / 打开原始记录
                        </Button>
                      </Surface>
                    );
                  })}
                </Surface>
              ))}
              <Surface
                as="label"
                variant="field"
                textRole="body-small"
                className="block"
              >
                Final feedback / 最终修改说明
                <Textarea
                  className="w-full"
                  maxLength={2000}
                  rows={2}
                  value={note}
                  disabled={Boolean(busy) || run.status === 'confirmed'}
                  onChange={(e) => setNote(e.target.value)}
                />
              </Surface>
              <Button
                variant="ghost"
                className="disabled:cursor-not-allowed"
                disabled={Boolean(busy) || run.status !== 'draft'}
                onClick={() =>
                  perform('Confirming / 保存认可稿', async () => {
                    const saved = await api<AiRun>('confirm', {
                      id: run.id,
                      final,
                      note,
                    });
                    setRun(saved);
                    setHistory(await api<AiRun[]>('runs'));
                    setMessage(
                      'Confirmed feedback saved. No project data changed. / 认可稿已保存，项目记录未修改。',
                    );
                  })
                }
              >
                Confirm final version / 确认并保存认可稿
              </Button>
            </div>
          )}
          {!!history.length && (
            <details>
              <DisclosureSummary className="cursor-pointer">
                Recent saved drafts / 最近 20 条记录
              </DisclosureSummary>
              <div className="flex flex-wrap gap-2">
                {history.map((value) => (
                  <Button
                    variant="ghost"
                    className="disabled:cursor-not-allowed"
                    key={value.id}
                    disabled={Boolean(busy) || !value.result}
                    onClick={() => {
                      setRun(value);
                      setFinal(structuredClone(value.final || value.result!));
                      setNote(value.finalNote || '');
                      const valueScene = scenes.find(
                        (s) => s.scene.id === value.scene.id,
                      );
                      if (valueScene) setScene(valueScene);
                      setAdjustment(value.adjustment);
                    }}
                  >
                    {value.createdAt.slice(0, 19)} · {value.status}
                  </Button>
                ))}
              </div>
            </details>
          )}
          <Button
            variant="ghost"
            className="disabled:cursor-not-allowed"
            disabled={Boolean(busy) || !endpoint}
            onClick={() =>
              perform('Exporting / 导出反馈', async () => {
                const response = await fetch(apiUrl('export'), {
                  signal: AbortSignal.timeout(30000),
                });
                if (!response.ok) throw new Error('Export failed.');
                const link = document.createElement('a');
                const href = URL.createObjectURL(await response.blob());
                link.href = href;
                link.download = 'daily-digest-feedback.jsonl';
                link.click();
                setTimeout(() => URL.revokeObjectURL(href), 1000);
                setMessage(
                  'JSONL exported. Feedback is not automatically used for training. / 已导出，不会自动训练。',
                );
              })
            }
          >
            Export feedback JSONL / 导出反馈
          </Button>
        </Surface>
      )}
    </Surface>
  );
}
