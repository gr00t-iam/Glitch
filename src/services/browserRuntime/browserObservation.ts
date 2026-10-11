export const browserObservationRequestEvent = "glitch:browser-observation-request";
export const browserObservationResultEvent = "glitch:browser-observation-result";

export interface BrowserObservationRequest {
  requestId: string;
  url: string;
}

export interface BrowserObservationResult {
  requestId: string;
  url: string;
  text?: string;
  error?: string;
}

/** Targets a requested location when a saved wttr.in shortcut is used. */
export function resolveBrowserObservationUrl(prompt: string, configuredUrl: string): string {
  let url: URL;
  try {
    url = new URL(configuredUrl);
  } catch {
    return configuredUrl;
  }
  if (url.hostname.replace(/^www\./, "") !== "wttr.in" || !/\b(weather|forecast)\b/i.test(prompt)) return configuredUrl;
  const match = prompt.match(/\b(?:weather|forecast)\s+(?:in|for|at)\s+(.+?)(?:\?|$)/i);
  const location = match?.[1]?.replace(/\b(?:today|tonight|now|please)\b/gi, "").trim().replace(/[.,]+$/, "");
  if (!location) return configuredUrl;
  url.pathname = `/${encodeURIComponent(location)}`;
  return url.toString();
}

/** Requests page text from the connected CDP canvas without exposing it in the UI. */
export function requestBrowserObservation(url: string, timeoutMs = 20_000): Promise<BrowserObservationResult> {
  const nonce = typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const requestId = `browser-observation-${nonce}`;
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      window.removeEventListener(browserObservationResultEvent, onResult);
      reject(new Error("The live browser did not return page text in time."));
    }, timeoutMs);

    const onResult = (event: Event) => {
      const result = (event as CustomEvent<BrowserObservationResult>).detail;
      if (!result || result.requestId !== requestId) return;
      window.clearTimeout(timeout);
      window.removeEventListener(browserObservationResultEvent, onResult);
      resolve(result);
    };

    window.addEventListener(browserObservationResultEvent, onResult);
    window.dispatchEvent(
      new CustomEvent<BrowserObservationRequest>(browserObservationRequestEvent, {
        detail: { requestId, url },
      }),
    );
  });
}

export function publishBrowserObservation(result: BrowserObservationResult): void {
  window.dispatchEvent(new CustomEvent<BrowserObservationResult>(browserObservationResultEvent, { detail: result }));
}
