// Types for the zero-dependency server modules, so the TypeScript unit tests can import them.
export interface DailyEntry { callsign: string; date: string; score: number; sector: number; floor: number; kills: number; hull: string; won: boolean; at: number }
export const HULL_IDS: string[];
export const DAILY_LIMITS: { score: number; kills: number; sector: number; floor: number; callsign: number; rawString: number };
export function validateGhost(g: any): any;
export function utcDateKey(t?: number): string;
export function isDateKey(s: unknown): boolean;
export function dailyDateOpen(date: unknown, now?: number): boolean;
export function cleanCallsign(raw: unknown): string;
export function validateDaily(b: unknown, now?: number): { entry: DailyEntry; error?: undefined } | { error: string; entry?: undefined };
export function validStoredDaily(e: unknown): DailyEntry | null;
export function rateLimiter(o?: { max?: number; windowMs?: number; gapMs?: number }): { hit(key: string, now?: number): number };
