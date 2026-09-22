'use client';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import type { DigestItem } from './digest-domain';
type Reminder = {
  id: string;
  fingerprint: string;
  item: DigestItem;
  active: boolean;
  acknowledged: boolean;
};
const url = 'http://127.0.0.1:3210/api/local/reminders';
/** Keep reminder acknowledgement and exact-task navigation in a compact expandable inbox. */
export function ReminderInbox({
  onOpen,
  refreshKey = '',
}: {
  /** Recheck immediately after a project workflow or round changes. */
  refreshKey?: string;
  onOpen: (
    projectId: string,
    view: 'ssr' | 'reviews' | 'cost' | 'project',
    nodeCode?: string,
  ) => void;
}) {
  const [items, setItems] = useState<Reminder[]>([]),
    [open, setOpen] = useState(false),
    [error, setError] = useState('');
  useEffect(() => {
    let alive = true;
    const refresh = async () => {
      try {
        const response = await fetch(url);
        const body = (await response.json()) as {
          ok: boolean;
          data: { items: Reminder[] };
          error?: { message?: string };
        };
        if (!response.ok || !body.ok)
          throw new Error(body.error?.message || '提醒服务不可用');
        if (alive) {
          setItems(body.data.items);
          setError('');
        }
      } catch {
        if (alive) setError('提醒服务暂不可用，请检查本地服务');
      }
    };
    void refresh();
    const timer = setInterval(refresh, 60000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [refreshKey]);
  const active = items.filter((i) => i.active),
    unread = active.filter((i) => !i.acknowledged);
  return (
    <section
      aria-label="Project follow-up reminders"
      className="mb-2 min-w-0 border-b border-border px-1 py-1"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button
          variant="ghost"
          size="sm"
          className="h-8 px-2 text-xs"
          aria-expanded={open}
          aria-controls="project-reminder-list"
          onClick={() => setOpen(!open)}
        >
          跟进提醒 · {unread.length} 条未读 / {active.length} 条待处理
        </Button>
        <span
          role={error ? 'alert' : undefined}
          className="text-xs text-muted-foreground"
        >
          {error ||
            (open ? '按节点 SLA 与提醒配置检查，完成或关闭提醒后自动移出' : '')}
        </span>
      </div>
      {open && (
        <div
          id="project-reminder-list"
          className="max-h-80 divide-y overflow-auto"
        >
          {active.length === 0 && (
            <p className="text-sm text-muted-foreground">暂无待处理提醒</p>
          )}
          {active.map((r) => (
            <div
              key={r.id}
              className="flex flex-wrap items-center justify-between gap-2 px-2 py-2 hover:bg-muted/20"
            >
              <button
                className="min-w-0 flex-1 rounded-md text-left text-sm focus-visible:outline-2 focus-visible:outline-ring"
                onClick={() =>
                  onOpen(
                    r.item.projectId,
                    r.item.action === 'ssr'
                      ? 'ssr'
                      : r.item.action === 'review'
                        ? 'reviews'
                        : r.item.action === 'cost'
                          ? 'cost'
                          : 'project',
                    r.item.workflowNodeId,
                  )
                }
              >
                <p className="font-medium">{r.item.titleZh}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {r.item.detailZh}
                </p>
              </button>
              {!r.acknowledged && (
                <Button
                  variant="outline"
                  onClick={async () => {
                    try {
                      const response = await fetch(url, {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                          id: r.id,
                          fingerprint: r.fingerprint,
                        }),
                      });
                      const body = (await response.json()) as {
                        ok: boolean;
                        data: { items: Reminder[] };
                        error?: { message?: string };
                      };
                      if (!response.ok || !body.ok)
                        throw new Error(body.error?.message);
                      setItems(body.data.items);
                    } catch (e) {
                      setError(String(e));
                    }
                  }}
                >
                  已阅
                </Button>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
