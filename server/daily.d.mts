import type { DailyEntry } from './validate.mjs';
export const BOARD_TOP: number;
export const KEEP_DAYS: number;
export function byRank(a: DailyEntry, b: DailyEntry): number;
export interface Board {
  submit(e: DailyEntry): { improved: boolean; entry: DailyEntry; rank: number; count: number };
  top(date: string, n?: number, callsign?: string): { date: string; count: number; entries: (DailyEntry & { rank: number })[]; you?: DailyEntry & { rank: number } };
  prune(today: string, keep?: number): void;
  toJSON(): Record<string, DailyEntry[]>;
  readonly days: number;
}
export function createBoard(data?: unknown): Board;
