import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { makeOpportunity } from '../test/fixtures';
import ForecastTable from './ForecastTable';

it.each(['commit', 'long-shot'] as const)(
  'exposes %s off-stage explanations and edited provenance without hover',
  (forecastCategory) => {
    const opportunity = makeOpportunity({
      stage: 'scope',
      forecastCategory,
      notes: 'Provider note',
    });
    render(
      <ForecastTable
        opportunities={[opportunity]}
        partnerNames={{}}
        revenueOverrides={{ [opportunity.id]: 20 }}
        notes={{}}
        nextSteps={{}}
        onSetRevenue={vi.fn()}
        onSetNote={vi.fn()}
        onSetNextStep={vi.fn()}
        onSetForecastCall={vi.fn()}
      />,
    );
    const explanation = screen.getByLabelText(
      `Off stage explanation for ${opportunity.accountName}`,
    );
    const content = explanation.nextElementSibling;
    expect(content).not.toBeVisible();
    fireEvent.click(explanation);
    expect(content).toBeVisible();
    expect(content).toHaveTextContent('which implies Pipeline');
    fireEvent.click(explanation);
    expect(content).not.toBeVisible();
    expect(screen.getByText('Edited — differs from Salesforce forecast')).toBeVisible();
    const note = screen.getByRole('button', { name: `View note for ${opportunity.accountName}` });
    fireEvent.click(note);
    expect(note).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Provider note')).toBeVisible();
    fireEvent.click(note);
    expect(screen.queryByText('Provider note')).not.toBeInTheDocument();
  },
);
