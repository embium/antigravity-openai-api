import { performOAuthLogin } from "./auth.js";

async function main() {
  console.log("Starting Google Antigravity OAuth login...");
  try {
    const creds = await performOAuthLogin();
    console.log("\nAuthentication successful!");
    if (creds.email) console.log(`Logged in as: ${creds.email}`);
    if (creds.projectId) console.log(`Project ID: ${creds.projectId}`);
    console.log("Credentials saved. You can now start the endpoint server.");
    process.exit(0);
  } catch (err: any) {
    console.error("\nLogin failed:", err.message);
    process.exit(1);
  }
}

main();
