/**
 * Data Table Atom
 *
 * @fileoverview The console's one table: upper-case column heads over monospace
 * rows, with right-alignment declared per column so numbers line up on their
 * digits. Rows are the caller's children, because a herd row and a process row
 * carry different cells but the same frame.
 *
 * @module @paw/gui/presentation/atoms/dataTable
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import type { ReactNode } from 'react';

/**
 * One column head.
 *
 * @interface Column
 * @property {string} key - A stable key.
 * @property {string} label - The head label.
 * @property {boolean} [right] - Right-align the column.
 */
export interface Column {
  readonly key: string;
  readonly label: string;
  readonly right?: boolean;
}

/**
 * Props for {@link DataTable}.
 *
 * @interface DataTableProps
 * @property {readonly Column[]} columns - The column heads.
 * @property {ReactNode} children - The `tr` rows.
 */
export interface DataTableProps {
  readonly columns: readonly Column[];
  readonly children: ReactNode;
}

/**
 * A console table.
 *
 * @param {DataTableProps} props - The table props.
 * @returns {JSX.Element} The table.
 */
export function DataTable({ columns, children }: DataTableProps) {
  return (
    <table className='tbl'>
      <thead>
        <tr>
          {columns.map((col) => (
            <th key={col.key} className={col.right === true ? 'r' : undefined}>
              {col.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>{children}</tbody>
    </table>
  );
}
