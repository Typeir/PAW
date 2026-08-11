/**
 * Console Window
 *
 * @fileoverview Console frame. Single-layout element: one grid. Banner spans both columns; first column is the rail, second is the main pane. Rail reaches bottom of its container — viewport in browser, window in desktop shell — because its grid row uses free space, not a hardcoded height. Everything lives inside a landmark (`header`, `nav`, `main`), so a screen reader moves between them instead of through nested `div`s. Desktop shell displays window chrome; browser displays page only.
 *
 * @module @paw/gui/presentation/chrome/consoleWindow
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { useShell } from '../../application/context/consoleContext.js';
import { useSection, useTab } from '../../application/hooks/useConsole.js';
import { useConsoleActions } from '../../application/hooks/useConsoleActions.js';
import { useScrubKeys } from '../../application/hooks/useScrubKeys.js';
import { LiveBanner } from '../atoms/liveBanner.js';
import { SectionOutlet } from '../views/sectionOutlet.js';
import { Rail } from './rail.js';
import { TitleBar } from './titleBar.js';

/**
 * The console window.
 *
 * @returns {JSX.Element} The window.
 */
export function ConsoleWindow() {
  const section = useSection();
  const tab = useTab();
  const { step } = useConsoleActions();
  const { shell } = useShell();
  useScrubKeys(section === 'swarm' && tab === 'plan', step);
  return (
    <div data-shell={shell}>
      <TitleBar />
      <Rail />
      <main>
        <LiveBanner />
        <SectionOutlet />
      </main>
    </div>
  );
}
