/**
 * A reason the server cannot start that is already written in plain words for
 * the person at the terminal (for example "could not reach the database").
 * `main.ts` prints its message and stops, without the page of program detail
 * that an unexpected error gets and that would bury the sentence.
 */
export class StartupProblem extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StartupProblem';
  }
}
