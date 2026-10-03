import { useEffect, useRef, type RefObject } from 'react';
import { routeLabel, type Route } from '../data/routes';

export function useRouteContext(route: Route, main: RefObject<HTMLElement | null>) {
  const previous = useRef(route);
  useEffect(() => {
    document.title = `${routeLabel(route)} | GTM Partner Dashboard`;
    // Leave the fresh visit at the document start so first Tab reaches Skip.
    if (previous.current === route) return;
    previous.current = route;
    const content = main.current!;
    const focusHeading = () => {
      const heading = Array.from(content.querySelectorAll('h1')).find(
        (element) => !element.closest('[hidden], [style*="display: none"]'),
      );
      if (!heading) return false;
      heading.tabIndex = -1;
      heading.focus();
      return true;
    };
    if (focusHeading()) return;
    content.focus();
    // A lazy chunk or initial directory can delay the route heading. Stop as
    // soon as it arrives: later data refreshes must never move route focus.
    const observer = new MutationObserver(() => {
      if (focusHeading()) observer.disconnect();
    });
    observer.observe(content, { childList: true, subtree: true, attributes: true });
    return () => observer.disconnect();
  }, [route, main]);
}
