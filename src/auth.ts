import { createHash, randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

export interface AntigravityCredentials {
  refresh: string;
  access?: string;
  expires?: number;
  projectId?: string;
  email?: string;
  type?: string;
}

export const REDIRECT_URI = "http://localhost:51121/oauth-callback";
export const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const TOKEN_URL = "https://oauth2.googleapis.com/token";
export const SCOPES = [
  "https://www.googleapis.com/auth/aicode",
  "https://www.googleapis.com/auth/cloud-platform",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
  "https://www.googleapis.com/auth/cclog",
  "https://www.googleapis.com/auth/experimentsandconfigs",
];

export const CLIENT_ID =
  process.env.ANTIGRAVITY_CLIENT_ID ||
  Buffer.from(
    "MTA3MTAwNjA2MDU5MS10bWhzc2luMmgyMWxjcmUyMzV2dG9sb2poNGc0MDNlc" +
      "C5hcHBzLmdvb2dsZXVzZXJjb250ZW50LmNvbQ==",
    "base64",
  ).toString("utf-8");

export const CLIENT_SECRET =
  process.env.ANTIGRAVITY_CLIENT_SECRET ||
  Buffer.from("R09DU1BYLUs1OEZXUjQ" + "4NkxkTEoxbUxCOHNYQzR6NnFEQWY=", "base64").toString("utf-8");

export const DEFAULT_PROJECT_ID = "aicode-consumers";

function base64Url(buffer: Buffer): string {
  return buffer.toString("base64url");
}

function generatePKCE(): { verifier: string; challenge: string } {
  const verifier = base64Url(randomBytes(32));
  const challenge = base64Url(createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

function getHomeDir(): string {
  return process.env.HOME || process.env.USERPROFILE || os.homedir();
}

/** Possible file locations for storing / loading credentials */
function getCredentialLocations(): string[] {
  const home = getHomeDir();
  return [
    path.resolve(process.cwd(), "credentials.json"),
    path.resolve(process.cwd(), "endpoint", "credentials.json"),
    path.resolve(home, ".antigravity", "credentials.json"),
    path.resolve(home, ".pi", "agent", "auth.json"),
  ];
}

interface LoadedCredentials {
  creds: AntigravityCredentials;
  sourcePath?: string;
  isPiAuthJson?: boolean;
}

/** Load credentials from env or files */
export function loadCredentials(): LoadedCredentials | null {
  // Check env vars
  if (process.env.ANTIGRAVITY_REFRESH_TOKEN) {
    return {
      creds: {
        refresh: process.env.ANTIGRAVITY_REFRESH_TOKEN,
        access: process.env.ANTIGRAVITY_ACCESS_TOKEN,
        projectId: process.env.ANTIGRAVITY_PROJECT_ID || DEFAULT_PROJECT_ID,
        expires: process.env.ANTIGRAVITY_EXPIRES
          ? Number(process.env.ANTIGRAVITY_EXPIRES)
          : undefined,
      },
    };
  }

  if (process.env.ANTIGRAVITY_CREDENTIALS) {
    try {
      const parsed = JSON.parse(process.env.ANTIGRAVITY_CREDENTIALS) as AntigravityCredentials;
      if (parsed.refresh) return { creds: parsed };
    } catch {
      // ignore parse failure
    }
  }

  // Check file locations
  for (const filePath of getCredentialLocations()) {
    try {
      if (!fs.existsSync(filePath)) continue;
      const content = fs.readFileSync(filePath, "utf-8");
      const parsed = JSON.parse(content);

      // Check if it's Pi's auth.json
      if (filePath.endsWith("auth.json") && parsed.antigravity?.refresh) {
        return {
          creds: parsed.antigravity as AntigravityCredentials,
          sourcePath: filePath,
          isPiAuthJson: true,
        };
      }

      // Check direct credentials.json format
      if (parsed.refresh) {
        return {
          creds: parsed as AntigravityCredentials,
          sourcePath: filePath,
          isPiAuthJson: false,
        };
      }
    } catch {
      // Continue to next candidate
    }
  }

  return null;
}

/** Save updated credentials back to disk */
export function saveCredentials(
  updated: AntigravityCredentials,
  loaded?: LoadedCredentials | null,
): void {
  try {
    if (loaded?.sourcePath && loaded.isPiAuthJson) {
      // Update Pi's auth.json
      const content = fs.readFileSync(loaded.sourcePath, "utf-8");
      const parsed = JSON.parse(content);
      parsed.antigravity = {
        ...parsed.antigravity,
        ...updated,
      };
      fs.writeFileSync(loaded.sourcePath, JSON.stringify(parsed, null, 2), "utf-8");
      return;
    }

    if (loaded?.sourcePath) {
      fs.writeFileSync(loaded.sourcePath, JSON.stringify(updated, null, 2), "utf-8");
      return;
    }

    // Default save target: ./credentials.json
    const defaultTarget = path.resolve(process.cwd(), "credentials.json");
    fs.writeFileSync(defaultTarget, JSON.stringify(updated, null, 2), "utf-8");
  } catch (err) {
    console.error("Warning: Failed to save updated credentials to disk:", err);
  }
}

/** Refresh access token using Google's OAuth token endpoint */
export async function refreshAccessToken(
  creds: AntigravityCredentials,
): Promise<AntigravityCredentials> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      refresh_token: creds.refresh,
      grant_type: "refresh_token",
    }).toString(),
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Google OAuth token refresh failed (${res.status}): ${errorText}`);
  }

  const data = (await res.json()) as {
    access_token: string;
    expires_in: number;
    refresh_token?: string;
  };

  const updated: AntigravityCredentials = {
    ...creds,
    access: data.access_token,
    refresh: data.refresh_token || creds.refresh,
    expires: Date.now() + data.expires_in * 1000 - 5 * 60 * 1000,
    projectId: creds.projectId || DEFAULT_PROJECT_ID,
  };

  return updated;
}

let inFlightRefresh: Promise<AntigravityCredentials> | null = null;

/** Get a valid, non-expired access token and project ID */
export async function getValidAuth(): Promise<{ accessToken: string; projectId: string }> {
  const loaded = loadCredentials();
  if (!loaded?.creds?.refresh) {
    throw new Error(
      "No Google Antigravity credentials found. Please run 'bun run login' or set ANTIGRAVITY_REFRESH_TOKEN.",
    );
  }

  let creds = loaded.creds;

  // Check if access token is present and valid for at least 2 minutes
  const isExpiring = !creds.access || !creds.expires || creds.expires <= Date.now() + 2 * 60 * 1000;

  if (isExpiring) {
    if (!inFlightRefresh) {
      inFlightRefresh = refreshAccessToken(creds)
        .then((updated) => {
          saveCredentials(updated, loaded);
          return updated;
        })
        .finally(() => {
          inFlightRefresh = null;
        });
    }
    creds = await inFlightRefresh;
  }

  return {
    accessToken: creds.access!,
    projectId: creds.projectId || DEFAULT_PROJECT_ID,
  };
}

/** Interactive OAuth login flow via browser and local callback server */
export async function performOAuthLogin(): Promise<AntigravityCredentials> {
  const { verifier, challenge } = generatePKCE();
  const state = base64Url(randomBytes(32));

  return new Promise((resolve, reject) => {
    let settled = false;
    let server: Server;

    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        server?.close();
        reject(new Error("Login timed out after 5 minutes"));
      }
    }, 5 * 60 * 1000);

    server = createServer(async (req, res) => {
      const url = new URL(req.url || "", REDIRECT_URI);
      if (url.pathname !== "/oauth-callback") {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("Not Found");
        return;
      }

      const code = url.searchParams.get("code");
      const returnedState = url.searchParams.get("state");
      const error = url.searchParams.get("error");

      if (error) {
        res.writeHead(400, { "Content-Type": "text/html" });
        res.end(`<h2>Authentication failed: ${error}</h2>`);
        settled = true;
        clearTimeout(timeout);
        server.close();
        reject(new Error(`OAuth error: ${error}`));
        return;
      }

      if (returnedState !== state || !code) {
        res.writeHead(400, { "Content-Type": "text/html" });
        res.end("<h2>Invalid OAuth state or missing code</h2>");
        return;
      }

      try {
        const tokenRes = await fetch(TOKEN_URL, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            client_id: CLIENT_ID,
            client_secret: CLIENT_SECRET,
            code,
            grant_type: "authorization_code",
            redirect_uri: REDIRECT_URI,
            code_verifier: verifier,
          }).toString(),
        });

        if (!tokenRes.ok) {
          throw new Error(`Token exchange failed: ${await tokenRes.text()}`);
        }

        const tokenData = (await tokenRes.json()) as {
          access_token: string;
          refresh_token?: string;
          expires_in: number;
        };

        if (!tokenData.refresh_token) {
          throw new Error("No refresh token received. Please grant offline access.");
        }

        // Get user info
        let email: string | undefined;
        try {
          const userRes = await fetch("https://www.googleapis.com/oauth2/v1/userinfo?alt=json", {
            headers: { Authorization: `Bearer ${tokenData.access_token}` },
          });
          if (userRes.ok) {
            const userData = (await userRes.json()) as { email?: string };
            email = userData.email;
          }
        } catch {}

        const creds: AntigravityCredentials = {
          refresh: tokenData.refresh_token,
          access: tokenData.access_token,
          expires: Date.now() + tokenData.expires_in * 1000 - 5 * 60 * 1000,
          projectId: DEFAULT_PROJECT_ID,
          email,
        };

        // Save credentials
        saveCredentials(creds, loadCredentials());

        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(
          "<h2>Login successful!</h2><p>You can close this window and return to your terminal / chat client.</p>",
        );

        settled = true;
        clearTimeout(timeout);
        setTimeout(() => server.close(), 1000);
        resolve(creds);
      } catch (err: any) {
        res.writeHead(500, { "Content-Type": "text/html" });
        res.end(`<h2>Login failed: ${err.message}</h2>`);
        settled = true;
        clearTimeout(timeout);
        server.close();
        reject(err);
      }
    });

    server.on("error", (err) => {
      settled = true;
      clearTimeout(timeout);
      reject(err);
    });

    server.listen(51121, "127.0.0.1", () => {
      const authParams = new URLSearchParams({
        client_id: CLIENT_ID,
        response_type: "code",
        redirect_uri: REDIRECT_URI,
        scope: SCOPES.join(" "),
        code_challenge: challenge,
        code_challenge_method: "S256",
        state,
        access_type: "offline",
        prompt: "consent",
      });

      const authUrl = `${AUTH_URL}?${authParams.toString()}`;
      console.log("\n========================================================");
      console.log("Please authenticate with Google Antigravity:");
      console.log(authUrl);
      console.log("========================================================\n");

      // Attempt to open browser
      try {
        const cmd =
          process.platform === "win32"
            ? `start "" "${authUrl}"`
            : process.platform === "darwin"
              ? `open "${authUrl}"`
              : `xdg-open "${authUrl}"`;
        import("node:child_process").then((cp) => cp.exec(cmd)).catch(() => {});
      } catch {}
    });
  });
}
