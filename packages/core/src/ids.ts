import { randomUUID } from 'node:crypto';

export function newId(prefix: 'sess' | 'sub' | 'msg' | 'art' | 'ch'): string {
  return `${prefix}_${randomUUID()}`;
}
