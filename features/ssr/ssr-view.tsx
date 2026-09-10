'use client';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { CostVersionSnapshot } from '@/features/cost/domain';
import { normalizeDigestDate } from '@/features/agent/digest-domain';
import {
  submitReviewFromView,
  type ReviewSubmissionInput,
} from './review-submission-action';
import {
  REVIEW_KINDS,
  recordReviewResult,
  closeCondition,
  followUpSubmission,
  latestResult,
  openConditions,
  isStale,
  ssrAttention,
  type SsrWorkspace,
  type ReviewKind,
  type ReviewResult,
} from './domain';

const labels: Record<ReviewKind, string> = {
  DTRB: 'DTRB · TD技术评审',
  DRB: 'DRB · PM交付评审',
  BUDGET: '概算申请',
  SPECIALIST: '专业评审',
  QUOTE_DECISION: '报价决策',
  BID_REVIEW: '标书答复评审',
};
const selectClass =
  'h-8 rounded-md border border-input bg-card px-2.5 text-xs focus-visible:outline-2 focus-visible:outline-ring';
export function SsrView({
  value,
  onChange,
  baseline,
  baselines = [baseline],
  onRequestConfirmCost,
  announce,
}: {
  value: SsrWorkspace;
  onChange: (v: SsrWorkspace) => void | boolean;
  baseline: CostVersionSnapshot;
  baselines?: CostVersionSnapshot[];
  onRequestConfirmCost: (input: ReviewSubmissionInput) => void;
  announce: (s: string) => void;
}) {
  const domainsSource = value.requiredDomains.join(', ');
  const [domainEdit, setDomainEdit] = useState<{
    source: string;
    text: string;
  } | null>(null);
  const domainsText =
    domainEdit?.source === domainsSource ? domainEdit.text : domainsSource;
  const setDomainsText = (text: string) =>
    setDomainEdit({ source: domainsSource, text });
  const [submission, setSubmission] = useState({
    kind: 'DTRB' as ReviewKind,
    domain: '',
    owner: '',
    dueDate: normalizeDigestDate(),
    applicationNumber: '',
    evidence: '',
  });
  const [selected, setSelected] = useState('');
  const [showHistory, setShowHistory] = useState(false);
  const [result, setResult] = useState({
    outcome: 'approved' as ReviewResult['outcome'],
    evidence: '',
    conditions: '',
  });
  const [closure, setClosure] = useState({ condition: '', evidence: '' });
  const [follow, setFollow] = useState({
    note: '',
    nextDate: normalizeDigestDate(),
  });
  const [bid, setBid] = useState({
    clause: '',
    requirement: '',
    domain: '',
    response: '',
    deviation: '',
    owner: '',
    dueDate: '',
  });
  const visibleSubmissions = value.submissions.filter(
    (item) => showHistory || item.costBaseline.code === baseline.code,
  );
  const record = visibleSubmissions.find((item) => item.id === selected);
  const recordBaseline = (item: SsrWorkspace['submissions'][number]) =>
    baselines.find((v) => v.code === item.costBaseline.code) ||
    item.costBaseline;
  const run = (action: () => SsrWorkspace, message: string) => {
    try {
      if (onChange(action()) !== false) announce(message);
    } catch (e) {
      announce(e instanceof Error ? e.message : String(e));
    }
  };
  const edit = (patch: Partial<SsrWorkspace>) =>
    onChange({ ...value, ...patch });
  const currentSubmissionIds = new Set(
    value.submissions
      .filter((item) => item.costBaseline.code === baseline.code)
      .map((item) => item.id),
  );
  const items = ssrAttention(value, baseline, normalizeDigestDate()).filter(
    (item) => currentSubmissionIds.has(item.id),
  );
  return (
    <div className="wb-page-stack">
      <div className="wb-panel px-3 py-2 text-xs">
        当前流程成本版本：<strong>{baseline.code}</strong> · {baseline.state}。
        {baseline.state !== 'Confirmed'
          ? 'DTRB · 本版成本待确认。'
          : '本版成本已确认。'}
        查看历史成本版本不会改变本轮流程。
      </div>
      <section className="wb-panel space-y-3 p-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-primary">
            项目范围与正式记录
          </h2>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={value.enabled}
              onChange={(e) => edit({ enabled: e.target.checked })}
            />
            启用 SSR 流程检查
          </label>
        </div>
        <p className="text-sm text-muted-foreground">
          先在公司平台完成申请，再登记申请号和依据。系统据此跟踪条件、责任人和日期；启用后，报价导出需有适用的报价决策。
        </p>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="block space-y-1 text-xs">
            Proposal 编号
            <Input
              value={value.proposalNumber}
              onChange={(e) => edit({ proposalNumber: e.target.value })}
            />
          </label>
          <label className="block space-y-1 text-xs">
            公司平台记录地址
            <Input
              value={value.companyUrl}
              onChange={(e) => edit({ companyUrl: e.target.value })}
            />
          </label>
          <label className="block space-y-1 text-xs">
            简短 Scope
            <Input
              value={value.scopeBrief}
              onChange={(e) => edit({ scopeBrief: e.target.value })}
            />
          </label>
          <label className="block space-y-1 text-xs">
            产品方案 / TD 人力计划版本或文件号
            <Input
              value={value.technicalBasis}
              onChange={(e) => edit({ technicalBasis: e.target.value })}
            />
          </label>
          <label className="block space-y-1 text-xs">
            必需专业领域（用逗号分隔）
            <Input
              value={domainsText}
              onChange={(e) => setDomainsText(e.target.value)}
              onBlur={() =>
                edit({
                  requiredDomains: [
                    ...new Set(
                      domainsText
                        .split(/[,，]/)
                        .map((x) => x.trim())
                        .filter(Boolean),
                    ),
                  ],
                })
              }
            />
          </label>
          <label className="block space-y-1 text-xs">
            业务类型
            <select
              className={selectClass + ' ml-3'}
              value={value.mode}
              onChange={(e) =>
                edit({ mode: e.target.value as SsrWorkspace['mode'] })
              }
            >
              <option value="service">服务报价</option>
              <option value="tender">项目投标</option>
            </select>
          </label>
        </div>
        <p className="text-xs text-muted-foreground">
          DTRB → DRB → 概算申请与专业评审并行 →
          报价决策。投标还需完成标书答复评审。成本或范围变化会显示原评审已不适用。
        </p>
      </section>
      {items.length > 0 && (
        <section className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs">
          <h2 className="mb-2 font-semibold">需要跟进</h2>
          {items.map((i) => (
            <button
              className="block py-1 text-left"
              key={i.id}
              onClick={() => setSelected(i.id)}
            >
              {i.title}：{i.detail}
            </button>
          ))}
        </section>
      )}
      {value.mode === 'tender' && (
        <section className="wb-panel space-y-3 p-3">
          <h2 className="text-sm font-semibold text-primary">各专业标书答复</h2>
          <div className="grid gap-3 md:grid-cols-2">
            {(
              [
                'clause',
                'requirement',
                'domain',
                'response',
                'deviation',
                'owner',
                'dueDate',
              ] as const
            ).map((k, i) => (
              <label key={k} className="block space-y-1 text-xs">
                {
                  [
                    '条款编号',
                    '招标要求',
                    '负责领域',
                    '答复内容',
                    '偏差 / 假设',
                    '负责人',
                    '答复期限',
                  ][i]
                }
                <Input
                  type={k === 'dueDate' ? 'date' : 'text'}
                  value={bid[k]}
                  onChange={(e) => setBid({ ...bid, [k]: e.target.value })}
                />
              </label>
            ))}
          </div>
          <Button
            variant="outline"
            onClick={() => {
              if (!bid.requirement.trim() || !bid.domain.trim()) {
                announce('请填写招标要求和负责领域');
                return;
              }
              edit({
                bidResponses: [
                  ...value.bidResponses,
                  { ...bid, id: crypto.randomUUID() },
                ],
              });
              setBid({
                ...bid,
                clause: '',
                requirement: '',
                response: '',
                deviation: '',
              });
            }}
          >
            添加条款
          </Button>
          <div className="wb-table-scroll rounded-lg border">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  {[
                    '条款',
                    '要求',
                    '领域 / 负责人',
                    '答复',
                    '偏差',
                    '期限',
                    '',
                  ].map((x) => (
                    <th
                      className="bg-muted/50 p-3 text-left text-xs font-semibold text-muted-foreground"
                      key={x}
                    >
                      {x}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {value.bidResponses.map((r) => (
                  <tr key={r.id} className="border-t">
                    <td>{r.clause}</td>
                    <td>{r.requirement}</td>
                    <td>
                      <Input
                        aria-label="负责领域"
                        value={r.domain}
                        onChange={(e) =>
                          edit({
                            bidResponses: value.bidResponses.map((x) =>
                              x.id === r.id
                                ? { ...x, domain: e.target.value }
                                : x,
                            ),
                          })
                        }
                      />
                      <Input
                        aria-label="负责人"
                        value={r.owner}
                        onChange={(e) =>
                          edit({
                            bidResponses: value.bidResponses.map((x) =>
                              x.id === r.id
                                ? { ...x, owner: e.target.value }
                                : x,
                            ),
                          })
                        }
                      />
                    </td>
                    <td>
                      <Input
                        aria-label="答复"
                        value={r.response}
                        onChange={(e) =>
                          edit({
                            bidResponses: value.bidResponses.map((x) =>
                              x.id === r.id
                                ? { ...x, response: e.target.value }
                                : x,
                            ),
                          })
                        }
                      />
                    </td>
                    <td>
                      <Input
                        aria-label="偏差"
                        value={r.deviation}
                        onChange={(e) =>
                          edit({
                            bidResponses: value.bidResponses.map((x) =>
                              x.id === r.id
                                ? { ...x, deviation: e.target.value }
                                : x,
                            ),
                          })
                        }
                      />
                    </td>
                    <td>
                      <Input
                        aria-label="答复期限"
                        type="date"
                        value={r.dueDate}
                        onChange={(e) =>
                          edit({
                            bidResponses: value.bidResponses.map((x) =>
                              x.id === r.id
                                ? { ...x, dueDate: e.target.value }
                                : x,
                            ),
                          })
                        }
                      />
                    </td>
                    <td>
                      <Button
                        variant="ghost"
                        onClick={() =>
                          edit({
                            bidResponses: value.bidResponses.filter(
                              (x) => x.id !== r.id,
                            ),
                          })
                        }
                      >
                        移除
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      <section className="wb-panel space-y-3 p-3">
        <h2 className="text-sm font-semibold text-primary">
          登记送审 · 保存成本 {baseline.code} 快照
        </h2>
        <div className="grid gap-3 md:grid-cols-3">
          <label className="block space-y-1 text-xs">
            评审
            <select
              className={selectClass + ' block w-full'}
              value={submission.kind}
              onChange={(e) =>
                setSubmission({
                  ...submission,
                  kind: e.target.value as ReviewKind,
                })
              }
            >
              {REVIEW_KINDS.map((k) => (
                <option key={k} value={k}>
                  {labels[k]}
                </option>
              ))}
            </select>
          </label>
          {submission.kind === 'SPECIALIST' && (
            <label className="block space-y-1 text-xs">
              领域
              <select
                className={selectClass + ' block w-full'}
                value={submission.domain}
                onChange={(e) =>
                  setSubmission({ ...submission, domain: e.target.value })
                }
              >
                <option value="">请选择</option>
                {value.requiredDomains.map((d) => (
                  <option key={d}>{d}</option>
                ))}
              </select>
            </label>
          )}
          {(['owner', 'dueDate', 'applicationNumber', 'evidence'] as const).map(
            (k, i) => (
              <label className="block space-y-1 text-xs" key={k}>
                {['负责人', '截止日期', '公司申请号', '申请依据 / 链接'][i]}
                <Input
                  type={k === 'dueDate' ? 'date' : 'text'}
                  value={submission[k]}
                  onChange={(e) =>
                    setSubmission({ ...submission, [k]: e.target.value })
                  }
                />
              </label>
            ),
          )}
        </div>
        <Button
          onClick={() =>
            submitReviewFromView({
              value,
              baseline,
              input: submission,
              onChange,
              onRequestConfirmCost,
              announce,
            })
          }
        >
          {submission.kind === 'DRB' && baseline.state !== 'Confirmed'
            ? '确认成本后登记 DRB'
            : '登记送审记录'}
        </Button>
      </section>
      <section className="wb-panel space-y-3 p-3">
        <h2 className="text-sm font-semibold text-primary">
          评审结果与条件关闭
        </h2>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={showHistory}
            onChange={(event) => {
              setShowHistory(event.target.checked);
              setSelected('');
            }}
          />
          显示所有版本的历史送审记录
        </label>
        <select
          aria-label="选择送审记录"
          className={selectClass + ' w-full'}
          value={selected}
          onChange={(e) => {
            setSelected(e.target.value);
            setClosure({ condition: '', evidence: '' });
            setResult({ outcome: 'approved', evidence: '', conditions: '' });
          }}
        >
          <option value="">选择送审记录</option>
          {[...visibleSubmissions].reverse().map((s) => (
            <option key={s.id} value={s.id}>
              {s.costBaseline.code} · {labels[s.kind]} {s.domain} ·{' '}
              {s.applicationNumber} · {latestResult(s)?.outcome || '待结果'}
              {isStale(value, s, recordBaseline(s)) ? ' · 材料已变化' : ''}
            </option>
          ))}
        </select>
        {record && (
          <>
            <p className="text-sm">
              负责人 {record.owner} · 截止 {record.dueDate} · 送审成本{' '}
              {record.costBaseline.code} · {record.evidence}
            </p>
            <div className="grid gap-2 md:grid-cols-3">
              <select
                aria-label="结果"
                className={selectClass}
                value={result.outcome}
                onChange={(e) =>
                  setResult({
                    ...result,
                    outcome: e.target.value as ReviewResult['outcome'],
                  })
                }
              >
                <option value="approved">通过</option>
                <option value="conditional">有条件通过</option>
                <option value="rejected">未通过</option>
                <option value="withdrawn">撤回</option>
              </select>
              <Input
                placeholder="公司平台实际结果依据"
                value={result.evidence}
                onChange={(e) =>
                  setResult({ ...result, evidence: e.target.value })
                }
              />
              <Input
                placeholder="待关闭条件，用分号分隔"
                value={result.conditions}
                onChange={(e) =>
                  setResult({ ...result, conditions: e.target.value })
                }
              />
            </div>
            <Button
              onClick={() =>
                run(
                  () =>
                    recordReviewResult(value, selected, {
                      ...result,
                      conditions: result.conditions.split(/[;；]/),
                    }),
                  '已记录实际评审结果',
                )
              }
            >
              记录结果
            </Button>
            {openConditions(record).length > 0 && (
              <div className="flex flex-wrap gap-2">
                <select
                  aria-label="未关闭条件"
                  className={selectClass}
                  value={closure.condition}
                  onChange={(e) =>
                    setClosure({ ...closure, condition: e.target.value })
                  }
                >
                  <option value="">选择待关闭条件</option>
                  {openConditions(record).map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
                <Input
                  className="max-w-md"
                  placeholder="条件关闭依据"
                  value={closure.evidence}
                  onChange={(e) =>
                    setClosure({ ...closure, evidence: e.target.value })
                  }
                />
                <Button
                  variant="outline"
                  onClick={() =>
                    run(
                      () =>
                        closeCondition(
                          value,
                          selected,
                          closure.condition,
                          closure.evidence,
                        ),
                      '已记录条件关闭依据',
                    )
                  }
                >
                  关闭条件
                </Button>
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              <Input
                className="max-w-md"
                placeholder="跟进内容 / PM 承诺"
                value={follow.note}
                onChange={(e) => setFollow({ ...follow, note: e.target.value })}
              />
              <Input
                aria-label="下次跟进日"
                type="date"
                className="w-44"
                value={follow.nextDate}
                onChange={(e) =>
                  setFollow({ ...follow, nextDate: e.target.value })
                }
              />
              <Button
                variant="outline"
                onClick={() =>
                  run(
                    () =>
                      followUpSubmission(
                        value,
                        selected,
                        follow.note,
                        follow.nextDate,
                      ),
                    '已记录下次跟进日',
                  )
                }
              >
                记录跟进
              </Button>
            </div>
            <details className="rounded-md border bg-muted/10 px-3 py-2">
              <summary className="cursor-pointer text-sm">查看历史依据</summary>
              <div className="space-y-2 pt-2 text-sm">
                {record.results.map((r) => (
                  <p key={r.id}>
                    {r.recordedAt} · {r.outcome} · {r.evidence}{' '}
                    {r.conditions.join('；')}
                  </p>
                ))}
                {record.closures.map((c, i) => (
                  <p key={i}>
                    关闭：{c.condition} · {c.evidence}
                  </p>
                ))}
                {record.followUps.map((f) => (
                  <p key={f.id}>
                    {f.recordedAt} · {f.note} · 下次 {f.nextDate}
                  </p>
                ))}
              </div>
            </details>
          </>
        )}
      </section>
    </div>
  );
}
