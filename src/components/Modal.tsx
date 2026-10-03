import { useId, useLayoutEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

interface ModalProps {
  title: string;
  children?: ReactNode;
  onDismiss: (draftControl?: HTMLElement) => void;
  wide?: boolean;
  /** The previously focused draft control when returning from confirmation. */
  returnFocus?: HTMLElement | null;
}

export default function Modal({ title, children, onDismiss, wide, returnFocus }: ModalProps) {
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const lastFocused = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    const opener = document.activeElement;
    const modal = dialog.current!;
    modal.showModal();
    // Query refresh can remove a focused field. Recover within this modal,
    // never leave the keyboard on the inert document body.
    const observer = new MutationObserver(() => {
      if (modal.open && !modal.contains(document.activeElement)) heading.current?.focus();
    });
    observer.observe(modal, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      modal.close();
      const target =
        opener instanceof HTMLElement && opener.isConnected
          ? opener
          : [...document.querySelectorAll<HTMLElement>('main h1')].find(
              (candidate) => !candidate.closest('[hidden], [inert]'),
            );
      if (target) {
        if (target.tagName === 'H1') target.tabIndex = -1;
        target.focus();
      }
    };
  }, []);
  useLayoutEffect(() => {
    (returnFocus?.isConnected ? returnFocus : heading.current)?.focus();
  }, [title, returnFocus]);
  return createPortal(
    <dialog
      ref={dialog}
      aria-modal="true"
      aria-labelledby={id}
      onFocus={(event) => {
        if (event.target !== event.currentTarget) lastFocused.current = event.target;
      }}
      onClick={(event) => {
        if (event.target !== event.currentTarget) return;
        const rect = event.currentTarget.getBoundingClientRect();
        if (
          event.clientX < rect.left ||
          event.clientX > rect.right ||
          event.clientY < rect.top ||
          event.clientY > rect.bottom
        )
          onDismiss(lastFocused.current ?? undefined);
      }}
      onCancel={(event) => {
        event.preventDefault();
        onDismiss();
      }}
      onKeyDown={(event) => {
        if (event.defaultPrevented) return;
        if (event.key === 'Escape') {
          event.preventDefault();
          onDismiss();
        }
        if (event.key !== 'Tab') return;
        const controls = [
          ...event.currentTarget.querySelectorAll<HTMLElement>(
            'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]',
          ),
        ].filter((control) => !control.closest('[hidden], [inert]'));
        const first = controls[0];
        const last = controls.at(-1);
        const active = document.activeElement;
        if (
          event.shiftKey
            ? active === first || !controls.includes(active as HTMLElement)
            : active === last || !controls.includes(active as HTMLElement)
        ) {
          event.preventDefault();
          (event.shiftKey ? last : first)?.focus();
        }
      }}
      className={`m-auto max-h-[90dvh] w-[calc(100%-2rem)] ${wide ? 'max-w-6xl' : 'max-w-lg'} overflow-y-auto overscroll-contain rounded-card border border-ash bg-canvas p-5 text-bone backdrop:bg-canvas/80`}
    >
      <h2 id={id} ref={heading} tabIndex={-1} className="text-lg">
        {title}
      </h2>
      {children}
    </dialog>,
    document.body,
  );
}
