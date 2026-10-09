// A note passed from the "Add a label" screen back to the Food labels list.
//
// Going back to a screen cannot carry anything with it, so the label that was
// just saved (or the one that already had that name) is left here, and the
// list picks it up as it comes back into view and sets that label's number to
// one. It is read once and then forgotten.

let added: { outletId: string; itemId: string } | null = null;

/** Leaves the saved label for the list to pick up. */
export function leaveAddedLabel(outletId: string, itemId: string) {
  added = { outletId, itemId };
}

/** The label just added at this outlet, if there is one waiting; it is handed over once only. */
export function takeAddedLabel(outletId: string): string | null {
  if (!added || added.outletId !== outletId) return null;
  const { itemId } = added;
  added = null;
  return itemId;
}
