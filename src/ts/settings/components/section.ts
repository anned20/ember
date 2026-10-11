/** A `settings-section` with an `<h3>` heading. */
export function createSection(title: string, extraClass?: string): HTMLElement {
  const section = document.createElement('section');
  section.className = 'settings-section' + (extraClass ? ' ' + extraClass : '');
  const heading = document.createElement('h3');
  heading.textContent = title;
  section.appendChild(heading);
  return section;
}
