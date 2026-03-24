// Minimal cron expression parser (5-field: minute hour dom month dow).
// No external dependencies — supports standard cron syntax:
// wildcards (*), ranges (1-5), steps (*/5, 1-10/2), lists (1,3,5).

export interface CronFields {
  minutes: Set<number>;
  hours: Set<number>;
  daysOfMonth: Set<number>;
  months: Set<number>;
  daysOfWeek: Set<number>;
}

function parseField(field: string, min: number, max: number): Set<number> {
  const values = new Set<number>();

  for (const part of field.split(",")) {
    const stepMatch = part.match(/^(.+)\/(\d+)$/);
    const step = stepMatch ? parseInt(stepMatch[2]!, 10) : 1;
    const range = stepMatch ? stepMatch[1]! : part;

    let start: number;
    let end: number;

    if (range === "*") {
      start = min;
      end = max;
    } else if (range.includes("-")) {
      const parts = range.split("-");
      if (parts.length !== 2) {
        throw new Error(`Invalid range: ${range}`);
      }
      const [a, b] = parts.map(Number);
      if (isNaN(a!) || isNaN(b!)) {
        throw new Error(`Invalid range values: ${range}`);
      }
      start = a!;
      end = b!;
    } else {
      start = parseInt(range, 10);
      end = start;
    }

    for (let i = start; i <= end; i += step) {
      if (i >= min && i <= max) {
        values.add(i);
      }
    }
  }

  return values;
}

/**
 * Parse a 5-field cron expression.
 * @throws if the expression is invalid
 */
export function parseCron(expression: string): CronFields {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) {
    throw new Error(`Invalid cron expression: expected 5 fields, got ${parts.length}`);
  }

  return {
    minutes: parseField(parts[0]!, 0, 59),
    hours: parseField(parts[1]!, 0, 23),
    daysOfMonth: parseField(parts[2]!, 1, 31),
    months: parseField(parts[3]!, 1, 12),
    daysOfWeek: parseField(parts[4]!, 0, 6), // 0=Sunday
  };
}

/** Check if a Date matches the given cron fields. */
export function matchesCron(date: Date, fields: CronFields): boolean {
  return (
    fields.minutes.has(date.getMinutes()) &&
    fields.hours.has(date.getHours()) &&
    fields.daysOfMonth.has(date.getDate()) &&
    fields.months.has(date.getMonth() + 1) &&
    fields.daysOfWeek.has(date.getDay())
  );
}
