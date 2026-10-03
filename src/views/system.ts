// Lazy barrel for the system route family, the heaviest views in the app.
// App.tsx points two React.lazy calls at this one module, so Rollup emits a
// single deferred chunk holding both views and their exclusive components
// (wire diagram, team access, notification composer, SLA panel). Anything
// the eager shell also needs stays in the entry chunk instead of being
// duplicated or dragged into this file.
export { default as DataConnectionsView } from './DataConnectionsView';
export { default as ProductionRequirementsView } from './ProductionRequirementsView';
