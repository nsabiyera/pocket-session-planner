/**
 * A total, throw-free result type.
 *
 * The domain layer never throws: `applySessionCommand` returning `Err` for an illegal
 * transition is a normal outcome the UI renders, not an exception the UI has to catch.
 * Reserving `throw` for genuine programmer error keeps the two categories distinct.
 */
export type Ok<T> = { readonly ok: true; readonly value: T };
export type Err<E> = { readonly ok: false; readonly error: E };
export type Result<T, E> = Ok<T> | Err<E>;

export function ok<T>(value: T): Ok<T> {
  return { ok: true, value };
}

export function err<E>(error: E): Err<E> {
  return { ok: false, error };
}

export function isOk<T, E>(result: Result<T, E>): result is Ok<T> {
  return result.ok;
}

export function isErr<T, E>(result: Result<T, E>): result is Err<E> {
  return !result.ok;
}

/** Maps the success value, passing any error through untouched. */
export function mapResult<T, U, E>(result: Result<T, E>, fn: (value: T) => U): Result<U, E> {
  return result.ok ? ok(fn(result.value)) : result;
}

/** Chains a fallible step. The error channel is shared, so failures short-circuit. */
export function flatMapResult<T, U, E>(
  result: Result<T, E>,
  fn: (value: T) => Result<U, E>,
): Result<U, E> {
  return result.ok ? fn(result.value) : result;
}

/** Unwraps a success or substitutes a fallback. Never throws. */
export function unwrapOr<T, E>(result: Result<T, E>, fallback: T): T {
  return result.ok ? result.value : fallback;
}

/**
 * Unwraps a success or throws. For tests and for call sites that have already
 * proved the result is Ok — never for handling a user-reachable failure.
 */
export function unwrap<T, E>(result: Result<T, E>): T {
  if (!result.ok) {
    throw new Error(`Called unwrap on an Err: ${JSON.stringify(result.error)}`);
  }
  return result.value;
}

/** Collects an array of results into a result of an array, failing on the first error. */
export function allResults<T, E>(results: readonly Result<T, E>[]): Result<T[], E> {
  const values: T[] = [];
  for (const result of results) {
    if (!result.ok) return result;
    values.push(result.value);
  }
  return ok(values);
}
