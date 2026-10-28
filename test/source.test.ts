import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Fetcher, parseSource } from "../src/source.js";
import { FixtureRepo } from "./helpers.js";

describe("Fetcher", () => {
	it("fetches many commits of one repo concurrently", async () => {
		const repo = await FixtureRepo.create({ "version.txt": "0\n" });
		const commits: string[] = [];
		for (let index = 1; index <= 12; index++) {
			commits.push(await repo.commit({ "version.txt": `${index}\n` }));
		}
		const fetcher = new Fetcher();
		try {
			const source = parseSource(repo.url, "/");
			// Stagger the starts so some fetches begin while others are mid-setup, like an install does.
			const checkouts = await Promise.all(
				commits.map(async (commit, index) => {
					await new Promise((resolve) => setTimeout(resolve, index % 4));
					return fetcher.fetch(source, commit);
				}),
			);
			const versions = await Promise.all(
				checkouts.map((checkout) =>
					readFile(join(checkout.dir, "version.txt"), "utf8"),
				),
			);
			expect(versions).toEqual(commits.map((_, index) => `${index + 1}\n`));
			expect(checkouts.map((checkout) => checkout.commit)).toEqual(commits);
		} finally {
			await fetcher.dispose();
		}
	});
});
