// Explicit unavailable command until the real loop and evaluator are implemented.
if (!process.argv.includes("--allow-paid"))
  console.error(
    "Real evaluation requires explicit --allow-paid opt-in. No model call was made.",
  );
else
  console.error(
    "Real evaluation is not implemented. No credentials were read and no model call was made.",
  );
process.exitCode = 1;
