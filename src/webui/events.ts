import type { Response } from "express";

interface Event {
  id: number;
  type: string;
  data: unknown;
  timestamp: string;
}

const MAX_HISTORY = 500;
const history: Event[] = [];
const subscribers = new Set<Response>();
let nextId = 1;

export function emit(type: string, data: unknown): void {
  const event: Event = {
    id: nextId++,
    type,
    data,
    timestamp: new Date().toISOString(),
  };

  history.push(event);
  if (history.length > MAX_HISTORY) {
    history.shift();
  }

  const msg = `id: ${event.id}\nevent: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`;
  for (const res of subscribers) {
    try {
      res.write(msg);
    } catch {
      subscribers.delete(res);
    }
  }
}

export function subscribe(res: Response): void {
  subscribers.add(res);

  // Send history
  for (const event of history) {
    const msg = `id: ${event.id}\nevent: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`;
    res.write(msg);
  }
}

export function unsubscribe(res: Response): void {
  subscribers.delete(res);
}

export function getHistory(): Event[] {
  return [...history];
}
