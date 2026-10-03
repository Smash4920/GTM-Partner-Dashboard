import type { PaginationState } from '../data/paginationState';
import type { ActionItem } from '../data/types';
import PageFooter from './PageFooter';

export default function ActionPagination({ state }: { state: PaginationState<ActionItem> }) {
  return <PageFooter state={state} noun="action items" pageSize={25} />;
}
