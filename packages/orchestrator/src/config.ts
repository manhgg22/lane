import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { HarnessConfig } from "@harness/types";

export function loadConfig(configPath: string): HarnessConfig {
  const raw = readFileSync(configPath, "utf-8");
  const lines = raw.split("\n");

  const config: HarnessConfig = {
    targetRepo: "./fixtures/sample-target-app",
    maxParallel: 5,
    basePort: 3001,
    integrationBranch: "development",
    agent: "claude-code",
    lanes: [],
  };

  let currentLane: {
    title: string;
    slug: string;
    tags: string[];
    criteria: string[];
  } | null = null;
  let inCriteria = false;
  let inTags = false;

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed.startsWith("targetRepo:")) {
      config.targetRepo = trimmed.split(":").slice(1).join(":").trim();
    } else if (trimmed.startsWith("maxParallel:")) {
      config.maxParallel = parseInt(trimmed.split(":")[1].trim(), 10);
    } else if (trimmed.startsWith("basePort:")) {
      config.basePort = parseInt(trimmed.split(":")[1].trim(), 10);
    } else if (trimmed.startsWith("integrationBranch:")) {
      config.integrationBranch = trimmed.split(":")[1].trim();
    } else if (trimmed.startsWith("agent:")) {
      config.agent = trimmed.split(":")[1].trim();
    } else if (trimmed.startsWith("- title:")) {
      if (currentLane) config.lanes.push(currentLane);
      currentLane = {
        title: trimmed.replace("- title:", "").trim().replace(/^"|"$/g, ""),
        slug: "",
        tags: [],
        criteria: [],
      };
      inCriteria = false;
      inTags = false;
    } else if (trimmed.startsWith("slug:") && currentLane) {
      currentLane.slug = trimmed.split(":")[1].trim();
      inCriteria = false;
      inTags = false;
    } else if (trimmed.startsWith("tags:") && currentLane) {
      const inline = trimmed.replace("tags:", "").trim();
      if (inline.startsWith("[")) {
        currentLane.tags = inline
          .replace(/^\[|\]$/g, "")
          .split(",")
          .map((t) => t.trim());
      } else {
        inTags = true;
        inCriteria = false;
      }
    } else if (trimmed.startsWith("criteria:") && currentLane) {
      const inline = trimmed.replace("criteria:", "").trim();
      if (inline.startsWith("[")) {
        currentLane.criteria = inline
          .replace(/^\[|\]$/g, "")
          .split(",")
          .map((c) => c.trim().replace(/^"|"$/g, ""));
      } else {
        inCriteria = true;
        inTags = false;
      }
    } else if (trimmed.startsWith("- ") && currentLane) {
      const val = trimmed.slice(2).trim().replace(/^"|"$/g, "");
      if (inCriteria) currentLane.criteria.push(val);
      else if (inTags) currentLane.tags.push(val);
    }
  }
  if (currentLane) config.lanes.push(currentLane);

  return config;
}
