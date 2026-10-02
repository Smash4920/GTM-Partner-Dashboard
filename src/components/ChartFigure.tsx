import type { ReactNode } from 'react';

/** A chart's values remain available to keyboard, touch and assistive technology. */
export default function ChartFigure({
  name,
  summary,
  children,
  headers,
  rows = [],
}: {
  name: string;
  summary: string;
  children: ReactNode;
  headers?: string[];
  rows?: (string | number)[][];
}) {
  return (
    <figure aria-label={name}>
      {children}
      <figcaption className="mt-2 text-xs text-granite">{summary}</figcaption>
      {headers && (
        <details className="mt-4 text-xs text-stone">
          <summary className="cursor-pointer" aria-label={`View chart data: ${name}`}>
            View chart data
          </summary>
          {rows.length === 0 ? (
            <p className="mt-2">No data</p>
          ) : (
            <div
              className="mt-2 max-w-full overflow-x-auto"
              tabIndex={0}
              role="region"
              aria-label={`${name} data`}
            >
              <table className="w-full text-left tabular-nums" aria-label={`${name} data`}>
                <thead>
                  <tr>
                    {headers.map((header) => (
                      <th key={header} scope="col" className="p-2 align-top">
                        {header}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, index) => (
                    <tr key={index} className="border-t border-carbon">
                      <th scope="row" className="p-2 align-top">
                        {row[0]}
                      </th>
                      {row.slice(1).map((value, column) => (
                        <td key={column} className="p-2 align-top">
                          {value}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </details>
      )}
    </figure>
  );
}
