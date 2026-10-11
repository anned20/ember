/**
 * The label layout primitives of the Settings control kit.
 *
 * `labeledControl` puts a label and a control on one row; `labeledBlock` stacks
 * them under a heading. Panes compose the other controls with these.
 */

/** A label plus a control, laid out as a Settings row. */
export function labeledControl(label: string, control: Element): HTMLDivElement {
  const wrap = document.createElement('div');
  wrap.className = 'settings-row';
  const span = document.createElement('span');
  span.textContent = label;
  wrap.appendChild(span);
  wrap.appendChild(control);
  return wrap;
}

/** A heading plus a control, laid out as a Settings block. */
export function labeledBlock(label: string, control: Element): HTMLDivElement {
  const wrap = document.createElement('div');
  wrap.className = 'settings-block';
  const heading = document.createElement('span');
  heading.className = 'settings-block-label';
  heading.textContent = label;
  wrap.appendChild(heading);
  wrap.appendChild(control);
  return wrap;
}
