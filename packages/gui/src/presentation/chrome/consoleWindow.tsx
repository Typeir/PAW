/**
 * Console Window
 *
 * @fileoverview The console's frame, and the only layout element in it: one grid
 * whose banner spans both columns, whose first column is the rail, and whose
 * second is the main pane. The rail therefore reaches the bottom of whatever it
 * is in — a viewport in the browser, a window in the desktop shell — because its
 * row is the grid's free space rather than a hardcoded height. Everything inside
 * is a landmark (`header`, `nav`, `main`), so a screen reader can jump between
 * them and there is no tower of `div`s to read through. In the desktop shell it
 * takes the window's chrome; in a browser it is simply the page.
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
