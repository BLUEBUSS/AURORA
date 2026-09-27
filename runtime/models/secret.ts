import { spawn } from "node:child_process";

function powershellSecret(value: string, decrypt: boolean): Promise<string> {
  // Use the Windows DPAPI assembly directly: inherited PowerShell 7 module paths
  // can prevent Windows PowerShell's SecureString cmdlets from auto-loading.
  const prefix = "[void][Reflection.Assembly]::LoadWithPartialName('System.Security');[Console]::InputEncoding=[Text.Encoding]::UTF8;$s=[Console]::In.ReadToEnd();";
  const command = prefix + (decrypt
    ? "$b=[Security.Cryptography.ProtectedData]::Unprotect([Convert]::FromBase64String($s),$null,[Security.Cryptography.DataProtectionScope]::CurrentUser);[Console]::Out.Write([Text.Encoding]::UTF8.GetString($b))"
    : "$b=[Security.Cryptography.ProtectedData]::Protect([Text.Encoding]::UTF8.GetBytes($s),$null,[Security.Cryptography.DataProtectionScope]::CurrentUser);[Console]::Out.Write([Convert]::ToBase64String($b))");
  return new Promise((resolve, reject) => {
    const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command], { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    let output = "";
    const timer = setTimeout(() => { child.kill(); reject(new Error("Local credential protection timed out.")); }, 15000);
    child.stdout.on("data", (chunk: Buffer) => { output += chunk.toString(); });
    child.stderr.resume();
    child.on("error", () => { clearTimeout(timer); reject(new Error("Local credential protection is unavailable.")); });
    child.on("close", (code) => { clearTimeout(timer); if (code === 0 && output) resolve(output); else reject(new Error("Cannot access this user's protected credential.")); });
    child.stdin.end(value);
  });
}
export interface StoredSecret { kind: "windows-dpapi" | "restricted-file"; value: string }
export async function sealSecret(value: string): Promise<StoredSecret> {
  return process.platform === "win32" ? { kind: "windows-dpapi", value: await powershellSecret(value, false) } : { kind: "restricted-file", value };
}
export async function unsealSecret(secret: StoredSecret) {
  if (secret.kind === "windows-dpapi") {
    if (process.platform !== "win32") throw new Error("Credential belongs to a Windows user.");
    return powershellSecret(secret.value, true);
  }
  if (secret.kind !== "restricted-file") throw new Error("Unsupported credential format.");
  return secret.value;
}
