import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import ProgressBar from './ProgressBar';

describe('ProgressBar alternatives (CH-010/011/014/015/018/019)', () => {
  it.each([
    [4, 10, 40, 'Below goal'],
    [10, 10, 100, 'Goal reached'],
    [14, 10, 140, 'Goal exceeded'],
  ])('names a %i/%i progress chart with %i%% attainment and %s', (value, goal, pct, state) => {
    render(<ProgressBar label="Partner meetings" value={value} goal={goal} />);
    const figure = screen.getByRole('figure', { name: 'Partner meetings' });
    expect(figure.querySelector('figcaption')).toHaveTextContent(`${pct}% of goal`);
    expect(figure).toHaveTextContent(state);
    const bar = within(figure).getByRole('progressbar', { name: 'Partner meetings' });
    expect(bar).toHaveAttribute('aria-valuenow', `${Math.min(value, goal)}`);
    expect(bar).toHaveAttribute('aria-valuemax', `${goal}`);
    expect(bar).toHaveAttribute('aria-valuetext', expect.stringContaining(`${value} of ${goal}`));
  });

  it.each(['PIO interlocks', 'Partner strategists', 'Partner engineers'])(
    'retains the %s label, value, goal and qualifier',
    (label) => {
      render(<ProgressBar label={label} value={2} goal={3} hint="certified" />);
      const figure = screen.getByRole('figure', { name: label });
      expect(figure).toHaveTextContent('2/3');
      expect(figure).toHaveTextContent('certified');
      expect(figure).toHaveTextContent('67% of goal');
    },
  );

  it.each([0, 3])('does not call %i/0 reached or expose an invalid progress range', (value) => {
    render(<ProgressBar label="Partner engineers" value={value} goal={0} hint="certified" />);
    const figure = screen.getByRole('figure', { name: 'Partner engineers' });
    expect(figure).toHaveTextContent(`${value}/0`);
    expect(figure).toHaveTextContent('No goal set');
    expect(figure).not.toHaveTextContent(/Goal reached|Goal exceeded|NaN|Infinity/);
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });

  it('keeps missing certification distinct from a measured zero', () => {
    render(
      <ProgressBar label="Partner strategists" value={0} goal={1} hint="No certification data" />,
    );
    const figure = screen.getByRole('figure', { name: 'Partner strategists' });
    expect(figure).toHaveTextContent('No certification data');
    expect(figure).not.toHaveTextContent(/0\/1|0%|Below goal/);
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });
});
