import { useEffect, useCallback } from "react";
import type { UIMessage, SandboxMessage } from "../../shared/messages";

export function postToFigma(msg: UIMessage) {
  parent.postMessage({ pluginMessage: msg }, "*");
}

export function useFigmaMessages(
  onMessage: (msg: SandboxMessage) => void,
) {
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      const msg = event.data.pluginMessage as SandboxMessage | undefined;
      if (msg) onMessage(msg);
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [onMessage]);
}
