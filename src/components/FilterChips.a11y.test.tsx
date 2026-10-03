import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import FilterChips from './FilterChips';

it('makes every slice explanation readable without hover', () => {
  const onChange = vi.fn();
  render(
    <FilterChips
      options={[{ id: 'q1', label: 'Q1', title: 'February through April' }]}
      value="q1"
      onChange={onChange}
      ariaLabel="Fiscal phase"
    />,
  );
  expect(screen.getByText('February through April')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Q1' }));
  expect(onChange).toHaveBeenCalledWith('q1');
});
