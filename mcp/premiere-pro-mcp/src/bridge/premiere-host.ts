/**
 * The one way the server reaches Premiere.
 *
 * Every Premiere call goes through a PremiereHost. Tools, resources and the
 * expanded tools see it as PremiereProTransport (the calls they make); the
 * server also starts and stops it. Today there is one implementation — the CEP
 * panel running ExtendScript, driven through a file queue (PremiereProBridge).
 * A UXP host would be a second implementation chosen here, with nothing else in
 * the server changing.
 */

import { PremiereProBridge } from './index.js';
import type { PremiereProTransport } from './types.js';

export type PremiereHostKind = 'cep';

export interface PremiereHost extends PremiereProTransport {
  /** Which implementation this is. */
  readonly kind: PremiereHostKind;
  initialize(): Promise<void>;
  cleanup(): Promise<void>;
}

export const DEFAULT_PREMIERE_HOST: PremiereHostKind = 'cep';

/** PREMIERE_HOST selects the implementation; only "cep" exists today. */
export function createPremiereHost(env: NodeJS.ProcessEnv = process.env): PremiereHost {
  const requested = (env.PREMIERE_HOST ?? DEFAULT_PREMIERE_HOST).trim().toLowerCase();
  switch (requested) {
    case 'cep':
    case 'extendscript':
      return new PremiereProBridge();
    default:
      throw new Error(`PREMIERE_HOST="${env.PREMIERE_HOST}" is not available. Supported: cep (the CEP panel with ExtendScript).`);
  }
}
