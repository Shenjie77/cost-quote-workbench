'use client';

import { Surface, Text } from '@/components/ui/presentation';
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
    <Surface
      aria-label="Project follow-up reminders"
      as="section"
      variant="item"
      className="mb-2 min-w-0"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button
          variant="ghost"
          size="sm"

          aria-expanded={open}
          aria-controls="project-reminder-list"
          onClick={() => setOpen(!open)}
        >
          跟进提醒 · {unread.length} 条未读 / {active.length} 条待处理
        </Button>
        <Text
          role={error ? 'alert' : undefined}
          as="span"
          tone="muted"
          textRole="body-small"
        >
          {error ||
            (open ? '按节点 SLA 与提醒配置检查，完成或关闭提醒后自动移出' : '')}
        </Text>
      </div>
      {open && (
        <Surface
          id="project-reminder-list"
          as="div"
          variant="list"
          className="max-h-80 overflow-auto"
        >
          {active.length === 0 && (
            <Text as="p" tone="muted" textRole="body-main">
              暂无待处理提醒
            </Text>
          )}
          {active.map((r) => (
            <Surface
              key={r.id}
              as="div"
              variant="body"
              className="flex flex-wrap items-center justify-between gap-2"
            >
              <Button
                variant="ghost"
                className="min-w-0 flex-1 text-left"
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
                <p>{r.item.titleZh}</p>
                <Text
                  as="p"
                  tone="muted"
                  textRole="body-small"
                  className="mt-1"
                >
                  {r.item.detailZh}
                </Text>
              </Button>
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
            </Surface>
          ))}
        </Surface>
      )}
    </Surface>
  );
}
