import fs from "node:fs/promises";

import {
  defaultServerProperties,
  fileExists,
} from "./config.js";

function resolvePropertiesFile(target) {
  if (!target) {
    throw new Error("A server.properties target is required.");
  }

  if (typeof target === "string") {
    return target;
  }

  if (typeof target === "object" && target.serverPropertiesFile) {
    return target.serverPropertiesFile;
  }

  throw new Error("Unsupported server.properties target.");
}

export function parseProperties(content) {
  const parsed = {};
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) {
      parsed[trimmed] = "";
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1);
    parsed[key] = value;
  }

  return parsed;
}

export function serializeProperties(properties) {
  const orderedKeys = Array.from(
    new Set([
      ...Object.keys(defaultServerProperties),
      ...Object.keys(properties),
    ]),
  );

  const lines = [
    "# Managed by Local Minecraft Panel",
    "# Changes here can also be made from the localhost UI.",
    "",
  ];

  for (const key of orderedKeys) {
    if (properties[key] === undefined || properties[key] === null) {
      continue;
    }

    lines.push(`${key}=${String(properties[key])}`);
  }

  return `${lines.join("\n")}\n`;
}

export async function readServerProperties(target) {
  const propertiesFile = resolvePropertiesFile(target);
  if (!(await fileExists(propertiesFile))) {
    return structuredClone(defaultServerProperties);
  }

  const content = await fs.readFile(propertiesFile, "utf8");
  return {
    ...structuredClone(defaultServerProperties),
    ...parseProperties(content),
  };
}

export async function writeServerProperties(target, properties) {
  const propertiesFile = resolvePropertiesFile(target);
  const merged = {
    ...structuredClone(defaultServerProperties),
    ...properties,
  };

  await fs.writeFile(
    propertiesFile,
    serializeProperties(merged),
    "utf8",
  );

  return merged;
}

export async function ensureServerPropertyFile(target) {
  const properties = await readServerProperties(target);
  await writeServerProperties(target, properties);
  return properties;
}

export function parseBooleanProperty(value) {
  return String(value).toLowerCase() === "true";
}
