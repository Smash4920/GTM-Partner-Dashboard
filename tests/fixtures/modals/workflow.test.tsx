import { useLayoutEffect, useState, type ComponentProps } from 'react';
import WorkflowPanel from '../../../src/components/WorkflowPanel';

// Only this independently built entry changes these props. All route hosts,
// invokers, modal rendering and interaction remain production components.
// A roster-key refresh intentionally drops the previous scoped answer, as
// the real hook does; this does not invent a retained-refresh UI branch.
export default function WorkflowFixture(props: ComponentProps<typeof WorkflowPanel>) {
  const [revision, setRevision] = useState(0);
  useLayoutEffect(() => {
    window.modalFixture.refreshRoster = () => setRevision((value) => value + 1);
  }, []);
  const roster = revision
    ? {
        ...props.roster,
        overrides: { ...props.roster.overrides, [`fixture-revision-${revision}`]: {} },
      }
    : props.roster;
  const invalid = new URLSearchParams(location.search).get('scenario') === 'invalid-target';
  return (
    <WorkflowPanel
      {...props}
      roster={roster}
      target={props.target && invalid ? { ...props.target, entityIds: [' '] } : props.target}
    />
  );
}
