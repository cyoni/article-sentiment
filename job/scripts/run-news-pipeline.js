import { main as runSearch } from "./news-search.js";
import { main as runVerify } from "./news-verify.js";
import { main as runSentiment } from "./news-sentiment.js";
import { main as runAlerts } from "./news-alerts.js";

async function runStep(name, job) {
  const startedAt = Date.now();
  console.log(`[pipeline] ${new Date().toISOString()} START ${name}`);
  try {
    await job();
    console.log(
      `[pipeline] ${new Date().toISOString()} DONE ${name} (${Date.now() - startedAt} ms)`,
    );
  } catch (error) {
    console.error(
      `[pipeline] ${new Date().toISOString()} FAILED ${name} (${Date.now() - startedAt} ms): ${error.message}`,
    );
    throw error;
  }
}

export async function main() {
  const startedAt = Date.now();
  console.log(
    `[pipeline] ${new Date().toISOString()} START full news pipeline`,
  );
  await runStep("news search", runSearch);
  await runStep("news verification", runVerify);
  await runStep("sentiment classification", runSentiment);
  await runStep("daily alerts", runAlerts);
  console.log(
    `[pipeline] ${new Date().toISOString()} DONE full news pipeline (${Date.now() - startedAt} ms)`,
  );
}

main().catch((error) => {
  console.error(`News pipeline stopped: ${error.message}`);
  process.exitCode = 1;
});
