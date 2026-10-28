import { execFileSync } from "node:child_process";

/** The CLI tests run the published entry point, so compile it once up front. */
export default function setup(): void {
	execFileSync("pnpm", ["run", "--silent", "build"], { stdio: "inherit" });
}
