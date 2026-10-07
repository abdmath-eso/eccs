/** What is wrong with each field of a form, by the field's `name`. Empty when the form can be sent. */
export type FieldErrors = Record<string, string>;

/** Reads a form into a plain object of its text fields. */
export const formValues = (form: HTMLFormElement): Record<string, string> =>
  Object.fromEntries([...new FormData(form).entries()].filter(([, value]) => typeof value === "string").map(([key, value]) => [key, String(value)]));

/** The shape of the shared rules in @eccs/shared that the API checks against too. */
interface Rules {
  safeParse(value: unknown):
    | { success: true }
    | { success: false; error: { issues: readonly { path: readonly PropertyKey[]; message: string }[] } };
}

/**
 * Checks a form against the same rules the server uses, so the two never
 * disagree, and returns the first message for each field that fails.
 */
export function checkAgainst(rules: Rules, values: unknown): FieldErrors {
  const result = rules.safeParse(values);
  const errors: FieldErrors = {};
  if (result.success) return errors;
  for (const issue of result.error.issues) {
    const field = String(issue.path[0] ?? "");
    if (field && !errors[field]) errors[field] = issue.message;
  }
  return errors;
}

/** Puts the cursor in the first field that has a mistake, so the person can start correcting straight away. */
export function focusFirstError(form: HTMLFormElement, errors: FieldErrors) {
  for (const element of Array.from(form.elements)) {
    const name = element.getAttribute("name");
    if (name && errors[name] && element instanceof HTMLElement) {
      element.focus();
      return;
    }
  }
}

export const hasErrors = (errors: FieldErrors) => Object.keys(errors).length > 0;
