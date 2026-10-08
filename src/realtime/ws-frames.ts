import type { ErrorCode } from '../common/app-error.js';

export interface WsFrame {
  type: string;
  payload: unknown;
}

export function errorFrame(code: ErrorCode, message: string = code): WsFrame {
  return { type: 'error', payload: { code, message } };
}
