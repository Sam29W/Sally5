import type { Provider } from "@nestjs/common";
import { loadConfig } from "@app/config";

export const CONFIG = "CONFIG";

export const configProvider: Provider = {
  provide: CONFIG,
  useFactory: () => loadConfig(),
};
