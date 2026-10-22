'use strict';

/**
 * Titlebar Menu open detection shared by packaged/source smoke.
 * React 18 serializes aria-expanded={true} as "" ; React 19 uses "true".
 * Portaled Git lists also expose role="menu" while they are open.
 */
function isAriaExpanded(value) {
  if (value == null) {
    return false;
  }
  const text = String(value);
  if (text === 'false') {
    return false;
  }
  return text === 'true' || text === '';
}

function titlebarMenuLooksOpen(snapshot) {
  if (!snapshot) {
    return false;
  }
  if (isAriaExpanded(snapshot.expanded)) {
    return true;
  }
  if (Number(snapshot.menuCount) > 0) {
    return true;
  }
  return snapshot.hasOpenPopover === true;
}

module.exports = {
  isAriaExpanded,
  titlebarMenuLooksOpen,
};
