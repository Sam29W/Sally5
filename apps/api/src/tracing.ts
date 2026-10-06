import { NodeSDK, tracing } from "@opentelemetry/sdk-node";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";

/**
 * Must be imported — and `start()` called — before any other module (`main.ts`'s first
 * line), or auto-instrumentation can't patch `http`/`express`/`pg`/etc. before they're
 * first required. Exports to the console: no real OTLP collector exists in this
 * environment, so this is proof the instrumentation itself works correctly (real spans,
 * real timings, real parent/child relationships), wired to whatever real backend (Tempo,
 * Honeycomb, X-Ray, ...) a real deployment picks later — swapping `ConsoleSpanExporter`
 * for an OTLP exporter is the only change that deployment needs to make here.
 */
const sdk = new NodeSDK({
  resource: resourceFromAttributes({ [ATTR_SERVICE_NAME]: "checkoutkit-api" }),
  traceExporter: new tracing.ConsoleSpanExporter(),
  instrumentations: [
    getNodeAutoInstrumentations({
      // Noisy and not interesting for this service — nothing here reads local files on
      // any hot path worth tracing.
      "@opentelemetry/instrumentation-fs": { enabled: false },
    }),
  ],
});

sdk.start();

process.on("SIGTERM", () => {
  void sdk.shutdown();
});
