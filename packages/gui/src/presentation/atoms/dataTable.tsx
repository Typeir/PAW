/**
 * Data Table Atom
 *
 * @fileoverview Console one table. Upper-case column head over monospace row.
 * Right-align declared per column so number line up on digit. Row be caller
 * child, because herd row and process row carry different cell but same frame.
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
 * @property {string} key - Stable key.
 * @property {string} label - Head label.
 * @property {boolean} [right] - Right-align column.
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
 * @property {readonly Column[]} columns - Column heads.
 * @property {ReactNode} children - The `tr` rows.
 */
export interface DataTableProps {
  readonly columns: readonly Column[];
  readonly children: ReactNode;
}

/**
 * Console table.
 *
 * @param {DataTableProps} props - Table props.
 * @returns {JSX.Element} Table.
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
