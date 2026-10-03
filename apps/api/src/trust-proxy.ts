export interface SettableApp {
  set(name: string, value: unknown): unknown;
}

/** Single source of truth for trust-proxy wiring — used by both main.ts and tests (against
 * a bare Express app) so production behavior and test behavior can never drift apart. */
export function applyTrustProxy(app: SettableApp, hops: number): void {
  app.set("trust proxy", hops > 0 ? hops : false);
}
