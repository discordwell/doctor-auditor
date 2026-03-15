const rendererUrl =
  process.env.DOCTOR_AUDITOR_RENDERER_URL ?? "http://localhost:5173";
const timeoutMs = Number(
  process.env.DOCTOR_AUDITOR_RENDERER_WAIT_MS ?? 20000
);
const pollIntervalMs = 250;
const deadline = Date.now() + timeoutMs;

console.log(`Waiting for renderer at ${rendererUrl}...`);

while (Date.now() < deadline) {
  try {
    const response = await fetch(rendererUrl, {
      method: "HEAD",
    });

    if (response.ok) {
      console.log("Renderer ready.");
      process.exit(0);
    }
  } catch {
    // Keep polling until timeout.
  }

  await sleep(pollIntervalMs);
}

console.error(
  `Renderer did not become available within ${timeoutMs}ms at ${rendererUrl}.`
);
process.exit(1);

function sleep(durationMs) {
  return new Promise((resolve) => {
    setTimeout(resolve, durationMs);
  });
}
