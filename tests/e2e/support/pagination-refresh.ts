import type { Locator } from '@playwright/test';

/**
 * Arm before the public editor/keyboard action. The observer reads the entire
 * transient busy contract and probes duplicate activation in one browser task;
 * subsequent Playwright round trips cannot race a 250 ms remote response.
 */
export async function observeRefreshBusy(root: Locator, noun: string, placeFocus = true) {
  return root.evaluateHandle(
    (element, { noun, placeFocus }) => {
      const footer = [...element.querySelectorAll('[role="group"]')].find(
        (group) => group.getAttribute('aria-label') === `${noun} pagination`,
      )!;
      const button = footer.querySelector('button')!;
      const rows = [...element.querySelectorAll('tr[data-opportunity-id]')];
      const result = new Promise<{
        status: string;
        busy: string | null;
        keys: (string | null)[];
        sameRows: boolean;
        sameButton: boolean;
        focused: boolean;
        duplicateActivations: number;
      }>((resolve, reject) => {
        const observer = new MutationObserver(() => {
          const status = footer.querySelector('[role="status"]')!.textContent!;
          if (!status.includes(`Updating ${noun}`)) return;
          observer.disconnect();
          clearTimeout(timeout);
          // Save removes its editor, so explicitly place focus on the retained
          // footer. Retry already owns focus: observe it without repairing loss.
          if (placeFocus) button.focus();
          const currentRows = [...element.querySelectorAll('tr[data-opportunity-id]')];
          const snapshot = {
            status,
            busy: button.getAttribute('aria-disabled'),
            keys: currentRows.map((row) => row.getAttribute('data-opportunity-id')),
            sameRows:
              rows.length === currentRows.length &&
              rows.every((row, index) => row === currentRows[index]),
            sameButton: button === footer.querySelector('button'),
            focused: document.activeElement === button,
            duplicateActivations: 2,
          };
          button.click();
          button.click();
          resolve(snapshot);
        });
        const timeout = setTimeout(() => {
          observer.disconnect();
          reject(new Error(`No busy refresh observed for ${noun}`));
        }, 5000);
        observer.observe(element, { childList: true, subtree: true, attributes: true });
      });
      // A wrapper prevents evaluateHandle from awaiting the nested promise, so
      // registration completes before we dispatch the trusted triggering action.
      return { result };
    },
    { noun, placeFocus },
  );
}
