/** Preserve primary failure identity; cleanup reporting must never print driver details. */
export async function withCleanup<T>(work: () => Promise<T>, cleanup: () => Promise<void>, reportCleanupFailure: () => void): Promise<T> {
  let failed = false;
  try { return await work(); }
  catch (error) { failed = true; throw error; }
  finally {
    try { await cleanup(); }
    catch (error) {
      reportCleanupFailure();
      if (!failed) throw error;
    }
  }
}
