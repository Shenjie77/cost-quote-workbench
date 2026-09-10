/** Singapore-local SLA arithmetic, shared by node pauses and project holds. */
import type { WorkflowStep } from './types.ts';

const MILLISECONDS_PER_HOUR = 3_600_000;
const MILLISECONDS_PER_DAY = 24 * MILLISECONDS_PER_HOUR;
const SINGAPORE_OFFSET = 8 * MILLISECONDS_PER_HOUR;
const BUSINESS_DAY_START = 9 * MILLISECONDS_PER_HOUR;
const BUSINESS_DAY_END = 18 * MILLISECONDS_PER_HOUR;
const BUSINESS_HOURS_PER_DAY = 9;
const MAX_CALENDAR_SEARCH_DAYS = 4000;

/** Return the Singapore calendar date without depending on the host timezone. */
export function workflowLocalDate(time: string | number = Date.now()) {
  const milliseconds = typeof time === 'number' ? time : Date.parse(time);
  return new Date(milliseconds + SINGAPORE_OFFSET).toISOString().slice(0, 10);
}

/** Parse an action timestamp, retaining its field-specific validation error. */
export function parseWorkflowTimestamp(value: string, field: string) {
  const parsed = Date.parse(value);
  if (!value || !Number.isFinite(parsed))
    throw new TypeError(`${field} must be a valid date and time.`);
  return parsed;
}

/** Reject malformed date-only strings and dates normalized into another month. */
export function isWorkflowDate(value: string) {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(value)) &&
    new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value
  );
}

/** Determine whether a Singapore date is a weekday outside configured holidays. */
function isBusinessDay(time: number, holidays: string[]) {
  const weekday = new Date(time + SINGAPORE_OFFSET).getUTCDay();
  return (
    weekday !== 0 &&
    weekday !== 6 &&
    !holidays.includes(workflowLocalDate(time))
  );
}

/** Resolve local midnight as an absolute timestamp for the containing date. */
function localDayStart(time: number) {
  return Date.parse(`${workflowLocalDate(time)}T00:00:00+08:00`);
}

/** Advance to an available 09:00–18:00 business interval, preserving in-range time. */
function nextBusinessTime(time: number, holidays: string[]) {
  let cursor = time;
  for (
    let daysSearched = 0;
    daysSearched < MAX_CALENDAR_SEARCH_DAYS;
    daysSearched++
  ) {
    const start = localDayStart(cursor);
    if (isBusinessDay(cursor, holidays) && cursor < start + BUSINESS_DAY_END)
      return Math.max(cursor, start + BUSINESS_DAY_START);
    cursor = start + MILLISECONDS_PER_DAY + BUSINESS_DAY_START;
  }
  throw new TypeError('The work calendar has no available business days.');
}

/** Consume working milliseconds across business intervals, weekends, and holidays. */
function addBusinessTime(time: number, duration: number, holidays: string[]) {
  let cursor = nextBusinessTime(time, holidays);
  let remaining = duration;
  while (remaining > 0) {
    const available = localDayStart(cursor) + BUSINESS_DAY_END - cursor;
    if (remaining <= available) return cursor + remaining;
    remaining -= available;
    cursor = nextBusinessTime(
      localDayStart(cursor) + MILLISECONDS_PER_DAY + BUSINESS_DAY_START,
      holidays,
    );
  }
  return cursor;
}

/** Measure only working milliseconds inside the half-open pause interval. */
function businessDuration(from: number, until: number, holidays: string[]) {
  let cursor = nextBusinessTime(from, holidays);
  let total = 0;
  while (cursor < until) {
    total += Math.max(
      0,
      Math.min(until, localDayStart(cursor) + BUSINESS_DAY_END) - cursor,
    );
    cursor = nextBusinessTime(
      localDayStart(cursor) + MILLISECONDS_PER_DAY + BUSINESS_DAY_START,
      holidays,
    );
  }
  return total;
}

/** Calculate the SLA deadline using elapsed days or nine-hour business days. */
export function workflowDueAt(step: WorkflowStep, startedAt: string) {
  const start = parseWorkflowTimestamp(startedAt, 'Start time');
  const days = step.slaDays ?? 3;
  return new Date(
    step.slaCalendar === 'calendar'
      ? start + days * MILLISECONDS_PER_DAY
      : addBusinessTime(
          start,
          days * BUSINESS_HOURS_PER_DAY * MILLISECONDS_PER_HOUR,
          step.slaHolidays || [],
        ),
  ).toISOString();
}

/** Extend an existing deadline by the pause time counted by the node's calendar. */
export function shiftWorkflowDeadline(
  step: WorkflowStep,
  from: number,
  until: number,
) {
  if (!step.dueAt || until <= from) return;
  const due = parseWorkflowTimestamp(step.dueAt, 'Due time');
  const elapsed =
    step.slaCalendar === 'calendar'
      ? until - from
      : businessDuration(from, until, step.slaHolidays || []);

  // A business pause with no working time must not move an off-hours deadline.
  step.dueAt = new Date(
    step.slaCalendar === 'calendar'
      ? due + elapsed
      : elapsed
        ? addBusinessTime(due, elapsed, step.slaHolidays || [])
        : due,
  ).toISOString();
}

/** Move a follow-up by Singapore date boundaries crossed during a project hold. */
export function shiftWorkflowFollowUpDate(
  followUpDate: string,
  from: number,
  until: number,
) {
  const elapsedDays = Math.max(
    0,
    (Date.parse(workflowLocalDate(until)) -
      Date.parse(workflowLocalDate(from))) /
      MILLISECONDS_PER_DAY,
  );
  return new Date(Date.parse(followUpDate) + elapsedDays * MILLISECONDS_PER_DAY)
    .toISOString()
    .slice(0, 10);
}
